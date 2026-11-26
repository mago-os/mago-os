-- M7-03: webhooks de saída (contrato em contratos/src/api/webhooks.ts, decisão 0048).
-- 1. webhooks: o endereço, os eventos, a situação e o segredo cifrado pelo cofre (decisão 0021).
-- 2. entregas_de_webhook: a fila e o histórico das entregas (30 dias), uma linha por aviso e webhook.
-- 3. Gatilhos em tarefas, comentarios_de_tarefa, contatos e aprovacoes gravam a entrega na mesma transação da
--    mudança, só para os webhooks ligados da empresa que escolheram o evento (como as rotinas por evento, 0044).
-- 4. empresas_com_entregas_de_webhook(): as empresas com entrega na hora ou webhook a desligar (só ids).
-- 5. Aviso novo webhook_desligado (para os administradores).
-- Explicado em docs/banco/decisoes.md, seção 54.

-- Up Migration

CREATE TABLE public.webhooks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  url text NOT NULL CHECK (url ~ '^https://[^\s/@]+(/[^\s]*)?$' AND length(url) <= 500),
  eventos text[] NOT NULL CHECK (cardinality(eventos) >= 1 AND eventos <@ ARRAY['tarefa.criada', 'tarefa.atualizada',
    'tarefa.concluida', 'tarefa.comentada', 'contato.criado', 'contato.atualizado', 'aprovacao.pedida',
    'aprovacao.respondida']::text[]),
  situacao text NOT NULL DEFAULT 'ligado' CHECK (situacao IN ('ligado', 'desligado')),
  desligado_porque text CHECK (desligado_porque IN ('manual', 'falhas')),
  segredo_cifrado bytea NOT NULL,
  final_do_segredo text NOT NULL CHECK (final_do_segredo ~ '^[A-Za-z0-9_-]{4}$'),
  falhando_desde timestamptz,
  ultima_entrega_em timestamptz,
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhooks_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT webhooks_desligado_diz_porque CHECK ((situacao = 'desligado') = (desligado_porque IS NOT NULL))
);
CREATE INDEX webhooks_ligados ON public.webhooks (empresa_id) WHERE situacao = 'ligado';
COMMENT ON TABLE public.webhooks IS 'Webhooks de saída da empresa (M7-03): para onde os avisos vão e quais eventos.';
COMMENT ON COLUMN public.webhooks.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.webhooks.empresa_id IS '[sistema] Empresa do webhook.';
COMMENT ON COLUMN public.webhooks.nome IS '[empresa] Para que serve (ex.: n8n da 4xpert).';
COMMENT ON COLUMN public.webhooks.url IS '[sensivel] Endereço https que recebe os avisos (pode levar um código na URL).';
COMMENT ON COLUMN public.webhooks.eventos IS '[empresa] Os eventos escolhidos.';
COMMENT ON COLUMN public.webhooks.situacao IS '[sistema] ligado ou desligado.';
COMMENT ON COLUMN public.webhooks.desligado_porque IS '[sistema] manual (alguém desligou) ou falhas (3 dias sem entregar).';
COMMENT ON COLUMN public.webhooks.segredo_cifrado IS '[sensivel] O segredo que assina os avisos, cifrado pelo cofre da empresa.';
COMMENT ON COLUMN public.webhooks.final_do_segredo IS '[sistema] Os 4 últimos caracteres do segredo, para reconhecer na tela.';
COMMENT ON COLUMN public.webhooks.falhando_desde IS '[sistema] Desde quando as entregas falham sem nenhum acerto no meio.';
COMMENT ON COLUMN public.webhooks.ultima_entrega_em IS '[sistema] A última entrega certa.';
COMMENT ON COLUMN public.webhooks.criado_por IS '[sistema] Quem cadastrou.';
COMMENT ON COLUMN public.webhooks.criado_em IS '[sistema] Quando foi cadastrado.';
COMMENT ON COLUMN public.webhooks.atualizado_em IS '[sistema] A última mudança.';
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks FORCE ROW LEVEL SECURITY;
CREATE POLICY webhooks_da_empresa_ativa ON public.webhooks
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.entregas_de_webhook (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  webhook_id uuid NOT NULL,
  evento text NOT NULL CHECK (evento ~ '^[a-z]+\.[a-z]+$'),
  corpo jsonb NOT NULL CHECK (jsonb_typeof(corpo) = 'object'),
  situacao text NOT NULL DEFAULT 'esperando' CHECK (situacao IN ('esperando', 'entregue', 'falhou', 'desistiu')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultimo_codigo integer,
  ultimo_erro text CHECK (length(ultimo_erro) <= 300),
  ultimo_tempo_ms integer CHECK (ultimo_tempo_ms >= 0),
  proxima_em timestamptz,
  criada_em timestamptz NOT NULL DEFAULT now(),
  entregue_em timestamptz,
  CONSTRAINT entregas_do_webhook FOREIGN KEY (empresa_id, webhook_id)
    REFERENCES public.webhooks (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT entregas_proxima CHECK ((situacao IN ('esperando', 'falhou')) = (proxima_em IS NOT NULL))
);
CREATE INDEX entregas_na_fila ON public.entregas_de_webhook (empresa_id, proxima_em) WHERE proxima_em IS NOT NULL;
CREATE INDEX entregas_do_webhook_idx ON public.entregas_de_webhook (empresa_id, webhook_id, criada_em DESC);
COMMENT ON TABLE public.entregas_de_webhook IS
  'Fila e histórico das entregas dos webhooks (M7-03): uma linha por aviso e webhook, com as tentativas. Ficam 30 dias.';
COMMENT ON COLUMN public.entregas_de_webhook.id IS '[sistema] Número único da entrega (o mesmo em todas as tentativas).';
COMMENT ON COLUMN public.entregas_de_webhook.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.entregas_de_webhook.webhook_id IS '[sistema] O webhook.';
COMMENT ON COLUMN public.entregas_de_webhook.evento IS '[sistema] O evento (ex.: tarefa.concluida).';
COMMENT ON COLUMN public.entregas_de_webhook.corpo IS '[sistema] O aviso (AvisoDoWebhook do contrato): só ids e nomes de campos.';
COMMENT ON COLUMN public.entregas_de_webhook.situacao IS '[sistema] esperando, entregue, falhou (vai tentar de novo) ou desistiu.';
COMMENT ON COLUMN public.entregas_de_webhook.tentativas IS '[sistema] Quantas vezes tentou.';
COMMENT ON COLUMN public.entregas_de_webhook.ultimo_codigo IS '[sistema] O código HTTP da última resposta.';
COMMENT ON COLUMN public.entregas_de_webhook.ultimo_erro IS '[sistema] O que deu errado (sem o corpo da resposta).';
COMMENT ON COLUMN public.entregas_de_webhook.ultimo_tempo_ms IS '[sistema] Quanto a última tentativa demorou.';
COMMENT ON COLUMN public.entregas_de_webhook.proxima_em IS '[sistema] Quando tenta de novo (nulo: terminou).';
COMMENT ON COLUMN public.entregas_de_webhook.criada_em IS '[sistema] Quando o evento aconteceu.';
COMMENT ON COLUMN public.entregas_de_webhook.entregue_em IS '[sistema] Quando foi entregue.';
ALTER TABLE public.entregas_de_webhook ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entregas_de_webhook FORCE ROW LEVEL SECURITY;
CREATE POLICY entregas_de_webhook_da_empresa_ativa ON public.entregas_de_webhook
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Grava o aviso para cada webhook ligado da empresa que escolheu o evento. Roda com quem mudou (RLS da empresa ativa):
-- fora de uma empresa ativa, não acha webhook nenhum e não grava nada.
CREATE FUNCTION public.gravar_aviso_de_webhook(empresa uuid, qual text, dados jsonb) RETURNS void
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    INSERT INTO public.entregas_de_webhook (empresa_id, webhook_id, evento, corpo, proxima_em)
    SELECT w.empresa_id, w.id, qual,
           jsonb_build_object('evento', qual, 'ocorridoEm', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'empresaId', w.empresa_id, 'dados', dados),
           now()
      FROM public.webhooks w
     WHERE w.empresa_id = empresa AND w.situacao = 'ligado' AND qual = ANY (w.eventos);
  END
  $$;

CREATE FUNCTION public.avisos_de_webhook_da_tarefa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    campos text[] := '{}';
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.webhooks w WHERE w.empresa_id = NEW.empresa_id AND w.situacao = 'ligado') THEN
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'tarefa.criada',
        jsonb_build_object('tipo', 'tarefa', 'id', NEW.id, 'status', NEW.status));
      RETURN NULL;
    END IF;
    IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN campos := array_append(campos, 'titulo'); END IF;
    IF NEW.descricao IS DISTINCT FROM OLD.descricao THEN campos := array_append(campos, 'descricao'); END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN campos := array_append(campos, 'status'); END IF;
    IF NEW.responsavel_pessoa_id IS DISTINCT FROM OLD.responsavel_pessoa_id
       OR NEW.responsavel_agente_id IS DISTINCT FROM OLD.responsavel_agente_id THEN
      campos := array_append(campos, 'responsavel');
    END IF;
    IF NEW.prazo_em IS DISTINCT FROM OLD.prazo_em THEN campos := array_append(campos, 'prazo'); END IF;
    IF NEW.prioridade IS DISTINCT FROM OLD.prioridade THEN campos := array_append(campos, 'prioridade'); END IF;
    IF NEW.projeto_id IS DISTINCT FROM OLD.projeto_id THEN campos := array_append(campos, 'projeto'); END IF;
    IF cardinality(campos) > 0 THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'tarefa.atualizada',
        jsonb_build_object('tipo', 'tarefa', 'id', NEW.id, 'status', NEW.status, 'campos', to_jsonb(campos)));
    END IF;
    IF NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'tarefa.concluida',
        jsonb_build_object('tipo', 'tarefa', 'id', NEW.id, 'status', NEW.status));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_de_webhook_da_tarefa AFTER INSERT OR UPDATE ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.avisos_de_webhook_da_tarefa();

-- Só comentário (a nota interna não sai da empresa).
CREATE FUNCTION public.avisos_de_webhook_do_comentario() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.tipo = 'comentario' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'tarefa.comentada',
        jsonb_build_object('tipo', 'tarefa', 'id', NEW.tarefa_id, 'tarefaId', NEW.tarefa_id));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_de_webhook_do_comentario AFTER INSERT ON public.comentarios_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.avisos_de_webhook_do_comentario();

CREATE FUNCTION public.avisos_de_webhook_do_contato() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'contato.criado',
        jsonb_build_object('tipo', 'contato', 'id', NEW.id));
    ELSIF NEW.atualizado_em IS DISTINCT FROM OLD.atualizado_em THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'contato.atualizado',
        jsonb_build_object('tipo', 'contato', 'id', NEW.id, 'status', NEW.situacao));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_de_webhook_do_contato AFTER INSERT OR UPDATE ON public.contatos
  FOR EACH ROW EXECUTE FUNCTION public.avisos_de_webhook_do_contato();

CREATE FUNCTION public.avisos_de_webhook_da_aprovacao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'aprovacao.pedida',
        jsonb_build_object('tipo', 'aprovacao', 'id', NEW.id, 'tarefaId', NEW.tarefa_id, 'status', NEW.situacao));
    ELSIF NEW.situacao IS DISTINCT FROM OLD.situacao AND OLD.situacao = 'pendente' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'aprovacao.respondida',
        jsonb_build_object('tipo', 'aprovacao', 'id', NEW.id, 'tarefaId', NEW.tarefa_id, 'status', NEW.situacao));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_de_webhook_da_aprovacao AFTER INSERT OR UPDATE OF situacao ON public.aprovacoes
  FOR EACH ROW EXECUTE FUNCTION public.avisos_de_webhook_da_aprovacao();

-- As empresas com entrega na hora, webhook a desligar ou histórico a limpar (só ids), para o trabalho de entrega.
CREATE FUNCTION public.empresas_com_entregas_de_webhook() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT empresa_id FROM public.entregas_de_webhook WHERE proxima_em <= now()
    UNION
    SELECT DISTINCT empresa_id FROM public.webhooks
     WHERE situacao = 'ligado' AND falhando_desde < now() - interval '3 days'
  $$;
REVOKE EXECUTE ON FUNCTION public.empresas_com_entregas_de_webhook() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_entregas_de_webhook() TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'webhook_desligado';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo'));
DROP FUNCTION public.empresas_com_entregas_de_webhook();
DROP TRIGGER avisos_de_webhook_da_aprovacao ON public.aprovacoes;
DROP FUNCTION public.avisos_de_webhook_da_aprovacao();
DROP TRIGGER avisos_de_webhook_do_contato ON public.contatos;
DROP FUNCTION public.avisos_de_webhook_do_contato();
DROP TRIGGER avisos_de_webhook_do_comentario ON public.comentarios_de_tarefa;
DROP FUNCTION public.avisos_de_webhook_do_comentario();
DROP TRIGGER avisos_de_webhook_da_tarefa ON public.tarefas;
DROP FUNCTION public.avisos_de_webhook_da_tarefa();
DROP FUNCTION public.gravar_aviso_de_webhook(uuid, text, jsonb);
DROP TABLE public.entregas_de_webhook;
DROP TABLE public.webhooks;
