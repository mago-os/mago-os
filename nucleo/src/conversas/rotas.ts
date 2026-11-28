/**
 * Rotas das conversas com contatos (M8-01, decisão 0051). Módulo de permissão "conversas": ver; criar (responder e
 * nota interna, M8-04); editar (assumir, passar, devolver, resolver, reabrir e trocar o contato); excluir (apagar).
 * Módulo "canais": ver, criar, editar e excluir (padrão: só o administrador). O alcance de cada ação vira o filtro.
 * A caixa única (M8-04) e a tela de canais (M8-02) acrescentam as rotas de ação.
 */
import {
  type AcaoDasConversas,
  conferir,
  FiltroDeConversas,
  PedidoDeTrocarContato,
  type Problema,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { buscarContato, quemOlhaContatos } from "../contatos/servico.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import {
  type AcaoNasConversas,
  buscarConversa,
  conversaAnterior,
  listarConversas,
  mensagensDaConversa,
  quemOlhaConversas,
  RecusaDasConversas,
  trocarContatoDaConversa,
} from "./servico.ts";

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

const naoEncontrada = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Conversa não encontrada." });

/** Lista de valores da query: "a,b" ou várias vezes o mesmo nome. */
function varios(valor: unknown): string[] {
  return [valor ?? []]
    .flat()
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Os filtros da lista a partir da query: situacoes, canal, contato, dono (id ou sem) e comAgente. */
export function filtroDeConversasDaQuery(q: Record<string, unknown>): Record<string, unknown> {
  const um = (n: string) =>
    typeof q[n] === "string" && (q[n] as string).trim() ? (q[n] as string).trim() : undefined;
  const situacoes = varios(q.situacoes);
  const comAgente = um("comAgente");
  return {
    ...(situacoes.length > 0 ? { situacoes } : {}),
    ...(um("canal") ? { canalId: um("canal") } : {}),
    ...(um("contato") ? { contatoId: um("contato") } : {}),
    ...(um("dono") ? { donoId: um("dono") } : {}),
    ...(um("texto") ? { texto: um("texto") } : {}),
    ...(comAgente === "1" || comAgente === "true" ? { comAgente: true } : {}),
    ...(comAgente === "0" || comAgente === "false" ? { comAgente: false } : {}),
  };
}

export function registrarRotasDasConversas(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const olha = (pedido: FastifyRequest, acao: AcaoNasConversas) => {
    const { sessao, permissoes } = acessoDo(pedido);
    return quemOlhaConversas(permissoes, sessao.pessoa.id, acao);
  };
  const olhaContatos = (pedido: FastifyRequest) => {
    const { sessao, permissoes } = acessoDo(pedido);
    return quemOlhaContatos(permissoes, sessao.pessoa.id, "ver");
  };
  const registrar = (
    pedido: FastifyRequest,
    acao: AcaoDasConversas,
    alvo: { tipo: string; id: string },
    detalhes: Record<string, unknown> = {},
  ) => {
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
  };

  app.get(
    "/conversas-com-contatos",
    { preHandler: verificador.exigir("conversas", "ver") },
    async (pedido, resposta) => {
      const r = conferir(
        FiltroDeConversas,
        filtroDeConversasDaQuery(pedido.query as Record<string, unknown>),
      );
      if (!r.ok) return invalido(resposta, r.problemas);
      return naEmpresa(pedido, async (c) => ({
        conversas: await listarConversas(c, [olha(pedido, "ver")], r.valor),
      }));
    },
  );

  app.get(
    "/conversas-com-contatos/:id",
    { preHandler: verificador.exigir("conversas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) => {
        const conversa = await buscarConversa(c, [olha(pedido, "ver")], id);
        if (!conversa) return null;
        const alcanca = async (acao: AcaoNasConversas) => {
          const q = olha(pedido, acao);
          return q.alcance !== "nada" && (await buscarConversa(c, [q], id)) !== null;
        };
        return {
          conversa,
          mensagens: await mensagensDaConversa(c, id),
          anterior: await conversaAnterior(c, [olha(pedido, "ver")], conversa),
          pode: { responder: await alcanca("criar"), editar: await alcanca("editar") },
          // A caixa (M8-04) só mostra "Devolver ao agente" quando o canal tem um agente.
          canalTemAgente:
            (
              await c.query<{ agente_id: string | null }>(
                "select agente_id from canais_de_contato where id = $1 and empresa_id = empresa_ativa()",
                [conversa.canal.id],
              )
            ).rows[0]?.agente_id != null,
        };
      });
      if (!feito) return naoEncontrada(resposta);
      return feito;
    },
  );

  // Ligar a conversa a outro contato: o telefone está em mais de um contato (decisão 0051, item 2).
  app.post(
    "/conversas-com-contatos/:id/contato",
    { preHandler: verificador.exigir("conversas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeTrocarContato, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      try {
        const feito = await naEmpresa(pedido, async (c) => {
          const conversa = await buscarConversa(c, [olha(pedido, "editar")], id, true);
          if (!conversa) return null;
          const contato = await buscarContato(c, [olhaContatos(pedido)], r.valor.contatoId);
          if (!contato || contato.situacao !== "ativo")
            throw new RecusaDasConversas("Escolha um contato ativo que você pode ver.");
          await trocarContatoDaConversa(c, conversa, contato.id);
          return { de: conversa.contatoId, conversa: await buscarConversa(c, [olha(pedido, "ver")], id) };
        });
        if (!feito) return naoEncontrada(resposta);
        if (feito.de !== r.valor.contatoId)
          await registrar(
            pedido,
            "conversa.trocou_contato",
            { tipo: "conversa", id },
            { de: feito.de, para: r.valor.contatoId },
          );
        return { conversa: feito.conversa };
      } catch (erro) {
        if (erro instanceof RecusaDasConversas)
          return resposta.code(400).send({ code: "CONVERSA_RECUSADA", message: erro.message });
        throw erro;
      }
    },
  );

  // A linha do tempo do contato: as conversas dele, de todos os canais, que quem olha vê (o alcance das conversas,
  // não o dos contatos). O contato precisa estar entre os que a pessoa vê.
  app.get(
    "/contatos/:id/conversas",
    { preHandler: verificador.exigir("conversas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) => {
        const contato = await buscarContato(c, [olhaContatos(pedido)], id);
        if (!contato || contato.situacao === "juntado") return null;
        const identificado = await c.query<{ identificado: boolean }>(
          "select identificado from contatos where id = $1 and empresa_id = empresa_ativa()",
          [id],
        );
        return {
          identificado: identificado.rows[0]?.identificado ?? true,
          conversas: await listarConversas(c, [olha(pedido, "ver")], { contatoId: id }, 100),
        };
      });
      if (!feito)
        return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Contato não encontrado." });
      return feito;
    },
  );
}
