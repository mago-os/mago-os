/**
 * Rotas das tarefas (M2-01), para a tela. Cada rota passa pela verificação central (módulo "tarefas"), e o
 * alcance que ela devolve decide quais tarefas a pessoa alcança: o funcionário, as que é responsável ou criou;
 * o gestor, também as da equipe; o administrador, todas. Cada mudança vira evento de auditoria (tarefa.*).
 */
import {
  type ACOES_CHECKLIST,
  type ACOES_LINHA_DO_TEMPO,
  type ACOES_PRAZOS,
  type ACOES_TAREFAS,
  conferir,
  conferirPedidoDeMudarStatus,
  FiltroDeTarefas,
  PedidoDeAdiarPrioridade,
  PedidoDeComentario,
  PedidoDeDestravar,
  PedidoDeEditarComentario,
  PedidoDeEditarItemDeChecklist,
  PedidoDeEtiqueta,
  PedidoDeItemDeChecklist,
  PedidoDeMudarLista,
  PedidoDeMudarProjeto,
  PedidoDePlanejamento,
  PedidoDeResolverPrioridade,
  PedidoDeTarefa,
  PedidoDeTrocarResponsavel,
  PedidoDeVisaoSalva,
  type PedidoDePlanejamento as Planejamento,
  type Responsavel,
  STATUS_ENCERRADOS,
  type StatusTarefa,
  type Tarefa,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { agenteRecebeTarefas } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarDepois, type EventoDeTarefa } from "../avisos/eventos.ts";
import { deixarDeSeguir, segue, seguir } from "../avisos/notificacoes.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { buscarLista, listarListas, listarStatus } from "../projetos/listas.ts";
import { type AlcanceDeProjeto, buscarProjeto } from "../projetos/servico.ts";
import { buscarItem, criarItem, editarItem, excluirItem, listarChecklist } from "./checklist.ts";
import {
  acontecimentoDaAcao,
  listarAcontecimentos,
  mencionaveis,
  registrarAcontecimento,
} from "./linha-do-tempo.ts";
import {
  criarEtiqueta,
  excluirEtiqueta,
  fusoDaEmpresa,
  listarEtiquetas,
  planejar,
  recorrerSePreciso,
  recusaDoPlanejamento,
} from "./planejamento.ts";
import {
  adiarPrioridade,
  CHAVE_VALIDA,
  hojeDe,
  listarPrioridades,
  resolverPrioridade,
} from "./prioridades.ts";
import {
  apagarComentario,
  autorDe,
  buscarComentario,
  buscarTarefa,
  comentar,
  criarTarefa,
  editarComentario,
  excluirTarefa,
  idsCitados,
  listarComentarios,
  listarSubtarefas,
  listarTarefas,
  mudarListaDaTarefa,
  mudarProjetoDaTarefa,
  mudarStatus,
  nomesCitados,
  pegarTarefa,
  pessoaAtivaNaEmpresa,
  type Quem,
  resumoDasSubtarefas,
  subtarefaTravadaPorOutro,
  tirarTrava,
  travadaPorQuem,
  trocarResponsavel,
} from "./servico.ts";
import { excluirVisao, listarVisoes, salvarVisao } from "./visoes.ts";

type AcaoDeTarefa =
  | (typeof ACOES_TAREFAS)[number]
  | "tarefa.mudou_projeto"
  | (typeof ACOES_CHECKLIST)[number]
  | (typeof ACOES_PRAZOS)[number]
  | (typeof ACOES_LINHA_DO_TEMPO)[number];

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
function quemDoPedido(pedido: FastifyRequest): Extract<Quem, { tipo: "pessoa" }> {
  const { sessao, filtro, acao, permissoes } = acessoDo(pedido);
  const verProjetos = permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
  // Ser membro do projeto vale para ver e mexer nas tarefas dele, não para excluir nem destravar.
  const projetos =
    verProjetos === "nada" || (acao !== "ver" && acao !== "editar")
      ? "nenhum"
      : acao === "ver" && verProjetos === "tudo"
        ? "todos"
        : "membro";
  return { tipo: "pessoa", pessoaId: sessao.pessoa.id, filtro, projetos };
}

/** Até onde a pessoa alcança os projetos para pôr uma tarefa neles: o "ver" do módulo projetos. */
function projetosQueAlcanca(pedido: FastifyRequest): AlcanceDeProjeto | null {
  const ver = acessoDo(pedido).permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
  if (ver === "nada") return null;
  return ver === "tudo" ? "todos" : "membro";
}

/** Lista de valores da query: "a,b" ou várias vezes o mesmo nome. */
function varios(valor: string | string[] | undefined): string[] {
  return [valor ?? []]
    .flat()
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Os filtros da lista a partir da query (M3-04): minhas=1, status=a,b, projeto=<id>|sem, espaco=<id>,
 * responsaveis=p:<id>,a:<id>, agente=1, prioridades=alta,sem, etiquetas=<id>,<id>, prazo=atrasadas|hoje|semana|sem_prazo,
 * de=AAAA-MM-DD, ate=AAAA-MM-DD, subtarefas=0. O resultado é conferido pelo contrato.
 */
export function filtroDaQuery(q: Record<string, string | string[] | undefined>): Record<string, unknown> {
  const um = (n: string) => {
    const x = q[n];
    return typeof x === "string" && x ? x : undefined;
  };
  const sim = (n: string) => varios(q[n]).some((x) => x === "1" || x === "true");
  const status = varios(q.status);
  const prioridades = varios(q.prioridades);
  const etiquetas = varios(q.etiquetas);
  const responsaveis = varios(q.responsaveis).map((r) =>
    r.startsWith("a:")
      ? { tipo: "agente", agenteId: r.slice(2) }
      : { tipo: "pessoa", pessoaId: r.replace(/^p:/, "") },
  );
  return {
    ...(sim("minhas") ? { minhas: true } : {}),
    ...(status.length > 0 ? { status } : {}),
    ...(um("projeto") ? { projetoId: um("projeto") } : {}),
    ...(um("espaco") ? { espacoId: um("espaco") } : {}),
    ...(responsaveis.length > 0 ? { responsaveis } : {}),
    ...(sim("agente") ? { deAgente: true } : {}),
    ...(prioridades.length > 0 ? { prioridades } : {}),
    ...(etiquetas.length > 0 ? { etiquetas } : {}),
    ...(um("prazo") ? { prazo: um("prazo") } : {}),
    ...(um("de") ? { de: um("de") } : {}),
    ...(um("ate") ? { ate: um("ate") } : {}),
    ...(varios(q.subtarefas).some((x) => x === "0" || x === "false") ? { subtarefas: false } : {}),
  };
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

  /** Os avisos e seguidores de um acontecimento (M3-06), depois da mudança. */
  function avisar(pedido: FastifyRequest, e: EventoDeTarefa) {
    const { sessao } = acessoDo(pedido);
    return avisarDepois(
      poolApp,
      sessao.empresaId,
      { tipo: "pessoa", pessoaId: sessao.pessoa.id },
      e,
      pedido.log,
    );
  }

  async function registrar(
    pedido: FastifyRequest,
    acao: AcaoDeTarefa,
    tarefaId: string,
    detalhes: Record<string, unknown> = {},
  ) {
    const { sessao } = acessoDo(pedido);
    // O que interessa a quem acompanha a tarefa entra também na linha do tempo (M3-05).
    const acontecimento = acontecimentoDaAcao(acao, detalhes);
    if (acontecimento) {
      await comEmpresa(poolApp, sessao.empresaId, (c) =>
        registrarAcontecimento(
          c,
          tarefaId,
          { tipo: "pessoa", pessoaId: sessao.pessoa.id },
          acontecimento.tipo,
          acontecimento.detalhes,
        ),
      );
    }
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
    const q = pedido.query as Record<string, string | string[] | undefined>;
    const filtro = filtroDaQuery(q);
    const r = conferir(FiltroDeTarefas, filtro);
    if (!r.ok) return invalido(resposta, r.problemas);
    const quem = quemDoPedido(pedido);
    return naEmpresa(pedido, async (c) => {
      const tarefas = await listarTarefas(c, quem, r.valor);
      return {
        tarefas,
        nomes: await nomesCitados(c, idsCitados(tarefas)),
        subtarefas: await resumoDasSubtarefas(
          c,
          quem,
          tarefas.map((t) => t.id),
        ),
      };
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
    // Prioridade, prazo, início, etiquetas e recorrência (M3-03) podem vir já na criação.
    const plano: Planejamento = {
      ...(r.valor.prioridade !== undefined ? { prioridade: r.valor.prioridade } : {}),
      ...(r.valor.prazo !== undefined ? { prazo: r.valor.prazo } : {}),
      ...(r.valor.inicio !== undefined ? { inicio: r.valor.inicio } : {}),
      ...(r.valor.etiquetas !== undefined ? { etiquetas: r.valor.etiquetas } : {}),
      ...(r.valor.recorrencia !== undefined ? { recorrencia: r.valor.recorrencia } : {}),
    };
    const temPlano = Object.keys(plano).length > 0;
    /** Depois de criar, grava o planejamento e devolve a tarefa como ficou. */
    const comPlano = async (c: pg.PoolClient, tarefa: Tarefa) => {
      if (!temPlano) return tarefa;
      await planejar(c, tarefa, plano, await fusoDaEmpresa(c));
      return (await buscarTarefa(c, { ...quem, filtro: { tipo: "tudo" } }, tarefa.id)) as Tarefa;
    };
    const feito = await naEmpresa(pedido, async (c) => {
      if (temPlano) {
        const recusaDoPlano = await recusaDoPlanejamento(c, null, plano, r.valor.tarefaMaeId !== undefined);
        if (recusaDoPlano) return { recusaDoPlano };
      }
      // Subtarefa (M3-02): precisa alcançar a mãe, que não pode ser subtarefa nem estar com outra pessoa.
      if (r.valor.tarefaMaeId !== undefined) {
        if (r.valor.projetoId !== undefined || r.valor.listaId !== undefined) {
          return {
            semMae: "A subtarefa fica no projeto e na lista da tarefa-mãe: não mande projeto nem lista.",
          };
        }
        const quemVe: Quem = { ...quem, projetos: alcanceDosProjetos ? "membro" : "nenhum" };
        const mae = await buscarTarefa(c, quemVe, r.valor.tarefaMaeId, true);
        if (!mae) return { semMae: "Tarefa-mãe não encontrada." };
        if (mae.tarefaMaeId !== null) return { semMae: "Subtarefa não tem subtarefas (um nível só)." };
        if (STATUS_ENCERRADOS.includes(mae.status))
          return { semMae: "Reabra a tarefa-mãe antes de criar subtarefas." };
        if (mae.projetoId !== null) {
          const projeto = await buscarProjeto(c, sessao.pessoa.id, "todos", mae.projetoId);
          if (projeto?.situacao !== "ativo") return { semProjeto: true as const };
        }
        if (mae.trava && !travadaPorQuem(mae, quem))
          return { semMae: "Essa tarefa está com outro responsável: só quem pegou cria subtarefas." };
        const recusa = await responsavelRecusado(c, responsavel);
        if (recusa) return { recusa };
        const tarefa = await criarTarefa(c, quem, {
          titulo: r.valor.titulo,
          descricao: r.valor.descricao ?? null,
          responsavel,
          tarefaMaeId: mae.id,
        });
        return { tarefa: await comPlano(c, tarefa), mae: mae.id };
      }
      if (projetoId !== null) {
        const projeto = alcanceDosProjetos
          ? await buscarProjeto(c, sessao.pessoa.id, alcanceDosProjetos, projetoId)
          : null;
        if (projeto?.situacao !== "ativo") return { semProjeto: true as const };
        // Sem responsável, o gerente do projeto recebe a tarefa, se o diretor quis assim e ele está ativo.
        if (responsavel === null && projeto.gerenteRecebeSemResponsavel && projeto.gerente) {
          if ((await responsavelRecusado(c, projeto.gerente)) === null) responsavel = projeto.gerente;
        }
        if (r.valor.listaId !== undefined) {
          const lista = await buscarLista(c, r.valor.listaId);
          if (lista?.projetoId !== projetoId) return { semProjeto: true as const };
        }
      } else if (r.valor.listaId !== undefined) return { semProjeto: true as const };
      const recusa = await responsavelRecusado(c, responsavel);
      if (recusa) return { recusa };
      return {
        tarefa: await comPlano(
          c,
          await criarTarefa(c, quem, {
            titulo: r.valor.titulo,
            descricao: r.valor.descricao ?? null,
            responsavel,
            projetoId,
            listaId: r.valor.listaId ?? null,
          }),
        ),
        mae: null,
      };
    });
    if ("recusaDoPlano" in feito)
      return resposta.code(400).send({ code: "PLANEJAMENTO_INVALIDO", message: feito.recusaDoPlano });
    if ("semMae" in feito)
      return resposta.code(400).send({ code: "SUBTAREFA_INVALIDA", message: feito.semMae });
    if ("semProjeto" in feito) return projetoInvalido(resposta);
    if ("recusa" in feito)
      return resposta.code(400).send({ code: "RESPONSAVEL_INVALIDO", message: feito.recusa });
    await registrar(pedido, "tarefa.criou", feito.tarefa.id, {
      responsavel: responsavel?.tipo ?? null,
      projetoId: feito.tarefa.projetoId,
      prioridade: feito.tarefa.prioridade,
      prazo: feito.tarefa.prazo?.dia ?? null,
      recorrente: feito.tarefa.recorrencia !== null,
    });
    if (feito.mae)
      await registrar(pedido, "tarefa.criou_subtarefa", feito.mae, { subtarefaId: feito.tarefa.id });
    await avisar(pedido, { tipo: "criou", tarefa: feito.tarefa });
    return resposta.code(201).send(feito.tarefa);
  });

  app.get("/tarefas/:id", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const { id } = pedido.params as { id: string };
    const quem = quemDoPedido(pedido);
    const achou = await naEmpresa(pedido, async (c) => {
      const tarefa = await buscarTarefa(c, quem, id);
      if (!tarefa) return null;
      const comentarios = await listarComentarios(c, tarefa.id);
      const subtarefas = await listarSubtarefas(c, tarefa.id);
      const checklist = await listarChecklist(c, tarefa.id);
      const status = tarefa.projetoId ? await listarStatus(c, tarefa.projetoId) : [];
      const listas = tarefa.projetoId ? await listarListas(c, tarefa.projetoId) : [];
      const acontecimentos = await listarAcontecimentos(c, tarefa.id);
      const seguindo = await segue(c, tarefa.id, quem.pessoaId);
      const marcaram = checklist.flatMap((i) => (i.marcadoPor ? [i.marcadoPor] : []));
      return {
        tarefa,
        comentarios,
        subtarefas,
        checklist,
        status,
        listas,
        acontecimentos,
        seguindo,
        nomes: await nomesCitados(c, [
          ...acontecimentos.flatMap((a) =>
            a.autor.tipo === "pessoa"
              ? [a.autor.pessoaId]
              : a.autor.tipo === "agente"
                ? [a.autor.agenteId]
                : [],
          ),
          ...comentarios.flatMap((cm) =>
            cm.mencoes.map((m) => (m.tipo === "pessoa" ? m.pessoaId : m.agenteId)),
          ),
          ...idsCitados([tarefa, ...subtarefas], comentarios),
          ...marcaram.flatMap((a) =>
            a.tipo === "pessoa" ? [a.pessoaId] : a.tipo === "agente" ? [a.agenteId] : [],
          ),
        ]),
      };
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
        // Status do projeto (M3-02): precisa ser deste projeto e do mesmo tipo.
        const statusId = r.valor.statusId ?? null;
        if (statusId !== null) {
          const doProjeto = tarefa.projetoId ? await listarStatus(c, tarefa.projetoId) : [];
          if (!doProjeto.some((s) => s.id === statusId && s.tipo === r.valor.status)) {
            return { statusInvalido: true as const };
          }
        }
        // Mesmo status sem resultado novo: nada muda (e o resultado entregue não se perde).
        const mudou =
          r.valor.status !== de ||
          r.valor.resultado !== undefined ||
          (statusId !== null && statusId !== tarefa.statusDoProjetoId);
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
          nova = await mudarStatus(c, quem, nova, r.valor.status, r.valor.resultado ?? null, statusId);
        } else if (pegou && statusId !== null && nova.statusDoProjetoId !== statusId) {
          nova = await mudarStatus(c, quem, nova, nova.status, null, statusId);
        }
        const comentario = r.valor.motivo
          ? await comentar(c, autorDe(quem), tarefa.id, r.valor.motivo)
          : null;
        // Concluiu uma recorrente: nasce a próxima (M3-03).
        const proxima = mudou && de !== "concluida" ? await recorrerSePreciso(c, nova) : null;
        return { tarefa: nova, de, mudou, pegou, soltou, comentario, proxima };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      if ("statusInvalido" in feito) {
        return resposta
          .code(400)
          .send({ code: "STATUS_INVALIDO", message: "Escolha um status deste projeto, do mesmo tipo." });
      }
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
          statusDoProjetoId: feito.tarefa.statusDoProjetoId,
          comResultado: feito.tarefa.resultado !== null,
        });
      }
      if (feito.proxima) {
        await registrar(pedido, "tarefa.recorreu", id, {
          proximaId: feito.proxima,
          ocorrencia: feito.tarefa.ocorrencia + 1,
        });
      }
      if (feito.pegou) await avisar(pedido, { tipo: "pegou", tarefa: feito.tarefa });
      if (feito.mudou) await avisar(pedido, { tipo: "mudou_status", tarefa: feito.tarefa, de: feito.de });
      return feito.tarefa;
    },
  );

  // Seguir e deixar de seguir (M3-06): quem vê a tarefa pode seguir e recebe os comentários dela.
  const mudarSeguir = (ligar: boolean) => async (pedido: FastifyRequest, resposta: FastifyReply) => {
    const { id } = pedido.params as { id: string };
    const quem = quemDoPedido(pedido);
    const ok = await naEmpresa(pedido, async (c) => {
      const tarefa = await buscarTarefa(c, quem, id);
      if (!tarefa) return false;
      if (ligar) await seguir(c, tarefa.id, [quem.pessoaId]);
      else await deixarDeSeguir(c, tarefa.id, quem.pessoaId);
      return true;
    });
    return ok ? { seguindo: ligar } : naoEncontrada(resposta);
  };
  app.post("/tarefas/:id/seguir", { preHandler: verificador.exigir("tarefas", "ver") }, mudarSeguir(true));
  app.delete("/tarefas/:id/seguir", { preHandler: verificador.exigir("tarefas", "ver") }, mudarSeguir(false));

  // Mudar de lista (M3-02), no mesmo projeto. A subtarefa segue a mãe e não muda sozinha.
  app.post(
    "/tarefas/:id/lista",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeMudarLista, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (tarefa.tarefaMaeId !== null) return { recusa: "A subtarefa fica sempre na lista da tarefa-mãe." };
        if (tarefa.trava && !travadaPorQuem(tarefa, quem))
          return { recusa: "Essa tarefa está com outro responsável: só quem pegou muda a lista." };
        const lista = await buscarLista(c, r.valor.listaId);
        if (!lista || lista.projetoId !== tarefa.projetoId)
          return { recusa: "Escolha uma lista do projeto da tarefa." };
        if (tarefa.listaId === lista.id) return { tarefa, de: tarefa.listaId, mudou: false };
        return { tarefa: await mudarListaDaTarefa(c, tarefa.id, lista.id), de: tarefa.listaId, mudou: true };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito)
        return resposta.code(400).send({ code: "LISTA_INVALIDA", message: feito.recusa });
      if (feito.mudou)
        await registrar(pedido, "tarefa.mudou_lista", id, { de: feito.de, para: feito.tarefa.listaId });
      return feito.tarefa;
    },
  );

  // Checklist (M3-02): quem mexe na tarefa mexe no checklist; travada, só quem pegou.
  app.post(
    "/tarefas/:id/checklist",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeItemDeChecklist, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (tarefa.trava && !travadaPorQuem(tarefa, quem)) return { travada: true as const };
        return { item: await criarItem(c, tarefa.id, r.valor.texto) };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      await registrar(pedido, "checklist.editou", id, { itemId: feito.item.id, mudanca: "criou" });
      return resposta.code(201).send(feito.item);
    },
  );

  app.post(
    "/tarefas/:id/checklist/:itemId",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id, itemId } = pedido.params as { id: string; itemId: string };
      const r = conferir(PedidoDeEditarItemDeChecklist, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (tarefa.trava && !travadaPorQuem(tarefa, quem)) return { travada: true as const };
        const item = await buscarItem(c, tarefa.id, itemId);
        if (!item) return null;
        return { antes: item, item: await editarItem(c, item, r.valor, autorDe(quem)) };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      if (feito.antes.marcado !== feito.item.marcado) {
        await registrar(pedido, "checklist.marcou", id, { itemId, marcado: feito.item.marcado });
      }
      if (feito.antes.texto !== feito.item.texto || feito.antes.ordem !== feito.item.ordem) {
        await registrar(pedido, "checklist.editou", id, { itemId, mudanca: "editou" });
      }
      return feito.item;
    },
  );

  app.delete(
    "/tarefas/:id/checklist/:itemId",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id, itemId } = pedido.params as { id: string; itemId: string };
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (tarefa.trava && !travadaPorQuem(tarefa, quem)) return { travada: true as const };
        const item = await buscarItem(c, tarefa.id, itemId);
        if (!item) return null;
        await excluirItem(c, item);
        return { ok: true as const };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      await registrar(pedido, "checklist.editou", id, { itemId, mudanca: "excluiu" });
      return { ok: true };
    },
  );

  // Planejamento (M3-03): prioridade, prazo, início, etiquetas e recorrência. Não é status: a trava não impede.
  app.post(
    "/tarefas/:id/planejamento",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDePlanejamento, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        const recusa = await recusaDoPlanejamento(c, tarefa, r.valor);
        if (recusa) return { recusa };
        const mudou = await planejar(c, tarefa, r.valor, await fusoDaEmpresa(c));
        return { mudou, tarefa: (await buscarTarefa(c, quem, id)) ?? tarefa };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito)
        return resposta.code(400).send({ code: "PLANEJAMENTO_INVALIDO", message: feito.recusa });
      const t = feito.tarefa;
      if (feito.mudou.prioridade)
        await registrar(pedido, "tarefa.mudou_prioridade", id, { para: t.prioridade });
      if (feito.mudou.prazo) {
        await registrar(pedido, "tarefa.mudou_prazo", id, {
          dia: t.prazo?.dia ?? null,
          hora: t.prazo?.hora ?? null,
        });
      }
      if (feito.mudou.etiquetas)
        await registrar(pedido, "tarefa.mudou_etiquetas", id, { etiquetas: t.etiquetas });
      if (feito.mudou.recorrencia) {
        await registrar(pedido, "tarefa.mudou_recorrencia", id, {
          frequencia: t.recorrencia?.frequencia ?? null,
        });
      }
      return t;
    },
  );

  // Central de prioridades (M3-07): calculada na hora; adiar e resolver são só da pessoa (sem auditoria).
  app.get("/prioridades", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) => {
    const quem = quemDoPedido(pedido);
    // "hoje" no fuso da pessoa: a tela calcula amanhã e segunda a partir dele, como o servidor confere.
    return naEmpresa(pedido, async (c) => ({
      itens: await listarPrioridades(c, quem),
      hoje: await hojeDe(c, quem.pessoaId),
    }));
  });

  const chaveInvalida = (resposta: FastifyReply) =>
    resposta.code(400).send({ code: "ITEM_INVALIDO", message: "Esse item não está na central." });

  app.post(
    "/prioridades/adiar",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeAdiarPrioridade, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (!CHAVE_VALIDA.test(r.valor.chave)) return chaveInvalida(resposta);
      const { sessao } = acessoDo(pedido);
      const adiou = await naEmpresa(pedido, (c) =>
        adiarPrioridade(c, sessao.pessoa.id, r.valor.chave, r.valor.ate),
      );
      if (!adiou) {
        return resposta.code(400).send({ code: "DATA_INVALIDA", message: "Escolha um dia depois de hoje." });
      }
      return resposta.code(204).send();
    },
  );

  app.post(
    "/prioridades/resolver",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeResolverPrioridade, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      if (!CHAVE_VALIDA.test(r.valor.chave)) return chaveInvalida(resposta);
      const { sessao } = acessoDo(pedido);
      await naEmpresa(pedido, (c) => resolverPrioridade(c, sessao.pessoa.id, r.valor.chave));
      return resposta.code(204).send();
    },
  );

  // Visões salvas (M3-04): pessoais; o banco só mostra a cada pessoa as dela.
  app.get("/visoes", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) =>
    naEmpresa(pedido, async (c) => ({ visoes: await listarVisoes(c) })),
  );

  app.post("/visoes", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeVisaoSalva, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const visao = await naEmpresa(pedido, (c) => salvarVisao(c, r.valor));
    return resposta.code(201).send(visao);
  });

  app.delete(
    "/visoes/:id",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const ok = await naEmpresa(pedido, (c) => excluirVisao(c, id));
      if (!ok)
        return resposta.code(404).send({ code: "VISAO_NAO_ENCONTRADA", message: "Visão não encontrada." });
      return { ok: true };
    },
  );

  // Etiquetas da empresa (M3-03): todos que veem tarefas veem; quem edita tarefas cria; só quem exclui todas apaga.
  app.get("/etiquetas", { preHandler: verificador.exigir("tarefas", "ver") }, async (pedido) =>
    naEmpresa(pedido, async (c) => ({ etiquetas: await listarEtiquetas(c) })),
  );

  app.post(
    "/etiquetas",
    { preHandler: verificador.exigir("tarefas", "editar") },
    async (pedido, resposta) => {
      const r = conferir(PedidoDeEtiqueta, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const etiqueta = await naEmpresa(pedido, (c) => criarEtiqueta(c, r.valor.nome, r.valor.cor));
      if (!etiqueta) {
        return resposta
          .code(409)
          .send({ code: "ETIQUETA_REPETIDA", message: "Já existe uma etiqueta com esse nome." });
      }
      const { sessao } = acessoDo(pedido);
      await auditar(
        poolApp,
        {
          empresaId: sessao.empresaId,
          ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
          acao: "etiqueta.criou",
          alvo: { tipo: "etiqueta", id: etiqueta.id },
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
          detalhes: {},
        },
        pedido.log,
      );
      return resposta.code(201).send(etiqueta);
    },
  );

  app.delete(
    "/etiquetas/:id",
    { preHandler: verificador.exigir("tarefas", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao, filtro } = acessoDo(pedido);
      // A etiqueta é da empresa toda: só quem exclui qualquer tarefa (o administrador, por padrão) apaga.
      if (filtro.tipo !== "tudo") {
        return resposta
          .code(403)
          .send({ code: "SEM_PERMISSAO", message: "Você não tem permissão para isso." });
      }
      const ok = await naEmpresa(pedido, (c) => excluirEtiqueta(c, id));
      if (!ok)
        return resposta
          .code(404)
          .send({ code: "ETIQUETA_NAO_ENCONTRADA", message: "Etiqueta não encontrada." });
      await auditar(
        poolApp,
        {
          empresaId: sessao.empresaId,
          ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
          acao: "etiqueta.excluiu",
          alvo: { tipo: "etiqueta", id },
          origem: origemDoPedido(pedido),
          rastreio: pedido.id,
          detalhes: {},
        },
        pedido.log,
      );
      return { ok: true };
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
        const chave = (x: Responsavel | null) =>
          x === null ? "" : x.tipo === "pessoa" ? `p:${x.pessoaId}` : `a:${x.agenteId}`;
        return {
          tarefa: await trocarResponsavel(c, quem, tarefa, r.valor.responsavel),
          soltou: tarefa.trava !== null,
          mudouResponsavel: chave(tarefa.responsavel) !== chave(r.valor.responsavel),
        };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("travada" in feito) return travada(resposta);
      if ("recusa" in feito)
        return resposta.code(400).send({ code: "RESPONSAVEL_INVALIDO", message: feito.recusa });
      await registrar(pedido, "tarefa.trocou_responsavel", id, {
        responsavel: r.valor.responsavel?.tipo ?? null,
        para: r.valor.responsavel,
      });
      if (feito.soltou) await registrar(pedido, "tarefa.soltou", id);
      if (feito.mudouResponsavel) await avisar(pedido, { tipo: "trocou_responsavel", tarefa: feito.tarefa });
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
        if (tarefa.tarefaMaeId !== null) return { ehSubtarefa: true as const };
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
      if ("ehSubtarefa" in feito) {
        return resposta
          .code(400)
          .send({ code: "SUBTAREFA_INVALIDA", message: "A subtarefa fica sempre no projeto da tarefa-mãe." });
      }
      if ("semProjeto" in feito) return projetoInvalido(resposta);
      if (feito.mudou) {
        await registrar(pedido, "tarefa.mudou_projeto", id, { de: feito.de, para: feito.tarefa.projetoId });
      }
      return feito.tarefa;
    },
  );

  // Comentar pede só "ver": quem alcança a tarefa pode comentar, mesmo travada por outro (M2-02). Nota interna e
  // menções com @ entraram na M3-05.
  app.post(
    "/tarefas/:id/comentarios",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeComentario, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const mencoes = r.valor.mencoes ?? [];
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        if (!(await mencionaveis(c, mencoes)))
          return { recusa: "Só dá para mencionar pessoas e agentes desta empresa." };
        const { sessao } = acessoDo(pedido);
        return {
          comentario: await comentar(
            c,
            { tipo: "pessoa", pessoaId: sessao.pessoa.id },
            tarefa.id,
            r.valor.texto,
            {
              tipo: r.valor.interna ? "nota_interna" : "comentario",
              mencoes,
            },
          ),
        };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito)
        return resposta.code(400).send({ code: "MENCAO_INVALIDA", message: feito.recusa });
      const cm = feito.comentario;
      await registrar(pedido, "tarefa.comentou", id, { comentarioId: cm.id, tipo: cm.tipo });
      if (cm.mencoes.length > 0) {
        await registrar(pedido, "tarefa.mencionou", id, {
          comentarioId: cm.id,
          pessoas: cm.mencoes.filter((m) => m.tipo === "pessoa").length,
          agentes: cm.mencoes.filter((m) => m.tipo === "agente").length,
        });
      }
      const tarefaComentada = await naEmpresa(pedido, (c) => buscarTarefa(c, quem, id));
      if (tarefaComentada)
        await avisar(pedido, { tipo: "comentou", tarefa: tarefaComentada, comentario: cm });
      return resposta.code(201).send(cm);
    },
  );

  // Editar o próprio comentário em até 15 minutos (M3-05).
  app.post(
    "/tarefas/:id/comentarios/:comentarioId",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id, comentarioId } = pedido.params as { id: string; comentarioId: string };
      const r = conferir(PedidoDeEditarComentario, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const quem = quemDoPedido(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        const cm = await buscarComentario(c, tarefa.id, comentarioId);
        if (!cm) return null;
        if (cm.autor.tipo !== "pessoa" || cm.autor.pessoaId !== quem.pessoaId) {
          return { recusa: "Só quem escreveu edita o comentário." };
        }
        if (cm.apagadoEm) return { recusa: "Comentário apagado não se edita." };
        if (Date.now() - new Date(cm.criadoEm).getTime() > 15 * 60_000) {
          return { recusa: "Passou o prazo de 15 minutos para editar." };
        }
        return { comentario: await editarComentario(c, cm.id, r.valor.texto) };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito) return resposta.code(409).send({ code: "NAO_EDITA", message: feito.recusa });
      await registrar(pedido, "tarefa.editou_comentario", id, { comentarioId });
      return feito.comentario;
    },
  );

  // Apagar: quem escreveu, ou quem exclui qualquer tarefa (o administrador). Fica "comentário apagado" no lugar.
  app.delete(
    "/tarefas/:id/comentarios/:comentarioId",
    { preHandler: verificador.exigir("tarefas", "ver") },
    async (pedido, resposta) => {
      const { id, comentarioId } = pedido.params as { id: string; comentarioId: string };
      const quem = quemDoPedido(pedido);
      const excluiTodas = acessoDo(pedido).permissoes.modulos.get("tarefas")?.acoes.excluir === "tudo";
      const feito = await naEmpresa(pedido, async (c) => {
        const tarefa = await buscarTarefa(c, quem, id, true);
        if (!tarefa) return null;
        const cm = await buscarComentario(c, tarefa.id, comentarioId);
        if (!cm) return null;
        const doAutor = cm.autor.tipo === "pessoa" && cm.autor.pessoaId === quem.pessoaId;
        if (!doAutor && !excluiTodas)
          return { recusa: "Só quem escreveu (ou o administrador) apaga o comentário." };
        if (cm.apagadoEm) return { comentario: cm, jaEstava: true };
        return { comentario: await apagarComentario(c, cm.id), jaEstava: false };
      });
      if (!feito) return naoEncontrada(resposta);
      if ("recusa" in feito) return resposta.code(403).send({ code: "SEM_PERMISSAO", message: feito.recusa });
      if (!feito.jaEstava) await registrar(pedido, "tarefa.apagou_comentario", id, { comentarioId });
      return feito.comentario;
    },
  );

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
      await avisar(pedido, { tipo: "pegou", tarefa: feito.tarefa });
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
        // As subtarefas saem junto: nenhuma pode estar com outra pessoa ou agente trabalhando.
        if (await subtarefaTravadaPorOutro(c, tarefa.id, quem)) return "travada" as const;
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
