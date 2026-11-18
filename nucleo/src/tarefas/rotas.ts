/**
 * Rotas das tarefas (M2-01), para a tela. Cada rota passa pela verificação central (módulo "tarefas"), e o
 * alcance que ela devolve decide quais tarefas a pessoa alcança: o funcionário, as que é responsável ou criou;
 * o gestor, também as da equipe; o administrador, todas. Cada mudança vira evento de auditoria (tarefa.*).
 */
import {
  type ACOES_TAREFAS,
  conferir,
  conferirPedidoDeMudarStatus,
  FiltroDeTarefas,
  PedidoDeComentario,
  PedidoDeTarefa,
  PedidoDeTrocarResponsavel,
  type Responsavel,
  STATUS_ENCERRADOS,
  type StatusTarefa,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  autorDe,
  buscarTarefa,
  comentar,
  criarTarefa,
  excluirTarefa,
  listarComentarios,
  listarTarefas,
  mudarStatus,
  nomesDasPessoas,
  pessoaAtivaNaEmpresa,
  pessoasCitadas,
  type Quem,
  trocarResponsavel,
} from "./servico.ts";

type AcaoDeTarefa = (typeof ACOES_TAREFAS)[number];

const naoEncontrada = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "TAREFA_NAO_ENCONTRADA", message: "Tarefa não encontrada." });

const invalido = (resposta: FastifyReply, problemas: unknown) =>
  resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas });

function quemDoPedido(pedido: FastifyRequest): Quem {
  const { sessao, filtro } = acessoDo(pedido);
  return { tipo: "pessoa", pessoaId: sessao.pessoa.id, filtro };
}

export function registrarRotasDasTarefas(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  /** Abre a transação da pessoa na empresa ativa. */
  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  function registrar(pedido: FastifyRequest, acao: AcaoDeTarefa, tarefaId: string, detalhes = {}) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "tarefa", id: tarefaId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }

  /** Confere se o responsável escolhido pode receber tarefas na empresa. Devolve o motivo da recusa. */
  async function responsavelRecusado(c: pg.PoolClient, r: Responsavel | null): Promise<string | null> {
    if (r === null) return null;
    if (r.tipo === "agente") return "Agentes como responsáveis chegam com a Central de agentes.";
    return (await pessoaAtivaNaEmpresa(c, r.pessoaId)) ? null : "Essa pessoa não está ativa nesta empresa.";
  }

  app.get("/tarefas", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const q = pedido.query as { minhas?: string | string[]; status?: string | string[] };
    const status = [q.status ?? []]
      .flat()
      .flatMap((s) => s.split(","))
      .filter(Boolean);
    const filtro = {
      ...([q.minhas].flat().some((m) => m === "1" || m === "true") ? { minhas: true } : {}),
      ...(status.length > 0 ? { status } : {}),
    };
    const r = conferir(FiltroDeTarefas, filtro);
    if (!r.ok) return invalido(resposta, r.problemas);
    const quem = quemDoPedido(pedido);
    return naEmpresa(pedido, async (c) => {
      const tarefas = await listarTarefas(c, quem, r.valor);
      return { tarefas, nomes: await nomesDasPessoas(c, pessoasCitadas(tarefas)) };
    });
  });

  app.post("/tarefas", { preHandler: verificador.exigir("tarefas", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeTarefa, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const quem = quemDoPedido(pedido);
    const { sessao } = acessoDo(pedido);
    // Sem responsável informado, a tarefa fica com quem criou. "null" de propósito: fica sem responsável.
    const responsavel: Responsavel | null =
      r.valor.responsavel === undefined
        ? { tipo: "pessoa", pessoaId: sessao.pessoa.id }
        : r.valor.responsavel;
    const feito = await naEmpresa(pedido, async (c) => {
      const recusa = await responsavelRecusado(c, responsavel);
      if (recusa) return { recusa };
      return {
        tarefa: await criarTarefa(c, quem, {
          titulo: r.valor.titulo,
          descricao: r.valor.descricao ?? null,
          responsavel,
        }),
      };
    });
    if ("recusa" in feito)
      return resposta.code(400).send({ code: "RESPONSAVEL_INVALIDO", message: feito.recusa });
    await registrar(pedido, "tarefa.criou", feito.tarefa.id, { responsavel: responsavel?.tipo ?? null });
    return resposta.code(201).send(feito.tarefa);
  });

  app.get("/tarefas/:id", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const quem = quemDoPedido(pedido);
    const achou = await naEmpresa(pedido, async (c) => {
      const tarefa = await buscarTarefa(c, quem, id);
      if (!tarefa) return null;
      const comentarios = await listarComentarios(c, tarefa.id);
      return { tarefa, comentarios, nomes: await nomesDasPessoas(c, pessoasCitadas([tarefa], comentarios)) };
    });
    return achou ?? naoEncontrada(resposta);
  });

  app.post(
    "/tarefas/:id/status",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferirPedidoDeMudarStatus(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        const de: StatusTarefa = tarefa.status;
        // Tarefa encerrada só sai daqui reabrindo (volta para A fazer).
        if (STATUS_ENCERRADOS.includes(de) && r.valor.status !== de && r.valor.status !== "a_fazer") {
          return { recusa: "Para mexer numa tarefa encerrada, reabra antes." };
        }
        // Mesmo status sem resultado novo: nada muda (e o resultado entregue não se perde).
        const mudou = r.valor.status !== de || r.valor.resultado !== undefined;
        const nova = mudou
          ? await mudarStatus(c, quem, tarefa, r.valor.status, r.valor.resultado ?? null)
          : tarefa;
        const comentario = r.valor.motivo
          ? await comentar(c, autorDe(quem), tarefa.id, r.valor.motivo)
          : null;
        return { tarefa: nova, de, mudou, comentario };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito)
        return resposta.code(409).send({ code: "TAREFA_ENCERRADA", message: feito.recusa });
      if (feito.comentario) {
        await registrar(pedido, "tarefa.comentou", id, { comentarioId: feito.comentario.id });
      }
      if (feito.mudou) {
        await registrar(pedido, "tarefa.mudou_status", id, {
          de: feito.de,
          para: feito.tarefa.status,
          comResultado: feito.tarefa.resultado !== null,
        });
      }
      return feito.tarefa;
    },
  );

  app.post(
    "/tarefas/:id/responsavel",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeTrocarResponsavel, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        const recusa = await responsavelRecusado(c, r.valor.responsavel);
        if (recusa) return { recusa };
        return { tarefa: await trocarResponsavel(c, tarefa, r.valor.responsavel) };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito)
        return resposta.code(400).send({ code: "RESPONSAVEL_INVALIDO", message: feito.recusa });
      await registrar(pedido, "tarefa.trocou_responsavel", id, {
        responsavel: r.valor.responsavel?.tipo ?? null,
      });
      return feito.tarefa;
    },
  );

  // Comentar pede só "ver": quem alcança a tarefa pode comentar, mesmo travada por outro (M2-02).
  app.post(
    "/tarefas/:id/comentarios",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeComentario, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const comentario = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        const { sessao } = acessoDo(pedido);
        return comentar(c, { tipo: "pessoa", pessoaId: sessao.pessoa.id }, tarefa.id, r.valor.texto);
      });
      if (!comentario) return naoEncontrada(resposta);
      await registrar(pedido, "tarefa.comentou", id, { comentarioId: comentario.id });
      return resposta.code(201).send(comentario);
    },
  );

  app.delete(
    "/tarefas/:id",
    { preHandler: verificador.exigir("tarefas", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const quem = quemDoPedido(pedido);
      const achou = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return false;
        await excluirTarefa(c, tarefa.id);
        return true;
      });
      if (!achou) return naoEncontrada(resposta);
      await registrar(pedido, "tarefa.excluiu", id);
      return { ok: true };
    },
  );
}
