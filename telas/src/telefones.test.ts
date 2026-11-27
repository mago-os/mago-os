import { describe, expect, it } from "vitest";
import { provavelWhatsapp, telefoneInternacional, telefoneParaLer } from "./telefones";

describe("telefones", () => {
  it("completa o +55 no número brasileiro e lê com espaços", () => {
    expect(telefoneInternacional("(11) 98765-4321")).toBe("+5511987654321");
    expect(telefoneInternacional("+351 912 345 678")).toBe("+351912345678");
    expect(telefoneParaLer("+5511987654321")).toBe("+55 11 98765-4321");
  });

  it("WhatsApp marcado só no celular brasileiro (e nos de fora, que não dá para saber)", () => {
    expect(provavelWhatsapp("+5511987654321")).toBe(true);
    expect(provavelWhatsapp("+551122222222")).toBe(false);
    expect(provavelWhatsapp("+351912345678")).toBe(true);
  });
});
