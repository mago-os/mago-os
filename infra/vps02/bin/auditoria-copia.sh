#!/usr/bin/env bash
# Copia os eventos novos da auditoria para o depósito travado no Backblaze (M1-09). Roda a cada 5 minutos
# (mago-os-auditoria-copia.timer). Os arquivos ficam travados em modo compliance por 1 ano: ninguém apaga nem
# altera antes disso, nem quem tem acesso total ao servidor.
#
# Passos: exporta até 1000 eventos não copiados (no formato do contrato), envia o arquivo e, só se o envio der
# certo, marca os eventos como copiados. Se algo falhar, os mesmos eventos vão na próxima vez.
# Chaves em /opt/mago-os/auditoria.env (gerado por bin/segredos.sh a partir do Infisical).
set -euo pipefail
# Ambiente (M6-05): o teste usa os padrões; a produção tem ambiente.conf na pasta dela (/opt/mago-os-producao).
BASE=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck disable=SC1091
[ -f "$BASE/ambiente.conf" ] && . "$BASE/ambiente.conf"
PROJETO=${PROJETO:-mago-os}

REDE_BANCO=${PROJETO}_mago_db
ENV_AUDITORIA=$BASE/auditoria.env
log() { echo "$(date -u +%FT%TZ) $*"; }

[ -s "$ENV_AUDITORIA" ] || { log "Sem $ENV_AUDITORIA (chaves do depósito da auditoria): nada a fazer."; exit 0; }
# shellcheck disable=SC1090
source "$ENV_AUDITORIA"
exec 9>"/run/lock/$PROJETO-auditoria-copia.lock"
flock -n 9 || { log "Outra cópia em andamento; saindo."; exit 0; }

alvo=$(cat "$BASE/estado/atual")
pasta=$(mktemp -d)
trap 'rm -rf "$pasta"' EXIT
chmod 777 "$pasta"

quantos=$(docker run --rm --network "$REDE_BANCO" --env-file "$BASE/api.env" -v "$pasta:/saida" "$alvo" \
  node src/auditoria/exportar.ts /saida/lote.jsonl | tail -1)
[ "$quantos" -gt 0 ] 2>/dev/null || exit 0

nome="eventos/$(date -u +%Y/%m/%d)/$(date -u +%Y%m%dT%H%M%SZ)-$quantos.jsonl"
md5=$(openssl dgst -md5 -binary "$pasta/lote.jsonl" | base64)
curl -fsS -m 120 --aws-sigv4 "aws:amz:$AUDITORIA_REGIAO:s3" --user "$AUDITORIA_CHAVE:$AUDITORIA_SEGREDO" \
  -H "Content-MD5: $md5" -H "Content-Type: application/x-ndjson" \
  -T "$pasta/lote.jsonl" "https://$AUDITORIA_ENDPOINT/$AUDITORIA_DEPOSITO/$nome" >/dev/null

# Marca como copiados (a única mudança que a auditoria aceita, e uma vez só).
{ echo "update auditoria.eventos set copiado_em = now() where copiado_em is null and id in ("
  sed "s/.*/'&'/" "$pasta/lote.ids" | paste -sd, -
  echo ");"
} | docker exec -i "$PROJETO-db-1" psql -U mago -d mago -q -v ON_ERROR_STOP=1 >/dev/null
log "Auditoria: $quantos eventos copiados para $nome."
