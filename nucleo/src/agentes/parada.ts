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

/** A parada ativa que pausou este agente (nulo: o agente não está parado por uma parada). */
export async function paradaDoAgente(c: pg.PoolClient, agenteId: string): Promise<string | null> {
  const r = await c.query<{ parada_id: string }>(
    `select parada_id from agentes_da_parada
      where empresa_id = empresa_ativa() and agente_id = $1 and retomado_em is null limit 1`,
    [agenteId],
  );
  return r.rows[0]?.parada_id ?? null;
}

/** A parada ativa da empresa, com os agentes dela. */
export async function paradaAtiva(c: pg.PoolClient): Promise<Parada | null> {
  const p = await c.query<{
    id: string;
    motivo: string;
    parada_por: string;
    parada_por_nome: string;
    da_plataforma: boolean;
    parada_em: Date;
  }>(
    `select id, motivo, parada_por, parada_por_nome, da_plataforma, parada_em from paradas_de_agentes
      where empresa_id = empresa_ativa() and retomada_em is null`,
  );
  const parada = p.rows[0];
  if (!parada) return null;
  return { ...cabecalho(parada), agentes: await agentesDaParada(c, parada.id) };
}

function cabecalho(p: {
  id: string;
  motivo: string;
  parada_por: string;
  parada_por_nome: string;
  da_plataforma: boolean;
  parada_em: Date;
}): Omit<Parada, "agentes"> {
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

/** Uma parada de cada vez por empresa: dois cliques ao mesmo tempo não criam duas. */
async function travarParadas(c: pg.PoolClient): Promise<void> {
  await c.query("select pg_advisory_xact_lock(hashtextextended('paradas:' || empresa_ativa()::text, 0))");
}

/**
 * Para todos os agentes ativos da empresa. Devolve a parada nova, ou a que já estava ativa (jaParada).
 * Os responsáveis pelos agentes e os administradores recebem o aviso.
 */
export async function pararTodos(
  c: pg.PoolClient,
  d: { pessoaId: string; nome: string; motivo: string; daPlataforma: boolean },
): Promise<{ parada: Parada; jaParada: boolean }> {
  await travarParadas(c);
  const atual = await paradaAtiva(c);
  if (atual) {
    // O Dono para quando a empresa já tinha parado: a parada passa a ser dele (só ele retoma).
    if (d.daPlataforma && !atual.daPlataforma) {
      await c.query(
        "update paradas_de_agentes set da_plataforma = true where id = $1 and empresa_id = empresa_ativa()",
        [atual.id],
      );
      return { parada: { ...atual, daPlataforma: true }, jaParada: true };
    }
    return { parada: atual, jaParada: true };
  }
  const p = await c.query<{
    id: string;
    motivo: string;
    parada_por: string;
    parada_por_nome: string;
    da_plataforma: boolean;
    parada_em: Date;
  }>(
    `insert into paradas_de_agentes (empresa_id, motivo, parada_por, parada_por_nome, da_plataforma)
     values (empresa_ativa(), $1, $2, $3, $4)
     returning id, motivo, parada_por, parada_por_nome, da_plataforma, parada_em`,
    [d.motivo.trim(), d.pessoaId, d.nome.slice(0, 200), d.daPlataforma],
  );
  const parada = p.rows[0] as (typeof p.rows)[number];
  const pausados = await c.query<{ id: string; responsavel_id: string }>(
    `with ativos as (
       select id from agentes where empresa_id = empresa_ativa() and situacao = 'ativo' for update
     ), guardados as (
       insert into agentes_da_parada (empresa_id, parada_id, agente_id)
       select empresa_ativa(), $1, id from ativos
     )
     update agentes a set situacao = 'pausado', atualizado_em = now()
       from ativos where a.id = ativos.id and a.empresa_id = empresa_ativa()
     returning a.id, a.responsavel_id`,
    [parada.id],
  );
  await avisar(c, {
    tipo: "agentes_parados",
    texto: `Os agentes foram parados por ${d.nome}: ${d.motivo.trim()}`,
    responsaveis: pausados.rows.map((a) => a.responsavel_id),
  });
  return { parada: { ...cabecalho(parada), agentes: await agentesDaParada(c, parada.id) }, jaParada: false };
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
  const p = await c.query<{
    id: string;
    motivo: string;
    parada_por: string;
    parada_por_nome: string;
    da_plataforma: boolean;
    parada_em: Date;
  }>(
    `select id, motivo, parada_por, parada_por_nome, da_plataforma, parada_em from paradas_de_agentes
      where empresa_id = empresa_ativa() and retomada_em is null`,
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
  const novas = await devolverAFila(c, parada.id, retomados);
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
    acordar: [...new Set([...novas, ...fila.rows.map((r) => r.id)])],
    terminou,
  };
}

/**
 * A tarefa que a parada interrompeu volta à fila do agente (uma vez, e só se ele não tem outra aberta nela). A
 * execução nova repete a original (quem pediu, a origem, a marca de texto de outros e a passada de onde veio).
 * Devolve as execuções novas, para acordar.
 */
export async function devolverAFila(
  c: pg.PoolClient,
  paradaId: string,
  agenteIds: string[],
): Promise<string[]> {
  if (agenteIds.length === 0) return [];
  const novas = await c.query<{ id: string }>(
    `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, tarefa_id, execucao_mae_id, instrucoes,
       leu_texto_de_outros)
     select distinct on (e.agente_id, e.tarefa_id) e.empresa_id, e.agente_id, e.pedido_por, e.origem, e.tarefa_id,
            e.execucao_mae_id, e.instrucoes, e.leu_texto_de_outros
       from execucoes_de_agente e
       join tarefas t on t.id = e.tarefa_id and t.empresa_id = e.empresa_id
      where e.empresa_id = empresa_ativa() and e.parada_id = $1 and e.agente_id = any($2::uuid[])
        and e.origem <> 'conversa' and t.status not in ('concluida', 'cancelada')
        and not exists (select 1 from execucoes_de_agente o
                         where o.empresa_id = e.empresa_id and o.agente_id = e.agente_id and o.tarefa_id = e.tarefa_id
                           and o.situacao in ('na_fila', 'rodando'))
      order by e.agente_id, e.tarefa_id, e.criada_em desc
     returning id`,
    [paradaId, agenteIds],
  );
  return novas.rows.map((r) => r.id);
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
