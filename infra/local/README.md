# Ambiente local

Roda o Mago OS no Mac (ou no ambiente do Claude) em containers, só com dados falsos. Precisa do Docker Desktop ligado.

| Comando | O que faz |
| --- | --- |
| `pnpm local:subir` | Sobe o banco, roda as migrações, carrega os dados falsos e sobe a API |
| `pnpm local:zerar` | Apaga o banco local e sobe de novo, do zero |
| `pnpm local:parar` | Para os containers (o banco local continua guardado) |

- **Banco:** PostgreSQL 18 com pgvector, a mesma base da VPS02, em `postgres://mago@127.0.0.1:54318/mago`. Não tem senha porque só aceita conexões do próprio computador. Para usar outra porta: `MAGO_DB_PORTA=5433 pnpm local:subir`.
- **Papéis do banco:** `mago` é o dono das tabelas (migrações e dados falsos); `mago_app` é o da API, que obedece o isolamento por empresa.
- **Dados falsos:** arquivos `.sql` em `dados-falsos/`, aplicados em ordem de nome. Nunca dados reais.
- **API:** o núcleo roda em `http://127.0.0.1:3000` (rota de saúde em `/saude`), usando o código do Mac direto. Depois de mudar o código: `docker compose -f infra/local/compose.yaml restart api`. Registros: `docker compose -f infra/local/compose.yaml logs -f api`. Outra porta: `MAGO_API_PORTA=3001`.
- **Tela:** entra neste ambiente na M0-06.
