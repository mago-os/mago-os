/**
 * Ponte da API pública (M7-02, decisão 0047): cada endereço /v1 é atendido pela mesma rota da tela (pessoa da chave)
 * ou pelo mesmo servidor MCP (chave de agente), por um pedido interno (app.inject), para valer a mesma conferência de
 * permissão, o mesmo alcance e a mesma auditoria.
 *
 * O pedido interno leva um bilhete de uso único, que só existe na memória deste processo enquanto o pedido roda (o
 * pedido interno nunca sai do processo, então nada de estado fica entre pedidos). Um bilhete de fora, inventado ou
 * repetido, não vale nada.
 */
import { randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";

export const CABECALHO_DA_PONTE = "x-mago-ponte-da-api";

export interface IdentidadeDaPonte {
  /** "pessoa": a chave de API age em nome desta pessoa; "agente": a chave do agente vai ao MCP pelo canal API. */
  tipo: "pessoa" | "agente";
  empresaId: string;
  pessoaId: string | null;
  chaveId: string;
}

const bilhetes = new Map<string, IdentidadeDaPonte>();

/** Roda o trabalho com um bilhete válido para a identidade, e apaga o bilhete no fim. */
export async function comBilhete<T>(
  identidade: IdentidadeDaPonte,
  trabalho: (bilhete: string) => Promise<T>,
): Promise<T> {
  const bilhete = randomBytes(32).toString("base64url");
  bilhetes.set(bilhete, identidade);
  try {
    return await trabalho(bilhete);
  } finally {
    bilhetes.delete(bilhete);
  }
}

/** A identidade do pedido interno, ou nula (pedido comum, ou bilhete que não existe). */
export function identidadeDaPonte(pedido: Pick<FastifyRequest, "headers">): IdentidadeDaPonte | null {
  const valor = pedido.headers[CABECALHO_DA_PONTE];
  if (typeof valor !== "string" || valor.length !== 43) return null;
  return bilhetes.get(valor) ?? null;
}
