-- M3-05: linha do tempo da tarefa: notas internas, menções, editar e apagar comentários, e os acontecimentos.
-- Contrato em contratos/src/tarefas/tarefa.ts.
--
-- 1. O comentário ganha o tipo (comentário ou nota interna, que só as pessoas da empresa veem: a API não entrega aos
--    agentes). Editar e apagar passam a existir (no M2 só se acrescentava): a API só muda o texto e as datas de
--    edição e exclusão; apagado fica sem texto, no mesmo lugar ("comentário apagado").
-- 2. Menções: quem foi mencionado em cada comentário (pessoa ou agente da mesma empresa).
-- 3. Acontecimentos: o que aconteceu na tarefa (status, responsável, prazo...), numa tabela da própria tarefa, para a
--    linha do tempo (a auditoria continua só para o administrador). Detalhes só com ids e valores fixos.
-- Explicado em docs/banco/decisoes.md, seção 25.

-- Up Migration

ALTER TABLE public.comentarios_de_tarefa
  ADD COLUMN tipo text NOT NULL DEFAULT 'comentario' CHECK (tipo IN ('comentario', 'nota_interna')),
  ADD COLUMN editado_em timestamptz,
  ADD COLUMN apagado_em timestamptz,
  ALTER COLUMN texto DROP NOT NULL,
  ADD CONSTRAINT comentarios_apagado_sem_texto CHECK ((texto IS NULL) = (apagado_em IS NOT NULL));
COMMENT ON TABLE public.comentarios_de_tarefa IS
  'Comentários e notas internas das tarefas. Quem escreveu edita em até 15 minutos; apagado fica sem texto.';
COMMENT ON COLUMN public.comentarios_de_tarefa.texto IS
  '[empresa] O comentário, em Markdown simples. Vazio: apagado. Se veio de agente, é mostrado só como texto.';
COMMENT ON COLUMN public.comentarios_de_tarefa.tipo IS '[empresa] comentario ou nota_interna (só as pessoas da empresa veem).';
COMMENT ON COLUMN public.comentarios_de_tarefa.editado_em IS '[sistema] Quando o texto foi editado pela última vez.';
COMMENT ON COLUMN public.comentarios_de_tarefa.apagado_em IS '[sistema] Quando foi apagado (o texto sai, o lugar fica).';
-- A API passa a editar e apagar, mas só o texto e as datas (o autor, o tipo e a tarefa não mudam).
GRANT UPDATE (texto, editado_em, apagado_em) ON public.comentarios_de_tarefa TO mago_app;

CREATE TABLE public.mencoes_de_comentario (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  comentario_id uuid NOT NULL REFERENCES public.comentarios_de_tarefa (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  pessoa_id uuid,
  agente_id uuid,
  CONSTRAINT mencoes_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT mencoes_pessoa_da_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT mencoes_agente_da_empresa FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT mencoes_um_so CHECK (num_nonnulls(pessoa_id, agente_id) = 1)
);
CREATE UNIQUE INDEX mencoes_pessoa_uma_vez ON public.mencoes_de_comentario (comentario_id, pessoa_id) WHERE pessoa_id IS NOT NULL;
CREATE UNIQUE INDEX mencoes_agente_uma_vez ON public.mencoes_de_comentario (comentario_id, agente_id) WHERE agente_id IS NOT NULL;
CREATE INDEX mencoes_por_agente ON public.mencoes_de_comentario (empresa_id, agente_id) WHERE agente_id IS NOT NULL;
CREATE INDEX mencoes_por_pessoa ON public.mencoes_de_comentario (empresa_id, pessoa_id) WHERE pessoa_id IS NOT NULL;
COMMENT ON TABLE public.mencoes_de_comentario IS 'Quem foi mencionado com @ em cada comentário (pessoa ou agente da empresa).';
COMMENT ON COLUMN public.mencoes_de_comentario.id IS '[sistema] Identificador da menção (UUID v7).';
COMMENT ON COLUMN public.mencoes_de_comentario.empresa_id IS '[sistema] Empresa (a mesma da tarefa).';
COMMENT ON COLUMN public.mencoes_de_comentario.comentario_id IS '[sistema] Comentário em que a menção foi feita.';
COMMENT ON COLUMN public.mencoes_de_comentario.tarefa_id IS '[sistema] Tarefa do comentário.';
COMMENT ON COLUMN public.mencoes_de_comentario.pessoa_id IS '[sistema] Pessoa mencionada.';
COMMENT ON COLUMN public.mencoes_de_comentario.agente_id IS '[sistema] Agente mencionado.';

ALTER TABLE public.mencoes_de_comentario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mencoes_de_comentario FORCE ROW LEVEL SECURITY;
CREATE POLICY mencoes_da_empresa_ativa ON public.mencoes_de_comentario
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE ON public.mencoes_de_comentario FROM mago_app;

CREATE TABLE public.acontecimentos_de_tarefa (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  autor_pessoa_id uuid,
  autor_agente_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('criou', 'mudou_status', 'trocou_responsavel', 'mudou_prazo', 'mudou_prioridade',
                                     'mudou_projeto', 'mudou_lista', 'entregou_resultado', 'pegou', 'soltou')),
  detalhes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detalhes) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acontecimentos_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT acontecimentos_um_autor CHECK (num_nonnulls(autor_pessoa_id, autor_agente_id) <= 1)
);
CREATE INDEX acontecimentos_por_tarefa ON public.acontecimentos_de_tarefa (empresa_id, tarefa_id, criado_em);
COMMENT ON TABLE public.acontecimentos_de_tarefa IS
  'O que aconteceu em cada tarefa, para a linha do tempo. Só se acrescenta; detalhes com ids e valores fixos, sem texto.';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.id IS '[sistema] Identificador do acontecimento (UUID v7).';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.empresa_id IS '[sistema] Empresa (a mesma da tarefa).';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.tarefa_id IS '[sistema] Tarefa.';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.autor_pessoa_id IS '[sistema] Pessoa que fez. Os dois vazios: o sistema.';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.autor_agente_id IS '[sistema] Agente que fez.';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.tipo IS '[sistema] O que aconteceu (criou, mudou_status, trocou_responsavel...).';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.detalhes IS '[sistema] Ids e valores fixos do acontecimento (de, para...).';
COMMENT ON COLUMN public.acontecimentos_de_tarefa.criado_em IS '[sistema] Quando aconteceu.';

ALTER TABLE public.acontecimentos_de_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acontecimentos_de_tarefa FORCE ROW LEVEL SECURITY;
CREATE POLICY acontecimentos_da_empresa_ativa ON public.acontecimentos_de_tarefa
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE, DELETE ON public.acontecimentos_de_tarefa FROM mago_app;

-- Tempo real: comentário editado ou apagado e acontecimento novo também avisam a tarefa.
DROP TRIGGER comentarios_avisam ON public.comentarios_de_tarefa;
CREATE TRIGGER comentarios_avisam AFTER INSERT OR UPDATE ON public.comentarios_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME IN ('comentarios_de_tarefa', 'itens_de_checklist', 'etiquetas_de_tarefa', 'acontecimentos_de_tarefa') THEN
      tipo := 'tarefa';
      id := linha.tarefa_id;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      tipo := 'tarefa';
      id := linha.id;
    ELSIF TG_TABLE_NAME IN ('membros_de_projeto', 'listas', 'status_de_projeto') THEN
      tipo := 'projeto';
      id := linha.projeto_id;
    ELSIF TG_TABLE_NAME IN ('projetos', 'espacos') THEN
      tipo := 'projeto';
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
CREATE TRIGGER acontecimentos_avisam AFTER INSERT ON public.acontecimentos_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();

-- Down Migration

DROP TRIGGER acontecimentos_avisam ON public.acontecimentos_de_tarefa;
DROP TRIGGER comentarios_avisam ON public.comentarios_de_tarefa;
CREATE TRIGGER comentarios_avisam AFTER INSERT ON public.comentarios_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
DROP TABLE public.acontecimentos_de_tarefa;
DROP TABLE public.mencoes_de_comentario;
REVOKE UPDATE (texto, editado_em, apagado_em) ON public.comentarios_de_tarefa FROM mago_app;
UPDATE public.comentarios_de_tarefa SET texto = '(apagado)' WHERE texto IS NULL;
ALTER TABLE public.comentarios_de_tarefa
  DROP CONSTRAINT comentarios_apagado_sem_texto,
  ALTER COLUMN texto SET NOT NULL,
  DROP COLUMN apagado_em,
  DROP COLUMN editado_em,
  DROP COLUMN tipo;
COMMENT ON TABLE public.comentarios_de_tarefa IS
  'Comentários nas tarefas. Só se acrescentam: não se editam nem se apagam no M2.';
COMMENT ON COLUMN public.comentarios_de_tarefa.texto IS '[empresa] O comentário, em texto simples. Se veio de agente, é mostrado só como texto.';
