import { describe, expect, it } from "vitest";
import { tipoDoAgente } from "./agentes.ts";

describe("tipoDoAgente", () => {
  it("diz se é externo, coordenador ou especialista", () => {
    expect(tipoDoAgente({ tipo: "externo", papel: null, especialidade: null })).toBe("Externo");
    expect(tipoDoAgente({ tipo: "interno", papel: "coordenador", especialidade: null })).toBe("Coordenador");
    expect(
      tipoDoAgente(
        { tipo: "interno", papel: "especialista", especialidade: "gerente_de_projetos" },
        "Coordenador",
      ),
    ).toBe("Especialista · Gerente de projetos · responde a Coordenador");
    expect(
      tipoDoAgente({ tipo: "interno", papel: "especialista", especialidade: "gerente_de_projetos" }),
    ).toBe("Especialista · Gerente de projetos");
  });
});
