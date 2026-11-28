-- M8-09: o WhatsApp oficial da plataforma para a equipe (decisão 0059), como o Telegram (M5).
-- 1. vinculos_do_whatsapp e codigos_do_whatsapp, como os do Telegram (o número de cada pessoa, uma de cada lado).
-- 2. O esquema whatsapp guarda o controle do webhook (mensagens já tratadas, códigos errados, mensagens por minuto).
-- 3. As conversas e as mensagens ganham o canal whatsapp; a resposta do agente fica marcada para ir por lá.
-- 4. avisos.whatsapp_pendente, aprovacoes_no_whatsapp e pedidos_de_codigo_no_whatsapp. As travas dos códigos errados
--    das aprovações são as do Telegram (por pessoa): errar num trava os dois.
-- 5. As funções que o webhook e a verificação usam sem saber a empresa (só ids), e o aviso whatsapp_desvinculado.
-- Explicado em docs/banco/decisoes.md, seção 64.

-- Up Migration

CREATE TABLE public.vinculos_do_whatsapp (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  numero text NOT NULL CHECK (numero ~ '^[0-9]{8,15}$'),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  conversa_id uuid,
  ultima_mensagem_em timestamptz,
  resumo_do_dia_em date,
  dia_dos_modelos date,
  modelos_no_dia integer NOT NULL DEFAULT 0 CHECK (modelos_no_dia >= 0),
  vinculado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vinculos_do_whatsapp_um_por_pessoa UNIQUE (pessoa_id),
  CONSTRAINT vinculos_do_whatsapp_uma_pessoa_por_numero UNIQUE (numero),
  CONSTRAINT vinculos_do_whatsapp_vinculo FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT vinculos_do_whatsapp_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas (empresa_id, id) ON DELETE SET NULL (conversa_id)
);
COMMENT ON TABLE public.vinculos_do_whatsapp IS
  'O WhatsApp de cada pessoa (um de cada lado, na plataforma toda) e a empresa da conversa por lá (M8-09).';
COMMENT ON COLUMN public.vinculos_do_whatsapp.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.empresa_id IS
  '[sistema] Empresa da conversa pelo WhatsApp (a pessoa precisa ter vínculo ativo nela).';
COMMENT ON COLUMN public.vinculos_do_whatsapp.pessoa_id IS '[sistema] A pessoa.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.numero IS '[pessoal] O número do WhatsApp da pessoa, só os dígitos.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.nome IS '[pessoal] O nome do perfil do WhatsApp.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.conversa_id IS '[sistema] A conversa atual com o coordenador.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.ultima_mensagem_em IS
  '[sistema] A última mensagem da pessoa: abre a janela de 24 horas da Meta.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.resumo_do_dia_em IS '[sistema] O último dia em que o resumo foi.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.dia_dos_modelos IS '[sistema] O dia da contagem dos modelos.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.modelos_no_dia IS
  '[sistema] Mensagens por modelo (pagas pela Nolask) mandadas no dia: no máximo 10.';
COMMENT ON COLUMN public.vinculos_do_whatsapp.vinculado_em IS '[sistema] Quando foi vinculado.';
ALTER TABLE public.vinculos_do_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vinculos_do_whatsapp FORCE ROW LEVEL SECURITY;
CREATE POLICY vinculos_do_whatsapp_da_empresa_ou_da_pessoa ON public.vinculos_do_whatsapp
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (pessoa_id = public.pessoa_ativa());
-- Criar é só por vincular_whatsapp() (o código conferido).
REVOKE INSERT ON public.vinculos_do_whatsapp FROM mago_app;
-- A mesma conferência do Telegram: a empresa da conversa precisa ter vínculo ativo da pessoa.
CREATE TRIGGER conferir_empresa_do_whatsapp BEFORE INSERT OR UPDATE OF empresa_id, pessoa_id
  ON public.vinculos_do_whatsapp FOR EACH ROW EXECUTE FUNCTION public.conferir_empresa_do_telegram();

CREATE TABLE public.codigos_do_whatsapp (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  resumo text NOT NULL UNIQUE CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  vence_em timestamptz NOT NULL,
  usado_em timestamptz,
  CONSTRAINT codigos_do_whatsapp_vence_depois CHECK (vence_em > criado_em)
);
CREATE UNIQUE INDEX codigos_do_whatsapp_um_aberto ON public.codigos_do_whatsapp (pessoa_id) WHERE usado_em IS NULL;
COMMENT ON TABLE public.codigos_do_whatsapp IS
  'Códigos de vínculo do WhatsApp (M8-09): de uso único, valem 10 minutos; só o resumo fica guardado.';
COMMENT ON COLUMN public.codigos_do_whatsapp.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.codigos_do_whatsapp.empresa_id IS '[sistema] Empresa em que o código foi gerado.';
COMMENT ON COLUMN public.codigos_do_whatsapp.pessoa_id IS '[sistema] Quem gerou.';
COMMENT ON COLUMN public.codigos_do_whatsapp.resumo IS '[sensivel] Resumo (SHA-256) do código.';
COMMENT ON COLUMN public.codigos_do_whatsapp.criado_em IS '[sistema] Quando.';
COMMENT ON COLUMN public.codigos_do_whatsapp.vence_em IS '[sistema] Até quando vale.';
COMMENT ON COLUMN public.codigos_do_whatsapp.usado_em IS '[sistema] Quando foi usado (ou anulado por outro).';
ALTER TABLE public.codigos_do_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_do_whatsapp FORCE ROW LEVEL SECURITY;
CREATE POLICY codigos_do_whatsapp_da_empresa_e_da_pessoa ON public.codigos_do_whatsapp
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (pessoa_id = public.pessoa_ativa());
REVOKE DELETE ON public.codigos_do_whatsapp FROM mago_app;

-- O que o webhook guarda sem saber a empresa: nenhum dado de negócio, e a API não lê nem grava direto.
CREATE SCHEMA whatsapp;
COMMENT ON SCHEMA whatsapp IS
  'Controle do webhook do WhatsApp da plataforma (M8-09): mensagens já tratadas, códigos errados e mensagens por minuto.';
CREATE TABLE whatsapp.mensagens (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  recebida_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensagens_por_data ON whatsapp.mensagens (recebida_em);
CREATE TABLE whatsapp.codigos_errados (
  numero text NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codigos_errados_por_numero ON whatsapp.codigos_errados (numero, em);
CREATE TABLE whatsapp.mensagens_por_minuto (
  numero text NOT NULL,
  minuto timestamptz NOT NULL,
  n integer NOT NULL DEFAULT 1,
  PRIMARY KEY (numero, minuto)
);

CREATE FUNCTION public.mensagem_nova_do_whatsapp(mensagem text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE nova boolean;
  BEGIN
    INSERT INTO whatsapp.mensagens (id) VALUES (mensagem) ON CONFLICT DO NOTHING;
    nova := FOUND;
    IF nova AND random() < 0.01 THEN
      DELETE FROM whatsapp.mensagens WHERE recebida_em < now() - interval '7 days';
      DELETE FROM whatsapp.codigos_errados WHERE em < now() - interval '1 day';
      DELETE FROM whatsapp.mensagens_por_minuto WHERE minuto < now() - interval '1 hour';
    END IF;
    RETURN nova;
  END
  $$;
COMMENT ON FUNCTION public.mensagem_nova_do_whatsapp(text) IS
  'Grava o id da mensagem da Meta; falso se ela já tinha chegado.';

CREATE FUNCTION public.esquecer_mensagem_do_whatsapp(mensagem text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ DELETE FROM whatsapp.mensagens WHERE id = mensagem $$;
COMMENT ON FUNCTION public.esquecer_mensagem_do_whatsapp(text) IS
  'Apaga o id de uma mensagem da Meta que não chegou à fila (a Meta entrega de novo).';

CREATE FUNCTION public.contar_mensagem_do_whatsapp(numero_wa text) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    INSERT INTO whatsapp.mensagens_por_minuto (numero, minuto) VALUES (numero_wa, date_trunc('minute', now()))
    ON CONFLICT (numero, minuto) DO UPDATE SET n = whatsapp.mensagens_por_minuto.n + 1
    RETURNING n
  $$;
COMMENT ON FUNCTION public.contar_mensagem_do_whatsapp(text) IS
  'Conta a mensagem do número neste minuto e devolve quantas já foram.';

CREATE FUNCTION public.codigos_errados_do_whatsapp(numero_wa text, errou boolean, minutos integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF errou THEN INSERT INTO whatsapp.codigos_errados (numero) VALUES (numero_wa); END IF;
    RETURN (SELECT count(*)::integer FROM whatsapp.codigos_errados
             WHERE numero = numero_wa AND em > now() - make_interval(mins => minutos));
  END
  $$;
COMMENT ON FUNCTION public.codigos_errados_do_whatsapp(text, boolean, integer) IS
  'Grava um código errado (se errou) e devolve quantos o número errou nos últimos minutos.';

CREATE FUNCTION public.reconhecer_whatsapp(numero_wa text)
  RETURNS TABLE (pessoa_id uuid, empresa_id uuid, pessoa_nome text, empresa_nome text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT w.pessoa_id, w.empresa_id, p.nome, e.nome
      FROM public.vinculos_do_whatsapp w
      JOIN public.pessoas p ON p.id = w.pessoa_id AND p.situacao = 'ativa'
      JOIN public.vinculos v ON v.empresa_id = w.empresa_id AND v.pessoa_id = w.pessoa_id AND v.situacao = 'ativo'
      JOIN public.empresas e ON e.id = w.empresa_id AND e.situacao = 'ativa'
     WHERE w.numero = numero_wa
  $$;
COMMENT ON FUNCTION public.reconhecer_whatsapp(text) IS
  'Acha a pessoa e a empresa de um número de WhatsApp (a mensagem ainda não tem empresa). Só vínculos ativos.';

CREATE FUNCTION public.vincular_whatsapp(resumo_do_codigo text, numero_wa text, nome_wa text)
  RETURNS TABLE (pessoa_id uuid, empresa_id uuid, pessoa_nome text, empresa_nome text,
                 tirada_de uuid, tirada_de_empresa uuid, trocou_numero boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    c public.codigos_do_whatsapp;
    antes public.vinculos_do_whatsapp;
    da_pessoa boolean := false;
  BEGIN
    UPDATE public.codigos_do_whatsapp k SET usado_em = now()
     WHERE k.resumo = resumo_do_codigo AND k.usado_em IS NULL AND k.vence_em > now()
       AND EXISTS (SELECT 1 FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
                     JOIN public.pessoas p ON p.id = v.pessoa_id
                    WHERE v.empresa_id = k.empresa_id AND v.pessoa_id = k.pessoa_id AND v.situacao = 'ativo'
                      AND e.situacao = 'ativa' AND p.situacao = 'ativa')
    RETURNING * INTO c;
    IF c.id IS NULL THEN RETURN; END IF;
    SELECT * INTO antes FROM public.vinculos_do_whatsapp w WHERE w.numero = numero_wa AND w.pessoa_id <> c.pessoa_id;
    DELETE FROM public.vinculos_do_whatsapp w WHERE w.numero = numero_wa AND w.pessoa_id <> c.pessoa_id;
    DELETE FROM public.vinculos_do_whatsapp w WHERE w.pessoa_id = c.pessoa_id AND w.numero <> numero_wa;
    da_pessoa := FOUND;
    INSERT INTO public.vinculos_do_whatsapp AS w (empresa_id, pessoa_id, numero, nome, ultima_mensagem_em)
    VALUES (c.empresa_id, c.pessoa_id, numero_wa, nome_wa, now())
    ON CONFLICT ON CONSTRAINT vinculos_do_whatsapp_um_por_pessoa DO UPDATE
      SET empresa_id = EXCLUDED.empresa_id, nome = EXCLUDED.nome, vinculado_em = now(), conversa_id = NULL,
          ultima_mensagem_em = now();
    RETURN QUERY
      SELECT c.pessoa_id, c.empresa_id, p.nome, e.nome, antes.pessoa_id, antes.empresa_id, da_pessoa
        FROM public.pessoas p, public.empresas e WHERE p.id = c.pessoa_id AND e.id = c.empresa_id;
  END
  $$;
COMMENT ON FUNCTION public.vincular_whatsapp(text, text, text) IS
  'Usa o código de vínculo do WhatsApp: liga o número à pessoa, tirando-o de quem o tinha.';

CREATE FUNCTION public.marcar_resumo_do_dia_no_whatsapp(pessoa uuid, dia date) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE public.vinculos_do_whatsapp SET resumo_do_dia_em = dia
     WHERE empresa_id = public.empresa_ativa() AND pessoa_id = pessoa AND public.pessoa_ativa() IS NULL
  $$;
COMMENT ON FUNCTION public.marcar_resumo_do_dia_no_whatsapp(uuid, date) IS
  'Marca o dia do resumo pelo WhatsApp (a verificação do sistema não tem pessoa no pedido).';

-- Reserva um envio por modelo (pago pela Nolask) para a pessoa no dia, até o máximo. Falso: o dia já chegou ao teto.
CREATE FUNCTION public.reservar_modelo_do_whatsapp(pessoa uuid, dia date, maximo integer) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE public.vinculos_do_whatsapp
       SET modelos_no_dia = CASE WHEN dia_dos_modelos = dia THEN modelos_no_dia + 1 ELSE 1 END, dia_dos_modelos = dia
     WHERE empresa_id = public.empresa_ativa() AND pessoa_id = pessoa
       AND (dia_dos_modelos IS DISTINCT FROM dia OR modelos_no_dia < maximo);
    RETURN FOUND;
  END
  $$;
COMMENT ON FUNCTION public.reservar_modelo_do_whatsapp(uuid, date, integer) IS
  'Conta uma mensagem por modelo do WhatsApp da pessoa no dia; falso se o dia já chegou ao máximo.';
REVOKE EXECUTE ON FUNCTION public.reservar_modelo_do_whatsapp(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_modelo_do_whatsapp(uuid, date, integer) TO mago_app;

-- A conversa e as mensagens com o coordenador ganham o canal whatsapp.
ALTER TABLE public.conversas DROP CONSTRAINT conversas_canal_check;
ALTER TABLE public.conversas ADD CONSTRAINT conversas_canal_check
  CHECK (canal IN ('app', 'telegram', 'rotina', 'whatsapp'));
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_de_conversa_canal_check;
ALTER TABLE public.mensagens_de_conversa ADD CONSTRAINT mensagens_de_conversa_canal_check
  CHECK (canal IN ('app', 'telegram', 'rotina', 'whatsapp'));
ALTER TABLE public.mensagens_de_conversa
  ADD COLUMN whatsapp_pendente boolean NOT NULL DEFAULT false,
  ADD COLUMN whatsapp_enviada_em timestamptz,
  ADD COLUMN whatsapp_partes_enviadas integer NOT NULL DEFAULT 0 CHECK (whatsapp_partes_enviadas >= 0),
  ADD CONSTRAINT mensagens_whatsapp_pelo_canal CHECK (NOT whatsapp_pendente OR canal = 'whatsapp');
CREATE INDEX mensagens_para_o_whatsapp ON public.mensagens_de_conversa (empresa_id, criada_em)
  WHERE whatsapp_pendente;
COMMENT ON COLUMN public.mensagens_de_conversa.whatsapp_pendente IS
  '[sistema] A resposta do agente ainda vai pelo WhatsApp (M8-09).';
COMMENT ON COLUMN public.mensagens_de_conversa.whatsapp_enviada_em IS '[sistema] Quando foi pelo WhatsApp.';
COMMENT ON COLUMN public.mensagens_de_conversa.whatsapp_partes_enviadas IS
  '[sistema] Partes da resposta longa já mandadas pelo WhatsApp.';

-- Os avisos: só os criados daqui em diante esperam o WhatsApp.
ALTER TABLE public.avisos ADD COLUMN whatsapp_pendente boolean NOT NULL DEFAULT false;
ALTER TABLE public.avisos ALTER COLUMN whatsapp_pendente SET DEFAULT true;
CREATE INDEX avisos_para_o_whatsapp ON public.avisos (empresa_id, pessoa_id, criado_em) WHERE whatsapp_pendente;
COMMENT ON COLUMN public.avisos.whatsapp_pendente IS '[sistema] O aviso ainda vai pelo WhatsApp (M8-09).';

CREATE TABLE public.aprovacoes_no_whatsapp (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  aprovacao_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  mensagem_id text CHECK (length(mensagem_id) <= 200),
  conferencia text NOT NULL CHECK (conferencia ~ '^[0-9a-f]{64}$'),
  enviada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz,
  PRIMARY KEY (empresa_id, aprovacao_id, pessoa_id),
  CONSTRAINT aprovacoes_no_whatsapp_aprovacao FOREIGN KEY (empresa_id, aprovacao_id)
    REFERENCES public.aprovacoes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT aprovacoes_no_whatsapp_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.aprovacoes_no_whatsapp IS
  'Os pedidos de aprovação mandados pelo WhatsApp (M8-09), com a conferência mostrada a cada pessoa.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.empresa_id IS '[sistema] Empresa do pedido.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.aprovacao_id IS '[sistema] O pedido de aprovação.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.pessoa_id IS '[sistema] A quem foi.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.mensagem_id IS '[sistema] O id da mensagem na Meta.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.conferencia IS '[sistema] A conferência do pedido que a pessoa viu.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.enviada_em IS '[sistema] Quando foi.';
COMMENT ON COLUMN public.aprovacoes_no_whatsapp.atualizada_em IS '[sistema] Quando a decisão foi avisada por lá.';
ALTER TABLE public.aprovacoes_no_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aprovacoes_no_whatsapp FORCE ROW LEVEL SECURITY;
CREATE POLICY aprovacoes_no_whatsapp_da_empresa_ou_da_pessoa ON public.aprovacoes_no_whatsapp
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.pedidos_de_codigo_no_whatsapp (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  aprovacao_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao IN ('aprovar', 'recusar')),
  conferencia text NOT NULL CHECK (conferencia ~ '^[0-9a-f]{64}$'),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  vale_ate timestamptz NOT NULL,
  PRIMARY KEY (pessoa_id),
  CONSTRAINT pedidos_de_codigo_no_whatsapp_vale_depois CHECK (vale_ate > aberto_em),
  CONSTRAINT pedidos_de_codigo_no_whatsapp_aprovacao FOREIGN KEY (empresa_id, aprovacao_id)
    REFERENCES public.aprovacoes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT pedidos_de_codigo_no_whatsapp_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.pedidos_de_codigo_no_whatsapp IS
  'O toque em Aprovar ou Recusar pelo WhatsApp esperando o código ou o motivo (M8-09), um por pessoa.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.empresa_id IS '[sistema] Empresa do pedido de aprovação.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.pessoa_id IS '[sistema] Quem tocou.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.aprovacao_id IS '[sistema] O pedido de aprovação.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.acao IS '[sistema] aprovar (espera o código) ou recusar (o motivo).';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.conferencia IS '[sistema] A conferência que a pessoa viu.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.aberto_em IS '[sistema] Quando tocou.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_whatsapp.vale_ate IS '[sistema] Até quando espera (5 minutos).';
ALTER TABLE public.pedidos_de_codigo_no_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_de_codigo_no_whatsapp FORCE ROW LEVEL SECURITY;
CREATE POLICY pedidos_de_codigo_no_whatsapp_da_empresa_ou_da_pessoa ON public.pedidos_de_codigo_no_whatsapp
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

-- As empresas com alguém no WhatsApp, e as com algo esperando para ir por lá (só ids), para a verificação.
CREATE FUNCTION public.empresas_com_whatsapp() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT DISTINCT w.empresa_id FROM public.vinculos_do_whatsapp w $$;
COMMENT ON FUNCTION public.empresas_com_whatsapp() IS 'As empresas com alguém no WhatsApp (só ids).';
REVOKE EXECUTE ON FUNCTION public.empresas_com_whatsapp() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_whatsapp() TO mago_app;

CREATE FUNCTION public.empresas_com_whatsapp_pendente() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT m.empresa_id FROM public.mensagens_de_conversa m WHERE m.whatsapp_pendente
    UNION
    SELECT a.empresa_id FROM public.avisos a WHERE a.whatsapp_pendente
    UNION
    SELECT p.empresa_id FROM public.aprovacoes p
      JOIN public.agentes g ON g.id = p.agente_id AND g.empresa_id = p.empresa_id
      JOIN public.vinculos_do_whatsapp w ON w.empresa_id = p.empresa_id
       AND w.pessoa_id IN (p.pedido_por, g.responsavel_id)
     WHERE p.situacao = 'pendente' AND p.vence_em > now()
       AND NOT EXISTS (SELECT 1 FROM public.aprovacoes_no_whatsapp n WHERE n.empresa_id = p.empresa_id
                        AND n.aprovacao_id = p.id AND n.pessoa_id = w.pessoa_id)
    UNION
    SELECT n.empresa_id FROM public.aprovacoes_no_whatsapp n JOIN public.aprovacoes p
        ON p.id = n.aprovacao_id AND p.empresa_id = n.empresa_id
     WHERE n.atualizada_em IS NULL AND n.mensagem_id IS NOT NULL
       AND (p.situacao IN ('recusada', 'vencida', 'falhou') OR (p.situacao = 'aprovada' AND p.resultado IS NOT NULL)
            OR (p.situacao = 'pendente' AND p.vence_em <= now()))
    LIMIT 100
  $$;
COMMENT ON FUNCTION public.empresas_com_whatsapp_pendente() IS
  'Empresas com resposta, aviso ou pedido de aprovação esperando para ir pelo WhatsApp (só ids).';
REVOKE EXECUTE ON FUNCTION public.empresas_com_whatsapp_pendente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_whatsapp_pendente() TO mago_app;

REVOKE EXECUTE ON FUNCTION public.mensagem_nova_do_whatsapp(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.esquecer_mensagem_do_whatsapp(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.contar_mensagem_do_whatsapp(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.codigos_errados_do_whatsapp(text, boolean, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconhecer_whatsapp(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vincular_whatsapp(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_resumo_do_dia_no_whatsapp(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mensagem_nova_do_whatsapp(text) TO mago_app;
GRANT EXECUTE ON FUNCTION public.esquecer_mensagem_do_whatsapp(text) TO mago_app;
GRANT EXECUTE ON FUNCTION public.contar_mensagem_do_whatsapp(text) TO mago_app;
GRANT EXECUTE ON FUNCTION public.codigos_errados_do_whatsapp(text, boolean, integer) TO mago_app;
GRANT EXECUTE ON FUNCTION public.reconhecer_whatsapp(text) TO mago_app;
GRANT EXECUTE ON FUNCTION public.vincular_whatsapp(text, text, text) TO mago_app;
GRANT EXECUTE ON FUNCTION public.marcar_resumo_do_dia_no_whatsapp(uuid, date) TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa', 'agente_pronto_para_responder', 'conversa_precisa_de_pessoa', 'conversa_passou_do_prazo',
  'whatsapp_desvinculado'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'whatsapp_desvinculado';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa', 'agente_pronto_para_responder', 'conversa_precisa_de_pessoa', 'conversa_passou_do_prazo'));
DROP FUNCTION public.empresas_com_whatsapp_pendente();
DROP FUNCTION public.empresas_com_whatsapp();
DROP TABLE public.pedidos_de_codigo_no_whatsapp;
DROP TABLE public.aprovacoes_no_whatsapp;
DROP INDEX public.avisos_para_o_whatsapp;
ALTER TABLE public.avisos DROP COLUMN whatsapp_pendente;
DROP INDEX public.mensagens_para_o_whatsapp;
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_whatsapp_pelo_canal,
  DROP COLUMN whatsapp_partes_enviadas, DROP COLUMN whatsapp_enviada_em, DROP COLUMN whatsapp_pendente;
DELETE FROM public.mensagens_de_conversa WHERE canal = 'whatsapp';
UPDATE public.conversas SET canal = 'app' WHERE canal = 'whatsapp';
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_de_conversa_canal_check;
ALTER TABLE public.mensagens_de_conversa ADD CONSTRAINT mensagens_de_conversa_canal_check
  CHECK (canal IN ('app', 'telegram', 'rotina'));
ALTER TABLE public.conversas DROP CONSTRAINT conversas_canal_check;
ALTER TABLE public.conversas ADD CONSTRAINT conversas_canal_check CHECK (canal IN ('app', 'telegram', 'rotina'));
DROP FUNCTION public.reservar_modelo_do_whatsapp(uuid, date, integer);
DROP FUNCTION public.marcar_resumo_do_dia_no_whatsapp(uuid, date);
DROP FUNCTION public.vincular_whatsapp(text, text, text);
DROP FUNCTION public.reconhecer_whatsapp(text);
DROP FUNCTION public.codigos_errados_do_whatsapp(text, boolean, integer);
DROP FUNCTION public.contar_mensagem_do_whatsapp(text);
DROP FUNCTION public.esquecer_mensagem_do_whatsapp(text);
DROP FUNCTION public.mensagem_nova_do_whatsapp(text);
DROP SCHEMA whatsapp CASCADE;
DROP TABLE public.codigos_do_whatsapp;
DROP TABLE public.vinculos_do_whatsapp;
