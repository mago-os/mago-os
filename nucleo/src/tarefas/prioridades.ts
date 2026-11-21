/**
 * Central de prioridades (M3-07): a lista de cada pessoa, calculada na hora a partir das tarefas, menções e avisos.
 * Só o adiado e o resolvido ficam guardados (estados_de_prioridade, pessoal pelo próprio banco). Ordem por regras
 * fixas (decisão 13): o grupo do tipo, e em cada grupo a mais antiga primeiro.
 */
import { type ItemDePrioridade, TIPOS_DE_PRIORIDADE, type TipoDePrioridade } from "@mago-os/contratos";
import type pg from "pg";
import { condicaoDeAlcance, nomesCitados, type Quem } from "./servico.ts";

/** Itens no máximo (a lista é para o dia, não um arquivo). */
const LIMITE = 100;
/** Menção mais velha que isso sai da central (continua na tarefa). */
const DIAS_DA_MENCAO = 30;

/** "há 2 dias", "há 3 horas", "ontem". */
export function haQuanto(desde: Date, agora: Date): string {
  const minutos = Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 60000));
  if (minutos < 2) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return horas === 1 ? "há 1 hora" : `há ${horas} horas`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

/** Formato da chave: o que vem do contrato é conferido antes de virar estado. */
export const CHAVE_VALIDA =
  /^((atrasada|hoje|ajuda):[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}T[\d:.]+Z|(mencao|aviso):[0-9a-f-]{36})$/;

const ordemDo = (tipo: TipoDePrioridade) => TIPOS_DE_PRIORIDADE.indexOf(tipo);

/** O fuso da pessoa (ou o da empresa). */
export async function fusoDe(c: pg.PoolClient, pessoaId: string): Promise<string> {
  const r = await c.query<{ fuso: string }>(
    `select coalesce(p.fuso_horario, e.fuso_horario, 'America/Sao_Paulo') as fuso
       from empresas e left join pessoas p on p.id = $1 where e.id = empresa_ativa()`,
    [pessoaId],
  );
  return r.rows[0]?.fuso ?? "America/Sao_Paulo";
}

/** O dia de hoje (AAAA-MM-DD) no fuso da pessoa. */
export async function hojeDe(c: pg.PoolClient, pessoaId: string, agora = new Date()): Promise<string> {
  const r = await c.query<{ hoje: string }>(
    "select to_char(($1::timestamptz at time zone $2)::date, 'YYYY-MM-DD') as hoje",
    [agora.toISOString(), await fusoDe(c, pessoaId)],
  );
  return r.rows[0]?.hoje ?? agora.toISOString().slice(0, 10);
}

/** A central de quem pede, na ordem. Só entra o que a pessoa já vê (o alcance de ver tarefas). */
export async function listarPrioridades(
  c: pg.PoolClient,
  quem: Extract<Quem, { tipo: "pessoa" }>,
  agora = new Date(),
): Promise<ItemDePrioridade[]> {
  const eu = quem.pessoaId;
  const fuso = await fusoDe(c, eu);
  const itens: ItemDePrioridade[] = [];

  // Tarefas minhas (eu ou um agente meu como responsável): atrasada, vence hoje, precisa de ajuda.
  const alcance = condicaoDeAlcance(quem, 3);
  const tarefas = await c.query<{
    id: string;
    titulo: string;
    status: string;
    prazo_em: Date | null;
    prazo_hora: string | null;
    vence_hoje: boolean;
    ajuda_desde: Date | null;
  }>(
    `select t.id, t.titulo, t.status, t.prazo_em, to_char(t.prazo_hora, 'HH24:MI') as prazo_hora,
            (t.prazo_em at time zone $3)::date = ($2::timestamptz at time zone $3)::date as vence_hoje,
            case when t.status = 'precisa_de_ajuda' then
              coalesce((select max(a.criado_em) from acontecimentos_de_tarefa a
                         where a.tarefa_id = t.id and a.empresa_id = t.empresa_id and a.tipo = 'mudou_status'
                           and a.detalhes->>'para' = 'precisa_de_ajuda'), t.criada_em)
            end as ajuda_desde
       from tarefas t
      where t.empresa_id = empresa_ativa() and t.status not in ('concluida', 'cancelada')
        and (t.responsavel_pessoa_id = $1
             or t.responsavel_agente_id in (select g.id from agentes g
                                             where g.empresa_id = empresa_ativa() and g.responsavel_id = $1))
        and (t.status = 'precisa_de_ajuda'
             or (t.prazo_em is not null and (t.prazo_em at time zone $3)::date <= ($2::timestamptz at time zone $3)::date))
        and ${alcance.sql}
      order by t.status = 'precisa_de_ajuda' desc, t.prazo_em nulls last
      limit 300`,
    [eu, agora.toISOString(), fuso, ...alcance.valores],
  );
  for (const t of tarefas.rows) {
    const link = `/tarefas/${t.id}`;
    if (t.prazo_em && t.prazo_em < agora) {
      itens.push({
        chave: `atrasada:${t.id}:${t.prazo_em.toISOString()}`,
        tipo: "atrasada",
        titulo: t.titulo,
        motivo: `venceu ${haQuanto(t.prazo_em, agora)}`,
        link,
        tarefaId: t.id,
        desde: t.prazo_em.toISOString(),
      });
    } else if (t.prazo_em && t.vence_hoje) {
      const hora = t.prazo_hora ? ` às ${t.prazo_hora.replace(/:00$/, "h").replace(":", "h")}` : "";
      itens.push({
        // Chave própria: adiar ou resolver o "vence hoje" não esconde a tarefa quando ela atrasar.
        chave: `hoje:${t.id}:${t.prazo_em.toISOString()}`,
        tipo: "vence_hoje",
        titulo: t.titulo,
        motivo: `vence hoje${hora}`,
        link,
        tarefaId: t.id,
        desde: t.prazo_em.toISOString(),
      });
    }
    if (t.ajuda_desde) {
      itens.push({
        chave: `ajuda:${t.id}:${t.ajuda_desde.toISOString()}`,
        tipo: "precisa_de_ajuda",
        titulo: t.titulo,
        motivo: `precisa de ajuda ${haQuanto(t.ajuda_desde, agora)}`,
        link,
        tarefaId: t.id,
        desde: t.ajuda_desde.toISOString(),
      });
    }
  }

  // Menções a mim sem comentário meu depois delas, na mesma tarefa (que eu vejo).
  const alcanceDaMencao = condicaoDeAlcance(quem, 2);
  const mencoes = await c.query<{
    comentario_id: string;
    tarefa_id: string;
    titulo: string;
    criado_em: Date;
    autor_pessoa_id: string | null;
    autor_agente_id: string | null;
  }>(
    `select distinct on (cm.id) cm.id as comentario_id, t.id as tarefa_id, t.titulo, cm.criado_em,
            cm.autor_pessoa_id, cm.autor_agente_id
       from mencoes_de_comentario m
       join comentarios_de_tarefa cm on cm.id = m.comentario_id and cm.empresa_id = m.empresa_id
       join tarefas t on t.id = cm.tarefa_id and t.empresa_id = cm.empresa_id
      where m.empresa_id = empresa_ativa() and m.pessoa_id = $1 and cm.apagado_em is null
        and cm.criado_em > $2::timestamptz - interval '${DIAS_DA_MENCAO} days'
        and cm.autor_pessoa_id is distinct from $1
        and not exists (select 1 from comentarios_de_tarefa r
                         where r.tarefa_id = cm.tarefa_id and r.empresa_id = cm.empresa_id
                           and r.autor_pessoa_id = $1 and r.criado_em > cm.criado_em and r.apagado_em is null)
        and ${alcanceDaMencao.sql}
      order by cm.id
      limit 200`,
    [eu, agora.toISOString(), ...alcanceDaMencao.valores],
  );
  const nomes = await nomesCitados(
    c,
    mencoes.rows.map((m) => m.autor_pessoa_id ?? m.autor_agente_id).filter((x): x is string => x !== null),
  );
  for (const m of mencoes.rows) {
    const autor = nomes[m.autor_pessoa_id ?? m.autor_agente_id ?? ""];
    itens.push({
      chave: `mencao:${m.comentario_id}`,
      tipo: "mencao",
      titulo: m.titulo,
      motivo: `mencionado${autor ? ` por ${autor}` : ""} ${haQuanto(m.criado_em, agora)}`,
      link: `/tarefas/${m.tarefa_id}`,
      tarefaId: m.tarefa_id,
      desde: m.criado_em.toISOString(),
    });
  }

  // Avisos de agentes não lidos.
  const avisos = await c.query<{ id: string; texto: string; link: string; criado_em: Date }>(
    `select id, texto, link, criado_em from avisos
      where empresa_id = empresa_ativa() and pessoa_id = $1 and tipo like 'agente\\_%' and lido_em is null
      order by criado_em limit 100`,
    [eu],
  );
  for (const a of avisos.rows) {
    itens.push({
      chave: `aviso:${a.id}`,
      tipo: "aviso_de_agente",
      titulo: a.texto,
      motivo: `aviso ${haQuanto(a.criado_em, agora)}`,
      link: a.link,
      tarefaId: null,
      desde: a.criado_em.toISOString(),
    });
  }

  // Pedidos de aprovação de agentes (M4-03) que a pessoa pode decidir: pediu, é responsável pelo agente ou administra.
  const aprovacoes = await c.query<{
    id: string;
    resumo: string;
    agente: string;
    tarefa_id: string | null;
    criada_em: Date;
    vence_em: Date;
  }>(
    `select a.id, a.resumo, g.nome as agente, a.tarefa_id, a.criada_em, a.vence_em
       from aprovacoes a join agentes g on g.id = a.agente_id and g.empresa_id = a.empresa_id
      where a.empresa_id = empresa_ativa() and a.situacao = 'pendente' and a.vence_em > $2::timestamptz
        and (a.pedido_por = $1 or g.responsavel_id = $1
             or exists (select 1 from vinculos v where v.empresa_id = a.empresa_id and v.pessoa_id = $1
                          and v.perfil = 'administrador' and v.situacao = 'ativo'))
      order by a.criada_em limit 50`,
    [eu, agora.toISOString()],
  );
  for (const a of aprovacoes.rows) {
    itens.push({
      chave: `aprovacao:${a.id}`,
      tipo: "aprovacao",
      titulo: a.resumo,
      motivo: `${a.agente.slice(0, 60)} pede aprovação ${haQuanto(a.criada_em, agora)}`,
      link: `/aprovacoes/${a.id}`,
      tarefaId: a.tarefa_id,
      desde: a.criada_em.toISOString(),
    });
  }

  // Tira o que a pessoa adiou (até a data) ou resolveu.
  const escondidos = await c.query<{ chave: string }>(
    `select chave from estados_de_prioridade
      where empresa_id = empresa_ativa() and pessoa_id = $1 and chave = any($2::text[])
        and (resolvido_em is not null or adiado_ate > $3::timestamptz)`,
    [eu, itens.map((i) => i.chave), agora.toISOString()],
  );
  const fora = new Set(escondidos.rows.map((l) => l.chave));
  return itens
    .filter((i) => !fora.has(i.chave))
    .sort((a, b) => ordemDo(a.tipo) - ordemDo(b.tipo) || a.desde.localeCompare(b.desde))
    .slice(0, LIMITE);
}

/** Adia o item até o começo do dia, no fuso da pessoa. Falso se o dia não é futuro. */
export async function adiarPrioridade(
  c: pg.PoolClient,
  pessoaId: string,
  chave: string,
  ate: string,
  agora = new Date(),
): Promise<boolean> {
  const fuso = await fusoDe(c, pessoaId);
  const r = await c.query(
    `insert into estados_de_prioridade (empresa_id, pessoa_id, chave, adiado_ate)
       select empresa_ativa(), $1, $2, ($3::date)::timestamp at time zone $4
        where ($3::date)::timestamp at time zone $4 > $5::timestamptz
     on conflict (empresa_id, pessoa_id, chave)
       do update set adiado_ate = excluded.adiado_ate, resolvido_em = null, mudou_em = now()`,
    [pessoaId, chave, ate, fuso, agora.toISOString()],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Resolve o item. Aviso de agente resolvido fica lido também no sino. */
export async function resolverPrioridade(c: pg.PoolClient, pessoaId: string, chave: string): Promise<void> {
  await c.query(
    `insert into estados_de_prioridade (empresa_id, pessoa_id, chave, resolvido_em)
       values (empresa_ativa(), $1, $2, now())
     on conflict (empresa_id, pessoa_id, chave)
       do update set resolvido_em = now(), adiado_ate = null, mudou_em = now()`,
    [pessoaId, chave],
  );
  const aviso = /^aviso:([0-9a-f-]{36})$/.exec(chave)?.[1];
  if (aviso) {
    await c.query(
      "update avisos set lido_em = coalesce(lido_em, now()) where id = $1 and empresa_id = empresa_ativa() and pessoa_id = $2",
      [aviso, pessoaId],
    );
  }
}
