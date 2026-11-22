-- M5-04: aprovar pelo Telegram, com botões e o código do app autenticador (contrato em contratos/src/canais/telegram.ts,
-- decisão 0035).
-- 1. aprovacoes_no_telegram: cada pedido de aprovação mandado ao Telegram de cada pessoa, com a conferência que ela viu
--    e a mensagem (para editar depois com a decisão).
-- 2. pedidos_de_codigo_no_telegram: o toque em Aprovar ou Recusar abre um pedido de 5 minutos (o código, ou o motivo).
-- 3. Esquema telegram: os erros de código e a trava por pessoa, e o último passo do autenticador usado
--    (o mesmo código não vale duas vezes). Só por funções.
-- 4. empresas_com_telegram_pendente() acha também os pedidos a mandar e as mensagens a atualizar.
-- 5. Um tipo de aviso novo: telegram_aprovacoes_travadas.
-- Explicado em docs/banco/decisoes.md, seção 45.

-- Up Migration

CREATE TABLE public.aprovacoes_no_telegram (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  aprovacao_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  chat_id bigint NOT NULL,
  mensagem_id bigint,
  conferencia text NOT NULL CHECK (conferencia ~ '^[0-9a-f]{64}$'),
  enviada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz,
  PRIMARY KEY (empresa_id, aprovacao_id, pessoa_id),
  CONSTRAINT aprovacoes_no_telegram_aprovacao FOREIGN KEY (empresa_id, aprovacao_id)
    REFERENCES public.aprovacoes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT aprovacoes_no_telegram_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
CREATE INDEX aprovacoes_no_telegram_a_atualizar ON public.aprovacoes_no_telegram (empresa_id)
  WHERE atualizada_em IS NULL;
COMMENT ON TABLE public.aprovacoes_no_telegram IS
  'Pedidos de aprovação mandados ao Telegram de cada pessoa (M5-04), com a conferência que ela viu.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.aprovacao_id IS '[sistema] O pedido de aprovação.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.pessoa_id IS '[sistema] Quem recebeu no Telegram.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.chat_id IS '[pessoal] A conversa do Telegram da pessoa.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.mensagem_id IS
  '[sistema] Número da mensagem no Telegram (vazio enquanto está sendo mandada).';
COMMENT ON COLUMN public.aprovacoes_no_telegram.conferencia IS
  '[sistema] Resumo SHA-256 dos parâmetros que a mensagem mostrou: aprovar pelo Telegram aprova exatamente isto.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.enviada_em IS '[sistema] Quando foi mandada.';
COMMENT ON COLUMN public.aprovacoes_no_telegram.atualizada_em IS
  '[sistema] Quando a mensagem foi editada com a decisão, sem os botões (vazio: o pedido ainda está aberto).';
ALTER TABLE public.aprovacoes_no_telegram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aprovacoes_no_telegram FORCE ROW LEVEL SECURITY;
-- A empresa vê os envios dela; a pessoa vê os próprios de qualquer empresa (o botão diz de qual empresa é o pedido,
-- mesmo depois de ela trocar a empresa do Telegram).
CREATE POLICY aprovacoes_no_telegram_da_empresa_ou_da_pessoa ON public.aprovacoes_no_telegram
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.pedidos_de_codigo_no_telegram (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  aprovacao_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao IN ('aprovar', 'recusar')),
  conferencia text NOT NULL CHECK (conferencia ~ '^[0-9a-f]{64}$'),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  vale_ate timestamptz NOT NULL,
  PRIMARY KEY (pessoa_id),
  CONSTRAINT pedidos_de_codigo_vale_depois CHECK (vale_ate > aberto_em),
  CONSTRAINT pedidos_de_codigo_aprovacao FOREIGN KEY (empresa_id, aprovacao_id)
    REFERENCES public.aprovacoes (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT pedidos_de_codigo_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
COMMENT ON TABLE public.pedidos_de_codigo_no_telegram IS
  'O toque em Aprovar ou Recusar no Telegram (M5-04): por 5 minutos, a próxima mensagem é o código ou o motivo. Um por pessoa.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.empresa_id IS '[sistema] Empresa do pedido de aprovação.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.pessoa_id IS '[sistema] Quem tocou no botão.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.aprovacao_id IS '[sistema] O pedido de aprovação.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.acao IS '[sistema] aprovar (espera o código) ou recusar (o motivo).';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.conferencia IS
  '[sistema] A conferência que a pessoa viu na mensagem do pedido.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.aberto_em IS '[sistema] Quando tocou no botão.';
COMMENT ON COLUMN public.pedidos_de_codigo_no_telegram.vale_ate IS '[sistema] Até quando espera o código ou o motivo.';
ALTER TABLE public.pedidos_de_codigo_no_telegram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_de_codigo_no_telegram FORCE ROW LEVEL SECURITY;
-- Um pedido aberto por pessoa, na empresa do pedido de aprovação: a pessoa acha o dela de qualquer empresa.
CREATE POLICY pedidos_de_codigo_da_empresa_ou_da_pessoa ON public.pedidos_de_codigo_no_telegram
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa() OR pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

CREATE TABLE telegram.erros_de_codigo (
  pessoa_id uuid NOT NULL,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX erros_de_codigo_por_pessoa ON telegram.erros_de_codigo (pessoa_id, em);
COMMENT ON TABLE telegram.erros_de_codigo IS
  'Códigos do autenticador errados ao aprovar pelo Telegram (3 em 15 minutos travam as aprovações por lá).';
COMMENT ON COLUMN telegram.erros_de_codigo.pessoa_id IS '[sistema] Quem errou.';
COMMENT ON COLUMN telegram.erros_de_codigo.em IS '[sistema] Quando errou.';
CREATE TABLE telegram.travas_de_aprovacao (
  pessoa_id uuid PRIMARY KEY,
  ate timestamptz NOT NULL
);
COMMENT ON TABLE telegram.travas_de_aprovacao IS 'Aprovações pelo Telegram travadas por pessoa (15 minutos do terceiro erro).';
COMMENT ON COLUMN telegram.travas_de_aprovacao.pessoa_id IS '[sistema] A pessoa.';
COMMENT ON COLUMN telegram.travas_de_aprovacao.ate IS '[sistema] Até quando as aprovações pelo Telegram ficam travadas.';
CREATE TABLE telegram.passos_do_autenticador (
  pessoa_id uuid PRIMARY KEY,
  passo bigint NOT NULL
);
COMMENT ON TABLE telegram.passos_do_autenticador IS
  'O último passo de 30 segundos do autenticador usado por pessoa no Telegram: o mesmo código não vale duas vezes.';
COMMENT ON COLUMN telegram.passos_do_autenticador.pessoa_id IS '[sistema] A pessoa.';
COMMENT ON COLUMN telegram.passos_do_autenticador.passo IS '[sistema] O passo do último código aceito.';

-- Erros de código da pessoa nos últimos minutos, contando o de agora se errou. Ao chegar no máximo, trava as
-- aprovações pelo Telegram pelos minutos dados, a contar de agora (e zera a conta).
CREATE FUNCTION public.erros_de_codigo_no_telegram(pessoa uuid, errou boolean, minutos integer, maximo integer)
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE n integer;
  BEGIN
    IF errou THEN INSERT INTO telegram.erros_de_codigo (pessoa_id) VALUES (pessoa); END IF;
    DELETE FROM telegram.erros_de_codigo WHERE em < now() - interval '1 day';
    SELECT count(*)::integer INTO n FROM telegram.erros_de_codigo
     WHERE pessoa_id = pessoa AND em > now() - make_interval(mins => minutos);
    IF errou AND n >= maximo THEN
      INSERT INTO telegram.travas_de_aprovacao (pessoa_id, ate) VALUES (pessoa, now() + make_interval(mins => minutos))
      ON CONFLICT (pessoa_id) DO UPDATE SET ate = EXCLUDED.ate;
      DELETE FROM telegram.erros_de_codigo WHERE pessoa_id = pessoa;
    END IF;
    RETURN n;
  END
  $$;
COMMENT ON FUNCTION public.erros_de_codigo_no_telegram(uuid, boolean, integer, integer) IS
  'Grava um código errado ao aprovar pelo Telegram e devolve quantos foram; no máximo, trava as aprovações por lá.';

-- As aprovações pelo Telegram estão travadas: pela trava daqui ou pela trava do 2FA do login (códigos errados no app).
CREATE FUNCTION public.aprovacoes_travadas_no_telegram(pessoa uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM telegram.travas_de_aprovacao WHERE pessoa_id = pessoa AND ate > now())
        OR EXISTS (SELECT 1 FROM acesso.dois_fatores WHERE pessoa_id = pessoa AND travado_ate > now())
  $$;
COMMENT ON FUNCTION public.aprovacoes_travadas_no_telegram(uuid) IS
  'Se as aprovações pelo Telegram da pessoa estão travadas (3 erros por lá, ou o 2FA do login travado).';

-- Usa o passo do autenticador: verdadeiro só se ele é mais novo que o último usado pela pessoa (sem repetir código).
CREATE FUNCTION public.usar_passo_do_autenticador(pessoa uuid, novo bigint) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    INSERT INTO telegram.passos_do_autenticador AS p (pessoa_id, passo) VALUES (pessoa, novo)
    ON CONFLICT (pessoa_id) DO UPDATE SET passo = EXCLUDED.passo WHERE p.passo < EXCLUDED.passo;
    RETURN FOUND;
  END
  $$;
COMMENT ON FUNCTION public.usar_passo_do_autenticador(uuid, bigint) IS
  'Marca o passo do autenticador como usado pela pessoa; falso se ele (ou um mais novo) já foi usado.';

REVOKE EXECUTE ON FUNCTION public.erros_de_codigo_no_telegram(uuid, boolean, integer, integer),
  public.aprovacoes_travadas_no_telegram(uuid), public.usar_passo_do_autenticador(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.erros_de_codigo_no_telegram(uuid, boolean, integer, integer),
  public.aprovacoes_travadas_no_telegram(uuid), public.usar_passo_do_autenticador(uuid, bigint) TO mago_app;

-- Empresas com algo do Telegram a cuidar (só ids): respostas, arquivos, e agora os pedidos de aprovação a mandar
-- (pendentes, a quem pediu ou ao responsável, com Telegram nesta empresa) e as mensagens a atualizar com a decisão.
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

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'telegram_aprovacoes_travadas';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado'));
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
DROP FUNCTION public.usar_passo_do_autenticador(uuid, bigint);
DROP FUNCTION public.aprovacoes_travadas_no_telegram(uuid);
DROP FUNCTION public.erros_de_codigo_no_telegram(uuid, boolean, integer, integer);
DROP TABLE telegram.passos_do_autenticador;
DROP TABLE telegram.travas_de_aprovacao;
DROP TABLE telegram.erros_de_codigo;
DROP TABLE public.pedidos_de_codigo_no_telegram;
DROP TABLE public.aprovacoes_no_telegram;
