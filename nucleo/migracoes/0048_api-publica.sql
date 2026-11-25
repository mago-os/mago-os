-- M7-02: API pública (contrato em contratos/src/api/publica.ts, decisão 0047).
-- 1. chaves_de_api: as chaves da empresa (só o começo e o resumo), em nome de uma pessoa, com escopo, IPs e validade.
-- 2. reconhecer_chave_de_api(): acha a chave pelo começo antes de saber a empresa (como reconhecer_chave, 0016).
-- 3. contadores_da_api: pedidos por minuto por chave e por empresa, no banco (vale com mais de uma cópia da API).
-- 4. agentes.canais: por onde a chave do agente entra (só MCP, só API ou os dois); reconhecer_chave() devolve.
-- 5. chaves_de_api_vencendo(): as chaves que vencem em até 30 dias e ainda não avisaram (só ids). Aviso novo.
-- Explicado em docs/banco/decisoes.md, seção 53.

-- Up Migration

CREATE TABLE public.chaves_de_api (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  prefixo text NOT NULL UNIQUE CHECK (prefixo ~ '^mago_api_[0-9a-z]{10}$'),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  pessoa_id uuid NOT NULL,
  escopo jsonb NOT NULL CHECK (jsonb_typeof(escopo) = 'object' AND escopo <> '{}'::jsonb),
  ips cidr[] NOT NULL DEFAULT '{}' CHECK (cardinality(ips) <= 20),
  valida_ate timestamptz NOT NULL,
  criada_por uuid NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz,
  revogada_em timestamptz,
  revogada_por uuid,
  trocada_por_id uuid,
  avisou_vencimento_em timestamptz,
  CONSTRAINT chaves_de_api_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT chaves_de_api_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT chaves_de_api_criador FOREIGN KEY (empresa_id, criada_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT chaves_de_api_revogador FOREIGN KEY (empresa_id, revogada_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT chaves_de_api_trocada_por FOREIGN KEY (empresa_id, trocada_por_id)
    REFERENCES public.chaves_de_api (empresa_id, id),
  CONSTRAINT chaves_de_api_revogada_diz_quem CHECK ((revogada_em IS NULL) = (revogada_por IS NULL)),
  CONSTRAINT chaves_de_api_validade CHECK (valida_ate > criada_em AND valida_ate <= criada_em + interval '367 days')
);
CREATE INDEX chaves_de_api_por_empresa ON public.chaves_de_api (empresa_id, criada_em DESC);
COMMENT ON TABLE public.chaves_de_api IS
  'Chaves da API pública (M7-02). Só o começo e o resumo SHA-256 ficam aqui: a chave inteira aparece uma vez, na tela.';
COMMENT ON COLUMN public.chaves_de_api.id IS '[sistema] Identificador da chave.';
COMMENT ON COLUMN public.chaves_de_api.empresa_id IS '[sistema] Empresa da chave.';
COMMENT ON COLUMN public.chaves_de_api.nome IS '[empresa] Para que serve a chave (ex.: n8n da 4xpert).';
COMMENT ON COLUMN public.chaves_de_api.prefixo IS '[sistema] Começo da chave (mago_api_ + 10 caracteres), para achar e reconhecer.';
COMMENT ON COLUMN public.chaves_de_api.resumo IS '[sensivel] Resumo SHA-256 da chave inteira. A chave em si não fica guardada.';
COMMENT ON COLUMN public.chaves_de_api.pessoa_id IS '[sistema] Pessoa em nome de quem a chave age (nunca passa do que ela pode).';
COMMENT ON COLUMN public.chaves_de_api.escopo IS '[empresa] Módulos que a chave alcança e se lê ou escreve (EscopoDaChave do contrato).';
COMMENT ON COLUMN public.chaves_de_api.ips IS '[empresa] IPs ou faixas de onde a chave pode ser usada. Vazio: de qualquer lugar.';
COMMENT ON COLUMN public.chaves_de_api.valida_ate IS '[empresa] Até quando a chave vale (no máximo 1 ano).';
COMMENT ON COLUMN public.chaves_de_api.criada_por IS '[sistema] Quem criou a chave.';
COMMENT ON COLUMN public.chaves_de_api.criada_em IS '[sistema] Quando a chave foi criada.';
COMMENT ON COLUMN public.chaves_de_api.ultimo_uso_em IS '[sistema] Último pedido aceito com a chave.';
COMMENT ON COLUMN public.chaves_de_api.revogada_em IS '[sistema] Quando a chave foi revogada (deixa de valer no pedido seguinte).';
COMMENT ON COLUMN public.chaves_de_api.revogada_por IS '[sistema] Quem revogou a chave.';
COMMENT ON COLUMN public.chaves_de_api.trocada_por_id IS '[sistema] A chave nova que substituiu esta numa troca.';
COMMENT ON COLUMN public.chaves_de_api.avisou_vencimento_em IS '[sistema] Quando o aviso de vencimento (30 dias antes) saiu.';
ALTER TABLE public.chaves_de_api ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaves_de_api FORCE ROW LEVEL SECURITY;
CREATE POLICY chaves_de_api_da_empresa_ativa ON public.chaves_de_api
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
-- Chave não se apaga (a auditoria guarda o começo dela): revoga-se.
REVOKE DELETE ON public.chaves_de_api FROM mago_app;

-- Achar a chave pelo começo, antes de saber a empresa. Devolve uma linha só, e só com o começo exato.
CREATE FUNCTION public.reconhecer_chave_de_api(prefixo_da_chave text)
  RETURNS TABLE (chave_id uuid, empresa_id uuid, pessoa_id uuid, resumo text, escopo jsonb, ips cidr[],
                 valida_ate timestamptz, revogada_em timestamptz, situacao_do_vinculo text, situacao_da_empresa text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.id, k.empresa_id, k.pessoa_id, k.resumo, k.escopo, k.ips, k.valida_ate, k.revogada_em, v.situacao,
           e.situacao
      FROM public.chaves_de_api k
      JOIN public.vinculos v ON v.empresa_id = k.empresa_id AND v.pessoa_id = k.pessoa_id
      JOIN public.empresas e ON e.id = k.empresa_id
     WHERE k.prefixo = prefixo_da_chave
  $$;
COMMENT ON FUNCTION public.reconhecer_chave_de_api(text) IS
  'Acha a chave de API pelo começo (o pedido ainda não tem empresa). A conferência do resumo é feita na API.';
REVOKE EXECUTE ON FUNCTION public.reconhecer_chave_de_api(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconhecer_chave_de_api(text) TO mago_app;

CREATE TABLE public.contadores_da_api (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  chave_id uuid,
  inicio timestamptz NOT NULL,
  valor integer NOT NULL DEFAULT 0 CHECK (valor >= 0),
  CONSTRAINT contadores_da_api_chave FOREIGN KEY (empresa_id, chave_id)
    REFERENCES public.chaves_de_api (empresa_id, id)
);
-- Um contador por chave e minuto, e um da empresa inteira (chave nula) por minuto.
CREATE UNIQUE INDEX contadores_da_api_unicos ON public.contadores_da_api (empresa_id, chave_id, inicio) NULLS NOT DISTINCT;
COMMENT ON TABLE public.contadores_da_api IS
  'Pedidos por minuto na API pública, por chave e da empresa inteira (chave nula). Apagados depois de 2 horas.';
COMMENT ON COLUMN public.contadores_da_api.empresa_id IS '[sistema] Empresa contada.';
COMMENT ON COLUMN public.contadores_da_api.chave_id IS '[sistema] Chave contada; nula: o total da empresa.';
COMMENT ON COLUMN public.contadores_da_api.inicio IS '[sistema] Começo do minuto.';
COMMENT ON COLUMN public.contadores_da_api.valor IS '[sistema] Quantos pedidos no minuto.';
ALTER TABLE public.contadores_da_api ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contadores_da_api FORCE ROW LEVEL SECURITY;
CREATE POLICY contadores_da_api_da_empresa_ativa ON public.contadores_da_api
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE OR REPLACE FUNCTION public.limpar_contadores_de_agente() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH apagados AS (DELETE FROM public.contadores_de_agente WHERE inicio < now() - interval '2 hours' RETURNING 1),
         da_api AS (DELETE FROM public.contadores_da_api WHERE inicio < now() - interval '2 hours' RETURNING 1)
    SELECT ((SELECT count(*) FROM apagados) + (SELECT count(*) FROM da_api))::integer
  $$;
COMMENT ON FUNCTION public.limpar_contadores_de_agente() IS
  'Apaga os contadores de limite (dos agentes e da API pública) com mais de 2 horas.';

ALTER TABLE public.agentes
  ADD COLUMN canais text NOT NULL DEFAULT 'os_dois' CHECK (canais IN ('mcp', 'api', 'os_dois'));
COMMENT ON COLUMN public.agentes.canais IS '[empresa] Por onde a chave do agente externo entra: mcp, api ou os_dois.';

DROP FUNCTION public.reconhecer_chave(text);
CREATE FUNCTION public.reconhecer_chave(prefixo_da_chave text)
  RETURNS TABLE (chave_id uuid, empresa_id uuid, agente_id uuid, resumo text, valida_ate timestamptz,
                 revogada_em timestamptz, situacao_do_agente text, situacao_da_empresa text, canais text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.id, k.empresa_id, k.agente_id, k.resumo, k.valida_ate, k.revogada_em, a.situacao, e.situacao, a.canais
      FROM public.chaves_de_agente k JOIN public.agentes a ON a.id = k.agente_id AND a.empresa_id = k.empresa_id
      JOIN public.empresas e ON e.id = k.empresa_id
     WHERE k.prefixo = prefixo_da_chave
  $$;
COMMENT ON FUNCTION public.reconhecer_chave(text) IS
  'Acha a chave pelo começo (o pedido do agente ainda não tem empresa). A conferência do resumo é feita na API.';
REVOKE EXECUTE ON FUNCTION public.reconhecer_chave(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconhecer_chave(text) TO mago_app;

-- As chaves que vencem em até 30 dias, sem aviso ainda (só ids): a verificação a cada minuto avisa cada uma uma vez.
CREATE FUNCTION public.chaves_de_api_vencendo()
  RETURNS TABLE (empresa_id uuid, chave_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.empresa_id, k.id FROM public.chaves_de_api k
     WHERE k.revogada_em IS NULL AND k.trocada_por_id IS NULL AND k.avisou_vencimento_em IS NULL
       AND k.valida_ate BETWEEN now() AND now() + interval '30 days'
  $$;
REVOKE EXECUTE ON FUNCTION public.chaves_de_api_vencendo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chaves_de_api_vencendo() TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'chave_de_api_vencendo';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento'));
DROP FUNCTION public.chaves_de_api_vencendo();
DROP FUNCTION public.reconhecer_chave(text);
CREATE FUNCTION public.reconhecer_chave(prefixo_da_chave text)
  RETURNS TABLE (chave_id uuid, empresa_id uuid, agente_id uuid, resumo text, valida_ate timestamptz,
                 revogada_em timestamptz, situacao_do_agente text, situacao_da_empresa text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.id, k.empresa_id, k.agente_id, k.resumo, k.valida_ate, k.revogada_em, a.situacao, e.situacao
      FROM public.chaves_de_agente k JOIN public.agentes a ON a.id = k.agente_id AND a.empresa_id = k.empresa_id
      JOIN public.empresas e ON e.id = k.empresa_id
     WHERE k.prefixo = prefixo_da_chave
  $$;
REVOKE EXECUTE ON FUNCTION public.reconhecer_chave(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconhecer_chave(text) TO mago_app;
ALTER TABLE public.agentes DROP COLUMN canais;
CREATE OR REPLACE FUNCTION public.limpar_contadores_de_agente() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH apagados AS (DELETE FROM public.contadores_de_agente WHERE inicio < now() - interval '2 hours' RETURNING 1)
    SELECT count(*)::integer FROM apagados
  $$;
DROP TABLE public.contadores_da_api;
DROP FUNCTION public.reconhecer_chave_de_api(text);
DROP TABLE public.chaves_de_api;
