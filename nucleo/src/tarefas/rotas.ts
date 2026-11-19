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
  PedidoDeDestravar,
  PedidoDeMudarProjeto,
  PedidoDeTarefa,
  PedidoDeTrocarResponsavel,
  type Responsavel,
  STATUS_ENCERRADOS,
  type StatusTarefa,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { agenteRecebeTarefas } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { type AlcanceDeProjeto, buscarProjeto } from "../projetos/servico.ts";
import {
  autorDe,
  buscarTarefa,
  comentar,
  criarTarefa,
  excluirTarefa,
  idsCitados,
  listarComentarios,
  listarTarefas,
  mudarProjetoDaTarefa,
  mudarStatus,
  nomesCitados,
  pegarTarefa,
  pessoaAtivaNaEmpresa,
  type Quem,
  tirarTrava,
  travadaPorQuem,
  trocarResponsavel,
} from "./servico.ts";

type AcaoDeTarefa = (typeof ACOES_TAREFAS)[number] | "tarefa.mudou_projeto";

const naoEncontrada = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "TAREFA_NAO_ENCONTRADA", message: "Tarefa não encontrada." });

const travada = (resposta: FastifyReply) =>
  resposta.code(409).send({
    code: "TAREFA_TRAVADA",
    message: "Essa tarefa está em andamento com outro responsável. Você ainda pode comentar.",
  });

const projetoInvalido = (resposta: FastifyReply) =>
  resposta
    .code(400)
    .send({ code: "PROJETO_INVALIDO", message: "Escolha um projeto ativo que você pode ver." });

const invalido = (resposta: FastifyReply, problemas: unknown) =>
  resposta.code(400).send({ code: "PEDIDO_INVALIDO", problemas });

/**
 * Quem pede e o alcance da ação. Além do alcance, a pessoa alcança as tarefas dos projetos em que é membro (M3-01);
 * quem vê todos os projetos (administrador, gestor) também vê as tarefas de todos, mas só mexe nas que o alcance
 * da ação ou ser membro do projeto permitem.
 */
function quemDoPedido(pedido: FastifyRequest): Quem {
  const { sessao, filtro, acao, permissoes } = acessoDo(pedido);
  const veTodosProjetos = permissoes.modulos.get("projetos")?.acoes.ver === "tudo";
  return {
    tipo: "pessoa",
    pessoaId: sessao.pessoa.id,
    filtro,
    projetos: acao === "ver" && veTodosProjetos ? "todos" : "membro",
  };
}

/** Até onde a pessoa alcança os projetos para pôr uma tarefa neles: o "ver" do módulo projetos. */
function projetosQueAlcanca(pedido: FastifyRequest): AlcanceDeProjeto | null {
  const ver = acessoDo(pedido).permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
  if (ver === "nada") return null;
  return ver === "tudo" ? "todos" : "membro";
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
    if (r.tipo === "agente") {
      return (await agenteRecebeTarefas(c, r.agenteId))
        ? null
        : "Esse agente não está ativo nesta empresa (pausado ou desligado não recebe tarefa nova).";
    }
    return (await pessoaAtivaNaEmpresa(c, r.pessoaId)) ? null : "Essa pessoa não está ativa nesta empresa.";
  }

  app.get("/tarefas", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const q = pedido.query as { minhas?: string | string[]; status?: string | string[]; projeto?: string };
    const status = [q.status ?? []]
      .flat()
      .flatMap((s) => s.split(","))
      .filter(Boolean);
    const filtro = {
      ...([q.minhas].flat().some((m) => m === "1" || m === "true") ? { minhas: true } : {}),
      ...(status.length > 0 ? { status } : {}),
      ...(typeof q.projeto === "string" && q.projeto ? { projetoId: q.projeto } : {}),
    };
    const r = conferir(FiltroDeTarefas, filtro);
    if (!r.ok) return invalido(resposta, r.problemas);
    const quem = quemDoPedido(pedido);
    return naEmpresa(pedido, async (c) => {
      const tarefas = await listarTarefas(c, quem, r.valor);
      return { tarefas, nomes: await nomesCitados(c, idsCitados(tarefas)) };
    });
  });

  app.post("/tarefas", { preHandler: verificador.exigir("tarefas", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeTarefa, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const quem = quemDoPedido(pedido);
    const { sessao } = acessoDo(pedido);
    const projetoId = r.valor.projetoId ?? null;
    const alcanceDosProjetos = projetosQueAlcanca(pedido);
    // Sem responsável informado, a tarefa fica com quem criou. "null" de propósito: fica sem responsável.
    let responsavel: Responsavel | null =
      r.valor.responsavel === undefined
        ? { tipo: "pessoa", pessoaId: sessao.pessoa.id }
        : r.valor.responsavel;
    const feito = await naEmpresa(pedido, async (c) => {
      if (projetoId !== null) {
        const projeto = alcanceDosProjetos
          ? await buscarProjeto(c, sessao.pessoa.id, alcanceDosProjetos, projetoId)
          : null;
        if (projeto?.situacao !== "ativo") return { semProjeto: true as const };
        // Sem responsável, o gerente do projeto recebe a tarefa, se o diretor quis assim e ele está ativo.
        if (responsavel === null && projeto.gerenteRecebeSemResponsavel && projeto.gerente) {
          if ((await responsavelRecusado(c, projeto.gerente)) === null) responsavel = projeto.gerente;
        }
      }
      const recusa = await responsavelRecusado(c, responsavel);
      if (recusa) return { recusa };
      return {
        tarefa: await criarTarefa(c, quem, {
          titulo: r.valor.titulo,
          descricao: r.valor.descricao ?? null,
          responsavel,
          projetoId,
        }),
      };
    });
    if ("semProjeto" in feito) return projetoInvalido(resposta);
    if ("recusa" in feito)
      return resposta.code(400).send({ code: "RESPONSAVEL_INVALIDO", message: feito.recusa });
    await registrar(pedido, "tarefa.criou", feito.tarefa.id, {
      responsavel: responsavel?.tipo ?? null,
      projetoId,
    });
    return resposta.code(201).send(feito.tarefa);
  });

  app.get("/tarefas/:id", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const quem = quemDoPedido(pedido);
    const achou = await naEmpresa(pedido, async (c) => {
      const tarefa = await buscarTarefa(c, quem, id);
      if (!tarefa) return null;
      const comentarios = await listarComentarios(c, tarefa.id);
      return { tarefa, comentarios, nomes: await nomesCitados(c, idsCitados([tarefa], comentarios)) };
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
        // Travada: só quem pegou muda o status e entrega o resultado (M2-02).
        if (tarefa.trava && !travadaPorQuem(tarefa, quem)) return { travada: true as const };
        const de: StatusTarefa = tarefa.status;
        // Tarefa encerrada só sai daqui reabrindo (volta para A fazer).
        if (STATUS_ENCERRADOS.includes(de) && r.valor.status !== de && r.valor.status !== "a_fazer") {
          return { recusa: "Para mexer numa tarefa encerrada, reabra antes." };
        }
        // Mesmo status sem resultado novo: nada muda (e o resultado entregue não se perde).
        const mudou = r.valor.status !== de || r.valor.resultado !== undefined;
        // Pôr em andamento uma tarefa livre é pegá-la: não existe "em andamento" sem alguém com ela.
        const pegou = mudou && !tarefa.trava && ["em_andamento", "precisa_de_ajuda"].includes(r.valor.status);
        // Quem pegou e volta para A fazer está soltando a tarefa.
        const soltou = mudou && tarefa.trava !== null && r.valor.status === "a_fazer";
        let nova = tarefa;
        if (pegou) {
          const pegada = await pegarTarefa(c, quem, tarefa.id);
          if (!pegada) return { travada: true as const };
          nova = pegada;
        }
        if (mudou && (!pegou || nova.status !== r.valor.status)) {
          nova = await mudarStatus(c, quem, nova, r.valor.status, r.valor.resultado ?? null);
        }
        const comentario = r.valor.motivo
          ? await comentar(c, autorDe(quem), tarefa.id, r.valor.motivo)
          : null;
        return { tarefa: nova, de, mudou, pegou, soltou, comentario };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      if ("recusa" in feito)
        return resposta.code(409).send({ code: "TAREFA_ENCERRADA", message: feito.recusa });
      if (feito.comentario) {
        await registrar(pedido, "tarefa.comentou", id, { comentarioId: feito.comentario.id });
      }
      if (feito.pegou) await registrar(pedido, "tarefa.pegou", id);
      if (feito.soltou) await registrar(pedido, "tarefa.soltou", id);
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
        if (tarefa.trava && !travadaPorQuem(tarefa, quem)) return { travada: true as const };
        const recusa = await responsavelRecusado(c, r.valor.responsavel);
        if (recusa) return { recusa };
        return {
          tarefa: await trocarResponsavel(c, quem, tarefa, r.valor.responsavel),
          soltou: tarefa.trava !== null,
        };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      if ("recusa" in feito)
        return resposta.code(400).send({ code: "RESPONSAVEL_INVALIDO", message: feito.recusa });
      await registrar(pedido, "tarefa.trocou_responsavel", id, {
        responsavel: r.valor.responsavel?.tipo ?? null,
      });
      if (feito.soltou) await registrar(pedido, "tarefa.soltou", id);
      return feito.tarefa;
    },
  );

  // Mudar de projeto (M3-01): pede "editar" na tarefa e alcançar o projeto novo. Não mexe na trava.
  app.post(
    "/tarefas/:id/projeto",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeMudarProjeto, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const { sessao } = acessoDo(pedido);
      const alcanceDosProjetos = projetosQueAlcanca(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (r.valor.projetoId !== null) {
          const projeto = alcanceDosProjetos
            ? await buscarProjeto(c, sessao.pessoa.id, alcanceDosProjetos, r.valor.projetoId)
            : null;
          if (projeto?.situacao !== "ativo") return { semProjeto: true as const };
        }
        if (tarefa.projetoId === r.valor.projetoId) return { tarefa, de: tarefa.projetoId, mudou: false };
        return {
          tarefa: await mudarProjetoDaTarefa(c, tarefa.id, r.valor.projetoId),
          de: tarefa.projetoId,
          mudou: true,
        };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("semProjeto" in feito) return projetoInvalido(resposta);
      if (feito.mudou) {
        await registrar(pedido, "tarefa.mudou_projeto", id, { de: feito.de, para: feito.tarefa.projetoId });
      }
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

  // Pegar (M2-02): só um consegue, garantido no banco. Quem pega vira o responsável.
  app.post(
    "/tarefas/:id/pegar",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id);
        if (!tarefa) return null;
        // Pegar de novo o que já é seu (clique duplo, nova tentativa) não é erro.
        if (travadaPorQuem(tarefa, quem)) return { tarefa, jaEra: true };
        return { tarefa: await pegarTarefa(c, quem, tarefa.id), jaEra: false };
      });
      if (!feito) return naoEncontrada(resposta);
      if (feito.jaEra) return feito.tarefa;
      if (!feito.tarefa) {
        return resposta.code(409).send({
          code: "TAREFA_INDISPONIVEL",
          message: "Essa tarefa já foi pegada por outro ou está encerrada.",
        });
      }
      await registrar(pedido, "tarefa.pegou", id);
      return feito.tarefa;
    },
  );

  // Soltar: quem pegou devolve a tarefa para A fazer, sem resultado.
  app.post(
    "/tarefas/:id/soltar",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (!travadaPorQuem(tarefa, quem)) return { naoE: true as const };
        return { tarefa: await tirarTrava(c, tarefa.id) };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("naoE" in feito) {
        return resposta
          .code(409)
          .send({ code: "NAO_PEGOU", message: "Só quem pegou a tarefa pode soltá-la." });
      }
      await registrar(pedido, "tarefa.soltou", id);
      return feito.tarefa;
    },
  );

  // Destravar: o administrador (ação "aprovar" das tarefas) tira a trava de outro, com motivo, que vira
  // comentário. A tarefa volta para A fazer.
  app.post(
    "/tarefas/:id/destravar",
    { preHandler: verificador.exigir("tarefas", "aprovar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeDestravar, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (!tarefa.trava) return { livre: true as const };
        const nova = await tirarTrava(c, tarefa.id);
        const comentario = await comentar(c, autorDe(quem), tarefa.id, `Destravou: ${r.valor.motivo}`);
        return { tarefa: nova, de: tarefa.trava.por, comentario };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("livre" in feito) {
        return resposta.code(409).send({ code: "NAO_TRAVADA", message: "Essa tarefa não está travada." });
      }
      await registrar(pedido, "tarefa.comentou", id, { comentarioId: feito.comentario.id });
      await registrar(pedido, "tarefa.destravou", id, {
        travadaPor: feito.de,
        comentarioId: feito.comentario.id,
      });
      return feito.tarefa;
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
        if (!tarefa) return "nao" as const;
        // Ninguém apaga a tarefa debaixo de quem está trabalhando nela: destrave antes (fica o motivo).
        if (tarefa.trava && !travadaPorQuem(tarefa, quem)) return "travada" as const;
        await excluirTarefa(c, tarefa.id);
        return "ok" as const;
      });
      if (achou === "nao") return naoEncontrada(resposta);
      if (achou === "travada") return travada(resposta);
      await registrar(pedido, "tarefa.excluiu", id);
      return { ok: true };
    },
  );
}
