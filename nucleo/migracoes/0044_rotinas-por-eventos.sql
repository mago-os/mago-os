-- M5-06: rotinas por eventos do sistema (contrato em contratos/src/rotinas/rotinas.ts, decisão 0040).
-- 1. eventos_para_rotinas: a fila de eventos, gravada pelo próprio banco na mesma transação da mudança (tarefa criada,
--    concluída, mudou de status, precisa de ajuda, comentário e aprovação pedida), só quando a empresa tem uma rotina
--    ligada para aquele evento. O que foi feito por uma rotina (mago.da_rotina) fica marcado e não dispara rotina.
-- 2. rotinas aceita o gatilho por evento e guarda quando foi ligada (eventos de antes não contam).
-- 3. execucoes_de_rotina ganha a origem "evento", o evento e a tarefa que disparou.
-- 4. empresas_com_rotinas_a_cuidar() acha também os eventos esperando.
-- Explicado em docs/banco/decisoes.md, seção 49.

-- Up Migration

ALTER TABLE public.rotinas DROP CONSTRAINT rotinas_gatilho_check;
ALTER TABLE public.rotinas ADD CONSTRAINT rotinas_gatilho_check
  CHECK (jsonb_typeof(gatilho) = 'object' AND gatilho ->> 'tipo' IN ('horario', 'evento'));
ALTER TABLE public.rotinas ADD CONSTRAINT rotinas_proxima_so_no_horario
  CHECK (proxima_em IS NULL OR gatilho ->> 'tipo' = 'horario');
ALTER TABLE public.rotinas ADD COLUMN ligada_em timestamptz;
UPDATE public.rotinas SET ligada_em = atualizada_em WHERE situacao = 'ligada';
COMMENT ON COLUMN public.rotinas.ligada_em IS '[sistema] Quando foi ligada pela última vez (eventos de antes não a disparam).';
CREATE INDEX rotinas_por_evento ON public.rotinas (empresa_id, (gatilho ->> 'evento'))
  WHERE situacao = 'ligada' AND gatilho ->> 'tipo' = 'evento';

CREATE TABLE public.eventos_para_rotinas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  evento text NOT NULL CHECK (evento IN ('tarefa_criada', 'tarefa_concluida', 'tarefa_mudou_status', 'tarefa_atrasada',
    'tarefa_precisa_de_ajuda', 'comentario', 'aprovacao_pedida')),
  tarefa_id uuid NOT NULL,
  comentario_id uuid,
  aprovacao_id uuid,
  prazo_em timestamptz,
  da_rotina boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  cuidado_em timestamptz,
  CONSTRAINT eventos_para_rotinas_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT eventos_para_rotinas_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX eventos_para_rotinas_esperando ON public.eventos_para_rotinas (empresa_id, criado_em)
  WHERE cuidado_em IS NULL;
-- Tarefa atrasada: uma vez por prazo.
CREATE UNIQUE INDEX eventos_para_rotinas_atrasada_uma_vez ON public.eventos_para_rotinas (empresa_id, tarefa_id, prazo_em)
  WHERE evento = 'tarefa_atrasada';
COMMENT ON TABLE public.eventos_para_rotinas IS
  'Fila dos eventos do sistema para as rotinas por evento (M5-06), gravada na mesma transação da mudança. 7 dias.';
COMMENT ON COLUMN public.eventos_para_rotinas.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.eventos_para_rotinas.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.eventos_para_rotinas.evento IS '[sistema] O evento (EVENTOS_DE_ROTINA do contrato).';
COMMENT ON COLUMN public.eventos_para_rotinas.tarefa_id IS '[sistema] A tarefa do evento.';
COMMENT ON COLUMN public.eventos_para_rotinas.comentario_id IS '[sistema] O comentário (no evento de comentário).';
COMMENT ON COLUMN public.eventos_para_rotinas.aprovacao_id IS '[sistema] O pedido de aprovação (no evento de aprovação pedida).';
COMMENT ON COLUMN public.eventos_para_rotinas.prazo_em IS '[sistema] O prazo que passou (na tarefa atrasada).';
COMMENT ON COLUMN public.eventos_para_rotinas.da_rotina IS
  '[sistema] Causado por uma rotina ou pelo agente que ela chamou: não dispara nenhuma rotina.';
COMMENT ON COLUMN public.eventos_para_rotinas.criado_em IS '[sistema] Quando aconteceu.';
COMMENT ON COLUMN public.eventos_para_rotinas.cuidado_em IS '[sistema] Quando a verificação das rotinas olhou o evento.';
ALTER TABLE public.eventos_para_rotinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_para_rotinas FORCE ROW LEVEL SECURITY;
CREATE POLICY eventos_para_rotinas_da_empresa_ativa ON public.eventos_para_rotinas
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Grava o evento só se a empresa tem uma rotina ligada para ele (sem rotina, nada a fazer).
CREATE FUNCTION public.gravar_evento_para_rotinas(
  empresa uuid, qual text, tarefa uuid, comentario uuid DEFAULT NULL, aprovacao uuid DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.rotinas r WHERE r.empresa_id = empresa AND r.situacao = 'ligada'
                AND r.gatilho ->> 'tipo' = 'evento' AND r.gatilho ->> 'evento' = qual) THEN
      INSERT INTO public.eventos_para_rotinas (empresa_id, evento, tarefa_id, comentario_id, aprovacao_id, da_rotina)
      VALUES (empresa, qual, tarefa, comentario, aprovacao, coalesce(current_setting('mago.da_rotina', true), '') = '1');
    END IF;
  END
  $$;
REVOKE EXECUTE ON FUNCTION public.gravar_evento_para_rotinas(uuid, text, uuid, uuid, uuid) FROM PUBLIC;

CREATE FUNCTION public.eventos_da_tarefa_para_rotinas() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.gravar_evento_para_rotinas(NEW.empresa_id, 'tarefa_criada', NEW.id);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.gravar_evento_para_rotinas(NEW.empresa_id, 'tarefa_mudou_status', NEW.id);
      IF NEW.status = 'concluida' THEN
        PERFORM public.gravar_evento_para_rotinas(NEW.empresa_id, 'tarefa_concluida', NEW.id);
      ELSIF NEW.status = 'precisa_de_ajuda' THEN
        PERFORM public.gravar_evento_para_rotinas(NEW.empresa_id, 'tarefa_precisa_de_ajuda', NEW.id);
      END IF;
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE EXECUTE ON FUNCTION public.eventos_da_tarefa_para_rotinas() FROM PUBLIC;
CREATE TRIGGER eventos_da_tarefa_para_rotinas AFTER INSERT OR UPDATE OF status ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.eventos_da_tarefa_para_rotinas();

-- Só comentário (nota interna é só para pessoas e não vai a agente nem a rotina).
CREATE FUNCTION public.eventos_do_comentario_para_rotinas() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.tipo = 'comentario' THEN
      PERFORM public.gravar_evento_para_rotinas(NEW.empresa_id, 'comentario', NEW.tarefa_id, NEW.id);
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE EXECUTE ON FUNCTION public.eventos_do_comentario_para_rotinas() FROM PUBLIC;
CREATE TRIGGER eventos_do_comentario_para_rotinas AFTER INSERT ON public.comentarios_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.eventos_do_comentario_para_rotinas();

CREATE FUNCTION public.eventos_da_aprovacao_para_rotinas() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.tarefa_id IS NOT NULL THEN
      PERFORM public.gravar_evento_para_rotinas(NEW.empresa_id, 'aprovacao_pedida', NEW.tarefa_id, NULL, NEW.id);
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE EXECUTE ON FUNCTION public.eventos_da_aprovacao_para_rotinas() FROM PUBLIC;
CREATE TRIGGER eventos_da_aprovacao_para_rotinas AFTER INSERT ON public.aprovacoes
  FOR EACH ROW EXECUTE FUNCTION public.eventos_da_aprovacao_para_rotinas();

ALTER TABLE public.execucoes_de_rotina DROP CONSTRAINT execucoes_de_rotina_origem_check;
ALTER TABLE public.execucoes_de_rotina ADD CONSTRAINT execucoes_de_rotina_origem_check
  CHECK (origem IN ('horario', 'evento', 'rodar_agora'));
ALTER TABLE public.execucoes_de_rotina
  ADD COLUMN evento text CHECK (evento IN ('tarefa_criada', 'tarefa_concluida', 'tarefa_mudou_status',
    'tarefa_atrasada', 'tarefa_precisa_de_ajuda', 'comentario', 'aprovacao_pedida')),
  ADD COLUMN tarefa_do_evento_id uuid,
  ADD COLUMN evento_id uuid,
  ADD CONSTRAINT execucoes_de_rotina_tarefa_do_evento FOREIGN KEY (empresa_id, tarefa_do_evento_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE SET NULL (tarefa_do_evento_id),
  ADD CONSTRAINT execucoes_de_rotina_evento FOREIGN KEY (empresa_id, evento_id)
    REFERENCES public.eventos_para_rotinas (empresa_id, id) ON DELETE SET NULL (evento_id);
-- A tarefa do evento pode sumir depois (fica nula); o evento fica.
ALTER TABLE public.execucoes_de_rotina ADD CONSTRAINT execucoes_de_rotina_do_evento
  CHECK ((origem = 'evento') = (evento IS NOT NULL));
-- Uma execução por evento e rotina.
CREATE UNIQUE INDEX execucoes_de_rotina_uma_por_evento ON public.execucoes_de_rotina (empresa_id, rotina_id, evento_id)
  WHERE evento_id IS NOT NULL;
COMMENT ON COLUMN public.execucoes_de_rotina.origem IS '[sistema] horario, evento ou rodar_agora.';
COMMENT ON COLUMN public.execucoes_de_rotina.evento IS '[sistema] O evento que disparou (só pela origem evento).';
COMMENT ON COLUMN public.execucoes_de_rotina.tarefa_do_evento_id IS
  '[sistema] A tarefa que disparou (ou a escolhida para o Rodar agora de uma rotina por evento).';
COMMENT ON COLUMN public.execucoes_de_rotina.evento_id IS '[sistema] O evento da fila (para não rodar duas vezes).';

CREATE OR REPLACE FUNCTION public.empresas_com_rotinas_a_cuidar() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT r.empresa_id FROM public.rotinas r WHERE r.situacao = 'ligada' AND r.proxima_em <= now()
    UNION
    SELECT e.empresa_id FROM public.execucoes_de_rotina e WHERE e.situacao IN ('na_fila', 'rodando', 'esperando')
    UNION
    SELECT v.empresa_id FROM public.eventos_para_rotinas v WHERE v.cuidado_em IS NULL
    UNION
    SELECT r.empresa_id FROM public.rotinas r
     WHERE r.situacao = 'ligada' AND r.gatilho ->> 'tipo' = 'evento' AND r.gatilho ->> 'evento' = 'tarefa_atrasada'
  $$;

-- Down Migration

CREATE OR REPLACE FUNCTION public.empresas_com_rotinas_a_cuidar() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT r.empresa_id FROM public.rotinas r WHERE r.situacao = 'ligada' AND r.proxima_em <= now()
    UNION
    SELECT e.empresa_id FROM public.execucoes_de_rotina e WHERE e.situacao IN ('na_fila', 'rodando', 'esperando')
  $$;
DELETE FROM public.execucoes_de_rotina WHERE origem = 'evento';
DROP INDEX public.execucoes_de_rotina_uma_por_evento;
ALTER TABLE public.execucoes_de_rotina DROP CONSTRAINT execucoes_de_rotina_do_evento,
  DROP CONSTRAINT execucoes_de_rotina_evento, DROP CONSTRAINT execucoes_de_rotina_tarefa_do_evento,
  DROP COLUMN evento_id, DROP COLUMN tarefa_do_evento_id, DROP COLUMN evento;
ALTER TABLE public.execucoes_de_rotina DROP CONSTRAINT execucoes_de_rotina_origem_check;
ALTER TABLE public.execucoes_de_rotina ADD CONSTRAINT execucoes_de_rotina_origem_check
  CHECK (origem IN ('horario', 'rodar_agora'));
DROP TRIGGER eventos_da_aprovacao_para_rotinas ON public.aprovacoes;
DROP FUNCTION public.eventos_da_aprovacao_para_rotinas();
DROP TRIGGER eventos_do_comentario_para_rotinas ON public.comentarios_de_tarefa;
DROP FUNCTION public.eventos_do_comentario_para_rotinas();
DROP TRIGGER eventos_da_tarefa_para_rotinas ON public.tarefas;
DROP FUNCTION public.eventos_da_tarefa_para_rotinas();
DROP FUNCTION public.gravar_evento_para_rotinas(uuid, text, uuid, uuid, uuid);
DROP TABLE public.eventos_para_rotinas;
DELETE FROM public.rotinas WHERE gatilho ->> 'tipo' = 'evento';
DROP INDEX public.rotinas_por_evento;
ALTER TABLE public.rotinas DROP COLUMN ligada_em;
ALTER TABLE public.rotinas DROP CONSTRAINT rotinas_proxima_so_no_horario;
ALTER TABLE public.rotinas DROP CONSTRAINT rotinas_gatilho_check;
ALTER TABLE public.rotinas ADD CONSTRAINT rotinas_gatilho_check
  CHECK (jsonb_typeof(gatilho) = 'object' AND gatilho ->> 'tipo' = 'horario');
