import { describe, expect, it } from "vitest";
import { conferirAgente } from "../agentes/agente.ts";
import { conferirComentarioDeTarefa, conferirPedidoDeMudarStatus, conferirTarefa } from "./tarefa.ts";

const ID = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const ID2 = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const AGORA = "2026-11-18T20:00:00Z";

const tarefa = {
  id: ID,
  empresaId: ID2,
  titulo: "Verificar backup da VPS01",
  descricao: null,
  projetoId: null,
  listaId: null,
  statusDoProjetoId: null,
  tarefaMaeId: null,
  prioridade: null,
  prazo: null,
  inicio: null,
  etiquetas: [],
  recorrencia: null,
  ocorrencia: 1,
  recorrenteDeId: null,
  status: "a_fazer",
  responsavel: { tipo: "agente", agenteId: ID },
  criadaPor: { tipo: "pessoa", pessoaId: ID },
  trava: null,
  resultado: null,
  resultadoPor: null,
  criadaEm: AGORA,
  atualizadaEm: AGORA,
  encerradaEm: null,
};

describe("tarefa", () => {
  it("aceita uma tarefa a fazer, sem responsável ou com pessoa ou agente", () => {
    expect(conferirTarefa(tarefa).ok).toBe(true);
    expect(conferirTarefa({ ...tarefa, responsavel: null }).ok).toBe(true);
    expect(conferirTarefa({ ...tarefa, responsavel: { tipo: "pessoa", pessoaId: ID } }).ok).toBe(true);
  });

  it("recusa status desconhecido, título vazio e campo a mais", () => {
    expect(conferirTarefa({ ...tarefa, status: "pausada" }).ok).toBe(false);
    expect(conferirTarefa({ ...tarefa, titulo: "  " }).ok).toBe(false);
    expect(conferirTarefa({ ...tarefa, prazo: AGORA }).ok).toBe(false);
  });

  it("travada só em andamento ou precisando de ajuda", () => {
    const trava = { por: { tipo: "agente", agenteId: ID }, desde: AGORA };
    expect(conferirTarefa({ ...tarefa, status: "em_andamento", trava }).ok).toBe(true);
    expect(conferirTarefa({ ...tarefa, status: "precisa_de_ajuda", trava }).ok).toBe(true);
    expect(conferirTarefa({ ...tarefa, trava }).ok).toBe(false);
    expect(conferirTarefa({ ...tarefa, status: "concluida", encerradaEm: AGORA, trava }).ok).toBe(false);
  });

  it("concluída tem data de encerramento, e o resultado diz quem entregou", () => {
    const concluida = {
      ...tarefa,
      status: "concluida",
      encerradaEm: AGORA,
      resultado: "Backup em dia, 40% do disco livre.",
      resultadoPor: { tipo: "agente", agenteId: ID },
    };
    expect(conferirTarefa(concluida).ok).toBe(true);
    expect(conferirTarefa({ ...concluida, encerradaEm: null }).ok).toBe(false);
    expect(conferirTarefa({ ...concluida, resultadoPor: null }).ok).toBe(false);
    expect(conferirTarefa({ ...concluida, resultadoPor: { tipo: "sistema" } }).ok).toBe(false);
    expect(conferirTarefa({ ...concluida, status: "cancelada" }).ok).toBe(false);
    expect(conferirTarefa({ ...tarefa, encerradaEm: AGORA }).ok).toBe(false);
  });

  it("pedido de mudar status só leva resultado ao concluir", () => {
    expect(conferirPedidoDeMudarStatus({ status: "concluida", resultado: "Feito." }).ok).toBe(true);
    expect(conferirPedidoDeMudarStatus({ status: "cancelada", motivo: "Não precisa mais." }).ok).toBe(true);
    expect(conferirPedidoDeMudarStatus({ status: "em_andamento", resultado: "x" }).ok).toBe(false);
  });

  it("comentário aceita pessoa, agente e sistema como autor", () => {
    const comentario = { id: ID, empresaId: ID2, tarefaId: ID, texto: "Comecei.", criadoEm: AGORA };
    expect(conferirComentarioDeTarefa({ ...comentario, autor: { tipo: "agente", agenteId: ID } }).ok).toBe(
      true,
    );
    expect(conferirComentarioDeTarefa({ ...comentario, autor: { tipo: "sistema" } }).ok).toBe(true);
    expect(conferirComentarioDeTarefa({ ...comentario, autor: { tipo: "robo" } }).ok).toBe(false);
  });
});

describe("agente", () => {
  const agente = {
    id: ID,
    empresaId: ID2,
    nome: "Claude no Mac",
    descricao: null,
    tipo: "externo",
    ondeRoda: "Mac do Sandro",
    responsavelId: ID,
    situacao: "ativo",
    minutosSemSinal: 15,
    ultimoSinalEm: null,
    criadoEm: AGORA,
    atualizadoEm: AGORA,
    desligadoEm: null,
  };

  it("aceita agente ativo e pausado, e desligado com a data", () => {
    expect(conferirAgente(agente).ok).toBe(true);
    expect(conferirAgente({ ...agente, situacao: "pausado" }).ok).toBe(true);
    expect(conferirAgente({ ...agente, situacao: "desligado", desligadoEm: AGORA }).ok).toBe(true);
  });

  it("recusa desligado sem data, tipo interno, sem responsável e tempo sem sinal fora do limite", () => {
    expect(conferirAgente({ ...agente, situacao: "desligado" }).ok).toBe(false);
    expect(conferirAgente({ ...agente, desligadoEm: AGORA }).ok).toBe(false);
    expect(conferirAgente({ ...agente, tipo: "interno" }).ok).toBe(false);
    const { responsavelId: _r, ...semResponsavel } = agente;
    expect(conferirAgente(semResponsavel).ok).toBe(false);
    expect(conferirAgente({ ...agente, minutosSemSinal: 1 }).ok).toBe(false);
  });
});
