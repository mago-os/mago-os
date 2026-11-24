import { describe, expect, it } from "vitest";
import { conferirErroDoSistema, ouvirErrosDoSistema } from "./erros.ts";

const resposta = (status: number, rastreio?: string) =>
  new Response(null, { status, headers: rastreio ? { "x-rastreio": rastreio } : {} });

describe("erro do sistema com o número de rastreio (M6-02)", () => {
  it("o erro do lado da API (5xx) avisa com o número; o erro do pedido (4xx) não", () => {
    const vistos: (string | null)[] = [];
    const parar = ouvirErrosDoSistema((r) => vistos.push(r));
    conferirErroDoSistema(resposta(500, "a".repeat(32)));
    conferirErroDoSistema(resposta(400, "b".repeat(32)));
    conferirErroDoSistema(resposta(503));
    conferirErroDoSistema(resposta(502, "não é um número"));
    parar();
    conferirErroDoSistema(resposta(500, "c".repeat(32)));
    expect(vistos).toEqual(["a".repeat(32), null, null]);
  });
});
