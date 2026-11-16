import { describe, expect, it } from "vitest";
import type { Banco } from "./banco.ts";
import { criarServidor } from "./servidor.ts";

function bancoFalso(saudavel: boolean): Banco {
  return { estaSaudavel: async () => saudavel, fechar: async () => {} };
}

const config = { nivelRegistro: "silent", ambiente: "local" } as const;

describe("rota de saúde", () => {
  it("responde 200 quando a API e o banco estão bem", async () => {
    const app = criarServidor(config, bancoFalso(true));
    const resposta = await app.inject({ method: "GET", url: "/saude" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({
      situacao: "ok",
      api: "ok",
      banco: "ok",
      sistema: "Mago OS",
      ambiente: "local",
      versao: "local",
    });
  });

  it("responde 503 quando o banco está fora do ar", async () => {
    const app = criarServidor(config, bancoFalso(false));
    const resposta = await app.inject({ method: "GET", url: "/saude" });
    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({ situacao: "com_problema", api: "ok", banco: "fora_do_ar" });
  });
});

describe("número de rastreio", () => {
  it("volta em cada resposta no cabeçalho x-rastreio, no formato do OpenTelemetry", async () => {
    const app = criarServidor(config, bancoFalso(true));
    const primeira = await app.inject({ method: "GET", url: "/saude" });
    const segunda = await app.inject({ method: "GET", url: "/nao-existe" });
    expect(primeira.headers["x-rastreio"]).toMatch(/^[0-9a-f]{32}$/);
    expect(segunda.headers["x-rastreio"]).toMatch(/^[0-9a-f]{32}$/);
    expect(primeira.headers["x-rastreio"]).not.toBe(segunda.headers["x-rastreio"]);
  });

  it("aparece nos registros de cada pedido", async () => {
    const linhas: string[] = [];
    const destinoDosRegistros = { write: (linha: string) => void linhas.push(linha) };
    const app = criarServidor({ nivelRegistro: "info", ambiente: "local" }, bancoFalso(true), {
      destinoDosRegistros,
    });
    const resposta = await app.inject({ method: "GET", url: "/saude" });
    const rastreio = resposta.headers["x-rastreio"];
    const registros = linhas.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(registros.length).toBeGreaterThanOrEqual(2);
    for (const registro of registros) {
      expect(registro.rastreio).toBe(rastreio);
      expect(registro.servico).toBe("mago-os-nucleo");
      expect(registro).toHaveProperty("hora");
      expect(registro).toHaveProperty("nivel");
    }
  });
});
