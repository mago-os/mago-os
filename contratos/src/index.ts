/**
 * Contratos do Mago OS.
 *
 * Um módulo só conversa com outro por aqui, nunca importando o código do outro.
 * Cada contrato é um esquema TypeBox (decisão 0008): confere os dados e vira JSON Schema para a API e o MCP.
 */

/** Versão do formato dos contratos. Sobe quando um contrato muda de forma incompatível. */
export const VERSAO_CONTRATOS = 1 as const;

export * from "./auditoria.ts";
export * from "./comum.ts";
export * from "./identidade/documento.ts";
export * from "./identidade/empresa.ts";
export * from "./identidade/pessoa.ts";
export * from "./identidade/plataforma.ts";
export * from "./identidade/sessao.ts";
export * from "./identidade/vinculo.ts";
export * from "./permissoes.ts";
