import { describe, expect, it } from "vitest";
import { conferirAjusteDePermissao, conferirDeclaracaoDeModulo } from "./permissoes.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("permissões", () => {
  it("aceita um ajuste válido e recusa ação ou alcance desconhecidos", () => {
    const ajuste = {
      vinculoId: ID,
      modulo: "crm",
      acao: "ver",
      alcance: "equipe",
      feitoPor: ID,
      feitoEm: "2026-11-17T13:00:00Z",
    };
    expect(conferirAjusteDePermissao(ajuste).ok).toBe(true);
    expect(conferirAjusteDePermissao({ ...ajuste, acao: "apagar" }).ok).toBe(false);
    expect(conferirAjusteDePermissao({ ...ajuste, alcance: "alguns" }).ok).toBe(false);
  });

  it("dados sensíveis são tudo ou nada", () => {
    const base = {
      vinculoId: ID,
      modulo: "rh",
      acao: "ver_sensiveis",
      feitoPor: ID,
      feitoEm: "2026-11-17T13:00:00Z",
    };
    expect(conferirAjusteDePermissao({ ...base, alcance: "tudo" }).ok).toBe(true);
    expect(conferirAjusteDePermissao({ ...base, alcance: "equipe" }).ok).toBe(false);
  });

  it("declaração de módulo: com área ou do núcleo", () => {
    const crm = {
      id: "crm",
      nome: "CRM",
      acoes: ["ver", "criar"],
      temDadosSensiveis: false,
      area: "comercial",
    };
    expect(conferirDeclaracaoDeModulo(crm).ok).toBe(true);
    expect(conferirDeclaracaoDeModulo({ ...crm, area: null }).ok).toBe(true);
    expect(conferirDeclaracaoDeModulo({ ...crm, acoes: [] }).ok).toBe(false);
    expect(conferirDeclaracaoDeModulo({ ...crm, acoes: ["ver", "ver"] }).ok).toBe(false);
  });
});
