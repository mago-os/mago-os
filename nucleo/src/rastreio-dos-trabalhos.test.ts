import { describe, expect, it } from "vitest";
import type { Banco } from "./banco.ts";
import { continuarRastreio, levarRastreio, rastreioAtual } from "./rastreio-dos-trabalhos.ts";
import { criarServidor } from "./servidor.ts";

const banco: Banco = { estaSaudavel: async () => true, fechar: async () => {} };

describe("número de rastreio de ponta a ponta (M6-02)", () => {
  it("o pedido leva o número para o trabalho da fila, e os registros do trabalho têm o mesmo número", async () => {
    const linhas: Record<string, unknown>[] = [];
    const app = criarServidor({ nivelRegistro: "info", ambiente: "local" }, banco, {
      destinoDosRegistros: { write: (l) => linhas.push(JSON.parse(l)) },
    });
    let levado: ReturnType<typeof levarRastreio> = {};
    // O pedido manda um trabalho para a fila (como a mensagem para o agente) e responde antes dele rodar.
    app.post("/mensagem", async () => {
      await Promise.resolve();
      levado = levarRastreio();
      return { ok: true };
    });
    // Pela rede de verdade e com corpo JSON: o Fastify lê o corpo num evento do Node, fora do contexto do
    // onRequest, e o número não pode se perder.
    const endereco = await app.listen({ port: 0, host: "127.0.0.1" });
    const r = await fetch(`${endereco}/mensagem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "marca uma reunião ".repeat(2000) }),
    });
    const numero = r.headers.get("x-rastreio");
    await app.close();
    expect(levado.rastreio).toBe(numero);
    // A fila roda o trabalho depois, fora do pedido.
    expect(rastreioAtual()).toBeNull();
    const visto = await continuarRastreio(levado, "agentes-internos", async (n) => {
      app.log.info({ evento: "agente.rodou", texto: "o pedido da pessoa" }, "Agente rodou");
      // E um trabalho que nasce deste leva o mesmo número.
      return { n, filho: levarRastreio().rastreio };
    });
    expect(visto).toEqual({ n: numero, filho: numero });
    const doTrabalho = linhas.find((l) => l.evento === "agente.rodou");
    expect(doTrabalho).toMatchObject({ rastreio: numero, texto: "[retirado]" });
  });

  it("o trabalho sem origem (a verificação a cada minuto) ganha um número novo; o erro não perde o número", async () => {
    const a = await continuarRastreio(null, "rotinas", async (n) => n);
    const b = await continuarRastreio(undefined, "rotinas", async (n) => n);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    await expect(
      continuarRastreio({ rastreio: "f".repeat(32) }, "x", async () => {
        throw new Error("falhou");
      }),
    ).rejects.toThrow("falhou");
  });

  it("o contexto do OpenTelemetry vindo do pedido vira o pai do trabalho (mesmo número)", async () => {
    const pai = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
    const n = await continuarRastreio({ traceparent: pai }, "telegram", async (x) => x);
    expect(n).toBe("a".repeat(32));
  });
});
