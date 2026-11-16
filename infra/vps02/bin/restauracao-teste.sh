#!/usr/bin/env bash
# Teste de restauração do backup (M0-11), toda semana pelo cron: restaura a cópia mais recente do Backblaze B2 num
# container separado (com o diário de alterações até o fim), confere os dados contra o banco no ar e apaga tudo.
# Não toca no banco de verdade. No fim, avisa o monitoramento (ok ou falha).
#   restauracao-teste.sh [repo]   (padrão: 1, o diário de 30 dias; 2 = semanal, 3 = mensal)
set -uo pipefail
cd /opt/mago-os
REPO=${1:-1}
NOME=mago-os-restauracao-teste
VOLUME=mago-os-restauracao-teste
IMAGEM=mago-os-db:pg18
log() { echo "$(date -u +%FT%TZ) $*"; }
limpar() { docker rm -f "$NOME" >/dev/null 2>&1; docker volume rm "$VOLUME" >/dev/null 2>&1; }
falhar() { log "FALHOU: $1"; docker logs --tail 20 "$NOME" 2>&1 | sed 's/^/  pg> /'; /opt/mago-os/bin/avisar.sh restauracao falha "$1"; limpar; exit 1; }
trap limpar EXIT
limpar

log "Restaurando a cópia mais recente do repo$REPO num container separado."
docker volume create "$VOLUME" >/dev/null
# archive-mode=off: o banco restaurado nunca envia nada para o depósito.
docker run --rm --env-file backup.env -v "$VOLUME:/var/lib/postgresql" -v /opt/mago-os/pgbackrest:/etc/pgbackrest:ro \
  --network mago-os_mago_backup "$IMAGEM" bash -c "
    set -e
    install -d -o postgres -g postgres -m 700 /var/lib/postgresql/18/docker
    gosu postgres pgbackrest --stanza=mago --repo=$REPO --archive-mode=off --log-level-console=warn restore
  " || falhar "o pgBackRest não conseguiu restaurar"

docker run -d --name "$NOME" --env-file backup.env -v "$VOLUME:/var/lib/postgresql" \
  -v /opt/mago-os/pgbackrest:/etc/pgbackrest:ro --network mago-os_mago_backup --memory 1g "$IMAGEM" postgres >/dev/null

pronto=""
for _ in $(seq 1 90); do
  if [ "$(docker exec "$NOME" psql -U mago -d mago -tAc 'select not pg_is_in_recovery()' 2>/dev/null)" = t ]; then pronto=1; break; fi
  sleep 2
done
[ -n "$pronto" ] || falhar "o banco restaurado não abriu em 3 minutos"

consulta="select (select count(*) from mago_controle.migracoes) || '/' || (select count(*) from public.empresas)"
restaurado=$(docker exec "$NOME" psql -U mago -d mago -tAc "$consulta" 2>/dev/null) || falhar "não consegui ler o banco restaurado"
no_ar=$(docker compose exec -T db psql -U mago -d mago -tAc "$consulta")
log "Migrações/empresas: restaurado $restaurado, no ar $no_ar."
if [ "$REPO" = 1 ] && [ "$restaurado" != "$no_ar" ]; then
  falhar "o banco restaurado ($restaurado) não bate com o banco no ar ($no_ar)"
fi
/opt/mago-os/bin/avisar.sh restauracao ok "repo$REPO restaurado: $restaurado"
log "Pronto: a restauração do repo$REPO funcionou."
