-- M7-01: contatos (contrato em contratos/src/contatos/contatos.ts, decisão 0045).
-- 1. contatos: pessoas e organizações de fora da empresa, com papéis, responsável, fuso, observações e situação.
-- 2. identificadores_de_contato: e-mails, telefones (formato internacional) e redes; repetidos na empresa só avisam.
-- 3. contatos_em_organizacoes: a pessoa ligada a uma ou mais organizações, com o cargo.
-- 4. etiquetas_de_contato: as mesmas etiquetas da empresa que marcam as tarefas.
-- 5. contatos_de_tarefa e contatos_de_projeto: quem a tarefa ou o projeto cita.
-- 6. visoes_de_contatos: os filtros da lista guardados por cada pessoa.
-- Explicado em docs/banco/decisoes.md, seção 52.

-- Up Migration

CREATE TABLE public.contatos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pessoa', 'organizacao')),
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  papeis text[] NOT NULL DEFAULT '{outro}'
    CHECK (papeis <@ ARRAY['lead', 'cliente', 'fornecedor', 'parceiro', 'outro']::text[]),
  documento text CHECK (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  responsavel_id uuid,
  fuso text CHECK (length(fuso) BETWEEN 1 AND 64),
  observacoes text CHECK (length(observacoes) <= 10000),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado', 'juntado')),
  juntado_em_id uuid,
  criado_por uuid NOT NULL,
  criado_por_agente_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contatos_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT contatos_juntado CHECK ((situacao = 'juntado') = (juntado_em_id IS NOT NULL) AND juntado_em_id IS DISTINCT FROM id),
  -- Quem criou não é chave estrangeira: o contato é da empresa e fica quando a pessoa sai.
  CONSTRAINT contatos_responsavel FOREIGN KEY (empresa_id, responsavel_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (responsavel_id),
  CONSTRAINT contatos_juntado_em FOREIGN KEY (empresa_id, juntado_em_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT contatos_do_agente FOREIGN KEY (empresa_id, criado_por_agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (criado_por_agente_id)
);
CREATE INDEX contatos_por_nome ON public.contatos (empresa_id, lower(nome)) WHERE situacao <> 'juntado';
CREATE INDEX contatos_por_responsavel ON public.contatos (empresa_id, responsavel_id);
CREATE INDEX contatos_busca ON public.contatos USING gin (public.para_busca(nome) public.gin_trgm_ops);
COMMENT ON TABLE public.contatos IS
  'Contatos da empresa (M7-01): pessoas e organizações de fora (clientes, leads, fornecedores, parceiros).';
COMMENT ON COLUMN public.contatos.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.contatos.empresa_id IS '[sistema] Empresa do contato.';
COMMENT ON COLUMN public.contatos.tipo IS '[empresa] pessoa ou organizacao.';
COMMENT ON COLUMN public.contatos.nome IS '[pessoal] Nome da pessoa ou da organização.';
COMMENT ON COLUMN public.contatos.papeis IS '[empresa] lead, cliente, fornecedor, parceiro ou outro (um ou mais).';
COMMENT ON COLUMN public.contatos.documento IS '[pessoal] CPF (11 dígitos) ou CNPJ (14 dígitos), só os números.';
COMMENT ON COLUMN public.contatos.responsavel_id IS '[sistema] A pessoa da equipe que cuida do contato.';
COMMENT ON COLUMN public.contatos.fuso IS '[empresa] Fuso horário do contato (IANA).';
COMMENT ON COLUMN public.contatos.observacoes IS '[pessoal] O que a equipe precisa saber sobre o contato.';
COMMENT ON COLUMN public.contatos.situacao IS '[sistema] ativo, arquivado ou juntado (foi juntado em outro).';
COMMENT ON COLUMN public.contatos.juntado_em_id IS '[sistema] No contato juntado: o contato que ficou.';
COMMENT ON COLUMN public.contatos.criado_por IS '[sistema] Quem cadastrou (pessoa).';
COMMENT ON COLUMN public.contatos.criado_por_agente_id IS '[sistema] O agente que cadastrou pela ferramenta, a pedido de quem criou.';
COMMENT ON COLUMN public.contatos.criado_em IS '[sistema] Quando foi cadastrado.';
COMMENT ON COLUMN public.contatos.atualizado_em IS '[sistema] A última mudança.';
ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contatos FORCE ROW LEVEL SECURITY;
CREATE POLICY contatos_da_empresa_ativa ON public.contatos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.identificadores_de_contato (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  contato_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('email', 'telefone', 'rede')),
  rede text CHECK (rede IN ('instagram', 'linkedin', 'facebook', 'tiktok', 'x', 'youtube', 'site', 'outra')),
  valor text NOT NULL CHECK (length(trim(valor)) BETWEEN 1 AND 300),
  principal boolean NOT NULL DEFAULT false,
  whatsapp boolean NOT NULL DEFAULT false,
  rotulo text CHECK (length(rotulo) <= 40),
  ordem integer NOT NULL DEFAULT 0,
  CONSTRAINT identificadores_do_contato FOREIGN KEY (empresa_id, contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT identificadores_rede CHECK ((tipo = 'rede') = (rede IS NOT NULL)),
  CONSTRAINT identificadores_whatsapp CHECK (tipo = 'telefone' OR (NOT whatsapp AND rotulo IS NULL)),
  CONSTRAINT identificadores_email CHECK (tipo <> 'email' OR (valor = lower(valor) AND valor ~ '^[^\s@]+@[^\s@]+$')),
  CONSTRAINT identificadores_telefone CHECK (tipo <> 'telefone' OR valor ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE UNIQUE INDEX identificadores_um_por_contato
  ON public.identificadores_de_contato (contato_id, tipo, coalesce(rede, ''), lower(valor));
CREATE UNIQUE INDEX identificadores_um_principal
  ON public.identificadores_de_contato (contato_id, tipo) WHERE principal AND tipo IN ('email', 'telefone');
CREATE INDEX identificadores_repetidos ON public.identificadores_de_contato (empresa_id, tipo, lower(valor));
CREATE INDEX identificadores_busca
  ON public.identificadores_de_contato USING gin (public.para_busca(valor) public.gin_trgm_ops);
COMMENT ON TABLE public.identificadores_de_contato IS
  'E-mails, telefones e redes de cada contato (M7-01). O mesmo valor em outro contato da empresa só avisa.';
COMMENT ON COLUMN public.identificadores_de_contato.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.identificadores_de_contato.empresa_id IS '[sistema] Empresa do contato.';
COMMENT ON COLUMN public.identificadores_de_contato.contato_id IS '[sistema] O contato.';
COMMENT ON COLUMN public.identificadores_de_contato.tipo IS '[sistema] email, telefone ou rede.';
COMMENT ON COLUMN public.identificadores_de_contato.rede IS '[sistema] Na rede: qual (instagram, linkedin, site...).';
COMMENT ON COLUMN public.identificadores_de_contato.valor IS
  '[pessoal] O e-mail (minúsculas), o telefone (+ e código do país) ou o @ ou endereço do perfil.';
COMMENT ON COLUMN public.identificadores_de_contato.principal IS '[empresa] O e-mail ou o telefone principal.';
COMMENT ON COLUMN public.identificadores_de_contato.whatsapp IS '[empresa] No telefone: tem WhatsApp.';
COMMENT ON COLUMN public.identificadores_de_contato.rotulo IS '[empresa] No telefone: de onde é (celular, recepção).';
COMMENT ON COLUMN public.identificadores_de_contato.ordem IS '[sistema] Posição na ficha.';
ALTER TABLE public.identificadores_de_contato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identificadores_de_contato FORCE ROW LEVEL SECURITY;
CREATE POLICY identificadores_de_contato_da_empresa_ativa ON public.identificadores_de_contato
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.contatos_em_organizacoes (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  organizacao_id uuid NOT NULL,
  cargo text CHECK (length(cargo) <= 120),
  ordem integer NOT NULL DEFAULT 0,
  PRIMARY KEY (pessoa_id, organizacao_id),
  CONSTRAINT contatos_em_organizacoes_diferentes CHECK (pessoa_id <> organizacao_id),
  CONSTRAINT contatos_em_organizacoes_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT contatos_em_organizacoes_organizacao FOREIGN KEY (empresa_id, organizacao_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX contatos_em_organizacoes_por_organizacao ON public.contatos_em_organizacoes (empresa_id, organizacao_id);
COMMENT ON TABLE public.contatos_em_organizacoes IS 'A pessoa (contato) ligada a uma organização (contato), com o cargo.';
COMMENT ON COLUMN public.contatos_em_organizacoes.empresa_id IS '[sistema] Empresa dos dois contatos.';
COMMENT ON COLUMN public.contatos_em_organizacoes.pessoa_id IS '[sistema] O contato do tipo pessoa.';
COMMENT ON COLUMN public.contatos_em_organizacoes.organizacao_id IS '[sistema] O contato do tipo organização.';
COMMENT ON COLUMN public.contatos_em_organizacoes.cargo IS '[pessoal] O cargo da pessoa na organização.';
COMMENT ON COLUMN public.contatos_em_organizacoes.ordem IS '[sistema] Posição na ficha (a primeira aparece na lista).';
ALTER TABLE public.contatos_em_organizacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contatos_em_organizacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY contatos_em_organizacoes_da_empresa_ativa ON public.contatos_em_organizacoes
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Só pessoa se liga a organização (os tipos ficam nos contatos; o gatilho confere na hora de ligar e de mudar o tipo).
CREATE FUNCTION public.conferir_contato_em_organizacao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.contatos WHERE id = NEW.pessoa_id AND tipo = 'pessoa')
       OR NOT EXISTS (SELECT 1 FROM public.contatos WHERE id = NEW.organizacao_id AND tipo = 'organizacao') THEN
      RAISE EXCEPTION 'só uma pessoa se liga a uma organização' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER contatos_em_organizacoes_conferem BEFORE INSERT OR UPDATE ON public.contatos_em_organizacoes
  FOR EACH ROW EXECUTE FUNCTION public.conferir_contato_em_organizacao();

CREATE TABLE public.etiquetas_de_contato (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  contato_id uuid NOT NULL,
  etiqueta_id uuid NOT NULL,
  PRIMARY KEY (contato_id, etiqueta_id),
  CONSTRAINT etiquetas_do_contato FOREIGN KEY (empresa_id, contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT etiquetas_de_contato_da_empresa FOREIGN KEY (empresa_id, etiqueta_id)
    REFERENCES public.etiquetas (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX etiquetas_de_contato_por_etiqueta ON public.etiquetas_de_contato (empresa_id, etiqueta_id);
COMMENT ON TABLE public.etiquetas_de_contato IS 'Quais etiquetas da empresa cada contato tem.';
COMMENT ON COLUMN public.etiquetas_de_contato.empresa_id IS '[sistema] Empresa (a mesma do contato e da etiqueta).';
COMMENT ON COLUMN public.etiquetas_de_contato.contato_id IS '[sistema] Contato.';
COMMENT ON COLUMN public.etiquetas_de_contato.etiqueta_id IS '[sistema] Etiqueta.';
ALTER TABLE public.etiquetas_de_contato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etiquetas_de_contato FORCE ROW LEVEL SECURITY;
CREATE POLICY etiquetas_de_contato_da_empresa_ativa ON public.etiquetas_de_contato
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.contatos_de_tarefa (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  contato_id uuid NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tarefa_id, contato_id),
  CONSTRAINT contatos_de_tarefa_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT contatos_de_tarefa_contato FOREIGN KEY (empresa_id, contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX contatos_de_tarefa_por_contato ON public.contatos_de_tarefa (empresa_id, contato_id);
COMMENT ON TABLE public.contatos_de_tarefa IS 'Os contatos que cada tarefa cita (até 20).';
COMMENT ON COLUMN public.contatos_de_tarefa.empresa_id IS '[sistema] Empresa (a mesma da tarefa e do contato).';
COMMENT ON COLUMN public.contatos_de_tarefa.tarefa_id IS '[sistema] Tarefa.';
COMMENT ON COLUMN public.contatos_de_tarefa.contato_id IS '[sistema] Contato.';
COMMENT ON COLUMN public.contatos_de_tarefa.ordem IS '[sistema] Posição na tarefa.';
ALTER TABLE public.contatos_de_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contatos_de_tarefa FORCE ROW LEVEL SECURITY;
CREATE POLICY contatos_de_tarefa_da_empresa_ativa ON public.contatos_de_tarefa
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.contatos_de_projeto (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL,
  contato_id uuid NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  PRIMARY KEY (projeto_id, contato_id),
  CONSTRAINT contatos_de_projeto_projeto FOREIGN KEY (empresa_id, projeto_id)
    REFERENCES public.projetos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT contatos_de_projeto_contato FOREIGN KEY (empresa_id, contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX contatos_de_projeto_por_contato ON public.contatos_de_projeto (empresa_id, contato_id);
COMMENT ON TABLE public.contatos_de_projeto IS
  'Os contatos que cada projeto cita (até 20). O funcionário membro do projeto vê esses contatos.';
COMMENT ON COLUMN public.contatos_de_projeto.empresa_id IS '[sistema] Empresa (a mesma do projeto e do contato).';
COMMENT ON COLUMN public.contatos_de_projeto.projeto_id IS '[sistema] Projeto.';
COMMENT ON COLUMN public.contatos_de_projeto.contato_id IS '[sistema] Contato.';
COMMENT ON COLUMN public.contatos_de_projeto.ordem IS '[sistema] Posição no projeto.';
ALTER TABLE public.contatos_de_projeto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contatos_de_projeto FORCE ROW LEVEL SECURITY;
CREATE POLICY contatos_de_projeto_da_empresa_ativa ON public.contatos_de_projeto
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.visoes_de_contatos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  filtro jsonb NOT NULL CHECK (jsonb_typeof(filtro) = 'object'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visoes_de_contatos_da_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX visoes_de_contatos_nome_unico ON public.visoes_de_contatos (empresa_id, pessoa_id, lower(nome));
COMMENT ON TABLE public.visoes_de_contatos IS 'Visões da lista de contatos salvas por cada pessoa (só dela).';
COMMENT ON COLUMN public.visoes_de_contatos.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.visoes_de_contatos.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.visoes_de_contatos.pessoa_id IS '[sistema] Dona da visão.';
COMMENT ON COLUMN public.visoes_de_contatos.nome IS '[empresa] Nome da visão.';
COMMENT ON COLUMN public.visoes_de_contatos.filtro IS '[empresa] Os filtros (FiltroDeContatos do contrato).';
COMMENT ON COLUMN public.visoes_de_contatos.criada_em IS '[sistema] Quando foi salva.';
ALTER TABLE public.visoes_de_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visoes_de_contatos FORCE ROW LEVEL SECURITY;
CREATE POLICY visoes_de_contatos_da_pessoa_ativa ON public.visoes_de_contatos
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

-- Down Migration

DROP TABLE public.visoes_de_contatos;
DROP TABLE public.contatos_de_projeto;
DROP TABLE public.contatos_de_tarefa;
DROP TABLE public.etiquetas_de_contato;
DROP TABLE public.contatos_em_organizacoes;
DROP FUNCTION public.conferir_contato_em_organizacao();
DROP TABLE public.identificadores_de_contato;
DROP TABLE public.contatos;
