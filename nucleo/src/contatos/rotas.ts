/**
 * Rotas dos contatos (M7-01, decisão 0045). Módulo de permissão "contatos": ver, criar, editar (inclui arquivar),
 * aprovar (juntar) e excluir (apagar, com o segundo fator recente). O alcance de cada ação vira o filtro. Cada mudança
 * vira evento de auditoria, sem nome, e-mail, telefone ou documento.
 */
import {
  type AcaoDosContatos,
  type Contato,
  conferir,
  conferirPedidoDeContato,
  conferirPedidoDeEditarContato,
  conferirPedidoDeJuntar,
  FiltroDeContatos,
  PedidoDeContatosLigados,
  PedidoDeVisaoDeContatos,
  type Problema,
  type Tarefa,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { podeFazerAcaoPerigosa } from "../acesso/dois-fatores.ts";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import { acessoDo, type PermissoesNaEmpresa, type Verificador } from "../permissoes/verificar.ts";
import { type AlcanceDeProjeto, buscarProjeto } from "../projetos/servico.ts";
import { quemDoPedido } from "../tarefas/rotas.ts";
import { buscarTarefa, listarTarefas, type Quem } from "../tarefas/servico.ts";
import {
  type AcaoNosContatos,
  apagarContato,
  apagarVisaoDeContatos,
  buscarContato,
  contatosLigados,
  criarContato,
  editarContato,
  juntarContatos,
  ligarContatos,
  listarContatos,
  listarVisoesDeContatos,
  pessoasDaOrganizacao,
  quemOlhaContatos,
  RecusaDosContatos,
  repetidosDe,
  resumosDe,
  salvarVisaoDeContatos,
} from "./servico.ts";

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

/** Apagar um contato pede o segundo fator recente (como as outras ações perigosas, decisão 0011). */
const pedeConfirmacao = (resposta: FastifyReply) =>
  resposta.code(403).send({
    code: "CONFIRMACAO_NECESSARIA",
    message: "Por segurança, confirme com o código do app ou com a passkey antes de apagar o contato.",
  });

const naoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Contato não encontrado." });

/** Lista de valores da query: "a,b" ou várias vezes o mesmo nome. */
function varios(valor: unknown): string[] {
  return [valor ?? []]
    .flat()
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Os filtros da lista a partir da query: tipo, papeis, etiquetas, responsaveis (id ou sem), organizacao, situacao, texto. */
export function filtroDeContatosDaQuery(q: Record<string, unknown>): Record<string, unknown> {
  const um = (n: string) =>
    typeof q[n] === "string" && (q[n] as string).trim() ? (q[n] as string).trim() : undefined;
  const papeis = varios(q.papeis);
  const etiquetas = varios(q.etiquetas);
  const responsaveis = varios(q.responsaveis);
  return {
    ...(um("tipo") ? { tipo: um("tipo") } : {}),
    ...(papeis.length > 0 ? { papeis } : {}),
    ...(etiquetas.length > 0 ? { etiquetas } : {}),
    ...(responsaveis.length > 0 ? { responsaveis } : {}),
    ...(um("organizacao") ? { organizacaoId: um("organizacao") } : {}),
    ...(um("situacao") ? { situacao: um("situacao") } : {}),
    ...(um("texto") ? { texto: um("texto") } : {}),
    ...(um("repetidos") === "1" || um("repetidos") === "true" ? { repetidos: true } : {}),
  };
}

/** As tarefas que a pessoa vê (o "ver" das tarefas e dos projetos), para a ficha do contato. */
export function quemVeTarefas(p: PermissoesNaEmpresa, pessoaId: string): Quem | null {
  const filtro = filtroDoAlcance(p.modulos.get("tarefas")?.acoes.ver ?? "nada", pessoaId, p.area);
  if (!filtro) return null;
  const verProjetos = p.modulos.get("projetos")?.acoes.ver ?? "nada";
  const projetos = verProjetos === "nada" ? "nenhum" : verProjetos === "tudo" ? "todos" : "membro";
  return { tipo: "pessoa", pessoaId, filtro, projetos };
}

/** A ficha: o contato, as organizações e as pessoas ligadas, e as tarefas abertas e fechadas que quem olha vê. */
export async function fichaDoContato(
  c: pg.PoolClient,
  contato: Contato,
  olhamVer: ReturnType<typeof quemOlhaContatos>[],
  quemTarefas: Quem | null,
) {
  const organizacoes = await resumosDe(
    c,
    olhamVer,
    contato.organizacoes.map((o) => o.organizacaoId),
  );
  const pessoasLigadas =
    contato.tipo === "organizacao" ? await pessoasDaOrganizacao(c, olhamVer, contato.id) : [];
  const tarefas: Tarefa[] = quemTarefas ? await listarTarefas(c, quemTarefas, { contatoId: contato.id }) : [];
  // O aviso de repetido fica na ficha enquanto houver outro contato com o mesmo e-mail, telefone ou rede (também logo
  // depois de cadastrar, quando a tela já abre a ficha nova).
  const repetidos =
    contato.situacao === "ativo" ? await repetidosDe(c, olhamVer, contato.id, contato.identificadores) : [];
  return { contato, organizacoes, pessoasLigadas, tarefas, repetidos };
}

export function registrarRotasDosContatos(
  app: FastifyInstance,
  verificador: Verificador,
  poolApp: pg.Pool,
): void {
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const olha = (pedido: FastifyRequest, acao: AcaoNosContatos) => {
    const { sessao, permissoes } = acessoDo(pedido);
    return quemOlhaContatos(permissoes, sessao.pessoa.id, acao);
  };
  const registrar = (
    pedido: FastifyRequest,
    acao: AcaoDosContatos,
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
  const tratar = async <T>(resposta: FastifyReply, trabalho: () => Promise<T>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof RecusaDosContatos)
        return resposta.code(400).send({ code: "CONTATO_RECUSADO", message: erro.message });
      throw erro;
    }
  };
  /** O que a pessoa pode fazer com o contato (para os botões da ficha). */
  const pode = async (c: pg.PoolClient, pedido: FastifyRequest, id: string) => {
    const alcanca = async (acao: AcaoNosContatos) => {
      const q = olha(pedido, acao);
      return q.alcance !== "nada" && (await buscarContato(c, [q], id)) !== null;
    };
    return {
      editar: await alcanca("editar"),
      juntar: await alcanca("aprovar"),
      apagar: await alcanca("excluir"),
    };
  };

  app.get("/contatos", { preHandler: verificador.exigir("contatos", "ver") }, async (pedido, resposta) => {
    const r = conferir(FiltroDeContatos, filtroDeContatosDaQuery(pedido.query as Record<string, unknown>));
    if (!r.ok) return invalido(resposta, r.problemas);
    return naEmpresa(pedido, async (c) => ({
      contatos: await listarContatos(c, [olha(pedido, "ver")], r.valor),
    }));
  });

  app.get(
    "/contatos/:id",
    { preHandler: verificador.exigir("contatos", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao, permissoes } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const contato = await buscarContato(c, [olha(pedido, "ver")], id);
        if (!contato) return null;
        if (contato.situacao === "juntado") return { juntadoEmId: contato.juntadoEmId };
        const ficha = await fichaDoContato(
          c,
          contato,
          [olha(pedido, "ver")],
          quemVeTarefas(permissoes, sessao.pessoa.id),
        );
        return { ...ficha, pode: await pode(c, pedido, id) };
      });
      if (!feito) return naoEncontrado(resposta);
      return feito;
    },
  );

  app.post("/contatos", { preHandler: verificador.exigir("contatos", "criar") }, async (pedido, resposta) => {
    const r = conferirPedidoDeContato(pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const { sessao } = acessoDo(pedido);
    return tratar(resposta, async () => {
      const feito = await naEmpresa(pedido, (c) =>
        criarContato(c, [olha(pedido, "ver")], { pessoaId: sessao.pessoa.id }, r.valor),
      );
      await registrar(
        pedido,
        "contato.criou",
        { tipo: "contato", id: feito.contato.id },
        { tipo: feito.contato.tipo, repetidos: feito.repetidos.length },
      );
      return resposta.code(201).send(feito);
    });
  });

  app.post(
    "/contatos/:id",
    { preHandler: verificador.exigir("contatos", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferirPedidoDeEditarContato(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          const antes = await buscarContato(c, [olha(pedido, "editar")], id, true);
          if (!antes) return null;
          return editarContato(c, [olha(pedido, "ver")], antes, r.valor);
        });
        if (!feito) return naoEncontrado(resposta);
        const alvo = { tipo: "contato", id };
        const situacao = r.valor.situacao;
        if (feito.campos.includes("situacao"))
          await registrar(
            pedido,
            situacao === "arquivado" ? "contato.arquivou" : "contato.desarquivou",
            alvo,
          );
        const outros = feito.campos.filter((x) => x !== "situacao");
        if (outros.length > 0) await registrar(pedido, "contato.editou", alvo, { campos: outros });
        return { contato: feito.contato, repetidos: feito.repetidos };
      });
    },
  );

  app.post(
    "/contatos/juntar",
    { preHandler: verificador.exigir("contatos", "aprovar") },
    async (pedido, resposta) => {
      const r = conferirPedidoDeJuntar(pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          const q = [olha(pedido, "aprovar")];
          const fica = await buscarContato(c, q, r.valor.ficaId, true);
          const sai = await buscarContato(c, q, r.valor.saiId, true);
          if (!fica || !sai) return null;
          return juntarContatos(c, fica, sai, r.valor.nome);
        });
        if (!feito) return naoEncontrado(resposta);
        await registrar(
          pedido,
          "contato.juntou",
          { tipo: "contato", id: r.valor.ficaId },
          { saiId: r.valor.saiId },
        );
        return { contato: feito };
      });
    },
  );

  app.delete(
    "/contatos/:id",
    { preHandler: verificador.exigir("contatos", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      if (!podeFazerAcaoPerigosa(sessao.estado.dois, sessao.estado.confirmadoEm, sessao.metodo))
        return pedeConfirmacao(resposta);
      const feito = await naEmpresa(pedido, async (c) => {
        const contato = await buscarContato(c, [olha(pedido, "excluir")], id, true);
        if (!contato) return false;
        return apagarContato(c, id);
      });
      if (!feito) return naoEncontrado(resposta);
      await registrar(pedido, "contato.apagou", { tipo: "contato", id });
      return { ok: true };
    },
  );

  // Contatos ligados a tarefas e projetos ---------------------------------------------------------------------

  app.get(
    "/tarefas/:id/contatos",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await buscarTarefa(c, quemDoPedido(pedido), id))) return null;
        return {
          contatos: await contatosLigados(c, [olha(pedido, "ver")], { tipo: "tarefa", id }),
          podeVer: olha(pedido, "ver").alcance !== "nada",
        };
      });
      if (!feito)
        return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Tarefa não encontrada." });
      return feito;
    },
  );

  app.post(
    "/tarefas/:id/contatos",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeContatosLigados, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (olha(pedido, "ver").alcance === "nada")
        return resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Você não vê os contatos." });
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          if (!(await buscarTarefa(c, quemDoPedido(pedido), id, true))) return null;
          const ids = await ligarContatos(c, [olha(pedido, "ver")], { tipo: "tarefa", id }, r.valor.contatos);
          return { contatos: await resumosDe(c, [olha(pedido, "ver")], ids) };
        });
        if (!feito)
          return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Tarefa não encontrada." });
        await registrar(
          pedido,
          "contato.ligou_tarefa",
          { tipo: "tarefa", id },
          { contatos: r.valor.contatos },
        );
        return feito;
      });
    },
  );

  /** O alcance de projeto de quem pede para a ação: tudo, só os que é diretor (editar) ou membro (ver). */
  const alcanceDoProjeto = (pedido: FastifyRequest, acao: "ver" | "editar"): AlcanceDeProjeto | null => {
    const a = acessoDo(pedido).permissoes.modulos.get("projetos")?.acoes[acao] ?? "nada";
    if (a === "nada") return null;
    if (a === "tudo") return "todos";
    return acao === "editar" ? "diretor" : "membro";
  };

  app.get(
    "/projetos/:id/contatos",
    { preHandler: verificador.exigir("projetos", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const alcance = alcanceDoProjeto(pedido, "ver");
      const feito = await naEmpresa(pedido, async (c) => {
        if (!alcance || !(await buscarProjeto(c, acessoDo(pedido).sessao.pessoa.id, alcance, id)))
          return null;
        return {
          contatos: await contatosLigados(c, [olha(pedido, "ver")], { tipo: "projeto", id }),
          podeVer: olha(pedido, "ver").alcance !== "nada",
        };
      });
      if (!feito)
        return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Projeto não encontrado." });
      return feito;
    },
  );

  app.post(
    "/projetos/:id/contatos",
    { preHandler: verificador.exigir("projetos", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeContatosLigados, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (olha(pedido, "ver").alcance === "nada")
        return resposta.code(403).send({ code: "SEM_PERMISSAO", message: "Você não vê os contatos." });
      const alcance = alcanceDoProjeto(pedido, "editar");
      return tratar(resposta, async () => {
        const feito = await naEmpresa(pedido, async (c) => {
          if (!alcance || !(await buscarProjeto(c, acessoDo(pedido).sessao.pessoa.id, alcance, id, true)))
            return null;
          const ids = await ligarContatos(
            c,
            [olha(pedido, "ver")],
            { tipo: "projeto", id },
            r.valor.contatos,
          );
          return { contatos: await resumosDe(c, [olha(pedido, "ver")], ids) };
        });
        if (!feito)
          return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Projeto não encontrado." });
        await registrar(
          pedido,
          "contato.ligou_projeto",
          { tipo: "projeto", id },
          { contatos: r.valor.contatos },
        );
        return feito;
      });
    },
  );

  // Visões salvas dos contatos (de cada pessoa) ------------------------------------------------------------------

  app.get("/contatos-visoes", { preHandler: verificador.exigir("contatos", "ver") }, async (pedido) =>
    naEmpresa(pedido, async (c) => ({ visoes: await listarVisoesDeContatos(c) })),
  );

  app.post(
    "/contatos-visoes",
    { preHandler: verificador.exigir("contatos", "ver") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeVisaoDeContatos, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      return tratar(resposta, async () =>
        resposta.code(201).send(await naEmpresa(pedido, (c) => salvarVisaoDeContatos(c, r.valor))),
      );
    },
  );

  app.delete(
    "/contatos-visoes/:id",
    { preHandler: verificador.exigir("contatos", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const ok = await naEmpresa(pedido, (c) => apagarVisaoDeContatos(c, id));
      if (!ok) return resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Visão não encontrada." });
      return { ok: true };
    },
  );
}
