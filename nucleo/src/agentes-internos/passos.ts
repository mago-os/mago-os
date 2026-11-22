/**
 * Passo a passo das execuções (M4-07, decisão 0029): gravar cada passo (resposta do modelo, ferramenta, aviso do
 * sistema) e ler, com o recorte de quem vê. Quem pediu, o responsável pelo agente e o administrador veem parâmetros e
 * resultados; quem só vê a tarefa vê o resumo e os nomes dos passos; quem não vê a tarefa não vê a execução.
 */
import {
  CARACTERES_POR_PASSO,
  type DetalheDaExecucao,
  type ExecucaoNaLista,
  type PassoDaExecucao,
  type TipoDePasso,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";
import { buscarExecucao } from "./dados.ts";

/** Guarda um valor até o limite; acima, guarda o começo do texto e marca como cortado. */
function caber(valor: unknown): { valor: unknown; cortado: boolean } {
  if (valor === undefined || valor === null) return { valor: null, cortado: false };
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
  if (texto === undefined) return { valor: null, cortado: false };
  if (texto.length <= CARACTERES_POR_PASSO)
    return { valor: typeof valor === "string" ? valor : JSON.parse(texto), cortado: false };
  return { valor: `${texto.slice(0, CARACTERES_POR_PASSO)}…`, cortado: true };
}

export async function registrarPasso(
  c: pg.PoolClient,
  d: {
    execucaoId: string | null;
    agenteId: string;
    tarefaId: string | null;
    tipo: TipoDePasso;
    duracaoMs?: number | null;
    modelo?: string | null;
    texto?: string | null;
    ferramenta?: string | null;
    entrada?: unknown;
    resultado?: unknown;
    erro?: boolean;
    consumoId?: string | null;
    aprovacaoId?: string | null;
  },
): Promise<void> {
  const entrada = caber(d.entrada);
  const resultado = caber(d.resultado);
  const texto = d.texto ?? null;
  const tarefa = d.tarefaId && FORMATO_UUID.test(d.tarefaId) ? d.tarefaId : null;
  await c.query(
    `insert into passos_de_execucao (empresa_id, execucao_id, agente_id, tarefa_id, tipo, duracao_ms, modelo, texto,
       ferramenta, entrada, resultado, erro, cortado, consumo_id, aprovacao_id)
     values (empresa_ativa(), $1, $2,
             (select id from tarefas where id = $3 and empresa_id = empresa_ativa()),
             $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13,
             (select id from aprovacoes where id = $14 and empresa_id = empresa_ativa()))`,
    [
      d.execucaoId,
      d.agenteId,
      tarefa,
      d.tipo,
      d.duracaoMs === undefined || d.duracaoMs === null ? null : Math.max(0, Math.round(d.duracaoMs)),
      d.modelo?.slice(0, 120) ?? null,
      texto === null ? null : texto.slice(0, CARACTERES_POR_PASSO),
      d.ferramenta?.slice(0, 400) ?? null,
      entrada.valor === null ? null : JSON.stringify(entrada.valor),
      resultado.valor === null ? null : JSON.stringify(resultado.valor),
      d.erro ?? false,
      entrada.cortado || resultado.cortado || (texto !== null && texto.length > CARACTERES_POR_PASSO),
      d.consumoId ?? null,
      d.aprovacaoId && FORMATO_UUID.test(d.aprovacaoId) ? d.aprovacaoId : null,
    ],
  );
}

interface LinhaDoPasso {
  id: string;
  tipo: TipoDePasso;
  criado_em: Date;
  duracao_ms: number | null;
  modelo: string | null;
  texto: string | null;
  ferramenta: string | null;
  entrada: unknown;
  resultado: unknown;
  erro: boolean;
  cortado: boolean;
  aprovacao_id: string | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  tokens_cache: number | null;
  custo_micros: string | null;
}

function paraPasso(l: LinhaDoPasso, numero: number, comDetalhes: boolean): PassoDaExecucao {
  const temTokens = l.tokens_entrada !== null;
  return {
    id: l.id,
    numero,
    tipo: l.tipo,
    criadoEm: l.criado_em.toISOString(),
    duracaoMs: l.duracao_ms,
    modelo: l.modelo,
    // Sem detalhes: o que o modelo disse e os dados das ferramentas ficam de fora; os avisos do sistema aparecem.
    texto: comDetalhes || l.tipo === "sistema" ? l.texto : null,
    ferramenta: l.ferramenta,
    entrada: comDetalhes ? l.entrada : null,
    resultado: comDetalhes ? l.resultado : null,
    erro: l.erro,
    cortado: l.cortado,
    tokens: temTokens
      ? { entrada: l.tokens_entrada ?? 0, saida: l.tokens_saida ?? 0, cache: l.tokens_cache ?? 0 }
      : null,
    custo: l.custo_micros === null ? null : Number(l.custo_micros),
    aprovacaoId: comDetalhes ? l.aprovacao_id : null,
  };
}

const COLUNAS_DO_PASSO = `p.id, p.tipo, p.criado_em, p.duracao_ms, p.modelo, p.texto, p.ferramenta, p.entrada,
  p.resultado, p.erro, p.cortado, p.aprovacao_id, k.tokens_entrada, k.tokens_saida, k.tokens_cache, k.custo_micros`;

/** Quem vê os detalhes de um agente: quem pediu, o responsável por ele e o administrador. */
async function veDetalhes(
  c: pg.PoolClient,
  agenteId: string,
  pedidoPor: string | null,
  pessoaId: string,
  administrador: boolean,
): Promise<boolean> {
  if (administrador || pedidoPor === pessoaId) return true;
  const r = await c.query(
    "select 1 from agentes where id = $1 and empresa_id = empresa_ativa() and responsavel_id = $2",
    [agenteId, pessoaId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Uma execução para uma pessoa. tarefaVisivel: a pessoa vê a tarefa da execução (conferido por quem chama, com o
 * alcance dela). Sem detalhes e sem ver a tarefa (ou execução de conversa): null.
 */
export async function detalheDaExecucao(
  c: pg.PoolClient,
  execucaoId: string,
  pessoa: { id: string; administrador: boolean },
  tarefaVisivel: (tarefaId: string) => Promise<boolean>,
): Promise<DetalheDaExecucao | null> {
  if (!FORMATO_UUID.test(execucaoId)) return null;
  const e = await buscarExecucao(c, execucaoId);
  if (!e) return null;
  const comDetalhes = await veDetalhes(c, e.agenteId, e.pedidoPor, pessoa.id, pessoa.administrador);
  if (!comDetalhes && !(e.tarefaId && e.origem !== "conversa" && (await tarefaVisivel(e.tarefaId))))
    return null;
  const nomes = await c.query<{ agente: string | null; pessoa: string | null }>(
    `select (select nome from agentes where id = $1 and empresa_id = empresa_ativa()) as agente,
            (select nome from pessoas where id = $2) as pessoa`,
    [e.agenteId, e.pedidoPor],
  );
  const passos = await c.query<LinhaDoPasso>(
    `select ${COLUNAS_DO_PASSO} from passos_de_execucao p left join consumo_de_ia k on k.id = p.consumo_id
      where p.empresa_id = empresa_ativa() and p.execucao_id = $1 order by p.criado_em, p.id`,
    [execucaoId],
  );
  const total = await c.query<{ entrada: string; saida: string; cache: string; custo: string }>(
    `select coalesce(sum(tokens_entrada), 0) as entrada, coalesce(sum(tokens_saida), 0) as saida,
            coalesce(sum(tokens_cache), 0) as cache, coalesce(sum(custo_micros), 0) as custo
       from consumo_de_ia where empresa_id = empresa_ativa() and execucao_id = $1`,
    [execucaoId],
  );
  const t = total.rows[0];
  const inicio = e.iniciadaEm ? Date.parse(e.iniciadaEm) : null;
  const fim = e.terminadaEm ? Date.parse(e.terminadaEm) : null;
  const terminouHaMuito = fim !== null && Date.now() - fim > 90 * 86_400_000;
  return {
    execucao: e,
    agenteNome: nomes.rows[0]?.agente ?? "Agente",
    pedidoPorNome: nomes.rows[0]?.pessoa ?? "Alguém",
    duracaoMs: inicio !== null && fim !== null ? Math.max(0, fim - inicio) : null,
    tokens: { entrada: Number(t?.entrada ?? 0), saida: Number(t?.saida ?? 0), cache: Number(t?.cache ?? 0) },
    custo: Number(t?.custo ?? 0),
    comDetalhes,
    passosApagados: passos.rows.length === 0 && terminouHaMuito,
    passos: passos.rows.map((l, i) => paraPasso(l, i + 1, comDetalhes)),
  };
}

interface LinhaDaLista {
  id: string;
  agente_id: string;
  agente_nome: string;
  origem: string;
  situacao: string;
  tarefa_id: string | null;
  resumo: string | null;
  criada_em: Date;
  iniciada_em: Date | null;
  terminada_em: Date | null;
  custo: string;
}

const paraLinha = (l: LinhaDaLista): ExecucaoNaLista => ({
  id: l.id,
  agenteId: l.agente_id,
  agenteNome: l.agente_nome,
  origem: l.origem,
  situacao: l.situacao,
  tarefaId: l.tarefa_id,
  resumo: l.resumo,
  criadaEm: l.criada_em.toISOString(),
  duracaoMs:
    l.iniciada_em && l.terminada_em ? Math.max(0, l.terminada_em.getTime() - l.iniciada_em.getTime()) : null,
  custo: Number(l.custo),
});

const SELECT_DA_LISTA = `select e.id, e.agente_id, g.nome as agente_nome, e.origem, e.situacao, e.tarefa_id, e.resumo,
    e.criada_em, e.iniciada_em, e.terminada_em,
    coalesce((select sum(k.custo_micros) from consumo_de_ia k where k.execucao_id = e.id), 0) as custo
  from execucoes_de_agente e join agentes g on g.id = e.agente_id and g.empresa_id = e.empresa_id`;

/** As execuções de uma tarefa (quem chama já conferiu que a pessoa vê a tarefa). */
export async function execucoesDaTarefa(c: pg.PoolClient, tarefaId: string): Promise<ExecucaoNaLista[]> {
  const r = await c.query<LinhaDaLista>(
    `${SELECT_DA_LISTA} where e.empresa_id = empresa_ativa() and e.tarefa_id = $1 and e.origem <> 'conversa'
      order by e.criada_em desc limit 50`,
    [tarefaId],
  );
  return r.rows.map(paraLinha);
}

/**
 * As execuções recentes de um agente que a pessoa pode abrir: todas, se ela vê os detalhes do agente (responsável ou
 * administrador); senão, só as que ela pediu.
 */
export async function execucoesDoAgente(
  c: pg.PoolClient,
  agenteId: string,
  pessoa: { id: string; administrador: boolean },
): Promise<ExecucaoNaLista[]> {
  const todas = await veDetalhes(c, agenteId, null, pessoa.id, pessoa.administrador);
  const r = await c.query<LinhaDaLista>(
    `${SELECT_DA_LISTA} where e.empresa_id = empresa_ativa() and e.agente_id = $1 and ($2::boolean or e.pedido_por = $3)
      order by e.criada_em desc limit 50`,
    [agenteId, todas, pessoa.id],
  );
  return r.rows.map(paraLinha);
}

/** O que os agentes externos fizeram pelo MCP numa tarefa, agrupado por agente. */
export async function atividadeExternaDaTarefa(
  c: pg.PoolClient,
  tarefaId: string,
  pessoa: { id: string; administrador: boolean },
): Promise<{ agenteId: string; agenteNome: string; comDetalhes: boolean; passos: PassoDaExecucao[] }[]> {
  const r = await c.query<LinhaDoPasso & { agente_id: string; agente_nome: string }>(
    `select ${COLUNAS_DO_PASSO}, p.agente_id, g.nome as agente_nome
       from passos_de_execucao p
       join agentes g on g.id = p.agente_id and g.empresa_id = p.empresa_id
       left join consumo_de_ia k on k.id = p.consumo_id
      where p.empresa_id = empresa_ativa() and p.tarefa_id = $1 and p.execucao_id is null
      order by p.criado_em, p.id limit 500`,
    [tarefaId],
  );
  const grupos = new Map<string, { agenteNome: string; linhas: LinhaDoPasso[] }>();
  for (const l of r.rows) {
    const g = grupos.get(l.agente_id) ?? { agenteNome: l.agente_nome, linhas: [] };
    g.linhas.push(l);
    grupos.set(l.agente_id, g);
  }
  const lista = [];
  for (const [agenteId, g] of grupos) {
    const comDetalhes = await veDetalhes(c, agenteId, null, pessoa.id, pessoa.administrador);
    lista.push({
      agenteId,
      agenteNome: g.agenteNome,
      comDetalhes,
      passos: g.linhas.map((l, i) => paraPasso(l, i + 1, comDetalhes)),
    });
  }
  return lista;
}

/** A verificação diária: apaga os passos com mais de 90 dias. */
export async function apagarPassosAntigos(poolApp: pg.Pool): Promise<number> {
  const r = await poolApp.query<{ n: number }>("select apagar_passos_antigos() as n");
  return r.rows[0]?.n ?? 0;
}
