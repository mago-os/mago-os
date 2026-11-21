-- M4-03: regras por ação dos agentes e pedidos de aprovação (contrato em contratos/src/agentes/regras.ts, decisão 0025).
--
-- 1. regras_de_agente: só os ajustes do administrador (o padrão vem do catálogo, no código) e o contador de aprovações
--    seguidas sem edição (para a tela sugerir liberar). Modo nulo = vale o padrão.
-- 2. aprovacoes: o pedido com os parâmetros exatos; quem pode aprovar decide; vence em 24 horas.
-- 3. avisos ganham os tipos aprovacao_pedida e aprovacao_decidida.
-- Explicado em docs/banco/decisoes.md, seção 35.

-- Up Migration

CREATE TABLE public.regras_de_agente (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao ~ '^[a-z_]{2,60}$'),
  modo text CHECK (modo IN ('executa', 'executa_nas_dele', 'pede_aprovacao', 'bloqueado')),
  aprovadas_sem_edicao integer NOT NULL DEFAULT 0 CHECK (aprovadas_sem_edicao >= 0),
  mudada_por uuid,
  mudada_em timestamptz,
  PRIMARY KEY (agente_id, acao),
  CONSTRAINT regras_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT regras_quem_mudou FOREIGN KEY (empresa_id, mudada_por) REFERENCES public.vinculos (empresa_id, pessoa_id)
    ON DELETE SET NULL (mudada_por),
  CONSTRAINT regras_mudanca_inteira CHECK ((mudada_por IS NULL) OR (mudada_em IS NOT NULL))
);
COMMENT ON TABLE public.regras_de_agente IS
  'Ajustes das regras por ação de cada agente (o padrão vem do catálogo) e o contador de aprovações seguidas.';
COMMENT ON COLUMN public.regras_de_agente.empresa_id IS '[sistema] Empresa do agente.';
COMMENT ON COLUMN public.regras_de_agente.agente_id IS '[sistema] Agente.';
COMMENT ON COLUMN public.regras_de_agente.acao IS '[empresa] A ação (nome da ferramenta).';
COMMENT ON COLUMN public.regras_de_agente.modo IS '[empresa] executa, executa_nas_dele, pede_aprovacao ou bloqueado; nulo: o padrão.';
COMMENT ON COLUMN public.regras_de_agente.aprovadas_sem_edicao IS '[sistema] Aprovações seguidas sem edição (aos 20, a tela sugere liberar).';
COMMENT ON COLUMN public.regras_de_agente.mudada_por IS '[sistema] Quem mudou o modo por último.';
COMMENT ON COLUMN public.regras_de_agente.mudada_em IS '[sistema] Quando o modo mudou.';

ALTER TABLE public.regras_de_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regras_de_agente FORCE ROW LEVEL SECURITY;
CREATE POLICY regras_de_agente_da_empresa_ativa ON public.regras_de_agente
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.aprovacoes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid NOT NULL,
  execucao_id uuid,
  pedido_por uuid NOT NULL,
  acao text NOT NULL CHECK (acao ~ '^[a-z_]{2,60}$'),
  tarefa_id uuid,
  parametros jsonb NOT NULL CHECK (jsonb_typeof(parametros) = 'object' AND octet_length(parametros::text) <= 50000),
  resumo text NOT NULL CHECK (length(trim(resumo)) BETWEEN 1 AND 300),
  motivo text CHECK (length(motivo) BETWEEN 1 AND 1000),
  conferencia text NOT NULL CHECK (conferencia ~ '^[0-9a-f]{64}$'),
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'aprovada', 'recusada', 'vencida', 'falhou')),
  decidida_por uuid,
  decidida_em timestamptz,
  observacao text CHECK (length(observacao) BETWEEN 1 AND 1000),
  resultado jsonb,
  editada boolean NOT NULL DEFAULT false,
  criada_em timestamptz NOT NULL DEFAULT now(),
  vence_em timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT aprovacoes_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT aprovacoes_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT aprovacoes_da_execucao FOREIGN KEY (empresa_id, execucao_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE SET NULL (execucao_id),
  CONSTRAINT aprovacoes_de_quem_pediu FOREIGN KEY (empresa_id, pedido_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT aprovacoes_quem_decidiu FOREIGN KEY (empresa_id, decidida_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (decidida_por),
  CONSTRAINT aprovacoes_da_tarefa FOREIGN KEY (empresa_id, tarefa_id) REFERENCES public.tarefas (empresa_id, id)
    ON DELETE SET NULL (tarefa_id),
  CONSTRAINT aprovacoes_decisao CHECK (
    CASE situacao
      WHEN 'pendente' THEN decidida_em IS NULL AND decidida_por IS NULL
      WHEN 'vencida' THEN decidida_em IS NOT NULL AND decidida_por IS NULL
      ELSE decidida_em IS NOT NULL
    END
  ),
  CONSTRAINT aprovacoes_recusa_explicada CHECK (situacao <> 'recusada' OR observacao IS NOT NULL),
  CONSTRAINT aprovacoes_vence_depois CHECK (vence_em > criada_em)
);
CREATE INDEX aprovacoes_pendentes ON public.aprovacoes (empresa_id, vence_em) WHERE situacao = 'pendente';
CREATE INDEX aprovacoes_do_agente_recentes ON public.aprovacoes (empresa_id, agente_id, criada_em DESC);
COMMENT ON TABLE public.aprovacoes IS 'Pedidos de aprovação de ações de agentes (M4-03). A ação só acontece se alguém aprovar.';
COMMENT ON COLUMN public.aprovacoes.id IS '[sistema] Identificador do pedido (UUID v7).';
COMMENT ON COLUMN public.aprovacoes.empresa_id IS '[sistema] Empresa do agente.';
COMMENT ON COLUMN public.aprovacoes.agente_id IS '[sistema] Agente que pediu.';
COMMENT ON COLUMN public.aprovacoes.execucao_id IS '[sistema] Execução do agente interno (os externos não têm).';
COMMENT ON COLUMN public.aprovacoes.pedido_por IS '[sistema] Em nome de quem o agente agia.';
COMMENT ON COLUMN public.aprovacoes.acao IS '[empresa] A ação (nome da ferramenta).';
COMMENT ON COLUMN public.aprovacoes.tarefa_id IS '[sistema] Tarefa da ação, se houver.';
COMMENT ON COLUMN public.aprovacoes.parametros IS '[empresa] Os parâmetros exatos que vão ser usados.';
COMMENT ON COLUMN public.aprovacoes.resumo IS '[empresa] O que vai acontecer, numa frase montada pelo núcleo.';
COMMENT ON COLUMN public.aprovacoes.motivo IS '[empresa] Por que, nas palavras do agente (mostrado só como texto).';
COMMENT ON COLUMN public.aprovacoes.conferencia IS '[sistema] Resumo SHA-256 dos parâmetros, conferido antes de executar.';
COMMENT ON COLUMN public.aprovacoes.situacao IS '[sistema] pendente, aprovada, recusada, vencida ou falhou.';
COMMENT ON COLUMN public.aprovacoes.decidida_por IS '[sistema] Quem aprovou ou recusou.';
COMMENT ON COLUMN public.aprovacoes.decidida_em IS '[sistema] Quando foi decidida (ou venceu).';
COMMENT ON COLUMN public.aprovacoes.observacao IS '[empresa] Motivo da recusa, ou o erro quando a ação aprovada falhou.';
COMMENT ON COLUMN public.aprovacoes.resultado IS '[empresa] O que a ação aprovada devolveu.';
COMMENT ON COLUMN public.aprovacoes.editada IS '[sistema] Quem aprovou mudou os parâmetros antes.';
COMMENT ON COLUMN public.aprovacoes.criada_em IS '[sistema] Quando o agente pediu.';
COMMENT ON COLUMN public.aprovacoes.vence_em IS '[sistema] Depois disso, sem decisão, o pedido vence e a ação não acontece.';

ALTER TABLE public.aprovacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aprovacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY aprovacoes_da_empresa_ativa ON public.aprovacoes
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE DELETE ON public.aprovacoes FROM mago_app;

-- Pedidos vencidos de todas as empresas (a verificação a cada minuto marca e avisa). Só ids.
CREATE FUNCTION public.aprovacoes_vencidas()
  RETURNS TABLE (empresa_id uuid, aprovacao_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT a.empresa_id, a.id FROM public.aprovacoes a
     WHERE a.situacao = 'pendente' AND a.vence_em <= now()
     LIMIT 500
  $$;
COMMENT ON FUNCTION public.aprovacoes_vencidas() IS 'Para a verificação a cada minuto: pedidos de aprovação vencidos. Só ids.';
REVOKE EXECUTE ON FUNCTION public.aprovacoes_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprovacoes_vencidas() TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo IN ('aprovacao_pedida', 'aprovacao_decidida');
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado'));
DROP FUNCTION public.aprovacoes_vencidas();
DROP TABLE public.aprovacoes;
DROP TABLE public.regras_de_agente;
