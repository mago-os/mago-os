/**
 * Ferramentas dos agentes internos (M4-02, decisão 0023). Cada uma é uma ação do próprio núcleo, com as mesmas
 * regras das telas e do MCP. O agente age com a permissão de quem pediu: a tarefa precisa estar ao alcance dessa
 * pessoa, e o que o agente cria, comenta ou muda fica marcado como do agente. A regra completa (a menor das duas
 * permissões e as ações de alto risco) chega na M4-04; as aprovações, na M4-03.
 */

import {
  type AcaoDeRotina,
  conferir,
  conferirPedidoDeEvento,
  conferirPedidoDeRotina,
  type DeclaracaoDeModulo,
  DIAS_MAXIMOS_DA_LISTAGEM,
  FERRAMENTAS_DO_MCP_NO_ESPECIALISTA,
  FERRAMENTAS_INTERNAS,
  FERRAMENTAS_MCP,
  type MotivoDaPassagem,
  type NomeDeFerramentaInterna,
  type PapelDeAgente,
  type Responsavel,
  type Rotina,
  TAMANHO_MAXIMO_DO_ARQUIVO_DO_TELEGRAM,
  type Tarefa,
} from "@mago-os/contratos";
import type pg from "pg";
import { criarEvento, fusoDaPessoa, listarAgenda, quemVeDe, RecusaDaAgenda } from "../agenda/servico.ts";
import type { OpcoesDaChave } from "../agentes/chaves.ts";
import { avaliarAcao, criarAprovacao } from "../agentes/regras.ts";
import { agenteRecebeTarefas } from "../agentes/servico.ts";
import { criarAnexo, excluirAnexo, listarAnexos, marcarVerificando } from "../anexos/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarDepois } from "../avisos/eventos.ts";
import { buscar as buscarNoMago } from "../busca/index.ts";
import type { FerramentaParaModelo } from "../contas-de-ia/conversa.ts";
import { eFerramentaDeContatos, executarFerramentaDeContatos } from "../contatos/ferramentas.ts";
import { quemOlhaContatos, RecusaDosContatos } from "../contatos/servico.ts";
import {
  completarCliente,
  criarTarefaParaAEquipe,
  FERRAMENTAS_DO_ATENDIMENTO,
  tipoDoAtendimento,
  verFichaDoCliente,
} from "../conversas/atendimento.ts";
import { eFerramentaDeConversas, executarFerramentaDeConversas } from "../conversas/ferramentas.ts";
import { quemOlhaConversas, RecusaDasConversas } from "../conversas/servico.ts";
import { resumoDeCustos } from "../custos/servico.ts";
import { comEmpresa } from "../empresa.ts";
import { idsForaDaEmpresa, NAO_ENCONTRADO_NA_EMPRESA, uuidsDe } from "../ids-da-empresa.ts";
import { skillsDoAgente } from "../instrucoes/servico.ts";
import { type AcaoDeTarefa, executar, RecusaDaFerramenta } from "../mcp/index.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import { type PermissoesNaEmpresa, permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { buscarProjeto, listarProjetos } from "../projetos/servico.ts";
import {
  buscarRotina,
  criarRotina,
  desligarRotina,
  ligarRotina,
  listarExecucoes,
  listarRotinas,
  RecusaDaRotina,
  recusaDaAcao,
} from "../rotinas/servico.ts";
import { criarItem, listarChecklist } from "../tarefas/checklist.ts";
import {
  acontecimentoDaAcao,
  mencoesDoTexto,
  registrarAcontecimento,
  semAcento,
} from "../tarefas/linha-do-tempo.ts";
import { fusoDaEmpresa, planejar, recusaDoPlanejamento } from "../tarefas/planejamento.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import {
  buscarTarefa,
  comentar,
  condicaoDeAlcance,
  criarTarefa,
  idsCitados,
  listarComentarios,
  listarSubtarefas,
  listarTarefas,
  mudarProjetoDaTarefa,
  nomesCitados,
  pessoaAtivaNaEmpresa,
  type Quem,
  trocarResponsavel,
} from "../tarefas/servico.ts";
import { criarExecucao, type ExecucaoComInstrucoes } from "./dados.ts";
import { entregarAoAgenteInterno } from "./tarefa-atribuida.ts";
import {
  type FontesDeTexto,
  haTextoDeOutros,
  marcarTextoDeOutros,
  tarefasNoResultado,
} from "./texto-de-outros.ts";

export interface AgenteQueRoda {
  id: string;
  nome: string;
  papel: PapelDeAgente;
}

export interface ContextoDaFerramenta {
  poolApp: pg.Pool;
  empresaId: string;
  agente: AgenteQueRoda;
  execucao: ExecucaoComInstrucoes;
  /** Permissões de quem pediu (o agente age com elas). */
  permissoes: PermissoesNaEmpresa;
  opcoesMcp: OpcoesDaChave;
  log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  /** Põe uma execução nova na fila (a delegação). */
  acordar(execucaoId: string): void;
  /** Por que o agente está trabalhando (o pedido da pessoa ou as instruções): vai como motivo nas aprovações. */
  motivoDoPedido?: string | null;
  /** Ação aprovada cuja execução de origem não existe mais: a execução do contexto não está no banco. */
  semExecucao?: boolean;
  /**
   * O responsável pelo agente, quando não é quem pediu nem administra (M4-04): o agente só alcança o que quem pediu
   * e ele alcançam. Nulo: vale só a permissão de quem pediu.
   */
  responsavel?: ResponsavelDoAgente | null;
}

export interface ResponsavelDoAgente {
  pessoaId: string;
  permissoes: PermissoesNaEmpresa;
}

/** O que a ferramenta devolveu ao modelo e, se for o fim, o que dizer à pessoa. */
export interface ResultadoDaFerramenta {
  conteudo: unknown;
  fim?: {
    tipo: "responder" | "perguntar";
    texto: string;
    tarefas: string[];
    resumo?: string | null;
    /** Atendimento (M8-06): o agente passou a conversa para uma pessoa. */
    passagem?: { motivo: MotivoDaPassagem; resumo: string; sugestao: string | null };
  };
}

/** As ferramentas de cada papel, no formato que vai para o modelo. */
export function ferramentasDoPapel(papel: PapelDeAgente): FerramentaParaModelo[] {
  const internas = FERRAMENTAS_INTERNAS.filter((f) => (f.papeis as readonly string[]).includes(papel)).map(
    (f) => ({
      nome: f.nome,
      descricao: f.descricao,
      entrada: f.entrada,
    }),
  );
  if (papel !== "especialista") return internas;
  const doMcp = FERRAMENTAS_MCP.filter((f) =>
    (FERRAMENTAS_DO_MCP_NO_ESPECIALISTA as readonly string[]).includes(f.nome),
  ).map((f) => ({ nome: f.nome, descricao: f.descricao, entrada: f.entrada }));
  return [...internas, ...doMcp];
}

/** Quem pediu, como "Quem" das tarefas, para a ação dada (mesma regra das rotas de tarefas). */
export function quemPediu(
  p: PermissoesNaEmpresa,
  pessoaId: string,
  acao: "ver" | "criar" | "editar",
): Quem | null {
  const alcance = p.modulos.get("tarefas")?.acoes[acao] ?? "nada";
  const filtro = filtroDoAlcance(alcance, pessoaId, p.area);
  if (!filtro) return null;
  const verProjetos = p.modulos.get("projetos")?.acoes.ver ?? "nada";
  const projetos =
    verProjetos === "nada" ? "nenhum" : acao === "ver" && verProjetos === "tudo" ? "todos" : "membro";
  return { tipo: "pessoa", pessoaId, filtro, projetos };
}

const ehDoAgente = (t: Tarefa, agenteId: string) =>
  (t.responsavel?.tipo === "agente" && t.responsavel.agenteId === agenteId) ||
  (t.trava?.por.tipo === "agente" && t.trava.por.agenteId === agenteId);

/**
 * O responsável pelo agente para o contexto (M4-04): nulo quando é quem pediu ou quando administra a empresa (alcança
 * tudo). "inativo": o responsável não tem mais vínculo ativo, e o agente não age.
 */
export async function responsavelDoContexto(
  poolApp: pg.Pool,
  empresaId: string,
  responsavelId: string,
  pedidoPor: string,
  catalogo: Map<string, DeclaracaoDeModulo>,
): Promise<ResponsavelDoAgente | null | "inativo"> {
  if (responsavelId === pedidoPor) return null;
  const permissoes = await permissoesNaEmpresa(poolApp, responsavelId, empresaId, catalogo);
  if (!permissoes) return "inativo";
  return permissoes.perfil === "administrador" ? null : { pessoaId: responsavelId, permissoes };
}

/** O texto que cada ferramenta mostrou ao modelo (para a marca de texto de outros, M4-04). */
function fontesDaFerramenta(
  nome: string,
  entrada: Record<string, unknown>,
  conteudo: unknown,
): FontesDeTexto | null {
  const tarefaDaEntrada = typeof entrada.tarefaId === "string" ? [entrada.tarefaId] : [];
  switch (nome) {
    case "responder":
    case "perguntar":
    // Nomes de pessoas e de projetos não contam (decisão 0026: texto de tarefas e anexos).
    case "procurar_pessoa":
    case "procurar_projeto":
    // Os arquivos que a própria pessoa mandou (nome, tipo e tamanho): não é texto de outros.
    case "arquivos_recebidos":
      return null;
    case "ver_tarefa":
      return { tarefasInteiras: tarefaDaEntrada };
    // Contatos (M7-01): a lista mostra só nomes e jeitos de falar (não conta); a ficha mostra as observações.
    case "listar_contatos":
      return null;
    case "ver_contato":
      return typeof entrada.contatoId === "string" ? { contatos: [entrada.contatoId] } : null;
    // Conversas (M8-01): o que o contato escreveu é sempre de fora da empresa, na lista (o começo da última
    // mensagem) e na conversa aberta.
    case "listar_conversas":
    case "ver_conversa":
      return { textoDeFora: true };
    // Atendimento (M8-05): a execução já começa marcada (o texto do cliente é de fora).
    case "ver_ficha_do_cliente":
    case "completar_cliente":
    case "criar_tarefa_para_a_equipe":
    case "responder_ao_cliente":
    case "passar_para_uma_pessoa":
      return null;
    case "buscar": {
      const rs = ((conteudo as { resultados?: unknown[] })?.resultados ?? []) as {
        tipo?: string;
        id?: string;
        link?: string;
      }[];
      const comentarios = rs.filter((x) => x.tipo === "comentario");
      return {
        tarefas: [
          ...rs.filter((x) => x.tipo === "tarefa").flatMap((x) => (x.id ? [x.id] : [])),
          ...comentarios.flatMap((x) => (x.link?.startsWith("/tarefas/") ? [x.link.slice(9)] : [])),
        ],
        comentarios: comentarios.flatMap((x) => (x.id ? [x.id] : [])),
      };
    }
    default:
      return { tarefas: [...tarefaDaEntrada, ...tarefasNoResultado(conteudo)] };
  }
}

/**
 * Executa a ferramenta e, se ela mostrou texto de outra pessoa ou de agente externo, marca a execução: daí em diante,
 * o que muda dados pede aprovação (M4-04, decisão 0026).
 */
export async function executarFerramenta(
  ctx: ContextoDaFerramenta,
  nome: string,
  entradaBruta: unknown,
  /** aprovada: a ação foi aprovada por uma pessoa (M4-03): a regra já foi cumprida. */
  opcoes: { aprovada?: boolean } = {},
): Promise<ResultadoDaFerramenta> {
  const feito = await executarSemMarca(ctx, nome, entradaBruta, opcoes);
  if (opcoes.aprovada || ctx.semExecucao || ctx.execucao.leuTextoDeOutros) return feito;
  const conteudo = feito.conteudo as Record<string, unknown> | null;
  if (conteudo && typeof conteudo === "object" && "pedidoDeAprovacao" in conteudo) return feito;
  const fontes = fontesDaFerramenta(nome, (entradaBruta ?? {}) as Record<string, unknown>, feito.conteudo);
  if (!fontes) return feito;
  // A ação já aconteceu: um erro aqui não pode parecer falha dela (o modelo repetiria). Sem saber, vale a marca.
  const marcou = await comEmpresa(ctx.poolApp, ctx.empresaId, async (c) => {
    if (!(await haTextoDeOutros(c, ctx.execucao.pedidoPor, fontes))) return false;
    await marcarTextoDeOutros(c, ctx.execucao.id);
    return true;
  }).catch((erro) => {
    ctx.log.error({ erro, ferramenta: nome }, "Texto de outros: não conferiu; a execução fica marcada");
    return true;
  });
  if (marcou) ctx.execucao = { ...ctx.execucao, leuTextoDeOutros: true };
  return feito;
}

async function executarSemMarca(
  ctx: ContextoDaFerramenta,
  nome: string,
  entradaBruta: unknown,
  opcoes: { aprovada?: boolean },
): Promise<ResultadoDaFerramenta> {
  const pode = ferramentasDoPapel(ctx.agente.papel).find((f) => f.nome === nome);
  if (!pode) throw new RecusaDaFerramenta(`A ferramenta ${nome} não existe para o seu papel.`);
  const declarada =
    FERRAMENTAS_INTERNAS.find((f) => f.nome === nome) ?? FERRAMENTAS_MCP.find((f) => f.nome === nome);
  const r = conferir(declarada?.entrada as never, entradaBruta ?? {});
  if (!r.ok)
    throw new RecusaDaFerramenta(
      `Entrada fora do formato: ${r.problemas.map((p) => `${p.caminho} ${p.mensagem}`).join("; ")}`,
    );
  const entrada = r.valor as Record<string, unknown>;
  const pessoaId = ctx.execucao.pedidoPor;
  const execucaoId = ctx.semExecucao ? null : ctx.execucao.id;
  const agenteQuem: Quem = { tipo: "agente", agenteId: ctx.agente.id };
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(ctx.poolApp, ctx.empresaId, trabalho);

  /** A tarefa precisa estar ao alcance de quem pediu (a permissão da pessoa vale para o agente). */
  /** Tarefa passada a outro agente interno: vira trabalho dele, em nome de quem pediu e com a marca (M4-04). */
  const entregarAoAgente = (tarefaId: string) =>
    entregarAoAgenteInterno(
      ctx.poolApp,
      ctx.empresaId,
      { tipo: "pessoa", pessoaId },
      tarefaId,
      (_empresa, id) => ctx.acordar(id),
      {
        leuTextoDeOutros: ctx.execucao.leuTextoDeOutros,
        execucaoMaeId: ctx.semExecucao ? null : ctx.execucao.id,
      },
    ).catch((erro) => ctx.log.error({ erro, tarefaId }, "Tarefa do agente interno: não entrou na fila"));

  // A menor das duas permissões (M4-04): quem pediu e o responsável pelo agente (quando não é a mesma pessoa).
  const responsavel = ctx.responsavel ?? null;
  async function alcancaOResponsavel(c: pg.PoolClient, tarefaId: string, acao: "ver" | "editar") {
    if (!responsavel) return true;
    const q = quemPediu(responsavel.permissoes, responsavel.pessoaId, acao);
    return q !== null && (await buscarTarefa(c, q, tarefaId)) !== null;
  }
  /** Só os itens cujas tarefas o responsável também vê (uma consulta só, com o alcance dele). */
  async function soAsDoResponsavel<T>(c: pg.PoolClient, itens: T[], tarefaDe: (x: T) => string | null) {
    if (!responsavel) return itens;
    const q = quemPediu(responsavel.permissoes, responsavel.pessoaId, "ver");
    const ids = [...new Set(itens.flatMap((x) => tarefaDe(x) ?? []))];
    if (!q) return itens.filter((x) => !tarefaDe(x));
    const alcance = condicaoDeAlcance(q, 1);
    const r = await c.query<{ id: string }>(
      `select t.id from tarefas t where t.empresa_id = empresa_ativa() and t.id = any($1::uuid[]) and ${alcance.sql}`,
      [ids, ...alcance.valores],
    );
    const veem = new Set(r.rows.map((l) => l.id));
    return itens.filter((x) => {
      const id = tarefaDe(x);
      return !id || veem.has(id);
    });
  }

  async function tarefaDeQuemPediu(
    c: pg.PoolClient,
    tarefaId: string,
    acao: "ver" | "editar",
    travar = false,
  ) {
    const quem = quemPediu(ctx.permissoes, pessoaId, acao);
    if (!quem) throw new RecusaDaFerramenta("Quem pediu não tem acesso a tarefas.");
    const t = await buscarTarefa(c, quem, tarefaId, travar);
    if (!t) throw new RecusaDaFerramenta("Tarefa não encontrada entre as que quem pediu alcança.");
    if (!(await alcancaOResponsavel(c, tarefaId, acao)))
      throw new RecusaDaFerramenta(
        "Essa tarefa está fora do alcance da pessoa responsável por você, e você nunca alcança mais que ela.",
      );
    return t;
  }

  const registrar = async (
    acao:
      | AcaoDeTarefa
      | "agente.delegou"
      | "tarefa.mudou_projeto"
      | "tarefa.mudou_prazo"
      | "tarefa.mudou_prioridade",
    tarefaId: string,
    detalhes = {},
  ) => {
    const acontecimento = acontecimentoDaAcao(acao, detalhes);
    if (acontecimento)
      await naEmpresa((c) =>
        registrarAcontecimento(
          c,
          tarefaId,
          { tipo: "agente", agenteId: ctx.agente.id },
          acontecimento.tipo,
          acontecimento.detalhes,
        ),
      );
    await auditar(
      ctx.poolApp,
      {
        empresaId: ctx.empresaId,
        ator: { tipo: "agente", agenteId: ctx.agente.id },
        acao,
        alvo: { tipo: "tarefa", id: tarefaId },
        origem: ctx.opcoesMcp.origem,
        rastreio: null,
        detalhes: { ...detalhes, execucaoId, pedidoPor: pessoaId },
      },
      ctx.log,
    );
  };

  // Regra por ação (M4-03): bloqueada, ou pede aprovação. A tarefa precisa estar ao alcance de quem pediu antes de
  // virar pedido (o resumo do pedido mostra o título).
  if (!opcoes.aprovada) {
    const agenteDaRegra = { id: ctx.agente.id, tipo: "interno" as const };
    const avaliacao = await naEmpresa((c) =>
      avaliarAcao(c, agenteDaRegra, nome, entrada, { textoDeOutros: ctx.execucao.leuTextoDeOutros }),
    );
    if (avaliacao === "bloqueado") {
      await auditar(
        ctx.poolApp,
        {
          empresaId: ctx.empresaId,
          ator: { tipo: "agente", agenteId: ctx.agente.id },
          acao: "agente.bloqueado",
          alvo: { tipo: "agente", id: ctx.agente.id },
          origem: ctx.opcoesMcp.origem,
          rastreio: null,
          detalhes: { acao: nome, execucaoId },
        },
        ctx.log,
      );
      throw new RecusaDaFerramenta(
        "Essa ação está bloqueada pela regra da empresa para você. Diga à pessoa que ela pode fazer pela tela.",
      );
    }
    if (avaliacao === "aprovacao" || avaliacao === "aprovacao_por_texto") {
      const porTextoDeOutros = avaliacao === "aprovacao_por_texto";
      const pedido = await naEmpresa(async (c) => {
        // Quem pediu precisa poder fazer a ação na tarefa (ver para comentar, editar para mudar), senão o pedido
        // nasceria para falhar.
        if (typeof entrada.tarefaId === "string")
          await tarefaDeQuemPediu(
            c,
            entrada.tarefaId,
            nome === "comentar" || nome === "ver_tarefa" ? "ver" : "editar",
          );
        // O pedido só cita o que existe na empresa (M6-01): nunca uma linha que aponta para outra empresa.
        if ((await idsForaDaEmpresa(c, uuidsDe(entrada))).length > 0)
          throw new RecusaDaFerramenta(NAO_ENCONTRADO_NA_EMPRESA);
        return criarAprovacao(c, {
          agenteId: ctx.agente.id,
          execucaoId,
          pedidoPor: pessoaId,
          acao: nome,
          parametros: entrada,
          motivo: ctx.motivoDoPedido ?? null,
          porTextoDeOutros,
        });
      });
      await auditar(
        ctx.poolApp,
        {
          empresaId: ctx.empresaId,
          ator: { tipo: "agente", agenteId: ctx.agente.id },
          acao: "agente.pediu_aprovacao",
          alvo: { tipo: "aprovacao", id: pedido.id },
          origem: ctx.opcoesMcp.origem,
          rastreio: null,
          detalhes: { acao: nome, execucaoId, tarefaId: pedido.tarefaId, porTextoDeOutros },
        },
        ctx.log,
      );
      return {
        conteudo: {
          pedidoDeAprovacao: pedido.id,
          situacao: "pendente",
          mensagem: `${porTextoDeOutros ? "Você leu texto de outra pessoa neste trabalho, então o que muda dados agora precisa de aprovação." : "Essa ação precisa de aprovação."} O pedido foi enviado (${pedido.resumo}) e ela acontece quando alguém aprovar, em até 24 horas. Avise a pessoa e siga com o resto.`,
        },
      };
    }
  }

  // As ferramentas do MCP: a tarefa precisa estar ao alcance de quem pediu, e depois valem as regras do MCP
  // (o agente só mexe nas tarefas dele).
  if ((FERRAMENTAS_DO_MCP_NO_ESPECIALISTA as readonly string[]).includes(nome)) {
    if (typeof entrada.tarefaId === "string")
      await naEmpresa((c) =>
        tarefaDeQuemPediu(c, entrada.tarefaId as string, nome === "ver_tarefa" ? "ver" : "editar"),
      );
    const resultado = await executar(
      nome as (typeof FERRAMENTAS_DO_MCP_NO_ESPECIALISTA)[number],
      entrada as never,
      { empresaId: ctx.empresaId, agenteId: ctx.agente.id, chaveId: "" },
      ctx.opcoesMcp,
      { log: ctx.log as never },
    );
    // Subtarefa criada para outro agente interno: vira trabalho dele, em nome de quem pediu (M4-04).
    const criada = resultado as { id?: string; responsavel?: { tipo: string } | null };
    if (nome === "criar_subtarefa" && criada.id && criada.responsavel?.tipo === "agente")
      await entregarAoAgente(criada.id);
    return { conteudo: resultado };
  }

  switch (nome as NomeDeFerramentaInterna) {
    case "responder":
    case "perguntar": {
      const texto = (entrada.texto ?? entrada.pergunta) as string;
      return {
        conteudo: { ok: true },
        fim: {
          tipo: nome as "responder" | "perguntar",
          texto,
          tarefas: ((entrada.tarefas as string[] | undefined) ?? []).slice(0, 20),
        },
      };
    }
    case "ver_custos": {
      // Quem vê as contas de IA vê tudo; os outros, só o gasto do próprio agente (M4-06).
      const tudo = (ctx.permissoes.modulos.get("contas_de_ia")?.acoes.ver ?? "nada") !== "nada";
      const r = await naEmpresa((c) => resumoDeCustos(c, null));
      const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(4)}`;
      const tetoUsd = (centavos: number | null) =>
        centavos === null ? "sem teto" : `US$ ${(centavos / 100).toFixed(2)}`;
      const agentes = r.porAgente
        .filter((a) => tudo || a.agenteId === ctx.agente.id)
        .map((a) => ({
          agente: a.nome,
          hoje: usd(a.hoje.custo),
          mes: usd(a.mes.custo),
          teto: tetoUsd(a.teto),
        }));
      return {
        conteudo: {
          mes: r.mes,
          agentes,
          ...(tudo
            ? {
                empresa: { hoje: usd(r.hoje.custo), mes: usd(r.total.custo), teto: tetoUsd(r.tetoDaEmpresa) },
              }
            : {}),
        },
      };
    }
    // Contatos (M7-01): com o alcance de quem pediu e o do responsável pelo agente (o menor dos dois).
    case "listar_contatos":
    case "ver_contato":
    case "criar_contato":
    case "atualizar_contato":
    case "ligar_contato": {
      if (!eFerramentaDeContatos(nome)) throw new RecusaDaFerramenta("Ferramenta desconhecida.");
      try {
        const conteudo = await executarFerramentaDeContatos(
          {
            poolApp: ctx.poolApp,
            empresaId: ctx.empresaId,
            agenteId: ctx.agente.id,
            autorId: pessoaId,
            olham: (acao) => [
              quemOlhaContatos(ctx.permissoes, pessoaId, acao),
              ...(responsavel ? [quemOlhaContatos(responsavel.permissoes, responsavel.pessoaId, acao)] : []),
            ],
            tarefasDoContato: async (c, contatoId) => {
              const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
              if (!quem) return [];
              return soAsDoResponsavel(c, await listarTarefas(c, quem, { contatoId }), (t) => t.id);
            },
            tarefaQueEdita: async (c, tarefaId) => tarefaDeQuemPediu(c, tarefaId, "editar", true),
            limiteDaLista: 100,
            origem: ctx.opcoesMcp.origem,
            rastreio: null,
            detalhes: { execucaoId, pedidoPor: pessoaId },
            log: ctx.log,
          },
          nome,
          entrada,
        );
        return { conteudo };
      } catch (erro) {
        if (erro instanceof RecusaDosContatos) throw new RecusaDaFerramenta(erro.message);
        throw erro;
      }
    }
    // Atendimento (M8-05, decisão 0055): só a conversa da execução e o contato dela.
    case "ver_ficha_do_cliente":
    case "completar_cliente":
    case "criar_tarefa_para_a_equipe":
    case "responder_ao_cliente":
    case "passar_para_uma_pessoa": {
      const conversaId = ctx.execucao.conversaComContatoId;
      if (!conversaId || ctx.agente.papel !== "atendimento")
        throw new RecusaDaFerramenta("Esta ferramenta é só do atendimento, numa conversa com cliente.");
      // Com uma pessoa na conversa ou depois da passagem (M8-06), só as ferramentas daquele tipo de execução.
      const tipo = await naEmpresa((c) => tipoDoAtendimento(c, ctx.execucao.id));
      if (!FERRAMENTAS_DO_ATENDIMENTO[tipo].includes(nome))
        throw new RecusaDaFerramenta(
          "Esta ferramenta não vale agora: uma pessoa da equipe cuida da conversa.",
        );
      try {
        if (nome === "passar_para_uma_pessoa")
          return {
            conteudo: null,
            fim: {
              tipo: "responder",
              texto: entrada.resumo as string,
              tarefas: [],
              passagem: {
                motivo: entrada.motivo as MotivoDaPassagem,
                resumo: entrada.resumo as string,
                sugestao: (entrada.sugestao as string) ?? null,
              },
            },
          };
        if (nome === "responder_ao_cliente")
          return {
            conteudo: null,
            fim: {
              tipo: "responder",
              texto: entrada.texto as string,
              tarefas: [],
              resumo: (entrada.resumo as string) ?? null,
            },
          };
        if (nome === "ver_ficha_do_cliente")
          return { conteudo: await naEmpresa((c) => verFichaDoCliente(c, conversaId)) };
        if (nome === "completar_cliente")
          return {
            conteudo: await naEmpresa((c) =>
              completarCliente(
                c,
                conversaId,
                entrada as { nome?: string; email?: string; telefone?: string },
              ),
            ),
          };
        const feito = await naEmpresa((c) =>
          criarTarefaParaAEquipe(
            c,
            conversaId,
            ctx.agente.id,
            entrada as { titulo: string; descricao?: string },
          ),
        );
        return { conteudo: { ...feito, mensagem: "Tarefa criada para a equipe." } };
      } catch (erro) {
        if (erro instanceof RecusaDasConversas) throw new RecusaDaFerramenta(erro.message);
        throw erro;
      }
    }
    // Conversas com contatos (M8-01): só leitura, com o alcance de quem pediu e o do responsável (o menor dos dois).
    case "listar_conversas":
    case "ver_conversa": {
      if (!eFerramentaDeConversas(nome)) throw new RecusaDaFerramenta("Ferramenta desconhecida.");
      try {
        const conteudo = await executarFerramentaDeConversas(
          {
            poolApp: ctx.poolApp,
            empresaId: ctx.empresaId,
            olham: [
              quemOlhaConversas(ctx.permissoes, pessoaId, "ver"),
              ...(responsavel
                ? [quemOlhaConversas(responsavel.permissoes, responsavel.pessoaId, "ver")]
                : []),
            ],
            limiteDaLista: 100,
          },
          nome,
          entrada,
        );
        return { conteudo };
      } catch (erro) {
        if (erro instanceof RecusaDasConversas) throw new RecusaDaFerramenta(erro.message);
        throw erro;
      }
    }
    // Agenda (M5-07): com o alcance de quem pediu e o do responsável pelo agente (o menor dos dois).
    case "ver_agenda": {
      const olham = [
        quemVeDe(ctx.permissoes, pessoaId),
        ...(responsavel ? [quemVeDe(responsavel.permissoes, responsavel.pessoaId)] : []),
      ];
      if (olham.some((q) => q.alcance === "nada"))
        throw new RecusaDaFerramenta("Quem pediu não pode ver a agenda.");
      const de = entrada.de as string;
      const ate = entrada.ate as string;
      if (ate < de || (Date.parse(ate) - Date.parse(de)) / 86_400_000 > DIAS_MAXIMOS_DA_LISTAGEM)
        throw new RecusaDaFerramenta(
          `Escolha um intervalo de até ${DIAS_MAXIMOS_DA_LISTAGEM} dias, com o fim depois do começo.`,
        );
      const pessoas = (entrada.pessoas as string[] | undefined) ?? [pessoaId];
      const r = await naEmpresa(async (c) => {
        const fuso = await fusoDaPessoa(c, pessoaId);
        const ocorrencias = await listarAgenda(c, olham, { de, ate, pessoas, fuso });
        const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
        const doResponsavel = responsavel
          ? quemPediu(responsavel.permissoes, responsavel.pessoaId, "ver")
          : null;
        const prazos =
          quem && (!responsavel || doResponsavel)
            ? (
                await soAsDoResponsavel(
                  c,
                  await listarTarefas(c, quem, { minhas: true, de, ate }),
                  (t) => t.id,
                )
              ).map((t) => ({
                tarefaId: t.id,
                titulo: t.titulo,
                prazo: t.prazo?.em ?? null,
              }))
            : [];
        return { fuso, ocorrencias, prazosDasMinhasTarefas: prazos };
      });
      return { conteudo: r };
    }
    case "criar_evento": {
      const podeCriar = (p: PermissoesNaEmpresa) =>
        (p.modulos.get("agenda")?.acoes.criar ?? "nada") !== "nada";
      if (!podeCriar(ctx.permissoes)) throw new RecusaDaFerramenta("Quem pediu não pode marcar eventos.");
      if (responsavel && !podeCriar(responsavel.permissoes))
        throw new RecusaDaFerramenta(
          "A pessoa responsável por você não pode marcar eventos, e você também não.",
        );
      const pedido = conferirPedidoDeEvento(entrada);
      if (!pedido.ok)
        throw new RecusaDaFerramenta(`Confira: ${pedido.problemas[0]?.mensagem ?? "os campos"}.`);
      const evento = await naEmpresa(async (c) => {
        try {
          return await criarEvento(c, { pessoaId }, pedido.valor, ctx.agente.id);
        } catch (erro) {
          if (erro instanceof RecusaDaAgenda) throw new RecusaDaFerramenta(erro.message);
          throw erro;
        }
      });
      await auditar(
        ctx.poolApp,
        {
          empresaId: ctx.empresaId,
          ator: { tipo: "agente", agenteId: ctx.agente.id },
          acao: "evento.criou",
          alvo: { tipo: "evento", id: evento.id },
          origem: ctx.opcoesMcp.origem,
          rastreio: null,
          detalhes: { execucaoId, pedidoPor: pessoaId, participantes: evento.participantes.length },
        },
        ctx.log,
      );
      return { conteudo: { evento } };
    }
    // Rotinas (M5-05): com o alcance de quem pediu e o do responsável pelo agente (o menor dos dois).
    case "listar_rotinas":
    case "ver_rotina":
    case "criar_rotina":
    case "ligar_rotina":
    case "parar_rotina": {
      const verDe = (p: PermissoesNaEmpresa, id: string) =>
        filtroDoAlcance(p.modulos.get("rotinas")?.acoes.ver ?? "nada", id, p.area);
      const meu = verDe(ctx.permissoes, pessoaId);
      if (!meu) throw new RecusaDaFerramenta("Quem pediu não pode ver rotinas.");
      const doResponsavel = responsavel ? verDe(responsavel.permissoes, responsavel.pessoaId) : null;
      if (responsavel && !doResponsavel)
        throw new RecusaDaFerramenta("A pessoa responsável por você não vê rotinas, e você também não.");
      /** A rotina que os dois alcançam. */
      const rotinaDosDois = async (c: pg.PoolClient, id: string, travar = false) => {
        const r = await buscarRotina(c, meu, id, travar);
        if (!r || (doResponsavel && !(await buscarRotina(c, doResponsavel, id))))
          throw new RecusaDaFerramenta("Rotina não encontrada entre as que quem pediu vê.");
        return r;
      };
      const auditarRotina = (acao: AcaoDeRotina, rotina: Rotina) =>
        auditar(
          ctx.poolApp,
          {
            empresaId: ctx.empresaId,
            ator: { tipo: "agente", agenteId: ctx.agente.id },
            acao,
            alvo: { tipo: "rotina", id: rotina.id },
            origem: ctx.opcoesMcp.origem,
            rastreio: null,
            detalhes: { acao: rotina.acao.tipo, execucaoId, pedidoPor: pessoaId },
          },
          ctx.log,
        );
      if (nome === "listar_rotinas") {
        const r = await naEmpresa(async (c) => {
          const lista = await listarRotinas(c, meu);
          if (!doResponsavel) return lista;
          const deles = new Set((await listarRotinas(c, doResponsavel)).rotinas.map((x) => x.id));
          return { ...lista, rotinas: lista.rotinas.filter((x) => deles.has(x.id)) };
        });
        return {
          conteudo: {
            rotinas: r.rotinas.map((x) => ({
              id: x.id,
              nome: x.nome,
              dono: r.nomes[x.donoPessoaId] ?? null,
              acao: x.acao.tipo,
              situacao: x.situacao,
              proximaEm: x.proximaEm,
            })),
          },
        };
      }
      if (nome === "ver_rotina") {
        const r = await naEmpresa(async (c) => {
          const rotina = await rotinaDosDois(c, entrada.rotinaId as string);
          return { rotina, execucoes: await listarExecucoes(c, rotina.id, 10) };
        });
        return { conteudo: r };
      }
      if (nome === "criar_rotina") {
        // A rotina é sempre de quem pediu, nasce desligada e fica marcada com o agente.
        const pode = (p: PermissoesNaEmpresa) => (p.modulos.get("rotinas")?.acoes.criar ?? "nada") !== "nada";
        if (!pode(ctx.permissoes)) throw new RecusaDaFerramenta("Quem pediu não pode criar rotinas.");
        if (responsavel && !pode(responsavel.permissoes))
          throw new RecusaDaFerramenta(
            "A pessoa responsável por você não pode criar rotinas, e você também não.",
          );
        const pedido = conferirPedidoDeRotina(entrada);
        if (!pedido.ok)
          throw new RecusaDaFerramenta(`Confira: ${pedido.problemas[0]?.mensagem ?? "os campos"}.`);
        const rotina = await naEmpresa(async (c) => {
          if (responsavel) {
            const recusa = await recusaDaAcao(c, responsavel, pedido.valor.acao);
            if (recusa)
              throw new RecusaDaFerramenta(`Fora do alcance da pessoa responsável por você: ${recusa}`);
          }
          try {
            return await criarRotina(
              c,
              { pessoaId, permissoes: ctx.permissoes },
              pedido.valor,
              ctx.agente.id,
            );
          } catch (erro) {
            if (erro instanceof RecusaDaRotina) throw new RecusaDaFerramenta(erro.message);
            throw erro;
          }
        });
        await auditarRotina("rotina.criou", rotina);
        return {
          conteudo: {
            rotina,
            aviso: "A rotina nasceu desligada. Para rodar sozinha, ela precisa ser ligada.",
          },
        };
      }
      if (nome === "ligar_rotina") {
        const rotina = await naEmpresa(async (c) => {
          const r = await rotinaDosDois(c, entrada.rotinaId as string, true);
          if (r.donoPessoaId !== pessoaId)
            throw new RecusaDaFerramenta("Só o dono liga a rotina (ela age em nome dele).");
          const podeEditar = (p: PermissoesNaEmpresa) =>
            (p.modulos.get("rotinas")?.acoes.editar ?? "nada") !== "nada";
          if (!podeEditar(ctx.permissoes)) throw new RecusaDaFerramenta("Quem pediu não pode ligar rotinas.");
          if (responsavel && !podeEditar(responsavel.permissoes))
            throw new RecusaDaFerramenta("A pessoa responsável por você não pode ligar rotinas.");
          if (responsavel) {
            const recusa = await recusaDaAcao(c, responsavel, r.acao);
            if (recusa)
              throw new RecusaDaFerramenta(`Fora do alcance da pessoa responsável por você: ${recusa}`);
          }
          try {
            return {
              antes: r.situacao,
              depois: await ligarRotina(c, r, { pessoaId, permissoes: ctx.permissoes }),
            };
          } catch (erro) {
            if (erro instanceof RecusaDaRotina) throw new RecusaDaFerramenta(erro.message);
            throw erro;
          }
        });
        if (rotina.antes === "desligada") await auditarRotina("rotina.ligou", rotina.depois);
        return { conteudo: { rotina: rotina.depois } };
      }
      // parar_rotina: a do próprio quem pediu ou, para quem edita todas (o administrador), qualquer uma.
      const podeParar = (p: PermissoesNaEmpresa, id: string, dono: string) => {
        const editar = p.modulos.get("rotinas")?.acoes.editar ?? "nada";
        return editar === "tudo" || (editar !== "nada" && dono === id);
      };
      const parada = await naEmpresa(async (c) => {
        const r = await rotinaDosDois(c, entrada.rotinaId as string, true);
        if (!podeParar(ctx.permissoes, pessoaId, r.donoPessoaId))
          throw new RecusaDaFerramenta("Quem pediu não pode desligar essa rotina.");
        if (responsavel && !podeParar(responsavel.permissoes, responsavel.pessoaId, r.donoPessoaId))
          throw new RecusaDaFerramenta("A pessoa responsável por você não pode desligar essa rotina.");
        return { antes: r.situacao, depois: await desligarRotina(c, r, "agente") };
      });
      if (parada.antes === "ligada") await auditarRotina("rotina.desligou", parada.depois);
      return { conteudo: { rotina: parada.depois } };
    }
    case "pegar_skill": {
      // Só lê as skills atribuídas ao próprio agente (configuração da empresa, não dado de pessoa): o alcance de quem
      // pediu e o do responsável não entram aqui.
      const skill = (await naEmpresa((c) => skillsDoAgente(c, ctx.agente.id))).find(
        (s) => s.id === entrada.skillId,
      );
      if (!skill) throw new RecusaDaFerramenta("Essa skill não está atribuída a você.");
      return { conteudo: skill };
    }
    case "ver_tarefa": {
      const tarefaId = entrada.tarefaId as string;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await tarefaDeQuemPediu(c, tarefaId, "ver");
        const comentarios = (await listarComentarios(c, tarefa.id, false)).slice(-30);
        const subtarefas = await listarSubtarefas(c, tarefa.id);
        const nomes = await nomesCitados(c, idsCitados([tarefa, ...subtarefas], comentarios));
        return {
          tarefa,
          comentarios,
          subtarefas: subtarefas.map((s) => ({
            id: s.id,
            titulo: s.titulo,
            status: s.status,
            responsavel: s.responsavel,
          })),
          checklist: await listarChecklist(c, tarefa.id),
          // M5-03b: o nome e, quando há, a descrição (o conteúdo do arquivo nunca vai ao agente).
          anexos: (await listarAnexos(c, tarefa.id, true)).map((a) =>
            a.descricao ? { nome: a.nome, descricao: a.descricao } : a.nome,
          ),
          nomes,
        };
      });
      return { conteudo: feito };
    }
    case "comentar": {
      const tarefaId = entrada.tarefaId as string;
      const { tarefa, comentario } = await naEmpresa(async (c) => {
        // Comentar pede só "ver", como na tela (M2-02).
        const t = await tarefaDeQuemPediu(c, tarefaId, "ver");
        // As menções escritas no texto ("@Ana") avisam a pessoa, como as escolhidas na tela.
        const texto = entrada.texto as string;
        const feito = await comentar(c, agenteQuem, tarefaId, texto, {
          mencoes: await mencoesDoTexto(c, texto),
        });
        return { tarefa: t, comentario: feito };
      });
      await registrar("tarefa.comentou", tarefaId, { comentarioId: comentario.id });
      if (comentario.mencoes.length > 0)
        await registrar("tarefa.mencionou", tarefaId, {
          comentarioId: comentario.id,
          pessoas: comentario.mencoes.length,
          agentes: 0,
        });
      await avisarDepois(
        ctx.poolApp,
        ctx.empresaId,
        agenteQuem,
        { tipo: "comentou", tarefa, comentario },
        ctx.log,
      );
      return { conteudo: { comentarioId: comentario.id } };
    }
    case "procurar_pessoa": {
      const procurado = semAcento(entrada.nome as string);
      const feito = await naEmpresa(async (c) => {
        // Pessoas pelo alcance de quem pediu (o mesmo da tela Pessoas) e do responsável pelo agente; agentes, todos os
        // ativos (todos veem agentes).
        const pessoasDe = async (p: PermissoesNaEmpresa, id: string) => {
          const filtro = filtroDoAlcance(p.modulos.get("pessoas")?.acoes.ver ?? "nada", id, p.area);
          if (!filtro) return [];
          const r = await c.query<{ id: string; nome: string; area: string | null }>(
            `select p.id, p.nome, v.area from vinculos v join pessoas p on p.id = v.pessoa_id
              where v.empresa_id = empresa_ativa() and v.situacao = 'ativo'
                and ($1::text = 'tudo' or ($1 = 'equipe' and v.area is not distinct from $2) or v.pessoa_id = $3)
              order by lower(p.nome) limit 500`,
            [filtro.tipo, filtro.tipo === "equipe" ? filtro.area : null, id],
          );
          return r.rows;
        };
        let pessoas = { rows: await pessoasDe(ctx.permissoes, pessoaId) };
        if (responsavel) {
          const dele = new Set(
            (await pessoasDe(responsavel.permissoes, responsavel.pessoaId)).map((p) => p.id),
          );
          pessoas = { rows: pessoas.rows.filter((p) => dele.has(p.id)) };
        }
        const agentes = await c.query<{ id: string; nome: string }>(
          `select id, nome from agentes where empresa_id = empresa_ativa() and situacao = 'ativo'
            order by lower(nome) limit 200`,
        );
        return [
          ...pessoas.rows.map((p) => ({ tipo: "pessoa" as const, id: p.id, nome: p.nome, area: p.area })),
          ...agentes.rows.map((a) => ({ tipo: "agente" as const, id: a.id, nome: a.nome, area: null })),
        ];
      });
      return {
        conteudo: { encontrados: feito.filter((x) => semAcento(x.nome).includes(procurado)).slice(0, 10) },
      };
    }
    case "mudar_prazo": {
      const tarefaId = entrada.tarefaId as string;
      const planejamento = {
        ...(entrada.prazo !== undefined ? { prazo: entrada.prazo as never } : {}),
        ...(entrada.prioridade !== undefined ? { prioridade: entrada.prioridade as never } : {}),
      };
      const feito = await naEmpresa(async (c) => {
        const tarefa = await tarefaDeQuemPediu(c, tarefaId, "editar", true);
        const recusa = await recusaDoPlanejamento(c, tarefa, planejamento);
        if (recusa) throw new RecusaDaFerramenta(recusa);
        const mudou = await planejar(c, tarefa, planejamento, await fusoDaEmpresa(c));
        return { mudou, tarefa: await tarefaDeQuemPediu(c, tarefaId, "ver") };
      });
      if (feito.mudou.prioridade)
        await registrar("tarefa.mudou_prioridade", tarefaId, { para: feito.tarefa?.prioridade ?? null });
      if (feito.mudou.prazo)
        await registrar("tarefa.mudou_prazo", tarefaId, {
          dia: feito.tarefa?.prazo?.dia ?? null,
          hora: feito.tarefa?.prazo?.hora ?? null,
        });
      return {
        conteudo: { prazo: feito.tarefa?.prazo ?? null, prioridade: feito.tarefa?.prioridade ?? null },
      };
    }
    case "mudar_projeto": {
      const tarefaId = entrada.tarefaId as string;
      const projetoId = entrada.projetoId as string | null;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await tarefaDeQuemPediu(c, tarefaId, "editar", true);
        if (tarefa.tarefaMaeId !== null)
          throw new RecusaDaFerramenta("A subtarefa fica sempre no projeto da tarefa-mãe.");
        if (projetoId !== null) {
          const ver = ctx.permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
          const projeto =
            ver === "nada"
              ? null
              : await buscarProjeto(c, pessoaId, ver === "tudo" ? "todos" : "membro", projetoId);
          if (projeto?.situacao !== "ativo")
            throw new RecusaDaFerramenta("Projeto não encontrado entre os de quem pediu.");
        }
        if (tarefa.projetoId === projetoId) return { de: tarefa.projetoId, mudou: false };
        await mudarProjetoDaTarefa(c, tarefa.id, projetoId);
        return { de: tarefa.projetoId, mudou: true };
      });
      if (feito.mudou) await registrar("tarefa.mudou_projeto", tarefaId, { de: feito.de, para: projetoId });
      return { conteudo: { ok: true, projetoId } };
    }
    case "acrescentar_checklist": {
      const tarefaId = entrada.tarefaId as string;
      const itens = entrada.itens as string[];
      const n = await naEmpresa(async (c) => {
        const tarefa = await tarefaDeQuemPediu(c, tarefaId, "editar", true);
        if (tarefa.trava && !ehDoAgente(tarefa, ctx.agente.id))
          throw new RecusaDaFerramenta("Essa tarefa está pegada por outra pessoa ou agente agora.");
        for (const texto of itens) await criarItem(c, tarefa.id, texto, agenteQuem);
        return itens.length;
      });
      await registrar("checklist.editou", tarefaId, { acrescentados: n });
      return { conteudo: { acrescentados: n } };
    }
    case "minhas_prioridades": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
      if (quem?.tipo !== "pessoa") throw new RecusaDaFerramenta("Quem pediu não vê tarefas.");
      const itens = await naEmpresa(async (c) =>
        soAsDoResponsavel(c, await listarPrioridades(c, quem), (i) => i.tarefaId),
      );
      return {
        conteudo: {
          itens: itens
            .slice(0, 30)
            .map((i) => ({ tipo: i.tipo, titulo: i.titulo, motivo: i.motivo, tarefaId: i.tarefaId })),
        },
      };
    }
    case "arquivos_recebidos": {
      const arquivos = await naEmpresa(async (c) => {
        const r = await c.query<{
          id: string;
          nome: string;
          tipo: string;
          tamanho: string | null;
          recebido_em: Date;
        }>(
          `select id, nome, tipo, tamanho, recebido_em from arquivos_do_telegram
            where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'esperando' and vence_em > now()
            order by recebido_em desc limit 20`,
          [pessoaId],
        );
        return r.rows;
      });
      return {
        conteudo: {
          arquivos: arquivos.map((a) => ({
            id: a.id,
            nome: a.nome,
            tipo: a.tipo,
            tamanho: a.tamanho === null ? null : Number(a.tamanho),
            recebidoEm: a.recebido_em.toISOString(),
          })),
        },
      };
    }
    case "anexar_arquivo": {
      const anexos = ctx.opcoesMcp.anexos ?? null;
      const telegram = ctx.opcoesMcp.telegram ?? null;
      if (!anexos || !telegram) throw new RecusaDaFerramenta("Os anexos não estão ligados neste ambiente.");
      const arquivoId = entrada.arquivoId as string;
      const tarefaId = entrada.tarefaId as string;
      // 1. O arquivo é de quem pediu e ainda espera; a tarefa é das que quem pediu (e o responsável) pode editar.
      const arquivo = await naEmpresa(async (c) => {
        const r = await c.query<{
          nome: string;
          tipo: string;
          id_no_telegram: string;
          situacao: string;
          vale: boolean;
        }>(
          `select nome, tipo, id_no_telegram, situacao, vence_em > now() as vale from arquivos_do_telegram
            where id = $1 and empresa_id = empresa_ativa() and pessoa_id = $2`,
          [arquivoId, pessoaId],
        );
        const a = r.rows[0];
        if (!a)
          throw new RecusaDaFerramenta(
            "Arquivo não encontrado entre os que quem pediu mandou pelo Telegram (veja arquivos_recebidos).",
          );
        if (a.situacao === "anexado") throw new RecusaDaFerramenta("Esse arquivo já foi anexado.");
        // Aprovado depois das 24 horas: a aprovação segurou o arquivo (ele não venceu enquanto esperava a decisão).
        if (a.situacao === "vencido" || (!a.vale && !opcoes.aprovada))
          throw new RecusaDaFerramenta(
            "Esse arquivo passou das 24 horas e venceu. Peça à pessoa para mandar de novo pelo Telegram.",
          );
        await tarefaDeQuemPediu(c, tarefaId, "editar");
        return a;
      });
      // 2. Baixa do Telegram fora da transação (pode demorar).
      let dados: Buffer;
      try {
        dados = await telegram.baixar(arquivo.id_no_telegram);
      } catch (erro) {
        ctx.log.warn({ erro, arquivoId }, "Telegram: o arquivo não foi baixado");
        throw new RecusaDaFerramenta(
          "Não consegui pegar o arquivo no Telegram agora. Peça à pessoa para mandar de novo.",
        );
      }
      if (dados.length === 0 || dados.length > TAMANHO_MAXIMO_DO_ARQUIVO_DO_TELEGRAM)
        throw new RecusaDaFerramenta("O arquivo veio vazio ou maior que 20 MB.");
      // 3. Vira anexo em "enviando", como no app; o arquivo deixa de esperar (uma vez só, mesmo com duas chamadas).
      const anexo = await naEmpresa(async (c) => {
        await tarefaDeQuemPediu(c, tarefaId, "editar");
        const travado = await c.query<{ situacao: string }>(
          "select situacao from arquivos_do_telegram where id = $1 and empresa_id = empresa_ativa() for update",
          [arquivoId],
        );
        const agora = travado.rows[0]?.situacao;
        if (agora === "vencido")
          throw new RecusaDaFerramenta(
            "Esse arquivo passou das 24 horas e venceu. Peça à pessoa para mandar de novo pelo Telegram.",
          );
        if (agora !== "esperando") throw new RecusaDaFerramenta("Esse arquivo já foi anexado.");
        const novo = await criarAnexo(c, {
          tarefaId,
          comentarioId: null,
          nome: arquivo.nome,
          tipo: arquivo.tipo,
          tamanho: dados.length,
          pessoaId,
          // M5-03b: o que é o arquivo, nas palavras do agente a partir da legenda.
          descricao: typeof entrada.descricao === "string" ? entrada.descricao : null,
          canal: "telegram",
        });
        await c.query(
          "update arquivos_do_telegram set situacao = 'anexado', anexo_id = $2 where id = $1 and empresa_id = empresa_ativa()",
          [arquivoId, novo.id],
        );
        return novo;
      });
      // 4. Grava na quarentena e manda para o antivírus. Se gravar falhar, o arquivo volta a esperar.
      try {
        await anexos.deposito.gravar(anexo.caminho, dados, anexo.tipo);
        await naEmpresa((c) => marcarVerificando(c, anexo.id));
      } catch (erro) {
        ctx.log.error({ erro, arquivoId }, "Telegram: o arquivo não foi gravado no depósito");
        // O que chegou à quarentena não pode ficar perdido no depósito.
        await anexos.deposito
          .apagar(anexo.caminho)
          .catch(() =>
            naEmpresa((c) =>
              c.query("insert into arquivos_para_apagar (empresa_id, caminho) values (empresa_ativa(), $1)", [
                anexo.caminho,
              ]),
            ).catch(() => {}),
          );
        await naEmpresa(async (c) => {
          await c.query(
            "update arquivos_do_telegram set situacao = 'esperando', anexo_id = null where id = $1 and empresa_id = empresa_ativa()",
            [arquivoId],
          );
          await excluirAnexo(c, anexo.id);
        });
        throw new RecusaDaFerramenta("Não consegui guardar o arquivo agora. Tente de novo em instantes.");
      }
      telegram.acordarAnexos();
      // O anexo é da pessoa (foi ela quem mandou), pelo Telegram, com o agente que anexou nos detalhes.
      await auditar(
        ctx.poolApp,
        {
          empresaId: ctx.empresaId,
          ator: { tipo: "pessoa", pessoaId },
          acao: "anexo.enviou",
          alvo: { tipo: "tarefa", id: tarefaId },
          origem: { canal: "telegram", ip: null, aparelho: "Telegram" },
          rastreio: null,
          detalhes: {
            anexoId: anexo.id,
            tipo: anexo.tipo,
            tamanho: anexo.tamanho,
            agenteId: ctx.agente.id,
            execucaoId,
          },
        },
        ctx.log,
      );
      return {
        conteudo: {
          anexoId: anexo.id,
          tarefaId,
          situacao: "verificando",
          aviso: "O arquivo está passando pelo antivírus e aparece na tarefa em instantes.",
        },
      };
    }
    case "buscar": {
      // A busca com o alcance de uma pessoa (a de quem pediu e, se for outra, a do responsável pelo agente).
      const buscarComo = (c: pg.PoolClient, p: PermissoesNaEmpresa, id: string) => {
        const ver = (modulo: string) => p.modulos.get(modulo)?.acoes.ver ?? "nada";
        const quem = quemPediu(p, id, "ver");
        const pessoas = filtroDoAlcance(ver("pessoas"), id, p.area);
        const projetos = ver("projetos");
        return buscarNoMago(c, id, entrada.texto as string, {
          tarefas: quem && quem.tipo === "pessoa" ? quem : null,
          projetos: projetos === "nada" ? null : projetos === "tudo" ? "todos" : "membro",
          espacos: ver("espacos") !== "nada",
          pessoas: pessoas
            ? pessoas.tipo === "tudo"
              ? { tipo: "tudo" }
              : pessoas.tipo === "equipe"
                ? { tipo: "equipe", area: pessoas.area }
                : { tipo: "meus" }
            : null,
          agentes: ver("agentes") !== "nada",
        });
      };
      const resultados = await naEmpresa(async (c) => {
        const meus = await buscarComo(c, ctx.permissoes, pessoaId);
        if (!responsavel) return meus;
        const dele = new Set(
          (await buscarComo(c, responsavel.permissoes, responsavel.pessoaId)).map((x) => `${x.tipo}:${x.id}`),
        );
        return meus.filter((x) => dele.has(`${x.tipo}:${x.id}`));
      });
      return { conteudo: { resultados: resultados.slice(0, 30) } };
    }
    case "listar_tarefas": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
      if (!quem) throw new RecusaDaFerramenta("Quem pediu não vê tarefas.");
      const texto = typeof entrada.texto === "string" ? semAcento(entrada.texto) : null;
      const limite = typeof entrada.limite === "number" ? entrada.limite : 30;
      const feito = await naEmpresa(async (c) => {
        const todas = await listarTarefas(c, quem, {
          ...(entrada.minhas ? { minhas: true } : {}),
          ...(entrada.status ? { status: entrada.status as never } : {}),
          ...(entrada.projetoId ? { projetoId: entrada.projetoId as never } : {}),
          ...(entrada.prazo ? { prazo: entrada.prazo as never } : {}),
        });
        const filtradas = await soAsDoResponsavel(
          c,
          texto ? todas.filter((t) => semAcento(t.titulo).includes(texto)) : todas,
          (t) => t.id,
        );
        const lista = filtradas.slice(0, limite);
        const nomes = await nomesCitados(
          c,
          lista.flatMap((t) =>
            t.responsavel
              ? [t.responsavel.tipo === "pessoa" ? t.responsavel.pessoaId : t.responsavel.agenteId]
              : [],
          ),
        );
        const projetos = await c.query<{ id: string; nome: string }>(
          "select id, nome from projetos where empresa_id = empresa_ativa() and id = any($1::uuid[])",
          [[...new Set(lista.flatMap((t) => (t.projetoId ? [t.projetoId] : [])))]],
        );
        const nomeDoProjeto = Object.fromEntries(projetos.rows.map((p) => [p.id, p.nome]));
        return {
          total: filtradas.length,
          tarefas: lista.map((t) => ({
            id: t.id,
            titulo: t.titulo,
            status: t.status,
            prioridade: t.prioridade,
            prazo: t.prazo ? `${t.prazo.dia}${t.prazo.hora ? ` ${t.prazo.hora}` : ""}` : null,
            projeto: t.projetoId ? (nomeDoProjeto[t.projetoId] ?? null) : null,
            responsavel: t.responsavel
              ? (nomes[t.responsavel.tipo === "pessoa" ? t.responsavel.pessoaId : t.responsavel.agenteId] ??
                null)
              : null,
            subtarefa: t.tarefaMaeId !== null,
          })),
        };
      });
      return { conteudo: feito };
    }
    case "procurar_projeto": {
      const ver = ctx.permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
      if (ver === "nada") throw new RecusaDaFerramenta("Quem pediu não vê projetos.");
      const procurado = semAcento(entrada.nome as string);
      const projetos = await naEmpresa(async (c) => {
        const meus = await listarProjetos(c, pessoaId, ver === "tudo" ? "todos" : "membro", {
          arquivados: false,
        });
        if (!responsavel) return meus;
        const verDele = responsavel.permissoes.modulos.get("projetos")?.acoes.ver ?? "nada";
        if (verDele === "nada") return [];
        const dele = new Set(
          (
            await listarProjetos(c, responsavel.pessoaId, verDele === "tudo" ? "todos" : "membro", {
              arquivados: false,
            })
          ).map((p) => p.id),
        );
        return meus.filter((p) => dele.has(p.id));
      });
      const achados = projetos.filter((p) => semAcento(p.nome).includes(procurado)).slice(0, 10);
      return { conteudo: { projetos: achados.map((p) => ({ id: p.id, nome: p.nome })) } };
    }
    case "criar_tarefa": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "criar");
      if (!quem) throw new RecusaDaFerramenta("Quem pediu não pode criar tarefas.");
      if (responsavel && !quemPediu(responsavel.permissoes, responsavel.pessoaId, "criar"))
        throw new RecusaDaFerramenta(
          "A pessoa responsável por você não pode criar tarefas, e você também não.",
        );
      const projetoId = entrada.projetoId as string | undefined;
      const feito = await naEmpresa(async (c) => {
        // O projeto precisa estar ao alcance de quem pediu e do responsável pelo agente.
        const projetoAlcancado = async (p: PermissoesNaEmpresa, id: string) =>
          ((
            await c.query(
              `select 1 from projetos p where p.id = $1 and p.empresa_id = empresa_ativa() and p.situacao = 'ativo'
                  and ($2::boolean or membro_do_projeto(p.id, $3))`,
              [projetoId, (p.modulos.get("projetos")?.acoes.ver ?? "nada") === "tudo", id],
            )
          ).rowCount ?? 0) > 0;
        if (projetoId) {
          if (!(await projetoAlcancado(ctx.permissoes, pessoaId)))
            throw new RecusaDaFerramenta("Projeto não encontrado entre os de quem pediu.");
          if (responsavel && !(await projetoAlcancado(responsavel.permissoes, responsavel.pessoaId)))
            throw new RecusaDaFerramenta("Projeto fora do alcance da pessoa responsável por você.");
        }
        const planejamento = {
          ...(entrada.prazo ? { prazo: entrada.prazo as never } : {}),
          ...(entrada.prioridade ? { prioridade: entrada.prioridade as never } : {}),
        };
        const recusa = await recusaDoPlanejamento(c, null, planejamento);
        if (recusa) throw new RecusaDaFerramenta(recusa);
        // Do coordenador, a tarefa nasce com quem pediu (ele delega em seguida); do especialista (conversa direta),
        // nasce com ele, para ele planejar.
        let tarefa = await criarTarefa(c, agenteQuem, {
          titulo: entrada.titulo as string,
          descricao: (entrada.descricao as string | undefined) ?? null,
          responsavel:
            ctx.agente.papel === "especialista"
              ? { tipo: "agente", agenteId: ctx.agente.id }
              : { tipo: "pessoa", pessoaId },
          projetoId: projetoId ?? null,
        });
        if (Object.keys(planejamento).length > 0) {
          await planejar(c, tarefa, planejamento, await fusoDaEmpresa(c));
          tarefa = (await buscarTarefa(c, quem, tarefa.id)) ?? tarefa;
        }
        return tarefa;
      });
      await registrar("tarefa.criou", feito.id, {
        responsavel: ctx.agente.papel === "especialista" ? "agente" : "pessoa",
      });
      await avisarDepois(
        ctx.poolApp,
        ctx.empresaId,
        { tipo: "agente", agenteId: ctx.agente.id },
        { tipo: "criou", tarefa: feito },
        ctx.log,
      );
      return { conteudo: { tarefa: feito } };
    }
    case "delegar": {
      const tarefaId = entrada.tarefaId as string;
      const alvoId = entrada.agenteId as string;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await tarefaDeQuemPediu(c, tarefaId, "editar", true);
        const alvo = await c.query<{ id: string }>(
          `select id from agentes where id = $1 and empresa_id = empresa_ativa() and tipo = 'interno'
              and papel = 'especialista' and situacao = 'ativo' and responde_a_id = $2`,
          [alvoId, ctx.agente.id],
        );
        if (!alvo.rows[0])
          throw new RecusaDaFerramenta(
            "Esse especialista não existe ou está pausado. Responda à pessoa sem delegar.",
          );
        if (tarefa.trava && !ehDoAgente(tarefa, ctx.agente.id))
          throw new RecusaDaFerramenta("Essa tarefa está pegada por outra pessoa ou agente agora.");
        const passada = await trocarResponsavel(c, agenteQuem, tarefa, { tipo: "agente", agenteId: alvoId });
        // O especialista herda quem pediu: delegar não aumenta permissão.
        const filha = await criarExecucao(c, {
          agenteId: alvoId,
          pedidoPor: pessoaId,
          origem: "delegacao",
          tarefaId,
          execucaoMaeId: execucaoId,
          instrucoes: entrada.instrucoes as string,
          leuTextoDeOutros: ctx.execucao.leuTextoDeOutros,
        });
        return { tarefa: passada, execucaoId: filha.id };
      });
      await registrar("tarefa.trocou_responsavel", tarefaId, { para: "agente" });
      await registrar("agente.delegou", tarefaId, { para: alvoId, execucaoFilhaId: feito.execucaoId });
      ctx.acordar(feito.execucaoId);
      return { conteudo: { ok: true, tarefaId, especialista: alvoId } };
    }
    case "planejar": {
      const tarefaId = entrada.tarefaId as string;
      const subtarefas =
        (entrada.subtarefas as {
          titulo: string;
          descricao?: string;
          prazo?: unknown;
          prioridade?: unknown;
        }[]) ?? [];
      const checklist = (entrada.checklist as string[]) ?? [];
      const feito = await naEmpresa(async (c) => {
        const mae = await tarefaDeQuemPediu(c, tarefaId, "editar", true);
        if (!ehDoAgente(mae, ctx.agente.id))
          throw new RecusaDaFerramenta("Você só planeja as tarefas passadas a você.");
        if (mae.tarefaMaeId !== null)
          throw new RecusaDaFerramenta("Subtarefa não tem subtarefas: planeje a tarefa-mãe.");
        const fuso = await fusoDaEmpresa(c);
        const criadas: Tarefa[] = [];
        for (const s of subtarefas) {
          const planejamento = {
            ...(s.prazo ? { prazo: s.prazo as never } : {}),
            ...(s.prioridade ? { prioridade: s.prioridade as never } : {}),
          };
          const recusa = await recusaDoPlanejamento(c, null, planejamento, true);
          if (recusa) throw new RecusaDaFerramenta(`${s.titulo}: ${recusa}`);
          const sub = await criarTarefa(c, agenteQuem, {
            titulo: s.titulo,
            descricao: s.descricao ?? null,
            responsavel: { tipo: "agente", agenteId: ctx.agente.id },
            tarefaMaeId: mae.id,
          });
          if (Object.keys(planejamento).length > 0) await planejar(c, sub, planejamento, fuso);
          criadas.push(sub);
        }
        const itens = [];
        for (const texto of checklist) itens.push(await criarItem(c, mae.id, texto, agenteQuem));
        return { criadas, itens: itens.length };
      });
      for (const s of feito.criadas) {
        await registrar("tarefa.criou", s.id, { responsavel: "agente", tarefaMaeId: tarefaId });
        await registrar("tarefa.criou_subtarefa", tarefaId, { subtarefaId: s.id });
      }
      return {
        conteudo: {
          subtarefas: feito.criadas.map((s) => ({ id: s.id, titulo: s.titulo })),
          itensDeChecklist: feito.itens,
        },
      };
    }
    case "atribuir": {
      const tarefaId = entrada.tarefaId as string;
      const responsavel = entrada.responsavel as Responsavel;
      const feito = await naEmpresa(async (c) => {
        const tarefa = await tarefaDeQuemPediu(c, tarefaId, "editar", true);
        // Só nas tarefas passadas ao agente e nas subtarefas delas.
        let dele = ehDoAgente(tarefa, ctx.agente.id);
        if (!dele && tarefa.tarefaMaeId) {
          const mae = await buscarTarefa(c, { ...agenteQuem, comoGerente: true }, tarefa.tarefaMaeId);
          dele = mae !== null && ehDoAgente(mae, ctx.agente.id);
        }
        if (!dele)
          throw new RecusaDaFerramenta("Você só atribui as tarefas passadas a você e as subtarefas delas.");
        const valido =
          responsavel.tipo === "agente"
            ? await agenteRecebeTarefas(c, responsavel.agenteId)
            : await pessoaAtivaNaEmpresa(c, responsavel.pessoaId);
        if (!valido) throw new RecusaDaFerramenta("Esse responsável não está ativo nesta empresa.");
        if (tarefa.trava && !ehDoAgente(tarefa, ctx.agente.id))
          throw new RecusaDaFerramenta("Essa tarefa está pegada por outra pessoa ou agente agora.");
        return trocarResponsavel(c, agenteQuem, tarefa, responsavel);
      });
      await registrar("tarefa.trocou_responsavel", tarefaId, { para: responsavel.tipo });
      await avisarDepois(
        ctx.poolApp,
        ctx.empresaId,
        { tipo: "agente", agenteId: ctx.agente.id },
        { tipo: "trocou_responsavel", tarefa: feito },
        ctx.log,
      );
      if (responsavel.tipo === "agente") await entregarAoAgente(tarefaId);
      return { conteudo: { tarefa: { id: feito.id, titulo: feito.titulo, responsavel: feito.responsavel } } };
    }
  }
  throw new RecusaDaFerramenta(`Ferramenta desconhecida: ${nome}`);
}

/** Comentário do agente numa tarefa (o resumo da delegação). */
export async function comentarComoAgente(
  ctx: ContextoDaFerramenta,
  tarefaId: string,
  texto: string,
): Promise<void> {
  const comentario = await comEmpresa(ctx.poolApp, ctx.empresaId, (c) =>
    comentar(c, { tipo: "agente", agenteId: ctx.agente.id }, tarefaId, texto.slice(0, 20000)),
  );
  await auditar(
    ctx.poolApp,
    {
      empresaId: ctx.empresaId,
      ator: { tipo: "agente", agenteId: ctx.agente.id },
      acao: "tarefa.comentou",
      alvo: { tipo: "tarefa", id: tarefaId },
      origem: ctx.opcoesMcp.origem,
      rastreio: null,
      detalhes: { comentarioId: comentario.id, execucaoId: ctx.semExecucao ? null : ctx.execucao.id },
    },
    ctx.log,
  );
}
