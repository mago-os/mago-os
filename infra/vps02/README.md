# Infraestrutura do Mago OS na VPS02 (ambiente de testes)

Cópia exata da configuração que roda na VPS02.Ratoeira (Hostinger, Campinas). Nenhum arquivo aqui tem senha:
os segredos ficam no Infisical (projeto `mago-os`, ambiente Staging) e, no servidor, em arquivos que só o root lê.
Explicação completa: Wiki do cliente MagoOS, páginas `infraestrutura.md` e `backup.md`.

| Arquivo aqui | Onde fica no servidor |
|---|---|
| `compose.yaml` | `/opt/mago-os/compose.yaml` |
| `env.example` | `/opt/mago-os/.env` (senha do banco) |
| `backup.env.example` | `/opt/mago-os/backup.env` (gerado por `bin/segredos-backup.sh`) |
| `infisical.env.example` | `/opt/mago-os/infisical.env` (acesso da identidade `vps02`) |
| `db-image/Dockerfile` | `/opt/mago-os/db-image/Dockerfile` (imagem `mago-os-db:pg18`) |
| `pgbackrest/pgbackrest.conf` | `/opt/mago-os/pgbackrest/pgbackrest.conf` |
| `bin/segredos-backup.sh` | `/opt/mago-os/bin/segredos-backup.sh` |
| `bin/backup-diario.sh` | `/opt/mago-os/bin/backup-diario.sh` |
| `caddy/mago-os.caddy` | `/etc/caddy/mago-os.caddy` (incluído no fim do `/etc/caddy/Caddyfile`) |
| `cron/mago-os-backup` | `/etc/cron.d/mago-os-backup` |

## Remontar do zero numa VPS nova

1. Copiar os arquivos para os caminhos da tabela.
2. Criar `/opt/mago-os/.env` e `/opt/mago-os/infisical.env` a partir dos modelos (`chmod 600`).
3. `docker build -t mago-os-db:pg18 /opt/mago-os/db-image` e `/opt/mago-os/bin/segredos-backup.sh`.
4. Para restaurar os dados: `pgbackrest --stanza=mago restore` num volume vazio, antes de subir o banco.
5. `cd /opt/mago-os && docker compose up -d`.
6. Acrescentar `import /etc/caddy/mago-os.caddy` ao Caddyfile e `systemctl reload caddy`.

Ao mudar algo no servidor, atualizar a cópia aqui no mesmo dia.
