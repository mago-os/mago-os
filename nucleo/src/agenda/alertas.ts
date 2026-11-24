/**
 * Os alertas da agenda (M5-07, decisão 0041), na verificação a cada minuto: para cada vez de evento que começa nos
 * próximos 7 dias, cada participante (menos quem respondeu "Não vou") recebe os alertas do evento ou, sem eles, os
 * dele (padrão: 10 minutos antes). Cada alerta vai uma vez só por começo de vez, pessoa e minutos; se o horário mudar,
 * o alerta vale para o começo novo. Evento cancelado não alerta. O aviso segue os canais e o silêncio de cada um (o
 * Telegram e o push esperam o fim do silêncio).
 */
import { ALERTAS_PADRAO, type EventoDaAgenda } from "@mago-os/contratos";
import type pg from "pg";
import { preferenciasDe } from "../avisos/notificacoes.ts";
import { comEmpresa } from "../empresa.ts";
import { ocorrenciasEntre } from "./ocorrencias.ts";
import { avisarPessoas, baseDo, eventoPorId } from "./servico.ts";

const DIAS_A_FRENTE = 7;
const MAXIMO_EM_MINUTOS = DIAS_A_FRENTE * 24 * 60;

function horaNoFuso(momento: Date, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(momento);
}

function emQuanto(minutos: number): string {
  if (minutos <= 0) return "Agora";
  if (minutos < 60) return `Em ${minutos} minuto${minutos === 1 ? "" : "s"}`;
  if (minutos < 1440) {
    const h = Math.round(minutos / 60);
    return `Em ${h} hora${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(minutos / 1440);
  return `Em ${d} dia${d === 1 ? "" : "s"}`;
}

/** A verificação a cada minuto. Devolve quantos alertas saíram. */
export async function cuidarDosAlertasDaAgenda(
  poolApp: pg.Pool,
  log: { error(obj: unknown, msg?: string): void },
  agora = new Date(),
): Promise<number> {
  const r = await poolApp.query<{ empresa_id: string }>("select empresa_id from empresas_com_agenda()");
  let total = 0;
  for (const { empresa_id } of r.rows) {
    try {
      total += await comEmpresa(poolApp, empresa_id, (c) => alertasDaEmpresa(c, agora));
    } catch (erro) {
      log.error({ erro, empresaId: empresa_id }, "Agenda: os alertas desta empresa falharam");
    }
  }
  return total;
}

export async function alertasDaEmpresa(c: pg.PoolClient, agora: Date): Promise<number> {
  const livre = await c.query<{ ok: boolean }>(
    "select pg_try_advisory_xact_lock(hashtextextended('agenda:' || empresa_ativa()::text, 0)) as ok",
  );
  if (!livre.rows[0]?.ok) return 0;
  await c.query(
    "delete from alertas_de_evento where empresa_id = empresa_ativa() and enviado_em < now() - interval '30 days'",
  );
  const ate = new Date(agora.getTime() + (MAXIMO_EM_MINUTOS + 1) * 60_000);
  const ids = await c.query<{ id: string }>(
    `select id from eventos where empresa_id = empresa_ativa() and situacao = 'marcado'
        and (regra is not null or (inicio_em > $1::timestamptz - interval '2 minutes' and inicio_em <= $2)) limit 2000`,
    [agora, ate],
  );
  // As vezes mudadas ou canceladas saem da série.
  const excecoes = new Set(
    (
      await c.query<{ chave: string }>(
        "select serie_id || ':' || ocorrencia_original as chave from eventos where empresa_id = empresa_ativa() and serie_id is not null",
      )
    ).rows.map((x) => x.chave),
  );
  const prefs = new Map<string, number[]>();
  const fusos = new Map<string, string>();
  let n = 0;
  for (const { id } of ids.rows) {
    const e = (await eventoPorId(c, id)) as EventoDaAgenda;
    // Até 2 minutos depois do começo, para o alerta "na hora" (0 minutos) sair na verificação seguinte.
    const desde = new Date(agora.getTime() - 2 * 60_000);
    for (const o of ocorrenciasEntre(baseDo(e), desde, ate, 50)) {
      if (e.regra && excecoes.has(`${e.id}:${o.dia}`)) continue;
      if (o.inicioEm.getTime() <= desde.getTime()) continue;
      for (const p of e.participantes) {
        if (p.resposta === "nao_vou") continue;
        let alertas = e.alertas;
        if (!alertas) {
          if (!prefs.has(p.pessoaId))
            prefs.set(
              p.pessoaId,
              (await preferenciasDe(c, p.pessoaId)).alertasDaAgenda ?? [...ALERTAS_PADRAO],
            );
          alertas = prefs.get(p.pessoaId) as number[];
        }
        for (const m of alertas) {
          const hora = o.inicioEm.getTime() - m * 60_000;
          if (hora > agora.getTime()) continue;
          // Depois do começo, só o alerta "na hora" ainda vale.
          if (m > 0 && o.inicioEm.getTime() <= agora.getTime()) continue;
          const marcou = await c.query(
            `insert into alertas_de_evento (empresa_id, evento_id, pessoa_id, inicio_da_ocorrencia, minutos)
             values (empresa_ativa(), $1, $2, $3, $4) on conflict do nothing`,
            [e.id, p.pessoaId, o.inicioEm, m],
          );
          if (!marcou.rowCount) continue;
          // Um alerta perdido há muito (servidor fora do ar) só fica marcado: o próximo, mais perto, vai.
          if (agora.getTime() - hora > 30 * 60_000 && m > 0) continue;
          if (!fusos.has(p.pessoaId)) {
            const f = await c.query<{ fuso: string }>(
              `select coalesce(p.fuso_horario, e.fuso_horario, 'UTC') as fuso from pessoas p, empresas e
                where p.id = $1 and e.id = empresa_ativa()`,
              [p.pessoaId],
            );
            fusos.set(p.pessoaId, f.rows[0]?.fuso ?? "UTC");
          }
          const falta = Math.max(0, Math.round((o.inicioEm.getTime() - agora.getTime()) / 60_000));
          const quando = e.diaInteiro
            ? "o dia todo"
            : `às ${horaNoFuso(o.inicioEm, fusos.get(p.pessoaId) as string)}`;
          n += await avisarPessoas(c, {
            tipo: "alerta_de_evento",
            texto: `${emQuanto(falta)}: ${e.titulo}, ${quando}${e.local ? `, em ${e.local}` : ""}.`,
            link: `/agenda/${e.id}`,
            para: [p.pessoaId],
          });
        }
      }
    }
  }
  return n;
}
