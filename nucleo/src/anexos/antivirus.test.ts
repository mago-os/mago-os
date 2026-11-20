import { describe, expect, it } from "vitest";
import { antivirusDeTeste, criarClamav } from "./antivirus.ts";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe("antivírus de teste (só no Mac e nos testes)", () => {
  it("bloqueia o EICAR e libera o resto", async () => {
    expect(await antivirusDeTeste.conferir(Buffer.from(EICAR))).toEqual({
      limpo: false,
      achado: "Eicar-Test-Signature",
    });
    expect(await antivirusDeTeste.conferir(Buffer.from("um PDF qualquer"))).toEqual({ limpo: true });
  });
});

// Com um ClamAV de verdade (ex.: MAGO_TESTE_CLAMAV=127.0.0.1:3310, do container clamav/clamav), confere o protocolo.
const endereco = process.env.MAGO_TESTE_CLAMAV;
describe.skipIf(!endereco)("ClamAV de verdade", () => {
  it("acha o EICAR e libera um arquivo limpo, inclusive grande", async () => {
    const clamav = criarClamav(endereco as string);
    const achou = await clamav.conferir(Buffer.from(EICAR));
    expect(achou.limpo).toBe(false);
    expect(await clamav.conferir(Buffer.alloc(3 * 1024 * 1024, "a"))).toEqual({ limpo: true });
  });
});
