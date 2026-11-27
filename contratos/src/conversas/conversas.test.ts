import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { conferirMensagemQueChegou, FiltroDeConversas } from "./conversas.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("conversas com contatos", () => {
  it("aceita a mensagem que chegou pelo WhatsApp, com o número da mensagem no provedor", () => {
    const r = conferirMensagemQueChegou({
      canalId: ID,
      identificador: "+5511988887777",
      nomeDoPerfil: "Ana",
      idNoProvedor: "3EB0A1",
      tipo: "texto",
      texto: "Oi, tudo bem?",
      enviadaEm: "2026-11-27T20:00:00Z",
    });
    expect(r.ok).toBe(true);
  });

  it("recusa texto vazio e tipo que o provedor não manda (a nota é só da equipe)", () => {
    expect(
      conferirMensagemQueChegou({ canalId: ID, identificador: "+5511988887777", tipo: "texto", texto: " " })
        .ok,
    ).toBe(false);
    expect(
      conferirMensagemQueChegou({ canalId: ID, identificador: "+5511988887777", tipo: "nota", texto: "x" })
        .ok,
    ).toBe(false);
  });

  it("o filtro aceita dono 'sem' e recusa campo desconhecido", () => {
    expect(conferir(FiltroDeConversas, { donoId: "sem", situacoes: ["esperando_equipe"] }).ok).toBe(true);
    expect(conferir(FiltroDeConversas, { qualquer: 1 }).ok).toBe(false);
  });
});
