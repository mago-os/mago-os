/**
 * Rotas dos webhooks (M7-03, decisão 0048): só o administrador (módulo "api", alcance "tudo"), como as chaves de API.
 * O segredo vem só na resposta de criar e de trocar. Cada mudança vira evento de auditoria, com o domínio do endereço
 * (nunca o endereço inteiro, que pode levar um código, nem o segredo).
 */
import {
  type AcaoDosWebhooks,
  conferirPedidoDeEditarWebhook,
  conferirPedidoDeWebhook,
  type Problema,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import type { Cofre } from "../contas-de-ia/cofre.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  apagarWebhook,
  buscarWebhook,
  criarWebhook,
  editarWebhook,
  listarEntregas,
  listarWebhooks,
  mandarTeste,
  RecusaDoWebhook,
  reenviar,
  trocarSegredo,
} from "./servico.ts";

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}
const naoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Webhook não encontrado." });

const dominio = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export function registrarRotasDosWebhooks(
  app: FastifyInstance,
  o: { verificador: Verificador; poolApp: pg.Pool; cofre: Cofre | null; acordar?: () => void },
): void {
  const { verificador, poolApp } = o;
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const registrar = (pedido: FastifyRequest, acao: AcaoDosWebhooks, id: string, detalhes = {}) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "webhook", id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  };
  /** Só o administrador (alcance "tudo") e com o cofre ligado (o segredo fica cifrado nele). */
  const pode = (pedido: FastifyRequest, resposta: FastifyReply): Cofre | null => {
    if (acessoDo(pedido).alcance !== "tudo") {
      resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Só o administrador cuida dos webhooks." });
      return null;
    }
    if (!o.cofre) {
      resposta.code(503).send({ code: "COFRE_DESLIGADO", message: "Os webhooks precisam do cofre ligado." });
      return null;
    }
    return o.cofre;
  };
  const tratar = async (resposta: FastifyReply, trabalho: () => Promise<unknown>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof RecusaDoWebhook)
        return resposta.code(400).send({ code: "WEBHOOK_RECUSADO", message: erro.message });
      throw erro;
    }
  };

  app.get("/empresa/webhooks", { preHandler: verificador.exigir("api", "ver") }, async (pedido, resposta) => {
    if (!pode(pedido, resposta)) return resposta;
    return naEmpresa(pedido, async (c) => ({ webhooks: await listarWebhooks(c) }));
  });

  app.post(
    "/empresa/webhooks",
    { preHandler: verificador.exigir("api", "criar") },
    async (pedido, resposta) => {
      const cofre = pode(pedido, resposta);
      if (!cofre) return resposta;
      const r = conferirPedidoDeWebhook(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, (c) =>
          criarWebhook(c, cofre, sessao.empresaId, { ...r.valor, criadoPor: sessao.pessoa.id }),
        );
        await registrar(pedido, "webhook.criou", feito.webhook.id, {
          dominio: dominio(feito.webhook.url),
          eventos: feito.webhook.eventos,
        });
        return resposta.code(201).send(feito);
      });
    },
  );

  app.post(
    "/empresa/webhooks/:id",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      if (!pode(pedido, resposta)) return resposta;
      const { id } = pedido.params as { id: string };
      const r = conferirPedidoDeEditarWebhook(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const feito = await naEmpresa(pedido, async (c) => {
        const atual = await buscarWebhook(c, id, true);
        return atual ? editarWebhook(c, atual, r.valor) : null;
      });
      if (!feito) return naoEncontrado(resposta);
      await registrar(pedido, "webhook.editou", id, {
        campos: Object.keys(r.valor),
        dominio: dominio(feito.url),
        situacao: feito.situacao,
      });
      return feito;
    },
  );

  app.post(
    "/empresa/webhooks/:id/trocar-segredo",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      const cofre = pode(pedido, resposta);
      if (!cofre) return resposta;
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const atual = await buscarWebhook(c, id, true);
        return atual ? trocarSegredo(c, cofre, sessao.empresaId, atual) : null;
      });
      if (!feito) return naoEncontrado(resposta);
      await registrar(pedido, "webhook.trocou_segredo", id);
      return resposta.code(201).send(feito);
    },
  );

  app.delete(
    "/empresa/webhooks/:id",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      if (!pode(pedido, resposta)) return resposta;
      const { id } = pedido.params as { id: string };
      if (!(await naEmpresa(pedido, (c) => apagarWebhook(c, id)))) return naoEncontrado(resposta);
      await registrar(pedido, "webhook.apagou", id);
      return { ok: true };
    },
  );

  app.post(
    "/empresa/webhooks/:id/teste",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      if (!pode(pedido, resposta)) return resposta;
      const { id } = pedido.params as { id: string };
      const entregaId = await naEmpresa(pedido, async (c) => {
        const w = await buscarWebhook(c, id);
        return w ? mandarTeste(c, w) : null;
      });
      if (!entregaId) return naoEncontrado(resposta);
      o.acordar?.();
      return resposta.code(202).send({ entregaId });
    },
  );

  app.get(
    "/empresa/webhooks/:id/entregas",
    { preHandler: verificador.exigir("api", "ver") },
    async (pedido, resposta) => {
      if (!pode(pedido, resposta)) return resposta;
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) =>
        (await buscarWebhook(c, id)) ? listarEntregas(c, id) : null,
      );
      if (!feito) return naoEncontrado(resposta);
      return { entregas: feito };
    },
  );

  app.post(
    "/empresa/webhooks/:id/entregas/:entregaId/reenviar",
    { preHandler: verificador.exigir("api", "editar") },
    async (pedido, resposta) => {
      if (!pode(pedido, resposta)) return resposta;
      const { id, entregaId } = pedido.params as { id: string; entregaId: string };
      if (!(await naEmpresa(pedido, (c) => reenviar(c, id, entregaId))))
        return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Entrega não encontrada." });
      await registrar(pedido, "webhook.reenviou", id, { entregaId });
      o.acordar?.();
      return resposta.code(202).send({ ok: true });
    },
  );
}
