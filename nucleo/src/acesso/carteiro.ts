/**
 * Carteiro provisório: enquanto o Resend não entra (tarefa própria), o link de senha vai para o log da API.
 * Só serve no Mac e no teste, onde quem lê o log é o Sandro. Na produção, recusa: lá só com o Resend.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Carteiro } from "./login.ts";

export function carteiroDoLog(log: FastifyBaseLogger, ambiente: "local" | "teste" | "producao"): Carteiro {
  return {
    async enviarLinkDeSenha({ para, link }) {
      if (ambiente === "producao") {
        throw new Error("Sem provedor de e-mail na produção: o link de senha não pode ir para o log");
      }
      log.warn(
        { evento: "senha.pediu_recuperacao", para, link },
        "Link de senha (sem e-mail ainda: ver o log)",
      );
    },
  };
}
