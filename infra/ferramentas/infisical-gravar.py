#!/usr/bin/env python3
"""Grava um segredo no Infisical (projeto mago-os) lendo o valor da entrada padrão, sem mostrar na tela.

Uso:
  openssl rand -base64 32 | python3 -I infra/ferramentas/infisical-gravar.py staging MAGO_DB_SENHA_APP
  python3 -I infra/ferramentas/infisical-gravar.py staging NOME --se-nao-existir < arquivo

Credenciais: identidade "claude-mac" (papel Member no projeto), lidas do arquivo
~/Credenciais/Nolask/Clientes/MagoOS/infisical-mago-os-claude.env (ou da variável INFISICAL_CREDENCIAIS).
Ambientes: dev (local), staging (teste), prod (produção).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

B = "https://app.infisical.com"
WS = "7e951d3d-b27b-4e98-96ff-30ddbeef7bf2"


def chamar(metodo, caminho, dados=None, token=None):
    cab = {"Content-Type": "application/json", "User-Agent": "mago-os-mac"}
    if token:
        cab["Authorization"] = "Bearer " + token
    req = urllib.request.Request(B + caminho, method=metodo, headers=cab,
                                 data=json.dumps(dados).encode() if dados is not None else None)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    se_nao_existir = "--se-nao-existir" in sys.argv
    if len(args) != 2 or args[0] not in ("dev", "staging", "prod"):
        sys.exit(__doc__)
    ambiente, chave = args
    valor = sys.stdin.read().strip()
    if not valor:
        sys.exit("Valor vazio na entrada: nada gravado.")
    arquivo = os.environ.get("INFISICAL_CREDENCIAIS",
                             os.path.expanduser("~/Credenciais/Nolask/Clientes/MagoOS/infisical-mago-os-claude.env"))
    cred = dict(re.findall(r"^(\w+)=(.*)$", open(arquivo).read(), re.M))
    token = chamar("POST", "/api/v1/auth/universal-auth/login",
                   {"clientId": cred["INFISICAL_CLIENT_ID"].strip(),
                    "clientSecret": cred["INFISICAL_CLIENT_SECRET"].strip()})["accessToken"]
    existentes = {s["secretKey"] for s in chamar(
        "GET", f"/api/v3/secrets/raw?workspaceId={WS}&environment={ambiente}&secretPath=/", token=token)["secrets"]}
    corpo = {"workspaceId": WS, "environment": ambiente, "secretPath": "/", "secretValue": valor, "type": "shared"}
    if chave in existentes:
        if se_nao_existir:
            print(f"{chave} já existe em {ambiente}: mantido como estava.")
            return
        chamar("PATCH", f"/api/v3/secrets/raw/{chave}", corpo, token)
        print(f"{chave} atualizado em {ambiente}.")
    else:
        chamar("POST", f"/api/v3/secrets/raw/{chave}", corpo, token)
        print(f"{chave} criado em {ambiente}.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit(f"O Infisical recusou ({e.code}): {e.read().decode(errors='replace')[:300]}")
