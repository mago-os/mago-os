-- M8-08: áudio nas conversas (decisão 0058).
-- 1. contas_de_ia ganha o modelo de transcrição (uma conta por empresa transcreve) e o preço por minuto.
-- 2. mensagens_com_contatos ganha a transcrição do áudio e a situação dela; arquivos_de_conversa ganha a duração.
-- 3. consumo_de_ia ganha o tipo (modelo ou transcrição) e os segundos transcritos; a transcrição pode não ter agente.
-- Explicado em docs/banco/decisoes.md, seção 63.

-- Up Migration

ALTER TABLE public.contas_de_ia
  ADD COLUMN modelo_de_transcricao text CHECK (length(modelo_de_transcricao) BETWEEN 1 AND 120),
  ADD COLUMN preco_da_transcricao integer CHECK (preco_da_transcricao BETWEEN 0 AND 10000000);
CREATE UNIQUE INDEX contas_de_ia_uma_transcreve ON public.contas_de_ia (empresa_id)
  WHERE modelo_de_transcricao IS NOT NULL;
COMMENT ON COLUMN public.contas_de_ia.modelo_de_transcricao IS
  '[empresa] O modelo que transcreve os áudios das conversas (M8-08); nulo: esta conta não transcreve.';
COMMENT ON COLUMN public.contas_de_ia.preco_da_transcricao IS
  '[empresa] Preço da transcrição em microdólares por minuto, ajustado pelo administrador (nulo: o de referência).';

ALTER TABLE public.mensagens_com_contatos
  ADD COLUMN transcricao text CHECK (length(transcricao) <= 20000),
  ADD COLUMN transcricao_situacao text CHECK (transcricao_situacao IN (
    'transcrevendo', 'pronta', 'sem_conta', 'longa_demais', 'no_teto', 'falhou')),
  ADD COLUMN transcrita_em timestamptz;
COMMENT ON COLUMN public.mensagens_com_contatos.transcricao IS
  '[pessoal] No áudio que chegou: o texto transcrito pela conta de IA da empresa (fica depois que o áudio é apagado).';
COMMENT ON COLUMN public.mensagens_com_contatos.transcricao_situacao IS
  '[sistema] transcrevendo, pronta, sem_conta, longa_demais, no_teto ou falhou.';
COMMENT ON COLUMN public.mensagens_com_contatos.transcrita_em IS '[sistema] Quando a transcrição terminou.';

ALTER TABLE public.arquivos_de_conversa
  ADD COLUMN segundos integer CHECK (segundos BETWEEN 0 AND 86400);
COMMENT ON COLUMN public.arquivos_de_conversa.segundos IS '[sistema] No áudio: a duração, como o WhatsApp informa.';

ALTER TABLE public.consumo_de_ia
  ALTER COLUMN agente_id DROP NOT NULL,
  ADD COLUMN tipo text NOT NULL DEFAULT 'modelo' CHECK (tipo IN ('modelo', 'transcricao')),
  ADD COLUMN segundos integer CHECK (segundos BETWEEN 0 AND 86400),
  ADD CONSTRAINT consumo_com_agente CHECK (tipo = 'transcricao' OR agente_id IS NOT NULL);
COMMENT ON COLUMN public.consumo_de_ia.tipo IS '[sistema] modelo (uma chamada de agente) ou transcricao (um áudio, M8-08).';
COMMENT ON COLUMN public.consumo_de_ia.segundos IS '[sistema] Na transcrição: os segundos de áudio.';

-- Down Migration

DELETE FROM public.consumo_de_ia WHERE tipo = 'transcricao';
ALTER TABLE public.consumo_de_ia DROP CONSTRAINT consumo_com_agente, DROP COLUMN segundos, DROP COLUMN tipo,
  ALTER COLUMN agente_id SET NOT NULL;
ALTER TABLE public.arquivos_de_conversa DROP COLUMN segundos;
ALTER TABLE public.mensagens_com_contatos DROP COLUMN transcrita_em, DROP COLUMN transcricao_situacao,
  DROP COLUMN transcricao;
DROP INDEX public.contas_de_ia_uma_transcreve;
ALTER TABLE public.contas_de_ia DROP COLUMN preco_da_transcricao, DROP COLUMN modelo_de_transcricao;
