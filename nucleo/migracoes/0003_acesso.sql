-- M1-03: login por e-mail e senha (Better Auth).
--
-- Como fica (explicado em docs/banco/decisoes.md, seção 9):
-- 1. Senhas, sessões, links de recuperação e travas ficam no esquema "acesso", separado dos dados das empresas.
-- 2. Só o papel mago_acesso (usado pelo Better Auth, dentro da API) mexe nesse esquema. O papel mago_app, que
--    atende os pedidos das empresas, não enxerga nada dele.
-- 3. O mago_acesso lê as pessoas e altera só nome, foto, e-mail verificado e data de alteração. Não vê empresas
--    nem vínculos: a empresa inicial da sessão vem de uma função própria, que devolve só o identificador.

-- Up Migration

-- Papéis valem para o servidor inteiro: só cria se ainda não existir. O EXCEPTION cobre dois bancos de teste
-- criando o papel ao mesmo tempo. A senha (em teste e produção) vem do Infisical, fora das migrações.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mago_acesso') THEN
    CREATE ROLE mago_acesso LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

ALTER TABLE public.pessoas ADD COLUMN email_verificado boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.pessoas.email_verificado IS
  '[sistema] Se o e-mail já foi confirmado (pelo convite, pelo Google ou por um link enviado a ele).';

GRANT USAGE ON SCHEMA public TO mago_acesso;
GRANT SELECT ON public.pessoas TO mago_acesso;
GRANT UPDATE (nome, foto, email_verificado, atualizada_em) ON public.pessoas TO mago_acesso;
-- O login precisa achar a pessoa pelo e-mail antes de saber quem ela é.
CREATE POLICY pessoas_para_o_login ON public.pessoas
  FOR SELECT TO mago_acesso USING (true);
CREATE POLICY pessoas_alteradas_pelo_login ON public.pessoas
  FOR UPDATE TO mago_acesso USING (true) WITH CHECK (true);

CREATE SCHEMA acesso;
COMMENT ON SCHEMA acesso IS 'Login: senhas, sessões, links de recuperação e travas. Só o papel mago_acesso mexe aqui.';
GRANT USAGE ON SCHEMA acesso TO mago_acesso;

CREATE TABLE acesso.credenciais (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  provedor text NOT NULL CHECK (provedor ~ '^[a-z0-9_-]{2,40}$'),
  conta_no_provedor text NOT NULL,
  senha text,
  token_acesso text,
  token_renovacao text,
  token_id text,
  token_acesso_expira_em timestamptz,
  token_renovacao_expira_em timestamptz,
  escopo text,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credenciais_uma_por_conta UNIQUE (provedor, conta_no_provedor)
);
CREATE INDEX credenciais_da_pessoa ON acesso.credenciais (pessoa_id);
COMMENT ON TABLE acesso.credenciais IS
  'Formas de entrar de cada pessoa: senha (provedor "credential") e, a partir do M1-04, Google.';
COMMENT ON COLUMN acesso.credenciais.id IS '[sistema] Identificador da credencial (UUID v7).';
COMMENT ON COLUMN acesso.credenciais.pessoa_id IS '[sistema] Pessoa dona da credencial.';
COMMENT ON COLUMN acesso.credenciais.provedor IS '[sistema] credential (e-mail e senha) ou o nome do provedor, como google.';
COMMENT ON COLUMN acesso.credenciais.conta_no_provedor IS '[pessoal] Identificador da pessoa no provedor.';
COMMENT ON COLUMN acesso.credenciais.senha IS '[sensivel] Senha embaralhada sem volta (scrypt). Nunca a senha em si.';
COMMENT ON COLUMN acesso.credenciais.token_acesso IS '[sensivel] Token de acesso do provedor externo, quando houver.';
COMMENT ON COLUMN acesso.credenciais.token_renovacao IS '[sensivel] Token de renovação do provedor externo, quando houver.';
COMMENT ON COLUMN acesso.credenciais.token_id IS '[sensivel] Token de identidade do provedor externo, quando houver.';
COMMENT ON COLUMN acesso.credenciais.token_acesso_expira_em IS '[sistema] Quando o token de acesso expira.';
COMMENT ON COLUMN acesso.credenciais.token_renovacao_expira_em IS '[sistema] Quando o token de renovação expira.';
COMMENT ON COLUMN acesso.credenciais.escopo IS '[sistema] Permissões pedidas ao provedor externo.';
COMMENT ON COLUMN acesso.credenciais.criada_em IS '[sistema] Quando a credencial foi criada.';
COMMENT ON COLUMN acesso.credenciais.atualizada_em IS '[sistema] Última alteração da credencial.';

CREATE TABLE acesso.sessoes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES public.empresas (id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  ip text,
  navegador text,
  expira_em timestamptz NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessoes_da_pessoa ON acesso.sessoes (pessoa_id);
COMMENT ON TABLE acesso.sessoes IS
  'Aparelhos conectados. Cada linha é uma sessão aberta; apagar a linha desconecta o aparelho na hora.';
COMMENT ON COLUMN acesso.sessoes.id IS '[sistema] Identificador da sessão (UUID v7).';
COMMENT ON COLUMN acesso.sessoes.pessoa_id IS '[sistema] Pessoa da sessão.';
COMMENT ON COLUMN acesso.sessoes.empresa_id IS '[sistema] Empresa ativa nesta sessão (nula enquanto a pessoa não escolhe).';
COMMENT ON COLUMN acesso.sessoes.token IS '[sensivel] Token da sessão, que vai assinado no cookie.';
COMMENT ON COLUMN acesso.sessoes.ip IS '[pessoal] IP de onde a sessão foi aberta.';
COMMENT ON COLUMN acesso.sessoes.navegador IS '[pessoal] Navegador e sistema do aparelho (user agent).';
COMMENT ON COLUMN acesso.sessoes.expira_em IS '[sistema] Quando a sessão deixa de valer.';
COMMENT ON COLUMN acesso.sessoes.criada_em IS '[sistema] Quando a pessoa entrou.';
COMMENT ON COLUMN acesso.sessoes.atualizada_em IS '[sistema] Última renovação da sessão.';

CREATE TABLE acesso.verificacoes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  identificador text NOT NULL,
  valor text NOT NULL,
  expira_em timestamptz NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verificacoes_por_identificador ON acesso.verificacoes (identificador);
COMMENT ON TABLE acesso.verificacoes IS 'Links de uso único (recuperar senha, confirmar e-mail), cada um com validade curta.';
COMMENT ON COLUMN acesso.verificacoes.id IS '[sistema] Identificador do link (UUID v7).';
COMMENT ON COLUMN acesso.verificacoes.identificador IS '[sensivel] Código do link, que só existe no e-mail enviado.';
COMMENT ON COLUMN acesso.verificacoes.valor IS '[sistema] A quem o link se refere (identificador da pessoa).';
COMMENT ON COLUMN acesso.verificacoes.expira_em IS '[sistema] Até quando o link vale.';
COMMENT ON COLUMN acesso.verificacoes.criada_em IS '[sistema] Quando o link foi criado.';
COMMENT ON COLUMN acesso.verificacoes.atualizada_em IS '[sistema] Última alteração do link.';

CREATE TABLE acesso.limites (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  chave text NOT NULL UNIQUE,
  pedidos integer NOT NULL,
  ultimo_pedido bigint NOT NULL
);
COMMENT ON TABLE acesso.limites IS 'Contagem de pedidos por endereço de internet, para limitar tentativas por minuto.';
COMMENT ON COLUMN acesso.limites.id IS '[sistema] Identificador da contagem.';
COMMENT ON COLUMN acesso.limites.chave IS '[pessoal] IP e caminho pedido.';
COMMENT ON COLUMN acesso.limites.pedidos IS '[sistema] Quantos pedidos dentro da janela atual.';
COMMENT ON COLUMN acesso.limites.ultimo_pedido IS '[sistema] Hora do último pedido, em milissegundos.';

CREATE TABLE acesso.travas (
  email text PRIMARY KEY,
  falhas integer NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  ultima_falha timestamptz NOT NULL DEFAULT now(),
  travada_ate timestamptz
);
COMMENT ON TABLE acesso.travas IS
  'Senhas erradas seguidas por e-mail. Na quinta seguida, o e-mail trava por 15 minutos. Vale também para e-mails sem conta, para não revelar quais existem.';
COMMENT ON COLUMN acesso.travas.email IS '[pessoal] E-mail tentado, em minúsculas.';
COMMENT ON COLUMN acesso.travas.falhas IS '[sistema] Senhas erradas seguidas desde o último acerto.';
COMMENT ON COLUMN acesso.travas.ultima_falha IS '[sistema] Quando foi a última senha errada.';
COMMENT ON COLUMN acesso.travas.travada_ate IS '[sistema] Até quando o e-mail fica travado, se estiver.';

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA acesso TO mago_acesso;

-- Empresa inicial de uma sessão nova: a única empresa onde a pessoa tem vínculo ativo, ou nula se forem várias
-- (aí ela escolhe). Roda como dono para o login não precisar enxergar vínculos.
CREATE FUNCTION acesso.empresa_inicial(pessoa uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT CASE WHEN count(*) = 1 THEN min(v.empresa_id::text)::uuid END
      FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
     WHERE v.pessoa_id = pessoa AND v.situacao = 'ativo' AND e.situacao = 'ativa'
  $$;
COMMENT ON FUNCTION acesso.empresa_inicial(uuid) IS
  'Empresa ativa de uma sessão nova: a única com vínculo ativo da pessoa, ou nula se houver mais de uma.';
REVOKE EXECUTE ON FUNCTION acesso.empresa_inicial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acesso.empresa_inicial(uuid) TO mago_acesso;

-- Down Migration

DROP SCHEMA acesso CASCADE;
DROP POLICY pessoas_alteradas_pelo_login ON public.pessoas;
DROP POLICY pessoas_para_o_login ON public.pessoas;
REVOKE ALL ON public.pessoas FROM mago_acesso;
REVOKE USAGE ON SCHEMA public FROM mago_acesso;
ALTER TABLE public.pessoas DROP COLUMN email_verificado;
-- O papel mago_acesso não é apagado: ele vale para o servidor inteiro e pode estar em uso por outro banco.
