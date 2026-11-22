-- M5-03: arquivos mandados pelo Telegram (contrato em contratos/src/canais/telegram.ts, decisão 0034).
-- 1. arquivos_do_telegram: o arquivo recebido espera uma tarefa por até 24 horas, sem ser baixado. Ao anexar, vira
--    um anexo comum (M3-08), que passa pelo antivírus; o bloqueio é avisado no Telegram uma vez.
-- 2. empresas_com_telegram_pendente() passa a achar também os arquivos vencidos e os anexos com o antivírus a conferir.
-- Explicado em docs/banco/decisoes.md, seção 44.

-- Up Migration

CREATE TABLE public.arquivos_do_telegram (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' AND length(tipo) <= 120),
  tamanho bigint CHECK (tamanho BETWEEN 0 AND 20971520),
  id_no_telegram text NOT NULL CHECK (length(id_no_telegram) BETWEEN 1 AND 300),
  situacao text NOT NULL DEFAULT 'esperando' CHECK (situacao IN ('esperando', 'anexado', 'vencido')),
  anexo_id uuid,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  vence_em timestamptz NOT NULL,
  antivirus_conferido_em timestamptz,
  CONSTRAINT arquivos_do_telegram_vence_depois CHECK (vence_em > recebido_em),
  CONSTRAINT arquivos_do_telegram_anexado CHECK ((situacao = 'anexado') = (anexo_id IS NOT NULL)),
  CONSTRAINT arquivos_do_telegram_da_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT arquivos_do_telegram_anexo FOREIGN KEY (empresa_id, anexo_id)
    REFERENCES public.anexos (empresa_id, id) ON DELETE SET NULL (anexo_id)
);
-- Anexo apagado (a tarefa foi excluída): o arquivo fica como vencido, sem anexo.
CREATE FUNCTION public.arquivo_do_telegram_sem_anexo() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    IF NEW.situacao = 'anexado' AND NEW.anexo_id IS NULL THEN NEW.situacao := 'vencido'; END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER arquivo_do_telegram_sem_anexo BEFORE UPDATE OF anexo_id ON public.arquivos_do_telegram
  FOR EACH ROW EXECUTE FUNCTION public.arquivo_do_telegram_sem_anexo();
CREATE INDEX arquivos_do_telegram_esperando ON public.arquivos_do_telegram (empresa_id, pessoa_id, recebido_em DESC)
  WHERE situacao = 'esperando';
CREATE INDEX arquivos_do_telegram_a_avisar ON public.arquivos_do_telegram (empresa_id)
  WHERE situacao = 'anexado' AND antivirus_conferido_em IS NULL;
COMMENT ON TABLE public.arquivos_do_telegram IS
  'Arquivos mandados pelo Telegram, esperando uma tarefa por até 24 horas (M5-03). Ao anexar, viram anexo comum.';
COMMENT ON COLUMN public.arquivos_do_telegram.id IS '[sistema] Identificador (vai ao agente para anexar).';
COMMENT ON COLUMN public.arquivos_do_telegram.empresa_id IS '[sistema] Empresa da conversa pelo Telegram.';
COMMENT ON COLUMN public.arquivos_do_telegram.pessoa_id IS '[sistema] Quem mandou o arquivo.';
COMMENT ON COLUMN public.arquivos_do_telegram.nome IS '[empresa] Nome do arquivo (o do aparelho, ou foto-<data>.jpg).';
COMMENT ON COLUMN public.arquivos_do_telegram.tipo IS '[sistema] Tipo do arquivo (MIME).';
COMMENT ON COLUMN public.arquivos_do_telegram.tamanho IS '[sistema] Bytes, quando o Telegram informa.';
COMMENT ON COLUMN public.arquivos_do_telegram.id_no_telegram IS
  '[sensivel] Número do arquivo no Telegram (com ele e o token do bot, dá para baixar).';
COMMENT ON COLUMN public.arquivos_do_telegram.situacao IS
  '[sistema] esperando (sem tarefa), anexado (virou anexo) ou vencido (passou das 24 horas).';
COMMENT ON COLUMN public.arquivos_do_telegram.anexo_id IS '[sistema] O anexo que o arquivo virou.';
COMMENT ON COLUMN public.arquivos_do_telegram.recebido_em IS '[sistema] Quando chegou.';
COMMENT ON COLUMN public.arquivos_do_telegram.vence_em IS '[sistema] Até quando espera uma tarefa.';
COMMENT ON COLUMN public.arquivos_do_telegram.antivirus_conferido_em IS
  '[sistema] Quando o resultado do antivírus do anexo foi conferido (e, se bloqueou, avisado no Telegram).';
ALTER TABLE public.arquivos_do_telegram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arquivos_do_telegram FORCE ROW LEVEL SECURITY;
CREATE POLICY arquivos_do_telegram_da_empresa_ativa ON public.arquivos_do_telegram
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE DELETE ON public.arquivos_do_telegram FROM mago_app;

-- Empresas com algo do Telegram a cuidar: resposta a mandar, arquivo vencido ou bloqueio a avisar (só ids).
CREATE OR REPLACE FUNCTION public.empresas_com_telegram_pendente() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT m.empresa_id FROM public.mensagens_de_conversa m WHERE m.telegram_pendente
    UNION
    SELECT a.empresa_id FROM public.arquivos_do_telegram a
     WHERE a.situacao = 'esperando' AND a.vence_em < now()
       AND NOT EXISTS (SELECT 1 FROM public.aprovacoes p WHERE p.empresa_id = a.empresa_id
                        AND p.acao = 'anexar_arquivo' AND p.situacao = 'pendente'
                        AND p.parametros ->> 'arquivoId' = a.id::text)
    UNION
    SELECT a.empresa_id FROM public.arquivos_do_telegram a JOIN public.anexos x
        ON x.id = a.anexo_id AND x.empresa_id = a.empresa_id
     WHERE a.situacao = 'anexado' AND a.antivirus_conferido_em IS NULL AND x.situacao IN ('bloqueado', 'disponivel')
    LIMIT 100
  $$;

-- Down Migration

CREATE OR REPLACE FUNCTION public.empresas_com_telegram_pendente() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT DISTINCT m.empresa_id FROM public.mensagens_de_conversa m WHERE m.telegram_pendente LIMIT 100 $$;
DROP TABLE public.arquivos_do_telegram;
DROP FUNCTION public.arquivo_do_telegram_sem_anexo();
