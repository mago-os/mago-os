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
      anexos: { deposito: { tipo: "disco" }, clamav: null },
      cofre: { atual: { versao: 1, chave: expect.any(Buffer) }, anteriores: [], deTeste: true },
      telegram: null,
      evolution: null,
    });
  });

  it("evolution: as quatro variáveis juntas, com endereço, chave e segredo nos formatos certos", () => {
    const certas = {
      MAGO_EVOLUTION_URL: "http://evolution:8080",
      MAGO_EVOLUTION_CHAVE: "c".repeat(32),
      MAGO_EVOLUTION_SEGREDO: "s".repeat(40),
      MAGO_EVOLUTION_URL_DOS_AVISOS: "http://api:3000/interno/evolution/avisos",
    };
    expect(lerConfig({ DATABASE_URL: URL, ...certas }).evolution).toEqual({
      url: "http://evolution:8080",
      chave: "c".repeat(32),
      segredo: "s".repeat(40),
      urlDosAvisos: "http://api:3000/interno/evolution/avisos",
    });
    expect(() => lerConfig({ DATABASE_URL: URL, MAGO_EVOLUTION_URL: "http://evolution:8080" })).toThrow(
      /juntas/,
    );
    expect(() => lerConfig({ DATABASE_URL: URL, ...certas, MAGO_EVOLUTION_SEGREDO: "curto" })).toThrow(
      /MAGO_EVOLUTION_SEGREDO/,
    );
    expect(() => lerConfig({ DATABASE_URL: URL, ...certas, MAGO_EVOLUTION_URL: "evolution" })).toThrow(
      /MAGO_EVOLUTION_URL/,
    );
  });

  it("telegram: token e segredo juntos, nos formatos certos", () => {
    const token = `123456789:${"A".repeat(35)}`;
    const segredo = "s".repeat(40);
    expect(
      lerConfig({ DATABASE_URL: URL, MAGO_TELEGRAM_TOKEN: token, MAGO_TELEGRAM_SEGREDO: segredo }).telegram,
    ).toEqual({
      token,
      segredo,
    });
    expect(() => lerConfig({ DATABASE_URL: URL, MAGO_TELEGRAM_TOKEN: token })).toThrow(/juntas/);
    expect(() =>
      lerConfig({ DATABASE_URL: URL, MAGO_TELEGRAM_TOKEN: "nao-e-token", MAGO_TELEGRAM_SEGREDO: segredo }),
    ).toThrow(/BotFather/);
    expect(() =>
      lerConfig({ DATABASE_URL: URL, MAGO_TELEGRAM_TOKEN: token, MAGO_TELEGRAM_SEGREDO: "curto" }),
    ).toThrow(/MAGO_TELEGRAM_SEGREDO/);
  });

  it("cofre: chave mestra de 32 bytes; fora do Mac, sem ela, as contas de IA ficam desligadas", () => {
    const mestra = Buffer.alloc(32, 7).toString("base64");
    expect(lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste", ...ACESSO }).cofre).toBeNull();
    const c = lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste", ...ACESSO, MAGO_COFRE_CHAVE_MESTRA: mestra });
    expect(c.cofre?.deTeste).toBe(false);
    expect(c.cofre?.atual.versao).toBe(1);
    expect(() =>
      lerConfig({ DATABASE_URL: URL, MAGO_COFRE_CHAVE_MESTRA: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/MAGO_COFRE_CHAVE_MESTRA/);
    const troca = lerConfig({
      DATABASE_URL: URL,
      MAGO_COFRE_CHAVE_MESTRA: mestra,
      MAGO_COFRE_VERSAO: "2",
      MAGO_COFRE_CHAVE_ANTERIOR: Buffer.alloc(32, 1).toString("base64"),
    });
    expect(troca.cofre?.anteriores.map((a) => a.versao)).toEqual([1]);
  });

  it("anexos: as quatro variáveis do depósito juntas, e o ClamAV obrigatório fora do Mac", () => {
    const S3 = {
      MAGO_ANEXOS_ENDPOINT: "s3.us-east-005.backblazeb2.com",
      MAGO_ANEXOS_BUCKET: "mago-os-anexos-teste",
      MAGO_ANEXOS_CHAVE_ID: "id",
      MAGO_ANEXOS_CHAVE_SEGREDO: "segredo",
    };
    expect(() => lerConfig({ DATABASE_URL: URL, MAGO_ANEXOS_BUCKET: "x" })).toThrow(/juntas/);
    expect(() => lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste", ...ACESSO, ...S3 })).toThrow(
      /MAGO_CLAMAV/,
    );
    const c = lerConfig({
      DATABASE_URL: URL,
      AMBIENTE: "teste",
      ...ACESSO,
      ...S3,
      MAGO_CLAMAV: "clamav:3310",
    });
    expect(c.anexos).toEqual({
      deposito: {
        tipo: "s3",
        endpoint: "https://s3.us-east-005.backblazeb2.com",
        bucket: "mago-os-anexos-teste",
        chaveId: "id",
        chaveSegredo: "segredo",
      },
      clamav: "clamav:3310",
    });
    // Fora do Mac, sem depósito, os anexos ficam desligados (sem derrubar a API).
    expect(lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste", ...ACESSO }).anexos).toBeNull();
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
      google: null,
      resend: null,
      vapid: null,
    });
  });

  it("o login com Google precisa do ID e da chave juntos", () => {
    expect(() => lerConfig({ DATABASE_URL: URL, AMBIENTE: "teste", ...ACESSO, MAGO_GOOGLE_ID: "x" })).toThrow(
      /MAGO_GOOGLE_ID e MAGO_GOOGLE_SEGREDO juntos/,
    );
    const config = lerConfig({
      DATABASE_URL: URL,
      AMBIENTE: "teste",
      ...ACESSO,
      MAGO_GOOGLE_ID: "id.apps.googleusercontent.com",
      MAGO_GOOGLE_SEGREDO: "segredo",
    });
    expect(config.acesso?.google).toEqual({ id: "id.apps.googleusercontent.com", segredo: "segredo" });
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
