import { describe, expect, it } from "vitest";
import { ErroDeConfig, lerConfig } from "./config.ts";

const URL = "postgres://mago@127.0.0.1:54318/mago";

describe("configuração", () => {
  it("usa os padrões quando só o banco é informado", () => {
    expect(lerConfig({ DATABASE_URL: URL })).toEqual({
      porta: 3000,
      host: "0.0.0.0",
      bancoUrl: URL,
      nivelRegistro: "info",
      ambiente: "local",
    });
  });

  it("lê os valores das variáveis de ambiente", () => {
    const config = lerConfig({
      DATABASE_URL: URL,
      PORTA: "8080",
      NIVEL_REGISTRO: "debug",
      AMBIENTE: "teste",
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
});
