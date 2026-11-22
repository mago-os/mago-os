-- M4-07: o passo a passo de cada execução dos agentes internos e o que os externos fizeram pelo MCP (contrato em
-- contratos/src/agentes/passos.ts, decisão 0029). Os passos ficam 90 dias. Explicado em docs/banco/decisoes.md,
-- seção 39.

-- Up Migration

CREATE TABLE public.passos_de_execucao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  execucao_id uuid,
  agente_id uuid NOT NULL,
  tarefa_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('modelo', 'ferramenta', 'sistema')),
  duracao_ms integer CHECK (duracao_ms >= 0),
  modelo text CHECK (length(modelo) <= 120),
  texto text CHECK (length(texto) <= 20000),
  ferramenta text CHECK (length(ferramenta) <= 400),
  entrada jsonb,
  resultado jsonb,
  erro boolean NOT NULL DEFAULT false,
  cortado boolean NOT NULL DEFAULT false,
  consumo_id uuid,
  aprovacao_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT passos_da_execucao FOREIGN KEY (empresa_id, execucao_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT passos_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT passos_da_tarefa FOREIGN KEY (empresa_id, tarefa_id) REFERENCES public.tarefas (empresa_id, id)
    ON DELETE SET NULL (tarefa_id),
  CONSTRAINT passos_da_aprovacao FOREIGN KEY (empresa_id, aprovacao_id) REFERENCES public.aprovacoes (empresa_id, id)
    ON DELETE SET NULL (aprovacao_id),
  CONSTRAINT passos_do_consumo FOREIGN KEY (consumo_id) REFERENCES public.consumo_de_ia (id) ON DELETE SET NULL,
  CONSTRAINT passos_tamanho CHECK (
    (entrada IS NULL OR octet_length(entrada::text) <= 80000) AND (resultado IS NULL OR octet_length(resultado::text) <= 80000)
  )
);
CREATE INDEX passos_por_execucao ON public.passos_de_execucao (empresa_id, execucao_id, criado_em);
CREATE INDEX passos_externos_por_tarefa ON public.passos_de_execucao (empresa_id, tarefa_id, agente_id, criado_em)
  WHERE execucao_id IS NULL;
CREATE INDEX passos_antigos ON public.passos_de_execucao (criado_em);
COMMENT ON TABLE public.passos_de_execucao IS
  'Passo a passo de cada execução (resposta do modelo, ferramenta, aviso) e o que os externos fizeram pelo MCP. 90 dias.';
COMMENT ON COLUMN public.passos_de_execucao.id IS '[sistema] Identificador (UUID v7).';
COMMENT ON COLUMN public.passos_de_execucao.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.passos_de_execucao.execucao_id IS '[sistema] Execução do agente interno (vazio: agente externo, pelo MCP).';
COMMENT ON COLUMN public.passos_de_execucao.agente_id IS '[sistema] Agente.';
COMMENT ON COLUMN public.passos_de_execucao.tarefa_id IS '[sistema] Tarefa do passo (a da execução, ou a da ferramenta do externo).';
COMMENT ON COLUMN public.passos_de_execucao.tipo IS '[sistema] modelo, ferramenta ou sistema.';
COMMENT ON COLUMN public.passos_de_execucao.duracao_ms IS '[sistema] Quanto o passo demorou.';
COMMENT ON COLUMN public.passos_de_execucao.modelo IS '[sistema] O modelo que respondeu (passo de modelo).';
COMMENT ON COLUMN public.passos_de_execucao.texto IS '[empresa] O que o modelo devolveu, ou o aviso do sistema (só texto).';
COMMENT ON COLUMN public.passos_de_execucao.ferramenta IS '[sistema] A ferramenta chamada (ou as pedidas pelo modelo).';
COMMENT ON COLUMN public.passos_de_execucao.entrada IS '[empresa] Os parâmetros da ferramenta (cortados acima do limite).';
COMMENT ON COLUMN public.passos_de_execucao.resultado IS '[empresa] O resultado da ferramenta, ou a recusa (cortado acima do limite).';
COMMENT ON COLUMN public.passos_de_execucao.erro IS '[sistema] A ferramenta recusou ou falhou.';
COMMENT ON COLUMN public.passos_de_execucao.cortado IS '[sistema] Parâmetros ou resultado passaram do limite e foram cortados.';
COMMENT ON COLUMN public.passos_de_execucao.consumo_id IS '[sistema] O consumo (tokens e custo) do passo de modelo.';
COMMENT ON COLUMN public.passos_de_execucao.aprovacao_id IS '[sistema] O pedido de aprovação que o passo criou.';
COMMENT ON COLUMN public.passos_de_execucao.criado_em IS '[sistema] Quando o passo terminou.';
ALTER TABLE public.passos_de_execucao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passos_de_execucao FORCE ROW LEVEL SECURITY;
CREATE POLICY passos_de_execucao_da_empresa_ativa ON public.passos_de_execucao
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE, DELETE ON public.passos_de_execucao FROM mago_app;

-- Apaga os passos com mais de 90 dias, de todas as empresas (a verificação diária chama). Devolve quantos.
CREATE FUNCTION public.apagar_passos_antigos()
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH apagados AS (
      DELETE FROM public.passos_de_execucao WHERE criado_em < now() - interval '90 days' RETURNING 1
    )
    SELECT count(*)::integer FROM apagados
  $$;
COMMENT ON FUNCTION public.apagar_passos_antigos() IS 'Para a verificação diária: apaga os passos com mais de 90 dias.';
REVOKE EXECUTE ON FUNCTION public.apagar_passos_antigos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apagar_passos_antigos() TO mago_app;

-- Down Migration

DROP FUNCTION public.apagar_passos_antigos();
DROP TABLE public.passos_de_execucao;
