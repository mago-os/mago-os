#!/usr/bin/env bash
# Backup do banco do Mago OS para o Backblaze B2 (pgBackRest, criptografado). Chamado pelo cron todo dia
# (e com "antes-de-publicar" pelo publicar.sh da produção).
#   Todo dia: cópia completa no repo1 (30 dias).
#   Domingo: também no repo2 (90 dias).  Dia 1: também no repo3 (1 ano).
# No fim, avisa o monitoramento (ok ou falha) e mostra o estado dos depósitos.
set -uo pipefail
# Ambiente (M6-05): o teste usa os padrões; a produção tem ambiente.conf na pasta dela (/opt/mago-os-producao).
BASE=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck disable=SC1091
[ -f "$BASE/ambiente.conf" ] && . "$BASE/ambiente.conf"
PROJETO=${PROJETO:-mago-os}
cd "$BASE"
pgb() { docker compose exec -T -u postgres db pgbackrest --stanza=mago --log-level-console=warn "$@"; }
# Antes de publicar na produção (publicar.sh): uma cópia rápida (só o que mudou desde a última) no repo1.
if [ "${1:-}" = antes-de-publicar ]; then
  echo "== $(date -Is) cópia antes de publicar"
  pgb --repo=1 --type=incr backup
  exit $?
fi
echo "== $(date -Is) início"
falhas=()
pgb --repo=1 --type=full backup || falhas+=("diário")
if [ "$(date -u +%u)" = 7 ]; then pgb --repo=2 --type=full backup || falhas+=("semanal"); fi
if [ "$(date -u +%d)" = 01 ]; then pgb --repo=3 --type=full backup || falhas+=("mensal"); fi
pgb info | grep -E "^stanza|status|full backup" | tail -n 8
if [ ${#falhas[@]} -eq 0 ]; then
  "$BASE/bin/avisar.sh" backup ok "backup $(date -u +%F) ok"
else
  "$BASE/bin/avisar.sh" backup falha "falhou: ${falhas[*]}"
fi
echo "== $(date -Is) fim"
[ ${#falhas[@]} -eq 0 ]
