-- M1-02: pessoas, vínculos (uma pessoa em várias empresas), papéis na plataforma e a situação da empresa.
--
-- O que muda no isolamento (explicado em docs/banco/decisoes.md, seção 8):
-- 1. Além da empresa ativa, a API informa a pessoa do pedido: set_config('mago.pessoa_id', '<id>', true).
-- 2. Quando há uma pessoa no pedido, empresa_ativa() só devolve a empresa se a pessoa tiver vínculo ativo nela,
--    a pessoa estiver ativa e a empresa também. Se o código errar a empresa, o banco não mostra nada.
-- 3. Nesta tarefa a API só LÊ pessoas, vínculos e papéis. Criar e alterar chega nas tarefas de login e convite
--    (M1-03 e M1-07); até lá, só o dono do banco grava (comando plataforma:iniciar).

-- Up Migration

-- Pessoa do pedido atual, ou nulo (trabalhos do próprio sistema, como a fila, não têm pessoa).
CREATE FUNCTION public.pessoa_ativa() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('mago.pessoa_id', true), '')::uuid $$;
COMMENT ON FUNCTION public.pessoa_ativa() IS
  'Pessoa do pedido atual, informada pela API com set_config(''mago.pessoa_id'', id, true). Nula nos trabalhos do sistema.';
GRANT EXECUTE ON FUNCTION public.pessoa_ativa() TO mago_app;

ALTER TABLE public.empresas
  ADD COLUMN situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'suspensa'));
COMMENT ON COLUMN public.empresas.situacao IS
  '[sistema] ativa: funciona normalmente. suspensa: ninguém da empresa entra e nenhum dado dela aparece.';

CREATE TABLE public.pessoas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  email text NOT NULL CHECK (email = lower(trim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  foto text CHECK (foto ~ '^https://' AND length(foto) <= 2048),
  idioma text NOT NULL DEFAULT 'pt-BR' CHECK (idioma ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (length(fuso_horario) BETWEEN 1 AND 64),
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'bloqueada')),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pessoas_email_unico UNIQUE (email)
);
COMMENT ON TABLE public.pessoas IS
  'Pessoas que fazem login. Um e-mail é uma pessoa só no sistema inteiro; a ligação com cada empresa fica em vinculos. Não tem empresa_id: a pessoa aparece em cada empresa onde tem vínculo.';
COMMENT ON COLUMN public.pessoas.id IS '[sistema] Identificador da pessoa (UUID v7).';
COMMENT ON COLUMN public.pessoas.nome IS '[pessoal] Nome como aparece no sistema.';
COMMENT ON COLUMN public.pessoas.email IS '[pessoal] E-mail de login, em minúsculas e único no sistema.';
COMMENT ON COLUMN public.pessoas.foto IS '[pessoal] Endereço https da foto, quando houver.';
COMMENT ON COLUMN public.pessoas.idioma IS '[pessoal] Idioma preferido (ex.: pt-BR).';
COMMENT ON COLUMN public.pessoas.fuso_horario IS '[pessoal] Fuso horário IANA (ex.: Europe/Lisbon).';
COMMENT ON COLUMN public.pessoas.situacao IS '[sistema] ativa: pode entrar. bloqueada: não entra em nenhuma empresa.';
COMMENT ON COLUMN public.pessoas.criada_em IS '[sistema] Quando a pessoa foi cadastrada.';
COMMENT ON COLUMN public.pessoas.atualizada_em IS '[sistema] Última alteração no cadastro da pessoa.';

CREATE TABLE public.vinculos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  perfil text NOT NULL CHECK (perfil IN ('administrador', 'gestor_area', 'funcionario')),
  area text CHECK (area ~ '^[a-z][a-z0-9_]{1,39}$'),
  situacao text NOT NULL DEFAULT 'convidado' CHECK (situacao IN ('convidado', 'ativo', 'desligado')),
  convidado_em timestamptz NOT NULL DEFAULT now(),
  entrou_em timestamptz,
  desligado_em timestamptz,
  CONSTRAINT vinculos_um_por_empresa UNIQUE (empresa_id, pessoa_id),
  CONSTRAINT vinculos_area_do_gestor CHECK ((perfil = 'gestor_area') = (area IS NOT NULL)),
  CONSTRAINT vinculos_datas_da_situacao CHECK (
    (situacao = 'convidado' AND entrou_em IS NULL AND desligado_em IS NULL)
    OR (situacao = 'ativo' AND entrou_em IS NOT NULL AND desligado_em IS NULL)
    OR (situacao = 'desligado' AND desligado_em IS NOT NULL)
  ),
  CONSTRAINT vinculos_ordem_das_datas CHECK (
    (entrou_em IS NULL OR entrou_em >= convidado_em)
    AND (desligado_em IS NULL OR desligado_em >= coalesce(entrou_em, convidado_em))
  )
);
CREATE INDEX vinculos_da_pessoa ON public.vinculos (pessoa_id, empresa_id);
COMMENT ON TABLE public.vinculos IS
  'Uma pessoa dentro de uma empresa, com perfil e situação. A mesma pessoa tem um vínculo por empresa, cada um com as próprias permissões.';
COMMENT ON COLUMN public.vinculos.id IS '[sistema] Identificador do vínculo (UUID v7).';
COMMENT ON COLUMN public.vinculos.empresa_id IS '[sistema] Empresa do vínculo.';
COMMENT ON COLUMN public.vinculos.pessoa_id IS '[sistema] Pessoa do vínculo.';
COMMENT ON COLUMN public.vinculos.perfil IS '[empresa] administrador, gestor_area ou funcionario.';
COMMENT ON COLUMN public.vinculos.area IS '[empresa] Área que o gestor cuida (ex.: comercial). Só o gestor de área tem.';
COMMENT ON COLUMN public.vinculos.situacao IS '[sistema] convidado: ainda não aceitou. ativo: trabalha na empresa. desligado: perdeu o acesso.';
COMMENT ON COLUMN public.vinculos.convidado_em IS '[sistema] Quando a pessoa foi convidada.';
COMMENT ON COLUMN public.vinculos.entrou_em IS '[sistema] Quando a pessoa aceitou o convite.';
COMMENT ON COLUMN public.vinculos.desligado_em IS '[sistema] Quando a pessoa foi desligada (ou o convite foi cancelado).';

CREATE TABLE public.papeis_plataforma (
  pessoa_id uuid PRIMARY KEY REFERENCES public.pessoas (id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('dono')),
  concedido_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.papeis_plataforma IS
  'Papéis acima das empresas. Na Fase 1 só existe o Dono da plataforma; o revendedor entra na Fase 2. Ter um papel aqui não abre os dados de nenhuma empresa.';
COMMENT ON COLUMN public.papeis_plataforma.pessoa_id IS '[sistema] Pessoa que tem o papel.';
COMMENT ON COLUMN public.papeis_plataforma.papel IS '[sistema] dono: Dono da plataforma.';
COMMENT ON COLUMN public.papeis_plataforma.concedido_em IS '[sistema] Quando o papel foi dado.';

-- Empresa ativa, agora conferida contra o vínculo. SECURITY DEFINER: roda com o dono do banco para poder
-- olhar vínculos e empresas sem depender das políticas abaixo (que, por sua vez, usam esta função).
CREATE OR REPLACE FUNCTION public.empresa_ativa() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.id
      FROM public.empresas e
     WHERE e.id = nullif(current_setting('mago.empresa_id', true), '')::uuid
       AND e.situacao = 'ativa'
       AND (
         public.pessoa_ativa() IS NULL
         OR EXISTS (
           SELECT 1
             FROM public.vinculos v
             JOIN public.pessoas p ON p.id = v.pessoa_id
            WHERE v.empresa_id = e.id
              AND v.pessoa_id = public.pessoa_ativa()
              AND v.situacao = 'ativo'
              AND p.situacao = 'ativa'
         )
       )
  $$;
COMMENT ON FUNCTION public.empresa_ativa() IS
  'Empresa ativa do pedido atual. Nula se nenhuma foi informada, se a empresa está suspensa ou se a pessoa do pedido não tem vínculo ativo nela.';
REVOKE EXECUTE ON FUNCTION public.empresa_ativa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_ativa() TO mago_app;

-- A pessoa vê as próprias empresas (onde tem vínculo ativo) além da empresa ativa: é o que permite escolher.
DROP POLICY empresas_da_empresa_ativa ON public.empresas;
CREATE POLICY empresas_da_empresa_ativa ON public.empresas
  FOR SELECT TO mago_app USING (
    id = public.empresa_ativa()
    OR EXISTS (
      SELECT 1 FROM public.vinculos v
       WHERE v.empresa_id = empresas.id AND v.pessoa_id = public.pessoa_ativa() AND v.situacao = 'ativo'
    )
  );

ALTER TABLE public.pessoas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pessoas FORCE ROW LEVEL SECURITY;
-- A pessoa vê a si mesma e quem tem vínculo com a empresa ativa. Ninguém de outra empresa.
CREATE POLICY pessoas_visiveis ON public.pessoas
  FOR SELECT TO mago_app USING (
    id = public.pessoa_ativa()
    OR EXISTS (
      SELECT 1 FROM public.vinculos v
       WHERE v.pessoa_id = pessoas.id AND v.empresa_id = public.empresa_ativa()
    )
  );

ALTER TABLE public.vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vinculos FORCE ROW LEVEL SECURITY;
-- Os vínculos da empresa ativa, e os da própria pessoa (para ela saber em que empresas está).
CREATE POLICY vinculos_visiveis ON public.vinculos
  FOR SELECT TO mago_app USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa());

ALTER TABLE public.papeis_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.papeis_plataforma FORCE ROW LEVEL SECURITY;
-- Cada pessoa vê só o próprio papel. Uma empresa nunca vê quem são os donos da plataforma.
CREATE POLICY papeis_plataforma_da_propria_pessoa ON public.papeis_plataforma
  FOR SELECT TO mago_app USING (pessoa_id = public.pessoa_ativa());

-- Down Migration

DROP POLICY pessoas_visiveis ON public.pessoas;
DROP POLICY empresas_da_empresa_ativa ON public.empresas;
CREATE OR REPLACE FUNCTION public.empresa_ativa() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
  AS $$ SELECT nullif(current_setting('mago.empresa_id', true), '')::uuid $$;
ALTER FUNCTION public.empresa_ativa() RESET search_path;
COMMENT ON FUNCTION public.empresa_ativa() IS
  'Empresa ativa do pedido atual, informada pela API com set_config(''mago.empresa_id'', id, true). Nulo quando nenhuma foi informada.';
CREATE POLICY empresas_da_empresa_ativa ON public.empresas
  FOR SELECT TO mago_app USING (id = public.empresa_ativa());
DROP TABLE public.papeis_plataforma;
DROP TABLE public.vinculos;
DROP TABLE public.pessoas;
ALTER TABLE public.empresas DROP COLUMN situacao;
DROP FUNCTION public.pessoa_ativa();
