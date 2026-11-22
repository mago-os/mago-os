-- M5-02: conversa com o coordenador pelo Telegram (contrato em contratos/src/agentes/internos.ts, decisão 0033).
-- 1. conversas.canal: onde a conversa começou (app ou telegram).
-- 2. mensagens_de_conversa.canal: por onde a mensagem passou; a resposta do agente vai pelo canal da última mensagem
--    da pessoa. telegram_pendente marca o que falta mandar ao Telegram; telegram_enviada_em, quando foi.
-- 3. vinculos_do_telegram.conversa_id: a conversa atual pelo Telegram (a próxima mensagem continua nela).
-- 4. vincular_telegram() de novo zera a conversa atual (ela era da empresa anterior).
-- 5. empresas_com_telegram_pendente(): para a verificação a cada minuto achar o que ficou para trás.
-- Explicado em docs/banco/decisoes.md, seção 43.

-- Up Migration

ALTER TABLE public.conversas
  ADD COLUMN canal text NOT NULL DEFAULT 'app' CHECK (canal IN ('app', 'telegram'));
COMMENT ON COLUMN public.conversas.canal IS '[sistema] Onde a conversa começou: app ou telegram.';

ALTER TABLE public.mensagens_de_conversa
  ADD COLUMN canal text NOT NULL DEFAULT 'app' CHECK (canal IN ('app', 'telegram')),
  ADD COLUMN telegram_pendente boolean NOT NULL DEFAULT false,
  ADD COLUMN telegram_enviada_em timestamptz,
  ADD CONSTRAINT mensagens_telegram_pelo_canal CHECK (NOT telegram_pendente OR canal = 'telegram');
CREATE INDEX mensagens_para_o_telegram ON public.mensagens_de_conversa (empresa_id, criada_em)
  WHERE telegram_pendente;
COMMENT ON COLUMN public.mensagens_de_conversa.canal IS
  '[sistema] Por onde a mensagem passou: app ou telegram (a do agente vai pelo canal da última mensagem da pessoa).';
COMMENT ON COLUMN public.mensagens_de_conversa.telegram_pendente IS
  '[sistema] Falta mandar esta mensagem ao Telegram da pessoa.';
COMMENT ON COLUMN public.mensagens_de_conversa.telegram_enviada_em IS '[sistema] Quando foi mandada ao Telegram.';

ALTER TABLE public.vinculos_do_telegram
  ADD COLUMN conversa_id uuid,
  ADD CONSTRAINT vinculos_do_telegram_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas (empresa_id, id) ON DELETE SET NULL (conversa_id);
COMMENT ON COLUMN public.vinculos_do_telegram.conversa_id IS
  '[sistema] A conversa atual pelo Telegram (vazio: a próxima mensagem começa uma nova).';

-- Vincular de novo (outra empresa, outro código) começa sem conversa atual: ela era da empresa anterior.
CREATE OR REPLACE FUNCTION public.vincular_telegram(resumo_do_codigo text, conta bigint, chat bigint, usuario_tg text, nome_tg text)
  RETURNS TABLE (pessoa_id uuid, empresa_id uuid, pessoa_nome text, empresa_nome text,
                 tirada_de uuid, tirada_de_empresa uuid, trocou_conta boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    c public.codigos_do_telegram;
    antes public.vinculos_do_telegram;
    da_pessoa boolean := false;
  BEGIN
    UPDATE public.codigos_do_telegram k SET usado_em = now()
     WHERE k.resumo = resumo_do_codigo AND k.usado_em IS NULL AND k.vence_em > now()
       AND EXISTS (SELECT 1 FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
                     JOIN public.pessoas p ON p.id = v.pessoa_id
                    WHERE v.empresa_id = k.empresa_id AND v.pessoa_id = k.pessoa_id AND v.situacao = 'ativo'
                      AND e.situacao = 'ativa' AND p.situacao = 'ativa')
    RETURNING * INTO c;
    IF c.id IS NULL THEN RETURN; END IF;
    SELECT * INTO antes FROM public.vinculos_do_telegram t WHERE t.telegram_id = conta AND t.pessoa_id <> c.pessoa_id;
    DELETE FROM public.vinculos_do_telegram t WHERE t.telegram_id = conta AND t.pessoa_id <> c.pessoa_id;
    DELETE FROM public.vinculos_do_telegram t WHERE t.pessoa_id = c.pessoa_id AND t.telegram_id <> conta;
    da_pessoa := FOUND;
    INSERT INTO public.vinculos_do_telegram AS t (empresa_id, pessoa_id, telegram_id, chat_id, usuario, nome)
    VALUES (c.empresa_id, c.pessoa_id, conta, chat, nullif(usuario_tg, ''), nome_tg)
    ON CONFLICT ON CONSTRAINT vinculos_do_telegram_um_por_pessoa DO UPDATE
      SET empresa_id = EXCLUDED.empresa_id, chat_id = EXCLUDED.chat_id, usuario = EXCLUDED.usuario,
          nome = EXCLUDED.nome, vinculado_em = now(), conversa_id = NULL;
    RETURN QUERY
      SELECT c.pessoa_id, c.empresa_id, p.nome, e.nome, antes.pessoa_id, antes.empresa_id, da_pessoa
        FROM public.pessoas p, public.empresas e WHERE p.id = c.pessoa_id AND e.id = c.empresa_id;
  END
  $$;

-- Empresas com mensagem esperando para ir ao Telegram (só ids), para a verificação a cada minuto.
CREATE FUNCTION public.empresas_com_telegram_pendente() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT DISTINCT m.empresa_id FROM public.mensagens_de_conversa m WHERE m.telegram_pendente LIMIT 100 $$;
COMMENT ON FUNCTION public.empresas_com_telegram_pendente() IS
  'Empresas com mensagem de conversa esperando para ir ao Telegram. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_telegram_pendente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_telegram_pendente() TO mago_app;

-- Down Migration

DROP FUNCTION public.empresas_com_telegram_pendente();
CREATE OR REPLACE FUNCTION public.vincular_telegram(resumo_do_codigo text, conta bigint, chat bigint, usuario_tg text, nome_tg text)
  RETURNS TABLE (pessoa_id uuid, empresa_id uuid, pessoa_nome text, empresa_nome text,
                 tirada_de uuid, tirada_de_empresa uuid, trocou_conta boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    c public.codigos_do_telegram;
    antes public.vinculos_do_telegram;
    da_pessoa boolean := false;
  BEGIN
    UPDATE public.codigos_do_telegram k SET usado_em = now()
     WHERE k.resumo = resumo_do_codigo AND k.usado_em IS NULL AND k.vence_em > now()
       AND EXISTS (SELECT 1 FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
                     JOIN public.pessoas p ON p.id = v.pessoa_id
                    WHERE v.empresa_id = k.empresa_id AND v.pessoa_id = k.pessoa_id AND v.situacao = 'ativo'
                      AND e.situacao = 'ativa' AND p.situacao = 'ativa')
    RETURNING * INTO c;
    IF c.id IS NULL THEN RETURN; END IF;
    SELECT * INTO antes FROM public.vinculos_do_telegram t WHERE t.telegram_id = conta AND t.pessoa_id <> c.pessoa_id;
    DELETE FROM public.vinculos_do_telegram t WHERE t.telegram_id = conta AND t.pessoa_id <> c.pessoa_id;
    DELETE FROM public.vinculos_do_telegram t WHERE t.pessoa_id = c.pessoa_id AND t.telegram_id <> conta;
    da_pessoa := FOUND;
    INSERT INTO public.vinculos_do_telegram AS t (empresa_id, pessoa_id, telegram_id, chat_id, usuario, nome)
    VALUES (c.empresa_id, c.pessoa_id, conta, chat, nullif(usuario_tg, ''), nome_tg)
    ON CONFLICT ON CONSTRAINT vinculos_do_telegram_um_por_pessoa DO UPDATE
      SET empresa_id = EXCLUDED.empresa_id, chat_id = EXCLUDED.chat_id, usuario = EXCLUDED.usuario,
          nome = EXCLUDED.nome, vinculado_em = now();
    RETURN QUERY
      SELECT c.pessoa_id, c.empresa_id, p.nome, e.nome, antes.pessoa_id, antes.empresa_id, da_pessoa
        FROM public.pessoas p, public.empresas e WHERE p.id = c.pessoa_id AND e.id = c.empresa_id;
  END
  $$;
ALTER TABLE public.vinculos_do_telegram DROP CONSTRAINT vinculos_do_telegram_conversa, DROP COLUMN conversa_id;
DROP INDEX public.mensagens_para_o_telegram;
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_telegram_pelo_canal,
  DROP COLUMN telegram_enviada_em, DROP COLUMN telegram_pendente, DROP COLUMN canal;
ALTER TABLE public.conversas DROP COLUMN canal;
