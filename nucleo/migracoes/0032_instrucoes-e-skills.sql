-- M4-05: instruções em camadas (empresa, projeto, agente; a da plataforma fica no código) e a biblioteca de skills da
-- empresa (as da plataforma ficam no código), com versões e atribuição por agente. Contrato em
-- contratos/src/agentes/instrucoes.ts, decisão 0027. Explicado em docs/banco/decisoes.md, seção 37.

-- Up Migration

CREATE TABLE public.versoes_de_instrucoes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  camada text NOT NULL CHECK (camada IN ('empresa', 'projeto', 'agente')),
  projeto_id uuid,
  agente_id uuid,
  versao integer NOT NULL CHECK (versao >= 1),
  texto text NOT NULL CHECK (length(texto) <= 20000),
  autor_id uuid,
  voltou_de integer CHECK (voltou_de >= 1),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instrucoes_do_projeto FOREIGN KEY (empresa_id, projeto_id) REFERENCES public.projetos (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT instrucoes_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT instrucoes_autor FOREIGN KEY (empresa_id, autor_id) REFERENCES public.vinculos (empresa_id, pessoa_id)
    ON DELETE SET NULL (autor_id),
  CONSTRAINT instrucoes_alvo_da_camada CHECK (
    CASE camada
      WHEN 'empresa' THEN projeto_id IS NULL AND agente_id IS NULL
      WHEN 'projeto' THEN projeto_id IS NOT NULL AND agente_id IS NULL
      ELSE agente_id IS NOT NULL AND projeto_id IS NULL
    END
  )
);
CREATE UNIQUE INDEX instrucoes_versao_unica ON public.versoes_de_instrucoes
  (empresa_id, camada, coalesce(projeto_id, agente_id, '00000000-0000-0000-0000-000000000000'::uuid), versao);
COMMENT ON TABLE public.versoes_de_instrucoes IS
  'Versões das instruções de cada camada (empresa, projeto, agente). A mais nova vale; nada é apagado.';
COMMENT ON COLUMN public.versoes_de_instrucoes.id IS '[sistema] Identificador da versão (UUID v7).';
COMMENT ON COLUMN public.versoes_de_instrucoes.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.versoes_de_instrucoes.camada IS '[sistema] empresa, projeto ou agente.';
COMMENT ON COLUMN public.versoes_de_instrucoes.projeto_id IS '[sistema] Projeto (camada projeto).';
COMMENT ON COLUMN public.versoes_de_instrucoes.agente_id IS '[sistema] Agente (camada agente).';
COMMENT ON COLUMN public.versoes_de_instrucoes.versao IS '[sistema] Número da versão, a partir de 1.';
COMMENT ON COLUMN public.versoes_de_instrucoes.texto IS '[empresa] As instruções (pode ser vazio).';
COMMENT ON COLUMN public.versoes_de_instrucoes.autor_id IS '[sistema] Quem salvou.';
COMMENT ON COLUMN public.versoes_de_instrucoes.voltou_de IS '[sistema] A versão para a qual voltou, se foi uma volta.';
COMMENT ON COLUMN public.versoes_de_instrucoes.criada_em IS '[sistema] Quando foi salva.';
ALTER TABLE public.versoes_de_instrucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.versoes_de_instrucoes FORCE ROW LEVEL SECURITY;
CREATE POLICY versoes_de_instrucoes_da_empresa_ativa ON public.versoes_de_instrucoes
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE, DELETE ON public.versoes_de_instrucoes FROM mago_app;

CREATE TABLE public.skills (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (nome ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(nome) BETWEEN 2 AND 64),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skills_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT skills_nome_unico UNIQUE (empresa_id, nome)
);
COMMENT ON TABLE public.skills IS 'Skills da empresa (as da plataforma ficam no código). O texto fica nas versões.';
COMMENT ON COLUMN public.skills.id IS '[sistema] Identificador da skill (UUID v7).';
COMMENT ON COLUMN public.skills.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.skills.nome IS '[empresa] Nome da skill (minúsculas, números e hífen).';
COMMENT ON COLUMN public.skills.criada_em IS '[sistema] Quando foi criada.';
COMMENT ON COLUMN public.skills.atualizada_em IS '[sistema] Última versão salva ou publicada.';
ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills FORCE ROW LEVEL SECURITY;
CREATE POLICY skills_da_empresa_ativa ON public.skills
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.versoes_de_skills (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  skill_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao >= 1),
  situacao text NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'publicada')),
  descricao text NOT NULL CHECK (length(trim(descricao)) BETWEEN 1 AND 1024),
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 30000),
  autor_id uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  publicada_em timestamptz,
  PRIMARY KEY (skill_id, versao),
  CONSTRAINT versoes_da_skill FOREIGN KEY (empresa_id, skill_id) REFERENCES public.skills (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT versoes_de_skills_autor FOREIGN KEY (empresa_id, autor_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (autor_id),
  CONSTRAINT versoes_de_skills_publicacao CHECK ((situacao = 'publicada') = (publicada_em IS NOT NULL))
);
-- Um rascunho por skill.
CREATE UNIQUE INDEX versoes_de_skills_um_rascunho ON public.versoes_de_skills (skill_id) WHERE situacao = 'rascunho';
COMMENT ON TABLE public.versoes_de_skills IS 'Versões de cada skill: um rascunho no máximo; os agentes recebem a publicada mais nova.';
COMMENT ON COLUMN public.versoes_de_skills.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.versoes_de_skills.skill_id IS '[sistema] Skill.';
COMMENT ON COLUMN public.versoes_de_skills.versao IS '[sistema] Número da versão, a partir de 1.';
COMMENT ON COLUMN public.versoes_de_skills.situacao IS '[sistema] rascunho ou publicada.';
COMMENT ON COLUMN public.versoes_de_skills.descricao IS '[empresa] Quando usar a skill (o agente lê para decidir).';
COMMENT ON COLUMN public.versoes_de_skills.texto IS '[empresa] O SKILL.md (só texto).';
COMMENT ON COLUMN public.versoes_de_skills.autor_id IS '[sistema] Quem escreveu a versão.';
COMMENT ON COLUMN public.versoes_de_skills.criada_em IS '[sistema] Quando a versão foi criada.';
COMMENT ON COLUMN public.versoes_de_skills.publicada_em IS '[sistema] Quando foi publicada.';
ALTER TABLE public.versoes_de_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.versoes_de_skills FORCE ROW LEVEL SECURITY;
CREATE POLICY versoes_de_skills_da_empresa_ativa ON public.versoes_de_skills
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE DELETE ON public.versoes_de_skills FROM mago_app;

CREATE TABLE public.skills_do_agente (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid NOT NULL,
  skill_id uuid,
  skill_da_plataforma text CHECK (skill_da_plataforma ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  atribuida_por uuid,
  atribuida_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skills_do_agente_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT skills_do_agente_skill FOREIGN KEY (empresa_id, skill_id) REFERENCES public.skills (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT skills_do_agente_quem FOREIGN KEY (empresa_id, atribuida_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (atribuida_por),
  CONSTRAINT skills_do_agente_uma_skill CHECK (num_nonnulls(skill_id, skill_da_plataforma) = 1)
);
CREATE UNIQUE INDEX skills_do_agente_unica ON public.skills_do_agente
  (agente_id, coalesce(skill_id::text, 'plataforma:' || skill_da_plataforma));
COMMENT ON TABLE public.skills_do_agente IS 'Quais skills cada agente recebe (da empresa ou da plataforma).';
COMMENT ON COLUMN public.skills_do_agente.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.skills_do_agente.agente_id IS '[sistema] Agente.';
COMMENT ON COLUMN public.skills_do_agente.skill_id IS '[sistema] Skill da empresa.';
COMMENT ON COLUMN public.skills_do_agente.skill_da_plataforma IS '[sistema] Nome de uma skill da plataforma (no código).';
COMMENT ON COLUMN public.skills_do_agente.atribuida_por IS '[sistema] Quem atribuiu (vazio: veio com o agente).';
COMMENT ON COLUMN public.skills_do_agente.atribuida_em IS '[sistema] Quando foi atribuída.';
ALTER TABLE public.skills_do_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills_do_agente FORCE ROW LEVEL SECURITY;
CREATE POLICY skills_do_agente_da_empresa_ativa ON public.skills_do_agente
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- O Gerente de projetos que já existe ganha a skill da plataforma "planejar-tarefas" (os novos ganham ao nascer).
INSERT INTO public.skills_do_agente (empresa_id, agente_id, skill_da_plataforma)
SELECT empresa_id, id, 'planejar-tarefas' FROM public.agentes
 WHERE tipo = 'interno' AND papel = 'especialista' AND especialidade = 'gerente_de_projetos'
   AND situacao <> 'desligado';

-- Down Migration

DROP TABLE public.skills_do_agente;
DROP TABLE public.versoes_de_skills;
DROP TABLE public.skills;
DROP TABLE public.versoes_de_instrucoes;
