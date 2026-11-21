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
import { listarAnexos } from "../anexos/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarDepois } from "../avisos/eventos.ts";
import { buscar as buscarNoMago } from "../busca/index.ts";
import type { FerramentaParaModelo } from "../contas-de-ia/conversa.ts";
import { comEmpresa } from "../empresa.ts";
import { type AcaoDeTarefa, executar, RecusaDaFerramenta } from "../mcp/index.ts";
import { filtroDoAlcance } from "../permissoes/calcular.ts";
import type { PermissoesNaEmpresa } from "../permissoes/verificar.ts";
import { buscarProjeto, listarProjetos } from "../projetos/servico.ts";
import { criarItem, listarChecklist } from "../tarefas/checklist.ts";
import { acontecimentoDaAcao, registrarAcontecimento } from "../tarefas/linha-do-tempo.ts";
import { fusoDaEmpresa, planejar, recusaDoPlanejamento } from "../tarefas/planejamento.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import {
  buscarTarefa,
  comentar,
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
          anexos: (await listarAnexos(c, tarefa.id, true)).map((a) => a.nome),
          nomes,
        };
      });
      return { conteudo: feito };
    }
    case "comentar": {
      const tarefaId = entrada.tarefaId as string;
      const feito = await naEmpresa(async (c) => {
        // Comentar pede só "ver", como na tela (M2-02).
        await tarefaDeQuemPediu(c, tarefaId, "ver");
        return comentar(c, { tipo: "agente", agenteId: ctx.agente.id }, tarefaId, entrada.texto as string);
      });
      await registrar("tarefa.comentou", tarefaId, { comentarioId: feito.id });
      const tarefa = await naEmpresa((c) => tarefaDeQuemPediu(c, tarefaId, "ver"));
      if (tarefa)
        await avisarDepois(
          ctx.poolApp,
          ctx.empresaId,
          { tipo: "agente", agenteId: ctx.agente.id },
          { tipo: "comentou", tarefa, comentario: feito },
          ctx.log,
        );
      return { conteudo: { comentarioId: feito.id } };
    }
    case "procurar_pessoa": {
      const sem = (t: string) =>
        t
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const procurado = sem(entrada.nome as string);
      const alcance = ctx.permissoes.modulos.get("pessoas")?.acoes.ver ?? "nada";
      const filtro = filtroDoAlcance(alcance, pessoaId, ctx.permissoes.area);
      const feito = await naEmpresa(async (c) => {
        // Pessoas pelo alcance de quem pediu (o mesmo da tela Pessoas); agentes, todos os ativos (todos veem agentes).
        const pessoas = filtro
          ? await c.query<{ id: string; nome: string; area: string | null }>(
              `select p.id, p.nome, v.area from vinculos v join pessoas p on p.id = v.pessoa_id
                where v.empresa_id = empresa_ativa() and v.situacao = 'ativo'
                  and ($1::text = 'tudo' or ($1 = 'equipe' and v.area is not distinct from $2) or v.pessoa_id = $3)
                order by lower(p.nome) limit 500`,
              [filtro.tipo, filtro.tipo === "equipe" ? filtro.area : null, pessoaId],
            )
          : { rows: [] };
        const agentes = await c.query<{ id: string; nome: string }>(
          `select id, nome from agentes where empresa_id = empresa_ativa() and situacao = 'ativo'
            order by lower(nome) limit 200`,
        );
        return [
          ...pessoas.rows.map((p) => ({ tipo: "pessoa" as const, id: p.id, nome: p.nome, area: p.area })),
          ...agentes.rows.map((a) => ({ tipo: "agente" as const, id: a.id, nome: a.nome, area: null })),
        ];
      });
      return { conteudo: { encontrados: feito.filter((x) => sem(x.nome).includes(procurado)).slice(0, 10) } };
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
        for (const texto of itens) await criarItem(c, tarefa.id, texto);
        return itens.length;
      });
      await registrar("checklist.editou", tarefaId, { acrescentados: n });
      return { conteudo: { acrescentados: n } };
    }
    case "minhas_prioridades": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
      if (!quem || quem.tipo !== "pessoa") throw new RecusaDaFerramenta("Quem pediu não vê tarefas.");
      const itens = await naEmpresa((c) => listarPrioridades(c, quem));
      return {
        conteudo: {
          itens: itens
            .slice(0, 30)
            .map((i) => ({ tipo: i.tipo, titulo: i.titulo, motivo: i.motivo, tarefaId: i.tarefaId })),
        },
      };
    }
    case "buscar": {
      const ver = (modulo: string) => ctx.permissoes.modulos.get(modulo)?.acoes.ver ?? "nada";
      const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
      const pessoas = filtroDoAlcance(ver("pessoas"), pessoaId, ctx.permissoes.area);
      const projetos = ver("projetos");
      const resultados = await naEmpresa((c) =>
        buscarNoMago(c, pessoaId, entrada.texto as string, {
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
        }),
      );
      return { conteudo: { resultados: resultados.slice(0, 30) } };
    }
    case "listar_tarefas": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "ver");
      if (!quem) throw new RecusaDaFerramenta("Quem pediu não vê tarefas.");
      const sem = (t: string) =>
        t
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const texto = typeof entrada.texto === "string" ? sem(entrada.texto) : null;
      const limite = typeof entrada.limite === "number" ? entrada.limite : 30;
      const feito = await naEmpresa(async (c) => {
        const todas = await listarTarefas(c, quem, {
          ...(entrada.minhas ? { minhas: true } : {}),
          ...(entrada.status ? { status: entrada.status as never } : {}),
          ...(entrada.projetoId ? { projetoId: entrada.projetoId as never } : {}),
          ...(entrada.prazo ? { prazo: entrada.prazo as never } : {}),
        });
        const filtradas = texto ? todas.filter((t) => sem(t.titulo).includes(texto)) : todas;
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
      const sem = (t: string) =>
        t
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const procurado = sem(entrada.nome as string);
      const projetos = await naEmpresa((c) =>
        listarProjetos(c, pessoaId, ver === "tudo" ? "todos" : "membro", { arquivados: false }),
      );
      const achados = projetos.filter((p) => sem(p.nome).includes(procurado)).slice(0, 10);
      return { conteudo: { projetos: achados.map((p) => ({ id: p.id, nome: p.nome })) } };
    }
    case "criar_tarefa": {
      const quem = quemPediu(ctx.permissoes, pessoaId, "criar");
      if (!quem) throw new RecusaDaFerramenta("Quem pediu não pode criar tarefas.");
      const projetoId = entrada.projetoId as string | undefined;
      const feito = await naEmpresa(async (c) => {
        if (projetoId) {
          const p = await c.query(
            `select 1 from projetos p where p.id = $1 and p.empresa_id = empresa_ativa() and p.situacao = 'ativo'
                and ($2::boolean or membro_do_projeto(p.id, $3))`,
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
