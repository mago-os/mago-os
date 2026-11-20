import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { PedidoDeLayout } from "./layouts.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("layouts de tela", () => {
  it("guarda os painéis e a divisão do computador; recusa painel desconhecido e layout vazio", () => {
    const layout = {
      nome: "Meu dia",
      aparelho: "computador",
      estrutura: {
        paineis: [
          { id: "p1", tipo: "tarefas", projetoId: ID },
          { id: "p2", tipo: "prioridades" },
        ],
        divisao: { grid: { root: {} } },
      },
    };
    expect(conferir(PedidoDeLayout, layout).ok).toBe(true);
    expect(conferir(PedidoDeLayout, { ...layout, aparelho: "tablet" }).ok).toBe(false);
    expect(
      conferir(PedidoDeLayout, { ...layout, estrutura: { paineis: [{ id: "p", tipo: "financeiro" }] } }).ok,
    ).toBe(false);
    expect(conferir(PedidoDeLayout, { ...layout, estrutura: { paineis: [] } }).ok).toBe(false);
  });
});
