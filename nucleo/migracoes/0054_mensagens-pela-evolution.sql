-- M8-03: receber e enviar mensagens pela Evolution (decisão 0053).
-- 1. arquivos_de_conversa: foto, documento e áudio das mensagens, no bucket dos anexos, passados pelo antivírus,
--    apagados depois do prazo (180 dias, decisão 7 da spec do M8).
-- 2. mensagens_com_contatos: quando saiu para o WhatsApp e as tentativas (para o ritmo e o "tentar de novo").
-- 3. canais_de_contato: o ritmo de envio do número e quando o administrador foi avisado de que ele segurou mensagens.
-- 4. Aviso novo canal_segurando_mensagens.
-- 5. empresas_com_arquivos_de_conversa_vencidos(): para a verificação diária do prazo (só ids).
-- Explicado em docs/banco/decisoes.md, seção 58.

-- Up Migration

ALTER TABLE public.mensagens_com_contatos
  ADD CONSTRAINT mensagens_com_contatos_id_da_empresa UNIQUE (empresa_id, id),
  ADD COLUMN enviada_ao_provedor_em timestamptz,
  ADD COLUMN tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 100);
COMMENT ON COLUMN public.mensagens_com_contatos.enviada_ao_provedor_em IS
  '[sistema] No que sai: quando foi entregue à Evolution (conta para o ritmo de envio do número).';
COMMENT ON COLUMN public.mensagens_com_contatos.tentativas IS '[sistema] No que sai: quantas vezes tentou mandar.';
CREATE INDEX mensagens_com_contatos_do_ritmo ON public.mensagens_com_contatos (canal_id, enviada_ao_provedor_em)
  WHERE enviada_ao_provedor_em IS NOT NULL;

ALTER TABLE public.canais_de_contato
  ADD COLUMN limite_por_minuto integer NOT NULL DEFAULT 20 CHECK (limite_por_minuto BETWEEN 1 AND 120),
  ADD COLUMN limite_por_hora integer NOT NULL DEFAULT 300 CHECK (limite_por_hora BETWEEN 1 AND 5000),
  ADD COLUMN segurando_avisado_em timestamptz;
COMMENT ON COLUMN public.canais_de_contato.limite_por_minuto IS '[empresa] Mensagens que o número manda por minuto, no máximo.';
COMMENT ON COLUMN public.canais_de_contato.limite_por_hora IS '[empresa] Mensagens que o número manda por hora, no máximo.';
COMMENT ON COLUMN public.canais_de_contato.segurando_avisado_em IS
  '[sistema] A última vez que o administrador foi avisado de que o ritmo segurou mensagens (no máximo uma por hora).';

CREATE TABLE public.arquivos_de_conversa (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  mensagem_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 200),
  tipo text NOT NULL CHECK (tipo ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' AND length(tipo) <= 120),
  tamanho bigint CHECK (tamanho BETWEEN 1 AND 26214400),
  situacao text NOT NULL CHECK (situacao IN ('disponivel', 'bloqueado', 'grande_demais', 'nao_baixado', 'apagado')),
  caminho text CHECK (length(caminho) BETWEEN 1 AND 300),
  achado_do_antivirus text CHECK (length(achado_do_antivirus) <= 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  apagar_em timestamptz NOT NULL DEFAULT now() + interval '180 days',
  CONSTRAINT arquivos_de_conversa_da_mensagem UNIQUE (mensagem_id),
  CONSTRAINT arquivos_de_conversa_mensagem FOREIGN KEY (empresa_id, mensagem_id)
    REFERENCES public.mensagens_com_contatos (empresa_id, id) ON DELETE CASCADE,
  -- Só o arquivo liberado pelo antivírus fica no depósito.
  CONSTRAINT arquivos_de_conversa_caminho CHECK ((situacao = 'disponivel') = (caminho IS NOT NULL))
);
CREATE INDEX arquivos_de_conversa_vencidos ON public.arquivos_de_conversa (apagar_em) WHERE situacao = 'disponivel';
COMMENT ON TABLE public.arquivos_de_conversa IS
  'Foto, documento ou áudio de uma mensagem com contato (M8-03), conferido pelo antivírus e apagado depois do prazo.';
COMMENT ON COLUMN public.arquivos_de_conversa.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.arquivos_de_conversa.empresa_id IS '[sistema] Empresa da conversa.';
COMMENT ON COLUMN public.arquivos_de_conversa.mensagem_id IS '[sistema] A mensagem do arquivo.';
COMMENT ON COLUMN public.arquivos_de_conversa.nome IS '[pessoal] Nome do arquivo (limpo antes de gravar).';
COMMENT ON COLUMN public.arquivos_de_conversa.tipo IS '[sistema] Tipo do arquivo (MIME).';
COMMENT ON COLUMN public.arquivos_de_conversa.tamanho IS '[sistema] Tamanho em bytes.';
COMMENT ON COLUMN public.arquivos_de_conversa.situacao IS
  '[sistema] disponivel, bloqueado (antivírus), grande_demais (mais de 25 MB), nao_baixado ou apagado (prazo).';
COMMENT ON COLUMN public.arquivos_de_conversa.caminho IS '[sistema] Onde está no depósito (só o disponível).';
COMMENT ON COLUMN public.arquivos_de_conversa.achado_do_antivirus IS '[sistema] O que o antivírus achou.';
COMMENT ON COLUMN public.arquivos_de_conversa.criado_em IS '[sistema] Quando chegou ou foi enviado.';
COMMENT ON COLUMN public.arquivos_de_conversa.apagar_em IS '[sistema] Quando o arquivo é apagado (o texto da mensagem fica).';
ALTER TABLE public.arquivos_de_conversa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arquivos_de_conversa FORCE ROW LEVEL SECURITY;
CREATE POLICY arquivos_de_conversa_da_empresa_ativa ON public.arquivos_de_conversa
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Para a verificação diária do prazo: empresas com arquivo de conversa vencido. Só ids.
CREATE FUNCTION public.empresas_com_arquivos_de_conversa_vencidos()
  RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT a.empresa_id FROM public.arquivos_de_conversa a
     WHERE a.situacao = 'disponivel' AND a.apagar_em < now()
  $$;
COMMENT ON FUNCTION public.empresas_com_arquivos_de_conversa_vencidos() IS
  'Para a verificação do prazo dos arquivos das conversas: empresas com arquivo vencido. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_arquivos_de_conversa_vencidos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_arquivos_de_conversa_vencidos() TO mago_app;

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo = 'canal_segurando_mensagens';
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado'));
DROP FUNCTION public.empresas_com_arquivos_de_conversa_vencidos();
DROP TABLE public.arquivos_de_conversa;
ALTER TABLE public.canais_de_contato DROP COLUMN segurando_avisado_em, DROP COLUMN limite_por_hora,
  DROP COLUMN limite_por_minuto;
DROP INDEX public.mensagens_com_contatos_do_ritmo;
ALTER TABLE public.mensagens_com_contatos DROP COLUMN tentativas, DROP COLUMN enviada_ao_provedor_em,
  DROP CONSTRAINT mensagens_com_contatos_id_da_empresa;
