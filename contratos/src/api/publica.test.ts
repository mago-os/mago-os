import { describe, expect, it } from "vitest";
import { conferirPedidoDeChaveDeApi, FORMATO_DA_CHAVE_DE_API, ROTAS_DA_API_PUBLICA } from "./publica.ts";

describe("API pública", () => {
  it("cada rota tem id e caminho únicos, começa em /v1 e só escreve com o acesso escrever", () => {
    const ids = ROTAS_DA_API_PUBLICA.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const caminhos = ROTAS_DA_API_PUBLICA.map((r) => `${r.metodo} ${r.caminho}`);
    expect(new Set(caminhos).size).toBe(caminhos.length);
    for (const r of ROTAS_DA_API_PUBLICA) {
      expect(r.caminho.startsWith("/v1/")).toBe(true);
      if (r.metodo !== "GET") expect(r.precisa).toBe("escrever");
      if (r.precisa === "ler") expect(r.acao).toBe("ver");
    }
  });

  it("a chave tem o formato mago_api_", () => {
    expect(FORMATO_DA_CHAVE_DE_API.test(`mago_api_abcdefghij_${"A".repeat(43)}`)).toBe(true);
    expect(FORMATO_DA_CHAVE_DE_API.test(`mago_ag_abcdefghij_${"A".repeat(43)}`)).toBe(false);
  });

  it("o pedido de chave pede escopo e validade de no máximo 1 ano", () => {
    const agora = new Date("2026-11-25T12:00:00Z");
    expect(conferirPedidoDeChaveDeApi({ nome: "n8n", escopo: {} }, agora).ok).toBe(false);
    expect(conferirPedidoDeChaveDeApi({ nome: "n8n", escopo: { tarefas: "ler" } }, agora).ok).toBe(true);
    expect(
      conferirPedidoDeChaveDeApi(
        { nome: "n8n", escopo: { tarefas: "ler" }, validaAte: "2028-01-01T00:00:00Z" },
        agora,
      ).ok,
    ).toBe(false);
    expect(
      conferirPedidoDeChaveDeApi(
        { nome: "n8n", escopo: { contatos: "escrever" }, ips: ["203.0.113.0/24", "2001:db8::1"] },
        agora,
      ).ok,
    ).toBe(true);
    expect(
      conferirPedidoDeChaveDeApi({ nome: "n8n", escopo: { tarefas: "ler" }, ips: ["qualquer"] }, agora).ok,
    ).toBe(false);
  });
});
