/**
 * Rotas da agenda (M5-07, decisão 0041). Módulo de permissão "agenda": ver (o alcance diz quem vê o evento inteiro),
 * criar e editar (o alcance "tudo" edita e cancela os eventos dos outros; os outros, só os que criaram). Cada mudança
 * vira evento de auditoria, sem o título.
 */
import {
  type AcaoDaAgenda,
  conferir,
  conferirPedidoDeEdicaoDeEvento,
  conferirPedidoDeEvento,
  DIAS_MAXIMOS_DA_LISTAGEM,
  type EventoDaAgenda,
  PedidoDeCancelamento,
  PedidoDeResposta,
  type Problema,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  buscarEvento,
  cancelarEvento,
  criarEvento,
  editarEvento,
  eventoPorId,
  fusoDaPessoa,
  listarAgenda,
  podeMudar,
  quemVeDe,
  RecusaDaAgenda,
  responderConvite,
} from "./servico.ts";

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

const naoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Evento não encontrado." });

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export function registrarRotasDaAgenda(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const registrar = (pedido: FastifyRequest, acao: AcaoDaAgenda, eventoId: string, detalhes = {}) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "evento", id: eventoId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  };
  const tratar = async <T>(resposta: FastifyReply, trabalho: () => Promise<T>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof RecusaDaAgenda)
        return resposta.code(400).send({ code: "EVENTO_RECUSADO", message: erro.message });
      throw erro;
    }
  };
  const quemVe = (pedido: FastifyRequest) => {
    const { sessao, permissoes } = acessoDo(pedido);
    return quemVeDe(permissoes, sessao.pessoa.id);
  };

  /** As vezes dos eventos entre dois dias (até 62), da pessoa ou das pessoas pedidas (até 10). */
  app.get("/agenda", { preHandler: verificador.exigir("agenda", "ver") }, async (pedido, resposta) => {
    const q = pedido.query as { de?: string; ate?: string; pessoas?: string };
    const { sessao } = acessoDo(pedido);
    if (!q.de || !q.ate || !DIA.test(q.de) || !DIA.test(q.ate) || q.ate < q.de)
      return resposta.code(400).send({ code: "PEDIDO_INVALIDO", message: "Informe de e ate (AAAA-MM-DD)." });
    if ((Date.parse(q.ate) - Date.parse(q.de)) / 86_400_000 > DIAS_MAXIMOS_DA_LISTAGEM)
      return resposta
        .code(400)
        .send({ code: "PEDIDO_INVALIDO", message: `No máximo ${DIAS_MAXIMOS_DA_LISTAGEM} dias de uma vez.` });
    const pessoas = q.pessoas
      ? [...new Set(q.pessoas.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 10)
      : [sessao.pessoa.id];
    return naEmpresa(pedido, async (c) => {
      const fuso = await fusoDaPessoa(c, sessao.pessoa.id);
      return {
        ocorrencias: await listarAgenda(c, [quemVe(pedido)], {
          de: q.de as string,
          ate: q.ate as string,
          pessoas,
          fuso,
        }),
      };
    });
  });

  app.get(
    "/agenda/eventos/:id",
    { preHandler: verificador.exigir("agenda", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao, permissoes } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const evento = await buscarEvento(c, [quemVe(pedido)], id);
        if (!evento) return null;
        const ids = [evento.criadoPor, ...evento.participantes.map((p) => p.pessoaId)];
        if (evento.criadoPorAgenteId) ids.push(evento.criadoPorAgenteId);
        const nomes = await c.query<{ id: string; nome: string }>(
          `select id, nome from pessoas where id = any($1::uuid[])
         union all select id, nome from agentes where empresa_id = empresa_ativa() and id = any($1::uuid[])`,
          [ids],
        );
        return { evento, nomes: Object.fromEntries(nomes.rows.map((x) => [x.id, x.nome])) };
      });
      if (!feito) return naoEncontrado(resposta);
      return { ...feito, podeMudar: podeMudar(feito.evento, sessao.pessoa.id, permissoes) };
    },
  );

  app.post(
    "/agenda/eventos",
    { preHandler: verificador.exigir("agenda", "criar") },
    async (pedido, resposta) => {
      const r = conferirPedidoDeEvento(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      return tratar(resposta, async () => {
        const evento = await naEmpresa(pedido, (c) =>
          criarEvento(c, { pessoaId: sessao.pessoa.id }, r.valor),
        );
        await registrar(pedido, "evento.criou", evento.id, {
          participantes: evento.participantes.length,
          recorrente: evento.regra !== null,
        });
        return resposta.code(201).send(evento);
      });
    },
  );

  /** Busca o evento que a pessoa vê e pode mudar. */
  const paraMudar = async (pedido: FastifyRequest, c: pg.PoolClient, id: string) => {
    const { sessao, permissoes } = acessoDo(pedido);
    const visto = await buscarEvento(c, [quemVe(pedido)], id);
    if (!visto) return { ok: false as const, erro: 404 as const };
    if (!podeMudar(visto, sessao.pessoa.id, permissoes)) return { ok: false as const, erro: 403 as const };
    return { ok: true as const, evento: (await eventoPorId(c, id, true)) as EventoDaAgenda };
  };
  const semPermissao = (resposta: FastifyReply) =>
    resposta
      .code(403)
      .send({ code: "SEM_PERMISSAO", message: "Só quem criou o evento (ou o administrador) muda." });

  app.post(
    "/agenda/eventos/:id",
    { preHandler: verificador.exigir("agenda", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferirPedidoDeEdicaoDeEvento(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          const m = await paraMudar(pedido, c, id);
          if (!m.ok) return m;
          return { ok: true as const, evento: await editarEvento(c, m.evento, r.valor) };
        });
        if (!feito.ok) return feito.erro === 404 ? naoEncontrado(resposta) : semPermissao(resposta);
        await registrar(pedido, "evento.editou", id, {
          alcance: r.valor.alcance ?? "todos",
          eventoResultante: feito.evento.id,
          campos: Object.keys(r.valor).filter((k) => k !== "alcance" && k !== "ocorrencia"),
        });
        return feito.evento;
      });
    },
  );

  app.post(
    "/agenda/eventos/:id/cancelar",
    { preHandler: verificador.exigir("agenda", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeCancelamento, pedido.body ?? {});
      if (!r.ok) return invalido(resposta, r.problemas);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          const m = await paraMudar(pedido, c, id);
          if (!m.ok) return m;
          await cancelarEvento(c, m.evento, r.valor);
          return { ok: true as const };
        });
        if (!feito.ok) return feito.erro === 404 ? naoEncontrado(resposta) : semPermissao(resposta);
        await registrar(pedido, "evento.cancelou", id, { alcance: r.valor.alcance ?? "todos" });
        return { ok: true };
      });
    },
  );

  app.post(
    "/agenda/eventos/:id/resposta",
    { preHandler: verificador.exigir("agenda", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeResposta, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const e = await eventoPorId(c, id);
        if (!e || e.situacao === "cancelado") return false;
        return responderConvite(c, e, sessao.pessoa.id, r.valor.resposta);
      });
      if (!feito)
        return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Convite não encontrado." });
      await registrar(pedido, "evento.respondeu", id, { resposta: r.valor.resposta });
      return { ok: true };
    },
  );
}
