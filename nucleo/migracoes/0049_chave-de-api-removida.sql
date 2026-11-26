-- Ajuste da M7-02 (pedido do Sandro em 26/11/2026): a chave revogada ou vencida pode sair da lista da tela.
-- A linha fica no banco (a auditoria guarda o começo dela e a chave não se apaga): só ganha a data em que saiu.
-- Explicado em docs/banco/decisoes.md, seção 53.

-- Up Migration

ALTER TABLE public.chaves_de_api ADD COLUMN removida_em timestamptz;
ALTER TABLE public.chaves_de_api ADD CONSTRAINT chaves_de_api_so_remove_parada
  CHECK (removida_em IS NULL OR revogada_em IS NOT NULL OR valida_ate <= removida_em);
COMMENT ON COLUMN public.chaves_de_api.removida_em IS
  '[sistema] Quando a chave (já revogada ou vencida) saiu da lista da tela. Ela continua guardada para a auditoria.';

-- Down Migration

ALTER TABLE public.chaves_de_api DROP CONSTRAINT chaves_de_api_so_remove_parada;
ALTER TABLE public.chaves_de_api DROP COLUMN removida_em;
