import { describe, expect, it } from "vitest";
import {
  conferirExecucaoDeRotina,
  conferirPedidoDeEdicaoDeRotina,
  conferirPedidoDeRotina,
  conferirRotina,
  type PedidoDeRotina,
} from "./rotinas.ts";

const ID = "00000000-0000-7000-8000-000000000001";
const AGORA = "2026-11-23T08:00:00Z";

const pedido: PedidoDeRotina = {
  nome: "Resumo das atrasadas na segunda",
  gatilho: {
    tipo: "horario",
    regra: { frequencia: "semanal", intervalo: 1, diasDaSemana: [1] },
    horas: ["08:00"],
    fuso: "America/Sao_Paulo",
    inicio: "2026-11-23",
  },
  acao: {
    tipo: "pedir_ao_agente",
    agenteId: ID,
    pedido: "Resuma as tarefas atrasadas da empresa e me mande.",
    resultado: "mensagem",
  },
};

const rotina = {
  id: ID,
  empresaId: ID,
  ...pedido,
  donoPessoaId: ID,
  criadaPorAgenteId: null,
  situacao: "desligada",
  desligadaPorque: "pessoa",
  tetoMensal: null,
  proximaEm: null,
  vezes: 0,
  criadaEm: AGORA,
  atualizadaEm: AGORA,
};

describe("rotinas", () => {
  it("aceita as três ações", () => {
    expect(conferirPedidoDeRotina(pedido).ok).toBe(true);
    const tarefa = {
      ...pedido,
      acao: {
        tipo: "criar_tarefa",
        titulo: "Enviar o relatório",
        responsavel: { tipo: "pessoa", pessoaId: ID },
        prazo: { emDias: 2, hora: "18:00" },
      },
    };
    expect(conferirPedidoDeRotina(tarefa).ok).toBe(true);
    const aviso = {
      ...pedido,
      acao: { tipo: "mandar_aviso", para: [ID], texto: "Hoje tem reunião às 10h." },
    };
    expect(conferirPedidoDeRotina(aviso).ok).toBe(true);
    expect(conferirPedidoDeRotina({ ...pedido, acao: { tipo: "mandar_email", para: "a@b.c" } }).ok).toBe(
      false,
    );
  });

  it("os horários: de 1 a 24, sem repetir, no formato HH:MM", () => {
    const comHoras = (horas: string[]) => ({ ...pedido, gatilho: { ...pedido.gatilho, horas } });
    expect(conferirPedidoDeRotina(comHoras([])).ok).toBe(false);
    expect(conferirPedidoDeRotina(comHoras(["08:00", "08:00"])).ok).toBe(false);
    expect(conferirPedidoDeRotina(comHoras(["8h"])).ok).toBe(false);
    const todas = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
    expect(conferirPedidoDeRotina(comHoras(todas)).ok).toBe(true);
    expect(conferirPedidoDeRotina(comHoras([...todas, "23:30"])).ok).toBe(false);
  });

  it("a regra segue a da recorrência e a data final vem depois do início", () => {
    const comRegra = (regra: object) => ({ ...pedido, gatilho: { ...pedido.gatilho, regra } });
    expect(
      conferirPedidoDeRotina(comRegra({ frequencia: "diaria", intervalo: 1, diasDaSemana: [1] })).ok,
    ).toBe(false);
    expect(conferirPedidoDeRotina(comRegra({ frequencia: "mensal", intervalo: 1, diaDoMes: 31 })).ok).toBe(
      true,
    );
    expect(
      conferirPedidoDeRotina(comRegra({ frequencia: "diaria", intervalo: 1, ate: "2026-11-01" })).ok,
    ).toBe(false);
    expect(conferirPedidoDeRotina(comRegra({ frequencia: "diaria", intervalo: 1, vezes: 10 })).ok).toBe(true);
  });

  it("só a rotina desligada diz por quê e não tem próxima vez", () => {
    expect(conferirRotina(rotina).ok).toBe(true);
    expect(conferirRotina({ ...rotina, desligadaPorque: null }).ok).toBe(false);
    expect(
      conferirRotina({ ...rotina, situacao: "ligada", desligadaPorque: null, proximaEm: AGORA }).ok,
    ).toBe(true);
    expect(conferirRotina({ ...rotina, situacao: "ligada", proximaEm: AGORA }).ok).toBe(false);
    expect(conferirRotina({ ...rotina, proximaEm: AGORA }).ok).toBe(false);
  });

  it("editar pede ao menos um campo e confere o gatilho", () => {
    expect(conferirPedidoDeEdicaoDeRotina({}).ok).toBe(false);
    expect(conferirPedidoDeEdicaoDeRotina({ nome: "Outro nome" }).ok).toBe(true);
    expect(
      conferirPedidoDeEdicaoDeRotina({
        gatilho: { ...pedido.gatilho, regra: { frequencia: "semanal", intervalo: 1, diaDoMes: 3 } },
      }).ok,
    ).toBe(false);
  });

  it("execução: só a terminada tem a hora do fim, e só a do horário tem a hora marcada", () => {
    const execucao = {
      id: ID,
      empresaId: ID,
      rotinaId: ID,
      origem: "horario",
      previstaPara: AGORA,
      tarefaDoEventoId: null,
      evento: null,
      situacao: "feita",
      tentativa: 1,
      proximaTentativaEm: null,
      motivo: null,
      tarefaId: null,
      execucaoDeAgenteId: ID,
      conversaId: ID,
      avisados: 0,
      custo: 3.5,
      criadaEm: AGORA,
      iniciadaEm: AGORA,
      terminadaEm: AGORA,
    };
    expect(conferirExecucaoDeRotina(execucao).ok).toBe(true);
    expect(conferirExecucaoDeRotina({ ...execucao, terminadaEm: null }).ok).toBe(false);
    expect(conferirExecucaoDeRotina({ ...execucao, origem: "rodar_agora" }).ok).toBe(false);
    expect(conferirExecucaoDeRotina({ ...execucao, origem: "rodar_agora", previstaPara: null }).ok).toBe(
      true,
    );
    expect(conferirExecucaoDeRotina({ ...execucao, tentativa: 4 }).ok).toBe(false);
    const porEvento = { ...execucao, origem: "evento", previstaPara: null, evento: "tarefa_concluida" };
    expect(conferirExecucaoDeRotina({ ...porEvento, tarefaDoEventoId: ID }).ok).toBe(true);
    expect(conferirExecucaoDeRotina(porEvento).ok).toBe(true);
    expect(conferirExecucaoDeRotina({ ...porEvento, evento: null }).ok).toBe(false);
  });

  it("gatilho por evento, com filtros simples; subtarefa da que disparou só nele", () => {
    const porEvento = {
      ...pedido,
      gatilho: { tipo: "evento", evento: "tarefa_concluida", filtros: { projetoId: ID, prioridade: "alta" } },
      acao: { tipo: "criar_tarefa", titulo: "Revisar: {tarefa}", comoSubtarefa: true },
    };
    expect(conferirPedidoDeRotina(porEvento).ok).toBe(true);
    expect(
      conferirPedidoDeRotina({ ...porEvento, gatilho: { ...porEvento.gatilho, evento: "tarefa_apagada" } })
        .ok,
    ).toBe(false);
    expect(
      conferirPedidoDeRotina({ ...porEvento, gatilho: { ...porEvento.gatilho, filtros: { texto: "livre" } } })
        .ok,
    ).toBe(false);
    expect(conferirPedidoDeRotina({ ...pedido, acao: porEvento.acao }).ok).toBe(false);
    expect(
      conferirRotina({ ...rotina, ...porEvento, situacao: "ligada", desligadaPorque: null, proximaEm: AGORA })
        .ok,
    ).toBe(false);
    expect(conferirRotina({ ...rotina, ...porEvento, situacao: "ligada", desligadaPorque: null }).ok).toBe(
      true,
    );
  });
});
