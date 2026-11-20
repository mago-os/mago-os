import { describe, expect, it } from "vitest";
import {
  comReserva,
  enderecoPermitido,
  enderecoSeguro,
  modelosDaResposta,
  provedoresFalsos,
} from "./provedores.ts";

const CONTA = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OUTRA = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const principal = { contaId: CONTA, modelo: "claude-sonnet-5-5" };
const reserva = { contaId: OUTRA, modelo: "deepseek-chat" };

describe("provedores", () => {
  it("fora do Mac, recusa endereço da rede interna ou da própria máquina", () => {
    expect(enderecoPermitido("https://openrouter.ai/api/v1", "teste")).toBe(true);
    expect(enderecoPermitido("http://localhost:11434/v1", "local")).toBe(true);
    for (const ruim of [
      "http://localhost:11434/v1",
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.5/v1",
      "https://192.168.1.10/v1",
      "https://172.20.0.1/v1",
      "https://169.254.169.254/latest",
      "https://[::1]/v1",
      "https://usuario:senha@exemplo.com/v1",
      "https://exemplo.com/v1?x=1",
    ])
      expect(enderecoPermitido(ruim, "producao"), ruim).toBe(false);
  });

  it("fora do Mac, resolve o nome e recusa quando ele aponta para dentro", async () => {
    const dns = (mapa: Record<string, string[]>) => async (h: string) => mapa[h] ?? [];
    const resolver = dns({
      "openrouter.ai": ["104.18.2.115"],
      "127.0.0.1.nip.io": ["127.0.0.1"],
      "misto.example": ["104.18.2.115", "10.0.0.7"],
      "metadados.example": ["169.254.169.254"],
      "v6.example": ["fd00::1"],
    });
    expect(await enderecoSeguro("https://openrouter.ai/api/v1", "producao", resolver)).toBe(true);
    for (const host of [
      "127.0.0.1.nip.io",
      "misto.example",
      "metadados.example",
      "v6.example",
      "nao-existe.example",
    ])
      expect(await enderecoSeguro(`https://${host}/v1`, "producao", resolver), host).toBe(false);
    expect(await enderecoSeguro("http://localhost:11434/v1", "local", resolver)).toBe(true);
  });

  it("lê os modelos da resposta e ignora nomes estranhos", () => {
    expect(
      modelosDaResposta({
        data: [{ id: "claude-sonnet-5-5" }, { id: "<script>" }, { id: 3 }, { id: "claude-sonnet-5-5" }],
      }),
    ).toEqual(["claude-sonnet-5-5"]);
    expect(modelosDaResposta({ erro: "x" })).toEqual([]);
  });

  it("o provedor falso aceita só as chaves dele", async () => {
    const p = provedoresFalsos({ "sk-boa-123456": ["m1", "m2"] });
    expect(await p.testar({ provedor: "anthropic", endereco: null, chave: "sk-boa-123456" })).toEqual({
      ok: true,
      modelos: ["m1", "m2"],
    });
    expect((await p.testar({ provedor: "anthropic", endereco: null, chave: "sk-ruim-12345" })).ok).toBe(
      false,
    );
  });
});

describe("modelo reserva", () => {
  it("usa o principal quando ele está bem", async () => {
    const r = await comReserva(
      { principal, reserva },
      async () => null,
      async (m) => m.modelo,
    );
    expect(r).toEqual({ resultado: "claude-sonnet-5-5", usado: principal, passouAoReservaPorque: null });
  });

  it("passa ao reserva quando o principal falha, sem parar", async () => {
    const r = await comReserva(
      { principal, reserva },
      async () => null,
      async (m) => {
        if (m === principal) throw new Error("provedor fora do ar");
        return m.modelo;
      },
    );
    expect(r.usado).toEqual(reserva);
    expect(r.passouAoReservaPorque).toBe("provedor fora do ar");
  });

  it("passa ao reserva quando a conta do principal chegou no teto, sem chamar o principal", async () => {
    const chamados: string[] = [];
    const r = await comReserva(
      { principal, reserva },
      async (m) => (m.contaId === CONTA ? "a conta chegou no teto" : null),
      async (m) => {
        chamados.push(m.modelo);
        return m.modelo;
      },
    );
    expect(chamados).toEqual(["deepseek-chat"]);
    expect(r.passouAoReservaPorque).toBe("a conta chegou no teto");
  });

  it("sem reserva, o erro do principal sobe", async () => {
    await expect(
      comReserva(
        { principal, reserva: null },
        async () => "conta com erro",
        async () => "x",
      ),
    ).rejects.toThrow("conta com erro");
  });
});
