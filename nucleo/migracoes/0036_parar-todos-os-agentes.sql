-- M4-09: parar todos os agentes (contrato em contratos/src/agentes/parada.ts, decisão 0031).
-- 1. paradas_de_agentes: cada parada da empresa (motivo, quem parou, quando terminou). Uma ativa por empresa.
-- 2. agentes_da_parada: os agentes que estavam ativos e a parada pausou (só eles voltam ao retomar).
-- 3. execucoes_de_agente.parada_id: a parada que interrompeu a execução (a tarefa volta à fila ao retomar).
-- 4. execucoes_esquecidas() não acorda a fila de um agente pausado enquanto a empresa está parada: ela espera a retomada.
-- 5. Dois tipos de aviso novos.
-- Explicado em docs/banco/decisoes.md, seção 41.

-- Up Migration

CREATE TABLE public.paradas_de_agentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 1 AND 500),
  parada_por uuid NOT NULL,
  parada_por_nome text NOT NULL,
  da_plataforma boolean NOT NULL DEFAULT false,
  parada_em timestamptz NOT NULL DEFAULT now(),
  retomada_em timestamptz,
  UNIQUE (empresa_id, id)
);
CREATE UNIQUE INDEX paradas_uma_ativa ON public.paradas_de_agentes (empresa_id) WHERE retomada_em IS NULL;
COMMENT ON TABLE public.paradas_de_agentes IS 'Cada vez que todos os agentes da empresa foram parados (M4-09).';
COMMENT ON COLUMN public.paradas_de_agentes.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.paradas_de_agentes.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.paradas_de_agentes.motivo IS '[empresa] Por que os agentes foram parados.';
COMMENT ON COLUMN public.paradas_de_agentes.parada_por IS
  '[sistema] Pessoa que parou (administrador da empresa ou Dono da plataforma, que pode não ter vínculo).';
COMMENT ON COLUMN public.paradas_de_agentes.parada_por_nome IS '[pessoal] Nome de quem parou, no momento da parada.';
COMMENT ON COLUMN public.paradas_de_agentes.da_plataforma IS '[sistema] Parada pelo Dono da plataforma: só ele retoma.';
COMMENT ON COLUMN public.paradas_de_agentes.parada_em IS '[sistema] Quando parou.';
COMMENT ON COLUMN public.paradas_de_agentes.retomada_em IS
  '[sistema] Quando o último agente da parada voltou (vazio: a parada continua).';
ALTER TABLE public.paradas_de_agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paradas_de_agentes FORCE ROW LEVEL SECURITY;
CREATE POLICY paradas_de_agentes_da_empresa_ativa ON public.paradas_de_agentes
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.agentes_da_parada (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  parada_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  retomado_em timestamptz,
  retomado_por uuid,
  PRIMARY KEY (empresa_id, parada_id, agente_id),
  CONSTRAINT agentes_da_parada_parada FOREIGN KEY (empresa_id, parada_id)
    REFERENCES public.paradas_de_agentes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT agentes_da_parada_agente FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX agentes_da_parada_por_agente ON public.agentes_da_parada (empresa_id, agente_id)
  WHERE retomado_em IS NULL;
COMMENT ON TABLE public.agentes_da_parada IS 'Os agentes que estavam ativos e a parada pausou (só eles voltam ao retomar).';
COMMENT ON COLUMN public.agentes_da_parada.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.agentes_da_parada.parada_id IS '[sistema] A parada.';
COMMENT ON COLUMN public.agentes_da_parada.agente_id IS '[sistema] O agente pausado pela parada.';
COMMENT ON COLUMN public.agentes_da_parada.retomado_em IS '[sistema] Quando voltou ao trabalho (vazio: continua parado).';
COMMENT ON COLUMN public.agentes_da_parada.retomado_por IS '[sistema] Pessoa que retomou.';
ALTER TABLE public.agentes_da_parada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentes_da_parada FORCE ROW LEVEL SECURITY;
CREATE POLICY agentes_da_parada_da_empresa_ativa ON public.agentes_da_parada
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

ALTER TABLE public.execucoes_de_agente
  ADD COLUMN parada_id uuid,
  ADD CONSTRAINT execucoes_da_parada FOREIGN KEY (empresa_id, parada_id)
    REFERENCES public.paradas_de_agentes (empresa_id, id) ON DELETE SET NULL (parada_id);
COMMENT ON COLUMN public.execucoes_de_agente.parada_id IS
  '[sistema] A parada que interrompeu a execução no meio (a tarefa volta à fila ao retomar).';

CREATE OR REPLACE FUNCTION public.execucoes_esquecidas()
  RETURNS TABLE (empresa_id uuid, execucao_id uuid, situacao text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.empresa_id, e.id, e.situacao
      FROM public.execucoes_de_agente e
      JOIN public.agentes g ON g.id = e.agente_id AND g.empresa_id = e.empresa_id
     WHERE (e.situacao = 'na_fila' AND e.criada_em < now() - interval '2 minutes'
            AND NOT (g.situacao = 'pausado' AND (e.origem = 'tarefa' OR EXISTS (
              SELECT 1 FROM public.paradas_de_agentes p
               WHERE p.empresa_id = g.empresa_id AND p.retomada_em IS NULL))))
        OR (e.situacao = 'rodando' AND e.iniciada_em < now() - interval '15 minutes')
     LIMIT 100
  $$;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo IN ('agentes_parados', 'agentes_retomados');
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto'));

CREATE OR REPLACE FUNCTION public.execucoes_esquecidas()
  RETURNS TABLE (empresa_id uuid, execucao_id uuid, situacao text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.empresa_id, e.id, e.situacao
      FROM public.execucoes_de_agente e
      JOIN public.agentes g ON g.id = e.agente_id AND g.empresa_id = e.empresa_id
     WHERE (e.situacao = 'na_fila' AND e.criada_em < now() - interval '2 minutes'
            AND NOT (e.origem = 'tarefa' AND g.situacao = 'pausado'))
        OR (e.situacao = 'rodando' AND e.iniciada_em < now() - interval '15 minutes')
     LIMIT 100
  $$;

ALTER TABLE public.execucoes_de_agente DROP CONSTRAINT execucoes_da_parada, DROP COLUMN parada_id;
DROP TABLE public.agentes_da_parada;
DROP TABLE public.paradas_de_agentes;
