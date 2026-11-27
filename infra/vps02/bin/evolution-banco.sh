#!/usr/bin/env bash
# Cria (ou acerta a senha de) o banco da Evolution API (M8-02, decisão 0052) no PostgreSQL deste ambiente: o banco
# "evolution", com o usuário "evolution", dono só dele e sem nenhuma permissão nas tabelas do Mago OS. Pode rodar de
# novo sem estragar nada. Fica no mesmo cluster, então o backup (pgBackRest e Backblaze) já leva o banco dela.
#
# Uso (depois do segredos.sh, que grava evolution.env): /opt/mago-os/bin/evolution-banco.sh
#                                                (produção: /opt/mago-os-producao/bin/evolution-banco.sh)
set -euo pipefail
BASE=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck disable=SC1091
[ -f "$BASE/ambiente.conf" ] && . "$BASE/ambiente.conf"
PROJETO=${PROJETO:-mago-os}
[ -s "$BASE/evolution.env" ] || { echo "Falta $BASE/evolution.env: rode o segredos.sh com as chaves da Evolution no Infisical."; exit 1; }
senha=$(python3 -I - "$BASE/evolution.env" <<'PY'
import re, sys, urllib.parse
env = dict(re.findall(r"^(\w+)=(.*)$", open(sys.argv[1]).read(), re.M))
print(urllib.parse.unquote(urllib.parse.urlparse(env["DATABASE_CONNECTION_URI"]).password or ""))
PY
)
[[ "$senha" =~ ^[A-Za-z0-9]{24,}$ ]] || { echo "A senha do banco da Evolution precisa ter 24 ou mais letras e números."; exit 1; }
psql() { docker exec -i "$PROJETO-db-1" psql -U mago -d "$1" -q -v ON_ERROR_STOP=1; }
printf '%s\n' \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evolution') THEN CREATE ROLE evolution LOGIN; END IF; END \$\$;" \
  "ALTER ROLE evolution LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD '$senha';" \
  | psql mago >/dev/null
if ! docker exec "$PROJETO-db-1" psql -U mago -d mago -tAc "SELECT 1 FROM pg_database WHERE datname = 'evolution'" | grep -q 1; then
  echo "CREATE DATABASE evolution OWNER evolution;" | psql mago >/dev/null
fi
# Só o dono entra no banco dela; e ela não ganha nada no banco do Mago OS (as tabelas só dão acesso aos papéis da API).
printf '%s\n' "REVOKE ALL ON DATABASE evolution FROM PUBLIC;" "GRANT CONNECT, TEMPORARY ON DATABASE evolution TO evolution;" \
  | psql mago >/dev/null
echo "CREATE SCHEMA IF NOT EXISTS evolution_api AUTHORIZATION evolution;" | psql evolution >/dev/null
echo "Banco da Evolution pronto."
