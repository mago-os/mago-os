import { describe, expect, it } from "vitest";
import { custoEmMicros, PRECO_SEM_REFERENCIA, PRECOS_DE_REFERENCIA, precoDeReferencia } from "./custos.ts";

describe("custos (M4-06)", () => {
  it("acha o preço pelo começo do nome, também com o prefixo do provedor", () => {
    expect(precoDeReferencia("claude-sonnet-5-5")).toEqual({ entrada: 300, saida: 1500, cache: 30 });
    expect(precoDeReferencia("anthropic/claude-haiku-5-5")?.entrada).toBe(100);
    expect(precoDeReferencia("gpt-5-mini")?.entrada).toBe(25);
    expect(precoDeReferencia("modelo-novo-x")).toBeNull();
  });

  it("calcula em microdólares e arredonda para cima", () => {
    // 1 milhão de tokens de entrada a US$ 3,00 = 3 milhões de microdólares.
    expect(
      custoEmMicros({ entrada: 1_000_000, saida: 0, cache: 0 }, { entrada: 300, saida: 0, cache: 0 }),
    ).toBe(3_000_000);
    expect(custoEmMicros({ entrada: 1, saida: 1, cache: 1 }, { entrada: 300, saida: 1500, cache: 30 })).toBe(
      19,
    );
    expect(custoEmMicros({ entrada: 0, saida: 0, cache: 0 }, PRECO_SEM_REFERENCIA)).toBe(0);
  });

  it("o preço sem referência é o maior da tabela (o teto continua protegendo)", () => {
    for (const p of PRECOS_DE_REFERENCIA) {
      expect(PRECO_SEM_REFERENCIA.entrada).toBeGreaterThanOrEqual(p.preco.entrada);
      expect(PRECO_SEM_REFERENCIA.saida).toBeGreaterThanOrEqual(p.preco.saida);
    }
  });
});
