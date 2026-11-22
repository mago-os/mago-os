import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import {
  AtualizacaoDoTelegram,
  CodigoDoTelegram,
  FormatoDoCodigoDoTelegram,
  LETRAS_DO_CODIGO_DO_TELEGRAM,
  mencaoNoComeco,
  RESPOSTAS_DO_TELEGRAM,
  textoDoArquivoParaOAgente,
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

  it("a menção a um especialista vem no começo da mensagem (M5-02)", () => {
    expect(mencaoNoComeco("@gerente planeja o lançamento")).toEqual({
      mencao: "gerente",
      resto: "planeja o lançamento",
    });
    expect(mencaoNoComeco("@Gerente: replaneja o blog")).toEqual({
      mencao: "Gerente",
      resto: "replaneja o blog",
    });
    expect(mencaoNoComeco("planeja o lançamento com @gerente")).toBeNull();
    expect(mencaoNoComeco("@gerente")).toBeNull();
  });

  it("a mensagem com arquivo é aceita, e o agente recebe só os dados do arquivo (M5-03)", () => {
    const foto = {
      update_id: 11,
      message: {
        message_id: 6,
        date: 1795355865,
        chat: { id: 1, type: "private" },
        from: { id: 1, is_bot: false, first_name: "S" },
        caption: "anexa na tarefa do contrato",
        photo: [
          { file_id: "p", file_unique_id: "u", file_size: 1000, width: 90, height: 90 },
          { file_id: "g", file_unique_id: "v", file_size: 90000, width: 1280, height: 960 },
        ],
      },
    };
    expect(conferir(AtualizacaoDoTelegram, foto).ok).toBe(true);
    expect(
      textoDoArquivoParaOAgente({ id: "abc", nome: "foto.jpg", tipo: "image/jpeg", tamanho: 90000 }),
    ).toBe("[Arquivo recebido pelo Telegram, esperando uma tarefa: foto.jpg (image/jpeg, 88 KB), id abc]");
  });

  it("as respostas fixas não mudam sem querer (nenhuma diz se a conta ou o código existem)", () => {
    expect(RESPOSTAS_DO_TELEGRAM).toMatchInlineSnapshot(`
      {
        "arquivoGrande": "Esse arquivo passa de 20 MB, o limite do Telegram para o Mago OS receber. Mande pelo app, na tarefa.",
        "codigoInvalido": "Esse código não vale. Gere um novo em Meu perfil, no app (ele vale 10 minutos).",
        "conversaNova": "Pronto, conversa nova. Pode mandar o pedido.",
        "desvinculado": "Pronto, este Telegram não está mais ligado ao Mago OS.",
        "especialistaNaoEncontrado": "Não encontrei esse agente. Mande o pedido sem a menção, para o coordenador.",
        "figurinha": "Figurinhas e GIFs não viram anexo. Mande foto, documento, áudio ou vídeo.",
        "ocupado": "Ainda estou respondendo a mensagem anterior. Espere a resposta e mande de novo.",
        "semAcessoAosAgentes": "O seu perfil nesta empresa não conversa com os agentes. Fale com o administrador.",
        "semPermissaoDeEspecialista": "Só o administrador e o gestor falam direto com um especialista. Mande o pedido sem a menção, para o coordenador.",
        "semPrioridades": "Nada pedindo a sua atenção agora.",
        "semVinculo": "Para usar o Mago OS pelo Telegram, vincule a conta em Meu perfil, no app.",
        "soConversaIndividual": "O Mago OS só conversa com você em particular, não em grupos.",
        "soTexto": "Por enquanto entendo só texto por aqui. Arquivos e fotos chegam em breve.",
        "tipoBloqueado": "Esse tipo de arquivo não é aceito (pode rodar um programa). Mande outro formato, como PDF ou imagem.",
        "travado": "Muitos códigos errados. Espere 15 minutos e gere um código novo em Meu perfil.",
      }
    `);
  });
});
