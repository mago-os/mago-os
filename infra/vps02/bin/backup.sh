#!/usr/bin/env bash
# Backup do banco do Mago OS para o Backblaze B2 (pgBackRest, criptografado). Chamado pelo cron todo dia.
#   Todo dia: cópia completa no repo1 (30 dias).
#   Domingo: também no repo2 (90 dias).  Dia 1: também no repo3 (1 ano).
# No fim, avisa o monitoramento (ok ou falha) e mostra o estado dos depósitos.
set -uo pipefail
cd /opt/mago-os
pgb() { docker compose exec -T -u postgres db pgbackrest --stanza=mago --log-level-console=warn "$@"; }
echo "== $(date -Is) início"
falhas=()
pgb --repo=1 --type=full backup || falhas+=("diário")
if [ "$(date -u +%u)" = 7 ]; then pgb --repo=2 --type=full backup || falhas+=("semanal"); fi
if [ "$(date -u +%d)" = 01 ]; then pgb --repo=3 --type=full backup || falhas+=("mensal"); fi
pgb info | grep -E "^stanza|status|full backup" | tail -n 8
if [ ${#falhas[@]} -eq 0 ]; then
  /opt/mago-os/bin/avisar.sh backup ok "backup $(date -u +%F) ok"
else
  /opt/mago-os/bin/avisar.sh backup falha "falhou: ${falhas[*]}"
fi
echo "== $(date -Is) fim"
[ ${#falhas[@]} -eq 0 ]
