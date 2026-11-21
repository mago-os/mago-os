/**
 * Prioridade, prazo, etiquetas e recorrência da tarefa (M3-03). Cada função roda dentro da transação do chamador,
 * que já conferiu que quem pede alcança a tarefa. O momento do prazo é calculado pelo banco (gatilho calcular_prazo).
 */
import {
  conferirRegraDeRecorrencia,
  type Etiqueta,
  type PedidoDePlanejamento,
  type RegraDeRecorrencia,
  type Tarefa,
} from "@mago-os/contratos";
import type pg from "pg";
import { FORMATO_UUID } from "../comum.ts";
import { diferencaEmDias, proximoDia } from "./recorrencia.ts";

/** O fuso é um que o próprio banco conhece (é ele que calcula o momento do prazo). */
export async function fusoValido(c: pg.PoolClient, fuso: string): Promise<boolean> {
  const r = await c.query("select 1 from pg_timezone_names where name = $1", [fuso]);
  return (r.rowCount ?? 0) > 0;
}

/** Hoje, no fuso dado (AAAA-MM-DD). */
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Texto igual para o mesmo objeto, com as chaves em ordem (o jsonb do banco devolve em outra ordem). */
function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== "object") return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  const o = valor as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(",")}}`;
}

/** Fuso da empresa ativa (prazo sem fuso escolhido vale o da empresa). */
export async function fusoDaEmpresa(c: pg.PoolClient): Promise<string> {
  const r = await c.query<{ fuso_horario: string }>(
    "select fuso_horario from empresas where id = empresa_ativa()",
  );
  return r.rows[0]?.fuso_horario ?? "America/Sao_Paulo";
}

/** As etiquetas existem nesta empresa. */
export async function etiquetasDaEmpresa(c: pg.PoolClient, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  if (!ids.every((id) => FORMATO_UUID.test(id))) return false;
  const r = await c.query<{ n: number }>(
    "select count(*)::int as n from etiquetas where empresa_id = empresa_ativa() and id = any($1::uuid[])",
    [ids],
  );
  return r.rows[0]?.n === ids.length;
}

/**
 * Completa a regra antes de gravar: na mensal sem dia do mês, fica o dia do prazo (assim um prazo no dia 31 volta ao
 * 31 depois de um mês curto).
 */
export function completarRegra(regra: RegraDeRecorrencia, diaDoPrazo: string): RegraDeRecorrencia {
  if (regra.frequencia === "mensal" && regra.diaDoMes === undefined) {
    return { ...regra, diaDoMes: Number(diaDoPrazo.slice(8, 10)) };
  }
  return regra;
}

/** Sem o dia do mês guardado (para recalcular a partir de um prazo novo). */
function semDiaDoMes(regra: RegraDeRecorrencia): RegraDeRecorrencia {
  const { diaDoMes: _, ...resto } = regra;
  return resto;
}

/**
 * Confere o planejamento pedido contra o que a tarefa já tem (nulo: tarefa nova). Devolve o motivo da recusa, ou nulo.
 */
export async function recusaDoPlanejamento(
  c: pg.PoolClient,
  atual: Tarefa | null,
  pedido: PedidoDePlanejamento,
  /** A tarefa é (ou vai ser) uma subtarefa: subtarefa não se repete (só a tarefa-mãe). */
  ehSubtarefa = atual?.tarefaMaeId != null,
): Promise<string | null> {
  if (pedido.recorrencia) {
    if (ehSubtarefa) return "Subtarefa não se repete: ponha a recorrência na tarefa-mãe.";
    const r = conferirRegraDeRecorrencia(pedido.recorrencia);
    if (!r.ok) return "Confira a recorrência: dias da semana só na semanal, dia do mês só na mensal.";
  }
  if (pedido.prazo?.fuso && !(await fusoValido(c, pedido.prazo.fuso))) return "Fuso do prazo desconhecido.";
  if (pedido.etiquetas && !(await etiquetasDaEmpresa(c, pedido.etiquetas))) {
    return "Uma das etiquetas não existe nesta empresa.";
  }
  const prazo = pedido.prazo === undefined ? (atual?.prazo ?? null) : pedido.prazo;
  const recorrencia = pedido.recorrencia === undefined ? (atual?.recorrencia ?? null) : pedido.recorrencia;
  if (recorrencia && !prazo) return "Tarefa recorrente precisa de prazo.";
  if (recorrencia?.ate && prazo && recorrencia.ate < prazo.dia)
    return "A repetição precisa terminar depois do prazo.";
  const inicio = pedido.inicio === undefined ? (atual?.inicio ?? null) : pedido.inicio;
  if (inicio && prazo && inicio > prazo.dia) return "O início vem antes do prazo.";
  return null;
}

/** Grava o planejamento: só o que veio muda; nulo apaga. Devolve o que mudou, para a auditoria. */
export async function planejar(
  c: pg.PoolClient,
  tarefa: Tarefa,
  pedido: PedidoDePlanejamento,
  fusoPadrao: string,
): Promise<{ prioridade: boolean; prazo: boolean; etiquetas: boolean; recorrencia: boolean }> {
  // Prazo novo sem fuso continua no fuso que a tarefa já tinha (ou no da empresa, se não tinha prazo).
  const prazo =
    pedido.prazo === undefined
      ? tarefa.prazo
      : pedido.prazo === null
        ? null
        : {
            dia: pedido.prazo.dia,
            hora: pedido.prazo.hora ?? null,
            fuso: pedido.prazo.fuso ?? tarefa.prazo?.fuso ?? fusoPadrao,
          };
  // Mudou só o prazo: o dia do mês da recorrência mensal acompanha o prazo novo.
  const recorrenciaPedida =
    pedido.recorrencia === undefined
      ? tarefa.recorrencia && pedido.prazo !== undefined
        ? semDiaDoMes(tarefa.recorrencia)
        : tarefa.recorrencia
      : pedido.recorrencia;
  const recorrencia = recorrenciaPedida && prazo ? completarRegra(recorrenciaPedida, prazo.dia) : null;
  await c.query(
    `update tarefas set prioridade = $2, prazo_dia = $3::date, prazo_hora = $4::time, prazo_fuso = $5,
            inicio = $6::date, recorrencia = $7::jsonb, atualizada_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [
      tarefa.id,
      pedido.prioridade === undefined ? tarefa.prioridade : pedido.prioridade,
      prazo?.dia ?? null,
      prazo?.hora ?? null,
      prazo?.fuso ?? null,
      pedido.inicio === undefined ? tarefa.inicio : pedido.inicio,
      recorrencia ? JSON.stringify(recorrencia) : null,
    ],
  );
  let etiquetas = false;
  if (pedido.etiquetas !== undefined) {
    const antes = [...tarefa.etiquetas].sort().join(",");
    etiquetas = antes !== [...pedido.etiquetas].sort().join(",");
    if (etiquetas) await gravarEtiquetas(c, tarefa.id, pedido.etiquetas);
  }
  const chaveDoPrazo = (p: { dia: string; hora: string | null; fuso: string } | null) =>
    p ? `${p.dia} ${p.hora ?? ""} ${p.fuso}` : "";
  return {
    prioridade: pedido.prioridade !== undefined && pedido.prioridade !== tarefa.prioridade,
    prazo: pedido.prazo !== undefined && chaveDoPrazo(prazo) !== chaveDoPrazo(tarefa.prazo),
    etiquetas,
    recorrencia: canonico(recorrencia) !== canonico(tarefa.recorrencia),
  };
}

/** Deixa as etiquetas da tarefa iguais à lista: tira as que saíram e põe as que entraram. */
export async function gravarEtiquetas(
  c: pg.PoolClient,
  tarefaId: string,
  etiquetas: string[],
): Promise<void> {
  await c.query(
    `delete from etiquetas_de_tarefa where tarefa_id = $1 and empresa_id = empresa_ativa()
        and etiqueta_id <> all($2::uuid[])`,
    [tarefaId, etiquetas],
  );
  await c.query(
    `insert into etiquetas_de_tarefa (empresa_id, tarefa_id, etiqueta_id)
     select empresa_ativa(), $1, e from unnest($2::uuid[]) as e on conflict do nothing`,
    [tarefaId, etiquetas],
  );
}

/**
 * Ao concluir uma tarefa recorrente, cria a próxima (decisão 7 do Sandro): mesmo título, descrição, responsável,
 * projeto, lista, prioridade, etiquetas e checklist (desmarcado), com o próximo prazo (e o início andando junto).
 * Só uma próxima nasce de cada tarefa (índice único no banco), então concluir de novo não duplica. Devolve o id da
 * nova, ou nulo se não havia o que criar (sem recorrência, série acabou, ou a próxima já existe).
 */
export async function recorrerSePreciso(c: pg.PoolClient, tarefa: Tarefa): Promise<string | null> {
  if (tarefa.status !== "concluida" || !tarefa.recorrencia || !tarefa.prazo) return null;
  if (tarefa.tarefaMaeId !== null) return null;
  // O dia do prazo da primeira vez guarda o dia do mês e do ano (um 29 de fevereiro volta ao 29 no ano bissexto).
  const primeiro = await c.query<{ dia: string }>(
    `with recursive serie as (
       select id, recorrente_de_id, prazo_dia, 0 as passo from tarefas where id = $1 and empresa_id = empresa_ativa()
       union all
       select t.id, t.recorrente_de_id, t.prazo_dia, s.passo + 1 from tarefas t join serie s on t.id = s.recorrente_de_id
        where t.empresa_id = empresa_ativa() and s.passo < 1000)
     select to_char(prazo_dia, 'YYYY-MM-DD') as dia from serie order by passo desc limit 1`,
    [tarefa.id],
  );
  const diaOriginal = primeiro.rows[0]?.dia ?? tarefa.prazo.dia;
  // Concluída com atraso: a próxima vai para a primeira data da série a partir de hoje (não nasce já atrasada).
  const hoje = hojeNoFuso(tarefa.prazo.fuso);
  let ocorrencia = tarefa.ocorrencia;
  let dia: string | null = tarefa.prazo.dia;
  do {
    dia = proximoDia(tarefa.recorrencia, dia, ocorrencia, diaOriginal);
    ocorrencia += 1;
  } while (dia !== null && dia < hoje && ocorrencia < tarefa.ocorrencia + 100_000);
  if (!dia) return null;
  const desloca = diferencaEmDias(tarefa.prazo.dia, dia);
  // Responsável que não está mais ativo não recebe a próxima: ela fica sem responsável.
  const r = await c.query<{ id: string }>(
    `insert into tarefas (empresa_id, titulo, descricao, projeto_id, lista_id, prioridade, prazo_dia, prazo_hora,
                          prazo_fuso, inicio, recorrencia, ocorrencia, recorrente_de_id,
                          responsavel_pessoa_id, responsavel_agente_id)
     select t.empresa_id, t.titulo, t.descricao, t.projeto_id, t.lista_id, t.prioridade, $2::date, t.prazo_hora,
            t.prazo_fuso, t.inicio + $3::int, t.recorrencia, $4::int, t.id,
            (select v.pessoa_id from vinculos v where v.empresa_id = t.empresa_id
                and v.pessoa_id = t.responsavel_pessoa_id and v.situacao = 'ativo'),
            (select a.id from agentes a where a.empresa_id = t.empresa_id
                and a.id = t.responsavel_agente_id and a.situacao = 'ativo')
       from tarefas t where t.id = $1 and t.empresa_id = empresa_ativa() and t.tarefa_mae_id is null
     on conflict (recorrente_de_id) where recorrente_de_id is not null do nothing
     returning id`,
    [tarefa.id, dia, desloca, ocorrencia],
  );
  const nova = r.rows[0]?.id;
  if (!nova) return null;
  await c.query(
    `insert into etiquetas_de_tarefa (empresa_id, tarefa_id, etiqueta_id)
     select empresa_id, $2, etiqueta_id from etiquetas_de_tarefa where tarefa_id = $1 and empresa_id = empresa_ativa()`,
    [tarefa.id, nova],
  );
  await c.query(
    `insert into itens_de_checklist (empresa_id, tarefa_id, texto, ordem, escrito_por_pessoa_id, escrito_por_agente_id)
     select empresa_id, $2, texto, ordem, escrito_por_pessoa_id, escrito_por_agente_id
       from itens_de_checklist where tarefa_id = $1 and empresa_id = empresa_ativa()`,
    [tarefa.id, nova],
  );
  return nova;
}

// Etiquetas da empresa ------------------------------------------------------------------------------------------

const paraEtiqueta = (l: {
  id: string;
  empresa_id: string;
  nome: string;
  cor: string;
  criada_em: Date;
}): Etiqueta => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  cor: l.cor,
  criadaEm: l.criada_em.toISOString(),
});

export async function listarEtiquetas(c: pg.PoolClient): Promise<Etiqueta[]> {
  const r = await c.query(
    "select id, empresa_id, nome, cor, criada_em from etiquetas where empresa_id = empresa_ativa() order by lower(nome)",
  );
  return r.rows.map(paraEtiqueta);
}

/** Cria a etiqueta; nome repetido (sem diferença de maiúsculas) devolve nulo. */
export async function criarEtiqueta(c: pg.PoolClient, nome: string, cor: string): Promise<Etiqueta | null> {
  const r = await c.query(
    `insert into etiquetas (empresa_id, nome, cor) values (empresa_ativa(), $1, $2)
     on conflict (empresa_id, lower(nome)) do nothing returning id, empresa_id, nome, cor, criada_em`,
    [nome.trim(), cor],
  );
  return r.rows[0] ? paraEtiqueta(r.rows[0]) : null;
}

/** Exclui a etiqueta (sai de todas as tarefas). Devolve falso se não existe nesta empresa. */
export async function excluirEtiqueta(c: pg.PoolClient, id: string): Promise<boolean> {
  if (!FORMATO_UUID.test(id)) return false;
  const r = await c.query("delete from etiquetas where id = $1 and empresa_id = empresa_ativa()", [id]);
  return (r.rowCount ?? 0) > 0;
}
