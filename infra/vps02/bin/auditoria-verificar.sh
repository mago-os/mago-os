#!/usr/bin/env bash
# Verificação diária da auditoria (M1-09): baixa a cópia travada do Backblaze, confere cada corrente no banco e
# compara com a cópia. Avisa o monitoramento (avisar.sh auditoria): "ok" quando tudo bate, "falha" com o motivo.
# Também dá para rodar na hora: /opt/mago-os/bin/auditoria-verificar.sh
set -uo pipefail

BASE=/opt/mago-os
REDE_BANCO=mago-os_mago_db
ENV_AUDITORIA=$BASE/auditoria.env
log() { echo "$(date -u +%FT%TZ) $*"; }

[ -s "$ENV_AUDITORIA" ] || { log "Sem $ENV_AUDITORIA: verificação só do banco."; }
# shellcheck disable=SC1090
[ -s "$ENV_AUDITORIA" ] && source "$ENV_AUDITORIA"

alvo=$(cat "$BASE/estado/atual")
pasta=$(mktemp -d)
trap 'rm -rf "$pasta"' EXIT
chmod 755 "$pasta"
argumentos=()

if [ -n "${AUDITORIA_CHAVE:-}" ]; then
  s3() { curl -fsS -m 120 --aws-sigv4 "aws:amz:$AUDITORIA_REGIAO:s3" --user "$AUDITORIA_CHAVE:$AUDITORIA_SEGREDO" "$@"; }
  marcador=""
  while :; do
    lista=$(s3 "https://$AUDITORIA_ENDPOINT/$AUDITORIA_DEPOSITO/?list-type=2&prefix=eventos/${marcador:+&continuation-token=$marcador}") || {
      /opt/mago-os/bin/avisar.sh auditoria falha "não consegui listar a cópia no Backblaze"; exit 1; }
    for chave in $(echo "$lista" | grep -o '<Key>[^<]*</Key>' | sed 's/<[^>]*>//g'); do
      s3 -o "$pasta/$(echo "$chave" | tr '/' '_')" "https://$AUDITORIA_ENDPOINT/$AUDITORIA_DEPOSITO/$chave" || {
        /opt/mago-os/bin/avisar.sh auditoria falha "não consegui baixar $chave"; exit 1; }
    done
    marcador=$(echo "$lista" | grep -o '<NextContinuationToken>[^<]*' | sed 's/<NextContinuationToken>//' || true)
    [ -n "$marcador" ] || break
    marcador=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$marcador")
  done
  argumentos=(--copias /copias)
fi

saida=$(docker run --rm --network "$REDE_BANCO" --env-file "$BASE/api.env" -v "$pasta:/copias:ro" "$alvo" \
  node src/auditoria/verificar.ts "${argumentos[@]}")
codigo=$?
resumo=$(echo "$saida" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["resumo"])' 2>/dev/null || echo "sem resumo")
if [ $codigo -eq 0 ]; then
  log "Auditoria íntegra: $resumo."
  /opt/mago-os/bin/avisar.sh auditoria ok "$resumo"
else
  log "AUDITORIA COM PROBLEMA: $saida"
  /opt/mago-os/bin/avisar.sh auditoria falha "problema na auditoria ($resumo); ver /var/log/mago-os-auditoria.log"
  exit 1
fi
