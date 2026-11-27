import { describe, expect, it } from "vitest";
import {
  destinoDoIdentificador,
  lerEntregaDaEvolution,
  lerMensagemDaEvolution,
  nomeLimpo,
} from "./leitura.ts";

const chave = (extra: Record<string, unknown> = {}) => ({
  remoteJid: "5511988887777@s.whatsapp.net",
  fromMe: false,
  id: "3EB0A1",
  ...extra,
});

describe("avisos de mensagem da Evolution", () => {
  it("texto do contato, com o nome do perfil e a hora do WhatsApp", () => {
    const r = lerMensagemDaEvolution({
      key: chave(),
      pushName: "Bia",
      message: { conversation: "Oi" },
      messageTimestamp: 1795800000,
    });
    expect(r).toEqual({
      ignorar: false,
      arquivo: null,
      mensagem: {
        identificador: "+5511988887777",
        nomeDoPerfil: "Bia",
        idNoProvedor: "3EB0A1",
        enviadaEm: new Date(1795800000 * 1000).toISOString(),
        tipo: "texto",
        texto: "Oi",
      },
    });
  });

  it("grupo, status e controle são ignorados", () => {
    expect(
      lerMensagemDaEvolution({ key: chave({ remoteJid: "123-456@g.us" }), message: { conversation: "x" } }),
    ).toMatchObject({ ignorar: true, motivo: "grupo" });
    expect(
      lerMensagemDaEvolution({ key: chave({ remoteJid: "status@broadcast" }), message: {} }),
    ).toMatchObject({ ignorar: true });
    expect(
      lerMensagemDaEvolution({ key: chave(), message: { reactionMessage: { text: "👍" } } }),
    ).toMatchObject({ ignorar: true });
  });

  it("LID: usa o telefone de remoteJidAlt; sem ele, fica o LID", () => {
    const comTelefone = lerMensagemDaEvolution({
      key: chave({
        remoteJid: "123456789012@lid",
        remoteJidAlt: "5511977776666@s.whatsapp.net",
        addressingMode: "lid",
      }),
      message: { conversation: "Oi" },
    });
    expect(comTelefone).toMatchObject({ mensagem: { identificador: "+5511977776666" } });
    const semTelefone = lerMensagemDaEvolution({
      key: chave({ remoteJid: "123456789012@lid" }),
      message: { conversation: "Oi" },
    });
    expect(semTelefone).toMatchObject({ mensagem: { identificador: "lid:123456789012" } });
  });

  it("do próprio número: doCelular, sem o nome do perfil (é o da empresa)", () => {
    const r = lerMensagemDaEvolution({
      key: chave({ fromMe: true }),
      pushName: "4xpert",
      message: { conversation: "Já te mando" },
    });
    expect(r).toMatchObject({ mensagem: { doCelular: true, nomeDoPerfil: null } });
  });

  it("foto, documento, áudio, localização, contato e o resto", () => {
    expect(
      lerMensagemDaEvolution({
        key: chave(),
        message: { imageMessage: { caption: "Olha", mimetype: "image/jpeg" } },
      }),
    ).toMatchObject({
      mensagem: { tipo: "foto", texto: "Olha" },
      arquivo: { mime: "image/jpeg" },
    });
    expect(
      lerMensagemDaEvolution({
        key: chave(),
        message: { documentMessage: { fileName: "../../orçamento.pdf", mimetype: "application/pdf" } },
      }),
    ).toMatchObject({ mensagem: { tipo: "documento" }, arquivo: { nome: "orçamento.pdf" } });
    expect(
      lerMensagemDaEvolution({
        key: chave(),
        message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
      }),
    ).toMatchObject({
      mensagem: { tipo: "audio" },
    });
    expect(
      lerMensagemDaEvolution({
        key: chave(),
        message: { locationMessage: { degreesLatitude: -23.5, degreesLongitude: -46.6, name: "Loja" } },
      }),
    ).toMatchObject({
      mensagem: {
        tipo: "localizacao",
        texto: expect.stringMatching(/^Localização: Loja \(-23\.500000, -46\.600000\)/),
      },
    });
    expect(
      lerMensagemDaEvolution({
        key: chave(),
        message: {
          contactMessage: {
            displayName: "Carlos",
            vcard: "BEGIN:VCARD\nTEL;type=CELL:+55 11 91234-5678\nEND:VCARD",
          },
        },
      }),
    ).toMatchObject({
      mensagem: { tipo: "contato", texto: "Contato compartilhado: Carlos, +55 11 91234-5678" },
    });
    expect(lerMensagemDaEvolution({ key: chave(), message: { stickerMessage: {} } })).toMatchObject({
      mensagem: { tipo: "outro" },
    });
  });

  it("entrega: pelo nome e pelo número do status", () => {
    expect(lerEntregaDaEvolution({ keyId: "A1", status: "DELIVERY_ACK" })).toEqual({
      id: "A1",
      entrega: "entregue",
    });
    expect(lerEntregaDaEvolution({ key: { id: "A1" }, status: 4 })).toEqual({ id: "A1", entrega: "lida" });
    expect(lerEntregaDaEvolution({ keyId: "A1", status: "PENDING" })).toBeNull();
  });

  it("nome de arquivo limpo e o destino de quem responde", () => {
    expect(nomeLimpo("C:\\x\\a<b>.pdf", "arquivo")).toBe("a_b_.pdf");
    expect(nomeLimpo("...", "arquivo")).toBe("arquivo");
    expect(destinoDoIdentificador("+5511988887777")).toBe("5511988887777");
    expect(destinoDoIdentificador("lid:123456789012")).toBe("123456789012@lid");
    expect(destinoDoIdentificador("visitante:abc")).toBeNull();
  });
});
