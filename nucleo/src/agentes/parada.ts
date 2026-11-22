/**
 * Parar todos os agentes (M4-09, decisão 0031): o freio de emergência da empresa.
 *
 * Parar guarda os agentes ativos na parada e os pausa (os agentes externos passam a receber "pausado" pelo MCP, e o
 * motor termina as execuções no passo atual). As tarefas ficam como estavam. Retomar devolve só os agentes da parada:
 * cada um volta a ativo, a tarefa que a parada interrompeu volta à fila dele e a fila que esperou anda. A parada
 * termina quando o último agente dela é retomado.
 */
import type { AgenteDaParada, Parada } from "@mago-os/contratos";
import type pg from "pg";
import { criarAviso } from "../avisos/index.ts";
import { mudarSituacao } from "./servico.ts";

/** Uma linha de paradas_de_agentes, como as consultas leem. */
interface LinhaDaParada {
  id: string;
  motivo: string;
  parada_por: string;
  parada_por_nome: string;
  da_plataforma: boolean;
  parada_em: Date;
}
const COLUNAS = "id, motivo, parada_por, parada_por_nome, da_plataforma, parada_em";

/** A parada ativa que pausou este agente, com o motivo (nulo: o agente não está parado por uma parada). */
export async function paradaDoAgente(
  c: pg.PoolClient,
  agenteId: string,
): Promise<{ id: string; motivo: string } | null> {
  const r = await c.query<{ id: string; motivo: string }>(
    `select p.id, p.motivo from agentes_da_parada d
       join paradas_de_agentes p on p.id = d.parada_id and p.empresa_id = d.empresa_id
      where d.empresa_id = empresa_ativa() and d.agente_id = $1 and d.retomado_em is null limit 1`,
    [agenteId],
  );
  return r.rows[0] ?? null;
}

/** Há uma parada ativa na empresa? */
export async function haParadaAtiva(c: pg.PoolClient): Promise<boolean> {
  const r = await c.query(
    "select 1 from paradas_de_agentes where empresa_id = empresa_ativa() and retomada_em is null",
  );
  return (r.rowCount ?? 0) > 0;
}

/** A parada ativa da empresa, com os agentes dela. */
export async function paradaAtiva(c: pg.PoolClient): Promise<Parada | null> {
  const p = await c.query<LinhaDaParada>(
    `select ${COLUNAS} from paradas_de_agentes where empresa_id = empresa_ativa() and retomada_em is null`,
  );
  const parada = p.rows[0];
  if (!parada) return null;
  return { ...cabecalho(parada), agentes: await agentesDaParada(c, parada.id) };
}

function cabecalho(p: LinhaDaParada): Omit<Parada, "agentes"> {
  return {
    id: p.id,
    motivo: p.motivo,
    paradaPor: { id: p.parada_por, nome: p.parada_por_nome },
    paradaEm: p.parada_em.toISOString(),
    daPlataforma: p.da_plataforma,
    retomadaEm: null,
  };
}

async function agentesDaParada(c: pg.PoolClient, paradaId: string): Promise<AgenteDaParada[]> {
  const r = await c.query<{
    agente_id: string;
    nome: string;
    tipo: "interno" | "externo";
    retomado_em: Date | null;
    interrompidas: number;
  }>(
    `select d.agente_id, a.nome, a.tipo, d.retomado_em,
            (select count(*)::int from execucoes_de_agente e
              where e.empresa_id = d.empresa_id and e.parada_id = d.parada_id and e.agente_id = d.agente_id)
              as interrompidas
       from agentes_da_parada d join agentes a on a.id = d.agente_id and a.empresa_id = d.empresa_id
      where d.empresa_id = empresa_ativa() and d.parada_id = $1
      order by a.nome`,
    [paradaId],
  );
  return r.rows.map((a) => ({
    agenteId: a.agente_id,
    nome: a.nome,
    tipo: a.tipo,
    retomadoEm: a.retomado_em?.toISOString() ?? null,
    execucoesInterrompidas: a.interrompidas,
  }));
}

/**
 * Uma parada de cada vez por empresa: dois cliques ao mesmo tempo não criam duas. O motor também trava ao marcar a
 * execução que a parada interrompeu, para a retomada ao mesmo tempo não perder a tarefa dela.
 */
export async function travarParadas(c: pg.PoolClient): Promise<void> {
  await c.query("select pg_advisory_xact_lock(hashtextextended('paradas:' || empresa_ativa()::text, 0))");
}

/**
 * Para todos os agentes ativos da empresa. Com uma parada já ativa (depois de uma retomada de parte dos agentes), os
 * ativos entram nela e param de novo; jaParada diz que nenhum agente parou agora. Os responsáveis pelos agentes e os
 * administradores recebem o aviso.
 */
export async function pararTodos(
  c: pg.PoolClient,
  d: { pessoaId: string; nome: string; motivo: string; daPlataforma: boolean },
): Promise<{ parada: Parada; jaParada: boolean; pausados: number }> {
  await travarParadas(c);
  const atual = await c.query<LinhaDaParada>(
    `select ${COLUNAS} from paradas_de_agentes where empresa_id = empresa_ativa() and retomada_em is null`,
  );
  let parada = atual.rows[0];
  if (parada) {
    // O Dono para quando a empresa já tinha parado: a parada passa a ser dele (só ele retoma).
    if (d.daPlataforma && !parada.da_plataforma) {
      await c.query(
        "update paradas_de_agentes set da_plataforma = true where id = $1 and empresa_id = empresa_ativa()",
        [parada.id],
      );
      parada = { ...parada, da_plataforma: true };
    }
  } else {
    const p = await c.query<LinhaDaParada>(
      `insert into paradas_de_agentes (empresa_id, motivo, parada_por, parada_por_nome, da_plataforma)
       values (empresa_ativa(), $1, $2, $3, $4) returning ${COLUNAS}`,
      [d.motivo.trim(), d.pessoaId, d.nome.slice(0, 200), d.daPlataforma],
    );
    parada = p.rows[0] as LinhaDaParada;
  }
  const pausados = await c.query<{ id: string; responsavel_id: string }>(
    `with ativos as (
       select id from agentes where empresa_id = empresa_ativa() and situacao = 'ativo' for update
     ), guardados as (
       insert into agentes_da_parada (empresa_id, parada_id, agente_id)
       select empresa_ativa(), $1, id from ativos
       on conflict (empresa_id, parada_id, agente_id) do update set retomado_em = null, retomado_por = null
     )
     update agentes a set situacao = 'pausado', atualizado_em = now()
       from ativos where a.id = ativos.id and a.empresa_id = empresa_ativa()
     returning a.id, a.responsavel_id`,
    [parada.id],
  );
  const jaParada = atual.rows.length > 0 && pausados.rows.length === 0;
  if (!jaParada)
    await avisar(c, {
      tipo: "agentes_parados",
      texto: `Os agentes foram parados por ${d.nome}: ${d.motivo.trim()}`,
      responsaveis: pausados.rows.map((a) => a.responsavel_id),
    });
  return {
    parada: { ...cabecalho(parada), agentes: await agentesDaParada(c, parada.id) },
    jaParada,
    pausados: pausados.rows.length,
  };
}

/** O aviso vai para os responsáveis pelos agentes e para os administradores (uma vez para cada pessoa). */
async function avisar(
  c: pg.PoolClient,
  d: { tipo: "agentes_parados" | "agentes_retomados"; texto: string; responsaveis: string[] },
): Promise<void> {
  const r = await c.query<{ pessoa_id: string }>(
    `select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
        and (perfil = 'administrador' or pessoa_id = any($1::uuid[]))`,
    [d.responsaveis],
  );
  for (const p of r.rows)
    await criarAviso(c, {
      pessoaId: p.pessoa_id,
      tipo: d.tipo,
      texto: d.texto.slice(0, 300),
      link: "/agentes",
    });
}

export type ResultadoDaRetomada =
  | { erro: "sem_parada" | "so_o_dono" | "nenhum" }
  | {
      parada: Parada;
      retomados: string[];
      /** Saíram da parada sem voltar a ativo (interno sem modelo de IA, ou desligado no meio). */
      naoVoltaram: string[];
      /** Execuções para acordar: a tarefa interrompida que voltou à fila e a fila que esperou. */
      acordar: string[];
      terminou: boolean;
    };

/**
 * Retoma os agentes da parada ativa (todos, ou os escolhidos). Só o Dono da plataforma retoma uma parada dele.
 * Um agente desligado durante a parada não volta; um interno sem modelo de IA fica pausado (o administrador escolhe o
 * modelo e liga).
 */
export async function retomarDaParada(
  c: pg.PoolClient,
  /** soDaPlataforma: o Dono retomando pela plataforma (só as paradas dele). */
  d: {
    pessoaId: string;
    nome: string;
    agenteIds: string[] | null;
    comoDono: boolean;
    soDaPlataforma?: boolean;
  },
): Promise<ResultadoDaRetomada> {
  await travarParadas(c);
  const p = await c.query<LinhaDaParada>(
    `select ${COLUNAS} from paradas_de_agentes where empresa_id = empresa_ativa() and retomada_em is null`,
  );
  const parada = p.rows[0];
  if (!parada) return { erro: "sem_parada" };
  if (parada.da_plataforma && !d.comoDono) return { erro: "so_o_dono" };
  if (d.soDaPlataforma && !parada.da_plataforma) return { erro: "sem_parada" };
  const pendentes = await c.query<{ agente_id: string; situacao: string; tipo: string; com_modelo: boolean }>(
    `select d.agente_id, a.situacao, a.tipo, a.modelo_principal is not null as com_modelo
       from agentes_da_parada d join agentes a on a.id = d.agente_id and a.empresa_id = d.empresa_id
      where d.empresa_id = empresa_ativa() and d.parada_id = $1 and d.retomado_em is null
        and ($2::uuid[] is null or d.agente_id = any($2::uuid[]))
      for update of d`,
    [parada.id, d.agenteIds],
  );
  if (pendentes.rows.length === 0) return { erro: "nenhum" };
  const retomados: string[] = [];
  const responsaveis: string[] = [];
  for (const a of pendentes.rows) {
    if (a.situacao === "pausado" && (a.tipo === "externo" || a.com_modelo)) {
      const agente = await mudarSituacao(c, a.agente_id, "ativo");
      retomados.push(a.agente_id);
      responsaveis.push(agente.responsavelId);
    }
  }
  const ids = pendentes.rows.map((a) => a.agente_id);
  await c.query(
    `update agentes_da_parada set retomado_em = now(), retomado_por = $3
      where empresa_id = empresa_ativa() and parada_id = $1 and agente_id = any($2::uuid[])`,
    [parada.id, ids, d.pessoaId],
  );
  // A tarefa interrompida volta à fila de todos os que saíram da parada (menos os desligados); só a dos que voltaram a
  // ativo é acordada agora, a dos outros espera o agente ser ligado.
  const novas = (await devolverAFila(c, parada.id, ids))
    .filter((e) => retomados.includes(e.agenteId))
    .map((e) => e.id);
  const fila = await c.query<{ id: string }>(
    `select id from execucoes_de_agente
      where empresa_id = empresa_ativa() and agente_id = any($1::uuid[]) and situacao = 'na_fila'`,
    [retomados],
  );
  const resta = await c.query(
    "select 1 from agentes_da_parada where empresa_id = empresa_ativa() and parada_id = $1 and retomado_em is null",
    [parada.id],
  );
  const terminou = (resta.rowCount ?? 0) === 0;
  if (terminou)
    await c.query(
      "update paradas_de_agentes set retomada_em = now() where id = $1 and empresa_id = empresa_ativa()",
      [parada.id],
    );
  if (retomados.length > 0)
    await avisar(c, {
      tipo: "agentes_retomados",
      texto: terminou
        ? `${d.nome} retomou os agentes. Eles voltaram ao trabalho.`
        : `${d.nome} retomou ${retomados.length === 1 ? "um agente" : `${retomados.length} agentes`}.`,
      responsaveis,
    });
  const agentes = await agentesDaParada(c, parada.id);
  return {
    parada: {
      ...cabecalho(parada),
      retomadaEm: terminou ? new Date().toISOString() : null,
      agentes,
    },
    retomados,
    naoVoltaram: ids.filter((id) => !retomados.includes(id)),
    acordar: [...new Set([...novas, ...fila.rows.map((r) => r.id)])],
    terminou,
  };
}

/**
 * A tarefa que a parada interrompeu volta à fila do agente (uma vez, e só se ele não tem outra aberta nela). A
 * execução nova repete a original (quem pediu, a origem, a marca de texto de outros e a passada de onde veio).
 * Agente desligado não ganha execução. Devolve as execuções novas, para acordar.
 */
export async function devolverAFila(
  c: pg.PoolClient,
  paradaId: string,
  agenteIds: string[],
): Promise<{ id: string; agenteId: string }[]> {
  if (agenteIds.length === 0) return [];
  const novas = await c.query<{ id: string; agente_id: string }>(
    `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, tarefa_id, execucao_mae_id, instrucoes,
       leu_texto_de_outros)
     select distinct on (e.agente_id, e.tarefa_id) e.empresa_id, e.agente_id, e.pedido_por, e.origem, e.tarefa_id,
            e.execucao_mae_id, e.instrucoes, e.leu_texto_de_outros
       from execucoes_de_agente e
       join tarefas t on t.id = e.tarefa_id and t.empresa_id = e.empresa_id
       join agentes a on a.id = e.agente_id and a.empresa_id = e.empresa_id and a.situacao <> 'desligado'
      where e.empresa_id = empresa_ativa() and e.parada_id = $1 and e.agente_id = any($2::uuid[])
        and e.origem <> 'conversa' and t.status not in ('concluida', 'cancelada')
        and not exists (select 1 from execucoes_de_agente o
                         where o.empresa_id = e.empresa_id and o.agente_id = e.agente_id and o.tarefa_id = e.tarefa_id
                           and o.situacao in ('na_fila', 'rodando'))
      order by e.agente_id, e.tarefa_id, e.criada_em desc
     returning id, agente_id`,
    [paradaId, agenteIds],
  );
  return novas.rows.map((r) => ({ id: r.id, agenteId: r.agente_id }));
}

/** Agente cadastrado durante a parada nasce pausado e entra nela (volta junto com os outros). */
export async function entrarNaParada(c: pg.PoolClient, agenteId: string): Promise<boolean> {
  const r = await c.query(
    `with parada as (
       select id from paradas_de_agentes where empresa_id = empresa_ativa() and retomada_em is null
     ), pausado as (
       update agentes set situacao = 'pausado', atualizado_em = now()
        where id = $1 and empresa_id = empresa_ativa() and situacao = 'ativo' and exists (select 1 from parada)
        returning id
     )
     insert into agentes_da_parada (empresa_id, parada_id, agente_id)
     select empresa_ativa(), parada.id, pausado.id from parada, pausado
     returning agente_id`,
    [agenteId],
  );
  return (r.rowCount ?? 0) > 0;
}
