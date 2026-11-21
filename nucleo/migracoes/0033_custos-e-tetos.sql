-- M4-06: custo de cada chamada ao modelo e tetos de gasto por mês (contrato em contratos/src/agentes/custos.ts,
-- decisão 0028). Explicado em docs/banco/decisoes.md, seção 38.

-- Up Migration

CREATE TABLE public.consumo_de_ia (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  execucao_id uuid,
  agente_id uuid NOT NULL,
  conta_id uuid,
  modelo text NOT NULL CHECK (length(modelo) BETWEEN 1 AND 120),
  tokens_entrada integer NOT NULL DEFAULT 0 CHECK (tokens_entrada >= 0),
  tokens_saida integer NOT NULL DEFAULT 0 CHECK (tokens_saida >= 0),
  tokens_cache integer NOT NULL DEFAULT 0 CHECK (tokens_cache >= 0),
  custo_micros bigint NOT NULL DEFAULT 0 CHECK (custo_micros >= 0),
  sem_preco boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumo_da_execucao FOREIGN KEY (empresa_id, execucao_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE SET NULL (execucao_id),
  CONSTRAINT consumo_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT consumo_da_conta FOREIGN KEY (empresa_id, conta_id) REFERENCES public.contas_de_ia (empresa_id, id)
    ON DELETE SET NULL (conta_id)
);
CREATE INDEX consumo_por_mes ON public.consumo_de_ia (empresa_id, criado_em);
CREATE INDEX consumo_por_agente ON public.consumo_de_ia (empresa_id, agente_id, criado_em);
CREATE INDEX consumo_por_conta ON public.consumo_de_ia (empresa_id, conta_id, criado_em);
COMMENT ON TABLE public.consumo_de_ia IS 'Cada chamada de um agente interno ao modelo de IA: tokens e custo (M4-06).';
COMMENT ON COLUMN public.consumo_de_ia.id IS '[sistema] Identificador (UUID v7).';
COMMENT ON COLUMN public.consumo_de_ia.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.consumo_de_ia.execucao_id IS '[sistema] Execução do agente.';
COMMENT ON COLUMN public.consumo_de_ia.agente_id IS '[sistema] Agente.';
COMMENT ON COLUMN public.consumo_de_ia.conta_id IS '[sistema] Conta de IA usada.';
COMMENT ON COLUMN public.consumo_de_ia.modelo IS '[sistema] Modelo usado.';
COMMENT ON COLUMN public.consumo_de_ia.tokens_entrada IS '[sistema] Tokens de entrada.';
COMMENT ON COLUMN public.consumo_de_ia.tokens_saida IS '[sistema] Tokens de saída.';
COMMENT ON COLUMN public.consumo_de_ia.tokens_cache IS '[sistema] Tokens lidos do cache.';
COMMENT ON COLUMN public.consumo_de_ia.custo_micros IS '[sistema] Custo em microdólares (zero na assinatura).';
COMMENT ON COLUMN public.consumo_de_ia.sem_preco IS '[sistema] O modelo não tinha preço: o custo usou o maior da tabela.';
COMMENT ON COLUMN public.consumo_de_ia.criado_em IS '[sistema] Quando a chamada terminou.';
ALTER TABLE public.consumo_de_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumo_de_ia FORCE ROW LEVEL SECURITY;
CREATE POLICY consumo_de_ia_da_empresa_ativa ON public.consumo_de_ia
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE, DELETE ON public.consumo_de_ia FROM mago_app;

-- Teto da empresa (agente_id vazio) e de cada agente. Sem linha: vale o padrão (US$ 50 e US$ 20). Teto vazio: sem teto.
CREATE TABLE public.tetos_de_gasto (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid,
  teto integer CHECK (teto BETWEEN 0 AND 10000000),
  mudado_por uuid,
  mudado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tetos_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT tetos_quem_mudou FOREIGN KEY (empresa_id, mudado_por) REFERENCES public.vinculos (empresa_id, pessoa_id)
    ON DELETE SET NULL (mudado_por)
);
CREATE UNIQUE INDEX tetos_um_por_alvo ON public.tetos_de_gasto
  (empresa_id, coalesce(agente_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE public.tetos_de_gasto IS 'Teto de gasto com IA por mês: da empresa (sem agente) e de cada agente.';
COMMENT ON COLUMN public.tetos_de_gasto.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.tetos_de_gasto.agente_id IS '[sistema] Agente; vazio: o teto da empresa.';
COMMENT ON COLUMN public.tetos_de_gasto.teto IS '[empresa] Centavos de dólar por mês; vazio: sem teto.';
COMMENT ON COLUMN public.tetos_de_gasto.mudado_por IS '[sistema] Quem mudou.';
COMMENT ON COLUMN public.tetos_de_gasto.mudado_em IS '[sistema] Quando mudou.';
ALTER TABLE public.tetos_de_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tetos_de_gasto FORCE ROW LEVEL SECURITY;
CREATE POLICY tetos_de_gasto_da_empresa_ativa ON public.tetos_de_gasto
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Os avisos de 80% e 100% já mandados em cada mês (cada um sai uma vez).
CREATE TABLE public.avisos_de_gasto (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  alvo text NOT NULL CHECK (alvo ~ '^(empresa|agente:[0-9a-f-]{36}|conta:[0-9a-f-]{36})$'),
  mes text NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),
  nivel integer NOT NULL CHECK (nivel IN (80, 100)),
  mandado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, alvo, mes, nivel)
);
COMMENT ON TABLE public.avisos_de_gasto IS 'Avisos de teto (80% e 100%) já mandados no mês, para não repetir.';
COMMENT ON COLUMN public.avisos_de_gasto.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.avisos_de_gasto.alvo IS '[sistema] empresa, agente:<id> ou conta:<id>.';
COMMENT ON COLUMN public.avisos_de_gasto.mes IS '[sistema] O mês (AAAA-MM, no fuso da empresa).';
COMMENT ON COLUMN public.avisos_de_gasto.nivel IS '[sistema] 80 ou 100 (%).';
COMMENT ON COLUMN public.avisos_de_gasto.mandado_em IS '[sistema] Quando o aviso saiu.';
ALTER TABLE public.avisos_de_gasto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avisos_de_gasto FORCE ROW LEVEL SECURITY;
CREATE POLICY avisos_de_gasto_da_empresa_ativa ON public.avisos_de_gasto
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- A conta por assinatura: limite em tokens por mês e o que fazer ao chegar nele.
ALTER TABLE public.contas_de_ia
  ADD COLUMN limite_de_tokens bigint CHECK (limite_de_tokens BETWEEN 1000 AND 100000000000),
  ADD COLUMN ao_chegar_no_limite text NOT NULL DEFAULT 'avisar' CHECK (ao_chegar_no_limite IN ('avisar', 'parar')),
  ADD CONSTRAINT contas_limite_de_tokens_so_na_assinatura CHECK (credencial = 'assinatura' OR limite_de_tokens IS NULL);
COMMENT ON COLUMN public.contas_de_ia.limite_de_tokens IS
  '[empresa] Assinatura: tokens por mês a partir dos quais o administrador é avisado (ou a conta para).';
COMMENT ON COLUMN public.contas_de_ia.ao_chegar_no_limite IS '[empresa] avisar (só avisa) ou parar (para aos 100%).';

-- O preço que o administrador dá ao modelo (no lugar da referência). Os três juntos, ou nenhum.
ALTER TABLE public.modelos_de_conta_de_ia
  ADD COLUMN preco_entrada integer CHECK (preco_entrada BETWEEN 0 AND 1000000),
  ADD COLUMN preco_saida integer CHECK (preco_saida BETWEEN 0 AND 1000000),
  ADD COLUMN preco_cache integer CHECK (preco_cache BETWEEN 0 AND 1000000),
  ADD CONSTRAINT modelos_preco_inteiro CHECK (num_nonnulls(preco_entrada, preco_saida, preco_cache) IN (0, 3));
COMMENT ON COLUMN public.modelos_de_conta_de_ia.preco_entrada IS '[empresa] Centavos por milhão de tokens de entrada (do administrador).';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.preco_saida IS '[empresa] Centavos por milhão de tokens de saída (do administrador).';
COMMENT ON COLUMN public.modelos_de_conta_de_ia.preco_cache IS '[empresa] Centavos por milhão de tokens de cache (do administrador).';

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'teto_de_gasto';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida'));
ALTER TABLE public.modelos_de_conta_de_ia
  DROP CONSTRAINT modelos_preco_inteiro,
  DROP COLUMN preco_cache,
  DROP COLUMN preco_saida,
  DROP COLUMN preco_entrada;
ALTER TABLE public.contas_de_ia
  DROP CONSTRAINT contas_limite_de_tokens_so_na_assinatura,
  DROP COLUMN ao_chegar_no_limite,
  DROP COLUMN limite_de_tokens;
DROP TABLE public.avisos_de_gasto;
DROP TABLE public.tetos_de_gasto;
DROP TABLE public.consumo_de_ia;
