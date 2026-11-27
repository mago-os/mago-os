import { describe, expect, it } from "vitest";
import { formasDoTelefone, telefoneInternacional } from "./telefone.ts";

describe("telefone que chega do WhatsApp", () => {
  it("vira o formato internacional, com ou sem o sufixo do WhatsApp", () => {
    expect(telefoneInternacional("5511988887777")).toBe("+5511988887777");
    expect(telefoneInternacional("5511988887777@s.whatsapp.net")).toBe("+5511988887777");
    expect(telefoneInternacional("+55 (11) 98888-7777")).toBe("+5511988887777");
    expect(telefoneInternacional("351912345678")).toBe("+351912345678");
    expect(telefoneInternacional("abc")).toBeNull();
    expect(telefoneInternacional("0123")).toBeNull();
  });

  it("o celular do Brasil é procurado com e sem o nono dígito", () => {
    expect(formasDoTelefone("+5511988887777")).toEqual(["+5511988887777", "+551188887777"]);
    expect(formasDoTelefone("+551188887777")).toEqual(["+551188887777", "+5511988887777"]);
  });

  it("o fixo do Brasil e o número de outro país ficam como estão", () => {
    expect(formasDoTelefone("+551133334444")).toEqual(["+551133334444"]);
    expect(formasDoTelefone("+351912345678")).toEqual(["+351912345678"]);
    expect(formasDoTelefone("+12025550123")).toEqual(["+12025550123"]);
  });
});
