-- M0-05: papel da aplicação, regra do isolamento por empresa e a tabela de empresas.
--
-- Como o isolamento funciona (explicado em docs/banco/decisoes.md):
-- 1. A API se conecta com o papel mago_app, que NÃO é dono das tabelas e NÃO pode ignorar o Row Level Security.
-- 2. A cada pedido, a API abre uma transação e informa a empresa ativa: set_config('mago.empresa_id', '<id>', true).
-- 3. Toda tabela com dados de empresa tem a coluna empresa_id e uma política que só mostra as linhas da empresa ativa.
--    Sem empresa informada, nada aparece.

-- Up Migration

-- Papel usado pela API. Papéis valem para o servidor inteiro, então só cria se ainda não existir.
-- A senha (em teste e produção) é definida fora das migrações, a partir do Infisical.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mago_app') THEN
    CREATE ROLE mago_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- A fila (pg-boss) cria e mantém as próprias tabelas neste esquema, separado dos dados de negócio.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mago_app;

-- Ninguém além do dono cria tabelas no esquema public; a API só lê e grava.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mago_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mago_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mago_app;

-- Empresa ativa da transação atual, ou nulo se nenhuma foi informada.
CREATE FUNCTION public.empresa_ativa() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('mago.empresa_id', true), '')::uuid $$;
COMMENT ON FUNCTION public.empresa_ativa() IS
  'Empresa ativa do pedido atual, informada pela API com set_config(''mago.empresa_id'', id, true). Nulo quando nenhuma foi informada.';
GRANT EXECUTE ON FUNCTION public.empresa_ativa() TO mago_app;

CREATE TABLE public.empresas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.empresas IS
  'Empresas que usam o Mago OS. Cada empresa só enxerga a própria linha; todas as outras tabelas de negócio apontam para cá pela coluna empresa_id.';
COMMENT ON COLUMN public.empresas.id IS '[sistema] Identificador da empresa (UUID v7, em ordem de criação).';
COMMENT ON COLUMN public.empresas.nome IS '[empresa] Nome da empresa como aparece no sistema.';
COMMENT ON COLUMN public.empresas.criada_em IS '[sistema] Quando a empresa foi cadastrada.';
COMMENT ON COLUMN public.empresas.atualizada_em IS '[sistema] Última alteração no cadastro da empresa.';

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empresas FORCE ROW LEVEL SECURITY;

-- A empresa ativa vê e altera só a própria linha. Criar e apagar empresas fica com o dono do banco
-- (a criação pela plataforma chega no M1-02), por isso não há política de INSERT nem de DELETE.
CREATE POLICY empresas_da_empresa_ativa ON public.empresas
  FOR SELECT TO mago_app USING (id = public.empresa_ativa());
CREATE POLICY empresas_alterar_a_propria ON public.empresas
  FOR UPDATE TO mago_app USING (id = public.empresa_ativa()) WITH CHECK (id = public.empresa_ativa());

-- Down Migration

DROP TABLE public.empresas;
DROP FUNCTION public.empresa_ativa();
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM mago_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM mago_app;
REVOKE USAGE ON SCHEMA public FROM mago_app;
GRANT CREATE ON SCHEMA public TO PUBLIC;
DROP SCHEMA pgboss CASCADE;
-- O papel mago_app não é apagado: ele vale para o servidor inteiro e pode estar em uso por outro banco.
