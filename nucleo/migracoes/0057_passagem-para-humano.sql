-- M8-06: passagem da conversa para uma pessoa (decisão 0056).
-- 1. canais_de_contato ganha os assuntos que sempre vão para uma pessoa, o prazo para assumir, a mensagem de passagem
--    e se o agente sugere respostas quando uma pessoa atende.
-- 2. conversas_com_contatos ganha a passagem (quando, o motivo e o resumo), quando escalou ao gestor e desde quando
--    está com o agente (para contar as respostas seguidas dele).
-- 3. execucoes_de_agente ganha o tipo do atendimento: atender, sugerir (com uma pessoa na conversa) ou resumir (o
--    sistema passou a conversa e o agente só escreve o resumo).
-- 4. sugestoes_de_resposta marca a sugestão feita com uma pessoa na conversa (sai pela pessoa e não conta para a
--    autonomia).
-- 5. empresas_com_passagens_vencidas(): para a verificação do prazo, a cada minuto (só ids).
-- 6. Avisos novos conversa_precisa_de_pessoa e conversa_passou_do_prazo.
-- Explicado em docs/banco/decisoes.md, seção 61.

-- Up Migration

ALTER TABLE public.canais_de_contato
  ADD COLUMN assuntos_para_pessoas text[] NOT NULL DEFAULT '{}' CHECK (cardinality(assuntos_para_pessoas) <= 20),
  ADD COLUMN prazo_para_assumir integer NOT NULL DEFAULT 10 CHECK (prazo_para_assumir BETWEEN 1 AND 240),
  ADD COLUMN mensagem_de_passagem text NOT NULL
    DEFAULT 'Vou chamar uma pessoa da nossa equipe para continuar com você. Só um instante.'
    CHECK (length(trim(mensagem_de_passagem)) BETWEEN 1 AND 1000),
  ADD COLUMN sugerir_com_pessoa boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.canais_de_contato.assuntos_para_pessoas IS
  '[empresa] Assuntos que sempre vão para uma pessoa (ex.: desconto, jurídico), até 20.';
COMMENT ON COLUMN public.canais_de_contato.prazo_para_assumir IS
  '[empresa] Minutos para alguém assumir a conversa passada pelo agente antes de o gestor ser avisado.';
COMMENT ON COLUMN public.canais_de_contato.mensagem_de_passagem IS
  '[empresa] O texto que sai ao contato quando o agente passa a conversa para uma pessoa.';
COMMENT ON COLUMN public.canais_de_contato.sugerir_com_pessoa IS
  '[empresa] Com uma pessoa na conversa, o agente escreve sugestões de resposta na caixa.';

ALTER TABLE public.conversas_com_contatos
  ADD COLUMN passada_em timestamptz,
  ADD COLUMN motivo_da_passagem text CHECK (motivo_da_passagem IN (
    'pediu_pessoa', 'irritado', 'repetiu', 'em_circulos', 'nao_soube', 'assunto_do_canal')),
  ADD COLUMN resumo_da_passagem text CHECK (length(resumo_da_passagem) <= 2000),
  ADD COLUMN escalada_em timestamptz,
  ADD COLUMN com_agente_desde timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT conversas_passagem_com_motivo CHECK ((passada_em IS NULL) = (motivo_da_passagem IS NULL));
COMMENT ON COLUMN public.conversas_com_contatos.passada_em IS
  '[sistema] Quando o agente passou a conversa para uma pessoa (M8-06); nula sem passagem ou depois de devolver.';
COMMENT ON COLUMN public.conversas_com_contatos.motivo_da_passagem IS '[sistema] Por que o agente passou a conversa.';
COMMENT ON COLUMN public.conversas_com_contatos.resumo_da_passagem IS
  '[pessoal] O resumo do agente para a equipe: o que o contato quer e o que já foi dito.';
COMMENT ON COLUMN public.conversas_com_contatos.escalada_em IS
  '[sistema] Quando o gestor foi avisado de que ninguém assumiu no prazo.';
COMMENT ON COLUMN public.conversas_com_contatos.com_agente_desde IS
  '[sistema] Desde quando a conversa está com o agente (conta as respostas seguidas dele).';
CREATE INDEX conversas_com_passagem_sem_escalar ON public.conversas_com_contatos (empresa_id, passada_em)
  WHERE passada_em IS NOT NULL AND escalada_em IS NULL;

ALTER TABLE public.execucoes_de_agente
  ADD COLUMN tipo_de_atendimento text CHECK (tipo_de_atendimento IN ('atender', 'sugerir', 'resumir')),
  ADD CONSTRAINT execucoes_tipo_do_atendimento CHECK (tipo_de_atendimento IS NULL OR origem = 'atendimento');
COMMENT ON COLUMN public.execucoes_de_agente.tipo_de_atendimento IS
  '[sistema] No atendimento: atender (nulo também), sugerir (uma pessoa atende) ou resumir (a passagem, M8-06).';

ALTER TABLE public.sugestoes_de_resposta ADD COLUMN com_pessoa boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.sugestoes_de_resposta.com_pessoa IS
  '[sistema] Feita com uma pessoa na conversa: sai pela pessoa e não conta para a autonomia (M8-06).';

-- Para a verificação do prazo, a cada minuto: empresas com conversa passada, sem dono e além do prazo. Só ids.
CREATE FUNCTION public.empresas_com_passagens_vencidas()
  RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT cv.empresa_id FROM public.conversas_com_contatos cv
      JOIN public.canais_de_contato cn ON cn.id = cv.canal_id AND cn.empresa_id = cv.empresa_id
     WHERE cv.passada_em IS NOT NULL AND cv.escalada_em IS NULL AND cv.dono_id IS NULL AND NOT cv.com_agente
       AND cv.situacao <> 'resolvida' AND cv.passada_em + make_interval(mins => cn.prazo_para_assumir) < now()
  $$;
COMMENT ON FUNCTION public.empresas_com_passagens_vencidas() IS
  'Para a verificação do prazo da passagem: empresas com conversa passada e ninguém assumiu. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_passagens_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_passagens_vencidas() TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa', 'agente_pronto_para_responder', 'conversa_precisa_de_pessoa', 'conversa_passou_do_prazo'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo IN ('conversa_precisa_de_pessoa', 'conversa_passou_do_prazo');
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa', 'agente_pronto_para_responder'));
DROP FUNCTION public.empresas_com_passagens_vencidas();
ALTER TABLE public.sugestoes_de_resposta DROP COLUMN com_pessoa;
ALTER TABLE public.execucoes_de_agente DROP CONSTRAINT execucoes_tipo_do_atendimento,
  DROP COLUMN tipo_de_atendimento;
DROP INDEX public.conversas_com_passagem_sem_escalar;
ALTER TABLE public.conversas_com_contatos DROP CONSTRAINT conversas_passagem_com_motivo,
  DROP COLUMN com_agente_desde, DROP COLUMN escalada_em, DROP COLUMN resumo_da_passagem,
  DROP COLUMN motivo_da_passagem, DROP COLUMN passada_em;
ALTER TABLE public.canais_de_contato DROP COLUMN sugerir_com_pessoa, DROP COLUMN mensagem_de_passagem,
  DROP COLUMN prazo_para_assumir, DROP COLUMN assuntos_para_pessoas;
