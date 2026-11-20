-- M3-09: busca Ctrl+K (contrato em contratos/src/busca/busca.ts).
--
-- Busca de texto sem acento e tolerante a erro de digitação: as extensões unaccent e pg_trgm (do próprio
-- PostgreSQL), uma função imutável para_busca (minúsculas e sem acento) e índices de trigramas nos campos buscados.
-- Nenhuma tabela nova: a busca usa as tabelas que já existem, com o RLS e o alcance de sempre.
-- Explicado em docs/banco/decisoes.md, seção 29.

-- Up Migration

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE FUNCTION public.para_busca(texto text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto)) $$;
COMMENT ON FUNCTION public.para_busca(text) IS 'Texto em minúsculas e sem acento, para a busca (M3-09).';

CREATE INDEX tarefas_busca_titulo ON public.tarefas USING gin (public.para_busca(titulo) public.gin_trgm_ops);
CREATE INDEX tarefas_busca_descricao ON public.tarefas USING gin (public.para_busca(descricao) public.gin_trgm_ops);
CREATE INDEX comentarios_busca ON public.comentarios_de_tarefa USING gin (public.para_busca(texto) public.gin_trgm_ops);
CREATE INDEX projetos_busca ON public.projetos USING gin (public.para_busca(nome) public.gin_trgm_ops);
CREATE INDEX espacos_busca ON public.espacos USING gin (public.para_busca(nome) public.gin_trgm_ops);
CREATE INDEX pessoas_busca ON public.pessoas USING gin (public.para_busca(nome) public.gin_trgm_ops);
CREATE INDEX agentes_busca ON public.agentes USING gin (public.para_busca(nome) public.gin_trgm_ops);

-- Down Migration

DROP INDEX public.agentes_busca;
DROP INDEX public.pessoas_busca;
DROP INDEX public.espacos_busca;
DROP INDEX public.projetos_busca;
DROP INDEX public.comentarios_busca;
DROP INDEX public.tarefas_busca_descricao;
DROP INDEX public.tarefas_busca_titulo;
DROP FUNCTION public.para_busca(text);
DROP EXTENSION pg_trgm;
DROP EXTENSION unaccent;
