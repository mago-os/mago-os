/**
 * Contratos do Mago OS.
 *
 * Um módulo só conversa com outro por aqui, nunca importando o código do outro.
 * Os primeiros contratos chegam no M1-01 (identidade).
 */

/** Versão do formato dos contratos. Sobe quando um contrato muda de forma incompatível. */
export const VERSAO_CONTRATOS = 1 as const;
