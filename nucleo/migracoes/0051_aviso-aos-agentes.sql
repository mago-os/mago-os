-- M7-04: aviso imediato aos agentes externos (decisão 0049), pelo mesmo caminho dos webhooks (0050).
-- 1. webhooks.agente_id: o webhook de aviso de um agente (um por agente), fora da tela Webhooks.
-- 2. Os eventos agente.tarefa_recebida, agente.mencionado e agente.aprovacao_respondida, gravados na mesma transação
--    da mudança, só para o webhook ligado do próprio agente.
-- Explicado em docs/banco/decisoes.md, seção 55.

-- Up Migration

ALTER TABLE public.webhooks ADD COLUMN agente_id uuid;
ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_do_agente FOREIGN KEY (empresa_id, agente_id)
  REFERENCES public.agentes (empresa_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX webhooks_um_por_agente ON public.webhooks (agente_id) WHERE agente_id IS NOT NULL;
COMMENT ON COLUMN public.webhooks.agente_id IS
  '[sistema] No aviso imediato de um agente externo (M7-04): o agente. Nulo: webhook da empresa.';
ALTER TABLE public.webhooks DROP CONSTRAINT webhooks_eventos_check;
ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_eventos_check CHECK (
  cardinality(eventos) >= 1 AND (
    (agente_id IS NULL AND eventos <@ ARRAY['tarefa.criada', 'tarefa.atualizada', 'tarefa.concluida',
      'tarefa.comentada', 'contato.criado', 'contato.atualizado', 'aprovacao.pedida', 'aprovacao.respondida']::text[])
    OR (agente_id IS NOT NULL AND eventos <@ ARRAY['agente.tarefa_recebida', 'agente.mencionado',
      'agente.aprovacao_respondida']::text[])));

-- Os eventos do agente têm sublinhado (agente.tarefa_recebida).
ALTER TABLE public.entregas_de_webhook DROP CONSTRAINT entregas_de_webhook_evento_check;
ALTER TABLE public.entregas_de_webhook ADD CONSTRAINT entregas_de_webhook_evento_check
  CHECK (evento ~ '^[a-z]+\.[a-z_]+$');

-- Os avisos da empresa vão só aos webhooks da empresa (nunca ao do agente).
CREATE OR REPLACE FUNCTION public.gravar_aviso_de_webhook(empresa uuid, qual text, dados jsonb) RETURNS void
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    INSERT INTO public.entregas_de_webhook (empresa_id, webhook_id, evento, corpo, proxima_em)
    SELECT w.empresa_id, w.id, qual,
           jsonb_build_object('evento', qual, 'ocorridoEm', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'empresaId', w.empresa_id, 'dados', dados),
           now()
      FROM public.webhooks w
     WHERE w.empresa_id = empresa AND w.situacao = 'ligado' AND w.agente_id IS NULL AND qual = ANY (w.eventos);
  END
  $$;

-- O aviso ao agente: só o webhook ligado dele. Roda com quem mudou (RLS da empresa ativa).
CREATE FUNCTION public.gravar_aviso_ao_agente(empresa uuid, agente uuid, qual text, dados jsonb) RETURNS void
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF agente IS NULL THEN RETURN; END IF;
    INSERT INTO public.entregas_de_webhook (empresa_id, webhook_id, evento, corpo, proxima_em)
    SELECT w.empresa_id, w.id, qual,
           jsonb_build_object('evento', qual, 'ocorridoEm', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'empresaId', w.empresa_id, 'dados', dados || jsonb_build_object('agenteId', agente)),
           now()
      FROM public.webhooks w
     WHERE w.empresa_id = empresa AND w.agente_id = agente AND w.situacao = 'ligado' AND qual = ANY (w.eventos);
  END
  $$;

CREATE FUNCTION public.avisos_ao_agente_da_tarefa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.responsavel_agente_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.responsavel_agente_id IS DISTINCT FROM OLD.responsavel_agente_id) THEN
      PERFORM public.gravar_aviso_ao_agente(NEW.empresa_id, NEW.responsavel_agente_id, 'agente.tarefa_recebida',
        jsonb_build_object('tipo', 'tarefa', 'id', NEW.id, 'status', NEW.status));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_ao_agente_da_tarefa AFTER INSERT OR UPDATE OF responsavel_agente_id ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.avisos_ao_agente_da_tarefa();

-- Menção num comentário (a nota interna não vai a agente).
CREATE FUNCTION public.avisos_ao_agente_da_mencao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.agente_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.comentarios_de_tarefa k
         WHERE k.id = NEW.comentario_id AND k.empresa_id = NEW.empresa_id AND k.tipo = 'comentario') THEN
      PERFORM public.gravar_aviso_ao_agente(NEW.empresa_id, NEW.agente_id, 'agente.mencionado',
        jsonb_build_object('tipo', 'tarefa', 'id', NEW.tarefa_id, 'tarefaId', NEW.tarefa_id));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_ao_agente_da_mencao AFTER INSERT ON public.mencoes_de_comentario
  FOR EACH ROW EXECUTE FUNCTION public.avisos_ao_agente_da_mencao();

CREATE FUNCTION public.avisos_ao_agente_da_aprovacao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.situacao IS DISTINCT FROM OLD.situacao AND OLD.situacao = 'pendente' THEN
      PERFORM public.gravar_aviso_ao_agente(NEW.empresa_id, NEW.agente_id, 'agente.aprovacao_respondida',
        jsonb_build_object('tipo', 'aprovacao', 'id', NEW.id, 'tarefaId', NEW.tarefa_id, 'status', NEW.situacao));
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_ao_agente_da_aprovacao AFTER UPDATE OF situacao ON public.aprovacoes
  FOR EACH ROW EXECUTE FUNCTION public.avisos_ao_agente_da_aprovacao();

-- Down Migration

DROP TRIGGER avisos_ao_agente_da_aprovacao ON public.aprovacoes;
DROP FUNCTION public.avisos_ao_agente_da_aprovacao();
DROP TRIGGER avisos_ao_agente_da_mencao ON public.mencoes_de_comentario;
DROP FUNCTION public.avisos_ao_agente_da_mencao();
DROP TRIGGER avisos_ao_agente_da_tarefa ON public.tarefas;
DROP FUNCTION public.avisos_ao_agente_da_tarefa();
DROP FUNCTION public.gravar_aviso_ao_agente(uuid, uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.gravar_aviso_de_webhook(empresa uuid, qual text, dados jsonb) RETURNS void
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
DELETE FROM public.webhooks WHERE agente_id IS NOT NULL;
ALTER TABLE public.entregas_de_webhook DROP CONSTRAINT entregas_de_webhook_evento_check;
ALTER TABLE public.entregas_de_webhook ADD CONSTRAINT entregas_de_webhook_evento_check
  CHECK (evento ~ '^[a-z]+\.[a-z]+$');
ALTER TABLE public.webhooks DROP CONSTRAINT webhooks_eventos_check;
ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_eventos_check CHECK (cardinality(eventos) >= 1 AND eventos <@
  ARRAY['tarefa.criada', 'tarefa.atualizada', 'tarefa.concluida', 'tarefa.comentada', 'contato.criado',
    'contato.atualizado', 'aprovacao.pedida', 'aprovacao.respondida']::text[]);
DROP INDEX public.webhooks_um_por_agente;
ALTER TABLE public.webhooks DROP CONSTRAINT webhooks_do_agente;
ALTER TABLE public.webhooks DROP COLUMN agente_id;
