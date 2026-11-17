import type { DeclaracaoDeModulo } from "@mago-os/contratos";
import { describe, expect, it } from "vitest";
import { filtroDoAlcance, permissaoNoModulo } from "./calcular.ts";
import { catalogoDeModulos } from "./modulos.ts";

const CRM: DeclaracaoDeModulo = {
  id: "crm",
  nome: "CRM",
  acoes: ["ver", "criar", "editar", "aprovar", "excluir"],
  temDadosSensiveis: true,
  area: "comercial",
};
const PESSOAS = catalogoDeModulos().get("pessoas") as DeclaracaoDeModulo;

describe("cálculo das permissões", () => {
  it("administrador: tudo, inclusive dados sensíveis, e ajustes não o limitam", () => {
    const p = permissaoNoModulo({ perfil: "administrador", area: null }, CRM, [
      { modulo: "crm", acao: "excluir", alcance: "nada" },
    ]);
    expect(p.acoes).toEqual({ ver: "tudo", criar: "tudo", editar: "tudo", aprovar: "tudo", excluir: "tudo" });
    expect(p.verSensiveis).toBe(true);
  });

  it("gestor: tudo da equipe na área dele, nada nas outras", () => {
    const naArea = permissaoNoModulo({ perfil: "gestor_area", area: "comercial" }, CRM, []);
    expect(naArea.acoes).toEqual({
      ver: "equipe",
      criar: "equipe",
      editar: "equipe",
      aprovar: "equipe",
      excluir: "equipe",
    });
    expect(naArea.verSensiveis).toBe(false);
    const fora = permissaoNoModulo({ perfil: "gestor_area", area: "financeiro" }, CRM, []);
    expect(Object.values(fora.acoes).every((a) => a === "nada")).toBe(true);
  });

  it("funcionário: ver, criar e editar só os próprios itens na área dele; aprovar e excluir, não", () => {
    const p = permissaoNoModulo({ perfil: "funcionario", area: "comercial" }, CRM, []);
    expect(p.acoes).toEqual({ ver: "meus", criar: "meus", editar: "meus", aprovar: "nada", excluir: "nada" });
    const semArea = permissaoNoModulo({ perfil: "funcionario", area: null }, CRM, []);
    expect(semArea.acoes.ver).toBe("nada");
  });

  it("ajustes do administrador sobem ou descem uma ação e liberam dados sensíveis", () => {
    const p = permissaoNoModulo({ perfil: "funcionario", area: "comercial" }, CRM, [
      { modulo: "crm", acao: "ver", alcance: "equipe" },
      { modulo: "crm", acao: "editar", alcance: "nada" },
      { modulo: "crm", acao: "ver_sensiveis", alcance: "tudo" },
      { modulo: "financeiro", acao: "ver", alcance: "tudo" },
    ]);
    expect(p.acoes).toMatchObject({ ver: "equipe", editar: "nada", criar: "meus" });
    expect(p.verSensiveis).toBe(true);
  });

  it("ajuste de ação que o módulo não declara é ignorado", () => {
    const p = permissaoNoModulo({ perfil: "funcionario", area: null }, PESSOAS, [
      { modulo: "pessoas", acao: "aprovar", alcance: "tudo" },
    ]);
    expect(p.acoes.aprovar).toBe("nada");
    expect(p.acoes.ver).toBe("meus");
  });

  it("alcance vira filtro: equipe sem área vira só os meus", () => {
    expect(filtroDoAlcance("nada", "p", "comercial")).toBeNull();
    expect(filtroDoAlcance("tudo", "p", null)).toEqual({ tipo: "tudo" });
    expect(filtroDoAlcance("equipe", "p", "comercial")).toEqual({
      tipo: "equipe",
      area: "comercial",
      pessoaId: "p",
    });
    expect(filtroDoAlcance("equipe", "p", null)).toEqual({ tipo: "meus", pessoaId: "p" });
  });

  it("o catálogo recusa módulo fora do contrato ou repetido", () => {
    expect(() => catalogoDeModulos([{ ...CRM, id: "CRM!" }])).toThrow(/fora do contrato/);
    expect(() => catalogoDeModulos([CRM, CRM])).toThrow(/repetido/);
  });
});
