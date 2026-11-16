#!/usr/bin/env bash
# Backup completo diário do banco do Mago OS para o Backblaze B2 (pgBackRest, criptografado). Chamado pelo cron.
set -euo pipefail
cd /opt/mago-os
echo "== $(date -Is) início"
docker compose exec -T -u postgres db pgbackrest --stanza=mago --type=full --log-level-console=warn backup
docker compose exec -T -u postgres db pgbackrest --stanza=mago info | sed -n "1,4p"
echo "== $(date -Is) fim"
