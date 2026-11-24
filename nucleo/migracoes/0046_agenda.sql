-- M5-07: agenda simples (contrato em contratos/src/agenda/eventos.ts, decisão 0041).
-- 1. eventos: o evento ou a série (com regra), com o começo e o fim como dia e hora no fuso; o banco calcula o momento.
--    A ocorrência mudada ou cancelada de uma série é um evento próprio, ligado a ela e à ocorrência que substitui.
-- 2. participantes_de_evento: quem foi convidado e a resposta.
-- 3. alertas_de_evento: os alertas já mandados (cada um vai uma vez só por começo de ocorrência e pessoa).
-- 4. empresas_com_agenda(): as empresas com evento a alertar (só ids). Três tipos de aviso novos.
-- Explicado em docs/banco/decisoes.md, seção 51.

-- Up Migration

CREATE TABLE public.eventos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 200),
  descricao text CHECK (length(descricao) <= 10000),
  inicio_dia date NOT NULL,
  inicio_hora time,
  fim_dia date NOT NULL,
  fim_hora time,
  dia_inteiro boolean NOT NULL DEFAULT false,
  fuso text NOT NULL CHECK (length(fuso) BETWEEN 1 AND 64),
  inicio_em timestamptz NOT NULL,
  fim_em timestamptz NOT NULL,
  local text CHECK (length(local) <= 300),
  link text CHECK (link ~ '^https://[^\s]+$' AND length(link) <= 500),
  criado_por uuid NOT NULL,
  criado_por_agente_id uuid,
  tarefa_id uuid,
  projeto_id uuid,
  regra jsonb CHECK (regra IS NULL OR jsonb_typeof(regra) = 'object'),
  serie_id uuid,
  ocorrencia_original date,
  situacao text NOT NULL DEFAULT 'marcado' CHECK (situacao IN ('marcado', 'cancelado')),
  alertas integer[] CHECK (alertas IS NULL OR (cardinality(alertas) <= 5 AND 0 <= ALL (alertas) AND 10080 >= ALL (alertas))),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT eventos_horas CHECK (dia_inteiro = (inicio_hora IS NULL) AND dia_inteiro = (fim_hora IS NULL)),
  CONSTRAINT eventos_fim_depois CHECK (fim_em > inicio_em AND fim_dia - inicio_dia <= 14),
  CONSTRAINT eventos_da_serie CHECK ((serie_id IS NULL) = (ocorrencia_original IS NULL) AND (serie_id IS NULL OR regra IS NULL)),
  CONSTRAINT eventos_uma_vez_por_ocorrencia UNIQUE (empresa_id, serie_id, ocorrencia_original),
  CONSTRAINT eventos_de_quem_criou FOREIGN KEY (empresa_id, criado_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT eventos_do_agente FOREIGN KEY (empresa_id, criado_por_agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (criado_por_agente_id),
  CONSTRAINT eventos_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE SET NULL (tarefa_id),
  CONSTRAINT eventos_projeto FOREIGN KEY (empresa_id, projeto_id)
    REFERENCES public.projetos (empresa_id, id) ON DELETE SET NULL (projeto_id),
  CONSTRAINT eventos_serie FOREIGN KEY (empresa_id, serie_id)
    REFERENCES public.eventos (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX eventos_por_periodo ON public.eventos (empresa_id, inicio_em, fim_em);
CREATE INDEX eventos_series ON public.eventos (empresa_id) WHERE regra IS NOT NULL AND situacao = 'marcado';
CREATE INDEX eventos_da_serie_idx ON public.eventos (empresa_id, serie_id) WHERE serie_id IS NOT NULL;
COMMENT ON TABLE public.eventos IS
  'Eventos da agenda simples (M5-07): o evento, a série (com regra) e a ocorrência mudada ou cancelada de uma série.';
COMMENT ON COLUMN public.eventos.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.eventos.empresa_id IS '[sistema] Empresa do evento.';
COMMENT ON COLUMN public.eventos.titulo IS '[empresa] O que é o evento.';
COMMENT ON COLUMN public.eventos.descricao IS '[empresa] Detalhes.';
COMMENT ON COLUMN public.eventos.inicio_dia IS '[empresa] Dia do começo, no fuso do evento.';
COMMENT ON COLUMN public.eventos.inicio_hora IS '[empresa] Hora do começo (nula no dia inteiro).';
COMMENT ON COLUMN public.eventos.fim_dia IS '[empresa] Dia do fim, no fuso do evento.';
COMMENT ON COLUMN public.eventos.fim_hora IS '[empresa] Hora do fim (nula no dia inteiro).';
COMMENT ON COLUMN public.eventos.dia_inteiro IS '[empresa] O evento ocupa os dias inteiros.';
COMMENT ON COLUMN public.eventos.fuso IS '[empresa] Fuso em que o começo e o fim foram marcados (IANA).';
COMMENT ON COLUMN public.eventos.inicio_em IS '[sistema] Momento do começo, calculado pelo banco no fuso.';
COMMENT ON COLUMN public.eventos.fim_em IS '[sistema] Momento do fim (dia inteiro: o começo do dia seguinte ao último).';
COMMENT ON COLUMN public.eventos.local IS '[empresa] Onde (endereço ou sala).';
COMMENT ON COLUMN public.eventos.link IS '[empresa] Link da reunião (https).';
COMMENT ON COLUMN public.eventos.criado_por IS '[sistema] Quem criou (edita e cancela, com o administrador).';
COMMENT ON COLUMN public.eventos.criado_por_agente_id IS
  '[sistema] O agente que marcou o evento pela ferramenta, a pedido de quem criou e com a aprovação dele.';
COMMENT ON COLUMN public.eventos.tarefa_id IS '[sistema] Tarefa ligada ao evento.';
COMMENT ON COLUMN public.eventos.projeto_id IS '[sistema] Projeto ligado ao evento.';
COMMENT ON COLUMN public.eventos.regra IS
  '[empresa] Recorrência (RegraDeRecorrencia do contrato), contada a partir do dia do começo. Nula: evento único.';
COMMENT ON COLUMN public.eventos.serie_id IS '[sistema] A série da qual esta ocorrência mudada ou cancelada faz parte.';
COMMENT ON COLUMN public.eventos.ocorrencia_original IS '[sistema] O dia da ocorrência da série que este evento substitui.';
COMMENT ON COLUMN public.eventos.situacao IS '[sistema] marcado ou cancelado.';
COMMENT ON COLUMN public.eventos.alertas IS
  '[empresa] Minutos antes do começo para os alertas, valendo para todos. Nulo: cada participante usa o padrão dele.';
COMMENT ON COLUMN public.eventos.criado_em IS '[sistema] Quando foi criado.';
COMMENT ON COLUMN public.eventos.atualizado_em IS '[sistema] A última mudança.';
ALTER TABLE public.eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY eventos_da_empresa_ativa ON public.eventos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- O momento do começo e do fim, no fuso do evento (dia inteiro: do começo do primeiro dia ao começo do dia seguinte
-- ao último).
CREATE FUNCTION public.calcular_momentos_do_evento() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.inicio_em := (NEW.inicio_dia + coalesce(NEW.inicio_hora, time '00:00')) AT TIME ZONE NEW.fuso;
    NEW.fim_em := CASE WHEN NEW.dia_inteiro THEN (NEW.fim_dia + 1)::timestamp AT TIME ZONE NEW.fuso
                       ELSE (NEW.fim_dia + NEW.fim_hora) AT TIME ZONE NEW.fuso END;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER eventos_calculam_momentos BEFORE INSERT OR UPDATE OF inicio_dia, inicio_hora, fim_dia, fim_hora,
  dia_inteiro, fuso ON public.eventos FOR EACH ROW EXECUTE FUNCTION public.calcular_momentos_do_evento();

CREATE TABLE public.participantes_de_evento (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  evento_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  resposta text NOT NULL DEFAULT 'pendente' CHECK (resposta IN ('pendente', 'vou', 'nao_vou', 'talvez')),
  respondeu_em timestamptz,
  PRIMARY KEY (evento_id, pessoa_id),
  CONSTRAINT participantes_do_evento FOREIGN KEY (empresa_id, evento_id)
    REFERENCES public.eventos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT participantes_da_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT participantes_resposta_com_hora CHECK ((resposta = 'pendente') = (respondeu_em IS NULL))
);
CREATE INDEX participantes_por_pessoa ON public.participantes_de_evento (empresa_id, pessoa_id);
COMMENT ON TABLE public.participantes_de_evento IS 'Quem foi convidado para cada evento (M5-07) e a resposta.';
COMMENT ON COLUMN public.participantes_de_evento.empresa_id IS '[sistema] Empresa do evento.';
COMMENT ON COLUMN public.participantes_de_evento.evento_id IS '[sistema] O evento (ou a série).';
COMMENT ON COLUMN public.participantes_de_evento.pessoa_id IS '[sistema] A pessoa convidada.';
COMMENT ON COLUMN public.participantes_de_evento.resposta IS '[pessoal] pendente, vou, nao_vou ou talvez.';
COMMENT ON COLUMN public.participantes_de_evento.respondeu_em IS '[sistema] Quando respondeu.';
ALTER TABLE public.participantes_de_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participantes_de_evento FORCE ROW LEVEL SECURITY;
CREATE POLICY participantes_de_evento_da_empresa_ativa ON public.participantes_de_evento
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.alertas_de_evento (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  evento_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  inicio_da_ocorrencia timestamptz NOT NULL,
  minutos integer NOT NULL CHECK (minutos BETWEEN 0 AND 10080),
  enviado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, pessoa_id, inicio_da_ocorrencia, minutos),
  CONSTRAINT alertas_do_evento FOREIGN KEY (empresa_id, evento_id)
    REFERENCES public.eventos (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX alertas_antigos ON public.alertas_de_evento (enviado_em);
COMMENT ON TABLE public.alertas_de_evento IS
  'Os alertas de evento já mandados (M5-07): cada um vai uma vez só por começo de ocorrência, pessoa e minutos. 30 dias.';
COMMENT ON COLUMN public.alertas_de_evento.empresa_id IS '[sistema] Empresa do evento.';
COMMENT ON COLUMN public.alertas_de_evento.evento_id IS '[sistema] O evento (ou a série).';
COMMENT ON COLUMN public.alertas_de_evento.pessoa_id IS '[sistema] Quem recebeu.';
COMMENT ON COLUMN public.alertas_de_evento.inicio_da_ocorrencia IS
  '[sistema] O começo da ocorrência alertada (se o horário mudar, o alerta novo vale para o começo novo).';
COMMENT ON COLUMN public.alertas_de_evento.minutos IS '[sistema] Quantos minutos antes.';
COMMENT ON COLUMN public.alertas_de_evento.enviado_em IS '[sistema] Quando foi mandado.';
ALTER TABLE public.alertas_de_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_de_evento FORCE ROW LEVEL SECURITY;
CREATE POLICY alertas_de_evento_da_empresa_ativa ON public.alertas_de_evento
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Empresas com evento que pode ter alerta nos próximos 7 dias (único marcado ou série marcada), só os ids.
CREATE FUNCTION public.empresas_com_agenda() RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT e.empresa_id FROM public.eventos e
     WHERE e.situacao = 'marcado'
       AND (e.regra IS NOT NULL OR e.inicio_em BETWEEN now() - interval '1 hour' AND now() + interval '8 days')
  $$;
REVOKE EXECUTE ON FUNCTION public.empresas_com_agenda() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_agenda() TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo IN ('convite_de_evento', 'evento_mudou', 'alerta_de_evento');
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou'));
DROP FUNCTION public.empresas_com_agenda();
DROP TABLE public.alertas_de_evento;
DROP TABLE public.participantes_de_evento;
DROP TABLE public.eventos;
DROP FUNCTION public.calcular_momentos_do_evento();
