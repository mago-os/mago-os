import { describe, expect, it } from "vitest";
import { ErroDeConfig, lerConfig } from "./config.ts";

const URL = "postgres://mago@127.0.0.1:54318/mago";
const ACESSO = {
  DATABASE_URL_ACESSO: "postgres://mago_acesso@127.0.0.1:54318/mago",
  MAGO_ACESSO_SEGREDO: "s".repeat(40),
  MAGO_URL_PUBLICA: "https://teste.osmago.com",
};

describe("configuração", () => {
  it("usa os padrões quando só o banco é informado", () => {
    expect(lerConfig({ DATABASE_URL: URL })).toEqual({
      porta: 3000,
      host: "0.0.0.0",
      bancoUrl: URL,
      nivelRegistro: "info",
      ambiente: "local",
      versao: "local",
      acesso: null,
    });
  });

  it("lê os valores das variáveis de ambiente", () => {
    const config = lerConfig({
      DATABASE_URL: URL,
      PORTA: "8080",
      NIVEL_REGISTRO: "debug",
      AMBIENTE: "teste",
      ...ACESSO,
    });
    expect(config.porta).toBe(8080);
    expect(config.nivelRegistro).toBe("debug");
    expect(config.ambiente).toBe("teste");
  });

  it("recusa subir sem o banco e diz o que falta", () => {
    expect(() => lerConfig({})).toThrow(ErroDeConfig);
    expect(() => lerConfig({})).toThrow(/DATABASE_URL não foi informada/);
  });

  it("junta todos os problemas numa mensagem só", () => {
    const tentar = () => lerConfig({ DATABASE_URL: "mysql://x", PORTA: "abc", AMBIENTE: "outro" });
    expect(tentar).toThrow(/PORTA/);
    expect(tentar).toThrow(/postgres:\/\//);
    expect(tentar).toThrow(/AMBIENTE/);
  });

  it("o login é obrigatório fora do Mac", () => {
    expect(() => lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste" })).toThrow(/DATABASE_URL_ACESSO/);
    expect(lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste", ...ACESSO }).acesso).toEqual({
      bancoUrl: ACESSO.DATABASE_URL_ACESSO,
      segredo: ACESSO.MAGO_ACESSO_SEGREDO,
      urlPublica: "https://teste.osmago.com",
      conferirSenhasVazadas: true,
    });
  });

  it("recusa segredo curto, endereço sem https fora do Mac e senhas vazadas desligadas no teste", () => {
    const tentar = () =>
      lerConfig({
        DATABASE_URL: URL,
        AMBIENTE: "teste",
        ...ACESSO,
        MAGO_ACESSO_SEGREDO: "curto",
        MAGO_URL_PUBLICA: "http://teste.osmago.com",
        MAGO_SENHAS_VAZADAS: "nao_conferir",
      });
    expect(tentar).toThrow(/MAGO_ACESSO_SEGREDO/);
    expect(tentar).toThrow(/https fora do Mac/);
    expect(tentar).toThrow(/só pode ser desligada no Mac/);
  });
});
