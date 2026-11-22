/**
 * Contratos do Mago OS.
 *
 * Um módulo só conversa com outro por aqui, nunca importando o código do outro.
 * Cada contrato é um esquema TypeBox (decisão 0008): confere os dados e vira JSON Schema para a API e o MCP.
 */

/** Versão do formato dos contratos. Sobe quando um contrato muda de forma incompatível. */
export const VERSAO_CONTRATOS = 1 as const;

export * from "./agentes/agente.ts";
export * from "./agentes/chave.ts";
export * from "./agentes/contas-de-ia.ts";
export * from "./agentes/custos.ts";
export * from "./agentes/instrucoes.ts";
export * from "./agentes/internos.ts";
export * from "./agentes/limites.ts";
export * from "./agentes/parada.ts";
export * from "./agentes/passos.ts";
export * from "./agentes/regras.ts";
export * from "./auditoria.ts";
export * from "./canais/telegram.ts";
export * from "./avisos/notificacoes.ts";
export * from "./busca/busca.ts";
export * from "./comum.ts";
export * from "./identidade/documento.ts";
export * from "./identidade/empresa.ts";
export * from "./identidade/pessoa.ts";
export * from "./identidade/plataforma.ts";
export * from "./identidade/sessao.ts";
export * from "./identidade/vinculo.ts";
export * from "./mcp/ferramentas.ts";
export * from "./permissoes.ts";
export * from "./projetos/lista.ts";
export * from "./projetos/projeto.ts";
export * from "./tarefas/anexos.ts";
export * from "./tarefas/checklist.ts";
export * from "./tarefas/prazos.ts";
export * from "./tarefas/prioridades.ts";
export * from "./tarefas/tarefa.ts";
export * from "./tarefas/visoes.ts";
export * from "./telas/layouts.ts";
