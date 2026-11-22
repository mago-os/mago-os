/**
 * Limites de cada execução por agente interno (M4-08, decisão 0030): ver ("agentes.ver") e mudar ("agentes.editar",
 * o administrador por padrão). Vazio volta ao padrão (30 rodadas e 10 minutos).
 */
import {
  conferir,
  LIMITE_PADRAO_DE_MINUTOS,
  LIMITE_PADRAO_DE_RODADAS,
  type LimitesDoAgente,
  PedidoDeLimites,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { FORMATO_UUID } from "../comum.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";

const naoEncontrado = (r: FastifyReply) =>
  r.code(404).send({ code: "NAO_ENCONTRADO", message: "Agente interno não encontrado." });

async function lerLimites(c: pg.PoolClient, agenteId: string): Promise<LimitesDoAgente | null> {
  const r = await c.query<{ limite_de_rodadas: number | null; limite_de_minutos: number | null }>(
    `select limite_de_rodadas, limite_de_minutos from agentes
      where id = $1 and empresa_id = empresa_ativa() and tipo = 'interno'`,
    [agenteId],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    rodadas: l.limite_de_rodadas ?? LIMITE_PADRAO_DE_RODADAS,
    minutos: l.limite_de_minutos ?? LIMITE_PADRAO_DE_MINUTOS,
    ajustados: l.limite_de_rodadas !== null || l.limite_de_minutos !== null,
  };
}

export function registrarRotasDosLimites(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }

  app.get(
    "/agentes/:id/limites",
    { preHandler: verificador.exigir("agentes", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta);
      return (await naEmpresa(pedido, (c) => lerLimites(c, id))) ?? naoEncontrado(resposta);
    },
  );

  app.post(
    "/agentes/:id/limites",
    { preHandler: verificador.exigir("agentes", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeLimites, pedido.body);
      if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
      if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta);
      const feito = await naEmpresa(pedido, async (c) => {
        const mudou = await c.query(
          `update agentes set limite_de_rodadas = $2, limite_de_minutos = $3, atualizado_em = now()
            where id = $1 and empresa_id = empresa_ativa() and tipo = 'interno'`,
          [id, r.valor.rodadas, r.valor.minutos],
        );
        return (mudou.rowCount ?? 0) > 0 ? lerLimites(c, id) : null;
      });
      if (!feito) return naoEncontrado(resposta);
      const { sessao } = acessoDo(pedido);
      await auditar(
        poolApp,
        {
          empresaId: sessao.empresaId,
          ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
          acao: "agente.mudou_limites",
          alvo: { tipo: "agente", id },
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
          detalhes: r.valor,
        },
        pedido.log,
      );
      return feito;
    },
  );
}
