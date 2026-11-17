-- M1-05: autenticação em 2 fatores (app autenticador, códigos de recuperação e passkey).
--
-- Como fica (explicado em docs/banco/decisoes.md, seção 10, e na decisão 0011):
-- 1. O segredo do app autenticador e os códigos de recuperação ficam no esquema acesso, criptografados pelo login.
-- 2. As passkeys guardam só a chave pública: quem lê o banco não consegue entrar com elas.
-- 3. Cada sessão registra quando passou pelo segundo fator (dois_fatores_em). A API só libera os dados para quem
--    precisa de 2FA depois disso.
-- 4. 2FA obrigatório: Dono da plataforma, administrador ativo em qualquer empresa e quem está numa empresa que
--    exige de todos. Quem ativou por conta própria também precisa dele a cada login, mas pode desligar.

-- Up Migration

ALTER TABLE public.pessoas ADD COLUMN dois_fatores_ativo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.pessoas.dois_fatores_ativo IS
  '[sistema] Se a pessoa ativou o app autenticador (o código é pedido a cada login, fora dos aparelhos confiáveis).';
GRANT UPDATE (dois_fatores_ativo) ON public.pessoas TO mago_acesso;

ALTER TABLE public.empresas ADD COLUMN exigir_dois_fatores boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.empresas.exigir_dois_fatores IS
  '[empresa] Se o administrador exigiu o 2FA de todas as pessoas da empresa (para administradores ele é sempre obrigatório).';

CREATE TABLE acesso.dois_fatores (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL UNIQUE REFERENCES public.pessoas (id) ON DELETE CASCADE,
  segredo text NOT NULL,
  codigos_recuperacao text NOT NULL,
  verificado boolean NOT NULL DEFAULT false,
  falhas integer NOT NULL DEFAULT 0,
  travado_ate timestamptz
);
COMMENT ON TABLE acesso.dois_fatores IS 'App autenticador de cada pessoa: segredo e códigos de recuperação, criptografados.';
COMMENT ON COLUMN acesso.dois_fatores.id IS '[sistema] Identificador (UUID v7).';
COMMENT ON COLUMN acesso.dois_fatores.pessoa_id IS '[sistema] Pessoa dona do app autenticador.';
COMMENT ON COLUMN acesso.dois_fatores.segredo IS '[sensivel] Segredo do app autenticador, criptografado com o segredo do login.';
COMMENT ON COLUMN acesso.dois_fatores.codigos_recuperacao IS '[sensivel] Os 10 códigos de recuperação de uso único, criptografados.';
COMMENT ON COLUMN acesso.dois_fatores.verificado IS '[sistema] Se a pessoa já confirmou o app com um código (antes disso, o 2FA não vale).';
COMMENT ON COLUMN acesso.dois_fatores.falhas IS '[sistema] Códigos errados seguidos.';
COMMENT ON COLUMN acesso.dois_fatores.travado_ate IS '[sistema] Até quando os códigos ficam travados depois de muitos erros.';

CREATE TABLE acesso.passkeys (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  nome text,
  chave_publica text NOT NULL,
  credencial_id text NOT NULL UNIQUE,
  contador integer NOT NULL DEFAULT 0,
  tipo_aparelho text NOT NULL,
  copia_na_nuvem boolean NOT NULL DEFAULT false,
  transportes text,
  aaguid text,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkeys_da_pessoa ON acesso.passkeys (pessoa_id);
COMMENT ON TABLE acesso.passkeys IS 'Passkeys de cada pessoa (Face ID, Touch ID, digital, chave física). Só a parte pública da chave fica aqui.';
COMMENT ON COLUMN acesso.passkeys.id IS '[sistema] Identificador (UUID v7).';
COMMENT ON COLUMN acesso.passkeys.pessoa_id IS '[sistema] Pessoa dona da passkey.';
COMMENT ON COLUMN acesso.passkeys.nome IS '[pessoal] Nome dado à passkey (ex.: MacBook do Sandro).';
COMMENT ON COLUMN acesso.passkeys.chave_publica IS '[sistema] Chave pública da passkey: confere a assinatura, não serve para entrar.';
COMMENT ON COLUMN acesso.passkeys.credencial_id IS '[sistema] Identificador da passkey no aparelho.';
COMMENT ON COLUMN acesso.passkeys.contador IS '[sistema] Contador de uso, que ajuda a perceber uma passkey copiada.';
COMMENT ON COLUMN acesso.passkeys.tipo_aparelho IS '[sistema] singleDevice (só neste aparelho) ou multiDevice (sincronizada).';
COMMENT ON COLUMN acesso.passkeys.copia_na_nuvem IS '[sistema] Se a passkey tem cópia sincronizada (iCloud, Google).';
COMMENT ON COLUMN acesso.passkeys.transportes IS '[sistema] Como o aparelho se conecta (interno, USB, NFC, Bluetooth).';
COMMENT ON COLUMN acesso.passkeys.aaguid IS '[sistema] Modelo do autenticador (não identifica a pessoa nem o aparelho).';
COMMENT ON COLUMN acesso.passkeys.criada_em IS '[sistema] Quando a passkey foi cadastrada.';

ALTER TABLE acesso.sessoes ADD COLUMN dois_fatores_em timestamptz;
COMMENT ON COLUMN acesso.sessoes.dois_fatores_em IS
  '[sistema] Última vez que esta sessão passou pelo segundo fator (código, código de recuperação ou passkey).';

GRANT SELECT, INSERT, UPDATE, DELETE ON acesso.dois_fatores, acesso.passkeys TO mago_acesso;

-- Se o 2FA é obrigatório para a pessoa (sem poder desligar). Quem ativou por conta própria também precisa dele a
-- cada login, mas pode desligar: isso o login confere à parte. Roda como dono para o login não precisar enxergar
-- empresas e vínculos; devolve só sim ou não.
CREATE FUNCTION acesso.dois_fatores_obrigatorio(pessoa uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.papeis_plataforma WHERE pessoa_id = pessoa)
        OR EXISTS (
             SELECT 1 FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
              WHERE v.pessoa_id = pessoa AND v.situacao = 'ativo' AND e.situacao = 'ativa'
                AND (v.perfil = 'administrador' OR e.exigir_dois_fatores)
           )
  $$;
COMMENT ON FUNCTION acesso.dois_fatores_obrigatorio(uuid) IS
  'Se o 2FA é obrigatório para a pessoa: Dono da plataforma, administrador ativo ou empresa que exige de todos.';
REVOKE EXECUTE ON FUNCTION acesso.dois_fatores_obrigatorio(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acesso.dois_fatores_obrigatorio(uuid) TO mago_acesso;

-- Down Migration

DROP FUNCTION acesso.dois_fatores_obrigatorio(uuid);
ALTER TABLE acesso.sessoes DROP COLUMN dois_fatores_em;
DROP TABLE acesso.passkeys;
DROP TABLE acesso.dois_fatores;
ALTER TABLE public.empresas DROP COLUMN exigir_dois_fatores;
REVOKE UPDATE (dois_fatores_ativo) ON public.pessoas FROM mago_acesso;
ALTER TABLE public.pessoas DROP COLUMN dois_fatores_ativo;
