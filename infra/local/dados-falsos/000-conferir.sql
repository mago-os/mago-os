-- Dados falsos do ambiente local (M0-03). Nunca colocar aqui dados reais de pessoas ou empresas.
-- Os arquivos rodam em ordem de nome, depois das migrações, a cada "pnpm local:subir" e "pnpm local:zerar".
-- Cada arquivo precisa poder rodar de novo sem erro (use ON CONFLICT DO NOTHING ou IF NOT EXISTS).
-- As empresas falsas "Empresa Teste A" e "Empresa Teste B" ficam em 010-empresas.sql.

-- Confere que o banco local é o mesmo da VPS02: PostgreSQL 18 com pgvector disponível.
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'O Mago OS precisa do PostgreSQL 18, e este banco é o %', current_setting('server_version');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE EXCEPTION 'A extensão pgvector não está disponível neste banco';
  END IF;
END
$$;
