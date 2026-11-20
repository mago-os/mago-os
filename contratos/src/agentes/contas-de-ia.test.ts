import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import {
  ContaDeIa,
  conferirContaDeIa,
  conferirModelosDoAgente,
  PedidoDeContaDeIa,
  PedidoDeEditarContaDeIa,
} from "./contas-de-ia.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OUTRO = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AGORA = "2026-11-20T12:00:00Z";

const conta = {
  id: ID,
  empresaId: ID,
  nome: "Anthropic da Nolask",
  provedor: "anthropic",
  endereco: null,
  finalDaChave: "x9Qa",
  situacao: "ativa",
  ultimoErro: null,
  tetoMensal: 5000,
  testadaEm: AGORA,
  criadaPor: ID,
  criadaEm: AGORA,
  atualizadaEm: AGORA,
};

describe("conta de IA", () => {
  it("aceita a conta sem a chave e recusa qualquer campo de chave", () => {
    expect(conferirContaDeIa(conta).ok).toBe(true);
    expect(conferirContaDeIa({ ...conta, chave: "sk-ant-segredo" }).ok).toBe(false);
    expect(conferirContaDeIa({ ...conta, finalDaChave: "longo-demais" }).ok).toBe(false);
  });

  it("endereço: obrigatório no compatível com OpenAI, proibido na Anthropic, https ou localhost", () => {
    expect(conferirContaDeIa({ ...conta, endereco: "https://api.anthropic.com" }).ok).toBe(false);
    const compativel = { ...conta, provedor: "compativel_openai" };
    expect(conferirContaDeIa(compativel).ok).toBe(false);
    expect(conferirContaDeIa({ ...compativel, endereco: "https://openrouter.ai/api/v1" }).ok).toBe(true);
    expect(conferirContaDeIa({ ...compativel, endereco: "http://localhost:11434/v1" }).ok).toBe(true);
    expect(conferirContaDeIa({ ...compativel, endereco: "http://golpe.example/v1" }).ok).toBe(false);
    expect(conferirContaDeIa({ ...compativel, endereco: "https://x.example/?chave=1" }).ok).toBe(false);
  });

  it("conta com erro diz qual foi", () => {
    expect(conferirContaDeIa({ ...conta, situacao: "com_erro" }).ok).toBe(false);
    expect(conferirContaDeIa({ ...conta, situacao: "com_erro", ultimoErro: "chave recusada" }).ok).toBe(true);
  });

  it("o pedido de conectar leva a chave; editar pede pelo menos um campo", () => {
    const pedido = { nome: "Anthropic", provedor: "anthropic", chave: "sk-ant-api03-abcdefgh" };
    expect(conferir(PedidoDeContaDeIa, pedido).ok).toBe(true);
    expect(conferir(PedidoDeContaDeIa, { ...pedido, chave: "com espaço no meio" }).ok).toBe(false);
    expect(conferir(PedidoDeEditarContaDeIa, {}).ok).toBe(false);
    expect(conferir(PedidoDeEditarContaDeIa, { tetoMensal: 2000 }).ok).toBe(true);
    expect(conferir(PedidoDeEditarContaDeIa, { tetoMensal: -1 }).ok).toBe(false);
  });

  it("a chave é marcada como só de entrada no esquema", () => {
    expect((PedidoDeContaDeIa.properties.chave as { writeOnly?: boolean }).writeOnly).toBe(true);
    expect(Object.keys(ContaDeIa.properties)).not.toContain("chave");
  });
});

describe("modelos do agente", () => {
  const principal = { contaId: ID, modelo: "claude-sonnet-5-5" };

  it("aceita principal sem reserva e com reserva diferente", () => {
    expect(conferirModelosDoAgente({ principal, reserva: null }).ok).toBe(true);
    expect(
      conferirModelosDoAgente({ principal, reserva: { contaId: ID, modelo: "claude-haiku-5-5" } }).ok,
    ).toBe(true);
    expect(
      conferirModelosDoAgente({ principal, reserva: { contaId: OUTRO, modelo: "claude-sonnet-5-5" } }).ok,
    ).toBe(true);
  });

  it("recusa o reserva igual ao principal", () => {
    expect(conferirModelosDoAgente({ principal, reserva: { ...principal } }).ok).toBe(false);
  });
});
