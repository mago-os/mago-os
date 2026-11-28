-- M8-04: caixa única das conversas (decisão 0054).
-- 1. visoes_de_conversas: os filtros da caixa guardados por cada pessoa (só dela).
-- 2. respostas_prontas: os textos da empresa que se usam com "/" na caixa.
-- 3. Busca no texto das mensagens (índice de trigramas, sem acento).
-- 4. conversas_com_contatos.avisado_em: no máximo um aviso de mensagem nova a cada 5 minutos por conversa.
-- 5. Tempo real: a conversa avisa a tela quando muda ou ganha mensagem (só o tipo e o id).
-- 6. Avisos novos: conversa_nova, mensagem_na_conversa e mencao_em_conversa.
-- Explicado em docs/banco/decisoes.md, seção 59.

-- Up Migration

CREATE TABLE public.visoes_de_conversas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  filtro jsonb NOT NULL CHECK (jsonb_typeof(filtro) = 'object'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visoes_de_conversas_da_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX visoes_de_conversas_nome_unico ON public.visoes_de_conversas (empresa_id, pessoa_id, lower(nome));
COMMENT ON TABLE public.visoes_de_conversas IS 'Visões da caixa de conversas salvas por cada pessoa (só dela).';
COMMENT ON COLUMN public.visoes_de_conversas.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.visoes_de_conversas.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.visoes_de_conversas.pessoa_id IS '[sistema] Dona da visão.';
COMMENT ON COLUMN public.visoes_de_conversas.nome IS '[empresa] Nome da visão.';
COMMENT ON COLUMN public.visoes_de_conversas.filtro IS '[empresa] Os filtros (FiltroDeConversas do contrato).';
COMMENT ON COLUMN public.visoes_de_conversas.criada_em IS '[sistema] Quando foi salva.';
ALTER TABLE public.visoes_de_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visoes_de_conversas FORCE ROW LEVEL SECURITY;
CREATE POLICY visoes_de_conversas_da_pessoa_ativa ON public.visoes_de_conversas
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa())
  WITH CHECK (empresa_id = public.empresa_ativa() AND pessoa_id = public.pessoa_ativa());

CREATE TABLE public.respostas_prontas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (nome ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 4096),
  criada_por uuid NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX respostas_prontas_nome_unico ON public.respostas_prontas (empresa_id, nome);
COMMENT ON TABLE public.respostas_prontas IS 'Respostas prontas da empresa (M8-04): na caixa, "/" e o nome trazem o texto.';
COMMENT ON COLUMN public.respostas_prontas.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.respostas_prontas.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.respostas_prontas.nome IS '[empresa] O atalho (minúsculas, números, _ ou -), sem a barra.';
COMMENT ON COLUMN public.respostas_prontas.texto IS '[empresa] O texto que entra na resposta.';
COMMENT ON COLUMN public.respostas_prontas.criada_por IS '[sistema] Quem criou.';
COMMENT ON COLUMN public.respostas_prontas.criada_em IS '[sistema] Quando foi criada.';
COMMENT ON COLUMN public.respostas_prontas.atualizada_em IS '[sistema] A última mudança.';
ALTER TABLE public.respostas_prontas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respostas_prontas FORCE ROW LEVEL SECURITY;
CREATE POLICY respostas_prontas_da_empresa_ativa ON public.respostas_prontas
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE INDEX mensagens_com_contatos_busca
  ON public.mensagens_com_contatos USING gin (public.para_busca(coalesce(texto, '')) public.gin_trgm_ops);

ALTER TABLE public.conversas_com_contatos ADD COLUMN avisado_em timestamptz;
COMMENT ON COLUMN public.conversas_com_contatos.avisado_em IS
  '[sistema] O último aviso de mensagem nova ao dono (no máximo um a cada 5 minutos).';

-- Tempo real (como nas tarefas): só o tipo e o id da conversa; a tela busca pela rota, que confere a permissão.
CREATE FUNCTION public.avisar_mudanca_de_conversa() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    linha record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    id uuid;
  BEGIN
    IF TG_TABLE_NAME = 'conversas_com_contatos' THEN
      id := linha.id;
    ELSE
      id := linha.conversa_id;
    END IF;
    PERFORM pg_notify('mago_mudancas',
      json_build_object('empresaId', linha.empresa_id, 'tipo', 'conversa', 'id', id, 'operacao', lower(TG_OP))::text);
    RETURN NULL;
  END
  $$;
CREATE TRIGGER conversas_com_contatos_avisam AFTER INSERT OR UPDATE OR DELETE ON public.conversas_com_contatos
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca_de_conversa();
CREATE TRIGGER mensagens_com_contatos_avisam AFTER INSERT OR UPDATE ON public.mensagens_com_contatos
  FOR EACH ROW EXECUTE FUNCTION public.avisar_mudanca_de_conversa();

ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens', 'conversa_nova', 'mensagem_na_conversa',
  'mencao_em_conversa'));

-- Down Migration

DELETE FROM public.avisos WHERE tipo IN ('conversa_nova', 'mensagem_na_conversa', 'mencao_em_conversa');
ALTER TABLE public.avisos DROP CONSTRAINT avisos_tipo_check;
ALTER TABLE public.avisos ADD CONSTRAINT avisos_tipo_check CHECK (tipo IN (
  'agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado', 'tarefa_atribuida', 'mencao', 'comentario',
  'resultado_entregue', 'precisa_de_ajuda', 'prazo_hoje', 'prazo_vencido', 'anexo_bloqueado', 'aprovacao_pedida',
  'aprovacao_decidida', 'teto_de_gasto', 'agentes_parados', 'agentes_retomados', 'telegram_desvinculado',
  'telegram_aprovacoes_travadas', 'aviso_de_rotina', 'rotina_falhou', 'rotina_desligada', 'rotina_rodou',
  'convite_de_evento', 'evento_mudou', 'alerta_de_evento', 'chave_de_api_vencendo', 'webhook_desligado',
  'canal_desconectado', 'canal_segurando_mensagens'));
DROP TRIGGER mensagens_com_contatos_avisam ON public.mensagens_com_contatos;
DROP TRIGGER conversas_com_contatos_avisam ON public.conversas_com_contatos;
DROP FUNCTION public.avisar_mudanca_de_conversa();
ALTER TABLE public.conversas_com_contatos DROP COLUMN avisado_em;
DROP INDEX public.mensagens_com_contatos_busca;
DROP TABLE public.respostas_prontas;
DROP TABLE public.visoes_de_conversas;
