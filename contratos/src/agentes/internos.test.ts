/**
 * Agentes internos (M4-02): papel e hierarquia, execuções e as ferramentas, com a descrição congelada como no MCP.
 * Mudou nome, descrição, entrada ou papéis de uma ferramenta? O teste quebra, e a assinatura nova só entra no PR com
 * aprovação humana (o texto muda o que o agente faz).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { conferir } from "../comum.ts";
import { FERRAMENTAS_MCP } from "../mcp/ferramentas.ts";
import { conferirAgente } from "./agente.ts";
import {
  conferirExecucao,
  FERRAMENTAS_DO_MCP_NO_ESPECIALISTA,
  FERRAMENTAS_INTERNAS,
  PedidoDeMensagem,
} from "./internos.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OUTRO = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AGORA = "2026-11-20T18:00:00Z";

const ASSINATURAS: Record<string, string> = {
  ver_tarefa: "8f8e1c5de2161eef",
  comentar: "4d44efce1e4873a0",
  procurar_pessoa: "1cdd4de2d11c5aef",
  mudar_prazo: "213d977fe85b5ba6",
  mudar_projeto: "935355d66f972c80",
  acrescentar_checklist: "45dce69d0d81fcc4",
  minhas_prioridades: "d4cd7643c347fe59",
  buscar: "db6325fc6e668a65",
  listar_tarefas: "e18504f90d2cfd8c",
  procurar_projeto: "b35c4efb2935a448",
  arquivos_recebidos: "8ad42e9276210ff2",
  anexar_arquivo: "232554c1a0389e4d",
  pegar_skill: "dfed5bf9f13544f2",
  ver_custos: "ad0af9c1bceefbcb",
  criar_tarefa: "4e1e0e8b51056cfd",
  delegar: "c22f595c1a17e80c",
  perguntar: "1acac7eb1c4f04a5",
  responder: "b2bf67d03c8117e2",
  planejar: "0f54a54f9d2b823f",
  atribuir: "51fe08e0dac4ee14",
};

function assinatura(f: (typeof FERRAMENTAS_INTERNAS)[number]): string {
  const texto = JSON.stringify({
    nome: f.nome,
    descricao: f.descricao,
    entrada: f.entrada,
    papeis: f.papeis,
  });
  return createHash("sha256").update(texto).digest("hex").slice(0, 16);
}

const externo = {
  id: ID,
  empresaId: ID,
  nome: "Claude no Mac",
  descricao: null,
  tipo: "externo",
  ondeRoda: null,
  responsavelId: ID,
  papel: null,
  especialidade: null,
  respondeAId: null,
  situacao: "ativo",
  minutosSemSinal: 15,
  ultimoSinalEm: null,
  criadoEm: AGORA,
  atualizadoEm: AGORA,
  desligadoEm: null,
};

describe("agentes internos", () => {
  it("o externo não tem papel; o coordenador não responde a ninguém; o especialista tem área e coordenador", () => {
    expect(conferirAgente(externo).ok).toBe(true);
    expect(conferirAgente({ ...externo, papel: "coordenador" }).ok).toBe(false);
    const coordenador = { ...externo, tipo: "interno", nome: "Coordenador", papel: "coordenador" };
    expect(conferirAgente(coordenador).ok).toBe(true);
    expect(conferirAgente({ ...coordenador, respondeAId: OUTRO }).ok).toBe(false);
    expect(conferirAgente({ ...coordenador, papel: null }).ok).toBe(false);
    const especialista = {
      ...coordenador,
      id: OUTRO,
      nome: "Gerente de projetos",
      papel: "especialista",
      especialidade: "gerente_de_projetos",
      respondeAId: ID,
    };
    expect(conferirAgente(especialista).ok).toBe(true);
    expect(conferirAgente({ ...especialista, respondeAId: null }).ok).toBe(false);
    expect(conferirAgente({ ...especialista, respondeAId: OUTRO }).ok).toBe(false);
  });

  it("a execução diz de onde veio e tem as horas coerentes com a situação", () => {
    const execucao = {
      id: ID,
      empresaId: ID,
      agenteId: ID,
      pedidoPor: ID,
      origem: "conversa",
      conversaId: ID,
      tarefaId: null,
      execucaoMaeId: null,
      situacao: "rodando",
      leuTextoDeOutros: false,
      modeloUsado: { contaId: ID, modelo: "claude-sonnet-5-5" },
      passouAoReservaPorque: null,
      resumo: null,
      criadaEm: AGORA,
      iniciadaEm: AGORA,
      terminadaEm: null,
    };
    expect(conferirExecucao(execucao).ok).toBe(true);
    expect(conferirExecucao({ ...execucao, conversaId: null }).ok).toBe(false);
    expect(conferirExecucao({ ...execucao, origem: "delegacao", tarefaId: ID }).ok).toBe(false);
    expect(
      conferirExecucao({ ...execucao, origem: "delegacao", tarefaId: ID, execucaoMaeId: OUTRO }).ok,
    ).toBe(true);
    expect(conferirExecucao({ ...execucao, situacao: "concluida" }).ok).toBe(false);
    expect(conferirExecucao({ ...execucao, situacao: "concluida", terminadaEm: AGORA }).ok).toBe(true);
    expect(conferirExecucao({ ...execucao, situacao: "na_fila", iniciadaEm: null }).ok).toBe(true);
  });

  it("o pedido de mensagem tem texto e, se quiser, a conversa", () => {
    expect(conferir(PedidoDeMensagem, { texto: "planeja a migração do blog, prazo sexta" }).ok).toBe(true);
    expect(conferir(PedidoDeMensagem, { texto: "   " }).ok).toBe(false);
    expect(conferir(PedidoDeMensagem, { texto: "x".repeat(4001) }).ok).toBe(false);
  });

  it("descrições congeladas: a assinatura de cada ferramenta interna não mudou", () => {
    expect(Object.fromEntries(FERRAMENTAS_INTERNAS.map((f) => [f.nome, assinatura(f)]))).toEqual(ASSINATURAS);
  });

  it("as ferramentas do MCP que o especialista usa existem no MCP, e nenhum nome se repete", () => {
    const doMcp = new Set(FERRAMENTAS_MCP.map((f) => f.nome));
    for (const nome of FERRAMENTAS_DO_MCP_NO_ESPECIALISTA) expect(doMcp.has(nome), nome).toBe(true);
    const nomes = [...FERRAMENTAS_INTERNAS.map((f) => f.nome), ...FERRAMENTAS_DO_MCP_NO_ESPECIALISTA];
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
