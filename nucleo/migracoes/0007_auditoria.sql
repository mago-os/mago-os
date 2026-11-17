-- M1-09: auditoria à prova de alteração.
--
-- 1. Os eventos ficam no esquema auditoria, numa corrente por empresa (mais uma da plataforma, empresa nula).
--    Cada evento guarda a impressão digital (SHA-256) do anterior: alterar, apagar ou inserir no meio quebra a
--    corrente. O cálculo segue o contrato (contratos/src/auditoria.ts).
-- 2. Ninguém altera nem apaga eventos: a API e o login só gravam pelas funções reservar/gravar e só leem; um
--    gatilho barra UPDATE e DELETE até para o dono (a única exceção é marcar a cópia externa, copiado_em).
-- 3. A cada 5 minutos, os eventos novos são copiados para um depósito travado no Backblaze (fora do alcance de
--    quem administra o sistema), e uma verificação diária confere a corrente e a cópia.
-- Explicado em docs/banco/decisoes.md, seção 13, e na decisão 0014.

-- Up Migration

CREATE SCHEMA auditoria;
COMMENT ON SCHEMA auditoria IS 'Registro encadeado de quem fez o quê. Só acrescenta: ninguém altera nem apaga.';
GRANT USAGE ON SCHEMA auditoria TO mago_app, mago_acesso;

-- Identificador da corrente da plataforma (eventos sem empresa).
CREATE FUNCTION auditoria.corrente_de(empresa uuid) RETURNS uuid
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(empresa, '00000000-0000-0000-0000-000000000000'::uuid) $$;
COMMENT ON FUNCTION auditoria.corrente_de(uuid) IS
  'Corrente de um evento: a da empresa, ou a da plataforma (zeros) quando não há empresa.';

CREATE TABLE auditoria.correntes (
  corrente uuid PRIMARY KEY,
  ultima_sequencia bigint NOT NULL DEFAULT 0,
  ultimo_hash text
);
COMMENT ON TABLE auditoria.correntes IS 'Ponta de cada corrente: a última posição e a última impressão digital.';
COMMENT ON COLUMN auditoria.correntes.corrente IS '[sistema] Empresa da corrente (zeros para a plataforma).';
COMMENT ON COLUMN auditoria.correntes.ultima_sequencia IS '[sistema] Posição do último evento gravado.';
COMMENT ON COLUMN auditoria.correntes.ultimo_hash IS '[sistema] Impressão digital do último evento gravado.';

CREATE TABLE auditoria.eventos (
  id uuid PRIMARY KEY,
  empresa_id uuid REFERENCES public.empresas (id),
  corrente uuid GENERATED ALWAYS AS (auditoria.corrente_de(empresa_id)) STORED,
  sequencia bigint NOT NULL CHECK (sequencia >= 1),
  ator jsonb NOT NULL,
  acao text NOT NULL CHECK (acao ~ '^[a-z][a-z_]{1,39}\.[a-z][a-z_]{1,39}$'),
  alvo jsonb,
  origem jsonb NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  rastreio text,
  detalhes jsonb NOT NULL DEFAULT '{}',
  hash_anterior text,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  copiado_em timestamptz,
  CONSTRAINT eventos_posicao_unica UNIQUE (corrente, sequencia),
  CONSTRAINT eventos_primeiro_sem_anterior CHECK ((sequencia = 1) = (hash_anterior IS NULL))
);
CREATE INDEX eventos_da_empresa ON auditoria.eventos (empresa_id, ocorrido_em DESC);
CREATE INDEX eventos_por_copiar ON auditoria.eventos (corrente, sequencia) WHERE copiado_em IS NULL;
COMMENT ON TABLE auditoria.eventos IS
  'Eventos de auditoria, encadeados por empresa (contrato EventoAuditoria). Só acrescenta.';
COMMENT ON COLUMN auditoria.eventos.id IS '[sistema] Identificador do evento.';
COMMENT ON COLUMN auditoria.eventos.empresa_id IS '[sistema] Empresa do evento (nula: evento da plataforma).';
COMMENT ON COLUMN auditoria.eventos.corrente IS '[sistema] Corrente do evento (a empresa, ou zeros para a plataforma).';
COMMENT ON COLUMN auditoria.eventos.sequencia IS '[sistema] Posição na corrente, começando em 1.';
COMMENT ON COLUMN auditoria.eventos.ator IS '[pessoal] Quem fez: pessoa, agente ou sistema.';
COMMENT ON COLUMN auditoria.eventos.acao IS '[sistema] Ação no formato assunto.verbo (ex.: acesso.entrou).';
COMMENT ON COLUMN auditoria.eventos.alvo IS '[sistema] Item afetado (tipo e identificador).';
COMMENT ON COLUMN auditoria.eventos.origem IS '[pessoal] De onde: canal, IP e aparelho.';
COMMENT ON COLUMN auditoria.eventos.ocorrido_em IS '[sistema] Quando aconteceu.';
COMMENT ON COLUMN auditoria.eventos.rastreio IS '[sistema] Número de rastreio do pedido.';
COMMENT ON COLUMN auditoria.eventos.detalhes IS '[pessoal] Informações extras da ação. Nunca senha, token, código ou dado sensível.';
COMMENT ON COLUMN auditoria.eventos.hash_anterior IS '[sistema] Impressão digital do evento anterior da corrente.';
COMMENT ON COLUMN auditoria.eventos.hash IS '[sistema] Impressão digital (SHA-256) deste evento.';
COMMENT ON COLUMN auditoria.eventos.copiado_em IS '[sistema] Quando o evento foi para a cópia travada no Backblaze.';

-- Ninguém altera nem apaga eventos. A única mudança permitida é marcar a cópia externa (copiado_em, uma vez).
CREATE FUNCTION auditoria.barrar_alteracao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
      RAISE EXCEPTION 'Auditoria: eventos não podem ser apagados';
    END IF;
    -- "corrente" é calculada pelo banco depois deste gatilho (fica nula em NEW aqui); ela deriva de empresa_id.
    IF (to_jsonb(NEW) - 'copiado_em' - 'corrente') IS DISTINCT FROM (to_jsonb(OLD) - 'copiado_em' - 'corrente')
       OR (OLD.copiado_em IS NOT NULL AND NEW.copiado_em IS DISTINCT FROM OLD.copiado_em) THEN
      RAISE EXCEPTION 'Auditoria: eventos não podem ser alterados';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER eventos_so_acrescenta BEFORE UPDATE OR DELETE ON auditoria.eventos
  FOR EACH ROW EXECUTE FUNCTION auditoria.barrar_alteracao();
CREATE TRIGGER eventos_sem_truncate BEFORE TRUNCATE ON auditoria.eventos
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria.barrar_alteracao();

-- Reserva a próxima posição de uma corrente e trava a ponta dela até o fim da transação: dois eventos ao mesmo
-- tempo na mesma corrente entram um depois do outro.
CREATE FUNCTION auditoria.reservar(empresa uuid, OUT sequencia bigint, OUT hash_anterior text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = auditoria, pg_temp
  AS $$
  BEGIN
    INSERT INTO auditoria.correntes (corrente) VALUES (auditoria.corrente_de(empresa)) ON CONFLICT DO NOTHING;
    SELECT c.ultima_sequencia + 1, c.ultimo_hash INTO sequencia, hash_anterior
      FROM auditoria.correntes c WHERE c.corrente = auditoria.corrente_de(empresa) FOR UPDATE;
  END
  $$;

-- Grava o evento já com a impressão digital calculada (no núcleo, pelo contrato). Confere que ele continua a
-- ponta da corrente reservada.
CREATE FUNCTION auditoria.gravar(evento jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = auditoria, pg_temp
  AS $$
  DECLARE
    empresa uuid := nullif(evento->>'empresaId', '')::uuid;
    ponta auditoria.correntes;
  BEGIN
    SELECT * INTO ponta FROM auditoria.correntes WHERE corrente = auditoria.corrente_de(empresa) FOR UPDATE;
    IF ponta IS NULL OR (evento->>'sequencia')::bigint <> ponta.ultima_sequencia + 1
       OR (evento->>'hashAnterior') IS DISTINCT FROM ponta.ultimo_hash THEN
      RAISE EXCEPTION 'Auditoria: o evento não continua a corrente (reserve antes de gravar)';
    END IF;
    INSERT INTO auditoria.eventos (id, empresa_id, sequencia, ator, acao, alvo, origem, ocorrido_em, rastreio,
                                   detalhes, hash_anterior, hash)
    VALUES ((evento->>'id')::uuid, empresa, (evento->>'sequencia')::bigint, evento->'ator', evento->>'acao',
            nullif(evento->'alvo', 'null'::jsonb), evento->'origem', (evento->>'ocorridoEm')::timestamptz,
            evento->>'rastreio', coalesce(evento->'detalhes', '{}'::jsonb), evento->>'hashAnterior',
            evento->>'hash');
    UPDATE auditoria.correntes SET ultima_sequencia = (evento->>'sequencia')::bigint, ultimo_hash = evento->>'hash'
     WHERE corrente = auditoria.corrente_de(empresa);
  END
  $$;
REVOKE EXECUTE ON FUNCTION auditoria.reservar(uuid), auditoria.gravar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auditoria.reservar(uuid), auditoria.gravar(jsonb) TO mago_app, mago_acesso;

-- A API das empresas lê só os eventos da empresa ativa (a consulta do administrador). A corrente da plataforma
-- não aparece para nenhuma empresa.
GRANT SELECT ON auditoria.eventos TO mago_app;
ALTER TABLE auditoria.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria.eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY eventos_da_empresa_ativa ON auditoria.eventos
  FOR SELECT TO mago_app USING (empresa_id = public.empresa_ativa());
-- O dono do banco (cópia e verificação) passa pelo isolamento por ser superusuário; as funções acima também.

-- Down Migration

DROP SCHEMA auditoria CASCADE;
