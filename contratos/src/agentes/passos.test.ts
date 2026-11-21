import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { CARACTERES_POR_PASSO, DIAS_DOS_PASSOS, PassoDaExecucao } from "./passos.ts";

describe("passo a passo (M4-07)", () => {
  it("90 dias e o limite de cada passo", () => {
    expect(DIAS_DOS_PASSOS).toBe(90);
    expect(CARACTERES_POR_PASSO).toBe(20_000);
  });

  it("um passo de ferramenta com erro e um de modelo com custo", () => {
    const base = {
      id: "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      numero: 1,
      criadoEm: "2026-11-21T00:00:00Z",
      duracaoMs: 120,
      cortado: false,
      aprovacaoId: null,
    };
    expect(
      conferir(PassoDaExecucao, {
        ...base,
        tipo: "ferramenta",
        modelo: null,
        texto: null,
        ferramenta: "mudar_prazo",
        entrada: { tarefaId: base.id },
        resultado: "Tarefa não encontrada.",
        erro: true,
        tokens: null,
        custo: null,
      }).ok,
    ).toBe(true);
    expect(
      conferir(PassoDaExecucao, {
        ...base,
        tipo: "modelo",
        modelo: "claude-sonnet-5-5",
        texto: "Vou criar a tarefa.",
        ferramenta: "criar_tarefa",
        entrada: null,
        resultado: null,
        erro: false,
        tokens: { entrada: 10, saida: 5, cache: 0 },
        custo: 105,
      }).ok,
    ).toBe(true);
  });
});
