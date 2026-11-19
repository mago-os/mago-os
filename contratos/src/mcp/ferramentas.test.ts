/**
 * Descrição das ferramentas congelada (regra 14 da segurança dos agentes): este teste guarda a impressão digital de
 * cada ferramenta. Mudou nome, descrição, entrada ou saída? O teste quebra, e a assinatura nova só entra no PR de
 * propósito, com revisão humana.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FERRAMENTAS_MCP } from "./ferramentas.ts";

const ASSINATURAS: Record<string, string> = {
  minhas_tarefas: "c9dafce94765c5f0",
  ver_tarefa: "f827af0033c730a0",
  pegar_tarefa: "8ee59089d33aac33",
  soltar_tarefa: "a0bd420257bad3f8",
  comentar: "663b025cd6519fe2",
  mudar_status: "3601ae303b14e24b",
  entregar_resultado: "7bac4a34ff72f065",
  criar_subtarefa: "fc2815ce6e6f73a0",
  marcar_checklist: "34c74f6ba4126e63",
  estou_vivo: "e1ad16ca48cd4c7a",
};

function assinatura(f: (typeof FERRAMENTAS_MCP)[number]): string {
  const texto = JSON.stringify({ nome: f.nome, descricao: f.descricao, entrada: f.entrada, saida: f.saida });
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

describe("ferramentas do MCP", () => {
  it("são as dez da spec (oito do M2 e duas da M3-02), com nomes únicos e descrição", () => {
    expect(FERRAMENTAS_MCP.map((f) => f.nome)).toEqual([
      "minhas_tarefas",
      "ver_tarefa",
      "pegar_tarefa",
      "soltar_tarefa",
      "comentar",
      "mudar_status",
      "entregar_resultado",
      "criar_subtarefa",
      "marcar_checklist",
      "estou_vivo",
    ]);
    for (const f of FERRAMENTAS_MCP) expect(f.descricao.length).toBeGreaterThan(20);
  });

  it("descrições congeladas: a assinatura de cada ferramenta não mudou", () => {
    const atuais = Object.fromEntries(FERRAMENTAS_MCP.map((f) => [f.nome, assinatura(f)]));
    expect(atuais).toEqual(ASSINATURAS);
  });
});
