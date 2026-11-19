-- M3-04: visões salvas das tarefas (contrato em contratos/src/tarefas/visoes.ts).
--
-- A visão é pessoal (decisão 9 do Sandro, 19/11/2026): além do isolamento por empresa, o próprio banco só mostra a
-- cada pessoa as visões dela (pessoa_ativa()). Os filtros ficam em jsonb, conferidos pelo contrato na API.
-- Explicado em docs/banco/decisoes.md, seção 24.

-- Up Migration

CREATE TABLE public.visoes_salvas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  tipo text NOT NULL CHECK (tipo IN ('lista', 'kanban', 'calendario')),
  filtro jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(filtro) = 'object'),
  agrupar_por text CHECK (agrupar_por IN ('status', 'lista', 'responsavel', 'prioridade', 'prazo')),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visoes_da_pessoa_na_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
CREATE INDEX visoes_por_pessoa ON public.visoes_salvas (empresa_id, pessoa_id, lower(nome));
COMMENT ON TABLE public.visoes_salvas IS 'Visões das tarefas salvas por cada pessoa (filtros, tipo e agrupamento). Só a dona vê.';
COMMENT ON COLUMN public.visoes_salvas.id IS '[sistema] Identificador da visão (UUID v7).';
COMMENT ON COLUMN public.visoes_salvas.empresa_id IS '[sistema] Empresa da visão.';
COMMENT ON COLUMN public.visoes_salvas.pessoa_id IS '[sistema] Pessoa dona da visão.';
COMMENT ON COLUMN public.visoes_salvas.nome IS '[pessoal] Nome que a pessoa deu à visão.';
COMMENT ON COLUMN public.visoes_salvas.tipo IS '[pessoal] lista, kanban ou calendario.';
COMMENT ON COLUMN public.visoes_salvas.filtro IS '[pessoal] Filtros das tarefas (contrato FiltroDeTarefas).';
COMMENT ON COLUMN public.visoes_salvas.agrupar_por IS '[pessoal] Como a lista agrupa as tarefas.';
COMMENT ON COLUMN public.visoes_salvas.criada_em IS '[sistema] Quando a visão foi salva.';

ALTER TABLE public.visoes_salvas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visoes_salvas FORCE ROW LEVEL SECURITY;
CREATE POLICY visoes_da_pessoa_ativa ON public.visoes_salvas
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

-- Down Migration

DROP TABLE public.visoes_salvas;
