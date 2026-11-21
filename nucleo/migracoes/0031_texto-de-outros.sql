-- M4-04: o agente age com a permissão de quem pediu; texto de outros pede aprovação (decisão 0026).
--
-- 1. execucoes_de_agente.leu_texto_de_outros: a execução leu texto de outra pessoa (que não quem pediu) ou de um agente
--    externo; daí em diante, o que muda dados pede aprovação.
-- 2. aprovacoes.por_texto_de_outros: o pedido saiu por causa dessa marca (não conta para a sugestão de liberar).
-- 3. itens_de_checklist ganha quem escreveu o texto (para saber se é texto de outros). Os itens que já existiam ficam
--    com quem criou a tarefa.
-- 4. execucoes_esquecidas() não acorda a fila de agente pausado: a tarefa atribuída espera ele voltar.
-- Explicado em docs/banco/decisoes.md, seção 36.

-- Up Migration

ALTER TABLE public.execucoes_de_agente ADD COLUMN leu_texto_de_outros boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.execucoes_de_agente.leu_texto_de_outros IS
  '[sistema] Leu texto de outra pessoa ou de agente externo: o que muda dados pede aprovação (M4-04).';

ALTER TABLE public.aprovacoes ADD COLUMN por_texto_de_outros boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.aprovacoes.por_texto_de_outros IS
  '[sistema] Pedido porque o agente leu texto de outra pessoa antes (a regra dizia executa).';

ALTER TABLE public.itens_de_checklist
  ADD COLUMN escrito_por_pessoa_id uuid,
  ADD COLUMN escrito_por_agente_id uuid,
  ADD CONSTRAINT itens_escritos_por_pessoa FOREIGN KEY (empresa_id, escrito_por_pessoa_id)
    REFERENCES public.vinculos (empresa_id, pessoa_id) ON DELETE SET NULL (escrito_por_pessoa_id),
  ADD CONSTRAINT itens_escritos_por_agente FOREIGN KEY (empresa_id, escrito_por_agente_id)
    REFERENCES public.agentes (empresa_id, id) ON DELETE SET NULL (escrito_por_agente_id),
  ADD CONSTRAINT itens_um_autor CHECK (num_nonnulls(escrito_por_pessoa_id, escrito_por_agente_id) <= 1);
COMMENT ON COLUMN public.itens_de_checklist.escrito_por_pessoa_id IS '[sistema] Pessoa que escreveu o texto do item.';
COMMENT ON COLUMN public.itens_de_checklist.escrito_por_agente_id IS
  '[sistema] Agente que escreveu o texto do item. Os dois vazios: o sistema.';
UPDATE public.itens_de_checklist i
   SET escrito_por_pessoa_id = t.criada_por_pessoa_id, escrito_por_agente_id = t.criada_por_agente_id
  FROM public.tarefas t
 WHERE t.id = i.tarefa_id AND t.empresa_id = i.empresa_id;

CREATE OR REPLACE FUNCTION public.execucoes_esquecidas()
  RETURNS TABLE (empresa_id uuid, execucao_id uuid, situacao text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.empresa_id, e.id, e.situacao
      FROM public.execucoes_de_agente e
      JOIN public.agentes g ON g.id = e.agente_id AND g.empresa_id = e.empresa_id
     WHERE (e.situacao = 'na_fila' AND e.criada_em < now() - interval '2 minutes' AND g.situacao = 'ativo')
        OR (e.situacao = 'rodando' AND e.iniciada_em < now() - interval '15 minutes')
     LIMIT 100
  $$;

-- Down Migration

CREATE OR REPLACE FUNCTION public.execucoes_esquecidas()
  RETURNS TABLE (empresa_id uuid, execucao_id uuid, situacao text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT e.empresa_id, e.id, e.situacao
      FROM public.execucoes_de_agente e
     WHERE (e.situacao = 'na_fila' AND e.criada_em < now() - interval '2 minutes')
        OR (e.situacao = 'rodando' AND e.iniciada_em < now() - interval '15 minutes')
     LIMIT 100
  $$;
ALTER TABLE public.itens_de_checklist
  DROP CONSTRAINT itens_um_autor,
  DROP CONSTRAINT itens_escritos_por_agente,
  DROP CONSTRAINT itens_escritos_por_pessoa,
  DROP COLUMN escrito_por_agente_id,
  DROP COLUMN escrito_por_pessoa_id;
ALTER TABLE public.aprovacoes DROP COLUMN por_texto_de_outros;
ALTER TABLE public.execucoes_de_agente DROP COLUMN leu_texto_de_outros;
