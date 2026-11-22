import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import {
  LIMITE_PADRAO_DE_MINUTOS,
  LIMITE_PADRAO_DE_RODADAS,
  PASSADAS_PARA_PARAR,
  PedidoDeLimites,
  REPETICOES_PARA_PARAR,
} from "./limites.ts";

describe("limites (M4-08)", () => {
  it("padrões da spec", () => {
    expect([LIMITE_PADRAO_DE_RODADAS, LIMITE_PADRAO_DE_MINUTOS]).toEqual([30, 10]);
    expect([REPETICOES_PARA_PARAR, PASSADAS_PARA_PARAR]).toEqual([3, 3]);
  });

  it("ajuste dentro dos máximos; null volta ao padrão", () => {
    expect(conferir(PedidoDeLimites, { rodadas: 50, minutos: 20 }).ok).toBe(true);
    expect(conferir(PedidoDeLimites, { rodadas: null, minutos: null }).ok).toBe(true);
    expect(conferir(PedidoDeLimites, { rodadas: 500, minutos: 20 }).ok).toBe(false);
    expect(conferir(PedidoDeLimites, { rodadas: 10, minutos: 0 }).ok).toBe(false);
  });
});
