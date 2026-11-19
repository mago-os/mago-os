/**
 * Descrição das ferramentas congelada (regra 14 da segurança dos agentes): este teste guarda a impressão digital de
 * cada ferramenta. Mudou nome, descrição, entrada ou saída? O teste quebra, e a assinatura nova só entra no PR de
 * propósito, com revisão humana.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FERRAMENTAS_MCP } from "./ferramentas.ts";

const ASSINATURAS: Record<string, string> = {
  minhas_tarefas: "5e5a31bc6b2948b2",
  ver_tarefa: "bd490f336a31f79b",
  pegar_tarefa: "fd843de2f57f7971",
  soltar_tarefa: "3d09aec94d496be7",
  comentar: "663b025cd6519fe2",
  mudar_status: "689b1eb322039855",
  entregar_resultado: "45d164761d61be4e",
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
