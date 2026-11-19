import { describe, expect, it } from "vitest";
import { conferirAviso, conferirChaveDeAgente, FORMATO_DA_CHAVE } from "./chave.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const AGORA = "2026-11-18T20:00:00Z";

const chave = {
  id: ID,
  empresaId: ID,
  agenteId: ID,
  nome: "Mac do Sandro",
  prefixo: "mago_ag_k3x9p2m7qa",
  criadaPor: ID,
  criadaEm: AGORA,
  validaAte: null,
  ultimoUsoEm: null,
  revogadaEm: null,
  revogadaPor: null,
};

describe("chave do agente", () => {
  it("reconhece o formato da chave inteira", () => {
    expect(FORMATO_DA_CHAVE.test(`mago_ag_k3x9p2m7qa_${"A".repeat(43)}`)).toBe(true);
    expect(FORMATO_DA_CHAVE.test(`mago_ag_k3x9p2m7qa_${"A".repeat(42)}`)).toBe(false);
    expect(FORMATO_DA_CHAVE.test(`outra_k3x9p2m7qa_${"A".repeat(43)}`)).toBe(false);
  });

  it("aceita a chave sem o segredo, e recusa revogada sem quem revogou ou validade antes da criação", () => {
    expect(conferirChaveDeAgente(chave).ok).toBe(true);
    expect(conferirChaveDeAgente({ ...chave, segredo: "x" }).ok).toBe(false);
    expect(conferirChaveDeAgente({ ...chave, revogadaEm: AGORA }).ok).toBe(false);
    expect(conferirChaveDeAgente({ ...chave, revogadaEm: AGORA, revogadaPor: ID }).ok).toBe(true);
    expect(conferirChaveDeAgente({ ...chave, validaAte: "2026-11-01T00:00:00Z" }).ok).toBe(false);
    expect(conferirChaveDeAgente({ ...chave, prefixo: "mago_ag_CURTO" }).ok).toBe(false);
  });

  it("aviso só abre telas do próprio Mago OS", () => {
    const aviso = {
      id: ID,
      empresaId: ID,
      pessoaId: ID,
      tipo: "agente_sem_sinal",
      texto: "O agente Claude no Mac ficou sem sinal.",
      link: `/agentes/${ID}`,
      criadoEm: AGORA,
      lidoEm: null,
    };
    expect(conferirAviso(aviso).ok).toBe(true);
    expect(conferirAviso({ ...aviso, link: "https://golpe.example" }).ok).toBe(false);
  });
});
