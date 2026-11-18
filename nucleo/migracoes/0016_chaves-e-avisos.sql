-- M2-04: chave do agente, limites, sinal de vida e avisos (contrato em contratos/src/agentes/chave.ts, decisão 0017).
--
-- 1. chaves_de_agente: o banco guarda só o começo da chave (único) e o resumo SHA-256 da chave inteira.
-- 2. Antes de saber a empresa, o MCP precisa achar a chave pelo começo: a função reconhecer_chave (dono) devolve só
--    o necessário para conferir, e nada de outras empresas aparece por ela sem o começo exato.
-- 3. contadores_de_agente: pedidos por minuto (por chave) e leituras por hora (por agente), no banco, para valer com
--    mais de uma cópia da API.
-- 4. avisos: avisos para uma pessoa dentro do Mago OS (agente sem sinal, passou do limite, desligado).
-- 5. agentes_sem_sinal: a verificação a cada minuto acha, em todas as empresas, os agentes com tarefa pegada e sem
--    sinal há mais tempo que o limite deles. Devolve só ids; o trabalho em cada empresa roda com a empresa dela.
-- Explicado em docs/banco/decisoes.md, seção 20.

-- Up Migration

CREATE TABLE public.chaves_de_agente (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 80),
  prefixo text NOT NULL UNIQUE CHECK (prefixo ~ '^mago_ag_[0-9a-z]{10}$'),
  resumo text NOT NULL CHECK (resumo ~ '^[0-9a-f]{64}$'),
  criada_por uuid NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  valida_ate timestamptz,
  ultimo_uso_em timestamptz,
  revogada_em timestamptz,
  revogada_por uuid,
  CONSTRAINT chaves_do_agente_da_empresa FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT chaves_criador_da_empresa FOREIGN KEY (empresa_id, criada_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT chaves_revogador_da_empresa FOREIGN KEY (empresa_id, revogada_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id),
  CONSTRAINT chaves_revogada_diz_quem CHECK ((revogada_em IS NULL) = (revogada_por IS NULL)),
  CONSTRAINT chaves_validade_depois CHECK (valida_ate IS NULL OR valida_ate > criada_em)
);
CREATE INDEX chaves_por_agente ON public.chaves_de_agente (empresa_id, agente_id);
COMMENT ON TABLE public.chaves_de_agente IS
  'Chaves dos agentes. Só o começo e o resumo SHA-256 ficam aqui: a chave inteira aparece uma vez, na tela.';
COMMENT ON COLUMN public.chaves_de_agente.id IS '[sistema] Identificador da chave (UUID v7).';
COMMENT ON COLUMN public.chaves_de_agente.empresa_id IS '[sistema] Empresa do agente.';
COMMENT ON COLUMN public.chaves_de_agente.agente_id IS '[sistema] Agente dono da chave.';
COMMENT ON COLUMN public.chaves_de_agente.nome IS '[empresa] Para que serve a chave (ex.: Mac do Sandro).';
COMMENT ON COLUMN public.chaves_de_agente.prefixo IS '[sistema] Começo da chave (mago_ag_ + 10 caracteres), para achar e reconhecer na lista.';
COMMENT ON COLUMN public.chaves_de_agente.resumo IS '[sensivel] Resumo SHA-256 da chave inteira. A chave em si não fica guardada.';
COMMENT ON COLUMN public.chaves_de_agente.criada_por IS '[sistema] Pessoa que criou a chave.';
COMMENT ON COLUMN public.chaves_de_agente.criada_em IS '[sistema] Quando a chave foi criada.';
COMMENT ON COLUMN public.chaves_de_agente.valida_ate IS '[empresa] Até quando a chave vale. Vazio: até ser revogada.';
COMMENT ON COLUMN public.chaves_de_agente.ultimo_uso_em IS '[sistema] Último pedido aceito com a chave.';
COMMENT ON COLUMN public.chaves_de_agente.revogada_em IS '[sistema] Quando a chave foi revogada (deixa de valer no pedido seguinte).';
COMMENT ON COLUMN public.chaves_de_agente.revogada_por IS '[sistema] Pessoa que revogou a chave.';

ALTER TABLE public.chaves_de_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chaves_de_agente FORCE ROW LEVEL SECURITY;
CREATE POLICY chaves_da_empresa_ativa ON public.chaves_de_agente
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
-- Chave não se apaga (a auditoria guarda o começo dela): revoga-se.
REVOKE DELETE ON public.chaves_de_agente FROM mago_app;

-- Achar a chave pelo começo, antes de saber a empresa. Devolve uma linha só, e só com o começo exato.
CREATE FUNCTION public.reconhecer_chave(prefixo_da_chave text)
  RETURNS TABLE (chave_id uuid, empresa_id uuid, agente_id uuid, resumo text, valida_ate timestamptz,
                 revogada_em timestamptz, situacao_do_agente text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT k.id, k.empresa_id, k.agente_id, k.resumo, k.valida_ate, k.revogada_em, a.situacao
      FROM public.chaves_de_agente k JOIN public.agentes a ON a.id = k.agente_id AND a.empresa_id = k.empresa_id
     WHERE k.prefixo = prefixo_da_chave
  $$;
COMMENT ON FUNCTION public.reconhecer_chave(text) IS
  'Acha a chave pelo começo (o pedido do agente ainda não tem empresa). A conferência do resumo é feita na API.';
REVOKE EXECUTE ON FUNCTION public.reconhecer_chave(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconhecer_chave(text) TO mago_app;

CREATE TABLE public.contadores_de_agente (
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid NOT NULL,
  chave_id uuid,
  janela text NOT NULL CHECK (janela IN ('pedidos_minuto', 'leituras_hora')),
  inicio timestamptz NOT NULL,
  valor integer NOT NULL DEFAULT 0 CHECK (valor >= 0),
  CONSTRAINT contadores_do_agente_da_empresa FOREIGN KEY (empresa_id, agente_id)
    REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT contadores_chave_so_nos_pedidos CHECK ((janela = 'pedidos_minuto') = (chave_id IS NOT NULL))
);
-- Um contador por agente, chave (nos pedidos), janela e início. NULLS NOT DISTINCT: leituras_hora sem chave.
CREATE UNIQUE INDEX contadores_unicos ON public.contadores_de_agente (agente_id, chave_id, janela, inicio) NULLS NOT DISTINCT;
COMMENT ON TABLE public.contadores_de_agente IS
  'Contadores dos limites dos agentes: pedidos por minuto (por chave) e leituras por hora (por agente). Apagados depois de 2 horas.';
COMMENT ON COLUMN public.contadores_de_agente.empresa_id IS '[sistema] Empresa do agente.';
COMMENT ON COLUMN public.contadores_de_agente.agente_id IS '[sistema] Agente contado.';
COMMENT ON COLUMN public.contadores_de_agente.chave_id IS '[sistema] Chave usada (só nos pedidos por minuto).';
COMMENT ON COLUMN public.contadores_de_agente.janela IS '[sistema] pedidos_minuto ou leituras_hora.';
COMMENT ON COLUMN public.contadores_de_agente.inicio IS '[sistema] Começo da janela (minuto ou hora cheios).';
COMMENT ON COLUMN public.contadores_de_agente.valor IS '[sistema] Quantos pedidos ou registros lidos na janela.';
ALTER TABLE public.contadores_de_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contadores_de_agente FORCE ROW LEVEL SECURITY;
CREATE POLICY contadores_da_empresa_ativa ON public.contadores_de_agente
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

CREATE TABLE public.avisos (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('agente_sem_sinal', 'agente_passou_do_limite', 'agente_desligado')),
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 500),
  link text NOT NULL CHECK (link ~ '^/[a-z0-9/_-]*$' AND length(link) <= 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  lido_em timestamptz,
  CONSTRAINT avisos_pessoa_da_empresa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id)
);
CREATE INDEX avisos_por_pessoa ON public.avisos (empresa_id, pessoa_id, criado_em DESC) WHERE lido_em IS NULL;
COMMENT ON TABLE public.avisos IS 'Avisos para uma pessoa dentro do Mago OS, mostrados no Início até ela marcar como lido.';
COMMENT ON COLUMN public.avisos.id IS '[sistema] Identificador do aviso (UUID v7).';
COMMENT ON COLUMN public.avisos.empresa_id IS '[sistema] Empresa do aviso.';
COMMENT ON COLUMN public.avisos.pessoa_id IS '[sistema] Pessoa que recebe o aviso.';
COMMENT ON COLUMN public.avisos.tipo IS '[sistema] agente_sem_sinal, agente_passou_do_limite ou agente_desligado.';
COMMENT ON COLUMN public.avisos.texto IS '[empresa] O que aconteceu, numa frase.';
COMMENT ON COLUMN public.avisos.link IS '[sistema] Tela do Mago OS a abrir (sempre um caminho interno).';
COMMENT ON COLUMN public.avisos.criado_em IS '[sistema] Quando o aviso foi criado.';
COMMENT ON COLUMN public.avisos.lido_em IS '[sistema] Quando a pessoa marcou como lido.';
ALTER TABLE public.avisos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avisos FORCE ROW LEVEL SECURITY;
CREATE POLICY avisos_da_empresa_ativa ON public.avisos
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());
REVOKE DELETE ON public.avisos FROM mago_app;

-- Agentes com tarefa pegada e sem sinal há mais que o limite deles (contando desde a trava, se nunca deram sinal).
CREATE FUNCTION public.agentes_sem_sinal()
  RETURNS TABLE (empresa_id uuid, agente_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT DISTINCT t.empresa_id, a.id
      FROM public.tarefas t JOIN public.agentes a ON a.id = t.travada_por_agente_id AND a.empresa_id = t.empresa_id
     WHERE greatest(coalesce(a.ultimo_sinal_em, t.travada_em), t.travada_em)
           < now() - make_interval(mins => a.minutos_sem_sinal)
  $$;
COMMENT ON FUNCTION public.agentes_sem_sinal() IS
  'Para a verificação a cada minuto: agentes com tarefa pegada e sem sinal há mais que o limite. Só ids.';
REVOKE EXECUTE ON FUNCTION public.agentes_sem_sinal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agentes_sem_sinal() TO mago_app;

-- Contadores com mais de 2 horas não servem mais para nenhum limite.
CREATE FUNCTION public.limpar_contadores_de_agente() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    WITH apagados AS (DELETE FROM public.contadores_de_agente WHERE inicio < now() - interval '2 hours' RETURNING 1)
    SELECT count(*)::integer FROM apagados
  $$;
COMMENT ON FUNCTION public.limpar_contadores_de_agente() IS 'Apaga os contadores de limite com mais de 2 horas.';
REVOKE EXECUTE ON FUNCTION public.limpar_contadores_de_agente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.limpar_contadores_de_agente() TO mago_app;

-- Down Migration

DROP FUNCTION public.limpar_contadores_de_agente();
DROP FUNCTION public.agentes_sem_sinal();
DROP TABLE public.avisos;
DROP TABLE public.contadores_de_agente;
DROP FUNCTION public.reconhecer_chave(text);
DROP TABLE public.chaves_de_agente;
