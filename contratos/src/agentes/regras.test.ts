import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { FERRAMENTAS_MCP } from "../mcp/ferramentas.ts";
import { FERRAMENTAS_INTERNAS } from "./internos.ts";
import {
  CATALOGO_DE_ACOES,
  conferirAprovacao,
  maisRestrito,
  PedidoDeDecisao,
  PedidoDeMudarRegras,
  padraoDaAcao,
} from "./regras.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const AGORA = "2026-11-21T00:00:00Z";
const DEPOIS = "2026-11-22T00:00:00Z";
const CONFERENCIA = "a".repeat(64);

describe("regras por ação", () => {
  it("toda ferramenta (interna ou do MCP) tem regra, e as do MCP têm padrão para os externos", () => {
    const noCatalogo = new Set(CATALOGO_DE_ACOES.map((a) => a.acao));
    for (const f of [...FERRAMENTAS_INTERNAS, ...FERRAMENTAS_MCP])
      expect(noCatalogo.has(f.nome), f.nome).toBe(true);
    for (const f of FERRAMENTAS_MCP) expect(padraoDaAcao(f.nome, "externo"), f.nome).not.toBeNull();
    expect(new Set(CATALOGO_DE_ACOES.map((a) => a.acao)).size).toBe(CATALOGO_DE_ACOES.length);
  });

  it("segue a decisão 6: ler executa, mexer só nas dele, atribuir pede aprovação; externos executam (decisão 7)", () => {
    expect(padraoDaAcao("ver_tarefa", "interno")).toBe("executa");
    expect(padraoDaAcao("mudar_status", "interno")).toBe("executa_nas_dele");
    expect(padraoDaAcao("atribuir", "interno")).toBe("pede_aprovacao");
    expect(padraoDaAcao("mudar_status", "externo")).toBe("executa");
    expect(padraoDaAcao("atribuir", "externo")).toBeNull();
    // O que só lê ou conversa nunca pede aprovação.
    for (const a of CATALOGO_DE_ACOES.filter((x) => !x.mudaDados))
      expect(a.padraoInterno, a.acao).toBe("executa");
  });

  it("o responsável só deixa mais restrito", () => {
    expect(maisRestrito("executa", "pede_aprovacao")).toBe(true);
    expect(maisRestrito("pede_aprovacao", "executa")).toBe(false);
    expect(maisRestrito("bloqueado", "bloqueado")).toBe(true);
    expect(conferir(PedidoDeMudarRegras, { regras: [{ acao: "atribuir", modo: null }] }).ok).toBe(true);
    expect(conferir(PedidoDeMudarRegras, { regras: [{ acao: "atribuir", modo: "talvez" }] }).ok).toBe(false);
  });
});

describe("aprovações", () => {
  const aprovacao = {
    id: ID,
    empresaId: ID,
    agenteId: ID,
    execucaoId: ID,
    pedidoPor: ID,
    acao: "atribuir",
    tarefaId: ID,
    parametros: { tarefaId: ID, responsavel: { tipo: "pessoa", pessoaId: ID } },
    resumo: "Atribuir “Exportar os posts” a Ana",
    motivo: "Ana cuida do blog.",
    conferencia: CONFERENCIA,
    situacao: "pendente",
    decididaPor: null,
    decididaEm: null,
    observacao: null,
    editada: false,
    criadaEm: AGORA,
    venceEm: DEPOIS,
  };

  it("quem decidiu e quando batem com a situação", () => {
    expect(conferirAprovacao(aprovacao).ok).toBe(true);
    expect(conferirAprovacao({ ...aprovacao, situacao: "aprovada" }).ok).toBe(false);
    expect(
      conferirAprovacao({ ...aprovacao, situacao: "aprovada", decididaPor: ID, decididaEm: AGORA }).ok,
    ).toBe(true);
    expect(conferirAprovacao({ ...aprovacao, situacao: "vencida", decididaEm: DEPOIS }).ok).toBe(true);
    expect(
      conferirAprovacao({ ...aprovacao, situacao: "recusada", decididaPor: ID, decididaEm: AGORA }).ok,
    ).toBe(false);
    expect(conferirAprovacao({ ...aprovacao, venceEm: AGORA }).ok).toBe(false);
  });

  it("a decisão leva a conferência; recusar exige motivo", () => {
    expect(conferir(PedidoDeDecisao, { decisao: "aprovar", conferencia: CONFERENCIA }).ok).toBe(true);
    expect(conferir(PedidoDeDecisao, { decisao: "aprovar" }).ok).toBe(false);
    expect(conferir(PedidoDeDecisao, { decisao: "recusar", conferencia: CONFERENCIA }).ok).toBe(false);
    expect(
      conferir(PedidoDeDecisao, {
        decisao: "recusar",
        conferencia: CONFERENCIA,
        motivo: "A Ana está de férias.",
      }).ok,
    ).toBe(true);
  });
});
