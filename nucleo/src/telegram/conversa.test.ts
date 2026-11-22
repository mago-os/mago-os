import { describe, expect, it } from "vitest";
import { partesDoTexto } from "./conversa.ts";

describe("respostas longas no Telegram (M5-02)", () => {
  it("divide no limite, quebrando em linha ou espaço, sem perder texto", () => {
    const texto = `${"a".repeat(30)}\n${"b ".repeat(20)}fim`;
    const partes = partesDoTexto(texto, 40);
    expect(partes.every((p) => p.length <= 40)).toBe(true);
    expect(partes.join(" ").replace(/\s+/g, " ")).toBe(texto.replace(/\s+/g, " ").trim());
    expect(partes[0]).toBe("a".repeat(30));
  });

  it("texto curto vai inteiro, e palavra sem espaço é cortada no limite", () => {
    expect(partesDoTexto("oi")).toEqual(["oi"]);
    expect(partesDoTexto("x".repeat(90), 40)).toEqual(["x".repeat(40), "x".repeat(40), "x".repeat(10)]);
  });
});
