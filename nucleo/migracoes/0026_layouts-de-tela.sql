-- M3-10: layouts de painéis salvos por pessoa (contrato em contratos/src/telas/layouts.ts).
--
-- Pessoal, como as visões salvas (seção 24): além do isolamento por empresa, o próprio banco só mostra a cada pessoa
-- os layouts dela (pessoa_ativa()). A estrutura fica em jsonb, conferida pelo contrato e pelo tamanho na API.
-- Explicado em docs/banco/decisoes.md, seção 30.

-- Up Migration

CREATE TABLE public.layouts_de_tela (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  aparelho text NOT NULL CHECK (aparelho IN ('computador', 'celular')),
  estrutura jsonb NOT NULL CHECK (jsonb_typeof(estrutura) = 'object' AND octet_length(estrutura::text) <= 70000),
  usado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT layouts_da_pessoa_na_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX layouts_nome_unico ON public.layouts_de_tela (empresa_id, pessoa_id, aparelho, lower(nome));
COMMENT ON TABLE public.layouts_de_tela IS 'Layouts de painéis salvos por cada pessoa (computador e celular separados). Só a dona vê.';
COMMENT ON COLUMN public.layouts_de_tela.id IS '[sistema] Identificador do layout (UUID v7).';
COMMENT ON COLUMN public.layouts_de_tela.empresa_id IS '[sistema] Empresa do layout.';
COMMENT ON COLUMN public.layouts_de_tela.pessoa_id IS '[sistema] Pessoa dona do layout.';
COMMENT ON COLUMN public.layouts_de_tela.nome IS '[pessoal] Nome que a pessoa deu (ex.: Meu dia).';
COMMENT ON COLUMN public.layouts_de_tela.aparelho IS '[pessoal] computador ou celular.';
COMMENT ON COLUMN public.layouts_de_tela.estrutura IS '[pessoal] Os painéis e a divisão da tela (contrato EstruturaDoLayout).';
COMMENT ON COLUMN public.layouts_de_tela.usado_em IS '[pessoal] Quando foi aberto pela última vez (o último abre sozinho).';
COMMENT ON COLUMN public.layouts_de_tela.criado_em IS '[sistema] Quando foi salvo.';

ALTER TABLE public.layouts_de_tela ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layouts_de_tela FORCE ROW LEVEL SECURITY;
CREATE POLICY layouts_da_pessoa_ativa ON public.layouts_de_tela
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

-- Down Migration

DROP TABLE public.layouts_de_tela;
