-- M8-07: chat no site (decisão 0057).
-- 1. canais_de_contato ganha, no balão do site: a chave pública (vale no banco inteiro), os domínios onde o balão
--    abre, a cor, a posição, a mensagem de boas-vindas, o link da política de privacidade e o WhatsApp para continuar.
-- 2. visitantes_do_site: o visitante do balão, lembrado pelo resumo (hash) do código guardado no navegador.
-- 3. pedidos_do_balao: os pedidos de cada endereço de internet (resumo), para os limites; apagados depois de um dia.
-- 4. codigos_para_o_whatsapp: o código de "continuar no WhatsApp" (30 minutos, uso único).
-- 5. mensagens_com_contatos ganha a página do site (sem o que vem depois do "?" e do "#") e conversas_com_contatos
--    ganha o contato que o visitante pode ser (o e-mail ou o telefone que ele deixou já estão noutro contato).
-- 6. canal_do_balao(chave) e empresas_com_visitantes_vencidos(): para as rotas públicas e o prazo de 90 dias (só ids).
-- Explicado em docs/banco/decisoes.md, seção 62.

-- Up Migration

ALTER TABLE public.canais_de_contato
  ADD COLUMN chave_publica text CHECK (chave_publica ~ '^[A-Za-z0-9]{22}$'),
  ADD COLUMN dominios text[] NOT NULL DEFAULT '{}' CHECK (cardinality(dominios) <= 10),
  ADD COLUMN cor text NOT NULL DEFAULT '#4f46e5' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN posicao text NOT NULL DEFAULT 'direita' CHECK (posicao IN ('direita', 'esquerda')),
  ADD COLUMN boas_vindas text NOT NULL DEFAULT 'Olá! Como podemos ajudar?'
    CHECK (length(trim(boas_vindas)) BETWEEN 1 AND 500),
  ADD COLUMN politica_url text CHECK (politica_url ~ '^https://' AND length(politica_url) <= 500),
  ADD COLUMN whatsapp_canal_id uuid,
  ADD CONSTRAINT canais_whatsapp_para_continuar FOREIGN KEY (empresa_id, whatsapp_canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE SET NULL (whatsapp_canal_id),
  -- Só o balão do site tem chave. O balão sem chave (criado antes desta versão) não abre até o administrador trocar a chave.
  ADD CONSTRAINT canais_do_site_com_chave CHECK (chave_publica IS NULL OR provedor = 'site');
CREATE UNIQUE INDEX canais_de_contato_chave_publica ON public.canais_de_contato (chave_publica)
  WHERE chave_publica IS NOT NULL;
COMMENT ON COLUMN public.canais_de_contato.chave_publica IS
  '[sistema] No balão do site: a chave da linha de código (não dá acesso a nada além de abrir o balão).';
COMMENT ON COLUMN public.canais_de_contato.dominios IS
  '[empresa] No balão do site: os endereços (https, exatos) onde ele pode abrir, até 10.';
COMMENT ON COLUMN public.canais_de_contato.cor IS '[empresa] No balão do site: a cor do botão.';
COMMENT ON COLUMN public.canais_de_contato.posicao IS '[empresa] No balão do site: direita ou esquerda.';
COMMENT ON COLUMN public.canais_de_contato.boas_vindas IS '[empresa] No balão do site: a mensagem de boas-vindas.';
COMMENT ON COLUMN public.canais_de_contato.politica_url IS
  '[empresa] No balão do site: o link da política de privacidade da empresa (obrigatório para o balão abrir).';
COMMENT ON COLUMN public.canais_de_contato.whatsapp_canal_id IS
  '[empresa] No balão do site: o canal de WhatsApp de "continuar no WhatsApp" (nulo: sem o botão).';

CREATE TABLE public.visitantes_do_site (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  canal_id uuid NOT NULL,
  codigo_hash text NOT NULL UNIQUE CHECK (codigo_hash ~ '^[0-9a-f]{64}$'),
  prova_hash text NOT NULL UNIQUE CHECK (prova_hash ~ '^[0-9a-f]{64}$'),
  contato_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  visto_em timestamptz NOT NULL DEFAULT now(),
  vence_em timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT visitantes_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT visitantes_do_canal FOREIGN KEY (empresa_id, canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT visitantes_contato FOREIGN KEY (empresa_id, contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE SET NULL (contato_id)
);
CREATE INDEX visitantes_do_site_por_canal ON public.visitantes_do_site (canal_id, criado_em);
COMMENT ON TABLE public.visitantes_do_site IS
  'Visitantes do balão do site (M8-07): o navegador guarda o código; aqui fica só o resumo dele, por 30 dias.';
COMMENT ON COLUMN public.visitantes_do_site.id IS '[sistema] Identificador (vai na conversa como "visitante:<id>").';
COMMENT ON COLUMN public.visitantes_do_site.empresa_id IS '[sistema] Empresa do canal.';
COMMENT ON COLUMN public.visitantes_do_site.canal_id IS '[sistema] O balão onde o visitante entrou.';
COMMENT ON COLUMN public.visitantes_do_site.codigo_hash IS '[sensivel] Resumo (SHA-256) do código do visitante.';
COMMENT ON COLUMN public.visitantes_do_site.prova_hash IS
  '[sistema] Resumo da prova de trabalho usada ao entrar (cada prova vale uma vez).';
COMMENT ON COLUMN public.visitantes_do_site.contato_id IS '[sistema] O contato do visitante, depois da primeira mensagem.';
COMMENT ON COLUMN public.visitantes_do_site.criado_em IS '[sistema] Quando entrou.';
COMMENT ON COLUMN public.visitantes_do_site.visto_em IS '[sistema] A última vez que o balão dele falou com o Mago OS.';
COMMENT ON COLUMN public.visitantes_do_site.vence_em IS '[sistema] Até quando o código vale (30 dias, renovado a cada uso).';
ALTER TABLE public.visitantes_do_site ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitantes_do_site FORCE ROW LEVEL SECURITY;
CREATE POLICY visitantes_do_site_da_empresa_ativa ON public.visitantes_do_site
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.pedidos_do_balao (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  canal_id uuid NOT NULL,
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pedidos_do_canal FOREIGN KEY (empresa_id, canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE CASCADE
);
CREATE INDEX pedidos_do_balao_por_ip ON public.pedidos_do_balao (canal_id, ip_hash, criado_em);
COMMENT ON TABLE public.pedidos_do_balao IS
  'Mensagens mandadas pelo balão, por endereço de internet (M8-07): para o limite por minuto. Apagadas depois de um dia.';
COMMENT ON COLUMN public.pedidos_do_balao.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.pedidos_do_balao.empresa_id IS '[sistema] Empresa do canal.';
COMMENT ON COLUMN public.pedidos_do_balao.canal_id IS '[sistema] O balão.';
COMMENT ON COLUMN public.pedidos_do_balao.ip_hash IS '[sensivel] Resumo (SHA-256, com sal) do endereço de internet.';
COMMENT ON COLUMN public.pedidos_do_balao.criado_em IS '[sistema] Quando.';
ALTER TABLE public.pedidos_do_balao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_do_balao FORCE ROW LEVEL SECURITY;
CREATE POLICY pedidos_do_balao_da_empresa_ativa ON public.pedidos_do_balao
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.codigos_para_o_whatsapp (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  visitante_id uuid NOT NULL,
  whatsapp_canal_id uuid NOT NULL,
  codigo text NOT NULL CHECK (codigo ~ '^[A-HJ-NP-Z2-9]{6}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  vence_em timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  usado_em timestamptz,
  CONSTRAINT codigos_do_visitante FOREIGN KEY (empresa_id, visitante_id)
    REFERENCES public.visitantes_do_site (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT codigos_do_canal FOREIGN KEY (empresa_id, whatsapp_canal_id)
    REFERENCES public.canais_de_contato (empresa_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX codigos_para_o_whatsapp_valendo ON public.codigos_para_o_whatsapp (whatsapp_canal_id, codigo)
  WHERE usado_em IS NULL;
COMMENT ON TABLE public.codigos_para_o_whatsapp IS
  'O código de "continuar no WhatsApp" (M8-07): liga o visitante ao telefone que mandar o código (30 minutos, uso único).';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.id IS '[sistema] Identificador.';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.empresa_id IS '[sistema] Empresa.';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.visitante_id IS '[sistema] O visitante que pediu.';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.whatsapp_canal_id IS '[sistema] O canal de WhatsApp que recebe o código.';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.codigo IS '[sistema] O código (6 letras e números, sem os parecidos).';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.criado_em IS '[sistema] Quando.';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.vence_em IS '[sistema] Até quando vale.';
COMMENT ON COLUMN public.codigos_para_o_whatsapp.usado_em IS '[sistema] Quando chegou pelo WhatsApp.';
ALTER TABLE public.codigos_para_o_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.codigos_para_o_whatsapp FORCE ROW LEVEL SECURITY;
CREATE POLICY codigos_para_o_whatsapp_da_empresa_ativa ON public.codigos_para_o_whatsapp
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

ALTER TABLE public.mensagens_com_contatos
  ADD COLUMN pagina_url text CHECK (length(pagina_url) <= 500),
  ADD COLUMN pagina_titulo text CHECK (length(pagina_titulo) <= 200);
COMMENT ON COLUMN public.mensagens_com_contatos.pagina_url IS
  '[pessoal] No balão do site: a página onde o visitante escreveu, sem o que vem depois do "?" e do "#".';
COMMENT ON COLUMN public.mensagens_com_contatos.pagina_titulo IS '[pessoal] No balão do site: o título da página.';

ALTER TABLE public.conversas_com_contatos
  ADD COLUMN pode_ser_contato_id uuid,
  ADD CONSTRAINT conversas_pode_ser_contato FOREIGN KEY (empresa_id, pode_ser_contato_id)
    REFERENCES public.contatos (empresa_id, id) ON DELETE SET NULL (pode_ser_contato_id);
COMMENT ON COLUMN public.conversas_com_contatos.pode_ser_contato_id IS
  '[sistema] O contato que já tem o e-mail ou o telefone que o cliente deixou: a equipe confere e troca (nunca junta sozinho).';

-- As rotas públicas do balão: a empresa e o canal pela chave (só ids; nulo sem a chave).
CREATE FUNCTION public.canal_do_balao(chave text)
  RETURNS TABLE (empresa_id uuid, canal_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT cn.empresa_id, cn.id FROM public.canais_de_contato cn
     WHERE cn.provedor = 'site' AND cn.chave_publica = chave
  $$;
COMMENT ON FUNCTION public.canal_do_balao(text) IS 'Para as rotas públicas do balão: a empresa e o canal da chave. Só ids.';
REVOKE EXECUTE ON FUNCTION public.canal_do_balao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canal_do_balao(text) TO mago_app;

-- Para a verificação diária: empresas com visitante vencido, pedidos antigos ou conversa de visitante sem contato
-- há 90 dias (decisão 9 da spec do M8). Só ids.
CREATE FUNCTION public.empresas_com_visitantes_vencidos()
  RETURNS TABLE (empresa_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT v.empresa_id FROM public.visitantes_do_site v WHERE v.vence_em < now()
    UNION
    SELECT p.empresa_id FROM public.pedidos_do_balao p WHERE p.criado_em < now() - interval '1 day'
    UNION
    SELECT cv.empresa_id FROM public.conversas_com_contatos cv
      JOIN public.canais_de_contato cn ON cn.id = cv.canal_id AND cn.empresa_id = cv.empresa_id
      JOIN public.contatos k ON k.id = cv.contato_id AND k.empresa_id = cv.empresa_id
     WHERE cn.provedor = 'site' AND NOT k.identificado
       AND coalesce(cv.ultima_mensagem_em, cv.aberta_em) < now() - interval '90 days'
  $$;
COMMENT ON FUNCTION public.empresas_com_visitantes_vencidos() IS
  'Para a verificação diária do balão: empresas com visitante vencido, pedidos antigos ou conversa de visitante sem contato há 90 dias. Só ids.';
REVOKE EXECUTE ON FUNCTION public.empresas_com_visitantes_vencidos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresas_com_visitantes_vencidos() TO mago_app;

-- Down Migration

DROP FUNCTION public.empresas_com_visitantes_vencidos();
DROP FUNCTION public.canal_do_balao(text);
ALTER TABLE public.conversas_com_contatos DROP CONSTRAINT conversas_pode_ser_contato, DROP COLUMN pode_ser_contato_id;
ALTER TABLE public.mensagens_com_contatos DROP COLUMN pagina_titulo, DROP COLUMN pagina_url;
DROP TABLE public.codigos_para_o_whatsapp;
DROP TABLE public.pedidos_do_balao;
DROP TABLE public.visitantes_do_site;
DROP INDEX public.canais_de_contato_chave_publica;
DELETE FROM public.canais_de_contato WHERE provedor = 'site';
ALTER TABLE public.canais_de_contato DROP CONSTRAINT canais_do_site_com_chave,
  DROP CONSTRAINT canais_whatsapp_para_continuar, DROP COLUMN whatsapp_canal_id, DROP COLUMN politica_url,
  DROP COLUMN boas_vindas, DROP COLUMN posicao, DROP COLUMN cor, DROP COLUMN dominios, DROP COLUMN chave_publica;
