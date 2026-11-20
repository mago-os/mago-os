-- M3-08: anexos das tarefas e dos comentários (contrato em contratos/src/tarefas/anexos.ts).
--
-- 1. anexos: o registro de cada arquivo. O arquivo fica no depósito (Backblaze B2 em teste e produção), com o caminho
--    separado por empresa: primeiro na quarentena, e só depois do antivírus no lugar definitivo.
-- 2. arquivos_para_apagar: quando um anexo some do banco (excluído, ou junto com a tarefa ou o comentário), o caminho
--    entra aqui, e a fila apaga o arquivo do depósito. Assim nenhum arquivo fica perdido no depósito.
-- 3. Funções do dono, só com ids, para a fila achar o trabalho de cada empresa (como as do push, na 0022).
-- Explicado em docs/banco/decisoes.md, seção 28.

-- Up Migration

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos
  ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
    'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
    'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado'));

ALTER TABLE public.comentarios_de_tarefa
  ADD CONSTRAINT comentarios_id_da_tarefa UNIQUE (empresa_id, tarefa_id, id);

CREATE TABLE public.anexos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL,
  comentario_id uuid,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' AND length(tipo) <= 120),
  tamanho bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 26214400),
  situacao text NOT NULL DEFAULT 'enviando' CHECK (situacao IN ('enviando', 'verificando', 'disponivel', 'bloqueado')),
  caminho text NOT NULL CHECK (length(caminho) BETWEEN 1 AND 300),
  enviado_por_pessoa_id uuid,
  enviado_por_agente_id uuid,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  verificado_em timestamptz,
  achado_do_antivirus text CHECK (length(achado_do_antivirus) <= 200),
  CONSTRAINT anexos_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT anexos_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT anexos_do_comentario FOREIGN KEY (empresa_id, tarefa_id, comentario_id)
    REFERENCES public.comentarios_de_tarefa (empresa_id, tarefa_id, id) ON DELETE CASCADE,
  CONSTRAINT anexos_pessoa_da_empresa FOREIGN KEY (empresa_id, enviado_por_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT anexos_agente_da_empresa FOREIGN KEY (empresa_id, enviado_por_agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT anexos_um_autor CHECK (num_nonnulls(enviado_por_pessoa_id, enviado_por_agente_id) <= 1),
  CONSTRAINT anexos_verificado CHECK ((situacao IN ('disponivel', 'bloqueado')) = (verificado_em IS NOT NULL))
);
CREATE INDEX anexos_por_tarefa ON public.anexos (empresa_id, tarefa_id, enviado_em);
CREATE INDEX anexos_esperando ON public.anexos (empresa_id, situacao) WHERE situacao IN ('enviando', 'verificando');
COMMENT ON TABLE public.anexos IS 'Arquivos anexados às tarefas e aos comentários. O arquivo fica no depósito; aqui ficam os dados e a situação.';
COMMENT ON COLUMN public.anexos.id IS '[sistema] Identificador do anexo (UUID v7).';
COMMENT ON COLUMN public.anexos.empresa_id IS '[sistema] Empresa do anexo.';
COMMENT ON COLUMN public.anexos.tarefa_id IS '[sistema] Tarefa do anexo (o anexo some junto com ela).';
COMMENT ON COLUMN public.anexos.comentario_id IS '[sistema] Comentário do anexo, quando é de um comentário (some junto com ele).';
COMMENT ON COLUMN public.anexos.nome IS '[empresa] Nome do arquivo, como veio do aparelho.';
COMMENT ON COLUMN public.anexos.tipo IS '[empresa] Tipo do arquivo (MIME).';
COMMENT ON COLUMN public.anexos.tamanho IS '[empresa] Tamanho em bytes (até 25 MB).';
COMMENT ON COLUMN public.anexos.situacao IS '[sistema] enviando, verificando (antivírus), disponivel ou bloqueado.';
COMMENT ON COLUMN public.anexos.caminho IS '[sistema] Caminho do arquivo no depósito (separado por empresa; na quarentena até o antivírus liberar).';
COMMENT ON COLUMN public.anexos.enviado_por_pessoa_id IS '[sistema] Pessoa que enviou.';
COMMENT ON COLUMN public.anexos.enviado_por_agente_id IS '[sistema] Agente que enviou (Fase 2).';
COMMENT ON COLUMN public.anexos.enviado_em IS '[sistema] Quando o envio começou.';
COMMENT ON COLUMN public.anexos.verificado_em IS '[sistema] Quando o antivírus terminou.';
COMMENT ON COLUMN public.anexos.achado_do_antivirus IS '[sistema] O que o antivírus achou, quando bloqueou (nome da ameaça).';
ALTER TABLE public.anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anexos FORCE ROW LEVEL SECURITY;
CREATE POLICY anexos_da_empresa_ativa ON public.anexos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
-- A API muda só a situação (e o caminho, quando o antivírus libera): o resto do anexo não muda depois de criado.
REVOKE UPDATE ON public.anexos FROM mago_app;
GRANT UPDATE (situacao, caminho, verificado_em, achado_do_antivirus) ON public.anexos TO mago_app;

CREATE TABLE public.arquivos_para_apagar (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  caminho text NOT NULL CHECK (length(caminho) BETWEEN 1 AND 300),
  desde timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX arquivos_para_apagar_por_empresa ON public.arquivos_para_apagar (empresa_id);
COMMENT ON TABLE public.arquivos_para_apagar IS 'Arquivos do depósito que precisam ser apagados (anexo excluído, ou junto com a tarefa ou o comentário). A fila apaga.';
COMMENT ON COLUMN public.arquivos_para_apagar.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.arquivos_para_apagar.empresa_id IS '[sistema] Empresa do arquivo.';
COMMENT ON COLUMN public.arquivos_para_apagar.caminho IS '[sistema] Caminho no depósito.';
COMMENT ON COLUMN public.arquivos_para_apagar.desde IS '[sistema] Desde quando espera.';
ALTER TABLE public.arquivos_para_apagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arquivos_para_apagar FORCE ROW LEVEL SECURITY;
CREATE POLICY arquivos_para_apagar_da_empresa_ativa ON public.arquivos_para_apagar
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Anexo que sai do banco (por qualquer caminho, inclusive em cascata) deixa o arquivo para a fila apagar.
CREATE FUNCTION public.anexo_deixa_arquivo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    -- Empresa sendo excluída: os arquivos dela saem pelo prefixo empresas/<empresa>/ no fim da conta (Fase 2), e o
    -- registro aqui iria junto com ela.
    IF EXISTS (SELECT 1 FROM public.empresas WHERE id = OLD.empresa_id) THEN
      INSERT INTO public.arquivos_para_apagar (empresa_id, caminho) VALUES (OLD.empresa_id, OLD.caminho);
    END IF;
    RETURN OLD;
  END
  $$;
CREATE TRIGGER anexos_deixam_arquivo AFTER DELETE ON public.anexos
  FOR EACH ROW EXECUTE FUNCTION public.anexo_deixa_arquivo();

-- Tempo real: anexo novo ou que mudou de situação avisa as telas da tarefa.
CREATE TRIGGER anexos_avisam AFTER INSERT OR UPDATE OR DELETE ON public.anexos
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca();
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME IN ('comentarios_de_tarefa', 'itens_de_checklist', 'etiquetas_de_tarefa', 'acontecimentos_de_tarefa', 'anexos') THEN
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
    ELSIF TG_TABLE_NAME = 'avisos' THEN
      tipo := 'aviso';
      id := linha.pessoa_id;
    ELSE
      tipo := 'agente';
      id := linha.id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', tipo, 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;

-- Para a fila: empresas com anexo esperando o antivírus, com envio parado há mais de uma hora, ou com arquivo para
-- apagar. E o espaço total dos anexos (para o aviso de espaço). Só ids e números.
CREATE FUNCTION public.empresas_com_anexos_para_cuidar()
  RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT a.empresa_id FROM public.anexos a
     WHERE a.situacao = 'verificando' OR (a.situacao = 'enviando' AND a.enviado_em < now() - interval '1 hour')
    UNION
    SELECT p.empresa_id FROM public.arquivos_para_apagar p
  $$;
COMMENT ON FUNCTION public.empresas_com_anexos_para_cuidar() IS 'Para a fila dos anexos: empresas com antivírus, envio parado ou arquivo para apagar. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_anexos_para_cuidar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_anexos_para_cuidar() TO mago_app;

CREATE FUNCTION public.espaco_total_dos_anexos() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(sum(tamanho), 0)::bigint FROM public.anexos WHERE situacao IN ('verificando', 'disponivel')
  $$;
COMMENT ON FUNCTION public.espaco_total_dos_anexos() IS 'Bytes ocupados pelos anexos de todas as empresas (para o aviso de espaço). Só o número.';
REVOKE EXECUTE ON FUNCTION public.espaco_total_dos_anexos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.espaco_total_dos_anexos() TO mago_app;

-- Down Migration

DROP FUNCTION public.espaco_total_dos_anexos();
DROP FUNCTION public.empresas_com_anexos_para_cuidar();
CREATE OR REPLACE FUNCTION public.avisar_mudanca() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    tipo text;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME IN ('comentarios_de_tarefa', 'itens_de_checklist', 'etiquetas_de_tarefa', 'acontecimentos_de_tarefa') THEN
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
    ELSIF TG_TABLE_NAME = 'avisos' THEN
      tipo := 'aviso';
      id := linha.pessoa_id;
    ELSE
      tipo := 'agente';
      id := linha.id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', tipo, 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;
DROP TABLE public.anexos;
DROP FUNCTION public.anexo_deixa_arquivo();
DROP TABLE public.arquivos_para_apagar;
ALTER TABLE public.comentarios_de_tarefa DROP CONSTRAINT comentarios_id_da_tarefa;
DELETE FROM public.avisos WHERE tipo = 'anexo_bloqueado';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos
  ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
    'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
    'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido'));
