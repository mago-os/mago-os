/**
 * Rotas dos custos e tetos (M4-06, decisão 0028). Seguem o módulo "Contas de IA": ver o painel é "ver"; mudar tetos,
 * limites e preços é "editar" (padrão: o administrador). Cada mudança vai para a auditoria.
 */
import { conferir, PedidoDeAvisoDeTokens, PedidoDePrecoDoModelo, PedidoDeTeto } from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { FORMATO_UUID } from "../comum.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { mudarLimiteDeTokens, mudarPrecoDoModelo, mudarTeto, resumoDeCustos } from "./servico.ts";

const naoEncontrado = (r: FastifyReply, o: string) =>
  r.code(404).send({ code: "NAO_ENCONTRADO", message: `${o} não encontrado.` });

export function registrarRotasDosCustos(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  function naEmpresa<T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  }
  function registrar(
    pedido: FastifyRequest,
    acao: string,
    alvo: { tipo: string; id: string },
    detalhes = {},
  ) {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo,
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  }
  const editar = { preHandler: verificador.exigir("contas_de_ia", "editar") };

  app.get("/custos", { preHandler: verificador.exigir("contas_de_ia", "ver") }, async (pedido, resposta) => {
    const { mes } = pedido.query as { mes?: string };
    if (mes !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes))
      return resposta.code(400).send({ code: "PEDIDO_INVALIDO", message: "Mês no formato AAAA-MM." });
    return naEmpresa(pedido, (c) => resumoDeCustos(c, mes ?? null));
  });

  app.post("/custos/tetos/empresa", editar, async (pedido, resposta) => {
    const r = conferir(PedidoDeTeto, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    const { sessao } = acessoDo(pedido);
    await naEmpresa(pedido, (c) => mudarTeto(c, null, r.valor.teto, sessao.pessoa.id));
    await registrar(
      pedido,
      "custos.mudou_teto",
      { tipo: "empresa", id: sessao.empresaId },
      { teto: r.valor.teto },
    );
    return { teto: r.valor.teto };
  });

  app.post("/custos/tetos/agente/:id", editar, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const r = conferir(PedidoDeTeto, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Agente");
    const { sessao } = acessoDo(pedido);
    const feito = await naEmpresa(pedido, async (c) => {
      const a = await c.query(
        "select 1 from agentes where id = $1 and empresa_id = empresa_ativa() and tipo = 'interno'",
        [id],
      );
      if ((a.rowCount ?? 0) === 0) return false;
      await mudarTeto(c, id, r.valor.teto, sessao.pessoa.id);
      return true;
    });
    if (!feito) return naoEncontrado(resposta, "Agente");
    await registrar(pedido, "custos.mudou_teto", { tipo: "agente", id }, { teto: r.valor.teto });
    return { teto: r.valor.teto };
  });

  app.post("/ia/contas/:id/limite-de-tokens", editar, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const r = conferir(PedidoDeAvisoDeTokens, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Conta de IA");
    const feito = await naEmpresa(pedido, (c) =>
      mudarLimiteDeTokens(c, id, r.valor.tokens, r.valor.aoChegar),
    );
    if (!feito)
      return resposta.code(404).send({
        code: "NAO_ENCONTRADO",
        message: "Conta por assinatura não encontrada (a conta por chave de API usa o teto em dólar).",
      });
    await registrar(pedido, "custos.mudou_aviso_de_tokens", { tipo: "conta_de_ia", id }, r.valor);
    return r.valor;
  });

  app.post("/ia/contas/:id/precos", editar, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const r = conferir(PedidoDePrecoDoModelo, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas: r.problemas });
    if (!FORMATO_UUID.test(id)) return naoEncontrado(resposta, "Modelo");
    const feito = await naEmpresa(pedido, (c) => mudarPrecoDoModelo(c, id, r.valor.modelo, r.valor.preco));
    if (!feito) return naoEncontrado(resposta, "Modelo");
    await registrar(pedido, "custos.mudou_preco", { tipo: "conta_de_ia", id }, r.valor);
    return r.valor;
  });
}
