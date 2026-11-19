#!/bin/sh
# Cabeçalho do MCP do Mago OS para o Claude Code do Mac (M2-08), usado como "headersHelper": lê a chave do agente
# "Claude no Mac" no Keychain na hora e devolve o cabeçalho Authorization em JSON. A chave não fica em arquivo nenhum.
# Guardar a chave antes: security add-generic-password -a mago-os -s mago-os-claude-no-mac -w
set -eu
chave=$(security find-generic-password -a mago-os -s mago-os-claude-no-mac -w 2>/dev/null) || {
  echo "Chave do Mago OS não encontrada no Keychain (mago-os-claude-no-mac)." >&2
  exit 1
}
case "$chave" in
  mago_ag_*) ;;
  *) echo "A chave no Keychain não tem o formato mago_ag_..." >&2; exit 1 ;;
esac
printf '{"Authorization":"Bearer %s"}\n' "$chave"
