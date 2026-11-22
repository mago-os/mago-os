-- M5-08: avisos e resumo do dia pelo Telegram (contrato em contratos/src/avisos/notificacoes.ts, decisão 0037).
-- 1. avisos.telegram_pendente: o aviso novo espera a verificação do Telegram (canal, vínculo, silêncio). Os avisos
--    que já existem não vão.
-- 2. vinculos_do_telegram.resumo_do_dia_em: o último dia (no fuso da pessoa) em que o resumo foi.
-- 3. marcar_resumo_do_dia_no_telegram(): a verificação do sistema marca o dia (a política do vínculo é da pessoa).
-- 4. empresas_com_telegram_pendente() acha também os avisos esperando; empresas_com_telegram() dá a lista para o
--    resumo do dia, num laço próprio.
-- Explicado em docs/banco/decisoes.md, seção 47.

-- Up Migration

ALTER TABLE public.avisos ADD COLUMN telegram_pendente boolean NOT NULL DEFAULT false;
ALTER TABLE public.avisos ALTER COLUMN telegram_pendente SET DEFAULT true;
COMMENT ON COLUMN public.avisos.telegram_pendente IS
  '[sistema] O aviso ainda espera a verificação do Telegram (se o tipo vai por lá, o vínculo e o silêncio).';
CREATE INDEX avisos_para_o_telegram ON public.avisos (empresa_id, pessoa_id, criado_em) WHERE telegram_pendente;

ALTER TABLE public.vinculos_do_telegram ADD COLUMN resumo_do_dia_em date;
COMMENT ON COLUMN public.vinculos_do_telegram.resumo_do_dia_em IS
  '[sistema] O último dia, no fuso da pessoa, em que o resumo do dia foi pelo Telegram (ou foi pulado).';

-- Marca o dia do resumo (o vínculo é da pessoa; a verificação do sistema não tem pessoa no pedido).
CREATE FUNCTION public.marcar_resumo_do_dia_no_telegram(pessoa uuid, dia date) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE public.vinculos_do_telegram SET resumo_do_dia_em = dia
     WHERE empresa_id = public.empresa_ativa() AND pessoa_id = pessoa AND public.pessoa_ativa() IS NULL
  $$;
COMMENT ON FUNCTION public.marcar_resumo_do_dia_no_telegram(uuid, date) IS
  'Marca o dia em que o resumo do dia foi pelo Telegram (na empresa ativa). Só o sistema (sem pessoa no pedido).';

-- As empresas com alguém no Telegram (só ids), para a verificação do resumo do dia.
CREATE FUNCTION public.empresas_com_telegram() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT DISTINCT t.empresa_id FROM public.vinculos_do_telegram t $$;
COMMENT ON FUNCTION public.empresas_com_telegram() IS 'Empresas com pelo menos um Telegram vinculado. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_telegram() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_telegram() TO mago_app;
REVOKE EXECUTE ON FUNCTION public.marcar_resumo_do_dia_no_telegram(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_resumo_do_dia_no_telegram(uuid, date) TO mago_app;

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
    UNION
    SELECT p.empresa_id FROM public.aprovacoes p
      JOIN public.agentes g ON g.id = p.agente_id AND g.empresa_id = p.empresa_id
      JOIN public.vinculos_do_telegram t ON t.empresa_id = p.empresa_id
       AND t.pessoa_id IN (p.pedido_por, g.responsavel_id)
     WHERE p.situacao = 'pendente' AND p.vence_em > now()
       AND NOT EXISTS (SELECT 1 FROM public.aprovacoes_no_telegram n WHERE n.empresa_id = p.empresa_id
                        AND n.aprovacao_id = p.id AND n.pessoa_id = t.pessoa_id)
    UNION
    SELECT n.empresa_id FROM public.aprovacoes_no_telegram n JOIN public.aprovacoes p
        ON p.id = n.aprovacao_id AND p.empresa_id = n.empresa_id
     WHERE n.atualizada_em IS NULL AND n.mensagem_id IS NOT NULL
       AND (p.situacao IN ('recusada', 'vencida', 'falhou') OR (p.situacao = 'aprovada' AND p.resultado IS NOT NULL)
            OR (p.situacao = 'pendente' AND p.vence_em <= now()))
    UNION
    SELECT n.empresa_id FROM public.aprovacoes_no_telegram n
     WHERE n.mensagem_id IS NULL AND n.enviada_em < now() - interval '5 minutes'
    UNION
    SELECT a.empresa_id FROM public.avisos a WHERE a.telegram_pendente
    LIMIT 100
  $$;

-- Down Migration

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
    UNION
    SELECT p.empresa_id FROM public.aprovacoes p
      JOIN public.agentes g ON g.id = p.agente_id AND g.empresa_id = p.empresa_id
      JOIN public.vinculos_do_telegram t ON t.empresa_id = p.empresa_id
       AND t.pessoa_id IN (p.pedido_por, g.responsavel_id)
     WHERE p.situacao = 'pendente' AND p.vence_em > now()
       AND NOT EXISTS (SELECT 1 FROM public.aprovacoes_no_telegram n WHERE n.empresa_id = p.empresa_id
                        AND n.aprovacao_id = p.id AND n.pessoa_id = t.pessoa_id)
    UNION
    SELECT n.empresa_id FROM public.aprovacoes_no_telegram n JOIN public.aprovacoes p
        ON p.id = n.aprovacao_id AND p.empresa_id = n.empresa_id
     WHERE n.atualizada_em IS NULL AND n.mensagem_id IS NOT NULL
       AND (p.situacao IN ('recusada', 'vencida', 'falhou') OR (p.situacao = 'aprovada' AND p.resultado IS NOT NULL)
            OR (p.situacao = 'pendente' AND p.vence_em <= now()))
    UNION
    SELECT n.empresa_id FROM public.aprovacoes_no_telegram n
     WHERE n.mensagem_id IS NULL AND n.enviada_em < now() - interval '5 minutes'
    LIMIT 100
  $$;
DROP FUNCTION public.empresas_com_telegram();
DROP FUNCTION public.marcar_resumo_do_dia_no_telegram(uuid, date);
ALTER TABLE public.vinculos_do_telegram DROP COLUMN resumo_do_dia_em;
DROP INDEX public.avisos_para_o_telegram;
ALTER TABLE public.avisos DROP COLUMN telegram_pendente;
