-- M1-11: convite para criar empresa.
--
-- 1. A conta que usa o Mago OS passa a ter tipo (empresa com CNPJ ou pessoa física com CPF), documento, nome legal,
--    fuso, idioma e telefone. As contas criadas antes ficam sem documento.
-- 2. O Dono da plataforma convida o responsável por uma conta nova (nome e e-mail). O convite fica no esquema acesso,
--    com só a impressão digital do código, como os convites de pessoas (0010).
-- 3. Pelo link, o responsável cria a conta e vira administrador. O Dono não entra na conta: vê só a lista.
-- Explicado em docs/banco/decisoes.md, seção 16, e na decisão 0016.

-- Up Migration

ALTER TABLE public.empresas
  ADD COLUMN tipo text CHECK (tipo IN ('pj', 'pf')),
  ADD COLUMN documento text CHECK (documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  ADD COLUMN nome_legal text CHECK (length(trim(nome_legal)) BETWEEN 1 AND 200),
  ADD COLUMN fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (length(fuso_horario) BETWEEN 1 AND 64),
  ADD COLUMN idioma text NOT NULL DEFAULT 'pt-BR' CHECK (idioma ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  ADD COLUMN telefone text CHECK (telefone ~ '^\+?[0-9 ()-]{8,25}$'),
  ADD CONSTRAINT empresas_documento_unico UNIQUE (documento),
  ADD CONSTRAINT empresas_documento_do_tipo CHECK (
    (tipo IS NULL AND documento IS NULL)
    OR (tipo = 'pf' AND length(documento) = 11)
    OR (tipo = 'pj' AND length(documento) = 14));
COMMENT ON COLUMN public.empresas.tipo IS '[empresa] pj: empresa com CNPJ. pf: pessoa física com CPF. Vazio nas contas criadas antes da M1-11.';
COMMENT ON COLUMN public.empresas.documento IS '[pessoal] CNPJ ou CPF, sem pontuação. Um documento, uma conta. O CPF é dado pessoal: aparece mascarado para quem não é administrador nem Dono.';
COMMENT ON COLUMN public.empresas.nome_legal IS '[empresa] Razão social (CNPJ) ou nome completo (CPF).';
COMMENT ON COLUMN public.empresas.fuso_horario IS '[empresa] Fuso horário IANA da conta (ex.: America/Sao_Paulo).';
COMMENT ON COLUMN public.empresas.idioma IS '[empresa] Idioma da conta (ex.: pt-BR).';
COMMENT ON COLUMN public.empresas.telefone IS '[empresa] Telefone de contato da conta (opcional).';

CREATE TABLE acesso.convites_de_empresa (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  email text NOT NULL CHECK (email = lower(trim(email)) AND length(email) <= 254),
  codigo text NOT NULL UNIQUE,
  convidado_por uuid NOT NULL REFERENCES public.pessoas (id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  cancelado_em timestamptz,
  empresa_id uuid REFERENCES public.empresas (id)
);
CREATE INDEX convites_de_empresa_por_email ON acesso.convites_de_empresa (email);
COMMENT ON TABLE acesso.convites_de_empresa IS
  'Convites do Dono para alguém criar uma conta nova no Mago OS. O link vale 7 dias e funciona uma vez só.';
COMMENT ON COLUMN acesso.convites_de_empresa.id IS '[sistema] Identificador do convite (UUID v7).';
COMMENT ON COLUMN acesso.convites_de_empresa.nome IS '[pessoal] Nome do responsável pela conta nova.';
COMMENT ON COLUMN acesso.convites_de_empresa.email IS '[pessoal] E-mail do responsável (vira o login dele).';
COMMENT ON COLUMN acesso.convites_de_empresa.codigo IS '[sensivel] Impressão digital (SHA-256) do código do link. O código em si só existe no e-mail.';
COMMENT ON COLUMN acesso.convites_de_empresa.convidado_por IS '[sistema] Quem convidou (o Dono).';
COMMENT ON COLUMN acesso.convites_de_empresa.criado_em IS '[sistema] Quando o convite foi enviado.';
COMMENT ON COLUMN acesso.convites_de_empresa.expira_em IS '[sistema] Até quando o link vale.';
COMMENT ON COLUMN acesso.convites_de_empresa.usado_em IS '[sistema] Quando a conta foi criada pelo link.';
COMMENT ON COLUMN acesso.convites_de_empresa.cancelado_em IS '[sistema] Quando o convite foi cancelado ou trocado por um novo.';
COMMENT ON COLUMN acesso.convites_de_empresa.empresa_id IS '[sistema] Conta criada pelo convite.';
GRANT SELECT, INSERT, UPDATE ON acesso.convites_de_empresa TO mago_acesso;

-- Lista de contas para o Dono: só o cadastro, nada de dentro. O banco confere que quem pede é o Dono.
CREATE FUNCTION acesso.empresas_da_plataforma(quem uuid)
  RETURNS TABLE (id uuid, nome text, tipo text, documento text, situacao text, criada_em timestamptz, pessoas integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT acesso.e_dono_da_plataforma(quem) THEN
      RAISE EXCEPTION 'Só o Dono da plataforma vê a lista de contas';
    END IF;
    RETURN QUERY
      SELECT e.id, e.nome, e.tipo, e.documento, e.situacao, e.criada_em,
             (SELECT count(*)::integer FROM public.vinculos v WHERE v.empresa_id = e.id AND v.situacao = 'ativo')
        FROM public.empresas e ORDER BY e.criada_em;
  END
  $$;
COMMENT ON FUNCTION acesso.empresas_da_plataforma(uuid) IS 'Contas da plataforma (só o cadastro), para o Dono.';

-- Abrir o link: nome, e-mail, quem convidou e se a pessoa já tem como entrar.
CREATE FUNCTION acesso.abrir_convite_de_empresa(codigo_hash text)
  RETURNS TABLE (nome text, email text, quem_convidou text, tem_conta boolean, valido boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, acesso, pg_temp
  AS $$
    SELECT c.nome, c.email, q.nome,
           EXISTS (SELECT 1 FROM public.pessoas p JOIN acesso.credenciais cr ON cr.pessoa_id = p.id WHERE p.email = c.email),
           (c.usado_em IS NULL AND c.cancelado_em IS NULL AND c.expira_em > now())
      FROM acesso.convites_de_empresa c JOIN public.pessoas q ON q.id = c.convidado_por
     WHERE c.codigo = codigo_hash
  $$;

-- Pessoa do convite (criada se ainda não existe): abrir um link válido prova que o e-mail é dela.
CREATE FUNCTION acesso.pessoa_do_convite_de_empresa(codigo_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, acesso, pg_temp
  AS $$
  DECLARE
    c acesso.convites_de_empresa;
    pessoa uuid;
  BEGIN
    SELECT * INTO c FROM acesso.convites_de_empresa
     WHERE codigo = codigo_hash AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now();
    IF c.id IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.pessoas (nome, email, email_verificado) VALUES (c.nome, c.email, true)
      ON CONFLICT (email) DO NOTHING;
    SELECT id INTO pessoa FROM public.pessoas WHERE email = c.email;
    UPDATE public.pessoas SET email_verificado = true WHERE id = pessoa;
    RETURN pessoa;
  END
  $$;

-- Criar a conta pelo link: o código precisa valer e ser do e-mail da pessoa. Ela vira administradora.
CREATE FUNCTION acesso.criar_empresa_pelo_convite(
  codigo_hash text, pessoa uuid, tipo_da_conta text, documento_da_conta text, nome_legal_da_conta text,
  nome_da_conta text, fuso text, idioma_da_conta text, telefone_da_conta text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, acesso, pg_temp
  AS $$
  DECLARE
    c acesso.convites_de_empresa;
    nova uuid;
  BEGIN
    SELECT * INTO c FROM acesso.convites_de_empresa WHERE codigo = codigo_hash FOR UPDATE;
    IF c.id IS NULL OR c.usado_em IS NOT NULL OR c.cancelado_em IS NOT NULL OR c.expira_em <= now() THEN
      RAISE EXCEPTION 'Convite de empresa: este link expirou ou já foi usado';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pessoas p WHERE p.id = pessoa AND p.email = c.email) THEN
      RAISE EXCEPTION 'Convite de empresa: este convite é de outra pessoa';
    END IF;
    INSERT INTO public.empresas (nome, tipo, documento, nome_legal, fuso_horario, idioma, telefone)
      VALUES (nome_da_conta, tipo_da_conta, documento_da_conta, nome_legal_da_conta, fuso, idioma_da_conta,
              telefone_da_conta)
      RETURNING id INTO nova;
    INSERT INTO public.vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
      VALUES (nova, pessoa, 'administrador', 'ativo', c.criado_em, now());
    UPDATE public.pessoas SET email_verificado = true WHERE id = pessoa;
    UPDATE acesso.convites_de_empresa SET usado_em = now(), empresa_id = nova WHERE id = c.id;
    RETURN nova;
  END
  $$;

REVOKE EXECUTE ON FUNCTION acesso.empresas_da_plataforma(uuid), acesso.abrir_convite_de_empresa(text),
  acesso.pessoa_do_convite_de_empresa(text),
  acesso.criar_empresa_pelo_convite(text, uuid, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acesso.empresas_da_plataforma(uuid), acesso.abrir_convite_de_empresa(text),
  acesso.pessoa_do_convite_de_empresa(text),
  acesso.criar_empresa_pelo_convite(text, uuid, text, text, text, text, text, text, text) TO mago_acesso;

-- Down Migration

DROP FUNCTION acesso.criar_empresa_pelo_convite(text, uuid, text, text, text, text, text, text, text);
DROP FUNCTION acesso.pessoa_do_convite_de_empresa(text);
DROP FUNCTION acesso.abrir_convite_de_empresa(text);
DROP FUNCTION acesso.empresas_da_plataforma(uuid);
DROP TABLE acesso.convites_de_empresa;
ALTER TABLE public.empresas
  DROP CONSTRAINT empresas_documento_do_tipo,
  DROP CONSTRAINT empresas_documento_unico,
  DROP COLUMN telefone,
  DROP COLUMN idioma,
  DROP COLUMN fuso_horario,
  DROP COLUMN nome_legal,
  DROP COLUMN documento,
  DROP COLUMN tipo;
