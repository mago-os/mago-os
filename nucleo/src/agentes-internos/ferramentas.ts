/**
 * Ferramentas dos agentes internos (M4-02, decisão 0023). Cada uma é uma ação do próprio núcleo, com as mesmas
 * regras das telas e do MCP. O agente age com a permissão de quem pediu: a tarefa precisa estar ao alcance dessa
 * pessoa, e o que o agente cria, comenta ou muda fica marcado como do agente. A regra completa (a menor das duas
 * permissões e as ações de alto risco) chega na M4-04; as aprovações, na M4-03.
 */
import {
  conferir,
  FERRAMENTAS_DO_MCP_NO_ESPECIALISTA,
  FERRAMENTAS_INTERNAS,
  FERRAMENTAS_MCP,
  type NomeDeFerramentaInterna,
  type PapelDeAgente,
  type Responsavel,
  type Tarefa,
} from "@mago-os/contratos";
import type pg from "pg";
import type { OpcoesDaChave } from "../agentes/chaves.ts";
import { agenteRecebeTarefas } from "../agentes/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarDepois } from "../avisos/eventos.ts";
import type { FerramentaParaModelo } from "../contas-de-ia/conversa.ts";
import { comEmpresa } from "../empresa.ts";
import { type AcaoDeTarefa, executar, RecusaDaFerramenta } from "../mcp/index.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import type { PermissoesNaEmpresa } from "../permissoes/verificar.ts";
import { criarItem } from "../tarefas/checklist.ts";
import { acontecimentoDaAcao, registrarAcontecimento } from "../tarefas/linha-do-tempo.ts";
import { fusoDaEmpresa, planejar, recusaDoPlanejamento } from "../tarefas/planejamento.ts";
import {
  buscarTarefa,
  comentar,
  criarTarefa,
  pessoaAtivaNaEmpresa,
  type Quem,
  trocarResponsavel,
} from "../tarefas/servico.ts";
import { criarExecucao, type ExecucaoComInstrucoes } from "./dados.ts";

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
}

/** O que a ferramenta devolveu ao modelo e, se for o fim, o que dizer à pessoa. */
export interface ResultadoDaFerramenta {
  conteudo: unknown;
  fim?: { tipo: "responder" | "perguntar"; texto: string; tarefas: string[] };
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

export async function executarFerramenta(
  ctx: ContextoDaFerramenta,
  nome: string,
  entradaBruta: unknown,
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
  const agenteQuem: Quem = { tipo: "agente", agenteId: ctx.agente.id };
  const naEmpresa = <T>(trabalho: (c: pg.PoolClient) => Promise<T>) =>
    comEmpresa(ctx.poolApp, ctx.empresaId, trabalho);

  /** A tarefa precisa estar ao alcance de quem pediu (a permissão da pessoa vale para o agente). */
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
    return t;
  }

  const registrar = async (acao: AcaoDeTarefa | "agente.delegou", tarefaId: string, detalhes = {}) => {
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
        detalhes: { ...detalhes, execucaoId: ctx.execucao.id, pedidoPor: pessoaId },
      },
      ctx.log,
    );
  };

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
    case "criar_tarefa": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "criar");
      if (!quem) throw new RecusaDaFerramenta("Quem pediu não pode criar tarefas.");
      const projetoId = entrada.projetoId as string | undefined;
      const feito = await naEmpresa(async (c) => {
        if (projetoId) {
          const p = await c.query(
            `select 1 from projetos where id = $1 and empresa_id = empresa_ativa() and (
               $2::boolean or exists (select 1 from membros_de_projeto m where m.projeto_id = projetos.id
                                         and m.pessoa_id = $3))`,
            [projetoId, (ctx.permissoes.modulos.get("projetos")?.acoes.ver ?? "nada") === "tudo", pessoaId],
          );
          if ((p.rowCount ?? 0) === 0)
            throw new RecusaDaFerramenta("Projeto não encontrado entre os de quem pediu.");
        }
        const planejamento = {
          ...(entrada.prazo ? { prazo: entrada.prazo as never } : {}),
          ...(entrada.prioridade ? { prioridade: entrada.prioridade as never } : {}),
        };
        const recusa = await recusaDoPlanejamento(c, null, planejamento);
        if (recusa) throw new RecusaDaFerramenta(recusa);
        // A tarefa nasce com quem pediu como responsável; o coordenador pode delegar em seguida.
        let tarefa = await criarTarefa(c, agenteQuem, {
          titulo: entrada.titulo as string,
          descricao: (entrada.descricao as string | undefined) ?? null,
          responsavel: { tipo: "pessoa", pessoaId },
          projetoId: projetoId ?? null,
        });
        if (Object.keys(planejamento).length > 0) {
          await planejar(c, tarefa, planejamento, await fusoDaEmpresa(c));
          tarefa = (await buscarTarefa(c, quem, tarefa.id)) ?? tarefa;
        }
        return tarefa;
      });
      await registrar("tarefa.criou", feito.id, { responsavel: "pessoa" });
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
          execucaoMaeId: ctx.execucao.id,
          instrucoes: entrada.instrucoes as string,
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
        for (const texto of checklist) itens.push(await criarItem(c, mae.id, texto));
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
      detalhes: { comentarioId: comentario.id, execucaoId: ctx.execucao.id },
    },
    ctx.log,
  );
}
