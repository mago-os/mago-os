-- M8-05: agente na conversa com o cliente (decisão 0055).
-- 1. agentes ganha o papel "atendimento" (agente interno que fala com quem é de fora, um canal de cada vez).
-- 2. execucoes_de_agente ganha a origem "atendimento", ligada à conversa com o contato; no máximo uma esperando na fila
--    por conversa (as mensagens seguidas viram uma execução só).
-- 3. canais_de_contato ganha o modo do agente, as instruções do canal, o horário de atendimento, a mensagem de fora do
--    horário e a contagem da autonomia gradual.
-- 4. conversas_com_contatos ganha o resumo (conversa longa) e quando a mensagem de fora do horário saiu.
-- 5. sugestoes_de_resposta: o que o agente sugere no modo "sugere", até uma pessoa enviar, editar ou descartar.
-- 6. Aviso novo agente_pronto_para_responder.
-- Explicado em docs/banco/decisoes.md, seção 60.

-- Up Migration

ALTER TABLE public.agentes DROP CONSTRAINT agentes_papel_check,
  ADD CONSTRAINT agentes_papel_check CHECK (papel IN ('coordenador', 'especialista', 'atendimento')),
  DROP CONSTRAINT agentes_papel_do_tipo,
  ADD CONSTRAINT agentes_papel_do_tipo CHECK (
    CASE
      WHEN tipo = 'externo' THEN papel IS NULL AND especialidade IS NULL AND responde_a_id IS NULL
      WHEN papel = 'coordenador' THEN especialidade IS NULL AND responde_a_id IS NULL
      WHEN papel = 'especialista' THEN especialidade IS NOT NULL AND responde_a_id IS NOT NULL AND responde_a_id <> id
      WHEN papel = 'atendimento' THEN especialidade IS NULL AND responde_a_id IS NULL
      ELSE false
    END
  );
COMMENT ON COLUMN public.agentes.papel IS
  '[empresa] Agente interno: coordenador (porta de entrada), especialista ou atendimento (fala com clientes, M8-05).';

ALTER TABLE public.execucoes_de_agente DROP CONSTRAINT execucoes_de_agente_origem_check,
  ADD CONSTRAINT execucoes_de_agente_origem_check CHECK (origem IN ('conversa', 'tarefa', 'delegacao', 'atendimento')),
  ADD COLUMN conversa_com_contato_id uuid,
  ADD CONSTRAINT execucoes_da_conversa_com_contato FOREIGN KEY (empresa_id, conversa_com_contato_id)
    REFERENCES public.conversas_com_contatos (empresa_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT execucoes_do_atendimento CHECK ((origem = 'atendimento') = (conversa_com_contato_id IS NOT NULL));
CREATE UNIQUE INDEX execucoes_uma_na_fila_por_conversa_com_contato
  ON public.execucoes_de_agente (conversa_com_contato_id) WHERE situacao = 'na_fila';
COMMENT ON COLUMN public.execucoes_de_agente.conversa_com_contato_id IS
  '[sistema] No atendimento (M8-05): a conversa com o contato que o agente atende.';

ALTER TABLE public.canais_de_contato
  ADD COLUMN modo text NOT NULL DEFAULT 'sugere' CHECK (modo IN ('so_pessoas', 'sugere', 'sozinho')),
  ADD COLUMN instrucoes text CHECK (length(instrucoes) <= 8000),
  ADD COLUMN horario jsonb NOT NULL DEFAULT '{"dias": [1, 2, 3, 4, 5], "inicio": "09:00", "fim": "18:00"}'
    CHECK (jsonb_typeof(horario) = 'object'),
  ADD COLUMN mensagem_fora_do_horario text NOT NULL
    DEFAULT 'Olá! Nosso atendimento é de segunda a sexta, das 9h às 18h. Respondemos assim que voltarmos.'
    CHECK (length(trim(mensagem_fora_do_horario)) BETWEEN 1 AND 1000),
  ADD COLUMN limite_de_autonomia integer NOT NULL DEFAULT 20 CHECK (limite_de_autonomia BETWEEN 1 AND 1000),
  ADD COLUMN sugestoes_sem_edicao integer NOT NULL DEFAULT 0 CHECK (sugestoes_sem_edicao >= 0),
  ADD COLUMN autonomia_avisada_em timestamptz;
COMMENT ON COLUMN public.canais_de_contato.modo IS
  '[empresa] O agente no canal: so_pessoas, sugere (a pessoa envia) ou sozinho (o agente responde).';
COMMENT ON COLUMN public.canais_de_contato.instrucoes IS '[empresa] Instruções que valem só para o agente deste canal.';
COMMENT ON COLUMN public.canais_de_contato.horario IS
  '[empresa] O horário de atendimento: dias (1 = segunda ... 7 = domingo), início e fim, no fuso da empresa.';
COMMENT ON COLUMN public.canais_de_contato.mensagem_fora_do_horario IS '[empresa] O texto que sai fora do horário.';
COMMENT ON COLUMN public.canais_de_contato.limite_de_autonomia IS
  '[empresa] Sugestões enviadas sem edição até o administrador ser avisado de que o agente pode responder sozinho.';
COMMENT ON COLUMN public.canais_de_contato.sugestoes_sem_edicao IS '[sistema] Sugestões do agente enviadas sem edição.';
COMMENT ON COLUMN public.canais_de_contato.autonomia_avisada_em IS '[sistema] Quando o administrador foi avisado da autonomia.';

ALTER TABLE public.conversas_com_contatos
  ADD COLUMN resumo text CHECK (length(resumo) <= 4000),
  ADD COLUMN fora_do_horario_avisado_em timestamptz;
COMMENT ON COLUMN public.conversas_com_contatos.resumo IS '[pessoal] Resumo da conversa longa, para o agente (M8-05).';
COMMENT ON COLUMN public.conversas_com_contatos.fora_do_horario_avisado_em IS
  '[sistema] Quando a mensagem de fora do horário saiu nesta conversa (uma vez por período fechado).';

CREATE TABLE public.sugestoes_de_resposta (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL,
  agente_id uuid,
  execucao_id uuid,
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 4096),
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'enviada', 'editada', 'descartada')),
  criada_em timestamptz NOT NULL DEFAULT now(),
  decidida_por uuid,
  decidida_em timestamptz,
  mensagem_id uuid,
  CONSTRAINT sugestoes_da_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas_com_contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT sugestoes_do_agente FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (agente_id),
  CONSTRAINT sugestoes_da_execucao FOREIGN KEY (empresa_id, execucao_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE SET NULL (execucao_id),
  CONSTRAINT sugestoes_quem_decidiu FOREIGN KEY (empresa_id, decidida_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (decidida_por),
  CONSTRAINT sugestoes_da_mensagem FOREIGN KEY (empresa_id, mensagem_id)
    REFERENCES public.mensagens_com_contatos (empresa_id, id) ON DELETE SET NULL (mensagem_id),
  CONSTRAINT sugestoes_decididas CHECK ((situacao = 'pendente') = (decidida_em IS NULL))
);
CREATE INDEX sugestoes_pendentes ON public.sugestoes_de_resposta (conversa_id) WHERE situacao = 'pendente';
COMMENT ON TABLE public.sugestoes_de_resposta IS
  'O que o agente sugere responder ao contato no modo "sugere" (M8-05), até uma pessoa enviar, editar ou descartar.';
COMMENT ON COLUMN public.sugestoes_de_resposta.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.sugestoes_de_resposta.empresa_id IS '[sistema] Empresa da conversa.';
COMMENT ON COLUMN public.sugestoes_de_resposta.conversa_id IS '[sistema] A conversa com o contato.';
COMMENT ON COLUMN public.sugestoes_de_resposta.agente_id IS '[sistema] O agente que sugeriu.';
COMMENT ON COLUMN public.sugestoes_de_resposta.execucao_id IS '[sistema] A execução que gerou a sugestão.';
COMMENT ON COLUMN public.sugestoes_de_resposta.texto IS '[pessoal] O texto sugerido.';
COMMENT ON COLUMN public.sugestoes_de_resposta.situacao IS '[sistema] pendente, enviada (sem mudar), editada ou descartada.';
COMMENT ON COLUMN public.sugestoes_de_resposta.criada_em IS '[sistema] Quando o agente sugeriu.';
COMMENT ON COLUMN public.sugestoes_de_resposta.decidida_por IS '[sistema] Quem enviou ou descartou.';
COMMENT ON COLUMN public.sugestoes_de_resposta.decidida_em IS '[sistema] Quando.';
COMMENT ON COLUMN public.sugestoes_de_resposta.mensagem_id IS '[sistema] A mensagem que saiu da sugestão.';
ALTER TABLE public.sugestoes_de_resposta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sugestoes_de_resposta FORCE ROW LEVEL SECURITY;
CREATE POLICY sugestoes_de_resposta_da_empresa_ativa ON public.sugestoes_de_resposta
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
CREATE TRIGGER sugestoes_de_resposta_avisam AFTER INSERT OR UPDATE ON public.sugestoes_de_resposta
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca_de_conversa();

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa', 'agente_pronto_para_responder'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'agente_pronto_para_responder';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa'));
DROP TABLE public.sugestoes_de_resposta;
ALTER TABLE public.conversas_com_contatos DROP COLUMN fora_do_horario_avisado_em, DROP COLUMN resumo;
ALTER TABLE public.canais_de_contato DROP COLUMN autonomia_avisada_em, DROP COLUMN sugestoes_sem_edicao,
  DROP COLUMN limite_de_autonomia, DROP COLUMN mensagem_fora_do_horario, DROP COLUMN horario, DROP COLUMN instrucoes,
  DROP COLUMN modo;
DELETE FROM public.execucoes_de_agente WHERE origem = 'atendimento';
DROP INDEX public.execucoes_uma_na_fila_por_conversa_com_contato;
ALTER TABLE public.execucoes_de_agente DROP CONSTRAINT execucoes_do_atendimento,
  DROP CONSTRAINT execucoes_da_conversa_com_contato, DROP COLUMN conversa_com_contato_id,
  DROP CONSTRAINT execucoes_de_agente_origem_check,
  ADD CONSTRAINT execucoes_de_agente_origem_check CHECK (origem IN ('conversa', 'tarefa', 'delegacao'));
DELETE FROM public.agentes WHERE papel = 'atendimento';
ALTER TABLE public.agentes DROP CONSTRAINT agentes_papel_do_tipo,
  ADD CONSTRAINT agentes_papel_do_tipo CHECK (
    CASE
      WHEN tipo = 'externo' THEN papel IS NULL AND especialidade IS NULL AND responde_a_id IS NULL
      WHEN papel = 'coordenador' THEN especialidade IS NULL AND responde_a_id IS NULL
      WHEN papel = 'especialista' THEN especialidade IS NOT NULL AND responde_a_id IS NOT NULL AND responde_a_id <> id
      ELSE false
    END
  ),
  DROP CONSTRAINT agentes_papel_check,
  ADD CONSTRAINT agentes_papel_check CHECK (papel IN ('coordenador', 'especialista'));
