import { describe, expect, it } from "vitest";
import { conferirPedidoDeDadosDaEmpresa } from "./empresa.ts";

describe("dados da empresa (M3-11)", () => {
  it("seguem as regras do cadastro: tipo e documento juntos, conferidos pelos dígitos", () => {
    const base = {
      nome: "Nolask",
      tipo: null,
      documento: null,
      nomeLegal: null,
      fusoHorario: "Europe/Lisbon",
      idioma: "pt-BR",
      telefone: null,
    };
    expect(conferirPedidoDeDadosDaEmpresa(base).ok).toBe(true);
    expect(conferirPedidoDeDadosDaEmpresa({ ...base, tipo: "pf" }).ok).toBe(false);
    expect(conferirPedidoDeDadosDaEmpresa({ ...base, tipo: "pf", documento: "12345678900" }).ok).toBe(false);
  });
});
