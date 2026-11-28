import { describe, expect, it } from "vitest";
import { falaDeAssunto, normalizar, pedeUmaPessoa } from "./passagem.ts";

describe("sinais da passagem para uma pessoa", () => {
  it("normaliza sem acento, pontuação e maiúsculas", () => {
    expect(normalizar("  Vocês têm a PEÇA 42?! ")).toBe("voces tem a peca 42");
  });

  it("acha o pedido claro de uma pessoa", () => {
    for (const t of [
      "Quero falar com um atendente",
      "humano por favor",
      "Posso falar com alguém?",
      "chama o GERENTE",
      "quero uma pessoa de verdade",
    ])
      expect(pedeUmaPessoa(t), t).toBe(true);
    for (const t of ["Oi, tudo bem?", "Vocês atendem sábado?", "pessoal, bom dia"])
      expect(pedeUmaPessoa(t), t).toBe(false);
  });

  it("acha o assunto do canal pela palavra inteira, sem acento", () => {
    expect(falaDeAssunto("Tem DESCONTO à vista?", ["desconto"])).toBe(true);
    expect(falaDeAssunto("Quero fazer uma reclamação", ["Reclamação"])).toBe(true);
    expect(falaDeAssunto("descontos", ["desconto"])).toBe(false);
    expect(falaDeAssunto("qualquer coisa", [])).toBe(false);
  });
});
