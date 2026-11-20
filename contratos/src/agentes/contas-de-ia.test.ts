import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import {
  ContaDeIa,
  conferirContaDeIa,
  conferirModelosDoAgente,
  conferirPedidoDeContaDeIa,
  PedidoDeContaDeIa,
  PedidoDeEditarContaDeIa,
  problemasDaTrocaDeChave,
} from "./contas-de-ia.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OUTRO = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AGORA = "2026-11-20T12:00:00Z";

const conta = {
  id: ID,
  empresaId: ID,
  nome: "Anthropic da Nolask",
  provedor: "anthropic",
  credencial: "chave_de_api",
  endereco: null,
  finalDaChave: "x9Qa",
  situacao: "ativa",
  ultimoErro: null,
  tetoMensal: 5000,
  termosAceitosPor: null,
  termosAceitosEm: null,
  limiteDoPlanoAte: null,
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
    expect(conferirPedidoDeContaDeIa({ ...pedido, chave: "com espaço no meio" }).ok).toBe(false);
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

describe("assinatura (M4-10)", () => {
  const assinatura = {
    ...conta,
    nome: "Claude Max do Sandro",
    credencial: "assinatura",
    tetoMensal: null,
    termosAceitosPor: ID,
    termosAceitosEm: AGORA,
  };

  it("a conta por assinatura precisa do aceite dos termos e não tem teto em dólar", () => {
    expect(conferirContaDeIa(assinatura).ok).toBe(true);
    expect(conferirContaDeIa({ ...assinatura, termosAceitosEm: null }).ok).toBe(false);
    expect(conferirContaDeIa({ ...assinatura, tetoMensal: 2000 }).ok).toBe(false);
    expect(conferirContaDeIa({ ...assinatura, limiteDoPlanoAte: AGORA }).ok).toBe(true);
    // A chave de API não tem aceite nem limite do plano.
    expect(conferirContaDeIa({ ...conta, termosAceitosPor: ID, termosAceitosEm: AGORA }).ok).toBe(false);
    expect(conferirContaDeIa({ ...conta, limiteDoPlanoAte: AGORA }).ok).toBe(false);
  });

  it("cada provedor aceita só os tipos dele", () => {
    expect(conferirContaDeIa({ ...assinatura, provedor: "chatgpt" }).ok).toBe(true);
    expect(conferirContaDeIa({ ...conta, provedor: "chatgpt" }).ok).toBe(false);
    expect(
      conferirContaDeIa({
        ...assinatura,
        provedor: "compativel_openai",
        endereco: "https://openrouter.ai/api/v1",
      }).ok,
    ).toBe(false);
  });

  it("o pedido de assinatura exige o aceite e confere o formato do login", () => {
    const pedido = {
      nome: "Claude Max",
      provedor: "anthropic",
      credencial: "assinatura",
      chave: "sk-ant-oat01-token-de-teste-do-plano",
      aceitoOsTermos: true,
    };
    expect(conferirPedidoDeContaDeIa(pedido).ok).toBe(true);
    expect(conferirPedidoDeContaDeIa({ ...pedido, aceitoOsTermos: undefined }).ok).toBe(false);
    expect(conferirPedidoDeContaDeIa({ ...pedido, aceitoOsTermos: false }).ok).toBe(false);
    expect(conferirPedidoDeContaDeIa({ ...pedido, tetoMensal: 2000 }).ok).toBe(false);
    // O auth.json do Codex vem formatado, com espaços e quebras de linha.
    const codex = JSON.stringify(
      { tokens: { access_token: "a", refresh_token: "r", account_id: "c" } },
      null,
      2,
    );
    expect(conferirPedidoDeContaDeIa({ ...pedido, provedor: "chatgpt", chave: codex }).ok).toBe(true);
    expect(
      conferirPedidoDeContaDeIa({ ...pedido, provedor: "chatgpt", chave: "token-solto-sem-json" }).ok,
    ).toBe(false);
    // Sem "credencial", é chave de API: curta e sem espaço.
    expect(conferirPedidoDeContaDeIa({ nome: "API", provedor: "anthropic", chave: codex }).ok).toBe(false);
    expect(
      conferirPedidoDeContaDeIa({ nome: "API", provedor: "chatgpt", chave: "sk-chave-de-api-1" }).ok,
    ).toBe(false);
  });

  it("a troca de chave segue o tipo da conta", () => {
    expect(
      problemasDaTrocaDeChave({ credencial: "chave_de_api", provedor: "anthropic" }, "sk-ant-nova-chave"),
    ).toEqual([]);
    expect(
      problemasDaTrocaDeChave({ credencial: "assinatura", provedor: "chatgpt" }, "sk-solta"),
    ).not.toEqual([]);
  });
});
