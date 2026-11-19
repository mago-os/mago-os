import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { PedidoDeVisaoSalva } from "./visoes.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("visão salva", () => {
  it("guarda tipo, filtros e agrupamento, e recusa filtro desconhecido", () => {
    const visao = {
      nome: "Atrasadas do Mago OS",
      tipo: "lista",
      filtro: { projetoId: ID, prazo: "atrasadas", prioridades: ["urgente", "sem"] },
      agruparPor: "responsavel",
    };
    expect(conferir(PedidoDeVisaoSalva, visao).ok).toBe(true);
    expect(conferir(PedidoDeVisaoSalva, { ...visao, tipo: "gantt" }).ok).toBe(false);
    expect(conferir(PedidoDeVisaoSalva, { ...visao, filtro: { prazo: "ontem" } }).ok).toBe(false);
    expect(conferir(PedidoDeVisaoSalva, { ...visao, filtro: { cor: "azul" } }).ok).toBe(false);
  });
});
