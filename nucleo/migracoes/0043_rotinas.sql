-- M5-05: rotinas por horário (contrato em contratos/src/rotinas/rotinas.ts, decisão 0039).
-- 1. rotinas: nome, gatilho, ação, dono e situação. A rotina age em nome do dono; só ele a faz agir.
-- 2. execucoes_de_rotina: cada vez que a rotina rodou (ou tentou), com o resultado, o custo e o motivo.
-- 3. O dono que sai da empresa tem as rotinas desligadas, e os administradores recebem o aviso.
-- 4. Conversa aberta por uma rotina (canal "rotina"), cuja resposta vai também pelo Telegram, e três tipos de aviso.
-- 5. empresas_com_rotinas_a_cuidar(): as empresas com rotina na hora ou execução a acompanhar (só ids).
-- Explicado em docs/banco/decisoes.md, seção 48.

-- Up Migration

CREATE TABLE public.rotinas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  dono_pessoa_id uuid NOT NULL,
  criada_por_agente_id uuid,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 120),
  gatilho jsonb NOT NULL CHECK (jsonb_typeof(gatilho) = 'object' AND gatilho ->> 'tipo' = 'horario'),
  acao jsonb NOT NULL CHECK (jsonb_typeof(acao) = 'object'
    AND acao ->> 'tipo' IN ('criar_tarefa', 'pedir_ao_agente', 'mandar_aviso')),
  situacao text NOT NULL DEFAULT 'desligada' CHECK (situacao IN ('ligada', 'desligada')),
  desligada_porque text DEFAULT 'pessoa' CHECK (desligada_porque IN ('pessoa', 'terminou', 'dono_desligado', 'agente')),
  teto_mensal integer CHECK (teto_mensal BETWEEN 1 AND 10000000),
  proxima_em timestamptz,
  vezes integer NOT NULL DEFAULT 0 CHECK (vezes >= 0),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rotinas_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT rotinas_desligada_diz_por_que CHECK ((situacao = 'desligada') = (desligada_porque IS NOT NULL)),
  CONSTRAINT rotinas_desligada_sem_proxima CHECK (situacao = 'ligada' OR proxima_em IS NULL),
  CONSTRAINT rotinas_do_dono FOREIGN KEY (empresa_id, dono_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT rotinas_do_agente FOREIGN KEY (empresa_id, criada_por_agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (criada_por_agente_id)
);
CREATE INDEX rotinas_na_hora ON public.rotinas (proxima_em) WHERE situacao = 'ligada';
CREATE INDEX rotinas_do_dono_idx ON public.rotinas (empresa_id, dono_pessoa_id, criada_em);
COMMENT ON TABLE public.rotinas IS
  'Rotinas (M5-05): no horário, criam uma tarefa, pedem algo a um agente interno ou mandam um aviso, em nome do dono.';
COMMENT ON COLUMN public.rotinas.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.rotinas.empresa_id IS '[sistema] Empresa da rotina.';
COMMENT ON COLUMN public.rotinas.dono_pessoa_id IS
  '[sistema] Quem criou: a rotina age em nome dele, com a permissão dele, e só ele a edita, liga e roda agora.';
COMMENT ON COLUMN public.rotinas.criada_por_agente_id IS
  '[sistema] O agente interno que criou a rotina pela ferramenta, a pedido do dono e com a aprovação dele.';
COMMENT ON COLUMN public.rotinas.nome IS '[empresa] Nome da rotina.';
COMMENT ON COLUMN public.rotinas.gatilho IS
  '[empresa] Quando roda (GatilhoPorHorario do contrato): a regra da recorrência, os horários, o fuso e o início.';
COMMENT ON COLUMN public.rotinas.acao IS
  '[empresa] O que faz (AcaoDaRotina do contrato): criar tarefa, pedir a um agente interno ou mandar aviso, com os textos.';
COMMENT ON COLUMN public.rotinas.situacao IS '[sistema] ligada ou desligada (nasce desligada).';
COMMENT ON COLUMN public.rotinas.desligada_porque IS
  '[sistema] Na desligada: pessoa (desligada na tela ou nasceu assim), terminou, dono_desligado ou agente.';
COMMENT ON COLUMN public.rotinas.teto_mensal IS
  '[empresa] Teto de gasto do mês só desta rotina, em centavos de dólar (nulo: sem teto próprio).';
COMMENT ON COLUMN public.rotinas.proxima_em IS '[sistema] A próxima vez que roda (só na ligada).';
COMMENT ON COLUMN public.rotinas.vezes IS '[sistema] Quantas vezes já rodou pelo horário (para o fim depois de N vezes).';
COMMENT ON COLUMN public.rotinas.criada_em IS '[sistema] Quando foi criada.';
COMMENT ON COLUMN public.rotinas.atualizada_em IS '[sistema] A última mudança.';
ALTER TABLE public.rotinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotinas FORCE ROW LEVEL SECURITY;
CREATE POLICY rotinas_da_empresa_ativa ON public.rotinas
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.execucoes_de_rotina (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  rotina_id uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('horario', 'rodar_agora')),
  prevista_para timestamptz,
  situacao text NOT NULL DEFAULT 'na_fila'
    CHECK (situacao IN ('na_fila', 'rodando', 'esperando', 'feita', 'falhou', 'pulada')),
  tentativa integer NOT NULL DEFAULT 1 CHECK (tentativa BETWEEN 1 AND 3),
  proxima_tentativa_em timestamptz,
  motivo text CHECK (length(motivo) <= 500),
  tarefa_id uuid,
  execucao_de_agente_id uuid,
  conversa_id uuid,
  avisados integer NOT NULL DEFAULT 0 CHECK (avisados >= 0),
  custo numeric(14, 4) NOT NULL DEFAULT 0 CHECK (custo >= 0),
  criada_em timestamptz NOT NULL DEFAULT now(),
  iniciada_em timestamptz,
  terminada_em timestamptz,
  CONSTRAINT execucoes_de_rotina_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT execucoes_de_rotina_fim CHECK ((situacao IN ('feita', 'falhou', 'pulada')) = (terminada_em IS NOT NULL)),
  CONSTRAINT execucoes_de_rotina_hora_marcada CHECK ((origem = 'horario') = (prevista_para IS NOT NULL)),
  CONSTRAINT execucoes_de_rotina_da_rotina FOREIGN KEY (empresa_id, rotina_id)
    REFERENCES public.rotinas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT execucoes_de_rotina_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE SET NULL (tarefa_id),
  CONSTRAINT execucoes_de_rotina_execucao FOREIGN KEY (empresa_id, execucao_de_agente_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE SET NULL (execucao_de_agente_id),
  CONSTRAINT execucoes_de_rotina_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas (empresa_id, id) ON DELETE SET NULL (conversa_id)
);
CREATE INDEX execucoes_de_rotina_historico ON public.execucoes_de_rotina (empresa_id, rotina_id, criada_em DESC);
CREATE INDEX execucoes_de_rotina_abertas ON public.execucoes_de_rotina (empresa_id)
  WHERE situacao IN ('na_fila', 'rodando', 'esperando');
COMMENT ON TABLE public.execucoes_de_rotina IS
  'Cada vez que uma rotina rodou ou tentou (M5-05), com o que fez, o custo e, se falhou ou foi pulada, o motivo.';
COMMENT ON COLUMN public.execucoes_de_rotina.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.execucoes_de_rotina.empresa_id IS '[sistema] Empresa da rotina.';
COMMENT ON COLUMN public.execucoes_de_rotina.rotina_id IS '[sistema] A rotina.';
COMMENT ON COLUMN public.execucoes_de_rotina.origem IS '[sistema] horario ou rodar_agora.';
COMMENT ON COLUMN public.execucoes_de_rotina.prevista_para IS '[sistema] O horário marcado (só pelo horário).';
COMMENT ON COLUMN public.execucoes_de_rotina.situacao IS
  '[sistema] na_fila, rodando, esperando (agentes parados ou nova tentativa), feita, falhou ou pulada.';
COMMENT ON COLUMN public.execucoes_de_rotina.tentativa IS '[sistema] 1, 2 ou 3 (as duas novas tentativas).';
COMMENT ON COLUMN public.execucoes_de_rotina.proxima_tentativa_em IS '[sistema] Quando tenta de novo.';
COMMENT ON COLUMN public.execucoes_de_rotina.motivo IS '[sistema] Por que falhou ou foi pulada, em texto curto.';
COMMENT ON COLUMN public.execucoes_de_rotina.tarefa_id IS '[sistema] A tarefa que a execução criou.';
COMMENT ON COLUMN public.execucoes_de_rotina.execucao_de_agente_id IS
  '[sistema] A execução do agente interno (para o passo a passo).';
COMMENT ON COLUMN public.execucoes_de_rotina.conversa_id IS '[sistema] A conversa que a execução abriu com o agente.';
COMMENT ON COLUMN public.execucoes_de_rotina.avisados IS '[sistema] Quantas pessoas receberam o aviso.';
COMMENT ON COLUMN public.execucoes_de_rotina.custo IS '[sistema] O custo da IA da execução, em centavos de dólar.';
COMMENT ON COLUMN public.execucoes_de_rotina.criada_em IS '[sistema] Quando entrou na fila.';
COMMENT ON COLUMN public.execucoes_de_rotina.iniciada_em IS '[sistema] Quando começou.';
COMMENT ON COLUMN public.execucoes_de_rotina.terminada_em IS '[sistema] Quando terminou (feita, falhou ou pulada).';
ALTER TABLE public.execucoes_de_rotina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execucoes_de_rotina FORCE ROW LEVEL SECURITY;
CREATE POLICY execucoes_de_rotina_da_empresa_ativa ON public.execucoes_de_rotina
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- O dono saiu da empresa: as rotinas dele se desligam e os administradores ativos recebem o aviso.
CREATE FUNCTION public.desligar_rotinas_do_vinculo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    quantas integer;
    nome_do_dono text;
  BEGIN
    UPDATE public.rotinas SET situacao = 'desligada', desligada_porque = 'dono_desligado', proxima_em = NULL,
           atualizada_em = now()
     WHERE empresa_id = NEW.empresa_id AND dono_pessoa_id = NEW.pessoa_id AND situacao = 'ligada';
    GET DIAGNOSTICS quantas = ROW_COUNT;
    IF quantas > 0 THEN
      SELECT p.nome INTO nome_do_dono FROM public.pessoas p WHERE p.id = NEW.pessoa_id;
      INSERT INTO public.avisos (empresa_id, pessoa_id, tipo, texto, link, push_pendente)
      SELECT NEW.empresa_id, v.pessoa_id, 'rotina_desligada',
             left(format('%s rotina(s) de %s foram desligadas porque a pessoa saiu da empresa.', quantas,
                         coalesce(nome_do_dono, 'uma pessoa')), 500),
             '/rotinas', true
        FROM public.vinculos v
       WHERE v.empresa_id = NEW.empresa_id AND v.perfil = 'administrador' AND v.situacao = 'ativo'
         AND v.pessoa_id <> NEW.pessoa_id;
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE EXECUTE ON FUNCTION public.desligar_rotinas_do_vinculo() FROM PUBLIC;
CREATE TRIGGER desligar_rotinas AFTER UPDATE OF situacao ON public.vinculos
  FOR EACH ROW WHEN (NEW.situacao <> 'ativo' AND OLD.situacao = 'ativo')
  EXECUTE FUNCTION public.desligar_rotinas_do_vinculo();

-- Empresas com algo das rotinas a cuidar: rotina ligada na hora, execução na fila, esperando ou rodando (só ids).
CREATE FUNCTION public.empresas_com_rotinas_a_cuidar() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT r.empresa_id FROM public.rotinas r WHERE r.situacao = 'ligada' AND r.proxima_em <= now()
    UNION
    SELECT e.empresa_id FROM public.execucoes_de_rotina e WHERE e.situacao IN ('na_fila', 'rodando', 'esperando')
  $$;
REVOKE EXECUTE ON FUNCTION public.empresas_com_rotinas_a_cuidar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_rotinas_a_cuidar() TO mago_app;

-- Conversa aberta por uma rotina: a resposta do agente aparece no app e vai também pelo Telegram.
ALTER TABLE public.conversas DROP CONSTRAINT conversas_canal_check;
ALTER TABLE public.conversas ADD CONSTRAINT conversas_canal_check CHECK (canal IN ('app', 'telegram', 'rotina'));
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_de_conversa_canal_check;
ALTER TABLE public.mensagens_de_conversa ADD CONSTRAINT mensagens_de_conversa_canal_check
  CHECK (canal IN ('app', 'telegram', 'rotina'));
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_telegram_pelo_canal;
ALTER TABLE public.mensagens_de_conversa ADD CONSTRAINT mensagens_telegram_pelo_canal
  CHECK (NOT telegram_pendente OR canal IN ('telegram', 'rotina'));
COMMENT ON COLUMN public.conversas.canal IS
  '[sistema] Onde a conversa começou: app, telegram ou rotina (aberta por uma rotina em nome do dono).';
COMMENT ON COLUMN public.mensagens_de_conversa.canal IS
  '[sistema] Por onde a mensagem passou: app, telegram ou rotina (a do agente vai pelo canal da última mensagem da pessoa; a de rotina vai também ao Telegram).';

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo IN ('aviso_de_rotina', 'rotina_falhou', 'rotina_desligada');
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas'));
UPDATE public.mensagens_de_conversa SET canal = 'app', telegram_pendente = false WHERE canal = 'rotina';
UPDATE public.conversas SET canal = 'app' WHERE canal = 'rotina';
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_telegram_pelo_canal;
ALTER TABLE public.mensagens_de_conversa ADD CONSTRAINT mensagens_telegram_pelo_canal
  CHECK (NOT telegram_pendente OR canal = 'telegram');
ALTER TABLE public.mensagens_de_conversa DROP CONSTRAINT mensagens_de_conversa_canal_check;
ALTER TABLE public.mensagens_de_conversa ADD CONSTRAINT mensagens_de_conversa_canal_check
  CHECK (canal IN ('app', 'telegram'));
ALTER TABLE public.conversas DROP CONSTRAINT conversas_canal_check;
ALTER TABLE public.conversas ADD CONSTRAINT conversas_canal_check CHECK (canal IN ('app', 'telegram'));
COMMENT ON COLUMN public.conversas.canal IS '[sistema] Onde a conversa começou: app ou telegram.';
COMMENT ON COLUMN public.mensagens_de_conversa.canal IS
  '[sistema] Por onde a mensagem passou: app ou telegram (a do agente vai pelo canal da última mensagem da pessoa).';
DROP FUNCTION public.empresas_com_rotinas_a_cuidar();
DROP TRIGGER desligar_rotinas ON public.vinculos;
DROP FUNCTION public.desligar_rotinas_do_vinculo();
DROP TABLE public.execucoes_de_rotina;
DROP TABLE public.rotinas;
