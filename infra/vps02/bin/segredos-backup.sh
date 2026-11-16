#!/usr/bin/env bash
# Busca no Infisical (projeto mago-os, ambiente staging) os segredos do backup e grava /opt/mago-os/backup.env (só root lê).
set -euo pipefail
python3 -I - /opt/mago-os/infisical.env /opt/mago-os/backup.env <<'PY'
import sys,json,urllib.request,re,os
env=dict(re.findall(r"^(\w+)=(.*)$",open(sys.argv[1]).read(),re.M))
B="https://app.infisical.com"; WS="7e951d3d-b27b-4e98-96ff-30ddbeef7bf2"
def j(url,data=None,h={}):
  r=urllib.request.Request(url,data=json.dumps(data).encode() if data else None,headers={"Content-Type":"application/json","User-Agent":"mago-os-vps02",**h})
  return json.load(urllib.request.urlopen(r,timeout=30))
t=j(B+"/api/v1/auth/universal-auth/login",{"clientId":env["INFISICAL_CLIENT_ID"].strip(),"clientSecret":env["INFISICAL_CLIENT_SECRET"].strip()})["accessToken"]
s={x["secretKey"]:x["secretValue"].strip() for x in j(B+f"/api/v3/secrets/raw?workspaceId={WS}&environment=staging&secretPath=/",h={"Authorization":"Bearer "+t})["secrets"]}
out={"PGBACKREST_REPO1_S3_KEY":s["B2_KEY_ID"],"PGBACKREST_REPO1_S3_KEY_SECRET":s["B2_APPLICATION_KEY"],"PGBACKREST_REPO1_S3_ENDPOINT":s["B2_ENDPOINT"],"PGBACKREST_REPO1_S3_BUCKET":s["B2_BUCKET"],"PGBACKREST_REPO1_S3_REGION":s["B2_REGION"],"PGBACKREST_REPO1_CIPHER_PASS":s["PGBACKREST_CIPHER_PASS"]}
os.umask(0o077); tmp=sys.argv[2]+".tmp"
open(tmp,"w").write("".join(f"{k}={v}\n" for k,v in out.items())); os.replace(tmp,sys.argv[2])
print("backup.env atualizado com",len(out),"variaveis")
PY
