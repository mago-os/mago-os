/**
 * Agenda simples (M5-07, decisão 0041): criar, ver, editar, cancelar e responder, e quem vê o quê.
 *
 * Quem vê o evento inteiro: quem criou, os participantes e quem tem "agenda.ver" com alcance "tudo" (o
 * administrador) ou "equipe" (o gestor, quando quem criou ou um participante é da área dele). Os outros veem só
 * "ocupado". Quem edita e cancela: quem criou, ou quem tem "agenda.editar" com alcance "tudo".
 */
import {
  type AlcanceDaMudanca,
  canaisDoTipo,
  type EventoDaAgenda,
  type OcorrenciaNaAgenda,
  type PedidoDeEdicaoDeEvento,
  type PedidoDeEvento,
  type RegraDeRecorrencia,
  type RespostaAoConvite,
  type TipoDeAviso,
} from "@mago-os/contratos";
import type pg from "pg";
import { preferenciasDe } from "../avisos/notificacoes.ts";
import type { PermissoesNaEmpresa } from "../permissoes/verificar.ts";
import { momentoNoFuso } from "../rotinas/horarios.ts";
import { type BaseDoEvento, ehOcorrencia, ocorrenciasEntre, somarDias, vezesAntesDe } from "./ocorrencias.ts";

export class RecusaDaAgenda extends Error {}

interface LinhaDoEvento {
  id: string;
  empresa_id: string;
  titulo: string;
  descricao: string | null;
  inicio_dia: string;
  inicio_hora: string | null;
  fim_dia: string;
  fim_hora: string | null;
  dia_inteiro: boolean;
  fuso: string;
  inicio_em: Date;
  fim_em: Date;
  local: string | null;
  link: string | null;
  criado_por: string;
  criado_por_agente_id: string | null;
  tarefa_id: string | null;
  projeto_id: string | null;
  regra: RegraDeRecorrencia | null;
  serie_id: string | null;
  ocorrencia_original: string | null;
  situacao: "marcado" | "cancelado";
  alertas: number[] | null;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS = `e.id, e.empresa_id, e.titulo, e.descricao, e.inicio_dia::text, to_char(e.inicio_hora, 'HH24:MI') as inicio_hora,
  e.fim_dia::text, to_char(e.fim_hora, 'HH24:MI') as fim_hora, e.dia_inteiro, e.fuso, e.inicio_em, e.fim_em, e.local,
  e.link, e.criado_por, e.criado_por_agente_id, e.tarefa_id, e.projeto_id, e.regra, e.serie_id,
  e.ocorrencia_original::text, e.situacao, e.alertas, e.criado_em, e.atualizado_em`;

type Participantes = EventoDaAgenda["participantes"];

function paraEvento(l: LinhaDoEvento, participantes: Participantes): EventoDaAgenda {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    titulo: l.titulo,
    descricao: l.descricao,
    inicio: { dia: l.inicio_dia, hora: l.inicio_hora },
    fim: { dia: l.fim_dia, hora: l.fim_hora },
    diaInteiro: l.dia_inteiro,
    fuso: l.fuso,
    inicioEm: l.inicio_em.toISOString(),
    fimEm: l.fim_em.toISOString(),
    local: l.local,
    link: l.link,
    criadoPor: l.criado_por,
    criadoPorAgenteId: l.criado_por_agente_id,
    participantes,
    tarefaId: l.tarefa_id,
    projetoId: l.projeto_id,
    regra: l.regra,
    serieId: l.serie_id,
    ocorrenciaOriginal: l.ocorrencia_original,
    situacao: l.situacao,
    alertas: l.alertas,
    criadoEm: l.criado_em.toISOString(),
    atualizadoEm: l.atualizado_em.toISOString(),
  };
}

export const baseDo = (e: EventoDaAgenda): BaseDoEvento => ({
  inicioDia: e.inicio.dia,
  inicioHora: e.inicio.hora ?? null,
  fimDia: e.fim.dia,
  fimHora: e.fim.hora ?? null,
  diaInteiro: e.diaInteiro,
  fuso: e.fuso,
  regra: e.regra,
});

async function comParticipantes(c: pg.PoolClient, linhas: LinhaDoEvento[]): Promise<EventoDaAgenda[]> {
  if (linhas.length === 0) return [];
  const p = await c.query<{
    evento_id: string;
    pessoa_id: string;
    resposta: RespostaAoConvite;
    respondeu_em: Date | null;
  }>(
    `select evento_id, pessoa_id, resposta, respondeu_em from participantes_de_evento
      where empresa_id = empresa_ativa() and evento_id = any($1::uuid[]) order by pessoa_id`,
    [linhas.map((l) => l.id)],
  );
  const porEvento = new Map<string, Participantes>();
  for (const x of p.rows) {
    const lista = porEvento.get(x.evento_id) ?? [];
    lista.push({
      pessoaId: x.pessoa_id,
      resposta: x.resposta,
      respondeuEm: x.respondeu_em?.toISOString() ?? null,
    });
    porEvento.set(x.evento_id, lista);
  }
  return linhas.map((l) => paraEvento(l, porEvento.get(l.id) ?? []));
}

export async function eventoPorId(
  c: pg.PoolClient,
  id: string,
  travar = false,
): Promise<EventoDaAgenda | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await c.query<LinhaDoEvento>(
    `select ${COLUNAS} from eventos e where e.id = $1 and e.empresa_id = empresa_ativa() ${travar ? "for update" : ""}`,
    [id],
  );
  return (await comParticipantes(c, r.rows))[0] ?? null;
}

/** Quem olha a agenda: a pessoa e o alcance dela em "agenda.ver" (o agente olha com quem pediu e o responsável). */
export interface QuemVe {
  pessoaId: string;
  alcance: "nada" | "meus" | "equipe" | "tudo";
  area: string | null;
}

export function quemVeDe(p: PermissoesNaEmpresa, pessoaId: string): QuemVe {
  return { pessoaId, alcance: p.modulos.get("agenda")?.acoes.ver ?? "nada", area: p.area };
}

/** Cada um dos que olham vê o evento inteiro (senão, só "ocupado"). */
function veInteiro(e: EventoDaAgenda, olham: QuemVe[], areas: Map<string, string | null>): boolean {
  const envolvidos = [e.criadoPor, ...e.participantes.map((p) => p.pessoaId)];
  return olham.every(
    (q) =>
      q.alcance === "tudo" ||
      envolvidos.includes(q.pessoaId) ||
      (q.alcance === "equipe" && q.area !== null && envolvidos.some((x) => areas.get(x) === q.area)),
  );
}

async function areasDe(c: pg.PoolClient, eventos: EventoDaAgenda[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(eventos.flatMap((e) => [e.criadoPor, ...e.participantes.map((p) => p.pessoaId)]))];
  if (ids.length === 0) return new Map();
  const r = await c.query<{ pessoa_id: string; area: string | null }>(
    "select pessoa_id, area from vinculos where empresa_id = empresa_ativa() and pessoa_id = any($1::uuid[])",
    [ids],
  );
  return new Map(r.rows.map((x) => [x.pessoa_id, x.area]));
}

/** O evento, se todos os que olham o veem inteiro. */
export async function buscarEvento(
  c: pg.PoolClient,
  olham: QuemVe[],
  id: string,
): Promise<EventoDaAgenda | null> {
  const e = await eventoPorId(c, id);
  if (!e) return null;
  return veInteiro(e, olham, await areasDe(c, [e])) ? e : null;
}

/** O fuso de uma pessoa (o da empresa, se ela não escolheu). */
export async function fusoDaPessoa(c: pg.PoolClient, pessoaId: string): Promise<string> {
  const r = await c.query<{ fuso: string }>(
    `select coalesce(p.fuso_horario, e.fuso_horario, 'UTC') as fuso from pessoas p, empresas e
      where p.id = $1 and e.id = empresa_ativa()`,
    [pessoaId],
  );
  return r.rows[0]?.fuso ?? "UTC";
}

/**
 * As vezes dos eventos das pessoas entre dois dias (no fuso de quem olha), em ordem. O evento que quem olha não pode
 * ver inteiro vem como "ocupado", sem título.
 */
export async function listarAgenda(
  c: pg.PoolClient,
  olham: QuemVe[],
  d: { de: string; ate: string; pessoas: string[]; fuso: string },
): Promise<OcorrenciaNaAgenda[]> {
  const inicio = momentoNoFuso(d.de, "00:00", d.fuso);
  const fim = momentoNoFuso(somarDias(d.ate, 1), "00:00", d.fuso);
  const r = await c.query<LinhaDoEvento>(
    `select ${COLUNAS} from eventos e
      where e.empresa_id = empresa_ativa() and e.situacao = 'marcado'
        and (e.criado_por = any($1::uuid[]) or exists (select 1 from participantes_de_evento p
              where p.empresa_id = e.empresa_id and p.evento_id = e.id and p.pessoa_id = any($1::uuid[])))
        and e.inicio_em < $3 and (e.regra is not null or e.fim_em > $2)
      order by e.inicio_em limit 2000`,
    [d.pessoas, inicio, fim],
  );
  const eventos = await comParticipantes(c, r.rows);
  const series = eventos.filter((e) => e.regra).map((e) => e.id);
  // As vezes mudadas ou canceladas de uma série saem dela (a mudada aparece como evento próprio).
  const excecoes = new Set<string>();
  if (series.length > 0) {
    const x = await c.query<{ serie_id: string; dia: string }>(
      `select serie_id, ocorrencia_original::text as dia from eventos
        where empresa_id = empresa_ativa() and serie_id = any($1::uuid[])`,
      [series],
    );
    for (const l of x.rows) excecoes.add(`${l.serie_id}:${l.dia}`);
  }
  const areas = await areasDe(c, eventos);
  const saida: OcorrenciaNaAgenda[] = [];
  for (const e of eventos) {
    const inteiro = veInteiro(e, olham, areas);
    const envolvidos = new Set([e.criadoPor, ...e.participantes.map((p) => p.pessoaId)]);
    const minha = e.participantes.find((p) => p.pessoaId === olham[0]?.pessoaId)?.resposta ?? null;
    for (const o of ocorrenciasEntre(baseDo(e), inicio, fim)) {
      if (excecoes.has(`${e.id}:${o.dia}`)) continue;
      saida.push({
        eventoId: e.id,
        ocorrencia: o.dia,
        inicioEm: o.inicioEm.toISOString(),
        fimEm: o.fimEm.toISOString(),
        diaInteiro: e.diaInteiro,
        recorrente: e.regra !== null,
        ocupado: !inteiro,
        titulo: inteiro ? e.titulo : null,
        pessoas: d.pessoas.filter((p) => envolvidos.has(p)),
        minhaResposta: inteiro ? minha : null,
      });
    }
  }
  return saida.sort((a, b) => a.inicioEm.localeCompare(b.inicioEm));
}

/** Os participantes são pessoas ativas da empresa; a tarefa e o projeto existem nela. */
async function conferirLigacoes(
  c: pg.PoolClient,
  d: { participantes?: string[]; tarefaId?: string | null; projetoId?: string | null; fuso?: string },
): Promise<void> {
  if (d.participantes && d.participantes.length > 0) {
    const r = await c.query<{ n: number }>(
      `select count(*)::int as n from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
          and pessoa_id = any($1::uuid[])`,
      [d.participantes],
    );
    if ((r.rows[0]?.n ?? 0) !== d.participantes.length)
      throw new RecusaDaAgenda("Os participantes precisam ser pessoas ativas desta empresa.");
  }
  if (d.tarefaId) {
    const r = await c.query("select 1 from tarefas where id = $1 and empresa_id = empresa_ativa()", [
      d.tarefaId,
    ]);
    if (!r.rowCount) throw new RecusaDaAgenda("A tarefa ligada não existe nesta empresa.");
  }
  if (d.projetoId) {
    const r = await c.query("select 1 from projetos where id = $1 and empresa_id = empresa_ativa()", [
      d.projetoId,
    ]);
    if (!r.rowCount) throw new RecusaDaAgenda("O projeto ligado não existe nesta empresa.");
  }
  if (d.fuso) {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: d.fuso });
    } catch {
      throw new RecusaDaAgenda("Fuso horário desconhecido.");
    }
  }
}

interface DadosDoEvento {
  titulo: string;
  descricao: string | null;
  inicio: { dia: string; hora: string | null };
  fim: { dia: string; hora: string | null };
  diaInteiro: boolean;
  fuso: string;
  local: string | null;
  link: string | null;
  tarefaId: string | null;
  projetoId: string | null;
  regra: RegraDeRecorrencia | null;
  alertas: number[] | null;
}

async function inserir(
  c: pg.PoolClient,
  d: DadosDoEvento,
  extras: {
    criadoPor: string;
    agenteId: string | null;
    serieId?: string | null;
    ocorrencia?: string | null;
    situacao?: string;
  },
): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into eventos (empresa_id, titulo, descricao, inicio_dia, inicio_hora, fim_dia, fim_hora, dia_inteiro, fuso,
                          inicio_em, fim_em, local, link, criado_por, criado_por_agente_id, tarefa_id, projeto_id, regra,
                          serie_id, ocorrencia_original, situacao, alertas)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8, now(), now() + interval '1 second', $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19)
     returning id`,
    [
      d.titulo.trim(),
      d.descricao,
      d.inicio.dia,
      d.diaInteiro ? null : d.inicio.hora,
      d.fim.dia,
      d.diaInteiro ? null : d.fim.hora,
      d.diaInteiro,
      d.fuso,
      d.local,
      d.link,
      extras.criadoPor,
      extras.agenteId,
      d.tarefaId,
      d.projetoId,
      d.regra ? JSON.stringify(d.regra) : null,
      extras.serieId ?? null,
      extras.ocorrencia ?? null,
      extras.situacao ?? "marcado",
      d.alertas,
    ],
  );
  return (r.rows[0] as { id: string }).id;
}

async function gravarParticipantes(
  c: pg.PoolClient,
  eventoId: string,
  lista: { pessoaId: string; resposta: RespostaAoConvite; respondeuEm: string | null }[],
): Promise<void> {
  await c.query("delete from participantes_de_evento where empresa_id = empresa_ativa() and evento_id = $1", [
    eventoId,
  ]);
  for (const p of lista)
    await c.query(
      `insert into participantes_de_evento (empresa_id, evento_id, pessoa_id, resposta, respondeu_em)
       values (empresa_ativa(), $1, $2, $3, $4)`,
      [
        eventoId,
        p.pessoaId,
        p.resposta,
        p.resposta === "pendente" ? null : (p.respondeuEm ?? new Date().toISOString()),
      ],
    );
}

/** Avisa as pessoas (respeitando os canais de cada uma), com o link para o evento. */
export async function avisarPessoas(
  c: pg.PoolClient,
  d: { tipo: TipoDeAviso; texto: string; link: string; para: string[] },
): Promise<number> {
  let n = 0;
  for (const pessoaId of new Set(d.para)) {
    const canais = canaisDoTipo(await preferenciasDe(c, pessoaId), d.tipo);
    if (!canais.tela && !canais.push && !canais.telegram) continue;
    const r = await c.query(
      `insert into avisos (empresa_id, pessoa_id, tipo, texto, link, push_pendente, lido_em, telegram_pendente)
       select empresa_ativa(), $1, $2, $3, $4, $5, case when $6 then null else now() end, $7
        where exists (select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo')`,
      [pessoaId, d.tipo, d.texto.slice(0, 500), d.link, canais.push, canais.tela, canais.telegram],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

/** "qui, 26/11 às 15:00" (ou só o dia, no dia inteiro), no fuso do evento. */
export function quandoEmTexto(e: {
  inicio: { dia: string; hora?: string | null };
  diaInteiro: boolean;
  fuso: string;
}) {
  const [a, m, d] = e.inicio.dia.split("-").map(Number) as [number, number, number];
  const semana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][
    new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  ];
  const dia = `${semana}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  return e.diaInteiro || !e.inicio.hora ? dia : `${dia} às ${e.inicio.hora}`;
}

/** Cria o evento em nome de quem cria, que já entra como participante ("vou"). Os outros recebem o convite. */
export async function criarEvento(
  c: pg.PoolClient,
  criador: { pessoaId: string },
  pedido: PedidoDeEvento,
  agenteId: string | null = null,
): Promise<EventoDaAgenda> {
  const fuso = pedido.fuso ?? (await fusoDaPessoa(c, criador.pessoaId));
  await conferirLigacoes(c, { ...pedido, fuso });
  const diaInteiro = pedido.diaInteiro ?? false;
  const id = await inserir(
    c,
    {
      titulo: pedido.titulo,
      descricao: pedido.descricao ?? null,
      inicio: { dia: pedido.inicio.dia, hora: pedido.inicio.hora ?? null },
      fim: { dia: pedido.fim.dia, hora: pedido.fim.hora ?? null },
      diaInteiro,
      fuso,
      local: pedido.local ?? null,
      link: pedido.link ?? null,
      tarefaId: pedido.tarefaId ?? null,
      projetoId: pedido.projetoId ?? null,
      regra: pedido.regra ?? null,
      alertas: pedido.alertas ?? null,
    },
    { criadoPor: criador.pessoaId, agenteId },
  );
  const convidados = pedido.participantes.filter((p) => p !== criador.pessoaId);
  await gravarParticipantes(c, id, [
    { pessoaId: criador.pessoaId, resposta: "vou", respondeuEm: null },
    ...convidados.map((p) => ({ pessoaId: p, resposta: "pendente" as const, respondeuEm: null })),
  ]);
  const evento = (await eventoPorId(c, id)) as EventoDaAgenda;
  await avisarPessoas(c, {
    tipo: "convite_de_evento",
    texto: `Convite: ${evento.titulo}, ${quandoEmTexto(evento)}${evento.regra ? " (repete)" : ""}.`,
    link: `/agenda/${id}`,
    para: convidados,
  });
  return evento;
}

/** Pode editar e cancelar: quem criou, ou quem tem "agenda.editar" em tudo. */
export function podeMudar(e: EventoDaAgenda, pessoaId: string, p: PermissoesNaEmpresa): boolean {
  const alcance = p.modulos.get("agenda")?.acoes.editar ?? "nada";
  return alcance === "tudo" || (alcance !== "nada" && e.criadoPor === pessoaId);
}

function dadosDe(e: EventoDaAgenda): DadosDoEvento {
  return {
    titulo: e.titulo,
    descricao: e.descricao,
    inicio: { dia: e.inicio.dia, hora: e.inicio.hora ?? null },
    fim: { dia: e.fim.dia, hora: e.fim.hora ?? null },
    diaInteiro: e.diaInteiro,
    fuso: e.fuso,
    local: e.local,
    link: e.link,
    tarefaId: e.tarefaId,
    projetoId: e.projetoId,
    regra: e.regra,
    alertas: e.alertas,
  };
}

/** Aplica o pedido de edição sobre os dados (só o que veio muda). */
function aplicar(d: DadosDoEvento, p: PedidoDeEdicaoDeEvento): DadosDoEvento {
  const diaInteiro = p.diaInteiro ?? d.diaInteiro;
  const inicio = p.inicio ? { dia: p.inicio.dia, hora: p.inicio.hora ?? null } : d.inicio;
  const fim = p.fim ? { dia: p.fim.dia, hora: p.fim.hora ?? null } : d.fim;
  return {
    titulo: p.titulo ?? d.titulo,
    descricao: p.descricao === undefined ? d.descricao : p.descricao,
    inicio: diaInteiro ? { dia: inicio.dia, hora: null } : inicio,
    fim: diaInteiro ? { dia: fim.dia, hora: null } : fim,
    diaInteiro,
    fuso: p.fuso ?? d.fuso,
    local: p.local === undefined ? d.local : p.local,
    link: p.link === undefined ? d.link : p.link,
    tarefaId: p.tarefaId === undefined ? d.tarefaId : p.tarefaId,
    projetoId: p.projetoId === undefined ? d.projetoId : p.projetoId,
    regra: p.regra === undefined ? d.regra : p.regra,
    alertas: p.alertas === undefined ? d.alertas : p.alertas,
  };
}

/** Os dados de uma vez da série: o mesmo horário, no dia dela. */
function naOcorrencia(d: DadosDoEvento, dia: string): DadosDoEvento {
  const duracao = Math.round((Date.parse(d.fim.dia) - Date.parse(d.inicio.dia)) / 86_400_000);
  return { ...d, inicio: { ...d.inicio, dia }, fim: { ...d.fim, dia: somarDias(dia, duracao) }, regra: null };
}

function conferirDados(d: DadosDoEvento): void {
  const a = `${d.inicio.dia}T${d.inicio.hora ?? "00:00"}`;
  const b = `${d.fim.dia}T${d.fim.hora ?? "00:00"}`;
  if (d.diaInteiro ? b < a : b <= a) throw new RecusaDaAgenda("O fim vem depois do começo.");
  if (!d.diaInteiro && (!d.inicio.hora || !d.fim.hora))
    throw new RecusaDaAgenda("Evento com horário precisa da hora do começo e do fim.");
}

const mudouOHorario = (a: DadosDoEvento, b: DadosDoEvento) =>
  a.inicio.dia !== b.inicio.dia ||
  a.inicio.hora !== b.inicio.hora ||
  a.fim.dia !== b.fim.dia ||
  a.fim.hora !== b.fim.hora ||
  a.diaInteiro !== b.diaInteiro ||
  a.fuso !== b.fuso ||
  JSON.stringify(a.regra) !== JSON.stringify(b.regra);

/** A regra da série que acaba no dia anterior (este e os seguintes): o fim por data, ou o número de vezes até ali. */
function regraQueAcabaAntes(e: EventoDaAgenda, dia: string): RegraDeRecorrencia {
  const regra = e.regra as RegraDeRecorrencia;
  return regra.vezes != null
    ? { ...regra, vezes: Math.max(1, vezesAntesDe(baseDo(e), dia)), ate: null }
    : { ...regra, ate: somarDias(dia, -1) };
}

/**
 * Edita. Evento único ou ocorrência já mudada: muda ele. Série: "todos" muda a série; "só este" cria a ocorrência
 * mudada, ligada à série; "este e os seguintes" encerra a série no dia anterior e cria uma série nova a partir da
 * ocorrência (as mudanças sozinhas dessas datas em diante saem). Mudar o horário volta as respostas para "sem
 * resposta" e avisa; novos participantes recebem o convite. Devolve o evento que ficou com a mudança.
 */
export async function editarEvento(
  c: pg.PoolClient,
  e: EventoDaAgenda,
  pedido: PedidoDeEdicaoDeEvento,
): Promise<EventoDaAgenda> {
  if (e.situacao === "cancelado") throw new RecusaDaAgenda("Esse evento foi cancelado.");
  const alcance: AlcanceDaMudanca = e.regra ? (pedido.alcance ?? "todos") : "todos";
  const dia = pedido.ocorrencia;
  if (e.regra && alcance !== "todos" && (!dia || !ehOcorrencia(baseDo(e), dia)))
    throw new RecusaDaAgenda("Esse dia não é uma das vezes do evento.");
  await conferirLigacoes(c, { ...pedido, ...(pedido.fuso ? { fuso: pedido.fuso } : {}) });
  const antes = dadosDe(e);
  const participantesNovos = pedido.participantes
    ? [...new Set([e.criadoPor, ...pedido.participantes])]
    : e.participantes.map((p) => p.pessoaId);
  let alvo: string;
  let base: DadosDoEvento = antes;
  if (alcance === "todos") {
    const depois = aplicar(antes, pedido);
    conferirDados(depois);
    await c.query(
      `update eventos set titulo = $2, descricao = $3, inicio_dia = $4, inicio_hora = $5, fim_dia = $6, fim_hora = $7,
              dia_inteiro = $8, fuso = $9, local = $10, link = $11, tarefa_id = $12, projeto_id = $13, regra = $14,
              alertas = $15, atualizado_em = now()
        where id = $1 and empresa_id = empresa_ativa()`,
      [
        e.id,
        depois.titulo,
        depois.descricao,
        depois.inicio.dia,
        depois.inicio.hora,
        depois.fim.dia,
        depois.fim.hora,
        depois.diaInteiro,
        depois.fuso,
        depois.local,
        depois.link,
        depois.tarefaId,
        depois.projetoId,
        depois.regra ? JSON.stringify(depois.regra) : null,
        depois.alertas,
      ],
    );
    alvo = e.id;
  } else if (alcance === "so_este") {
    base = naOcorrencia(antes, dia as string);
    const depois = aplicar(base, { ...pedido, regra: null });
    conferirDados(depois);
    alvo = await inserir(c, depois, {
      criadoPor: e.criadoPor,
      agenteId: e.criadoPorAgenteId,
      serieId: e.id,
      ocorrencia: dia as string,
    });
  } else {
    base = naOcorrencia(antes, dia as string);
    base = { ...base, regra: e.regra };
    const depois = aplicar(base, pedido);
    conferirDados(depois);
    // A série nova continua com o que sobrou das vezes.
    if (depois.regra?.vezes != null && e.regra?.vezes != null)
      depois.regra = {
        ...depois.regra,
        vezes: Math.max(1, e.regra.vezes - vezesAntesDe(baseDo(e), dia as string)),
      };
    await c.query(
      "delete from eventos where empresa_id = empresa_ativa() and serie_id = $1 and ocorrencia_original >= $2",
      [e.id, dia],
    );
    await c.query(
      "update eventos set regra = $2, atualizado_em = now() where id = $1 and empresa_id = empresa_ativa()",
      [e.id, JSON.stringify(regraQueAcabaAntes(e, dia as string))],
    );
    alvo = await inserir(c, depois, { criadoPor: e.criadoPor, agenteId: e.criadoPorAgenteId });
  }
  const depois = (await eventoPorId(c, alvo)) as EventoDaAgenda;
  const mudou = mudouOHorario(base, dadosDe(depois));
  const respostaDe = new Map(e.participantes.map((p) => [p.pessoaId, p]));
  await gravarParticipantes(
    c,
    alvo,
    participantesNovos.map((pessoaId) => {
      const antiga = respostaDe.get(pessoaId);
      if (pessoaId === e.criadoPor) return { pessoaId, resposta: "vou" as const, respondeuEm: null };
      if (!antiga || mudou) return { pessoaId, resposta: "pendente" as const, respondeuEm: null };
      return { pessoaId, resposta: antiga.resposta, respondeuEm: antiga.respondeuEm };
    }),
  );
  const final = (await eventoPorId(c, alvo)) as EventoDaAgenda;
  const novos = participantesNovos.filter((p) => !respostaDe.has(p) && p !== e.criadoPor);
  const antigos = participantesNovos.filter((p) => respostaDe.has(p) && p !== e.criadoPor);
  if (novos.length > 0)
    await avisarPessoas(c, {
      tipo: "convite_de_evento",
      texto: `Convite: ${final.titulo}, ${quandoEmTexto(final)}${final.regra ? " (repete)" : ""}.`,
      link: `/agenda/${alvo}`,
      para: novos,
    });
  if (antigos.length > 0)
    await avisarPessoas(c, {
      tipo: mudou ? "convite_de_evento" : "evento_mudou",
      texto: mudou
        ? `${final.titulo} mudou para ${quandoEmTexto(final)}. Responda de novo.`
        : `O evento ${final.titulo}, ${quandoEmTexto(final)}, foi atualizado.`,
      link: `/agenda/${alvo}`,
      para: antigos,
    });
  return final;
}

/**
 * Cancela. Evento único, ocorrência mudada ou "todos": o evento fica cancelado. "Só este": a ocorrência fica
 * cancelada (um evento cancelado ligado à série). "Este e os seguintes": a série acaba no dia anterior. Os
 * participantes são avisados.
 */
export async function cancelarEvento(
  c: pg.PoolClient,
  e: EventoDaAgenda,
  p: { alcance?: AlcanceDaMudanca | undefined; ocorrencia?: string | undefined },
): Promise<void> {
  if (e.situacao === "cancelado") return;
  const alcance: AlcanceDaMudanca = e.regra ? (p.alcance ?? "todos") : "todos";
  const dia = p.ocorrencia;
  if (e.regra && alcance !== "todos" && (!dia || !ehOcorrencia(baseDo(e), dia)))
    throw new RecusaDaAgenda("Esse dia não é uma das vezes do evento.");
  let texto: string;
  if (alcance === "todos" || (alcance === "este_e_seguintes" && dia === e.inicio.dia)) {
    await c.query(
      "update eventos set situacao = 'cancelado', atualizado_em = now() where id = $1 and empresa_id = empresa_ativa()",
      [e.id],
    );
    texto = `Cancelado: ${e.titulo}, ${quandoEmTexto(e)}${e.regra ? " (todas as vezes)" : ""}.`;
  } else if (alcance === "so_este") {
    const d = naOcorrencia(dadosDe(e), dia as string);
    const existente = await c.query<{ id: string }>(
      "select id from eventos where empresa_id = empresa_ativa() and serie_id = $1 and ocorrencia_original = $2",
      [e.id, dia],
    );
    if (existente.rows[0])
      await c.query("update eventos set situacao = 'cancelado', atualizado_em = now() where id = $1", [
        existente.rows[0].id,
      ]);
    else
      await inserir(c, d, {
        criadoPor: e.criadoPor,
        agenteId: e.criadoPorAgenteId,
        serieId: e.id,
        ocorrencia: dia as string,
        situacao: "cancelado",
      });
    texto = `Cancelado: ${e.titulo}, ${quandoEmTexto({ ...e, inicio: { ...e.inicio, dia: dia as string } })}.`;
  } else {
    await c.query(
      "delete from eventos where empresa_id = empresa_ativa() and serie_id = $1 and ocorrencia_original >= $2",
      [e.id, dia],
    );
    await c.query(
      "update eventos set regra = $2, atualizado_em = now() where id = $1 and empresa_id = empresa_ativa()",
      [e.id, JSON.stringify(regraQueAcabaAntes(e, dia as string))],
    );
    texto = `Cancelado: ${e.titulo}, a partir de ${quandoEmTexto({ ...e, inicio: { ...e.inicio, dia: dia as string } })}.`;
  }
  await avisarPessoas(c, {
    tipo: "evento_mudou",
    texto,
    link: `/agenda/${e.id}`,
    para: e.participantes.map((x) => x.pessoaId).filter((x) => x !== e.criadoPor),
  });
}

/** A resposta ao convite (só o próprio participante). Quem criou é avisado só pelo que a tela mostra. */
export async function responderConvite(
  c: pg.PoolClient,
  e: EventoDaAgenda,
  pessoaId: string,
  resposta: Exclude<RespostaAoConvite, "pendente">,
): Promise<boolean> {
  const r = await c.query(
    `update participantes_de_evento set resposta = $3, respondeu_em = now()
      where empresa_id = empresa_ativa() and evento_id = $1 and pessoa_id = $2`,
    [e.id, pessoaId, resposta],
  );
  return (r.rowCount ?? 0) > 0;
}
