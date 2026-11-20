-- M4-02: agentes internos, conversa com o coordenador e execuções (contratos em contratos/src/agentes/internos.ts e
-- agente.ts, decisão 0023).
--
-- 1. agentes ganha o tipo "interno", o papel (coordenador ou especialista), a especialidade e a quem responde.
-- 2. conversas e mensagens_de_conversa são de uma pessoa: além da empresa, a política mostra a cada pessoa só as dela.
--    O motor (trabalho do sistema, sem pessoa no pedido) escreve as respostas do agente.
-- 3. execucoes_de_agente registra cada vez que um agente interno trabalha.
-- 4. As empresas que já existem ganham o Coordenador e o Gerente de projetos, pausados (o responsável é o
--    administrador mais antigo). As novas os ganham pelo núcleo, no primeiro uso (garantirAgentesDeNascenca).
-- Explicado em docs/banco/decisoes.md, seção 34.

-- Up Migration

ALTER TABLE public.agentes
  DROP CONSTRAINT agentes_tipo_check,
  ADD CONSTRAINT agentes_tipo_check CHECK (tipo IN ('externo', 'interno')),
  ADD COLUMN papel text CHECK (papel IN ('coordenador', 'especialista')),
  ADD COLUMN especialidade text CHECK (especialidade IN ('gerente_de_projetos')),
  ADD COLUMN responde_a_id uuid,
  ADD CONSTRAINT agentes_responde_a FOREIGN KEY (empresa_id, responde_a_id) REFERENCES public.agentes (empresa_id, id),
  ADD CONSTRAINT agentes_papel_do_tipo CHECK (
    CASE
      WHEN tipo = 'externo' THEN papel IS NULL AND especialidade IS NULL AND responde_a_id IS NULL
      WHEN papel = 'coordenador' THEN especialidade IS NULL AND responde_a_id IS NULL
      WHEN papel = 'especialista' THEN especialidade IS NOT NULL AND responde_a_id IS NOT NULL AND responde_a_id <> id
      ELSE false
    END
  );
-- Um coordenador e um especialista de cada especialidade por empresa (fora os desligados).
CREATE UNIQUE INDEX agentes_um_coordenador ON public.agentes (empresa_id)
  WHERE papel = 'coordenador' AND situacao <> 'desligado';
CREATE UNIQUE INDEX agentes_uma_especialidade ON public.agentes (empresa_id, especialidade)
  WHERE especialidade IS NOT NULL AND situacao <> 'desligado';
COMMENT ON COLUMN public.agentes.tipo IS '[empresa] externo: roda fora e entra pelo MCP. interno: roda dentro do Mago OS (M4-02).';
COMMENT ON COLUMN public.agentes.papel IS '[empresa] Agente interno: coordenador (porta de entrada) ou especialista.';
COMMENT ON COLUMN public.agentes.especialidade IS '[empresa] Especialista: a área dele (no M4, gerente_de_projetos).';
COMMENT ON COLUMN public.agentes.responde_a_id IS '[empresa] Especialista: o coordenador a quem responde.';

CREATE TABLE public.conversas (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL,
  agente_id uuid NOT NULL,
  titulo text NOT NULL CHECK (length(trim(titulo)) BETWEEN 1 AND 120),
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversas_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT conversas_da_pessoa FOREIGN KEY (empresa_id, pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT conversas_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id)
);
CREATE INDEX conversas_da_pessoa_recentes ON public.conversas (empresa_id, pessoa_id, atualizada_em DESC);
COMMENT ON TABLE public.conversas IS 'Conversas de uma pessoa com um agente interno (M4-02). Só a dona vê.';
COMMENT ON COLUMN public.conversas.id IS '[sistema] Identificador da conversa (UUID v7).';
COMMENT ON COLUMN public.conversas.empresa_id IS '[sistema] Empresa da conversa.';
COMMENT ON COLUMN public.conversas.pessoa_id IS '[sistema] Pessoa dona da conversa.';
COMMENT ON COLUMN public.conversas.agente_id IS '[sistema] Agente interno com quem ela fala.';
COMMENT ON COLUMN public.conversas.titulo IS '[pessoal] Título (a primeira frase do pedido).';
COMMENT ON COLUMN public.conversas.criada_em IS '[sistema] Quando a conversa começou.';
COMMENT ON COLUMN public.conversas.atualizada_em IS '[sistema] Última mensagem.';

ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversas FORCE ROW LEVEL SECURITY;
-- A pessoa vê só as dela; o motor (sem pessoa no pedido) responde em qualquer conversa da empresa.
CREATE POLICY conversas_da_pessoa_ativa ON public.conversas
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND (public.pessoa_ativa() IS NULL OR pessoa_id = public.pessoa_ativa()))
  WITH CHECK (empresa_id = public.empresa_ativa() AND (public.pessoa_ativa() IS NULL OR pessoa_id = public.pessoa_ativa()));

CREATE TABLE public.execucoes_de_agente (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  agente_id uuid NOT NULL,
  pedido_por uuid NOT NULL,
  origem text NOT NULL CHECK (origem IN ('conversa', 'tarefa', 'delegacao')),
  conversa_id uuid,
  tarefa_id uuid,
  execucao_mae_id uuid,
  instrucoes text CHECK (length(instrucoes) BETWEEN 1 AND 4000),
  situacao text NOT NULL DEFAULT 'na_fila' CHECK (situacao IN ('na_fila', 'rodando', 'concluida', 'falhou', 'parada')),
  modelo_conta_id uuid,
  modelo text,
  passou_ao_reserva_porque text CHECK (length(passou_ao_reserva_porque) BETWEEN 1 AND 300),
  resumo text CHECK (length(resumo) BETWEEN 1 AND 2000),
  criada_em timestamptz NOT NULL DEFAULT now(),
  iniciada_em timestamptz,
  terminada_em timestamptz,
  CONSTRAINT execucoes_id_da_empresa UNIQUE (empresa_id, id),
  CONSTRAINT execucoes_do_agente FOREIGN KEY (empresa_id, agente_id) REFERENCES public.agentes (empresa_id, id),
  CONSTRAINT execucoes_de_quem_pediu FOREIGN KEY (empresa_id, pedido_por)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE CASCADE,
  CONSTRAINT execucoes_da_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT execucoes_da_tarefa FOREIGN KEY (empresa_id, tarefa_id)
    REFERENCES public.tarefas (empresa_id, id) ON DELETE SET NULL (tarefa_id),
  CONSTRAINT execucoes_da_mae FOREIGN KEY (empresa_id, execucao_mae_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE SET NULL (execucao_mae_id),
  CONSTRAINT execucoes_modelo_inteiro CHECK ((modelo_conta_id IS NULL) = (modelo IS NULL)),
  CONSTRAINT execucoes_horas CHECK (
    (situacao IN ('concluida', 'falhou', 'parada')) = (terminada_em IS NOT NULL)
    AND (situacao = 'na_fila' OR iniciada_em IS NOT NULL)
  )
);
CREATE INDEX execucoes_do_agente_recentes ON public.execucoes_de_agente (empresa_id, agente_id, criada_em DESC);
CREATE INDEX execucoes_na_fila ON public.execucoes_de_agente (empresa_id, criada_em) WHERE situacao = 'na_fila';
COMMENT ON TABLE public.execucoes_de_agente IS 'Cada vez que um agente interno trabalha (M4-02). Custo na M4-06; passo a passo na M4-07.';
COMMENT ON COLUMN public.execucoes_de_agente.id IS '[sistema] Identificador da execução (UUID v7).';
COMMENT ON COLUMN public.execucoes_de_agente.empresa_id IS '[sistema] Empresa da execução.';
COMMENT ON COLUMN public.execucoes_de_agente.agente_id IS '[sistema] Agente interno que trabalhou.';
COMMENT ON COLUMN public.execucoes_de_agente.pedido_por IS '[sistema] Quem pediu: o agente age com a permissão dessa pessoa.';
COMMENT ON COLUMN public.execucoes_de_agente.origem IS '[sistema] conversa, tarefa ou delegacao.';
COMMENT ON COLUMN public.execucoes_de_agente.conversa_id IS '[sistema] Conversa de onde veio (origem conversa).';
COMMENT ON COLUMN public.execucoes_de_agente.tarefa_id IS '[sistema] Tarefa do trabalho (origem tarefa ou delegacao).';
COMMENT ON COLUMN public.execucoes_de_agente.execucao_mae_id IS '[sistema] Execução que delegou esta.';
COMMENT ON COLUMN public.execucoes_de_agente.instrucoes IS '[empresa] Instruções de quem delegou.';
COMMENT ON COLUMN public.execucoes_de_agente.situacao IS '[sistema] na_fila, rodando, concluida, falhou ou parada.';
COMMENT ON COLUMN public.execucoes_de_agente.modelo_conta_id IS '[sistema] Conta de IA que rodou de verdade.';
COMMENT ON COLUMN public.execucoes_de_agente.modelo IS '[sistema] Modelo que rodou de verdade.';
COMMENT ON COLUMN public.execucoes_de_agente.passou_ao_reserva_porque IS '[sistema] Por que o modelo reserva entrou.';
COMMENT ON COLUMN public.execucoes_de_agente.resumo IS '[empresa] O que a execução fez, ou o erro em texto curto.';
COMMENT ON COLUMN public.execucoes_de_agente.criada_em IS '[sistema] Quando entrou na fila.';
COMMENT ON COLUMN public.execucoes_de_agente.iniciada_em IS '[sistema] Quando começou a rodar.';
COMMENT ON COLUMN public.execucoes_de_agente.terminada_em IS '[sistema] Quando terminou.';

ALTER TABLE public.execucoes_de_agente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execucoes_de_agente FORCE ROW LEVEL SECURITY;
CREATE POLICY execucoes_da_empresa_ativa ON public.execucoes_de_agente
  FOR ALL TO mago_app USING (empresa_id = public.empresa_ativa()) WITH CHECK (empresa_id = public.empresa_ativa());

-- Execuções esquecidas (a API reiniciou no meio, ou a fila não recebeu o trabalho): na fila há mais de 2 minutos,
-- ou rodando há mais de 15. Só ids; a verificação a cada minuto põe de novo na fila ou encerra.
CREATE FUNCTION public.execucoes_esquecidas()
  RETURNS TABLE (empresa_id uuid, execucao_id uuid, situacao text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.empresa_id, e.id, e.situacao
      FROM public.execucoes_de_agente e
     WHERE (e.situacao = 'na_fila' AND e.criada_em < now() - interval '2 minutes')
        OR (e.situacao = 'rodando' AND e.iniciada_em < now() - interval '15 minutes')
     LIMIT 100
  $$;
COMMENT ON FUNCTION public.execucoes_esquecidas() IS
  'Para a verificação a cada minuto: execuções paradas na fila ou rodando há tempo demais. Só ids.';
REVOKE EXECUTE ON FUNCTION public.execucoes_esquecidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execucoes_esquecidas() TO mago_app;

CREATE TABLE public.mensagens_de_conversa (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  autor_pessoa_id uuid,
  autor_agente_id uuid,
  texto text NOT NULL CHECK (length(trim(texto)) BETWEEN 1 AND 8000),
  execucao_id uuid,
  tarefas uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(tarefas) <= 20),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mensagens_da_conversa FOREIGN KEY (empresa_id, conversa_id)
    REFERENCES public.conversas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT mensagens_da_execucao FOREIGN KEY (empresa_id, execucao_id)
    REFERENCES public.execucoes_de_agente (empresa_id, id) ON DELETE SET NULL (execucao_id),
  CONSTRAINT mensagens_um_autor CHECK (num_nonnulls(autor_pessoa_id, autor_agente_id) <= 1)
);
CREATE INDEX mensagens_da_conversa_em_ordem ON public.mensagens_de_conversa (conversa_id, criada_em);
COMMENT ON TABLE public.mensagens_de_conversa IS 'Mensagens das conversas com os agentes internos. O texto do agente é mostrado só como texto.';
COMMENT ON COLUMN public.mensagens_de_conversa.id IS '[sistema] Identificador da mensagem (UUID v7).';
COMMENT ON COLUMN public.mensagens_de_conversa.empresa_id IS '[sistema] Empresa da conversa.';
COMMENT ON COLUMN public.mensagens_de_conversa.conversa_id IS '[sistema] Conversa da mensagem.';
COMMENT ON COLUMN public.mensagens_de_conversa.pessoa_id IS '[sistema] Dona da conversa (repetida aqui para a política de acesso).';
COMMENT ON COLUMN public.mensagens_de_conversa.autor_pessoa_id IS '[sistema] Quem escreveu, se foi a pessoa.';
COMMENT ON COLUMN public.mensagens_de_conversa.autor_agente_id IS '[sistema] Quem escreveu, se foi o agente (os dois vazios: o sistema).';
COMMENT ON COLUMN public.mensagens_de_conversa.texto IS '[pessoal] O texto da mensagem.';
COMMENT ON COLUMN public.mensagens_de_conversa.execucao_id IS '[sistema] Execução que produziu a resposta do agente.';
COMMENT ON COLUMN public.mensagens_de_conversa.tarefas IS '[sistema] Tarefas criadas ou citadas, para a tela mostrar o link.';
COMMENT ON COLUMN public.mensagens_de_conversa.criada_em IS '[sistema] Quando a mensagem foi escrita.';

ALTER TABLE public.mensagens_de_conversa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensagens_de_conversa FORCE ROW LEVEL SECURITY;
CREATE POLICY mensagens_da_pessoa_ativa ON public.mensagens_de_conversa
  FOR ALL TO mago_app
  USING (empresa_id = public.empresa_ativa() AND (public.pessoa_ativa() IS NULL OR pessoa_id = public.pessoa_ativa()))
  WITH CHECK (empresa_id = public.empresa_ativa() AND (public.pessoa_ativa() IS NULL OR pessoa_id = public.pessoa_ativa()));

-- Os dois agentes de nascença nas empresas que já existem (pausados até o modelo ser escolhido).
WITH donos AS (
  SELECT DISTINCT ON (v.empresa_id) v.empresa_id, v.pessoa_id
    FROM public.vinculos v
   WHERE v.perfil = 'administrador' AND v.situacao = 'ativo'
   ORDER BY v.empresa_id, v.entrou_em NULLS LAST, v.pessoa_id
), coordenadores AS (
  INSERT INTO public.agentes (empresa_id, nome, descricao, tipo, responsavel_id, situacao, papel)
  SELECT d.empresa_id, 'Coordenador', 'Recebe os pedidos no app e passa ao especialista certo.', 'interno',
         d.pessoa_id, 'pausado', 'coordenador'
    FROM donos d
   WHERE NOT EXISTS (SELECT 1 FROM public.agentes a WHERE a.empresa_id = d.empresa_id AND lower(a.nome) = 'coordenador')
  RETURNING id, empresa_id, responsavel_id
)
INSERT INTO public.agentes (empresa_id, nome, descricao, tipo, responsavel_id, situacao, papel, especialidade, responde_a_id)
SELECT c.empresa_id, 'Gerente de projetos', 'Planeja tarefas em subtarefas e checklist, distribui e acompanha prazos.',
       'interno', c.responsavel_id, 'pausado', 'especialista', 'gerente_de_projetos', c.id
  FROM coordenadores c
 WHERE NOT EXISTS (
   SELECT 1 FROM public.agentes a WHERE a.empresa_id = c.empresa_id AND lower(a.nome) = 'gerente de projetos'
 );

-- Down Migration

DROP TABLE public.mensagens_de_conversa;
DROP FUNCTION public.execucoes_esquecidas();
DROP TABLE public.execucoes_de_agente;
DROP TABLE public.conversas;
DELETE FROM public.agentes WHERE tipo = 'interno' AND papel = 'especialista';
DELETE FROM public.agentes WHERE tipo = 'interno';
DROP INDEX public.agentes_uma_especialidade;
DROP INDEX public.agentes_um_coordenador;
ALTER TABLE public.agentes
  DROP CONSTRAINT agentes_papel_do_tipo,
  DROP CONSTRAINT agentes_responde_a,
  DROP COLUMN responde_a_id,
  DROP COLUMN especialidade,
  DROP COLUMN papel,
  DROP CONSTRAINT agentes_tipo_check,
  ADD CONSTRAINT agentes_tipo_check CHECK (tipo IN ('externo'));
