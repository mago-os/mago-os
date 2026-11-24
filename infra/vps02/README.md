# Infraestrutura do Mago OS na VPS02 (ambiente de testes)

Cópia exata da configuração que roda na VPS02.Ratoeira (Hostinger, Campinas). Nenhum arquivo aqui tem senha:
os segredos ficam no Infisical (projeto `mago-os`, ambiente Staging) e, no servidor, em arquivos que só o root lê.
Explicação completa: Wiki do cliente MagoOS, páginas `infraestrutura.md` e `backup.md`.

| Arquivo aqui | Onde fica no servidor |
|---|---|
| `compose.yaml` | `/opt/mago-os/compose.yaml` |
| `env.example` | `/opt/mago-os/.env` (senha do dono do banco, gerado por `bin/segredos.sh`) |
| `backup.env.example` | `/opt/mago-os/backup.env` (gerado por `bin/segredos.sh`) |
| `api.env.example` | `/opt/mago-os/api.env` (conexões da API e das migrações, gerado por `bin/segredos.sh`) |
| `infisical.env.example` | `/opt/mago-os/infisical.env` (acesso da identidade `vps02`) |
| `db-image/Dockerfile` | `/opt/mago-os/db-image/Dockerfile` (imagem `mago-os-db:pg18`) |
| `pgbackrest/pgbackrest.conf` | `/opt/mago-os/pgbackrest/pgbackrest.conf` |
| `bin/segredos.sh` | `/opt/mago-os/bin/segredos.sh` (busca todos os segredos no Infisical) |
| `bin/segredos-backup.sh` | `/opt/mago-os/bin/segredos-backup.sh` (nome antigo, chama o `segredos.sh`) |
| `bin/backup.sh` | `/opt/mago-os/bin/backup.sh` (backup diário, semanal e mensal) |
| `bin/backup-diario.sh` | `/opt/mago-os/bin/backup-diario.sh` (nome antigo, chama o `backup.sh`) |
| `bin/restauracao-teste.sh` | `/opt/mago-os/bin/restauracao-teste.sh` (teste de restauração mensal) |
| `bin/avisar.sh` | `/opt/mago-os/bin/avisar.sh` (avisa o monitoramento) |
| `caddy/mago-os.caddy` | versão antiga, de antes da publicação automática; hoje o `/etc/caddy/mago-os.caddy` é gerado de `caddy/mago-os.caddy.modelo` |
| `cron/mago-os-backup` | `/etc/cron.d/mago-os-backup` |
| `sudoers/90-mago-admin` | `/etc/sudoers.d/90-mago-admin` (usuário de administração `mago-admin`) |
| `avisos.env.example` | `/opt/mago-os/avisos.env` (endereços de aviso do Uptime Kuma, gerado por `bin/segredos.sh`) |
| `campainha.env.example` | `/opt/mago-os/campainha.env` (gerado por `bin/segredos.sh`) |
| `bin/publicar.sh` | `/opt/mago-os/bin/publicar.sh` (publicação no teste, ver `docs/operacao/publicacao.md`) |
| `caddy/mago-os.caddy.modelo` | `/opt/mago-os/caddy/mago-os.caddy.modelo` (o `publicar.sh` gera o `/etc/caddy/mago-os.caddy` a partir dele) |
| `campainha/campainha.py` | `/opt/mago-os/campainha/campainha.py` |
| `systemd/*` | `/etc/systemd/system/` (`mago-os-campainha.service`, `mago-os-publicar.service`, `.timer` e `.path`) |

## Remontar do zero numa VPS nova

1. Copiar os arquivos para os caminhos da tabela.
2. Criar só o `/opt/mago-os/infisical.env` a partir do modelo (`chmod 600`); os outros arquivos de segredos saem do Infisical.
3. `docker build -t mago-os-db:pg18 /opt/mago-os/db-image` e `/opt/mago-os/bin/segredos.sh`.
4. Para restaurar os dados: `pgbackrest --stanza=mago restore` num volume vazio, antes de subir o banco.
5. `cd /opt/mago-os && docker compose up -d`.
6. Acrescentar `import /etc/caddy/mago-os.caddy` ao Caddyfile e `systemctl reload caddy`.

Ao mudar algo no servidor, atualizar a cópia aqui no mesmo dia.

Acesso de administração (usuário `mago-admin`, SSH só com chave, Tailscale e firewall): `docs/operacao/acesso-vps.md`.

Rastreio e registros (M6-02): o `segredos.sh` liga o envio ao Grafana Cloud quando os três `GRAFANA_OTLP_*` existem no Infisical. O painel e os alertas ficam na conta do Grafana e são montados do Mac por `infra/grafana/montar.py` (ver `docs/operacao/rastreio.md`).
