-- M2-03: Central de agentes básica (contrato em contratos/src/agentes/agente.ts).
--
-- 1. Cada agente é de uma empresa (RLS como o resto) e tem uma pessoa responsável, com vínculo na mesma empresa.
-- 2. No M2 só existe o agente externo. Situação: ativo, pausado ou desligado (desligado tem data).
-- 3. As colunas de agente das tarefas e dos comentários (0013) passam a apontar para agentes da mesma empresa.
-- 4. A chave do agente entra na M2-04.
-- Explicado em docs/banco/decisoes.md, seção 18.

-- Up Migration

CREATE TABLE public.agentes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  descricao text CHECK (length(trim(descricao)) BETWEEN 1 AND 1000),
  tipo text NOT NULL DEFAULT 'externo' CHECK (tipo IN ('externo')),
  onde_roda text CHECK (length(trim(onde_roda)) BETWEEN 1 AND 100),
  responsavel_id uuid NOT NULL,
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'pausado', 'desligado')),
  minutos_sem_sinal integer NOT NULL DEFAULT 15 CHECK (minutos_sem_sinal BETWEEN 2 AND 1440),
  ultimo_sinal_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  desligado_em timestamptz,
  CONSTRAINT agentes_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT agentes_responsavel_da_empresa FOREIGN KEY (empresa_id, responsavel_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT agentes_data_de_desligamento CHECK ((situacao = 'desligado') = (desligado_em IS NOT NULL))
);
-- Dois agentes vivos da mesma empresa não têm o mesmo nome (para ninguém confundir quem fez o quê).
CREATE UNIQUE INDEX agentes_nome_unico ON public.agentes (empresa_id, lower(nome)) WHERE situacao <> 'desligado';
COMMENT ON TABLE public.agentes IS
  'Agentes de IA da empresa. No M2 só externos (rodam fora e entram pelo MCP), sempre com uma pessoa responsável.';
COMMENT ON COLUMN public.agentes.id IS '[sistema] Identificador do agente (UUID v7).';
COMMENT ON COLUMN public.agentes.empresa_id IS '[sistema] Empresa do agente.';
COMMENT ON COLUMN public.agentes.nome IS '[empresa] Nome do agente nas telas (ex.: Claude no Mac).';
COMMENT ON COLUMN public.agentes.descricao IS '[empresa] Para que serve o agente.';
COMMENT ON COLUMN public.agentes.tipo IS '[empresa] externo: roda fora do Mago OS e entra pelo MCP. Os internos vêm no M4.';
COMMENT ON COLUMN public.agentes.onde_roda IS '[empresa] Onde o agente roda, em texto livre (ex.: VPS01, Mac do Sandro).';
COMMENT ON COLUMN public.agentes.responsavel_id IS '[sistema] Pessoa da empresa que responde pelo agente e recebe os avisos dele.';
COMMENT ON COLUMN public.agentes.situacao IS '[empresa] ativo, pausado (sem tarefa nova) ou desligado (parado de vez).';
COMMENT ON COLUMN public.agentes.minutos_sem_sinal IS '[empresa] Minutos sem sinal de vida até a tarefa pegada voltar para A fazer (M2-04).';
COMMENT ON COLUMN public.agentes.ultimo_sinal_em IS '[sistema] Último pedido do agente (sinal de vida, M2-04).';
COMMENT ON COLUMN public.agentes.criado_em IS '[sistema] Quando o agente foi cadastrado.';
COMMENT ON COLUMN public.agentes.atualizado_em IS '[sistema] Última mudança no cadastro.';
COMMENT ON COLUMN public.agentes.desligado_em IS '[sistema] Quando o agente foi desligado.';

ALTER TABLE public.agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agentes FORCE ROW LEVEL SECURITY;
CREATE POLICY agentes_da_empresa_ativa ON public.agentes
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
-- Agente não se apaga (a auditoria e as tarefas guardam quem fez): desliga-se.
REVOKE DELETE ON public.agentes FROM mago_app;

ALTER TABLE public.tarefas
  ADD CONSTRAINT tarefas_agente_responsavel FOREIGN KEY (empresa_id, responsavel_agente_id)
    REFERENCES public.agentes (empresa_id, id),
  ADD CONSTRAINT tarefas_agente_criador FOREIGN KEY (empresa_id, criada_por_agente_id)
    REFERENCES public.agentes (empresa_id, id),
  ADD CONSTRAINT tarefas_agente_trava FOREIGN KEY (empresa_id, travada_por_agente_id)
    REFERENCES public.agentes (empresa_id, id),
  ADD CONSTRAINT tarefas_agente_entrega FOREIGN KEY (empresa_id, resultado_por_agente_id)
    REFERENCES public.agentes (empresa_id, id);
CREATE INDEX tarefas_por_trava_de_agente ON public.tarefas (empresa_id, travada_por_agente_id)
  WHERE travada_por_agente_id IS NOT NULL;
ALTER TABLE public.comentarios_de_tarefa
  ADD CONSTRAINT comentarios_agente_da_empresa FOREIGN KEY (empresa_id, autor_agente_id)
    REFERENCES public.agentes (empresa_id, id);
COMMENT ON COLUMN public.tarefas.responsavel_agente_id IS '[sistema] Agente responsável (da mesma empresa), quando é um agente.';

-- Down Migration

ALTER TABLE public.comentarios_de_tarefa DROP CONSTRAINT comentarios_agente_da_empresa;
DROP INDEX public.tarefas_por_trava_de_agente;
ALTER TABLE public.tarefas
  DROP CONSTRAINT tarefas_agente_responsavel,
  DROP CONSTRAINT tarefas_agente_criador,
  DROP CONSTRAINT tarefas_agente_trava,
  DROP CONSTRAINT tarefas_agente_entrega;
COMMENT ON COLUMN public.tarefas.responsavel_agente_id IS '[sistema] Agente responsável, quando é um agente (referência na M2-03).';
DROP TABLE public.agentes;
