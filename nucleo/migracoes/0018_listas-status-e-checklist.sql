-- M3-02: listas, status por projeto, subtarefas e checklist (contratos em contratos/src/projetos/lista.ts e
-- contratos/src/tarefas/checklist.ts).
--
-- 1. Listas e status do projeto são da empresa e ficam isolados pelo RLS, como o resto. Cada status pertence a um
--    dos cinco tipos fixos do M2, que continua na coluna tarefas.status: a trava, o agente vivo e o MCP não mudam.
-- 2. Tarefa de projeto sempre tem lista e status do projeto; sem projeto, nenhum dos dois. Quem mantém isso é o
--    próprio banco (gatilho antes de gravar): mudou o tipo do status ou o projeto, ele escolhe o primeiro status do
--    tipo e a primeira lista do projeto, então nenhum caminho do código (tela, MCP, agente sem sinal) esquece.
--    A chave composta com o tipo garante que o status do projeto é sempre do mesmo tipo de tarefas.status.
-- 3. Subtarefa: um nível só (a mãe não pode ser subtarefa, e quem tem subtarefas não vira subtarefa), sempre no
--    projeto e na lista da mãe. Quando a mãe muda de projeto ou de lista, as subtarefas vão junto.
-- 4. Checklist: itens de texto na tarefa, com quem marcou (pessoa ou agente) e quando.
-- 5. Projetos que já existiam ganham a lista "Geral" e os cinco status padrão, e as tarefas deles são acertadas.
-- Explicado em docs/banco/decisoes.md, seção 22.

-- Up Migration

CREATE TABLE public.listas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 100000),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listas_do_projeto FOREIGN KEY (empresa_id, projeto_id)
    REFERENCES public.projetos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT listas_id_do_projeto UNIQUE (empresa_id, projeto_id, id)
);
CREATE INDEX listas_por_projeto ON public.listas (empresa_id, projeto_id, ordem);
COMMENT ON TABLE public.listas IS 'Listas (etapas ou frentes) de cada projeto. Todo projeto tem pelo menos uma.';
COMMENT ON COLUMN public.listas.id IS '[sistema] Identificador da lista (UUID v7).';
COMMENT ON COLUMN public.listas.empresa_id IS '[sistema] Empresa (a mesma do projeto).';
COMMENT ON COLUMN public.listas.projeto_id IS '[sistema] Projeto da lista.';
COMMENT ON COLUMN public.listas.nome IS '[empresa] Nome da lista (ex.: Planejamento).';
COMMENT ON COLUMN public.listas.ordem IS '[empresa] Posição na tela, do menor para o maior.';
COMMENT ON COLUMN public.listas.criada_em IS '[sistema] Quando a lista foi criada.';
COMMENT ON COLUMN public.listas.atualizada_em IS '[sistema] Última mudança na lista.';

ALTER TABLE public.listas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listas FORCE ROW LEVEL SECURITY;
CREATE POLICY listas_da_empresa_ativa ON public.listas
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.status_de_projeto (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 40),
  cor text NOT NULL CHECK (cor ~ '^#[0-9a-f]{6}$'),
  tipo text NOT NULL CHECK (tipo IN ('a_fazer', 'em_andamento', 'precisa_de_ajuda', 'concluida', 'cancelada')),
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 100000),
  CONSTRAINT status_do_projeto FOREIGN KEY (empresa_id, projeto_id)
    REFERENCES public.projetos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT status_id_do_projeto UNIQUE (empresa_id, projeto_id, id, tipo)
);
CREATE UNIQUE INDEX status_nome_unico ON public.status_de_projeto (projeto_id, lower(nome));
CREATE INDEX status_por_projeto ON public.status_de_projeto (empresa_id, projeto_id, tipo, ordem);
COMMENT ON TABLE public.status_de_projeto IS
  'Status de cada projeto, cada um ligado a um dos cinco tipos fixos. Todo projeto tem pelo menos um de cada tipo.';
COMMENT ON COLUMN public.status_de_projeto.id IS '[sistema] Identificador do status (UUID v7).';
COMMENT ON COLUMN public.status_de_projeto.empresa_id IS '[sistema] Empresa (a mesma do projeto).';
COMMENT ON COLUMN public.status_de_projeto.projeto_id IS '[sistema] Projeto do status.';
COMMENT ON COLUMN public.status_de_projeto.nome IS '[empresa] Nome do status (ex.: Em revisão).';
COMMENT ON COLUMN public.status_de_projeto.cor IS '[empresa] Cor do status nas telas (#rrggbb).';
COMMENT ON COLUMN public.status_de_projeto.tipo IS '[sistema] Tipo fixo: a_fazer, em_andamento, precisa_de_ajuda, concluida ou cancelada. Não muda depois de criado.';
COMMENT ON COLUMN public.status_de_projeto.ordem IS '[empresa] Posição na tela (e no Kanban), do menor para o maior.';

ALTER TABLE public.status_de_projeto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_de_projeto FORCE ROW LEVEL SECURITY;
CREATE POLICY status_da_empresa_ativa ON public.status_de_projeto
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
-- O tipo não muda depois de criado (a chave composta das tarefas depende dele).
REVOKE UPDATE ON public.status_de_projeto FROM mago_app;
GRANT UPDATE (nome, cor, ordem) ON public.status_de_projeto TO mago_app;

ALTER TABLE public.tarefas
  ADD COLUMN lista_id uuid,
  ADD COLUMN status_do_projeto_id uuid,
  ADD COLUMN tarefa_mae_id uuid,
  ADD CONSTRAINT tarefas_lista_do_projeto FOREIGN KEY (empresa_id, projeto_id, lista_id)
    REFERENCES public.listas (empresa_id, projeto_id, id),
  ADD CONSTRAINT tarefas_status_do_projeto FOREIGN KEY (empresa_id, projeto_id, status_do_projeto_id, status)
    REFERENCES public.status_de_projeto (empresa_id, projeto_id, id, tipo),
  ADD CONSTRAINT tarefas_mae_da_empresa FOREIGN KEY (empresa_id, tarefa_mae_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT tarefas_nao_e_mae_dela CHECK (tarefa_mae_id IS DISTINCT FROM id);
CREATE INDEX tarefas_por_lista ON public.tarefas (empresa_id, lista_id) WHERE lista_id IS NOT NULL;
CREATE INDEX tarefas_por_status_do_projeto ON public.tarefas (empresa_id, status_do_projeto_id)
  WHERE status_do_projeto_id IS NOT NULL;
CREATE INDEX tarefas_por_mae ON public.tarefas (empresa_id, tarefa_mae_id) WHERE tarefa_mae_id IS NOT NULL;
COMMENT ON COLUMN public.tarefas.lista_id IS '[sistema] Lista do projeto. Tarefa de projeto sempre tem; sem projeto, vazio.';
COMMENT ON COLUMN public.tarefas.status_do_projeto_id IS '[sistema] Status do projeto, sempre do mesmo tipo de status. Sem projeto, vazio.';
COMMENT ON COLUMN public.tarefas.tarefa_mae_id IS '[sistema] Tarefa-mãe, quando é uma subtarefa (um nível só).';

-- Antes de gravar a tarefa: subtarefa segue a mãe (projeto e lista, um nível só); tarefa de projeto sempre tem
-- lista e status do projeto do tipo certo; sem projeto, nenhum dos dois.
CREATE FUNCTION public.acertar_tarefa() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    mae record;
  BEGIN
    IF NEW.tarefa_mae_id IS NOT NULL THEN
      SELECT t.projeto_id, t.lista_id, t.tarefa_mae_id INTO mae
        FROM public.tarefas t WHERE t.id = NEW.tarefa_mae_id AND t.empresa_id = NEW.empresa_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'tarefa-mãe não encontrada' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF mae.tarefa_mae_id IS NOT NULL THEN
        RAISE EXCEPTION 'subtarefa não tem subtarefas (um nível só)' USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.tarefas f WHERE f.empresa_id = NEW.empresa_id AND f.tarefa_mae_id = NEW.id) THEN
        RAISE EXCEPTION 'tarefa com subtarefas não vira subtarefa (um nível só)' USING ERRCODE = 'check_violation';
      END IF;
      NEW.projeto_id := mae.projeto_id;
      NEW.lista_id := mae.lista_id;
    END IF;
    IF NEW.projeto_id IS NULL THEN
      NEW.lista_id := NULL;
      NEW.status_do_projeto_id := NULL;
      RETURN NEW;
    END IF;
    IF NEW.lista_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.listas l WHERE l.id = NEW.lista_id AND l.projeto_id = NEW.projeto_id) THEN
      SELECT l.id INTO NEW.lista_id FROM public.listas l
       WHERE l.projeto_id = NEW.projeto_id AND l.empresa_id = NEW.empresa_id ORDER BY l.ordem, l.id LIMIT 1;
    END IF;
    IF NEW.status_do_projeto_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.status_de_projeto s
                       WHERE s.id = NEW.status_do_projeto_id AND s.projeto_id = NEW.projeto_id AND s.tipo = NEW.status) THEN
      SELECT s.id INTO NEW.status_do_projeto_id FROM public.status_de_projeto s
       WHERE s.projeto_id = NEW.projeto_id AND s.empresa_id = NEW.empresa_id AND s.tipo = NEW.status
       ORDER BY s.ordem, s.id LIMIT 1;
    END IF;
    RETURN NEW;
  END
  $$;
COMMENT ON FUNCTION public.acertar_tarefa() IS
  'Antes de gravar a tarefa: subtarefa segue a mãe; tarefa de projeto ganha lista e status do projeto do tipo certo.';
CREATE TRIGGER tarefas_se_acertam BEFORE INSERT OR UPDATE OF projeto_id, lista_id, status_do_projeto_id, status, tarefa_mae_id
  ON public.tarefas FOR EACH ROW EXECUTE FUNCTION public.acertar_tarefa();

-- Depois que a mãe muda de projeto ou de lista, as subtarefas vão junto.
CREATE FUNCTION public.levar_subtarefas() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    UPDATE public.tarefas f SET projeto_id = NEW.projeto_id, lista_id = NEW.lista_id, atualizada_em = now()
     WHERE f.tarefa_mae_id = NEW.id AND f.empresa_id = NEW.empresa_id
       AND (f.projeto_id IS DISTINCT FROM NEW.projeto_id OR f.lista_id IS DISTINCT FROM NEW.lista_id);
    RETURN NULL;
  END
  $$;
COMMENT ON FUNCTION public.levar_subtarefas() IS 'Quando a tarefa-mãe muda de projeto ou de lista, as subtarefas vão junto.';
CREATE TRIGGER tarefas_levam_subtarefas AFTER UPDATE OF projeto_id, lista_id ON public.tarefas
  FOR EACH ROW WHEN (OLD.projeto_id IS DISTINCT FROM NEW.projeto_id OR OLD.lista_id IS DISTINCT FROM NEW.lista_id)
  EXECUTE FUNCTION public.levar_subtarefas();

CREATE TABLE public.itens_de_checklist (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 500),
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 100000),
  marcado boolean NOT NULL DEFAULT false,
  marcado_por_pessoa_id uuid,
  marcado_por_agente_id uuid,
  marcado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT itens_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT itens_pessoa_da_empresa FOREIGN KEY (empresa_id, marcado_por_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT itens_agente_da_empresa FOREIGN KEY (empresa_id, marcado_por_agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT itens_marcado_diz_quem CHECK (
    num_nonnulls(marcado_por_pessoa_id, marcado_por_agente_id) = (CASE WHEN marcado THEN 1 ELSE 0 END)
    AND (marcado = (marcado_em IS NOT NULL)))
);
CREATE INDEX itens_por_tarefa ON public.itens_de_checklist (empresa_id, tarefa_id, ordem);
COMMENT ON TABLE public.itens_de_checklist IS 'Itens do checklist de cada tarefa, com quem marcou e quando.';
COMMENT ON COLUMN public.itens_de_checklist.id IS '[sistema] Identificador do item (UUID v7).';
COMMENT ON COLUMN public.itens_de_checklist.empresa_id IS '[sistema] Empresa (a mesma da tarefa).';
COMMENT ON COLUMN public.itens_de_checklist.tarefa_id IS '[sistema] Tarefa do checklist.';
COMMENT ON COLUMN public.itens_de_checklist.texto IS '[empresa] O passo, numa linha.';
COMMENT ON COLUMN public.itens_de_checklist.ordem IS '[empresa] Posição no checklist, do menor para o maior.';
COMMENT ON COLUMN public.itens_de_checklist.marcado IS '[empresa] O passo foi feito.';
COMMENT ON COLUMN public.itens_de_checklist.marcado_por_pessoa_id IS '[sistema] Pessoa que marcou.';
COMMENT ON COLUMN public.itens_de_checklist.marcado_por_agente_id IS '[sistema] Agente que marcou.';
COMMENT ON COLUMN public.itens_de_checklist.marcado_em IS '[sistema] Quando foi marcado.';
COMMENT ON COLUMN public.itens_de_checklist.criado_em IS '[sistema] Quando o item foi criado.';

ALTER TABLE public.itens_de_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_de_checklist FORCE ROW LEVEL SECURITY;
CREATE POLICY itens_da_empresa_ativa ON public.itens_de_checklist
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Tempo real: lista e status avisam como "projeto"; o checklist, como "tarefa".
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
CREATE TRIGGER listas_avisam AFTER INSERT OR UPDATE OR DELETE ON public.listas
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE TRIGGER status_avisam AFTER INSERT OR UPDATE OR DELETE ON public.status_de_projeto
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE TRIGGER itens_avisam AFTER INSERT OR UPDATE OR DELETE ON public.itens_de_checklist
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();

-- Projetos que já existiam: lista "Geral", os cinco status padrão, e as tarefas acertadas.
INSERT INTO public.listas (empresa_id, projeto_id, nome) SELECT empresa_id, id, 'Geral' FROM public.projetos;
INSERT INTO public.status_de_projeto (empresa_id, projeto_id, nome, cor, tipo, ordem)
SELECT p.empresa_id, p.id, s.nome, s.cor, s.tipo, s.ordem
  FROM public.projetos p
 CROSS JOIN (VALUES ('A fazer', '#64748b', 'a_fazer', 0), ('Em andamento', '#3b82f6', 'em_andamento', 1),
                    ('Precisa de ajuda', '#ef4444', 'precisa_de_ajuda', 2), ('Concluída', '#10b981', 'concluida', 3),
                    ('Cancelada', '#94a3b8', 'cancelada', 4)) AS s (nome, cor, tipo, ordem);
UPDATE public.tarefas t SET
  lista_id = (SELECT l.id FROM public.listas l WHERE l.projeto_id = t.projeto_id LIMIT 1),
  status_do_projeto_id = (SELECT s.id FROM public.status_de_projeto s WHERE s.projeto_id = t.projeto_id AND s.tipo = t.status)
 WHERE t.projeto_id IS NOT NULL;

-- Daqui para a frente o banco confere: tarefa de projeto tem lista e status; sem projeto, nenhum dos dois.
ALTER TABLE public.tarefas ADD CONSTRAINT tarefas_projeto_completo CHECK (
  (projeto_id IS NULL AND lista_id IS NULL AND status_do_projeto_id IS NULL)
  OR (projeto_id IS NOT NULL AND lista_id IS NOT NULL AND status_do_projeto_id IS NOT NULL));

-- Down Migration

ALTER TABLE public.tarefas DROP CONSTRAINT tarefas_projeto_completo;
DROP TRIGGER itens_avisam ON public.itens_de_checklist;
DROP TRIGGER status_avisam ON public.status_de_projeto;
DROP TRIGGER listas_avisam ON public.listas;
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME = 'comentarios_de_tarefa' THEN
      tipo := 'tarefa';
      id := linha.tarefa_id;
    ELSIF TG_TABLE_NAME = 'tarefas' THEN
      tipo := 'tarefa';
      id := linha.id;
    ELSIF TG_TABLE_NAME = 'membros_de_projeto' THEN
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
DROP TABLE public.itens_de_checklist;
DROP TRIGGER tarefas_levam_subtarefas ON public.tarefas;
DROP FUNCTION public.levar_subtarefas();
DROP TRIGGER tarefas_se_acertam ON public.tarefas;
DROP FUNCTION public.acertar_tarefa();
DROP INDEX public.tarefas_por_mae;
DROP INDEX public.tarefas_por_status_do_projeto;
DROP INDEX public.tarefas_por_lista;
ALTER TABLE public.tarefas
  DROP CONSTRAINT tarefas_nao_e_mae_dela,
  DROP CONSTRAINT tarefas_mae_da_empresa,
  DROP CONSTRAINT tarefas_status_do_projeto,
  DROP CONSTRAINT tarefas_lista_do_projeto,
  DROP COLUMN tarefa_mae_id,
  DROP COLUMN status_do_projeto_id,
  DROP COLUMN lista_id;
DROP TABLE public.status_de_projeto;
DROP TABLE public.listas;
