import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { PedidoDeBusca, TIPOS_DE_RESULTADO } from "./busca.ts";

describe("busca", () => {
  it("pede de 2 a 100 caracteres e só tipos conhecidos", () => {
    expect(conferir(PedidoDeBusca, { texto: "bakup" }).ok).toBe(true);
    expect(conferir(PedidoDeBusca, { texto: "b" }).ok).toBe(false);
    expect(conferir(PedidoDeBusca, { texto: "x".repeat(101) }).ok).toBe(false);
    expect(conferir(PedidoDeBusca, { texto: "backup", tipos: ["tarefa", "projeto"] }).ok).toBe(true);
    expect(conferir(PedidoDeBusca, { texto: "backup", tipos: ["arquivo"] }).ok).toBe(false);
  });

  it("os grupos aparecem nesta ordem", () => {
    expect(TIPOS_DE_RESULTADO).toEqual(["tarefa", "comentario", "projeto", "espaco", "pessoa", "agente"]);
  });
});
