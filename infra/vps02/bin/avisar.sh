#!/usr/bin/env bash
# Avisa o monitoramento (Uptime Kuma, M0-12) que uma rotina terminou: avisar.sh <rotina> <ok|falha> "<mensagem>"
# A URL de cada rotina fica em /opt/mago-os/avisos.env (MAGO_AVISO_<ROTINA>=https://.../api/push/...).
# Sem URL configurada, só registra no log. Se a rotina parar de avisar "ok" no prazo, o Kuma avisa o Sandro.
set -uo pipefail
rotina=${1:?rotina}; situacao=${2:?ok ou falha}; mensagem=${3:-}
chave="MAGO_AVISO_$(echo "$rotina" | tr '[:lower:]-' '[:upper:]_')"
url=$(grep "^$chave=" /opt/mago-os/avisos.env 2>/dev/null | cut -d= -f2- || true)
echo "$(date -u +%FT%TZ) aviso $rotina: $situacao $mensagem"
[ -n "$url" ] || exit 0
status=up; [ "$situacao" = ok ] || status=down
curl -fsS -m 15 -G "$url" --data-urlencode "status=$status" --data-urlencode "msg=$mensagem" >/dev/null || true
