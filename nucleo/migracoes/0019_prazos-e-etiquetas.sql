-- M3-03: prioridade, prazo, etiquetas e recorrência (contrato em contratos/src/tarefas/prazos.ts).
--
-- 1. O prazo é guardado como dia, hora (opcional) e o fuso em que foi marcado; o momento do prazo (prazo_em) é
--    calculado pelo próprio banco, no fuso certo: com hora, aquela hora; só o dia, 23:59. Assim a mudança de horário
--    de verão de cada fuso já entra na conta, e o momento serve para ordenar e para os avisos de prazo (M3-06).
-- 2. Etiquetas são da empresa (nome único, sem diferença de maiúsculas) e ficam isoladas pelo RLS, como o resto.
-- 3. Recorrência: a regra fica na tarefa (jsonb, conferida pelo contrato na API). Ao concluir, nasce a próxima, que
--    guarda de qual veio (recorrente_de_id); só uma pode vir de cada (índice único), então uma conclusão repetida ou
--    dois pedidos ao mesmo tempo não criam duas.
-- Explicado em docs/banco/decisoes.md, seção 23.

-- Up Migration

ALTER TABLE public.tarefas
  ADD COLUMN prioridade text CHECK (prioridade IN ('urgente', 'alta', 'normal', 'baixa')),
  ADD COLUMN prazo_dia date,
  ADD COLUMN prazo_hora time(0),
  ADD COLUMN prazo_fuso text CHECK (length(prazo_fuso) BETWEEN 1 AND 64),
  ADD COLUMN prazo_em timestamptz,
  ADD COLUMN inicio date,
  ADD COLUMN recorrencia jsonb CHECK (jsonb_typeof(recorrencia) = 'object'),
  ADD COLUMN ocorrencia integer NOT NULL DEFAULT 1 CHECK (ocorrencia >= 1),
  ADD COLUMN recorrente_de_id uuid,
  ADD CONSTRAINT tarefas_recorrente_da_empresa FOREIGN KEY (empresa_id, recorrente_de_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE SET NULL (recorrente_de_id),
  ADD CONSTRAINT tarefas_prazo_completo CHECK (
    num_nonnulls(prazo_dia, prazo_fuso, prazo_em) IN (0, 3) AND (prazo_hora IS NULL OR prazo_dia IS NOT NULL)),
  ADD CONSTRAINT tarefas_recorrencia_com_prazo CHECK (recorrencia IS NULL OR prazo_dia IS NOT NULL),
  ADD CONSTRAINT tarefas_inicio_antes_do_prazo CHECK (inicio IS NULL OR prazo_dia IS NULL OR inicio <= prazo_dia);
CREATE UNIQUE INDEX tarefas_uma_proxima ON public.tarefas (recorrente_de_id) WHERE recorrente_de_id IS NOT NULL;
CREATE INDEX tarefas_por_prazo ON public.tarefas (empresa_id, prazo_em) WHERE prazo_em IS NOT NULL;
COMMENT ON COLUMN public.tarefas.prioridade IS '[empresa] urgente, alta, normal ou baixa. Vazio: sem prioridade.';
COMMENT ON COLUMN public.tarefas.prazo_dia IS '[empresa] Dia do prazo.';
COMMENT ON COLUMN public.tarefas.prazo_hora IS '[empresa] Hora do prazo. Vazio: vale o dia inteiro.';
COMMENT ON COLUMN public.tarefas.prazo_fuso IS '[empresa] Fuso em que o prazo foi marcado (IANA).';
COMMENT ON COLUMN public.tarefas.prazo_em IS '[sistema] Momento do prazo, calculado pelo banco no fuso do prazo (sem hora: 23:59).';
COMMENT ON COLUMN public.tarefas.inicio IS '[empresa] Dia de início, para o calendário.';
COMMENT ON COLUMN public.tarefas.recorrencia IS '[empresa] Regra da recorrência (contrato RegraDeRecorrencia). Vazio: não se repete.';
COMMENT ON COLUMN public.tarefas.ocorrencia IS '[sistema] Quantas vezes a tarefa já aconteceu, contando esta.';
COMMENT ON COLUMN public.tarefas.recorrente_de_id IS '[sistema] A tarefa anterior da recorrência, que ao ser concluída criou esta.';

-- O momento do prazo, sempre calculado no fuso do prazo.
CREATE FUNCTION public.calcular_prazo() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.prazo_dia IS NULL THEN
      NEW.prazo_hora := NULL;
      NEW.prazo_fuso := NULL;
      NEW.prazo_em := NULL;
    ELSE
      NEW.prazo_em := (NEW.prazo_dia + coalesce(NEW.prazo_hora, time '23:59')) AT TIME ZONE NEW.prazo_fuso;
    END IF;
    RETURN NEW;
  END
  $$;
COMMENT ON FUNCTION public.calcular_prazo() IS 'Calcula o momento do prazo da tarefa no fuso do prazo (sem hora: 23:59).';
CREATE TRIGGER tarefas_calculam_prazo BEFORE INSERT OR UPDATE OF prazo_dia, prazo_hora, prazo_fuso
  ON public.tarefas FOR EACH ROW EXECUTE FUNCTION public.calcular_prazo();

CREATE TABLE public.etiquetas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 40),
  cor text NOT NULL CHECK (cor ~ '^#[0-9a-f]{6}$'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT etiquetas_id_da_empresa UNIQUE (empresa_id, id)
);
CREATE UNIQUE INDEX etiquetas_nome_unico ON public.etiquetas (empresa_id, lower(nome));
COMMENT ON TABLE public.etiquetas IS 'Etiquetas da empresa, para marcar tarefas.';
COMMENT ON COLUMN public.etiquetas.id IS '[sistema] Identificador da etiqueta (UUID v7).';
COMMENT ON COLUMN public.etiquetas.empresa_id IS '[sistema] Empresa da etiqueta.';
COMMENT ON COLUMN public.etiquetas.nome IS '[empresa] Nome da etiqueta (único na empresa).';
COMMENT ON COLUMN public.etiquetas.cor IS '[empresa] Cor da etiqueta nas telas (#rrggbb).';
COMMENT ON COLUMN public.etiquetas.criada_em IS '[sistema] Quando a etiqueta foi criada.';

ALTER TABLE public.etiquetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etiquetas FORCE ROW LEVEL SECURITY;
CREATE POLICY etiquetas_da_empresa_ativa ON public.etiquetas
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.etiquetas_de_tarefa (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  etiqueta_id uuid NOT NULL,
  PRIMARY KEY (tarefa_id, etiqueta_id),
  CONSTRAINT etiquetas_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT etiquetas_da_empresa FOREIGN KEY (empresa_id, etiqueta_id)
    REFERENCES public.etiquetas (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX etiquetas_de_tarefa_por_etiqueta ON public.etiquetas_de_tarefa (empresa_id, etiqueta_id);
COMMENT ON TABLE public.etiquetas_de_tarefa IS 'Quais etiquetas cada tarefa tem.';
COMMENT ON COLUMN public.etiquetas_de_tarefa.empresa_id IS '[sistema] Empresa (a mesma da tarefa e da etiqueta).';
COMMENT ON COLUMN public.etiquetas_de_tarefa.tarefa_id IS '[sistema] Tarefa.';
COMMENT ON COLUMN public.etiquetas_de_tarefa.etiqueta_id IS '[sistema] Etiqueta.';

ALTER TABLE public.etiquetas_de_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etiquetas_de_tarefa FORCE ROW LEVEL SECURITY;
CREATE POLICY etiquetas_de_tarefa_da_empresa_ativa ON public.etiquetas_de_tarefa
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE UPDATE ON public.etiquetas_de_tarefa FROM mago_app;

-- Tempo real: mudar as etiquetas de uma tarefa avisa como "tarefa".
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME IN ('comentarios_de_tarefa', 'itens_de_checklist', 'etiquetas_de_tarefa') THEN
      tipo := 'tarefa';
      id := linha.tarefa_id;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      tipo := 'tarefa';
      id := linha.id;
    ELSIF TG_TABLE_NAME IN ('membros_de_projeto', 'listas', 'status_de_projeto') THEN
      tipo := 'projeto';
      id := linha.projeto_id;
    ELSIF TG_TABLE_NAME IN ('projetos', 'espacos') THEN
      tipo := 'projeto';
      id := linha.id;
    ELSE
      tipo := 'agente';
      id := linha.id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', tipo, 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;
CREATE TRIGGER etiquetas_de_tarefa_avisam AFTER INSERT OR DELETE ON public.etiquetas_de_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();

-- Down Migration

DROP TRIGGER etiquetas_de_tarefa_avisam ON public.etiquetas_de_tarefa;
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME IN ('comentarios_de_tarefa', 'itens_de_checklist') THEN
      tipo := 'tarefa';
      id := linha.tarefa_id;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      tipo := 'tarefa';
      id := linha.id;
    ELSIF TG_TABLE_NAME IN ('membros_de_projeto', 'listas', 'status_de_projeto') THEN
      tipo := 'projeto';
      id := linha.projeto_id;
    ELSIF TG_TABLE_NAME IN ('projetos', 'espacos') THEN
      tipo := 'projeto';
      id := linha.id;
    ELSE
      tipo := 'agente';
      id := linha.id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', tipo, 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;
DROP TABLE public.etiquetas_de_tarefa;
DROP TABLE public.etiquetas;
DROP TRIGGER tarefas_calculam_prazo ON public.tarefas;
DROP FUNCTION public.calcular_prazo();
DROP INDEX public.tarefas_por_prazo;
DROP INDEX public.tarefas_uma_proxima;
ALTER TABLE public.tarefas
  DROP CONSTRAINT tarefas_inicio_antes_do_prazo,
  DROP CONSTRAINT tarefas_recorrencia_com_prazo,
  DROP CONSTRAINT tarefas_prazo_completo,
  DROP CONSTRAINT tarefas_recorrente_da_empresa,
  DROP COLUMN recorrente_de_id,
  DROP COLUMN ocorrencia,
  DROP COLUMN recorrencia,
  DROP COLUMN inicio,
  DROP COLUMN prazo_em,
  DROP COLUMN prazo_fuso,
  DROP COLUMN prazo_hora,
  DROP COLUMN prazo_dia,
  DROP COLUMN prioridade;
