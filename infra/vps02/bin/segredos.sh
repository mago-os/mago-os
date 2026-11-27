#!/usr/bin/env bash
# Busca no Infisical (projeto mago-os, ambiente staging) todos os segredos do Mago OS na VPS02 e grava,
# só para o root ler:
#   /opt/mago-os/.env         senha do dono do banco (container do PostgreSQL)
#   /opt/mago-os/backup.env   chaves do Backblaze B2 e senha de criptografia do pgBackRest
#   /opt/mago-os/api.env      conexões da API (papéis mago_app e mago_acesso), das migrações (dono) e do login
#   /opt/mago-os/campainha.env segredo que confere a assinatura da campainha do GitHub (M0-10)
#   /opt/mago-os/avisos.env   endereços de aviso do Uptime Kuma para o backup e a restauração (M0-12)
#   /opt/mago-os/evolution.env  a Evolution API (M8-02), quando o Infisical tem MAGO_EVOLUTION_CHAVE,
#                             MAGO_EVOLUTION_SEGREDO e MAGO_DB_SENHA_EVOLUTION (a API recebe as MAGO_EVOLUTION_*)
#   /opt/mago-os/auditoria.env chaves do depósito travado da auditoria (M1-09), quando existirem
# e entra no ghcr.io com o token só de leitura, para baixar a imagem do Mago OS.
# Uso: /opt/mago-os/bin/segredos.sh   (depois: docker compose up -d --force-recreate, para os containers lerem)
# Nenhum valor aparece na tela nem no log.
set -euo pipefail
# Ambiente (M6-05): o teste usa os padrões; a produção tem ambiente.conf na pasta dela (outro projeto do Infisical).
BASE=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
# shellcheck disable=SC1091
[ -f "$BASE/ambiente.conf" ] && . "$BASE/ambiente.conf"
export AMBIENTE=${AMBIENTE:-teste}
export INFISICAL_PROJETO=${INFISICAL_PROJETO:-7e951d3d-b27b-4e98-96ff-30ddbeef7bf2}
export INFISICAL_AMBIENTE=${INFISICAL_AMBIENTE:-staging}
export DOMINIO=${DOMINIO:-teste.osmago.com}
export DEPOSITO_AUDITORIA=${DEPOSITO_AUDITORIA:-mago-os-auditoria}
python3 -I - "$BASE/infisical.env" "$BASE" <<'PY'
import sys, json, urllib.request, urllib.parse, re, os, base64
env = dict(re.findall(r"^(\w+)=(.*)$", open(sys.argv[1]).read(), re.M))
pasta = sys.argv[2]
AMBIENTE = os.environ["AMBIENTE"]; DOMINIO = os.environ["DOMINIO"]
B = "https://app.infisical.com"; WS = os.environ["INFISICAL_PROJETO"]; AMB_INFISICAL = os.environ["INFISICAL_AMBIENTE"]
def j(url, data=None, h={}):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
                               headers={"Content-Type": "application/json", "User-Agent": "mago-os-vps02", **h})
    return json.load(urllib.request.urlopen(r, timeout=30))
t = j(B + "/api/v1/auth/universal-auth/login",
      {"clientId": env["INFISICAL_CLIENT_ID"].strip(), "clientSecret": env["INFISICAL_CLIENT_SECRET"].strip()})["accessToken"]
s = {x["secretKey"]: x["secretValue"].strip()
     for x in j(B + f"/api/v3/secrets/raw?workspaceId={WS}&environment={AMB_INFISICAL}&secretPath=/",
                h={"Authorization": "Bearer " + t})["secrets"]}
faltam = [k for k in ["MAGO_DB_SENHA_DONO", "MAGO_DB_SENHA_APP", "B2_KEY_ID", "B2_APPLICATION_KEY", "B2_ENDPOINT",
                      "B2_BUCKET", "B2_REGION", "PGBACKREST_CIPHER_PASS", "GHCR_LEITURA_TOKEN",
                      "MAGO_DB_SENHA_ACESSO", "MAGO_ACESSO_SEGREDO"] if not s.get(k)]
# A campainha do GitHub só existe no teste (a produção confere a versão sozinha, a cada minuto).
if AMBIENTE == "teste" and not s.get("MAGO_CAMPAINHA_SEGREDO"):
    faltam.append("MAGO_CAMPAINHA_SEGREDO")
if faltam:
    sys.exit(f"Faltam no Infisical ({AMB_INFISICAL}): " + ", ".join(faltam))
q = lambda v: urllib.parse.quote(v, safe="")
# Evolution API (M8-02, decisão 0052): só quando as três chaves dela estão no Infisical deste ambiente.
EVOLUTION = all(s.get(k) for k in ("MAGO_EVOLUTION_CHAVE", "MAGO_EVOLUTION_SEGREDO", "MAGO_DB_SENHA_EVOLUTION"))
arquivos = {
    ".env": {"POSTGRES_USER": "mago", "POSTGRES_DB": "mago", "POSTGRES_PASSWORD": s["MAGO_DB_SENHA_DONO"]},
    # Os três depósitos do pgBackRest (diário, semanal e mensal) ficam no mesmo bucket, com as mesmas chaves.
    "backup.env": {f"PGBACKREST_REPO{n}_{k}": v for n in (1, 2, 3) for k, v in {
        "S3_KEY": s["B2_KEY_ID"], "S3_KEY_SECRET": s["B2_APPLICATION_KEY"], "S3_ENDPOINT": s["B2_ENDPOINT"],
        "S3_BUCKET": s["B2_BUCKET"], "S3_REGION": s["B2_REGION"], "CIPHER_PASS": s["PGBACKREST_CIPHER_PASS"],
    }.items()},
    "api.env": {
        "AMBIENTE": AMBIENTE,
        "DATABASE_URL": f"postgres://mago_app:{q(s['MAGO_DB_SENHA_APP'])}@db:5432/mago",
        "DATABASE_URL_DONO": f"postgres://mago:{q(s['MAGO_DB_SENHA_DONO'])}@db:5432/mago",
        "MAGO_DB_SENHA_APP": s["MAGO_DB_SENHA_APP"],
        # Login (M1-03): papel mago_acesso, segredo dos cookies e o endereço público do site.
        "DATABASE_URL_ACESSO": f"postgres://mago_acesso:{q(s['MAGO_DB_SENHA_ACESSO'])}@db:5432/mago",
        "MAGO_DB_SENHA_ACESSO": s["MAGO_DB_SENHA_ACESSO"],
        "MAGO_ACESSO_SEGREDO": s["MAGO_ACESSO_SEGREDO"],
        "MAGO_URL_PUBLICA": f"https://{DOMINIO}",
        # Login com Google (M1-04), opcional: sem os dois, a API sobe só com e-mail e senha.
        # Push (M3-06), opcional: sem as duas chaves VAPID, o push fica desligado.
        **{k: s[k] for k in ("MAGO_GOOGLE_ID", "MAGO_GOOGLE_SEGREDO", "MAGO_RESEND_CHAVE", "MAGO_VAPID_PUBLICA",
                             "MAGO_VAPID_PRIVADA") if s.get(k)},
        # Cofre das contas de IA (M4-01, decisão 0021), opcional: sem a chave mestra, as contas de IA ficam desligadas.
        # Na troca da mestra, MAGO_COFRE_VERSAO sobe e a antiga vai para MAGO_COFRE_CHAVE_ANTERIOR (docs/operacao/cofre.md).
        **{k: s[k] for k in ("MAGO_COFRE_CHAVE_MESTRA", "MAGO_COFRE_VERSAO", "MAGO_COFRE_CHAVE_ANTERIOR") if s.get(k)},
        # Telegram (M5-01), opcional: sem o token e o segredo do webhook, o bot fica desligado.
        **{k: s[k] for k in ("MAGO_TELEGRAM_TOKEN", "MAGO_TELEGRAM_SEGREDO") if s.get(k)},
        **({
            "MAGO_EVOLUTION_URL": "http://evolution:8080", "MAGO_EVOLUTION_CHAVE": s["MAGO_EVOLUTION_CHAVE"],
            "MAGO_EVOLUTION_SEGREDO": s["MAGO_EVOLUTION_SEGREDO"],
            "MAGO_EVOLUTION_URL_DOS_AVISOS": "http://mago-nucleo:3000/interno/evolution/avisos",
        } if EVOLUTION else {}),
        # Rastreio e registros no Grafana Cloud (M6-02), opcionais: sem os três, nada sai do servidor.
        **({
            "OTEL_EXPORTER_OTLP_ENDPOINT": s["GRAFANA_OTLP_ENDPOINT"],
            "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Basic%20" + base64.b64encode(
                f"{s['GRAFANA_OTLP_INSTANCIA']}:{s['GRAFANA_OTLP_TOKEN']}".encode()).decode(),
            "OTEL_RESOURCE_ATTRIBUTES": f"deployment.environment={AMBIENTE}",
        } if all(s.get(k) for k in ("GRAFANA_OTLP_ENDPOINT", "GRAFANA_OTLP_INSTANCIA", "GRAFANA_OTLP_TOKEN")) else {}),
        # Anexos (M3-08), opcionais: o bucket só dos anexos no Backblaze e o ClamAV do compose (rede interna).
        **({
            "MAGO_ANEXOS_ENDPOINT": s["B2_ANEXOS_ENDPOINT"], "MAGO_ANEXOS_BUCKET": s["B2_ANEXOS_BUCKET"],
            "MAGO_ANEXOS_CHAVE_ID": s["B2_ANEXOS_KEY_ID"], "MAGO_ANEXOS_CHAVE_SEGREDO": s["B2_ANEXOS_APPLICATION_KEY"],
            "MAGO_CLAMAV": "clamav:3310",
        } if all(s.get(k) for k in ("B2_ANEXOS_ENDPOINT", "B2_ANEXOS_BUCKET", "B2_ANEXOS_KEY_ID",
                                     "B2_ANEXOS_APPLICATION_KEY")) else {}),
    },
    "campainha.env": {"MAGO_CAMPAINHA_SEGREDO": s["MAGO_CAMPAINHA_SEGREDO"]} if s.get("MAGO_CAMPAINHA_SEGREDO") else {},
    # Cópia travada da auditoria (M1-09), opcional até o depósito existir. Mesma região do backup.
    "auditoria.env": {
        "AUDITORIA_CHAVE": s["B2_AUDITORIA_KEY_ID"], "AUDITORIA_SEGREDO": s["B2_AUDITORIA_APPLICATION_KEY"],
        "AUDITORIA_ENDPOINT": s["B2_ENDPOINT"].replace("https://", ""), "AUDITORIA_REGIAO": s["B2_REGION"],
        "AUDITORIA_DEPOSITO": os.environ["DEPOSITO_AUDITORIA"],
    } if s.get("B2_AUDITORIA_KEY_ID") and s.get("B2_AUDITORIA_APPLICATION_KEY") else {},
    # Opcionais: sem eles, o avisar.sh só registra no log.
    "avisos.env": {k: v for k, v in s.items() if k.startswith("MAGO_AVISO_")},
    # Os nomes das variáveis são os da Evolution 2.3 (conferir no .env.example dela ao trocar de versão). Ela não
    # guarda as mensagens no banco dela: o Mago OS guarda as que importam (M8-01).
    "evolution.env": {
        "SERVER_TYPE": "http", "SERVER_PORT": "8080", "SERVER_URL": "http://evolution:8080",
        "AUTHENTICATION_API_KEY": s["MAGO_EVOLUTION_CHAVE"],
        "DATABASE_ENABLED": "true", "DATABASE_PROVIDER": "postgresql",
        "DATABASE_CONNECTION_URI":
            f"postgresql://evolution:{q(s['MAGO_DB_SENHA_EVOLUTION'])}@db:5432/evolution?schema=evolution_api",
        "DATABASE_CONNECTION_CLIENT_NAME": f"mago_os_{AMBIENTE}",
        "DATABASE_SAVE_DATA_INSTANCE": "true", "DATABASE_SAVE_DATA_NEW_MESSAGE": "false",
        "DATABASE_SAVE_MESSAGE_UPDATE": "false", "DATABASE_SAVE_DATA_CONTACTS": "false",
        "DATABASE_SAVE_DATA_CHATS": "false", "DATABASE_SAVE_DATA_LABELS": "false",
        "DATABASE_SAVE_DATA_HISTORIC": "false",
        "CACHE_REDIS_ENABLED": "false", "CACHE_LOCAL_ENABLED": "true",
        "TELEMETRY_ENABLED": "false", "WEBHOOK_GLOBAL_ENABLED": "false",
        "CONFIG_SESSION_PHONE_CLIENT": "Mago OS", "CONFIG_SESSION_PHONE_NAME": "Chrome",
        "QRCODE_LIMIT": "30", "DEL_INSTANCE": "false", "LANGUAGE": "pt-BR",
        "LOG_LEVEL": "ERROR,WARN", "LOG_BAILEYS": "error",
    } if EVOLUTION else {},
}
os.umask(0o077)
for nome, valores in arquivos.items():
    destino = os.path.join(pasta, nome); tmp = destino + ".tmp"
    with open(tmp, "w") as f:
        f.write("".join(f"{k}={v}\n" for k, v in valores.items()))
    os.replace(tmp, destino)
    print(f"{nome}: {len(valores)} variáveis")
import subprocess
# Cada ambiente guarda o próprio acesso ao ghcr.io (o publicar.sh usa o mesmo DOCKER_CONFIG).
r = subprocess.run(["docker", "login", "ghcr.io", "-u", "mago-os-vps02", "--password-stdin"],
                   input=s["GHCR_LEITURA_TOKEN"], text=True, capture_output=True,
                   env={**os.environ, "DOCKER_CONFIG": os.path.join(pasta, ".docker")})
print("ghcr.io: " + ("acesso de leitura ok" if r.returncode == 0 else "FALHOU: " + r.stderr.strip()[:200]))
PY
