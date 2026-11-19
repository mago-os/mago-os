/**
 * Descrição das ferramentas congelada (regra 14 da segurança dos agentes): este teste guarda a impressão digital de
 * cada ferramenta. Mudou nome, descrição, entrada ou saída? O teste quebra, e a assinatura nova só entra no PR de
 * propósito, com revisão humana.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FERRAMENTAS_MCP } from "./ferramentas.ts";

const ASSINATURAS: Record<string, string> = {
  minhas_tarefas: "acfab5ba90a56aa8",
  ver_tarefa: "a65cf49f03595762",
  pegar_tarefa: "1508780b7b017627",
  soltar_tarefa: "44fb284936d8af92",
  comentar: "663b025cd6519fe2",
  mudar_status: "c2e78b923c654646",
  entregar_resultado: "1f7636f91f8f0abf",
  estou_vivo: "e1ad16ca48cd4c7a",
};

function assinatura(f: (typeof FERRAMENTAS_MCP)[number]): string {
  const texto = JSON.stringify({ nome: f.nome, descricao: f.descricao, entrada: f.entrada, saida: f.saida });
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

describe("ferramentas do MCP", () => {
  it("são as oito da spec, com nomes únicos e descrição", () => {
    expect(FERRAMENTAS_MCP.map((f) => f.nome)).toEqual([
      "minhas_tarefas",
      "ver_tarefa",
      "pegar_tarefa",
      "soltar_tarefa",
      "comentar",
      "mudar_status",
      "entregar_resultado",
      "estou_vivo",
    ]);
    for (const f of FERRAMENTAS_MCP) expect(f.descricao.length).toBeGreaterThan(20);
  });

  it("descrições congeladas: a assinatura de cada ferramenta não mudou", () => {
    const atuais = Object.fromEntries(FERRAMENTAS_MCP.map((f) => [f.nome, assinatura(f)]));
    expect(atuais).toEqual(ASSINATURAS);
  });
});
