/**
 * Descrição das ferramentas congelada (regra 14 da segurança dos agentes): este teste guarda a impressão digital de
 * cada ferramenta. Mudou nome, descrição, entrada ou saída? O teste quebra, e a assinatura nova só entra no PR de
 * propósito, com revisão humana.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FERRAMENTAS_MCP } from "./ferramentas.ts";

const ASSINATURAS: Record<string, string> = {
  minhas_tarefas: "6efe7b459b843e3d",
  ver_tarefa: "67594070b14aed9b",
  pegar_tarefa: "71a249660a993115",
  soltar_tarefa: "480ec264ab6227fd",
  comentar: "1df5a94d7000fc2f",
  mudar_status: "c7f9a5638a61c58f",
  entregar_resultado: "f29c89924dccdbe2",
  criar_subtarefa: "c421a7c07d989e15",
  marcar_checklist: "34c74f6ba4126e63",
  baixar_anexo: "341caa9771ef5b13",
  estou_vivo: "e1ad16ca48cd4c7a",
};

function assinatura(f: (typeof FERRAMENTAS_MCP)[number]): string {
  const texto = JSON.stringify({ nome: f.nome, descricao: f.descricao, entrada: f.entrada, saida: f.saida });
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

describe("ferramentas do MCP", () => {
  it("são as onze da spec (oito do M2, duas da M3-02 e uma da M3-08), com nomes únicos e descrição", () => {
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
      "baixar_anexo",
      "estou_vivo",
    ]);
    for (const f of FERRAMENTAS_MCP) expect(f.descricao.length).toBeGreaterThan(20);
  });

  it("descrições congeladas: a assinatura de cada ferramenta não mudou", () => {
    const atuais = Object.fromEntries(FERRAMENTAS_MCP.map((f) => [f.nome, assinatura(f)]));
    expect(atuais).toEqual(ASSINATURAS);
  });
});
