import { describe, expect, it } from "vitest";
import { interpretarSaude, nomeDoAmbiente } from "./saude.ts";

const ok = {
  situacao: "ok",
  api: "ok",
  banco: "ok",
  sistema: "Mago OS",
  ambiente: "teste",
  versao: "abc1234",
};

describe("estado da API na tela", () => {
  it("mostra tudo certo quando a API e o banco respondem", () => {
    expect(interpretarSaude(200, ok, "abc", 12)).toEqual({
      tipo: "ok",
      ambiente: "teste",
      versao: "abc1234",
      rastreio: "abc",
      ms: 12,
    });
  });

  it("avisa quando o banco está fora do ar", () => {
    const corpo = { ...ok, situacao: "com_problema", banco: "fora_do_ar" };
    expect(interpretarSaude(503, corpo, "abc", 5)).toEqual({
      tipo: "banco_fora",
      ambiente: "teste",
      rastreio: "abc",
    });
  });

  it("avisa quando a resposta não é da API do Mago OS", () => {
    expect(interpretarSaude(502, null, null, 5).tipo).toBe("api_fora");
    expect(interpretarSaude(200, { ola: 1 }, null, 5).tipo).toBe("api_fora");
  });

  it("dá nome aos ambientes", () => {
    expect(nomeDoAmbiente("producao")).toBe("Produção");
    expect(nomeDoAmbiente("local")).toBe("Local");
  });
});
