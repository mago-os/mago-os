/**
 * Regras por ação e aprovações (M4-03, decisão 0025). Cada função roda na transação de quem chamou (o banco já
 * isola a empresa).
 *
 * - O modo de uma ação vem do ajuste do administrador (regras_de_agente) ou do padrão do catálogo para o tipo do agente.
 * - "executa_nas_dele": executa nas tarefas de que o agente é responsável ou que pegou (e nas subtarefas delas); nas
 *   outras, pede aprovação.
 * - Pedido de aprovação: guarda os parâmetros exatos, um resumo montado aqui (não é texto do agente) e o resumo
 *   SHA-256 dos parâmetros, que quem aprova manda de volta.
 */
import { createHash } from "node:crypto";
import {
  type Aprovacao,
  CATALOGO_DE_ACOES,
  HORAS_PARA_VENCER,
  type ModoDeAcao,
  maisRestrito,
  padraoDaAcao,
  type RegraDeAgente,
  type SituacaoDaAprovacao,
} from "@mago-os/contratos";
import type pg from "pg";
import { criarAviso } from "../avisos/index.ts";
import { FORMATO_UUID } from "../comum.ts";

export type TipoDoAgente = "interno" | "externo";

/** O modo da ação para o agente: o ajuste, se houver, ou o padrão. Ação fora do catálogo: bloqueada. */
export async function modoDaAcao(
  c: pg.PoolClient,
  agente: { id: string; tipo: TipoDoAgente },
  acao: string,
): Promise<ModoDeAcao> {
  const padrao = padraoDaAcao(acao, agente.tipo);
  if (!padrao) return "bloqueado";
  const r = await c.query<{ modo: ModoDeAcao | null }>(
    "select modo from regras_de_agente where agente_id = $1 and acao = $2 and empresa_id = empresa_ativa()",
    [agente.id, acao],
  );
  return r.rows[0]?.modo ?? padrao;
}

/** A tarefa é do agente: ele é o responsável ou pegou, ou é subtarefa de uma assim. */
export async function tarefaEhDoAgente(
  c: pg.PoolClient,
  agenteId: string,
  tarefaId: string,
): Promise<boolean> {
  if (!FORMATO_UUID.test(tarefaId)) return false;
  const r = await c.query(
    `select 1 from tarefas t left join tarefas m on m.id = t.tarefa_mae_id and m.empresa_id = t.empresa_id
      where t.id = $2 and t.empresa_id = empresa_ativa()
        and ($1 in (t.responsavel_agente_id, t.travada_por_agente_id)
             or $1 in (m.responsavel_agente_id, m.travada_por_agente_id))`,
    [agenteId, tarefaId],
  );
  return (r.rowCount ?? 0) > 0;
}

export type Avaliacao = "executa" | "aprovacao" | "bloqueado";

/** O que fazer com uma chamada de ferramenta, pela regra (a permissão de quem pediu é conferida depois, na ação). */
export async function avaliarAcao(
  c: pg.PoolClient,
  agente: { id: string; tipo: TipoDoAgente },
  acao: string,
  entrada: Record<string, unknown>,
): Promise<Avaliacao> {
  const modo = await modoDaAcao(c, agente, acao);
  if (modo === "bloqueado") return "bloqueado";
  if (modo === "executa") return "executa";
  if (modo === "pede_aprovacao") return "aprovacao";
  // executa_nas_dele: sem tarefa na entrada (ex.: criar), executa; com tarefa, só se for do agente.
  const tarefaId = typeof entrada.tarefaId === "string" ? entrada.tarefaId : null;
  if (!tarefaId) return "executa";
  return (await tarefaEhDoAgente(c, agente.id, tarefaId)) ? "executa" : "aprovacao";
}

/** As regras do agente, como a tela mostra (só as ações que existem para o tipo dele). */
export async function listarRegras(
  c: pg.PoolClient,
  agente: { id: string; tipo: TipoDoAgente },
): Promise<RegraDeAgente[]> {
  const r = await c.query<{ acao: string; modo: ModoDeAcao | null; aprovadas_sem_edicao: number }>(
    "select acao, modo, aprovadas_sem_edicao from regras_de_agente where agente_id = $1 and empresa_id = empresa_ativa()",
    [agente.id],
  );
  const ajustes = new Map(r.rows.map((l) => [l.acao, l]));
  return CATALOGO_DE_ACOES.flatMap((a) => {
    const padrao = agente.tipo === "interno" ? a.padraoInterno : a.padraoExterno;
    if (!padrao) return [];
    const ajuste = ajustes.get(a.acao);
    return [
      {
        acao: a.acao,
        nome: a.nome,
        mudaDados: a.mudaDados,
        modo: ajuste?.modo ?? padrao,
        padrao,
        ajustada: ajuste?.modo != null,
        aprovadasSemEdicao: ajuste?.aprovadas_sem_edicao ?? 0,
      },
    ];
  });
}

/**
 * Muda as regras. O administrador muda qualquer uma; o responsável do agente só deixa mais restrito do que está.
 * Ação que não muda dados nunca pede aprovação (só executa ou bloqueado). Devolve as mudanças feitas, ou o problema.
 */
export async function mudarRegras(
  c: pg.PoolClient,
  agente: { id: string; tipo: TipoDoAgente },
  mudancas: { acao: string; modo: ModoDeAcao | null }[],
  quem: { pessoaId: string; administrador: boolean },
): Promise<{ problema: string } | { mudou: { acao: string; de: ModoDeAcao; para: ModoDeAcao }[] }> {
  const atuais = new Map((await listarRegras(c, agente)).map((r) => [r.acao, r]));
  const mudou: { acao: string; de: ModoDeAcao; para: ModoDeAcao }[] = [];
  for (const m of mudancas) {
    const atual = atuais.get(m.acao);
    if (!atual) return { problema: `A ação ${m.acao} não existe para este agente.` };
    const para = m.modo ?? atual.padrao;
    if (!atual.mudaDados && (para === "pede_aprovacao" || para === "executa_nas_dele"))
      return { problema: `${atual.nome} só lê: fica em executa ou bloqueado.` };
    if (!quem.administrador && !maisRestrito(atual.modo, para))
      return { problema: "O responsável pelo agente só pode deixar as regras mais restritas." };
    if (para === atual.modo) continue;
    await c.query(
      `insert into regras_de_agente (empresa_id, agente_id, acao, modo, mudada_por, mudada_em)
       values (empresa_ativa(), $1, $2, $3, $4, now())
       on conflict (agente_id, acao) do update set modo = excluded.modo, mudada_por = excluded.mudada_por,
          mudada_em = excluded.mudada_em, aprovadas_sem_edicao = 0`,
      [agente.id, m.acao, m.modo, quem.pessoaId],
    );
    mudou.push({ acao: m.acao, de: atual.modo, para });
  }
  return { mudou };
}

/** JSON com as chaves em ordem: o mesmo objeto dá sempre o mesmo texto (e o mesmo resumo SHA-256). */
export function jsonCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  if (valor && typeof valor === "object")
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico((valor as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(valor ?? null);
}

export function conferenciaDe(parametros: Record<string, unknown>): string {
  return createHash("sha256").update(jsonCanonico(parametros)).digest("hex");
}

/** O resumo do pedido, montado pelo núcleo a partir dos dados (não do texto do agente). */
export async function resumoDaAcao(
  c: pg.PoolClient,
  acao: string,
  p: Record<string, unknown>,
): Promise<string> {
  const nomeDaAcao = CATALOGO_DE_ACOES.find((a) => a.acao === acao)?.nome ?? acao;
  const titulo = async (id: unknown) => {
    if (typeof id !== "string" || !FORMATO_UUID.test(id)) return null;
    const r = await c.query<{ titulo: string }>(
      "select titulo from tarefas where id = $1 and empresa_id = empresa_ativa()",
      [id],
    );
    return r.rows[0]?.titulo ?? null;
  };
  const nome = async (resp: unknown) => {
    const r = resp as { tipo?: string; pessoaId?: string; agenteId?: string } | null;
    const id = r?.tipo === "pessoa" ? r.pessoaId : r?.agenteId;
    if (!id || !FORMATO_UUID.test(id)) return "alguém";
    const q = await c.query<{ nome: string }>(
      `select nome from pessoas where id = $1
       union all select nome from agentes where id = $1 and empresa_id = empresa_ativa() limit 1`,
      [id],
    );
    return q.rows[0]?.nome ?? "alguém";
  };
  const t = await titulo(p.tarefaId);
  const naTarefa = t ? ` “${t.slice(0, 120)}”` : "";
  let frase: string;
  if (acao === "atribuir") frase = `Atribuir${naTarefa} a ${await nome(p.responsavel)}`;
  else if (acao === "mudar_prazo") {
    const partes: string[] = [];
    if (p.prazo !== undefined) {
      const prazo = p.prazo as { dia?: string; hora?: string | null } | null;
      partes.push(
        prazo?.dia ? `prazo para ${prazo.dia}${prazo.hora ? ` ${prazo.hora}` : ""}` : "tirar o prazo",
      );
    }
    if (p.prioridade !== undefined)
      partes.push(p.prioridade ? `prioridade ${String(p.prioridade)}` : "tirar a prioridade");
    frase = `Mudar${naTarefa}: ${partes.join(" e ")}`;
  } else if (acao === "mudar_status") frase = `Mudar o status de${naTarefa} para ${String(p.status)}`;
  else if (acao === "criar_tarefa" || acao === "criar_subtarefa")
    frase = `${nomeDaAcao}: “${String(p.titulo).slice(0, 120)}”`;
  else frase = `${nomeDaAcao}${naTarefa}`;
  return frase.slice(0, 300);
}

interface LinhaDaAprovacao {
  id: string;
  empresa_id: string;
  agente_id: string;
  execucao_id: string | null;
  pedido_por: string;
  acao: string;
  tarefa_id: string | null;
  parametros: Record<string, unknown>;
  resumo: string;
  motivo: string | null;
  conferencia: string;
  situacao: SituacaoDaAprovacao;
  decidida_por: string | null;
  decidida_em: Date | null;
  observacao: string | null;
  editada: boolean;
  criada_em: Date;
  vence_em: Date;
}

function paraAprovacao(l: LinhaDaAprovacao): Aprovacao {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    agenteId: l.agente_id,
    execucaoId: l.execucao_id,
    pedidoPor: l.pedido_por,
    acao: l.acao,
    tarefaId: l.tarefa_id,
    parametros: l.parametros,
    resumo: l.resumo,
    motivo: l.motivo,
    conferencia: l.conferencia,
    situacao: l.situacao,
    decididaPor: l.decidida_por,
    decididaEm: l.decidida_em?.toISOString() ?? null,
    observacao: l.observacao,
    editada: l.editada,
    criadaEm: l.criada_em.toISOString(),
    venceEm: l.vence_em.toISOString(),
  };
}

const COLUNAS_DA_APROVACAO = `id, empresa_id, agente_id, execucao_id, pedido_por, acao, tarefa_id, parametros, resumo,
  motivo, conferencia, situacao, decidida_por, decidida_em, observacao, editada, criada_em, vence_em`;

/** Grava o pedido e avisa quem pediu e o responsável pelo agente (no sino e no celular). */
export async function criarAprovacao(
  c: pg.PoolClient,
  d: {
    agenteId: string;
    execucaoId: string | null;
    pedidoPor: string;
    acao: string;
    parametros: Record<string, unknown>;
    motivo: string | null;
  },
): Promise<Aprovacao> {
  const tarefaId =
    typeof d.parametros.tarefaId === "string" && FORMATO_UUID.test(d.parametros.tarefaId)
      ? d.parametros.tarefaId
      : null;
  const existe = tarefaId
    ? ((await c.query("select 1 from tarefas where id = $1 and empresa_id = empresa_ativa()", [tarefaId]))
        .rowCount ?? 0) > 0
    : false;
  const r = await c.query<LinhaDaAprovacao>(
    `insert into aprovacoes (empresa_id, agente_id, execucao_id, pedido_por, acao, tarefa_id, parametros, resumo,
       motivo, conferencia, vence_em)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(hours => $10))
     returning ${COLUNAS_DA_APROVACAO}`,
    [
      d.agenteId,
      d.execucaoId,
      d.pedidoPor,
      d.acao,
      existe ? tarefaId : null,
      d.parametros,
      await resumoDaAcao(c, d.acao, d.parametros),
      d.motivo?.trim().slice(0, 1000) || null,
      conferenciaDe(d.parametros),
      HORAS_PARA_VENCER,
    ],
  );
  const aprovacao = paraAprovacao(r.rows[0] as LinhaDaAprovacao);
  const agente = await c.query<{ nome: string; responsavel_id: string }>(
    "select nome, responsavel_id from agentes where id = $1 and empresa_id = empresa_ativa()",
    [d.agenteId],
  );
  const a = agente.rows[0];
  for (const pessoaId of new Set([d.pedidoPor, a?.responsavel_id].filter((x): x is string => Boolean(x))))
    await criarAviso(c, {
      pessoaId,
      tipo: "aprovacao_pedida",
      texto: `${a?.nome ?? "Um agente"} pede aprovação: ${aprovacao.resumo}`,
      link: `/aprovacoes/${aprovacao.id}`,
    });
  return aprovacao;
}

export async function buscarAprovacao(
  c: pg.PoolClient,
  id: string,
  paraMudar = false,
): Promise<Aprovacao | null> {
  if (!FORMATO_UUID.test(id)) return null;
  const r = await c.query<LinhaDaAprovacao>(
    `select ${COLUNAS_DA_APROVACAO} from aprovacoes where id = $1 and empresa_id = empresa_ativa()
      ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? paraAprovacao(r.rows[0]) : null;
}

/** Quem pode decidir: quem pediu, o responsável pelo agente e os administradores. */
export async function podeDecidir(
  c: pg.PoolClient,
  aprovacao: Aprovacao,
  pessoaId: string,
  administrador: boolean,
): Promise<boolean> {
  if (administrador || aprovacao.pedidoPor === pessoaId) return true;
  const r = await c.query(
    "select 1 from agentes where id = $1 and empresa_id = empresa_ativa() and responsavel_id = $2",
    [aprovacao.agenteId, pessoaId],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Os pedidos que a pessoa pode decidir (pendentes) e os recentes dela, mais novos primeiro. */
export async function listarAprovacoes(
  c: pg.PoolClient,
  pessoaId: string,
  administrador: boolean,
  situacao: SituacaoDaAprovacao | null,
): Promise<(Aprovacao & { agenteNome: string })[]> {
  const r = await c.query<LinhaDaAprovacao & { agente_nome: string }>(
    `select ${COLUNAS_DA_APROVACAO.split(",")
      .map((x) => `a.${x.trim()}`)
      .join(", ")}, g.nome as agente_nome
       from aprovacoes a join agentes g on g.id = a.agente_id and g.empresa_id = a.empresa_id
      where a.empresa_id = empresa_ativa() and ($3::text is null or a.situacao = $3)
        and ($2::boolean or a.pedido_por = $1 or g.responsavel_id = $1)
      order by (a.situacao = 'pendente') desc, a.criada_em desc limit 100`,
    [pessoaId, administrador, situacao],
  );
  return r.rows.map((l) => ({ ...paraAprovacao(l), agenteNome: l.agente_nome }));
}

/** Registra a decisão (e, na aprovação, o resultado da ação). Conta as aprovações seguidas sem edição. */
export async function registrarDecisao(
  c: pg.PoolClient,
  aprovacao: Aprovacao,
  d: {
    situacao: "aprovada" | "recusada" | "falhou" | "vencida";
    decididaPor: string | null;
    observacao: string | null;
    parametros?: Record<string, unknown>;
    editada?: boolean;
    resultado?: unknown;
  },
): Promise<Aprovacao> {
  const r = await c.query<LinhaDaAprovacao>(
    `update aprovacoes set situacao = $2, decidida_por = $3, decidida_em = now(), observacao = $4,
            parametros = coalesce($5, parametros), editada = $6, resultado = $7
      where id = $1 and empresa_id = empresa_ativa() and situacao = 'pendente'
      returning ${COLUNAS_DA_APROVACAO}`,
    [
      aprovacao.id,
      d.situacao,
      d.decididaPor,
      d.observacao?.slice(0, 1000) ?? null,
      d.parametros ?? null,
      d.editada ?? false,
      d.resultado === undefined
        ? null
        : JSON.stringify(d.resultado).length > 50_000
          ? { grande: true }
          : d.resultado,
    ],
  );
  const feita = r.rows[0] ? paraAprovacao(r.rows[0]) : aprovacao;
  // Aprovações seguidas sem edição contam para a sugestão de liberar; recusa ou edição zeram.
  if (d.situacao === "aprovada" || d.situacao === "recusada" || d.situacao === "falhou")
    await c.query(
      `insert into regras_de_agente (empresa_id, agente_id, acao, aprovadas_sem_edicao)
       values (empresa_ativa(), $1, $2, $3)
       on conflict (agente_id, acao) do update set aprovadas_sem_edicao =
         case when $3 = 1 then regras_de_agente.aprovadas_sem_edicao + 1 else 0 end`,
      [aprovacao.agenteId, aprovacao.acao, d.situacao === "aprovada" && !d.editada ? 1 : 0],
    );
  return feita;
}
