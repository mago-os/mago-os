#!/usr/bin/env python3
"""Escreve na saída padrão o valor de um segredo do Infisical (projeto mago-os), para passar adiante por pipe.

Uso: python3 -I infra/ferramentas/infisical-ler.py staging NOME | gh secret set NOME --repo mago-os/mago-os
Recusa escrever direto na tela. Credenciais: as mesmas do infisical-gravar.py.
"""
import json
import os
import re
import sys
import urllib.request

B = "https://app.infisical.com"
WS = "7e951d3d-b27b-4e98-96ff-30ddbeef7bf2"

if len(sys.argv) != 3 or sys.argv[1] not in ("dev", "staging", "prod"):
    sys.exit(__doc__)
if sys.stdout.isatty():
    sys.exit("Recusado: a saída é a tela. Use um pipe.")
ambiente, chave = sys.argv[1:]
arquivo = os.environ.get("INFISICAL_CREDENCIAIS",
                         os.path.expanduser("~/Credenciais/Nolask/Clientes/MagoOS/infisical-mago-os-claude.env"))
cred = dict(re.findall(r"^(\w+)=(.*)$", open(arquivo).read(), re.M))


def chamar(caminho, dados=None, token=None):
    cab = {"Content-Type": "application/json", "User-Agent": "mago-os-mac"}
    if token:
        cab["Authorization"] = "Bearer " + token
    req = urllib.request.Request(B + caminho, headers=cab, data=json.dumps(dados).encode() if dados else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


token = chamar("/api/v1/auth/universal-auth/login", {"clientId": cred["INFISICAL_CLIENT_ID"].strip(),
                                                     "clientSecret": cred["INFISICAL_CLIENT_SECRET"].strip()})["accessToken"]
segredo = chamar(f"/api/v3/secrets/raw/{chave}?workspaceId={WS}&environment={ambiente}&secretPath=/", token=token)
sys.stdout.write(segredo["secret"]["secretValue"])
