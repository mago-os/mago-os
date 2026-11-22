-- M5-03b: descrição do anexo e por onde ele entrou (contrato em contratos/src/tarefas/anexos.ts, decisão 0036).
-- 1. anexos.descricao: o que é o arquivo (opcional, até 500 caracteres), escrita por quem mandou ou por quem edita a
--    tarefa; a do Telegram, o coordenador escreve a partir da legenda.
-- 2. anexos.canal: app ou telegram (a tela mostra "pelo Telegram").
-- 3. Índices de busca no nome e na descrição (o Ctrl+K passa a achar anexos).
-- Explicado em docs/banco/decisoes.md, seção 46.

-- Up Migration

ALTER TABLE public.anexos
  ADD COLUMN descricao text CHECK (length(trim(descricao)) BETWEEN 1 AND 500),
  ADD COLUMN canal text NOT NULL DEFAULT 'app' CHECK (canal IN ('app', 'telegram'));
COMMENT ON COLUMN public.anexos.descricao IS '[empresa] O que é o arquivo, numa frase (opcional).';
COMMENT ON COLUMN public.anexos.canal IS '[sistema] Por onde o anexo entrou: app ou telegram.';
-- Os que vieram do Telegram antes desta migração.
UPDATE public.anexos x SET canal = 'telegram'
  FROM public.arquivos_do_telegram a WHERE a.anexo_id = x.id AND a.empresa_id = x.empresa_id;
-- A API muda só a descrição (o resto do anexo continua com as colunas da M3-08).
GRANT UPDATE (descricao) ON public.anexos TO mago_app;
CREATE INDEX anexos_busca_nome ON public.anexos USING gin (public.para_busca(nome) public.gin_trgm_ops);
CREATE INDEX anexos_busca_descricao ON public.anexos USING gin (public.para_busca(descricao) public.gin_trgm_ops);

-- Down Migration

REVOKE UPDATE (descricao) ON public.anexos FROM mago_app;
DROP INDEX public.anexos_busca_descricao;
DROP INDEX public.anexos_busca_nome;
ALTER TABLE public.anexos DROP COLUMN canal, DROP COLUMN descricao;
