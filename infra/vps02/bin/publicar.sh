#!/usr/bin/env bash
# Publica no teste a versão mais nova do Mago OS (M0-10), sem tirar a antiga do ar antes da nova estar saudável.
#
#   publicar.sh            confere se há versão nova em ghcr.io/mago-os/mago-os:teste e publica (o normal)
#   publicar.sh voltar     volta para a versão anterior
#   publicar.sh forcar     publica de novo a versão de :teste, mesmo que já seja a atual
#
# Chamado pela campainha do GitHub (mago-os-publicar.path) e, como reserva, a cada minuto (mago-os-publicar.timer).
# Passos: baixa a imagem, roda as migrações, liga a versão nova ao lado da antiga, confere a saúde, troca o
# Caddy, confere de novo pelo endereço público e só então desliga a antiga. Se algo falhar, a antiga continua.
set -euo pipefail
# Ambiente (M6-05): o teste usa os padrões; a produção tem ambiente.conf na pasta dela (/opt/mago-os-producao).
BASE=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck disable=SC1091
[ -f "$BASE/ambiente.conf" ] && . "$BASE/ambiente.conf"
PROJETO=${PROJETO:-mago-os}

IMAGEM=ghcr.io/mago-os/mago-os
TAG=${TAG:-teste}
DOMINIO=${DOMINIO:-teste.osmago.com}
PORTA_AZUL=${PORTA_AZUL:-3101}
PORTA_VERDE=${PORTA_VERDE:-3102}
ESTADO=$BASE/estado
TELAS=${TELAS:-/srv/mago-os/telas}
CADDY=${CADDY:-/etc/caddy/mago-os.caddy}
REDE_BANCO=${PROJETO}_mago_db
REDE_BORDA=${PROJETO}-borda
# Produção: backup antes de publicar; enquanto não há DNS, o Caddy usa certificado próprio (curl -k na conferência).
BACKUP_ANTES_DE_PUBLICAR=${BACKUP_ANTES_DE_PUBLICAR:-0}
CURL_EXTRA=${CURL_EXTRA:-}
MODO=${1:-auto}

log() { echo "$(date -u +%FT%TZ) $*"; }
mkdir -p "$ESTADO" "$TELAS"
exec 9>"/run/lock/$PROJETO-publicar.lock"
flock -n 9 || { log "Outra publicação em andamento; saindo."; exit 0; }

atual=$(cat "$ESTADO/atual" 2>/dev/null || true)
if [ "$MODO" = voltar ]; then
  alvo=$(cat "$ESTADO/anterior" 2>/dev/null || true)
  [ -n "$alvo" ] || { log "Não há versão anterior para voltar."; exit 1; }
else
  docker pull -q "$IMAGEM:$TAG" >/dev/null
  alvo=$(docker image inspect "$IMAGEM:$TAG" --format '{{index .RepoDigests 0}}')
fi
if [ "$alvo" = "$atual" ] && [ "$MODO" = auto ]; then exit 0; fi

versao=$(docker image inspect "$alvo" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
log "Publicando a versão ${versao:0:7} ($MODO)."

# 0. Produção: backup completo antes de mudar o banco (na primeira publicação, ainda não há o que guardar).
if [ "$BACKUP_ANTES_DE_PUBLICAR" = 1 ] && [ -n "$atual" ]; then
  "$BASE/bin/backup.sh" antes-de-publicar || { log "FALHOU: o backup antes de publicar não deu certo. Nada mudou."; exit 1; }
fi

# 1. Migrações, com o papel dono das tabelas. Se falharem, nada muda.
docker run --rm --network "$REDE_BANCO" --env-file "$BASE/api.env" "$alvo" node src/migrar.ts subir

# 2. Senhas dos papéis da API e do login iguais às do Infisical (as migrações criam os papéis sem senha).
for par in mago_app:MAGO_DB_SENHA_APP mago_acesso:MAGO_DB_SENHA_ACESSO; do
  papel=${par%%:*}; chave=${par#*:}
  senha=$(grep "^$chave=" "$BASE/api.env" | cut -d= -f2-)
  [[ "$senha" =~ ^[A-Za-z0-9]+$ ]] || { log "$chave precisa ser só letras e números."; exit 1; }
  printf "ALTER ROLE %s PASSWORD '%s';\n" "$papel" "$senha" | docker exec -i "$PROJETO-db-1" psql -U mago -d mago -q -v ON_ERROR_STOP=1 >/dev/null
done

# 3. Liga a versão nova ao lado da antiga (teste: azul na porta 3101, verde na 3102; produção: 3201 e 3202).
cor_atual=$(cat "$ESTADO/cor" 2>/dev/null || echo verde)
if [ "$cor_atual" = azul ]; then cor=verde; porta=$PORTA_VERDE; else cor=azul; porta=$PORTA_AZUL; fi
docker network inspect "$REDE_BORDA" >/dev/null 2>&1 || docker network create "$REDE_BORDA" >/dev/null
docker rm -f "$PROJETO-api-$cor" >/dev/null 2>&1 || true
docker run -d --name "$PROJETO-api-$cor" --restart unless-stopped \
  --network "$REDE_BORDA" -p "127.0.0.1:$porta:3000" --env-file "$BASE/api.env" \
  --memory 768m --cpus 1 --log-opt max-size=10m --log-opt max-file=3 "$alvo" >/dev/null
docker network connect "$REDE_BANCO" "$PROJETO-api-$cor"
# Antivírus dos anexos (M3-08), quando o container existir.
if docker network inspect "${PROJETO}_mago_antivirus" >/dev/null 2>&1; then
  docker network connect "${PROJETO}_mago_antivirus" "$PROJETO-api-$cor"
fi

desistir() {
  log "FALHOU: $1. A versão anterior continua no ar."
  docker logs --tail 30 "$PROJETO-api-$cor" 2>&1 | sed 's/^/  api> /' || true
  docker rm -f "$PROJETO-api-$cor" >/dev/null 2>&1 || true
  exit 1
}

# 4. Saúde da versão nova, direto no container (até 60 segundos).
saudavel=""
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$porta/saude" 2>/dev/null | grep -q "\"versao\":\"$versao\""; then saudavel=1; break; fi
  sleep 2
done
[ -n "$saudavel" ] || desistir "a versão nova não ficou saudável em 60 segundos"

# 5. Tela da versão nova, servida pelo Caddy.
rm -rf "$TELAS/$versao.tmp"
docker cp "$PROJETO-api-$cor:/app/telas" "$TELAS/$versao.tmp"
rm -rf "$TELAS/$versao" && mv "$TELAS/$versao.tmp" "$TELAS/$versao"
chmod -R a+rX "$TELAS/$versao"

# 6. Troca o Caddy (recarrega, sem reiniciar: a Ratoeira não sente). Se o Caddy recusar, volta o arquivo antigo.
cp "$CADDY" "$CADDY.antes"
sed -e "s|{{PORTA_API}}|$porta|g" -e "s|{{PASTA_TELA}}|$TELAS/$versao|g" "$BASE/caddy/$PROJETO.caddy.modelo" > "$CADDY"
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  cp "$CADDY.antes" "$CADDY"; desistir "o Caddy recusou a configuração nova"
fi
systemctl reload caddy

# 7. Confere pelo endereço público, passando pelo Caddy.
publico=""
for _ in $(seq 1 10); do
  # shellcheck disable=SC2086
  if curl -fsS $CURL_EXTRA --resolve "$DOMINIO:443:127.0.0.1" "https://$DOMINIO/api/saude" 2>/dev/null | grep -q "\"versao\":\"$versao\""; then publico=1; break; fi
  sleep 1
done
if [ -z "$publico" ]; then
  cp "$CADDY.antes" "$CADDY"; systemctl reload caddy; desistir "$DOMINIO não mostrou a versão nova"
fi

# 8. Desliga a antiga (depois de 10 segundos, para terminar os pedidos em andamento) e guarda o estado.
if docker inspect "$PROJETO-api-$cor_atual" >/dev/null 2>&1; then
  sleep 10; docker rm -f "$PROJETO-api-$cor_atual" >/dev/null 2>&1 || true
fi
if [ -n "$atual" ] && [ "$atual" != "$alvo" ]; then echo "$atual" > "$ESTADO/anterior"; fi
echo "$alvo" > "$ESTADO/atual"; echo "$cor" > "$ESTADO/cor"; echo "$versao" > "$ESTADO/versao"
echo "$(date -u +%FT%TZ) $versao $MODO" >> "$ESTADO/historico"

# 9. Limpeza: guarda as 3 últimas telas e imagens.
ls -1t "$TELAS" | tail -n +4 | while read -r velha; do rm -rf "${TELAS:?}/$velha"; done
docker images "$IMAGEM" --format '{{.ID}}' | awk '!v[$0]++' | tail -n +4 | xargs -r docker rmi >/dev/null 2>&1 || true
log "Pronto: $DOMINIO está na versão ${versao:0:7} (cor $cor)."
