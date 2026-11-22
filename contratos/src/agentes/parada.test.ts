import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { PedidoDeParada, PedidoDeRetomada } from "./parada.ts";

describe("parar todos os agentes (M4-09)", () => {
  it("parar pede o motivo", () => {
    expect(conferir(PedidoDeParada, { motivo: "Agente mandando coisa errada" }).ok).toBe(true);
    expect(conferir(PedidoDeParada, { motivo: "   " }).ok).toBe(false);
    expect(conferir(PedidoDeParada, {}).ok).toBe(false);
    expect(conferir(PedidoDeParada, { motivo: "x".repeat(501) }).ok).toBe(false);
  });

  it("retomar todos (nulo) ou alguns", () => {
    expect(conferir(PedidoDeRetomada, { agenteIds: null }).ok).toBe(true);
    expect(conferir(PedidoDeRetomada, { agenteIds: ["0b7c2a52-3f1e-4c55-9d0a-2f6e1b9a7c10"] }).ok).toBe(true);
    expect(conferir(PedidoDeRetomada, { agenteIds: [] }).ok).toBe(false);
    expect(conferir(PedidoDeRetomada, { agenteIds: ["nao-e-id"] }).ok).toBe(false);
  });
});
