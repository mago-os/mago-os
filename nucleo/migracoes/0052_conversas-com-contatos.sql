-- M8-01: conversas com contatos (contrato em contratos/src/conversas/conversas.ts, decisão 0051).
-- 1. canais_de_contato: os números de WhatsApp e os balões de site da empresa, cada um com a equipe que atende.
-- 2. contatos ganha "identificado" (falso no contato criado sozinho pela conversa) e o canal de origem.
-- 3. conversas_com_contatos: separadas das conversas da pessoa com o coordenador (decisão 1 da spec do M8); uma só
--    conversa não resolvida por contato em cada canal.
-- 4. mensagens_com_contatos: o que chegou, o que saiu e as notas internas, sem gravar duas vezes a mesma mensagem.
-- Explicado em docs/banco/decisoes.md, seção 56.

-- Up Migration

CREATE TABLE public.canais_de_contato (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  provedor text NOT NULL CHECK (provedor IN ('evolution', 'meta', 'site')),
  situacao text NOT NULL DEFAULT 'esperando_conexao'
    CHECK (situacao IN ('esperando_conexao', 'conectado', 'desconectado', 'pausado')),
  identificador text,
  area text CHECK (area ~ '^[a-z][a-z0-9_]{1,39}$'),
  agente_id uuid,
  configuracao jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(configuracao) = 'object'),
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canais_de_contato_id_da_empresa UNIQUE (empresa_id, id),
  -- O número do WhatsApp no formato internacional; o balão do site não tem número.
  CONSTRAINT canais_de_contato_identificador CHECK (
    (provedor = 'site' AND identificador IS NULL)
    OR (provedor <> 'site' AND (identificador IS NULL OR identificador ~ '^\+[1-9][0-9]{7,14}$'))
  ),
  CONSTRAINT canais_de_contato_agente FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (agente_id)
);
-- Um número fica preso a uma empresa só: o índice vale para o banco inteiro, não só para a empresa.
CREATE UNIQUE INDEX canais_de_contato_numero_unico ON public.canais_de_contato (identificador)
  WHERE identificador IS NOT NULL;
COMMENT ON TABLE public.canais_de_contato IS
  'Canais de conversa com quem é de fora (M8-01): um número de WhatsApp (Evolution ou oficial da Meta) ou um balão de site.';
COMMENT ON COLUMN public.canais_de_contato.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.canais_de_contato.empresa_id IS '[sistema] Empresa do canal.';
COMMENT ON COLUMN public.canais_de_contato.nome IS '[empresa] Nome do canal (ex.: WhatsApp comercial).';
COMMENT ON COLUMN public.canais_de_contato.provedor IS '[sistema] evolution, meta (WhatsApp oficial) ou site (balão).';
COMMENT ON COLUMN public.canais_de_contato.situacao IS '[sistema] esperando_conexao, conectado, desconectado ou pausado.';
COMMENT ON COLUMN public.canais_de_contato.identificador IS
  '[empresa] O número conectado (formato internacional). Único no banco inteiro: um número, uma empresa.';
COMMENT ON COLUMN public.canais_de_contato.area IS
  '[empresa] A equipe que atende (a área das pessoas). Vazia: todos os funcionários veem as conversas do canal.';
COMMENT ON COLUMN public.canais_de_contato.agente_id IS '[sistema] O agente que atende o canal (M8-05).';
COMMENT ON COLUMN public.canais_de_contato.configuracao IS
  '[sistema] Configuração do provedor, sem nenhum segredo (os segredos ficam no Infisical ou cifrados).';
COMMENT ON COLUMN public.canais_de_contato.criado_por IS '[sistema] Quem cadastrou o canal.';
COMMENT ON COLUMN public.canais_de_contato.criado_em IS '[sistema] Quando foi cadastrado.';
COMMENT ON COLUMN public.canais_de_contato.atualizado_em IS '[sistema] A última mudança.';
ALTER TABLE public.canais_de_contato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canais_de_contato FORCE ROW LEVEL SECURITY;
CREATE POLICY canais_de_contato_da_empresa_ativa ON public.canais_de_contato
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

ALTER TABLE public.contatos
  ADD COLUMN identificado boolean NOT NULL DEFAULT true,
  ADD COLUMN origem_canal_id uuid,
  ADD CONSTRAINT contatos_canal_de_origem FOREIGN KEY (empresa_id, origem_canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE SET NULL (origem_canal_id);
COMMENT ON COLUMN public.contatos.identificado IS
  '[sistema] Falso no contato criado sozinho por uma conversa, até alguém confirmar o nome (M8-01).';
COMMENT ON COLUMN public.contatos.origem_canal_id IS '[sistema] O canal da conversa que criou o contato, se foi assim.';

CREATE TABLE public.conversas_com_contatos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  canal_id uuid NOT NULL,
  contato_id uuid NOT NULL,
  identificador text NOT NULL CHECK (length(identificador) BETWEEN 1 AND 120),
  mais_de_um_contato boolean NOT NULL DEFAULT false,
  dono_id uuid,
  com_agente boolean NOT NULL DEFAULT false,
  situacao text NOT NULL DEFAULT 'aberta'
    CHECK (situacao IN ('aberta', 'esperando_cliente', 'esperando_equipe', 'resolvida')),
  ultimo_a_responder text CHECK (ultimo_a_responder IN ('contato', 'agente', 'pessoa')),
  ultima_mensagem_em timestamptz,
  aberta_em timestamptz NOT NULL DEFAULT now(),
  resolvida_em timestamptz,
  resolvida_por uuid,
  CONSTRAINT conversas_com_contatos_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT conversas_com_contatos_resolvida CHECK (
    (situacao = 'resolvida') = (resolvida_em IS NOT NULL) AND (resolvida_por IS NULL OR resolvida_em IS NOT NULL)
  ),
  CONSTRAINT conversas_com_contatos_um_dono CHECK (NOT (com_agente AND dono_id IS NOT NULL)),
  -- Apagar um canal com conversas é recusado (pause o canal); apagar o contato apaga as conversas dele (LGPD).
  CONSTRAINT conversas_com_contatos_canal FOREIGN KEY (empresa_id, canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT conversas_com_contatos_contato FOREIGN KEY (empresa_id, contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT conversas_com_contatos_dono FOREIGN KEY (empresa_id, dono_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (dono_id)
);
-- Uma só conversa não resolvida por contato em cada canal: a mensagem que chega continua essa.
CREATE UNIQUE INDEX conversas_com_contatos_uma_aberta ON public.conversas_com_contatos (canal_id, contato_id)
  WHERE situacao <> 'resolvida';
CREATE INDEX conversas_com_contatos_por_identificador
  ON public.conversas_com_contatos (canal_id, identificador, aberta_em DESC);
CREATE INDEX conversas_com_contatos_do_contato ON public.conversas_com_contatos (empresa_id, contato_id, aberta_em DESC);
CREATE INDEX conversas_com_contatos_da_caixa
  ON public.conversas_com_contatos (empresa_id, situacao, ultima_mensagem_em DESC);
COMMENT ON TABLE public.conversas_com_contatos IS
  'Conversas da empresa com contatos (M8-01), num canal. Separadas das conversas da pessoa com o coordenador.';
COMMENT ON COLUMN public.conversas_com_contatos.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.conversas_com_contatos.empresa_id IS '[sistema] Empresa da conversa.';
COMMENT ON COLUMN public.conversas_com_contatos.canal_id IS '[sistema] O canal (número ou balão).';
COMMENT ON COLUMN public.conversas_com_contatos.contato_id IS '[sistema] O contato da conversa.';
COMMENT ON COLUMN public.conversas_com_contatos.identificador IS
  '[pessoal] Por onde o contato fala: o telefone (formato internacional) ou o visitante do site.';
COMMENT ON COLUMN public.conversas_com_contatos.mais_de_um_contato IS
  '[sistema] O telefone está em mais de um contato: a conversa avisa e deixa trocar à mão.';
COMMENT ON COLUMN public.conversas_com_contatos.dono_id IS '[sistema] A pessoa da equipe que cuida da conversa.';
COMMENT ON COLUMN public.conversas_com_contatos.com_agente IS '[sistema] A conversa está com o agente do canal.';
COMMENT ON COLUMN public.conversas_com_contatos.situacao IS
  '[sistema] aberta, esperando_cliente, esperando_equipe ou resolvida (resolvida não reabre sozinha).';
COMMENT ON COLUMN public.conversas_com_contatos.ultimo_a_responder IS '[sistema] contato, agente ou pessoa.';
COMMENT ON COLUMN public.conversas_com_contatos.ultima_mensagem_em IS '[sistema] Hora da última mensagem.';
COMMENT ON COLUMN public.conversas_com_contatos.aberta_em IS '[sistema] Quando a conversa começou.';
COMMENT ON COLUMN public.conversas_com_contatos.resolvida_em IS '[sistema] Quando foi resolvida.';
COMMENT ON COLUMN public.conversas_com_contatos.resolvida_por IS '[sistema] Quem resolveu (vazio: o sistema ou o agente).';
ALTER TABLE public.conversas_com_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversas_com_contatos FORCE ROW LEVEL SECURITY;
CREATE POLICY conversas_com_contatos_da_empresa_ativa ON public.conversas_com_contatos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.mensagens_com_contatos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL,
  canal_id uuid NOT NULL,
  direcao text NOT NULL CHECK (direcao IN ('chegou', 'saiu', 'interna')),
  autor text NOT NULL CHECK (autor IN ('contato', 'agente', 'pessoa', 'sistema')),
  autor_pessoa_id uuid,
  autor_agente_id uuid,
  tipo text NOT NULL
    CHECK (tipo IN ('texto', 'foto', 'documento', 'audio', 'localizacao', 'contato', 'outro', 'nota')),
  texto text CHECK (length(texto) <= 20000),
  id_no_provedor text CHECK (length(id_no_provedor) BETWEEN 1 AND 200),
  enviada_em timestamptz NOT NULL DEFAULT now(),
  recebida_em timestamptz NOT NULL DEFAULT now(),
  pelo_celular boolean NOT NULL DEFAULT false,
  entrega text CHECK (entrega IN ('pendente', 'enviada', 'entregue', 'lida', 'falhou')),
  motivo_da_falha text CHECK (length(motivo_da_falha) <= 300),
  CONSTRAINT mensagens_com_contatos_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas_com_contatos (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT mensagens_com_contatos_canal FOREIGN KEY (empresa_id, canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT mensagens_com_contatos_pessoa FOREIGN KEY (empresa_id, autor_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (autor_pessoa_id),
  CONSTRAINT mensagens_com_contatos_agente FOREIGN KEY (empresa_id, autor_agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (autor_agente_id),
  -- A nota interna só a equipe vê; o contato só escreve o que chega; a entrega só existe no que sai.
  CONSTRAINT mensagens_com_contatos_nota CHECK ((direcao = 'interna') = (tipo = 'nota')),
  CONSTRAINT mensagens_com_contatos_autor CHECK ((autor = 'contato') = (direcao = 'chegou')),
  CONSTRAINT mensagens_com_contatos_entrega CHECK ((entrega IS NOT NULL) = (direcao = 'saiu')),
  CONSTRAINT mensagens_com_contatos_celular CHECK (NOT pelo_celular OR direcao = 'saiu'),
  CONSTRAINT mensagens_com_contatos_um_autor CHECK (num_nonnulls(autor_pessoa_id, autor_agente_id) <= 1)
);
-- A mesma mensagem do provedor não grava duas vezes (o provedor pode mandar o aviso de novo).
CREATE UNIQUE INDEX mensagens_com_contatos_uma_vez ON public.mensagens_com_contatos (canal_id, id_no_provedor)
  WHERE id_no_provedor IS NOT NULL;
-- A ordem da conversa é a hora que o provedor informa (a mensagem que chega fora de ordem fica no lugar certo).
CREATE INDEX mensagens_com_contatos_na_ordem ON public.mensagens_com_contatos (conversa_id, enviada_em, id);
COMMENT ON TABLE public.mensagens_com_contatos IS
  'Mensagens das conversas com contatos (M8-01): o que chegou, o que saiu e as notas internas da equipe.';
COMMENT ON COLUMN public.mensagens_com_contatos.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.mensagens_com_contatos.empresa_id IS '[sistema] Empresa da conversa.';
COMMENT ON COLUMN public.mensagens_com_contatos.conversa_id IS '[sistema] A conversa.';
COMMENT ON COLUMN public.mensagens_com_contatos.canal_id IS '[sistema] O canal (para não gravar duas vezes a mesma mensagem).';
COMMENT ON COLUMN public.mensagens_com_contatos.direcao IS '[sistema] chegou, saiu ou interna (a nota).';
COMMENT ON COLUMN public.mensagens_com_contatos.autor IS '[sistema] Quem escreveu: contato, agente, pessoa ou sistema.';
COMMENT ON COLUMN public.mensagens_com_contatos.autor_pessoa_id IS '[sistema] A pessoa da equipe que escreveu.';
COMMENT ON COLUMN public.mensagens_com_contatos.autor_agente_id IS '[sistema] O agente que escreveu.';
COMMENT ON COLUMN public.mensagens_com_contatos.tipo IS
  '[sistema] texto, foto, documento, audio, localizacao, contato, outro (ainda não mostrado aqui) ou nota.';
COMMENT ON COLUMN public.mensagens_com_contatos.texto IS '[pessoal] O texto da mensagem ou a legenda.';
COMMENT ON COLUMN public.mensagens_com_contatos.id_no_provedor IS '[sistema] O número da mensagem no provedor.';
COMMENT ON COLUMN public.mensagens_com_contatos.enviada_em IS '[sistema] A hora da mensagem (a do provedor, quando há).';
COMMENT ON COLUMN public.mensagens_com_contatos.recebida_em IS '[sistema] Quando o Mago OS gravou.';
COMMENT ON COLUMN public.mensagens_com_contatos.pelo_celular IS
  '[sistema] Alguém respondeu direto no celular do número (não pela caixa).';
COMMENT ON COLUMN public.mensagens_com_contatos.entrega IS '[sistema] No que sai: pendente, enviada, entregue, lida ou falhou.';
COMMENT ON COLUMN public.mensagens_com_contatos.motivo_da_falha IS '[sistema] O motivo que o provedor deu para a falha.';
ALTER TABLE public.mensagens_com_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens_com_contatos FORCE ROW LEVEL SECURITY;
CREATE POLICY mensagens_com_contatos_da_empresa_ativa ON public.mensagens_com_contatos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Down Migration

DROP TABLE public.mensagens_com_contatos;
DROP TABLE public.conversas_com_contatos;
ALTER TABLE public.contatos DROP CONSTRAINT contatos_canal_de_origem, DROP COLUMN origem_canal_id,
  DROP COLUMN identificado;
DROP TABLE public.canais_de_contato;
