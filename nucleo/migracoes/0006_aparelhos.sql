-- M1-08: sessões e aparelhos.
--
-- 1. Cada aparelho ganha uma etiqueta (cookie de longa duração). O banco guarda só a impressão digital dela.
-- 2. Cada sessão sabe de que aparelho veio e quando foi usada pela última vez (para a lista e a inatividade).
-- 3. Entrar num aparelho que a pessoa nunca usou gera um aviso, mostrado nos aparelhos conhecidos.
-- Explicado em docs/banco/decisoes.md, seção 12, e na decisão 0013.

-- Up Migration

CREATE TABLE acesso.aparelhos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  etiqueta text NOT NULL,
  nome text NOT NULL,
  primeiro_acesso timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aparelhos_um_por_etiqueta UNIQUE (pessoa_id, etiqueta)
);
COMMENT ON TABLE acesso.aparelhos IS
  'Aparelhos que cada pessoa já usou para entrar, reconhecidos por uma etiqueta guardada num cookie do aparelho.';
COMMENT ON COLUMN acesso.aparelhos.id IS '[sistema] Identificador do aparelho (UUID v7).';
COMMENT ON COLUMN acesso.aparelhos.pessoa_id IS '[sistema] Pessoa que usa o aparelho.';
COMMENT ON COLUMN acesso.aparelhos.etiqueta IS '[sistema] Impressão digital (SHA-256) da etiqueta do aparelho. A etiqueta em si só existe no cookie.';
COMMENT ON COLUMN acesso.aparelhos.nome IS '[pessoal] Nome legível do aparelho (ex.: Chrome no Mac).';
COMMENT ON COLUMN acesso.aparelhos.primeiro_acesso IS '[sistema] Primeira vez que a pessoa entrou por este aparelho.';
COMMENT ON COLUMN acesso.aparelhos.ultimo_acesso IS '[sistema] Última vez que a pessoa entrou por este aparelho.';

ALTER TABLE acesso.sessoes
  ADD COLUMN aparelho_id uuid REFERENCES acesso.aparelhos (id) ON DELETE SET NULL,
  ADD COLUMN ultimo_uso_em timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN acesso.sessoes.aparelho_id IS '[sistema] Aparelho de onde a sessão foi aberta.';
COMMENT ON COLUMN acesso.sessoes.ultimo_uso_em IS '[sistema] Último uso da sessão (atualizado no máximo a cada 5 minutos).';

CREATE TABLE acesso.avisos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('aparelho_novo')),
  aparelho_id uuid REFERENCES acesso.aparelhos (id) ON DELETE SET NULL,
  aparelho_nome text NOT NULL,
  ip text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  respondido_em timestamptz,
  resposta text CHECK (resposta IN ('foi_eu', 'nao_fui_eu'))
);
CREATE INDEX avisos_da_pessoa ON acesso.avisos (pessoa_id) WHERE respondido_em IS NULL;
COMMENT ON TABLE acesso.avisos IS 'Avisos de segurança para a própria pessoa, como um acesso por aparelho novo.';
COMMENT ON COLUMN acesso.avisos.id IS '[sistema] Identificador do aviso (UUID v7).';
COMMENT ON COLUMN acesso.avisos.pessoa_id IS '[sistema] Pessoa avisada.';
COMMENT ON COLUMN acesso.avisos.tipo IS '[sistema] Tipo do aviso: aparelho_novo.';
COMMENT ON COLUMN acesso.avisos.aparelho_id IS '[sistema] Aparelho do acesso avisado.';
COMMENT ON COLUMN acesso.avisos.aparelho_nome IS '[pessoal] Nome do aparelho no momento do aviso.';
COMMENT ON COLUMN acesso.avisos.ip IS '[pessoal] IP do acesso avisado.';
COMMENT ON COLUMN acesso.avisos.criado_em IS '[sistema] Quando o acesso aconteceu.';
COMMENT ON COLUMN acesso.avisos.respondido_em IS '[sistema] Quando a pessoa respondeu ao aviso.';
COMMENT ON COLUMN acesso.avisos.resposta IS '[sistema] foi_eu ou nao_fui_eu (este desconecta o aparelho).';

GRANT SELECT, INSERT, UPDATE, DELETE ON acesso.aparelhos, acesso.avisos TO mago_acesso;

-- Down Migration

DROP TABLE acesso.avisos;
ALTER TABLE acesso.sessoes DROP COLUMN ultimo_uso_em, DROP COLUMN aparelho_id;
DROP TABLE acesso.aparelhos;
