#!/usr/bin/env python3
"""Campainha da publicação (M0-10).

O GitHub, ao montar uma versão nova, faz POST em https://teste.osmago.com/_campainha com o corpo assinado:
  X-Mago-Momento: segundos desde 1970
  X-Mago-Assinatura: sha256=<HMAC-SHA256 de "<momento>.<corpo>" com MAGO_CAMPAINHA_SEGREDO>
Se a assinatura confere e o momento tem menos de 5 minutos, a campainha só toca: grava um arquivo que faz o
systemd rodar o publicar.sh. Ela não recebe código nem comandos, e quem toca não ganha acesso a nada.
Roda como usuário sem privilégios (DynamicUser), escutando só em 127.0.0.1:3190, atrás do Caddy.
"""
import hashlib
import hmac
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SEGREDO = os.environ["MAGO_CAMPAINHA_SEGREDO"].encode()
ARQUIVO = os.path.join(os.environ.get("RUNTIME_DIRECTORY", "/run/mago-os-campainha"), "tocou")
JANELA = 300
_ultima = 0.0


class Campainha(BaseHTTPRequestHandler):
    server_version = "campainha"
    sys_version = ""

    def _responder(self, codigo, texto):
        corpo = (texto + "\n").encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_POST(self):
        global _ultima
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho > 4096:
            return self._responder(413, "grande demais")
        corpo = self.rfile.read(tamanho)
        momento = self.headers.get("X-Mago-Momento", "")
        assinatura = self.headers.get("X-Mago-Assinatura", "")
        if not momento.isdigit() or abs(time.time() - int(momento)) > JANELA:
            return self._responder(401, "momento inválido")
        esperada = "sha256=" + hmac.new(SEGREDO, momento.encode() + b"." + corpo, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(esperada, assinatura):
            return self._responder(401, "assinatura inválida")
        agora = time.time()
        if agora - _ultima < 5:
            return self._responder(202, "já tocou")
        _ultima = agora
        with open(ARQUIVO, "w") as f:
            f.write(str(int(agora)))
        self._responder(202, "tocou")

    def do_GET(self):
        self._responder(405, "use POST")

    def log_message(self, formato, *args):
        print("campainha:", formato % args, flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 3190), Campainha).serve_forever()
