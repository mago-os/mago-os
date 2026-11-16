# Ambiente local

Roda o Mago OS no Mac (ou no ambiente do Claude) em containers, só com dados falsos. Precisa do Docker Desktop ligado.

| Comando | O que faz |
| --- | --- |
| `pnpm local:subir` | Sobe tudo e carrega os dados falsos |
| `pnpm local:zerar` | Apaga o banco local e sobe de novo, do zero |
| `pnpm local:parar` | Para os containers (o banco local continua guardado) |

- **Banco:** PostgreSQL 18 com pgvector, a mesma base da VPS02, em `postgres://mago@127.0.0.1:54318/mago`. Não tem senha porque só aceita conexões do próprio computador. Para usar outra porta: `MAGO_DB_PORTA=5433 pnpm local:subir`.
- **Dados falsos:** arquivos `.sql` em `dados-falsos/`, aplicados em ordem de nome. Nunca dados reais.
- **API e tela:** entram neste ambiente na M0-04 e na M0-06.
