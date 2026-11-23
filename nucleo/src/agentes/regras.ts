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
  modoDepoisDeTextoDeOutros,
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

/** aprovacao_por_texto: a regra deixava executar, mas a execução leu texto de outros antes (M4-04). */
export type Avaliacao = "executa" | "aprovacao" | "aprovacao_por_texto" | "bloqueado";

/** O que fazer com uma chamada de ferramenta, pela regra (a permissão de quem pediu é conferida depois, na ação). */
export async function avaliarAcao(
  c: pg.PoolClient,
  agente: { id: string; tipo: TipoDoAgente },
  acao: string,
  entrada: Record<string, unknown>,
  opcoes: { textoDeOutros?: boolean } = {},
): Promise<Avaliacao> {
  const modo = await modoDaAcao(c, agente, acao);
  if (modo === "bloqueado") return "bloqueado";
  if (modo === "pede_aprovacao") return "aprovacao";
  // executa_nas_dele: sem tarefa na entrada (ex.: criar), executa; com tarefa, só se for do agente.
  const tarefaId = typeof entrada.tarefaId === "string" ? entrada.tarefaId : null;
  if (modo === "executa_nas_dele" && tarefaId && !(await tarefaEhDoAgente(c, agente.id, tarefaId)))
    return "aprovacao";
  // A regra deixaria executar: depois de texto de outros, o que muda dados pede aprovação (M4-04).
  if (opcoes.textoDeOutros && modoDepoisDeTextoDeOutros(acao, modo) === "pede_aprovacao")
    return "aprovacao_por_texto";
  return "executa";
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
  if (new Set(mudancas.map((m) => m.acao)).size !== mudancas.length)
    return { problema: "A mesma ação apareceu mais de uma vez no pedido." };
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
  else if (acao === "anexar_arquivo") {
    const id = typeof p.arquivoId === "string" && FORMATO_UUID.test(p.arquivoId) ? p.arquivoId : null;
    const a = id
      ? await c.query<{ nome: string }>(
          "select nome from arquivos_do_telegram where id = $1 and empresa_id = empresa_ativa()",
          [id],
        )
      : null;
    frase = `Anexar “${(a?.rows[0]?.nome ?? "um arquivo").slice(0, 100)}”, mandado pelo Telegram, em${naTarefa || " uma tarefa"}`;
  } else if (acao === "criar_rotina") {
    const gatilho = p.gatilho as { horas?: string[] } | undefined;
    const horas = gatilho?.horas?.slice(0, 3).join(", ");
    frase = `Criar a rotina “${String(p.nome).slice(0, 100)}”${horas ? ` (às ${horas})` : ""}, que nasce desligada`;
  } else if (acao === "ligar_rotina" || acao === "parar_rotina") {
    const id = typeof p.rotinaId === "string" && FORMATO_UUID.test(p.rotinaId) ? p.rotinaId : null;
    const r = id
      ? await c.query<{ nome: string }>(
          "select nome from rotinas where id = $1 and empresa_id = empresa_ativa()",
          [id],
        )
      : null;
    frase = `${acao === "ligar_rotina" ? "Ligar" : "Desligar"} a rotina “${(r?.rows[0]?.nome ?? "?").slice(0, 120)}”`;
  } else if (acao === "criar_tarefa" || acao === "criar_subtarefa")
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
  por_texto_de_outros: boolean;
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
    porTextoDeOutros: l.por_texto_de_outros,
    criadaEm: l.criada_em.toISOString(),
    venceEm: l.vence_em.toISOString(),
  };
}

const COLUNAS_DA_APROVACAO = `id, empresa_id, agente_id, execucao_id, pedido_por, acao, tarefa_id, parametros, resumo,
  motivo, conferencia, situacao, decidida_por, decidida_em, observacao, editada, por_texto_de_outros, criada_em,
  vence_em`;

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
    /** Saiu porque o agente leu texto de outros (a regra dizia executa; M4-04). */
    porTextoDeOutros?: boolean;
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
       motivo, conferencia, vence_em, por_texto_de_outros)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, now() + make_interval(hours => $10), $11)
     returning ${COLUNAS_DA_APROVACAO}`,
    [
      d.agenteId,
      d.execucaoId,
      d.pedidoPor,
      d.acao,
      existe ? tarefaId : null,
      JSON.stringify(d.parametros),
      await resumoDaAcao(c, d.acao, d.parametros),
      d.motivo?.trim().slice(0, 1000) || null,
      conferenciaDe(d.parametros),
      HORAS_PARA_VENCER,
      d.porTextoDeOutros ?? false,
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

/**
 * Recusa ou vence um pedido pendente. Devolve null se ele já não estava pendente (outra pessoa decidiu antes, ou
 * venceu): quem chamou não deve avisar nada.
 */
export async function registrarDecisao(
  c: pg.PoolClient,
  aprovacao: Aprovacao,
  d: { situacao: "recusada" | "vencida"; decididaPor: string | null; observacao: string | null },
): Promise<Aprovacao | null> {
  const r = await c.query<LinhaDaAprovacao>(
    `update aprovacoes set situacao = $2, decidida_por = $3, decidida_em = now(), observacao = $4
      where id = $1 and empresa_id = empresa_ativa() and situacao = 'pendente'
      returning ${COLUNAS_DA_APROVACAO}`,
    [aprovacao.id, d.situacao, d.decididaPor, d.observacao?.slice(0, 1000) ?? null],
  );
  if (!r.rows[0]) return null;
  if (d.situacao === "recusada") await contarAprovacao(c, aprovacao, false);
  return paraAprovacao(r.rows[0]);
}

/**
 * Aprovar, passo 1: marca o pedido como aprovado antes de executar, numa troca atômica de "pendente". Só uma
 * aprovação ganha (dois cliques ao mesmo tempo, ou a verificação do vencimento, não fazem a ação duas vezes).
 * Devolve null se o pedido já não estava pendente ou venceu.
 */
export async function reservarAprovacao(
  c: pg.PoolClient,
  aprovacao: Aprovacao,
  d: { decididaPor: string; parametros: Record<string, unknown>; editada: boolean; resumo: string },
): Promise<Aprovacao | null> {
  const r = await c.query<LinhaDaAprovacao>(
    `update aprovacoes set situacao = 'aprovada', decidida_por = $2, decidida_em = now(), parametros = $3::jsonb,
            editada = $4, resumo = $5
      where id = $1 and empresa_id = empresa_ativa() and situacao = 'pendente' and vence_em > now()
      returning ${COLUNAS_DA_APROVACAO}`,
    [aprovacao.id, d.decididaPor, JSON.stringify(d.parametros), d.editada, d.resumo.slice(0, 300)],
  );
  return r.rows[0] ? paraAprovacao(r.rows[0]) : null;
}

/** Aprovar, passo 2: grava o que a ação devolveu, ou o erro (o pedido passa a "falhou"). */
export async function concluirAprovacao(
  c: pg.PoolClient,
  aprovacao: Aprovacao,
  d: { erro: string } | { resultado: unknown },
): Promise<Aprovacao> {
  const resultado = "resultado" in d ? JSON.stringify(d.resultado ?? null) : null;
  const r = await c.query<LinhaDaAprovacao>(
    `update aprovacoes set situacao = $2, observacao = $3, resultado = $4::jsonb
      where id = $1 and empresa_id = empresa_ativa() and situacao = 'aprovada'
      returning ${COLUNAS_DA_APROVACAO}`,
    [
      aprovacao.id,
      "erro" in d ? "falhou" : "aprovada",
      "erro" in d ? d.erro.slice(0, 1000) : null,
      resultado && resultado.length > 50_000 ? JSON.stringify({ grande: true }) : resultado,
    ],
  );
  await contarAprovacao(c, aprovacao, !("erro" in d) && !aprovacao.editada);
  return r.rows[0] ? paraAprovacao(r.rows[0]) : aprovacao;
}

/**
 * Aprovações seguidas sem edição contam para a sugestão de liberar; recusa, edição ou falha zeram. Os pedidos que
 * saíram por texto de outros não mexem no contador (a regra já deixava executar).
 */
async function contarAprovacao(c: pg.PoolClient, aprovacao: Aprovacao, conta: boolean): Promise<void> {
  if (aprovacao.porTextoDeOutros) return;
  await c.query(
    `insert into regras_de_agente (empresa_id, agente_id, acao, aprovadas_sem_edicao)
     values (empresa_ativa(), $1, $2, $3)
     on conflict (agente_id, acao) do update set aprovadas_sem_edicao =
       case when $3 = 1 then regras_de_agente.aprovadas_sem_edicao + 1 else 0 end`,
    [aprovacao.agenteId, aprovacao.acao, conta ? 1 : 0],
  );
}
