-- M8-11: conversas na API pública, no MCP e nos webhooks (decisão 0060).
-- 1. mensagens_com_contatos.chave_de_api_id: a mensagem que saiu pela API pública (marca na caixa e limite de 60 por
--    hora por chave).
-- 2. Os webhooks da empresa podem escolher os 4 eventos das conversas.
-- 3. Gatilhos em conversas_com_contatos (aberta, passada para uma pessoa, resolvida) e em mensagens_com_contatos
--    (mensagem recebida) gravam a entrega na mesma transação, só com os ids, como os do M7 (0050).
-- Explicado em docs/banco/decisoes.md, seção 65.

-- Up Migration

ALTER TABLE public.mensagens_com_contatos ADD COLUMN chave_de_api_id uuid;
COMMENT ON COLUMN public.mensagens_com_contatos.chave_de_api_id IS
  '[sistema] A chave de API que mandou a mensagem pela API pública (M8-11). Nula: pela caixa, pelo agente ou pelo celular.';
CREATE INDEX mensagens_com_contatos_pela_api ON public.mensagens_com_contatos (empresa_id, chave_de_api_id, recebida_em)
  WHERE chave_de_api_id IS NOT NULL;

ALTER TABLE public.webhooks DROP CONSTRAINT webhooks_eventos_check;
ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_eventos_check CHECK (
  cardinality(eventos) >= 1 AND (
    (agente_id IS NULL AND eventos <@ ARRAY['tarefa.criada', 'tarefa.atualizada', 'tarefa.concluida',
      'tarefa.comentada', 'contato.criado', 'contato.atualizado', 'aprovacao.pedida', 'aprovacao.respondida',
      'conversa.aberta', 'conversa.mensagem_recebida', 'conversa.passada_para_pessoa', 'conversa.resolvida']::text[])
    OR (agente_id IS NOT NULL AND eventos <@ ARRAY['agente.tarefa_recebida', 'agente.mencionado',
      'agente.aprovacao_respondida']::text[])));

-- Aberta, passada para uma pessoa (pelo sistema, pelo agente ou por alguém da equipe) e resolvida. Só os ids e o motivo
-- da passagem (código fixo); o texto do cliente e o resumo nunca vão no aviso.
CREATE FUNCTION public.avisos_de_webhook_da_conversa() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    dados jsonb;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.webhooks w WHERE w.empresa_id = NEW.empresa_id AND w.situacao = 'ligado'
                    AND w.agente_id IS NULL) THEN
      RETURN NULL;
    END IF;
    dados := jsonb_build_object('tipo', 'conversa', 'id', NEW.id, 'canalId', NEW.canal_id, 'contatoId', NEW.contato_id);
    IF TG_OP = 'INSERT' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'conversa.aberta', dados);
      RETURN NULL;
    END IF;
    IF NEW.passada_em IS NOT NULL AND OLD.passada_em IS NULL THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'conversa.passada_para_pessoa',
        dados || jsonb_build_object('motivo', coalesce(NEW.motivo_da_passagem, 'passada'), 'donoId', NEW.dono_id));
    ELSIF NEW.dono_id IS NOT NULL AND NEW.dono_id IS DISTINCT FROM OLD.dono_id THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'conversa.passada_para_pessoa',
        dados || jsonb_build_object('motivo', 'atribuida', 'donoId', NEW.dono_id));
    END IF;
    IF NEW.situacao = 'resolvida' AND OLD.situacao IS DISTINCT FROM 'resolvida' THEN
      PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'conversa.resolvida', dados);
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_de_webhook_da_conversa AFTER INSERT OR UPDATE OF situacao, dono_id, passada_em
  ON public.conversas_com_contatos FOR EACH ROW EXECUTE FUNCTION public.avisos_de_webhook_da_conversa();

-- Só o que chegou do contato (o que sai foi o próprio sistema que fez).
CREATE FUNCTION public.avisos_de_webhook_da_mensagem_com_contato() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.direcao <> 'chegou' OR NOT EXISTS (SELECT 1 FROM public.webhooks w WHERE w.empresa_id = NEW.empresa_id
                                                AND w.situacao = 'ligado' AND w.agente_id IS NULL) THEN
      RETURN NULL;
    END IF;
    PERFORM public.gravar_aviso_de_webhook(NEW.empresa_id, 'conversa.mensagem_recebida',
      jsonb_build_object('tipo', 'mensagem', 'id', NEW.id, 'conversaId', NEW.conversa_id, 'canalId', NEW.canal_id,
                         'contatoId', (SELECT cv.contato_id FROM public.conversas_com_contatos cv
                                        WHERE cv.id = NEW.conversa_id AND cv.empresa_id = NEW.empresa_id),
                         'tipoDaMensagem', NEW.tipo));
    RETURN NULL;
  END
  $$;
CREATE TRIGGER avisos_de_webhook_da_mensagem_com_contato AFTER INSERT ON public.mensagens_com_contatos
  FOR EACH ROW EXECUTE FUNCTION public.avisos_de_webhook_da_mensagem_com_contato();

-- Down Migration

DROP TRIGGER avisos_de_webhook_da_mensagem_com_contato ON public.mensagens_com_contatos;
DROP FUNCTION public.avisos_de_webhook_da_mensagem_com_contato();
DROP TRIGGER avisos_de_webhook_da_conversa ON public.conversas_com_contatos;
DROP FUNCTION public.avisos_de_webhook_da_conversa();
UPDATE public.webhooks SET eventos = ARRAY(SELECT e FROM unnest(eventos) e WHERE e NOT LIKE 'conversa.%')
 WHERE agente_id IS NULL AND eventos && ARRAY['conversa.aberta', 'conversa.mensagem_recebida',
   'conversa.passada_para_pessoa', 'conversa.resolvida']::text[];
DELETE FROM public.webhooks WHERE cardinality(eventos) = 0;
ALTER TABLE public.webhooks DROP CONSTRAINT webhooks_eventos_check;
ALTER TABLE public.webhooks ADD CONSTRAINT webhooks_eventos_check CHECK (
  cardinality(eventos) >= 1 AND (
    (agente_id IS NULL AND eventos <@ ARRAY['tarefa.criada', 'tarefa.atualizada', 'tarefa.concluida',
      'tarefa.comentada', 'contato.criado', 'contato.atualizado', 'aprovacao.pedida', 'aprovacao.respondida']::text[])
    OR (agente_id IS NOT NULL AND eventos <@ ARRAY['agente.tarefa_recebida', 'agente.mencionado',
      'agente.aprovacao_respondida']::text[])));
DROP INDEX public.mensagens_com_contatos_pela_api;
ALTER TABLE public.mensagens_com_contatos DROP COLUMN chave_de_api_id;
