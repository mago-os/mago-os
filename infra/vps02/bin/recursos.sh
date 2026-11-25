#!/usr/bin/env bash
# Confere a memória livre e o disco da VPS02 (M6-05) e avisa o monitoramento (avisar.sh recursos): "falha" com
# menos de 1 GB de memória disponível, disco acima de 80% ou o Backblaze acima de 7 GB; senão, "ok". O teste e a
# produção dividem a VPS02 (e a conta grátis do Backblaze, de 10 GB), então um só aviso olha tudo.
# Roda a cada 5 minutos pelo cron da produção. Também dá para rodar na hora: recursos.sh
set -uo pipefail
BASE=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck disable=SC1091
[ -f "$BASE/ambiente.conf" ] && . "$BASE/ambiente.conf"
PROJETO=${PROJETO:-mago-os}

disponivel_mb=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
disco_pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
problemas=()
[ "$disponivel_mb" -lt 1024 ] && problemas+=("memória disponível ${disponivel_mb} MB (menos de 1 GB)")
[ "$disco_pct" -gt 80 ] && problemas+=("disco ${disco_pct}% cheio")

# O espaço no Backblaze (backup dos dois ambientes) vem do pgBackRest de cada um, uma vez por hora (é lento).
estado=/run/$PROJETO-recursos-b2
if [ ! -f "$estado" ] || [ $(( $(date +%s) - $(stat -c %Y "$estado") )) -gt 3600 ]; then
  total=0
  for pasta in /opt/mago-os /opt/mago-os-producao; do
    [ -f "$pasta/compose.yaml" ] || continue
    bytes=$(cd "$pasta" && docker compose exec -T -u postgres db pgbackrest --stanza=mago --output=json info 2>/dev/null |
      python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)[0]; print(sum(b["info"]["repository"]["delta"] for b in d.get("backup",[])))
except Exception: print(0)')
    total=$(( total + ${bytes:-0} ))
  done
  echo "$total" > "$estado"
fi
b2_mb=$(( $(cat "$estado" 2>/dev/null || echo 0) / 1024 / 1024 ))
[ "$b2_mb" -gt 7168 ] && problemas+=("backups no Backblaze com ${b2_mb} MB (acima de 7 GB dos 10 grátis)")

resumo="memória livre ${disponivel_mb} MB, disco ${disco_pct}%, backups ${b2_mb} MB"
if [ ${#problemas[@]} -eq 0 ]; then
  "$BASE/bin/avisar.sh" recursos ok "$resumo"
else
  "$BASE/bin/avisar.sh" recursos falha "$(IFS='; '; echo "${problemas[*]}")"
fi
