-- M4-01: contas de IA da empresa no cofre interno (contrato em contratos/src/agentes/contas-de-ia.ts, decisão 0021).
--
-- 1. chaves_de_dados: uma chave de cifra por empresa, guardada cifrada pela chave mestra (que fica fora do banco,
--    no Infisical). O banco sozinho não decifra nada.
-- 2. contas_de_ia: a chave do provedor fica só cifrada (AES-256-GCM com a chave de dados da empresa); o banco guarda
--    também os 4 últimos caracteres, para reconhecer a conta. Nenhuma rota devolve a chave.
-- 3. modelos_de_conta_de_ia: os modelos que o provedor lista, desligados até o administrador liberar.
-- 4. agentes ganham o modelo principal e o reserva, cada um apontando para um modelo de uma conta da mesma empresa.
--    Apagar a conta (ou o modelo) limpa a escolha.
-- Explicado em docs/banco/decisoes.md, seção 32.

-- Up Migration

CREATE TABLE public.chaves_de_dados (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas (id) ON DELETE CASCADE,
  versao_da_mestra integer NOT NULL CHECK (versao_da_mestra >= 1),
  chave_cifrada bytea NOT NULL CHECK (octet_length(chave_cifrada) = 60),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.chaves_de_dados IS
  'Chave de cifra de cada empresa (envelope do cofre), cifrada pela chave mestra que fica fora do banco.';
COMMENT ON COLUMN public.chaves_de_dados.empresa_id IS '[sistema] Empresa dona da chave.';
COMMENT ON COLUMN public.chaves_de_dados.versao_da_mestra IS '[sistema] Versão da chave mestra que cifrou (para a troca da mestra).';
COMMENT ON COLUMN public.chaves_de_dados.chave_cifrada IS '[sensivel] A chave de dados cifrada (número aleatório, texto cifrado e etiqueta do AES-256-GCM).';
COMMENT ON COLUMN public.chaves_de_dados.criada_em IS '[sistema] Quando a chave foi criada.';
COMMENT ON COLUMN public.chaves_de_dados.atualizada_em IS '[sistema] Última vez que foi cifrada de novo (troca da mestra).';

ALTER TABLE public.chaves_de_dados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaves_de_dados FORCE ROW LEVEL SECURITY;
CREATE POLICY chaves_de_dados_da_empresa_ativa ON public.chaves_de_dados
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.contas_de_ia (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  provedor text NOT NULL CHECK (provedor IN ('anthropic', 'compativel_openai')),
  endereco text CHECK (length(endereco) <= 300),
  chave_cifrada bytea NOT NULL CHECK (octet_length(chave_cifrada) BETWEEN 36 AND 430),
  final_da_chave text NOT NULL CHECK (length(final_da_chave) = 4),
  situacao text NOT NULL DEFAULT 'ativa' CHECK (situacao IN ('ativa', 'com_erro')),
  ultimo_erro text CHECK (length(ultimo_erro) BETWEEN 1 AND 300),
  teto_mensal integer CHECK (teto_mensal BETWEEN 0 AND 10000000),
  testada_em timestamptz,
  criada_por uuid NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contas_de_ia_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT contas_de_ia_quem_criou FOREIGN KEY (empresa_id, criada_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT contas_de_ia_endereco_do_provedor CHECK ((provedor = 'compativel_openai') = (endereco IS NOT NULL)),
  CONSTRAINT contas_de_ia_erro_explicado CHECK (situacao = 'ativa' OR ultimo_erro IS NOT NULL)
);
CREATE UNIQUE INDEX contas_de_ia_nome_unico ON public.contas_de_ia (empresa_id, lower(nome));
COMMENT ON TABLE public.contas_de_ia IS
  'Contas de IA da empresa (Anthropic, OpenAI e compatíveis). A chave fica só cifrada e nunca sai pela API.';
COMMENT ON COLUMN public.contas_de_ia.id IS '[sistema] Identificador da conta (UUID v7).';
COMMENT ON COLUMN public.contas_de_ia.empresa_id IS '[sistema] Empresa da conta.';
COMMENT ON COLUMN public.contas_de_ia.nome IS '[empresa] Nome da conta nas telas (ex.: Anthropic da Nolask).';
COMMENT ON COLUMN public.contas_de_ia.provedor IS '[empresa] anthropic ou compativel_openai.';
COMMENT ON COLUMN public.contas_de_ia.endereco IS '[empresa] Endereço da API, só para compativel_openai.';
COMMENT ON COLUMN public.contas_de_ia.chave_cifrada IS '[sensivel] A chave do provedor cifrada com a chave de dados da empresa (AES-256-GCM).';
COMMENT ON COLUMN public.contas_de_ia.final_da_chave IS '[empresa] Os 4 últimos caracteres da chave, para reconhecer a conta.';
COMMENT ON COLUMN public.contas_de_ia.situacao IS '[sistema] ativa ou com_erro (o último teste ou chamada falhou).';
COMMENT ON COLUMN public.contas_de_ia.ultimo_erro IS '[sistema] O que deu errado, em texto curto e sem a chave.';
COMMENT ON COLUMN public.contas_de_ia.teto_mensal IS '[empresa] Teto de gasto por mês em centavos de dólar (conferido na M4-06).';
COMMENT ON COLUMN public.contas_de_ia.testada_em IS '[sistema] Último teste da chave.';
COMMENT ON COLUMN public.contas_de_ia.criada_por IS '[sistema] Quem conectou a conta.';
COMMENT ON COLUMN public.contas_de_ia.criada_em IS '[sistema] Quando a conta foi conectada.';
COMMENT ON COLUMN public.contas_de_ia.atualizada_em IS '[sistema] Última mudança na conta.';

ALTER TABLE public.contas_de_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_de_ia FORCE ROW LEVEL SECURITY;
CREATE POLICY contas_de_ia_da_empresa_ativa ON public.contas_de_ia
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.modelos_de_conta_de_ia (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  conta_id uuid NOT NULL,
  modelo text NOT NULL CHECK (modelo ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$'),
  liberado boolean NOT NULL DEFAULT false,
  sumiu boolean NOT NULL DEFAULT false,
  descoberto_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conta_id, modelo),
  CONSTRAINT modelos_da_conta_da_empresa UNIQUE (empresa_id, conta_id, modelo),
  CONSTRAINT modelos_da_conta FOREIGN KEY (empresa_id, conta_id)
    REFERENCES public.contas_de_ia (empresa_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE public.modelos_de_conta_de_ia IS
  'Modelos que o provedor oferece em cada conta. Chegam desligados; só modelo liberado vai para um agente.';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.empresa_id IS '[sistema] Empresa da conta.';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.conta_id IS '[sistema] Conta de IA.';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.modelo IS '[empresa] Nome do modelo no provedor (ex.: claude-sonnet-5-5).';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.liberado IS '[empresa] O administrador liberou o modelo para os agentes.';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.sumiu IS '[sistema] Saiu da lista do provedor no último teste.';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.descoberto_em IS '[sistema] Quando o modelo apareceu pela primeira vez.';

ALTER TABLE public.modelos_de_conta_de_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modelos_de_conta_de_ia FORCE ROW LEVEL SECURITY;
CREATE POLICY modelos_de_conta_de_ia_da_empresa_ativa ON public.modelos_de_conta_de_ia
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

ALTER TABLE public.agentes
  ADD COLUMN modelo_principal_conta_id uuid,
  ADD COLUMN modelo_principal text,
  ADD COLUMN modelo_reserva_conta_id uuid,
  ADD COLUMN modelo_reserva text,
  ADD CONSTRAINT agentes_modelo_principal FOREIGN KEY (empresa_id, modelo_principal_conta_id, modelo_principal)
    REFERENCES public.modelos_de_conta_de_ia (empresa_id, conta_id, modelo)
    ON DELETE SET NULL (modelo_principal_conta_id, modelo_principal),
  ADD CONSTRAINT agentes_modelo_reserva FOREIGN KEY (empresa_id, modelo_reserva_conta_id, modelo_reserva)
    REFERENCES public.modelos_de_conta_de_ia (empresa_id, conta_id, modelo)
    ON DELETE SET NULL (modelo_reserva_conta_id, modelo_reserva),
  ADD CONSTRAINT agentes_modelo_principal_inteiro
    CHECK ((modelo_principal_conta_id IS NULL) = (modelo_principal IS NULL)),
  ADD CONSTRAINT agentes_modelo_reserva_inteiro
    CHECK ((modelo_reserva_conta_id IS NULL) = (modelo_reserva IS NULL));
COMMENT ON COLUMN public.agentes.modelo_principal_conta_id IS '[empresa] Conta de IA do modelo principal (agentes internos, M4).';
COMMENT ON COLUMN public.agentes.modelo_principal IS '[empresa] Modelo principal do agente.';
COMMENT ON COLUMN public.agentes.modelo_reserva_conta_id IS '[empresa] Conta de IA do modelo reserva (entra se o principal falhar ou chegar no teto).';
COMMENT ON COLUMN public.agentes.modelo_reserva IS '[empresa] Modelo reserva do agente.';

-- Down Migration

ALTER TABLE public.agentes
  DROP CONSTRAINT agentes_modelo_reserva_inteiro,
  DROP CONSTRAINT agentes_modelo_principal_inteiro,
  DROP CONSTRAINT agentes_modelo_reserva,
  DROP CONSTRAINT agentes_modelo_principal,
  DROP COLUMN modelo_reserva,
  DROP COLUMN modelo_reserva_conta_id,
  DROP COLUMN modelo_principal,
  DROP COLUMN modelo_principal_conta_id;
DROP TABLE public.modelos_de_conta_de_ia;
DROP TABLE public.contas_de_ia;
DROP TABLE public.chaves_de_dados;
