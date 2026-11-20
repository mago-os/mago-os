import { describe, expect, it } from "vitest";
import { comReserva, enderecoPermitido, modelosDaResposta, provedoresFalsos } from "./provedores.ts";

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
