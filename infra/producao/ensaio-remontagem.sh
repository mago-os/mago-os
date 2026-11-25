#!/usr/bin/env bash
# Ensaio de desastre da produção (M6-03, decisão 12 da spec do M6). Remonta a produção do zero numa pasta e em
# containers à parte (/opt/mago-os-ensaio, projeto mago-os-ensaio), seguindo o infra/producao/README.md, só com:
#   - o repositório (a pasta passada como argumento, uma cópia limpa da main);
#   - o Infisical (a credencial da identidade vps02-producao, a única coisa guardada fora do repositório);
#   - os backups do Backblaze (pgBackRest, o diário de alterações até o fim).
# Mede o tempo de cada passo e quantos dados se perderiam, confere a auditoria contra a cópia travada e confere que um
# anexo apagado volta. No fim, apaga tudo o que criou. Não toca na produção (só lê a contagem de linhas para
# comparar), no teste, no Caddy nem na Ratoeira.
#
# Segurança: a cópia restaurada tem dados reais. Por isso a API do ensaio sobe só na rede interna do banco (sem
# internet) e sem as chaves do Telegram, do e-mail, do push, do Google, dos anexos e do Grafana; o banco sobe sem
# enviar nada para o depósito (archive_mode=off) e os avisos do Uptime Kuma ficam desligados.
#
#   sudo bash ensaio-remontagem.sh <pasta do repositório>
set -euo pipefail

FONTE=$(cd "${1:?pasta do repositório}" && pwd)
PRODUCAO=/opt/mago-os-producao
ENSAIO=/opt/mago-os-ensaio
PROJ=mago-os-ensaio
IMAGEM_API=ghcr.io/mago-os/mago-os:producao

inicio=$(date +%s)
passo_inicio=$inicio
log() { echo "$(date -u +%FT%TZ) $*"; }
passo() {
  local agora; agora=$(date +%s)
  log "  (passo anterior: $((agora - passo_inicio)) s; total: $((agora - inicio)) s)"
  passo_inicio=$agora
  log "== $*"
}
limpar() {
  log "== Limpando o ensaio"
  docker rm -f "$PROJ-api" >/dev/null 2>&1 || true
  if [ -f "$ENSAIO/compose.yaml" ]; then
    (cd "$ENSAIO" && docker compose -p "$PROJ" -f compose.yaml -f compose.ensaio.yaml down -v --remove-orphans >/dev/null 2>&1) || true
  fi
  docker volume rm "${PROJ}_db-data" >/dev/null 2>&1 || true
  rm -rf "$ENSAIO"
}
trap limpar EXIT

# O "desastre" acontece agora: a partir daqui, só vale o que já está no Backblaze.
desastre=$(date -u +%FT%TZ)
log "== Desastre simulado em $desastre (a produção continua no ar; o ensaio não a usa)"

passo "1. Pasta e arquivos do repositório (README, passo 1)"
[ ! -e "$ENSAIO" ] || { log "Já existe $ENSAIO (ensaio anterior interrompido?)"; exit 1; }
install -d -m 755 "$ENSAIO"/{bin,caddy,pgbackrest,estado}
install -m 755 "$FONTE"/infra/vps02/bin/*.sh "$ENSAIO/bin/"
install -m 644 "$FONTE/infra/producao/compose.yaml" "$ENSAIO/compose.yaml"
install -m 644 "$FONTE/infra/producao/pgbackrest/pgbackrest.conf" "$ENSAIO/pgbackrest/pgbackrest.conf"
# O ambiente da produção, com o nome do projeto e as portas do ensaio.
sed -e "s/^PROJETO=.*/PROJETO=$PROJ/" \
  -e "s/^PORTA_AZUL=.*/PORTA_AZUL=3301/" -e "s/^PORTA_VERDE=.*/PORTA_VERDE=3302/" \
  "$FONTE/infra/producao/ambiente.conf" > "$ENSAIO/ambiente.conf"
# O banco do ensaio não envia nada para o depósito (ele ainda lê o diário de alterações do Backblaze ao abrir, pela
# rede de backup, como no teste semanal de restauração).
cat > "$ENSAIO/compose.ensaio.yaml" <<'YAML'
services:
  db:
    command: ["postgres", "-c", "archive_mode=off"]
YAML

passo "2. Credencial do Infisical (README, passo 2)"
install -m 600 "$PRODUCAO/infisical.env" "$ENSAIO/infisical.env"

passo "3. Segredos do Infisical (README, passo 3)"
"$ENSAIO/bin/segredos.sh"
: > "$ENSAIO/avisos.env"
# As chaves dos anexos ficam só para a conferência do passo 10, feita daqui (a API do ensaio não as recebe).
grep -E '^MAGO_ANEXOS_(ENDPOINT|BUCKET|CHAVE_ID|CHAVE_SEGREDO)=' "$ENSAIO/api.env" > "$ENSAIO/anexos.env" || true
# Sem nada que fale com o mundo de fora.
sed -i -E '/^(MAGO_TELEGRAM_|MAGO_RESEND_|MAGO_VAPID_|MAGO_GOOGLE_|MAGO_ANEXOS_|MAGO_CLAMAV|OTEL_)/d' "$ENSAIO/api.env"

passo "4. Imagem do banco (README, passo 4)"
docker image inspect mago-os-db:pg18 >/dev/null 2>&1 || docker build -t mago-os-db:pg18 "$FONTE/infra/vps02/db-image"

passo "5. Restaurar o backup do Backblaze (README, passo 5; backup.md, Remontar numa VPS nova)"
cd "$ENSAIO"
# O compose cria as redes e o volume do ensaio (sem ligar nada); o pgBackRest restaura dentro do volume.
docker compose -p "$PROJ" -f compose.yaml -f compose.ensaio.yaml up --no-start db
docker run --rm --env-file backup.env -v "${PROJ}_db-data:/var/lib/postgresql" -v "$ENSAIO/pgbackrest:/etc/pgbackrest:ro" \
  --network "${PROJ}_mago_backup" mago-os-db:pg18 bash -c "
    set -e
    install -d -o postgres -g postgres -m 700 /var/lib/postgresql/18/docker
    gosu postgres pgbackrest --stanza=mago --repo=1 --archive-mode=off --log-level-console=warn restore
  "

passo "6. Subir o banco restaurado"
docker compose -p "$PROJ" -f compose.yaml -f compose.ensaio.yaml up -d db
pronto=""
for _ in $(seq 1 150); do
  if [ "$(docker compose -p "$PROJ" -f compose.yaml -f compose.ensaio.yaml exec -T db psql -U mago -d mago -tAc 'select not pg_is_in_recovery()' 2>/dev/null)" = t ]; then pronto=1; break; fi
  sleep 2
done
[ -n "$pronto" ] || { log "O banco restaurado não abriu em 5 minutos"; exit 1; }
sql_ensaio() { docker compose -p "$PROJ" -f compose.yaml -f compose.ensaio.yaml exec -T db psql -U mago -d mago -tAc "$1"; }
sql_producao() { (cd "$PRODUCAO" && docker compose exec -T db psql -U mago -d mago -tAc "$1"); }
ultima=$(sql_ensaio "select coalesce(to_char(pg_last_xact_replay_timestamp() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), 'sem registro')")
log "Última alteração recuperada: $ultima (desastre em $desastre)"

passo "7. Migrações e API da produção (README, passo 7; sem internet)"
docker image inspect "$IMAGEM_API" >/dev/null 2>&1 || DOCKER_CONFIG="$ENSAIO/.docker" docker pull "$IMAGEM_API"
echo "$IMAGEM_API" > "$ENSAIO/estado/atual"
docker run --rm --network "${PROJ}_mago_db" --env-file api.env "$IMAGEM_API" node src/migrar.ts subir
docker run -d --name "$PROJ-api" --network "${PROJ}_mago_db" --env-file api.env --memory 768m "$IMAGEM_API" >/dev/null
saude=""
for _ in $(seq 1 60); do
  saude=$(docker exec "$PROJ-api" node -e "fetch('http://127.0.0.1:3000/saude').then(r=>r.text()).then(console.log).catch(()=>process.exit(1))" 2>/dev/null || true)
  echo "$saude" | grep -q '"situacao":"ok"' && break
  sleep 2
done
echo "$saude" | grep -q '"situacao":"ok"' || { log "A API do ensaio não ficou saudável: $saude"; docker logs --tail 30 "$PROJ-api"; exit 1; }
log "API do ensaio saudável: $saude"
no_ar_em=$(date +%s)
log "NO AR (sem o DNS) em $((no_ar_em - inicio)) s desde o desastre."

passo "8. Os dados batem com a produção"
contagem="select string_agg(t || '=' || n, ' ' order by t) from (
  select 'empresas' t, count(*) n from public.empresas union all
  select 'pessoas', count(*) from public.pessoas union all
  select 'tarefas', count(*) from public.tarefas union all
  select 'anexos', count(*) from public.anexos union all
  select 'auditoria', count(*) from auditoria.eventos union all
  select 'migracoes', count(*) from mago_controle.migracoes) x"
log "Ensaio:   $(sql_ensaio "$contagem")"
log "Produção: $(sql_producao "$contagem")"

passo "9. Auditoria do banco restaurado contra a cópia travada no Backblaze"
"$ENSAIO/bin/auditoria-verificar.sh"

passo "10. Anexos: todos os do banco existem no depósito, e um anexo apagado volta"
if [ -s "$ENSAIO/anexos.env" ]; then
  # shellcheck disable=SC1091
  . "$ENSAIO/anexos.env"
  host=${MAGO_ANEXOS_ENDPOINT#https://}
  regiao=$(echo "$host" | cut -d. -f2)
  s3() { curl -fsS -m 60 --aws-sigv4 "aws:amz:$regiao:s3" --user "$MAGO_ANEXOS_CHAVE_ID:$MAGO_ANEXOS_CHAVE_SEGREDO" "$@"; }
  faltando=0; total=0
  while read -r caminho; do
    [ -n "$caminho" ] || continue
    total=$((total + 1))
    s3 -I -o /dev/null "https://$host/$MAGO_ANEXOS_BUCKET/$caminho" || { faltando=$((faltando + 1)); log "Falta no depósito: $caminho"; }
  done < <(sql_ensaio "select caminho from public.anexos where situacao = 'disponivel'")
  log "Anexos do banco restaurado no depósito: $((total - faltando)) de $total."
  [ "$faltando" = 0 ] || { log "Há anexos do banco que não estão no depósito"; exit 1; }
  # Um arquivo de teste é enviado, apagado (o depósito guarda a versão anterior por 30 dias) e trazido de volta.
  chave="ensaio-de-desastre/$(date -u +%Y%m%dT%H%M%SZ).txt"
  conteudo="ensaio de desastre $desastre"
  s3 -X PUT --data-binary "$conteudo" -o /dev/null "https://$host/$MAGO_ANEXOS_BUCKET/$chave"
  s3 -X DELETE -o /dev/null "https://$host/$MAGO_ANEXOS_BUCKET/$chave"
  if s3 -I -o /dev/null "https://$host/$MAGO_ANEXOS_BUCKET/$chave" 2>/dev/null; then log "O arquivo apagado continuou visível"; exit 1; fi
  versoes=$(s3 "https://$host/$MAGO_ANEXOS_BUCKET/?versions&prefix=$chave")
  marcador=$(echo "$versoes" | python3 -c 'import sys,re;x=sys.stdin.read();m=re.search(r"<DeleteMarker>.*?<VersionId>([^<]+)</VersionId>",x,re.S);print(m.group(1) if m else "")')
  [ -n "$marcador" ] || { log "O depósito não guardou a versão anterior do arquivo apagado"; exit 1; }
  s3 -X DELETE -o /dev/null "https://$host/$MAGO_ANEXOS_BUCKET/$chave?versionId=$marcador"
  volta=$(s3 "https://$host/$MAGO_ANEXOS_BUCKET/$chave")
  [ "$volta" = "$conteudo" ] || { log "O arquivo apagado não voltou igual"; exit 1; }
  log "Anexo apagado voltou igual."
  # Tirar o arquivo de teste de vez (todas as versões).
  for v in $(s3 "https://$host/$MAGO_ANEXOS_BUCKET/?versions&prefix=$chave" | grep -o '<VersionId>[^<]*' | sed 's/<VersionId>//'); do
    s3 -X DELETE -o /dev/null "https://$host/$MAGO_ANEXOS_BUCKET/$chave?versionId=$v" || true
  done
else
  log "Sem as chaves dos anexos no Infisical: conferência dos anexos pulada."
fi

fim=$(date +%s)
passo "Fim"
log "RESULTADO: no ar em $((no_ar_em - inicio)) s; ensaio inteiro em $((fim - inicio)) s; última alteração recuperada $ultima, desastre $desastre."
