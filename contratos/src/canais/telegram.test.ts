import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import {
  AtualizacaoDoTelegram,
  CodigoDoTelegram,
  FormatoDoCodigoDoTelegram,
  LETRAS_DO_CODIGO_DO_TELEGRAM,
  RESPOSTAS_DO_TELEGRAM,
} from "./telegram.ts";

describe("Telegram (M5-01)", () => {
  it("o código tem 8 letras, sem as que confundem", () => {
    expect(conferir(FormatoDoCodigoDoTelegram, "K7XQ2MPA").ok).toBe(true);
    expect(conferir(FormatoDoCodigoDoTelegram, "K7XQ2MP").ok).toBe(false);
    expect(conferir(FormatoDoCodigoDoTelegram, "K7XQ2MP0").ok).toBe(false);
    expect(conferir(FormatoDoCodigoDoTelegram, "k7xq2mpa").ok).toBe(false);
    for (const letra of "0O1IL") expect(LETRAS_DO_CODIGO_DO_TELEGRAM).not.toContain(letra);
  });

  it("o link leva ao bot com o código", () => {
    const bom = {
      codigo: "K7XQ2MPA",
      link: "https://t.me/OsMagoTesteBot?start=K7XQ2MPA",
      venceEm: "2026-11-22T14:10:00.000Z",
    };
    expect(conferir(CodigoDoTelegram, bom).ok).toBe(true);
    expect(conferir(CodigoDoTelegram, { ...bom, link: "https://exemplo.com/?start=K7XQ2MPA" }).ok).toBe(
      false,
    );
  });

  it("a atualização do webhook aceita campos que o Mago OS não usa", () => {
    const atualizacao = {
      update_id: 10,
      message: {
        message_id: 5,
        date: 1795355865,
        chat: { id: 123456789, type: "private", first_name: "Sandro" },
        from: { id: 123456789, is_bot: false, first_name: "Sandro", language_code: "pt-br" },
        text: "/start K7XQ2MPA",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    };
    expect(conferir(AtualizacaoDoTelegram, atualizacao).ok).toBe(true);
    expect(conferir(AtualizacaoDoTelegram, { message: atualizacao.message }).ok).toBe(false);
  });

  it("as respostas fixas não mudam sem querer (nenhuma diz se a conta ou o código existem)", () => {
    expect(RESPOSTAS_DO_TELEGRAM).toMatchInlineSnapshot(`
      {
        "codigoInvalido": "Esse código não vale. Gere um novo em Meu perfil, no app (ele vale 10 minutos).",
        "desvinculado": "Pronto, este Telegram não está mais ligado ao Mago OS.",
        "semVinculo": "Para usar o Mago OS pelo Telegram, vincule a conta em Meu perfil, no app.",
        "soConversaIndividual": "O Mago OS só conversa com você em particular, não em grupos.",
        "travado": "Muitos códigos errados. Espere 15 minutos e gere um código novo em Meu perfil.",
      }
    `);
  });
});
