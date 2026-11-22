-- M4-08: limites de rodadas e de tempo de cada execução, ajustados por agente (contrato em
-- contratos/src/agentes/limites.ts, decisão 0030). Vazio: o padrão (30 rodadas e 10 minutos). Explicado em
-- docs/banco/decisoes.md, seção 40.

-- Up Migration

ALTER TABLE public.agentes
  ADD COLUMN limite_de_rodadas integer CHECK (limite_de_rodadas BETWEEN 1 AND 100),
  ADD COLUMN limite_de_minutos integer CHECK (limite_de_minutos BETWEEN 1 AND 60);
COMMENT ON COLUMN public.agentes.limite_de_rodadas IS
  '[empresa] Agente interno: rodadas por execução (vazio: o padrão, 30).';
COMMENT ON COLUMN public.agentes.limite_de_minutos IS
  '[empresa] Agente interno: minutos por execução (vazio: o padrão, 10).';

-- Down Migration

ALTER TABLE public.agentes DROP COLUMN limite_de_minutos, DROP COLUMN limite_de_rodadas;
