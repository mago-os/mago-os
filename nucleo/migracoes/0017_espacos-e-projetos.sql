-- M3-01: espaços e projetos, com diretor e gerente (contrato em contratos/src/projetos/projeto.ts).
--
-- 1. Espaço, projeto e membros são da empresa e ficam isolados pelo Row Level Security, como o resto.
-- 2. O diretor é sempre uma pessoa com vínculo na empresa; o gerente, uma pessoa ou um agente da empresa (ou
--    ninguém). Os dois ficam no próprio projeto; a tabela de membros guarda só os membros comuns, e quem é
--    membro (diretor, gerente ou membro comum) é a função membro_do_projeto.
-- 3. A tarefa ganha o projeto, que é opcional ("Sem projeto", decisão do Sandro em 19/11/2026). Projeto com
--    tarefas não se exclui (arquiva-se).
-- 4. Mudou espaço, projeto ou membro: o banco avisa as cópias da API (tempo real, tipo "projeto").
-- Explicado em docs/banco/decisoes.md, seção 21.

-- Up Migration

CREATE TABLE public.espacos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  descricao text CHECK (length(trim(descricao)) BETWEEN 1 AND 5000),
  cor text NOT NULL DEFAULT '#1aa39a' CHECK (cor ~ '^#[0-9a-f]{6}$'),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT espacos_id_da_empresa UNIQUE (empresa_id, id)
);
CREATE INDEX espacos_por_empresa ON public.espacos (empresa_id, situacao, lower(nome));
COMMENT ON TABLE public.espacos IS 'Espaços da empresa: agrupam projetos de uma área ou frente (ex.: Operações).';
COMMENT ON COLUMN public.espacos.id IS '[sistema] Identificador do espaço (UUID v7).';
COMMENT ON COLUMN public.espacos.empresa_id IS '[sistema] Empresa do espaço.';
COMMENT ON COLUMN public.espacos.nome IS '[empresa] Nome do espaço.';
COMMENT ON COLUMN public.espacos.descricao IS '[empresa] Para que serve o espaço.';
COMMENT ON COLUMN public.espacos.cor IS '[empresa] Cor do espaço nas telas (#rrggbb).';
COMMENT ON COLUMN public.espacos.situacao IS '[empresa] ativo ou arquivado (escondido das listas, sem apagar nada).';
COMMENT ON COLUMN public.espacos.criado_em IS '[sistema] Quando o espaço foi criado.';
COMMENT ON COLUMN public.espacos.atualizado_em IS '[sistema] Última mudança no espaço.';

ALTER TABLE public.espacos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.espacos FORCE ROW LEVEL SECURITY;
CREATE POLICY espacos_da_empresa_ativa ON public.espacos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
-- Espaço não se apaga: arquiva-se (os projetos dele continuam guardados).
REVOKE DELETE ON public.espacos FROM mago_app;

CREATE TABLE public.projetos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  espaco_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  descricao text CHECK (length(trim(descricao)) BETWEEN 1 AND 5000),
  cor text NOT NULL DEFAULT '#1aa39a' CHECK (cor ~ '^#[0-9a-f]{6}$'),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  diretor_id uuid NOT NULL,
  gerente_pessoa_id uuid,
  gerente_agente_id uuid,
  gerente_recebe_sem_responsavel boolean NOT NULL DEFAULT false,
  inicio date,
  fim date,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projetos_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT projetos_espaco_da_empresa FOREIGN KEY (empresa_id, espaco_id)
    REFERENCES public.espacos (empresa_id, id),
  CONSTRAINT projetos_diretor_da_empresa FOREIGN KEY (empresa_id, diretor_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT projetos_gerente_pessoa_da_empresa FOREIGN KEY (empresa_id, gerente_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT projetos_gerente_agente_da_empresa FOREIGN KEY (empresa_id, gerente_agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT projetos_um_gerente CHECK (num_nonnulls(gerente_pessoa_id, gerente_agente_id) <= 1),
  CONSTRAINT projetos_diretor_nao_e_gerente CHECK (gerente_pessoa_id IS DISTINCT FROM diretor_id),
  CONSTRAINT projetos_gerente_para_receber CHECK (
    NOT gerente_recebe_sem_responsavel OR num_nonnulls(gerente_pessoa_id, gerente_agente_id) = 1),
  CONSTRAINT projetos_fim_depois_do_inicio CHECK (inicio IS NULL OR fim IS NULL OR fim >= inicio)
);
CREATE INDEX projetos_por_espaco ON public.projetos (empresa_id, espaco_id, situacao);
CREATE INDEX projetos_por_diretor ON public.projetos (empresa_id, diretor_id);
CREATE INDEX projetos_por_gerente_agente ON public.projetos (empresa_id, gerente_agente_id)
  WHERE gerente_agente_id IS NOT NULL;
COMMENT ON TABLE public.projetos IS
  'Projetos de um espaço, com um diretor (pessoa) e, se quiser, um gerente (pessoa ou agente).';
COMMENT ON COLUMN public.projetos.id IS '[sistema] Identificador do projeto (UUID v7).';
COMMENT ON COLUMN public.projetos.empresa_id IS '[sistema] Empresa do projeto.';
COMMENT ON COLUMN public.projetos.espaco_id IS '[sistema] Espaço do projeto (da mesma empresa).';
COMMENT ON COLUMN public.projetos.nome IS '[empresa] Nome do projeto.';
COMMENT ON COLUMN public.projetos.descricao IS '[empresa] Para que serve o projeto.';
COMMENT ON COLUMN public.projetos.cor IS '[empresa] Cor do projeto nas telas (#rrggbb).';
COMMENT ON COLUMN public.projetos.situacao IS '[empresa] ativo ou arquivado (escondido das listas, sem apagar nada).';
COMMENT ON COLUMN public.projetos.diretor_id IS '[sistema] Pessoa diretora do projeto, dona das decisões (com vínculo na empresa).';
COMMENT ON COLUMN public.projetos.gerente_pessoa_id IS '[sistema] Pessoa gerente do projeto, quando é uma pessoa.';
COMMENT ON COLUMN public.projetos.gerente_agente_id IS '[sistema] Agente gerente do projeto, quando é um agente.';
COMMENT ON COLUMN public.projetos.gerente_recebe_sem_responsavel IS '[empresa] O gerente recebe as tarefas do projeto criadas sem responsável.';
COMMENT ON COLUMN public.projetos.inicio IS '[empresa] Dia de início, se houver.';
COMMENT ON COLUMN public.projetos.fim IS '[empresa] Dia de fim previsto, se houver.';
COMMENT ON COLUMN public.projetos.criado_em IS '[sistema] Quando o projeto foi criado.';
COMMENT ON COLUMN public.projetos.atualizado_em IS '[sistema] Última mudança no projeto (inclui membros).';

ALTER TABLE public.projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos FORCE ROW LEVEL SECURITY;
-- Isolados por empresa. Quem vê quais projetos (todos ou só os que é membro) é a verificação central.
CREATE POLICY projetos_da_empresa_ativa ON public.projetos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.membros_de_projeto (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL,
  pessoa_id uuid,
  agente_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membros_do_projeto FOREIGN KEY (empresa_id, projeto_id)
    REFERENCES public.projetos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT membros_pessoa_da_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT membros_agente_da_empresa FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT membros_um_so CHECK (num_nonnulls(pessoa_id, agente_id) = 1)
);
CREATE UNIQUE INDEX membros_pessoa_unica ON public.membros_de_projeto (projeto_id, pessoa_id) WHERE pessoa_id IS NOT NULL;
CREATE UNIQUE INDEX membros_agente_unico ON public.membros_de_projeto (projeto_id, agente_id) WHERE agente_id IS NOT NULL;
CREATE INDEX membros_por_pessoa ON public.membros_de_projeto (empresa_id, pessoa_id) WHERE pessoa_id IS NOT NULL;
COMMENT ON TABLE public.membros_de_projeto IS
  'Membros comuns de cada projeto (pessoas ou agentes). O diretor e o gerente ficam no próprio projeto.';
COMMENT ON COLUMN public.membros_de_projeto.id IS '[sistema] Identificador do membro (UUID v7).';
COMMENT ON COLUMN public.membros_de_projeto.empresa_id IS '[sistema] Empresa (a mesma do projeto).';
COMMENT ON COLUMN public.membros_de_projeto.projeto_id IS '[sistema] Projeto.';
COMMENT ON COLUMN public.membros_de_projeto.pessoa_id IS '[sistema] Pessoa membro, quando é uma pessoa.';
COMMENT ON COLUMN public.membros_de_projeto.agente_id IS '[sistema] Agente membro, quando é um agente.';
COMMENT ON COLUMN public.membros_de_projeto.criado_em IS '[sistema] Quando entrou no projeto.';

ALTER TABLE public.membros_de_projeto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membros_de_projeto FORCE ROW LEVEL SECURITY;
CREATE POLICY membros_da_empresa_ativa ON public.membros_de_projeto
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE ON public.membros_de_projeto FROM mago_app;

-- A pessoa é diretora, gerente ou membro do projeto. Roda com a permissão de quem chama (o RLS continua valendo).
CREATE FUNCTION public.membro_do_projeto(projeto uuid, pessoa uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.projetos p
       WHERE p.id = projeto AND p.empresa_id = public.empresa_ativa()
         AND (p.diretor_id = pessoa OR p.gerente_pessoa_id = pessoa
              OR EXISTS (SELECT 1 FROM public.membros_de_projeto m WHERE m.projeto_id = p.id AND m.pessoa_id = pessoa)))
  $$;
COMMENT ON FUNCTION public.membro_do_projeto(uuid, uuid) IS
  'A pessoa é diretora, gerente ou membro comum do projeto, na empresa ativa.';

ALTER TABLE public.tarefas
  ADD COLUMN projeto_id uuid,
  ADD CONSTRAINT tarefas_projeto_da_empresa FOREIGN KEY (empresa_id, projeto_id)
    REFERENCES public.projetos (empresa_id, id);
CREATE INDEX tarefas_por_projeto ON public.tarefas (empresa_id, projeto_id, atualizada_em DESC)
  WHERE projeto_id IS NOT NULL;
COMMENT ON COLUMN public.tarefas.projeto_id IS '[sistema] Projeto da tarefa. Vazio: "Sem projeto".';
COMMENT ON TABLE public.tarefas IS
  'Tarefas da empresa, feitas por pessoas ou agentes, com ou sem projeto (M3-01). Status fixos no M2.';

CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
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
    ELSIF TG_TABLE_NAME = 'membros_de_projeto' THEN
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
COMMENT ON FUNCTION public.avisar_mudanca() IS
  'Avisa as cópias da API (canal mago_mudancas) que uma tarefa, um agente ou um projeto mudou. Leva só empresa, tipo e id.';

CREATE TRIGGER espacos_avisam AFTER INSERT OR UPDATE ON public.espacos
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE TRIGGER projetos_avisam AFTER INSERT OR UPDATE OR DELETE ON public.projetos
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE TRIGGER membros_avisam AFTER INSERT OR DELETE ON public.membros_de_projeto
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();

-- Down Migration

DROP TRIGGER membros_avisam ON public.membros_de_projeto;
DROP TRIGGER projetos_avisam ON public.projetos;
DROP TRIGGER espacos_avisam ON public.espacos;
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
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
COMMENT ON TABLE public.tarefas IS
  'Tarefas da empresa, feitas por pessoas ou agentes. Status fixos no M2; espaços, projetos e prazos vêm no M3.';
DROP INDEX public.tarefas_por_projeto;
ALTER TABLE public.tarefas DROP CONSTRAINT tarefas_projeto_da_empresa, DROP COLUMN projeto_id;
DROP FUNCTION public.membro_do_projeto(uuid, uuid);
DROP TABLE public.membros_de_projeto;
DROP TABLE public.projetos;
DROP TABLE public.espacos;
