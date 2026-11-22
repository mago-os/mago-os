/**
 * Rotas do passo a passo (M4-07, decisão 0029): a execução com os passos, as execuções de uma tarefa (e o que os
 * externos fizeram nela pelo MCP) e as execuções recentes de um agente. Quem não vê a tarefa não vê a execução;
 * os detalhes (parâmetros e resultados) são de quem pediu, do responsável pelo agente e do administrador.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { quemDoPedido } from "../tarefas/rotas.ts";
import { buscarTarefa } from "../tarefas/servico.ts";
import { quemPediu } from "./ferramentas.ts";
import {
  atividadeExternaDaTarefa,
  detalheDaExecucao,
  execucoesDaTarefa,
  execucoesDoAgente,
} from "./passos.ts";

const naoEncontrado = (r: FastifyReply, o: string) =>
  r.code(404).send({ code: "NAO_ENCONTRADO", message: `${o} não encontrada.` });

export function registrarRotasDosPassos(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }
  const pessoaDo = (pedido: FastifyRequest) => {
    const { sessao, permissoes } = acessoDo(pedido);
    return { id: sessao.pessoa.id, administrador: permissoes.perfil === "administrador" };
  };
  /** A pessoa vê a tarefa? Pelo alcance dela em "tarefas.ver" (a rota pode ter conferido outro módulo). */
  const veTarefa = (pedido: FastifyRequest, c: pg.PoolClient) => {
    const { sessao, permissoes } = acessoDo(pedido);
    const quem = quemPediu(permissoes, sessao.pessoa.id, "ver");
    return async (tarefaId: string) => quem !== null && (await buscarTarefa(c, quem, tarefaId)) !== null;
  };

  // Em "agentes.ver": quem pediu numa conversa abre a execução mesmo sem ver tarefas.
  app.get(
    "/execucoes/:id",
    { preHandler: verificador.exigir("agentes", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, (c) =>
        detalheDaExecucao(c, id, pessoaDo(pedido), veTarefa(pedido, c)),
      );
      return feito ?? naoEncontrado(resposta, "Execução");
    },
  );

  app.get(
    "/tarefas/:id/execucoes",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Tarefa");
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await buscarTarefa(c, quem, id))) return null;
        return {
          execucoes: await execucoesDaTarefa(c, id),
          externos: await atividadeExternaDaTarefa(c, id, pessoaDo(pedido)),
        };
      });
      return feito ?? naoEncontrado(resposta, "Tarefa");
    },
  );

  app.get(
    "/agentes/:id/execucoes",
    { preHandler: verificador.exigir("agentes", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      if (!FORMATO_UUID.test(id))
        return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Agente não encontrado." });
      return naEmpresa(pedido, (c) => execucoesDoAgente(c, id, pessoaDo(pedido), veTarefa(pedido, c)));
    },
  );
}
