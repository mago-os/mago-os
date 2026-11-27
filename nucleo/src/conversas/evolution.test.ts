import { describe, expect, it } from "vitest";
import { daInstancia, nomeDaInstancia } from "./canais.ts";
import { CABECALHO_DO_SEGREDO, criarClienteDaEvolution, ErroDaEvolution, numeroDoJid } from "./evolution.ts";

const E = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const C = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

function buscaFalsa(respostas: Record<string, unknown>) {
  const pedidos: { url: string; metodo: string; cabecalhos: Record<string, string>; corpo: unknown }[] = [];
  const buscar = (async (url: string, init: RequestInit) => {
    pedidos.push({
      url,
      metodo: init.method ?? "GET",
      cabecalhos: init.headers as Record<string, string>,
      corpo: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const chave = Object.keys(respostas).find((k) => url.includes(k));
    if (!chave) return new Response("nao", { status: 404 });
    return new Response(JSON.stringify(respostas[chave]), { status: 200 });
  }) as typeof fetch;
  return { pedidos, buscar };
}

const CONFIG = {
  url: "http://evolution:8080/",
  chave: "chave-global-de-teste-123",
  segredo: "s".repeat(40),
  urlDosAvisos: "http://mago-nucleo:3000/interno/evolution/avisos",
};

describe("cliente da Evolution", () => {
  it("cria a instância com a chave, sem grupos, e com o endereço e o segredo dos avisos", async () => {
    const { pedidos, buscar } = buscaFalsa({ "/instance/create": { instance: {} } });
    await criarClienteDaEvolution(CONFIG, buscar).criarInstancia("x_y");
    const p = pedidos[0];
    expect(p?.url).toBe("http://evolution:8080/instance/create");
    expect(p?.cabecalhos.apikey).toBe(CONFIG.chave);
    expect(p?.corpo).toMatchObject({
      instanceName: "x_y",
      integration: "WHATSAPP-BAILEYS",
      groupsIgnore: true,
      webhook: { url: CONFIG.urlDosAvisos, headers: { [CABECALHO_DO_SEGREDO]: CONFIG.segredo } },
    });
  });

  it("lê o QR, a situação e o número conectado", async () => {
    const { buscar } = buscaFalsa({
      "/instance/connect/": { base64: "data:image/png;base64,AAAA", code: "x" },
      "/instance/connectionState/": { instance: { instanceName: "x", state: "open" } },
      "/instance/fetchInstances": [{ ownerJid: "5511912340000@s.whatsapp.net" }],
    });
    const cliente = criarClienteDaEvolution(CONFIG, buscar);
    expect(await cliente.pedirQr("x")).toBe("data:image/png;base64,AAAA");
    expect(await cliente.situacao("x")).toEqual({ estado: "open", numero: "+5511912340000" });
  });

  it("resposta de erro vira ErroDaEvolution, sem a chave na mensagem", async () => {
    const { buscar } = buscaFalsa({});
    const erro = await criarClienteDaEvolution(CONFIG, buscar)
      .situacao("x")
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDaEvolution);
    expect(String((erro as Error).message)).not.toContain(CONFIG.chave);
  });

  it("o número do jid e o nome da instância", () => {
    expect(numeroDoJid("5511912340000:12@s.whatsapp.net")).toBe("+5511912340000");
    expect(numeroDoJid(42)).toBeNull();
    expect(daInstancia(nomeDaInstancia(E, C))).toEqual({ empresaId: E, canalId: C });
    expect(daInstancia("qualquer")).toBeNull();
    expect(daInstancia(`${E}_${C}_x`)).toBeNull();
  });
});
