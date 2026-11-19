-- M2-06: tempo real. O próprio banco avisa as cópias da API quando uma tarefa ou um agente muda (LISTEN/NOTIFY),
-- para funcionar com mais de uma cópia e na troca azul e verde, sem estado no servidor.
--
-- O aviso leva só a empresa, o tipo e o id ("a tarefa X mudou"); a tela busca de novo pela rota normal, então a
-- permissão continua valendo. Como o aviso nasce no banco, nenhum caminho (tela, MCP, rotinas) esquece de avisar.
-- Explicado em docs/banco/decisoes.md, seção 19.

-- Up Migration

CREATE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME = 'comentarios_de_tarefa' THEN
      tipo := 'tarefa';
      id := linha.tarefa_id;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      tipo := 'tarefa';
      id := linha.id;
    ELSE
      tipo := 'agente';
      id := linha.id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', tipo, 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;
COMMENT ON FUNCTION public.avisar_mudanca() IS
  'Avisa as cópias da API (canal mago_mudancas) que uma tarefa ou um agente mudou. Leva só empresa, tipo e id.';

CREATE TRIGGER tarefas_avisam AFTER INSERT OR UPDATE OR DELETE ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE TRIGGER comentarios_avisam AFTER INSERT ON public.comentarios_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE TRIGGER agentes_avisam AFTER INSERT OR UPDATE ON public.agentes
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();

-- Down Migration

DROP TRIGGER agentes_avisam ON public.agentes;
DROP TRIGGER comentarios_avisam ON public.comentarios_de_tarefa;
DROP TRIGGER tarefas_avisam ON public.tarefas;
DROP FUNCTION public.avisar_mudanca();
