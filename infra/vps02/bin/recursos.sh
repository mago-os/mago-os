#!/usr/bin/env bash
# Confere a memória livre e o disco da VPS02 (M6-05) e avisa o monitoramento (avisar.sh recursos): "falha" com
# menos de 1 GB de memória disponível, disco acima de 80% ou o Backblaze (todos os buckets) acima de 7 GB; senão,
# "ok". O teste e a produção dividem a VPS02 (e a conta grátis do Backblaze, de 10 GB): um só aviso olha tudo.
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

# O espaço no Backblaze: todos os buckets dos dois ambientes (backup com o diário de alterações, anexos e auditoria),
# somando também as versões escondidas que o Backblaze ainda guarda. Uma vez por hora (cada consulta conta no limite
# grátis de operações). Se não conseguir medir, avisa a falha (nunca conta como zero).
estado=/run/$PROJETO-recursos-b2
if [ ! -f "$estado" ] || [ $(( $(date +%s) - $(stat -c %Y "$estado") )) -gt 3600 ]; then
  python3 -I - /opt/mago-os /opt/mago-os-producao > "$estado.tmp" <<'PY'
import base64, json, os, re, sys, urllib.request
def ler(arquivo):
    try:
        return dict(re.findall(r"^(\w+)=(.*)$", open(arquivo).read(), re.M))
    except OSError:
        return {}
chaves = set()
for pasta in sys.argv[1:]:
    b = ler(os.path.join(pasta, "backup.env")); a = ler(os.path.join(pasta, "api.env")); u = ler(os.path.join(pasta, "auditoria.env"))
    for par in ((b.get("PGBACKREST_REPO1_S3_KEY"), b.get("PGBACKREST_REPO1_S3_KEY_SECRET")),
                (a.get("MAGO_ANEXOS_CHAVE_ID"), a.get("MAGO_ANEXOS_CHAVE_SEGREDO")),
                (u.get("AUDITORIA_CHAVE"), u.get("AUDITORIA_SEGREDO"))):
        if all(par):
            chaves.add(par)
if not chaves:
    sys.exit("sem as chaves do Backblaze")
total = 0
for chave, segredo in chaves:
    cab = {"Authorization": "Basic " + base64.b64encode(f"{chave}:{segredo}".encode()).decode()}
    conta = json.load(urllib.request.urlopen(urllib.request.Request(
        "https://api.backblazeb2.com/b2api/v3/b2_authorize_account", headers=cab), timeout=30))
    api = conta["apiInfo"]["storageApi"]; balde = api.get("bucketId") or api["allowed"]["buckets"][0]["id"]
    proximo = {}
    while True:
        corpo = json.dumps({"bucketId": balde, "maxFileCount": 10000, **proximo}).encode()
        r = json.load(urllib.request.urlopen(urllib.request.Request(
            api["apiUrl"] + "/b2api/v3/b2_list_file_versions", data=corpo,
            headers={"Authorization": conta["authorizationToken"]}), timeout=60))
        total += sum(f.get("contentLength", 0) for f in r["files"])
        if not r.get("nextFileName"):
            break
        proximo = {"startFileName": r["nextFileName"], **({"startFileId": r["nextFileId"]} if r.get("nextFileId") else {})}
print(total)
PY
  if [ $? -eq 0 ] && [ -s "$estado.tmp" ]; then mv "$estado.tmp" "$estado"; else rm -f "$estado.tmp" "$estado"; fi
fi
if [ -s "$estado" ]; then
  b2_mb=$(( $(cat "$estado") / 1024 / 1024 ))
  [ "$b2_mb" -gt 7168 ] && problemas+=("Backblaze com ${b2_mb} MB (acima de 7 GB dos 10 grátis)")
else
  b2_mb="?"; problemas+=("não consegui medir o espaço no Backblaze")
fi

resumo="memória livre ${disponivel_mb} MB, disco ${disco_pct}%, Backblaze ${b2_mb} MB"
if [ ${#problemas[@]} -eq 0 ]; then
  "$BASE/bin/avisar.sh" recursos ok "$resumo"
else
  "$BASE/bin/avisar.sh" recursos falha "$(IFS='; '; echo "${problemas[*]}")"
fi
