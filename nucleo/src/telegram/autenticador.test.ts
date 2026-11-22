import { describe, expect, it } from "vitest";
import { codigoDoPasso, passoDoCodigo } from "./autenticador.ts";

// Vetores do RFC 6238 (SHA-1, segredo "12345678901234567890"), com 6 dígitos.
const SEGREDO = Buffer.from("12345678901234567890");

describe("código do app autenticador (M5-04)", () => {
  it("calcula os códigos do RFC 6238", () => {
    expect(codigoDoPasso(SEGREDO, Math.floor(59 / 30))).toBe("287082");
    expect(codigoDoPasso(SEGREDO, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codigoDoPasso(SEGREDO, Math.floor(1234567890 / 30))).toBe("005924");
  });

  it("aceita o passo anterior, o atual e o seguinte, e diz qual foi", () => {
    const agora = 1234567890 * 1000;
    const atual = Math.floor(1234567890 / 30);
    expect(passoDoCodigo(SEGREDO, codigoDoPasso(SEGREDO, atual), agora)).toBe(atual);
    expect(passoDoCodigo(SEGREDO, codigoDoPasso(SEGREDO, atual - 1), agora)).toBe(atual - 1);
    expect(passoDoCodigo(SEGREDO, codigoDoPasso(SEGREDO, atual + 1), agora)).toBe(atual + 1);
    expect(passoDoCodigo(SEGREDO, codigoDoPasso(SEGREDO, atual - 2), agora)).toBeNull();
    expect(passoDoCodigo(SEGREDO, "12345", agora)).toBeNull();
    expect(passoDoCodigo(SEGREDO, "abcdef", agora)).toBeNull();
  });
});
