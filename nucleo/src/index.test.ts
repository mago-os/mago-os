import { describe, expect, it } from "vitest";
import { sobreOSistema } from "./index.ts";

describe("núcleo", () => {
  it("diz o nome do sistema e a versão dos contratos", () => {
    expect(sobreOSistema()).toEqual({ nome: "Mago OS", versaoContratos: 1 });
  });
});
