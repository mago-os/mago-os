-- M5-01: bot do Telegram e vínculo da conta por código (contrato em contratos/src/canais/telegram.ts, decisão 0032).
-- 1. vinculos_do_telegram: a conta do Telegram de cada pessoa (uma de cada lado) e a empresa da conversa por lá.
-- 2. codigos_do_telegram: o código de vínculo de uso único (só o resumo), com a pessoa e a empresa em que foi gerado.
-- 3. Esquema telegram (sem acesso direto da API): as atualizações já tratadas, os códigos errados e as mensagens
--    por minuto de cada conta do Telegram. Só pelas funções abaixo.
-- 4. A mensagem que chega ainda não sabe a empresa: reconhecer_telegram() e vincular_telegram() (SECURITY DEFINER),
--    como reconhecer_chave() na migração 0016.
-- 5. Desligar a pessoa da empresa do Telegram corta o vínculo do Telegram na hora (gatilho em vinculos).
-- 6. Um tipo de aviso novo: telegram_desvinculado (a conta do Telegram passou para outra pessoa).
-- Explicado em docs/banco/decisoes.md, seção 42.

-- Up Migration

CREATE TABLE public.vinculos_do_telegram (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL CHECK (telegram_id > 0),
  chat_id bigint NOT NULL,
  usuario text CHECK (length(usuario) BETWEEN 1 AND 64),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  vinculado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vinculos_do_telegram_um_por_pessoa UNIQUE (pessoa_id),
  CONSTRAINT vinculos_do_telegram_uma_pessoa_por_conta UNIQUE (telegram_id),
  CONSTRAINT vinculos_do_telegram_vinculo FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.vinculos_do_telegram IS
  'A conta do Telegram de cada pessoa (uma de cada lado, na plataforma toda) e a empresa da conversa por lá (M5-01).';
COMMENT ON COLUMN public.vinculos_do_telegram.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.vinculos_do_telegram.empresa_id IS
  '[sistema] Empresa da conversa pelo Telegram (a pessoa precisa ter vínculo ativo nela).';
COMMENT ON COLUMN public.vinculos_do_telegram.pessoa_id IS '[sistema] Pessoa dona da conta do Telegram.';
COMMENT ON COLUMN public.vinculos_do_telegram.telegram_id IS '[pessoal] Número da conta no Telegram.';
COMMENT ON COLUMN public.vinculos_do_telegram.chat_id IS '[pessoal] Número da conversa individual com o bot.';
COMMENT ON COLUMN public.vinculos_do_telegram.usuario IS '[pessoal] O @usuário no Telegram, se houver.';
COMMENT ON COLUMN public.vinculos_do_telegram.nome IS '[pessoal] Nome que a pessoa usa no Telegram.';
COMMENT ON COLUMN public.vinculos_do_telegram.vinculado_em IS '[sistema] Quando a conta foi vinculada.';
ALTER TABLE public.vinculos_do_telegram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vinculos_do_telegram FORCE ROW LEVEL SECURITY;
-- A empresa vê os vínculos dela; a pessoa vê e mexe no próprio, de qualquer empresa (Meu perfil, /empresa, /sair).
CREATE POLICY vinculos_do_telegram_da_empresa_ou_da_pessoa ON public.vinculos_do_telegram
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (pessoa_id = public.pessoa_ativa());
-- Criar é só por vincular_telegram() (o código conferido); a API só troca a empresa e apaga.
REVOKE INSERT ON public.vinculos_do_telegram FROM mago_app;

-- A empresa da conversa precisa ter vínculo ativo da pessoa (a chave estrangeira não olha a situação).
CREATE FUNCTION public.conferir_empresa_do_telegram() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
                    WHERE v.empresa_id = NEW.empresa_id AND v.pessoa_id = NEW.pessoa_id
                      AND v.situacao = 'ativo' AND e.situacao = 'ativa') THEN
      RAISE EXCEPTION 'Telegram: a pessoa não está ativa nessa empresa' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER conferir_empresa_do_telegram BEFORE INSERT OR UPDATE OF empresa_id, pessoa_id
  ON public.vinculos_do_telegram FOR EACH ROW EXECUTE FUNCTION public.conferir_empresa_do_telegram();

CREATE TABLE public.codigos_do_telegram (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  resumo text NOT NULL UNIQUE CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  vence_em timestamptz NOT NULL,
  usado_em timestamptz,
  CONSTRAINT codigos_do_telegram_vence_depois CHECK (vence_em > criado_em)
);
CREATE UNIQUE INDEX codigos_do_telegram_um_aberto ON public.codigos_do_telegram (pessoa_id) WHERE usado_em IS NULL;
COMMENT ON TABLE public.codigos_do_telegram IS
  'Códigos de vínculo do Telegram (M5-01): de uso único, valem 10 minutos; só o resumo fica guardado.';
COMMENT ON COLUMN public.codigos_do_telegram.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.codigos_do_telegram.empresa_id IS '[sistema] Empresa ativa quando o código foi gerado.';
COMMENT ON COLUMN public.codigos_do_telegram.pessoa_id IS '[sistema] Pessoa que gerou o código.';
COMMENT ON COLUMN public.codigos_do_telegram.resumo IS '[sensivel] Resumo SHA-256 do código (o código não é guardado).';
COMMENT ON COLUMN public.codigos_do_telegram.criado_em IS '[sistema] Quando foi gerado.';
COMMENT ON COLUMN public.codigos_do_telegram.vence_em IS '[sistema] Até quando vale.';
COMMENT ON COLUMN public.codigos_do_telegram.usado_em IS '[sistema] Quando foi usado ou anulado (vazio: ainda vale).';
ALTER TABLE public.codigos_do_telegram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_do_telegram FORCE ROW LEVEL SECURITY;
CREATE POLICY codigos_do_telegram_da_empresa_e_da_pessoa ON public.codigos_do_telegram
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (pessoa_id = public.pessoa_ativa());
-- Código não se apaga: gerar outro marca o anterior como usado. A empresa é conferida ao usar (vincular_telegram).
REVOKE DELETE ON public.codigos_do_telegram FROM mago_app;

-- O que o webhook guarda sem saber a empresa: nenhum dado de negócio, e a API não lê nem grava direto.
CREATE SCHEMA telegram;
COMMENT ON SCHEMA telegram IS
  'Controle do webhook do Telegram (M5-01): atualizações já tratadas, códigos errados e mensagens por minuto.';
CREATE TABLE telegram.atualizacoes (
  update_id bigint PRIMARY KEY,
  recebida_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atualizacoes_por_data ON telegram.atualizacoes (recebida_em);
COMMENT ON TABLE telegram.atualizacoes IS 'Atualizações do Telegram já tratadas (cada uma uma vez só); 7 dias.';
COMMENT ON COLUMN telegram.atualizacoes.update_id IS '[sistema] Número da atualização no Telegram.';
COMMENT ON COLUMN telegram.atualizacoes.recebida_em IS '[sistema] Quando chegou.';
CREATE TABLE telegram.codigos_errados (
  telegram_id bigint NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codigos_errados_por_conta ON telegram.codigos_errados (telegram_id, em);
COMMENT ON TABLE telegram.codigos_errados IS 'Códigos de vínculo errados por conta do Telegram (trava: 5 em 15 minutos).';
COMMENT ON COLUMN telegram.codigos_errados.telegram_id IS '[pessoal] Número da conta no Telegram.';
COMMENT ON COLUMN telegram.codigos_errados.em IS '[sistema] Quando errou.';
CREATE TABLE telegram.mensagens_por_minuto (
  telegram_id bigint NOT NULL,
  minuto timestamptz NOT NULL,
  n integer NOT NULL DEFAULT 1,
  PRIMARY KEY (telegram_id, minuto)
);
COMMENT ON TABLE telegram.mensagens_por_minuto IS 'Quantas mensagens cada conta do Telegram mandou em cada minuto.';
COMMENT ON COLUMN telegram.mensagens_por_minuto.telegram_id IS '[pessoal] Número da conta no Telegram.';
COMMENT ON COLUMN telegram.mensagens_por_minuto.minuto IS '[sistema] O minuto.';
COMMENT ON COLUMN telegram.mensagens_por_minuto.n IS '[sistema] Mensagens naquele minuto.';

-- Marca a atualização como tratada. Falso: já tinha chegado (o Telegram mandou de novo). Limpa as de 7 dias.
CREATE FUNCTION public.atualizacao_nova_do_telegram(numero bigint) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE nova boolean;
  BEGIN
    INSERT INTO telegram.atualizacoes (update_id) VALUES (numero) ON CONFLICT DO NOTHING;
    nova := FOUND;
    IF nova AND numero % 100 = 0 THEN
      DELETE FROM telegram.atualizacoes WHERE recebida_em < now() - interval '7 days';
      DELETE FROM telegram.codigos_errados WHERE em < now() - interval '1 day';
      DELETE FROM telegram.mensagens_por_minuto WHERE minuto < now() - interval '1 hour';
    END IF;
    RETURN nova;
  END
  $$;
COMMENT ON FUNCTION public.atualizacao_nova_do_telegram(bigint) IS
  'Grava o número da atualização do Telegram; falso se ela já tinha chegado.';

-- Conta a mensagem da conta neste minuto e devolve quantas já foram.
CREATE FUNCTION public.contar_mensagem_do_telegram(conta bigint) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    INSERT INTO telegram.mensagens_por_minuto (telegram_id, minuto) VALUES (conta, date_trunc('minute', now()))
    ON CONFLICT (telegram_id, minuto) DO UPDATE SET n = telegram.mensagens_por_minuto.n + 1
    RETURNING n
  $$;
COMMENT ON FUNCTION public.contar_mensagem_do_telegram(bigint) IS 'Mensagens da conta do Telegram neste minuto.';

-- Códigos errados da conta nos últimos minutos (para a trava), contando o de agora se errou.
CREATE FUNCTION public.codigos_errados_do_telegram(conta bigint, errou boolean, minutos integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF errou THEN INSERT INTO telegram.codigos_errados (telegram_id) VALUES (conta); END IF;
    RETURN (SELECT count(*)::integer FROM telegram.codigos_errados
             WHERE telegram_id = conta AND em > now() - make_interval(mins => minutos));
  END
  $$;
COMMENT ON FUNCTION public.codigos_errados_do_telegram(bigint, boolean, integer) IS
  'Grava um código errado (se errou) e devolve quantos a conta do Telegram errou nos últimos minutos.';

-- Quem é a conta do Telegram: só se a pessoa, o vínculo dela e a empresa estão ativos.
CREATE FUNCTION public.reconhecer_telegram(conta bigint)
  RETURNS TABLE (pessoa_id uuid, empresa_id uuid, chat_id bigint, pessoa_nome text, empresa_nome text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT t.pessoa_id, t.empresa_id, t.chat_id, p.nome, e.nome
      FROM public.vinculos_do_telegram t
      JOIN public.pessoas p ON p.id = t.pessoa_id AND p.situacao = 'ativa'
      JOIN public.vinculos v ON v.empresa_id = t.empresa_id AND v.pessoa_id = t.pessoa_id AND v.situacao = 'ativo'
      JOIN public.empresas e ON e.id = t.empresa_id AND e.situacao = 'ativa'
     WHERE t.telegram_id = conta
  $$;
COMMENT ON FUNCTION public.reconhecer_telegram(bigint) IS
  'Acha a pessoa e a empresa de uma conta do Telegram (a mensagem ainda não tem empresa). Só vínculos ativos.';

-- Usa o código: confere, marca como usado e liga a conta do Telegram à pessoa, tirando a conta de quem a tinha e a
-- conta antiga da pessoa. Nada volta se o código não vale (vencido, usado, de pessoa ou empresa inativa).
CREATE FUNCTION public.vincular_telegram(resumo_do_codigo text, conta bigint, chat bigint, usuario_tg text, nome_tg text)
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
COMMENT ON FUNCTION public.vincular_telegram(text, bigint, bigint, text, text) IS
  'Usa o código de vínculo do Telegram e liga a conta à pessoa, na empresa em que o código foi gerado.';

REVOKE EXECUTE ON FUNCTION public.atualizacao_nova_do_telegram(bigint), public.contar_mensagem_do_telegram(bigint),
  public.codigos_errados_do_telegram(bigint, boolean, integer), public.reconhecer_telegram(bigint),
  public.vincular_telegram(text, bigint, bigint, text, text), public.conferir_empresa_do_telegram() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atualizacao_nova_do_telegram(bigint), public.contar_mensagem_do_telegram(bigint),
  public.codigos_errados_do_telegram(bigint, boolean, integer), public.reconhecer_telegram(bigint),
  public.vincular_telegram(text, bigint, bigint, text, text) TO mago_app;

-- Desligar a pessoa da empresa do Telegram corta o vínculo do Telegram.
CREATE FUNCTION public.desligar_telegram_do_vinculo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    DELETE FROM public.vinculos_do_telegram t WHERE t.empresa_id = NEW.empresa_id AND t.pessoa_id = NEW.pessoa_id;
    RETURN NEW;
  END
  $$;
REVOKE EXECUTE ON FUNCTION public.desligar_telegram_do_vinculo() FROM PUBLIC;
CREATE TRIGGER desligar_telegram AFTER UPDATE OF situacao ON public.vinculos
  FOR EACH ROW WHEN (NEW.situacao <> 'ativo' AND OLD.situacao = 'ativo')
  EXECUTE FUNCTION public.desligar_telegram_do_vinculo();

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'telegram_desvinculado';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados'));
DROP TRIGGER desligar_telegram ON public.vinculos;
DROP FUNCTION public.desligar_telegram_do_vinculo();
DROP FUNCTION public.vincular_telegram(text, bigint, bigint, text, text);
DROP FUNCTION public.reconhecer_telegram(bigint);
DROP FUNCTION public.codigos_errados_do_telegram(bigint, boolean, integer);
DROP FUNCTION public.contar_mensagem_do_telegram(bigint);
DROP FUNCTION public.atualizacao_nova_do_telegram(bigint);
DROP SCHEMA telegram CASCADE;
DROP TABLE public.codigos_do_telegram;
DROP TABLE public.vinculos_do_telegram;
DROP FUNCTION public.conferir_empresa_do_telegram();
