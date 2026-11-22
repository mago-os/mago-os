import { describe, expect, it } from "vitest";
import { codigoDaMensagem, comandoDaMensagem, gerarCodigoDoTelegram } from "./servico.ts";

describe("mensagens do Telegram (M5-01)", () => {
  it("reconhece o código pelo link e digitado, só com as letras do contrato", () => {
    expect(codigoDaMensagem("/start K7XQ2MPA")).toEqual({ codigo: "K7XQ2MPA", peloLink: true });
    expect(codigoDaMensagem("k7xq-2mpa")).toEqual({ codigo: "K7XQ2MPA", peloLink: false });
    expect(codigoDaMensagem("boa noite")).toBeNull();
    expect(codigoDaMensagem("obrigado")).toBeNull();
    expect(codigoDaMensagem("K7XQ2MP")).toBeNull();
  });

  it("o código gerado sempre tem o formato que o bot reconhece", () => {
    for (let i = 0; i < 50; i++) expect(codigoDaMensagem(gerarCodigoDoTelegram())).not.toBeNull();
  });

  it("separa o comando do resto (com ou sem o @ do bot)", () => {
    expect(comandoDaMensagem("/empresa 2")).toEqual({ comando: "empresa", resto: "2" });
    expect(comandoDaMensagem("/Ajuda@OsMagoTesteBot")).toEqual({ comando: "ajuda", resto: "" });
    expect(comandoDaMensagem("oi")).toBeNull();
  });
});
