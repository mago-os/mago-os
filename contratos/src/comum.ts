/**
 * Peças comuns a todos os contratos: identificador, data e hora, e-mail e a conferência dos dados.
 *
 * Cada contrato é um esquema TypeBox: o mesmo objeto confere os dados (conferir) e vira a descrição
 * em JSON Schema que o Fastify usa nas rotas e a documentação da API e do MCP (M2-05).
 */
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

/** Identificador de qualquer registro: UUID (o banco gera v7, em ordem de criação). */
export const Id = Type.String({ format: "uuid", description: "Identificador (UUID)." });

/** Data e hora no formato ISO 8601, sempre com fuso (ex.: 2026-11-17T00:30:00Z). */
export const DataHora = Type.String({ format: "date-time", description: "Data e hora ISO 8601 com fuso." });

/** E-mail sempre em letras minúsculas e sem espaços nas pontas (use normalizarEmail antes de conferir). */
export const Email = Type.String({
  format: "email",
  maxLength: 254,
  pattern: "^[^A-Z\\s]+$",
  description: "E-mail em minúsculas. Um e-mail é uma pessoa só no sistema inteiro.",
});

/** Número de rastreio do pedido: o trace id do OpenTelemetry (decisão 0003). */
export const Rastreio = Type.String({
  pattern: "^[0-9a-f]{32}$",
  description: "Número de rastreio do pedido (32 caracteres hexadecimais).",
});

/** Endereço IP (v4 ou v6). */
export const Ip = Type.Union([Type.String({ format: "ipv4" }), Type.String({ format: "ipv6" })], {
  description: "Endereço IP, v4 ou v6.",
});

/** Texto obrigatório com tamanho limitado e sem ficar só com espaços. */
export function Texto(maximo: number, descricao: string) {
  return Type.String({ minLength: 1, maxLength: maximo, pattern: "\\S", description: descricao });
}

/** Aceita um valor ou nulo. */
export function OuNulo<T extends TSchema>(esquema: T) {
  return Type.Union([esquema, Type.Null()]);
}

/** Deixa o e-mail no formato do contrato: sem espaços nas pontas e em minúsculas. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Um problema encontrado nos dados: onde (caminho no objeto, ex. "/email") e o quê. */
export interface Problema {
  caminho: string;
  mensagem: string;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; problemas: Problema[] };

/** Regra extra que o JSON Schema sozinho não expressa (ex.: "gestor de área precisa de uma área"). */
export type Regra<T> = (valor: T) => Problema[];

/**
 * Confere um valor contra o contrato: primeiro o formato, depois as regras extras.
 * Devolve todos os problemas de uma vez, para quem chamou corrigir tudo junto.
 */
export function conferir<E extends TSchema>(
  esquema: E,
  valor: unknown,
  regras: Regra<Static<E>>[] = [],
): Resultado<Static<E>> {
  if (!Value.Check(esquema, valor)) {
    const problemas = [...Value.Errors(esquema, valor)].map((erro) => ({
      caminho: erro.instancePath || "/",
      mensagem: erro.message,
    }));
    return { ok: false, problemas };
  }
  const tipado = valor as Static<E>;
  const problemas = regras.flatMap((regra) => regra(tipado));
  return problemas.length > 0 ? { ok: false, problemas } : { ok: true, valor: tipado };
}
