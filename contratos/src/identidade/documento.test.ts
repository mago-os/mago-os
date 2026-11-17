import { describe, expect, it } from "vitest";
import {
  cnpjValido,
  cpfValido,
  formatarDocumento,
  mascararDocumento,
  normalizarDocumento,
} from "./documento.ts";
import { conferirPedidoDeNovaEmpresa } from "./empresa.ts";

describe("CPF e CNPJ", () => {
  it("confere o CPF pelos dígitos verificadores", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("5299822472")).toBe(false);
  });

  it("confere o CNPJ numérico e o novo, com letras", () => {
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    // Exemplo da Receita Federal para o CNPJ alfanumérico: 12.ABC.345/01DE-35.
    expect(cnpjValido("12ABC34501DE35")).toBe(true);
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
  });

  it("normaliza, formata e mascara", () => {
    expect(normalizarDocumento(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarDocumento("52998224725")).toBe("529.982.247-25");
    expect(mascararDocumento("52998224725")).toBe("***.982.247-**");
    expect(mascararDocumento("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("na conta nova, só o nome e o fuso são obrigatórios", () => {
    const minimo = {
      tipo: null,
      documento: null,
      nomeLegal: null,
      nome: "Maria",
      fusoHorario: "America/Sao_Paulo",
      idioma: "pt-BR",
      telefone: null,
    };
    expect(conferirPedidoDeNovaEmpresa(minimo).ok).toBe(true);
    expect(conferirPedidoDeNovaEmpresa({ ...minimo, nome: " " }).ok).toBe(false);
    expect(conferirPedidoDeNovaEmpresa({ ...minimo, tipo: "pf" }).ok).toBe(false);
    expect(conferirPedidoDeNovaEmpresa({ ...minimo, documento: "52998224725" }).ok).toBe(false);
  });

  it("o pedido de nova conta confere o documento pelo tipo", () => {
    const base = {
      nomeLegal: "Maria da Silva",
      nome: "Maria",
      fusoHorario: "America/Sao_Paulo",
      idioma: "pt-BR",
      telefone: null,
    };
    expect(conferirPedidoDeNovaEmpresa({ ...base, tipo: "pf", documento: "52998224725" }).ok).toBe(true);
    expect(conferirPedidoDeNovaEmpresa({ ...base, tipo: "pj", documento: "52998224725" }).ok).toBe(false);
    expect(conferirPedidoDeNovaEmpresa({ ...base, tipo: "pf", documento: "52998224724" }).ok).toBe(false);
    expect(conferirPedidoDeNovaEmpresa({ ...base, tipo: "pj", documento: "11222333000181" }).ok).toBe(true);
    expect(
      conferirPedidoDeNovaEmpresa({
        ...base,
        tipo: "pj",
        documento: "11222333000181",
        telefone: "+55 11 91234-5678",
      }).ok,
    ).toBe(true);
    expect(
      conferirPedidoDeNovaEmpresa({ ...base, tipo: "pj", documento: "11222333000181", telefone: "abc" }).ok,
    ).toBe(false);
  });
});
