/**
 * O que roda as rotinas (M5-05, decisão 0039), na verificação a cada minuto e logo depois do "Rodar agora".
 *
 * 1. As rotinas ligadas que chegaram na hora viram uma execução (só a última vez perdida, se o servidor ficou fora) e
 *    ganham a próxima vez.
 * 2. Cada execução na fila roda com a permissão do dono, na transação dele: criar tarefa e mandar aviso são tudo ou
 *    nada; pedir a um agente abre a conversa (ou a tarefa) e espera o agente terminar, conferindo a cada minuto.
 * 3. Falha tenta de novo depois de 5 e de 15 minutos, quando é seguro; depois disso, avisa o dono (central de
 *    prioridades) e vai para a auditoria.
 */
import {
  type AcaoDaRotina,
  CATALOGO_DE_ACOES,
  canaisDoTipo,
  type DeclaracaoDeModulo,
  MARCADOR_DA_TAREFA,
  MAXIMO_DE_DISPAROS_POR_MINUTO,
  MAXIMO_DE_EXECUCOES_POR_DIA,
  MINUTOS_PARA_TENTAR_DE_NOVO,
  type Perfil,
  type Rotina,
} from "@mago-os/contratos";
import type pg from "pg";
import { haParadaAtiva, paradaDoAgente } from "../agentes/parada.ts";
import { quemPediu } from "../agentes-internos/ferramentas.ts";
import { receberMensagemDaPessoa } from "../agentes-internos/mensagem-da-pessoa.ts";
import { entregarAoAgenteInterno } from "../agentes-internos/tarefa-atribuida.ts";
import { auditar } from "../auditoria/registrar.ts";
import { avisarDepois } from "../avisos/eventos.ts";
import { criarAviso } from "../avisos/index.ts";
import { pessoaVeTarefa, preferenciasDe } from "../avisos/notificacoes.ts";
import { comEmpresa, comoRotina, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { planejar, recusaDoPlanejamento } from "../tarefas/planejamento.ts";
import { buscarTarefa, criarTarefa } from "../tarefas/servico.ts";
import { diaNoFuso, ultimaEProxima } from "./horarios.ts";
import { buscarRotina, COLUNAS_DA_EXECUCAO, filtrosBatem, paraExecucao, recusaDaAcao } from "./servico.ts";

export interface OpcoesDoMotorDasRotinas {
  poolApp: pg.Pool;
  catalogo: Map<string, DeclaracaoDeModulo>;
  log: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
  /** Põe na fila do motor dos agentes a execução criada pela rotina. */
  acordar(empresaId: string, execucaoId: string): void;
}

const SISTEMA = { canal: "sistema" as const, ip: null, aparelho: null };
/** "Rodando" sem agente por mais tempo que isso: a ação não terminou (reinício no meio). */
const MINUTOS_PARA_DAR_COMO_PRESA = 10;
const TUDO = { tipo: "tudo" as const };

/** As ferramentas que só leem ou conversam: depois delas, tentar de novo não repete nada. */
const SO_LEEM = new Set([
  ...CATALOGO_DE_ACOES.filter((a) => !a.mudaDados).map((a) => a.acao),
  "responder",
  "perguntar",
  "pegar_skill",
]);

/** Falha que tentar de novo não resolve (sem permissão, agente pausado, projeto que sumiu). */
class FalhaSemVolta extends Error {}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A verificação a cada minuto. Devolve quantas execuções foram cuidadas. */
export async function cuidarDasRotinas(o: OpcoesDoMotorDasRotinas, agora = new Date()): Promise<number> {
  const r = await o.poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_rotinas_a_cuidar()",
  );
  let n = 0;
  for (const { empresa_id } of r.rows) {
    try {
      n += await cuidarDaEmpresa(o, empresa_id, agora);
    } catch (erro) {
      o.log.error({ erro, empresaId: empresa_id }, "Rotinas: a verificação desta empresa falhou");
    }
  }
  return n;
}

export async function cuidarDaEmpresa(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  agora = new Date(),
): Promise<number> {
  // 1. As rotinas por horário que chegaram na hora viram execução (uma verificação por vez por empresa).
  await comEmpresa(o.poolApp, empresaId, async (c) => {
    const livre = await c.query<{ ok: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended('rotinas:' || empresa_ativa()::text, 0)) as ok",
    );
    if (!livre.rows[0]?.ok) return;
    const vencidas = await c.query<{
      id: string;
      gatilho: Rotina["gatilho"];
      proxima_em: Date;
      vezes: number;
    }>(
      `select id, gatilho, proxima_em, vezes from rotinas
        where empresa_id = empresa_ativa() and situacao = 'ligada' and gatilho ->> 'tipo' = 'horario'
          and proxima_em <= $1
        order by proxima_em limit 100 for update skip locked`,
      [agora],
    );
    for (const v of vencidas.rows) {
      if (v.gatilho.tipo !== "horario") continue;
      const { ultima, proxima } = ultimaEProxima(v.gatilho, v.proxima_em, agora, v.vezes);
      if (ultima)
        await c.query(
          `insert into execucoes_de_rotina (empresa_id, rotina_id, origem, prevista_para)
           values (empresa_ativa(), $1, 'horario', $2)`,
          [v.id, ultima],
        );
      await c.query(
        `update rotinas set vezes = vezes + $2, proxima_em = $3, atualizada_em = now(),
                situacao = case when $3::timestamptz is null then 'desligada' else situacao end,
                desligada_porque = case when $3::timestamptz is null then 'terminou' else desligada_porque end
          where id = $1 and empresa_id = empresa_ativa()`,
        [v.id, ultima ? 1 : 0, proxima],
      );
    }
  });
  // 2. Os eventos do sistema viram execução das rotinas por evento que batem.
  await cuidarDosEventos(o, empresaId, agora);
  // 3. As execuções a cuidar.
  const ids = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{ id: string }>(
      `select id from execucoes_de_rotina
        where empresa_id = empresa_ativa()
          and (situacao = 'na_fila'
               or (situacao = 'esperando' and (proxima_tentativa_em is null or proxima_tentativa_em <= $1))
               or (situacao = 'rodando' and execucao_de_agente_id is not null)
               or (situacao = 'rodando' and iniciada_em < $1::timestamptz - make_interval(mins => $2)))
          -- O evento que espera a vez anterior da mesma rotina não ocupa lugar enquanto ela roda.
          and not (origem = 'evento' and situacao = 'na_fila' and exists (
                select 1 from execucoes_de_rotina y where y.empresa_id = empresa_ativa()
                   and y.rotina_id = execucoes_de_rotina.rotina_id and y.situacao = 'rodando'))
        order by criada_em limit 50`,
      [agora, MINUTOS_PARA_DAR_COMO_PRESA],
    );
    return r.rows.map((x) => x.id);
  });
  for (const id of ids) {
    try {
      await cuidarDaExecucao(o, empresaId, id, agora);
    } catch (erro) {
      o.log.error({ erro, execucaoDeRotinaId: id }, "Rotinas: a execução não foi cuidada");
    }
  }
  return ids.length;
}

/**
 * Os eventos esperando viram execução das rotinas por evento que batem (decisão 0040): ligada antes do evento, os
 * filtros batem, o dono está ativo e vê a tarefa. O evento causado por rotina só sai da fila. Antes, a tarefa
 * atrasada entra na fila uma vez por prazo; os eventos olhados há mais de 7 dias são apagados.
 */
async function cuidarDosEventos(o: OpcoesDoMotorDasRotinas, empresaId: string, agora: Date): Promise<void> {
  await comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query(
      `insert into eventos_para_rotinas (empresa_id, evento, tarefa_id, prazo_em, criado_em)
       select t.empresa_id, 'tarefa_atrasada', t.id, t.prazo_em, t.prazo_em from tarefas t
        where t.empresa_id = empresa_ativa() and t.status not in ('concluida', 'cancelada')
          and t.prazo_em <= $1 and t.prazo_em > $1::timestamptz - interval '7 days'
          and exists (select 1 from rotinas r where r.empresa_id = t.empresa_id and r.situacao = 'ligada'
                       and r.gatilho ->> 'tipo' = 'evento' and r.gatilho ->> 'evento' = 'tarefa_atrasada'
                       and r.ligada_em <= t.prazo_em)
       on conflict do nothing`,
      [agora],
    );
    await c.query(
      "delete from eventos_para_rotinas where empresa_id = empresa_ativa() and cuidado_em < now() - interval '7 days'",
    );
    const eventos = await c.query<{
      id: string;
      evento: string;
      tarefa_id: string;
      da_rotina: boolean;
      criado_em: Date;
    }>(
      `update eventos_para_rotinas set cuidado_em = now()
        where id in (select id from eventos_para_rotinas where empresa_id = empresa_ativa() and cuidado_em is null
                      order by criado_em limit 200 for update skip locked)
        returning id, evento, tarefa_id, da_rotina, criado_em`,
    );
    for (const e of eventos.rows.sort((a, b) => a.criado_em.getTime() - b.criado_em.getTime())) {
      if (e.da_rotina) continue;
      const rotinas = await c.query<{ id: string; dono_pessoa_id: string; gatilho: Rotina["gatilho"] }>(
        `select r.id, r.dono_pessoa_id, r.gatilho from rotinas r
           join vinculos v on v.empresa_id = r.empresa_id and v.pessoa_id = r.dono_pessoa_id and v.situacao = 'ativo'
          where r.empresa_id = empresa_ativa() and r.situacao = 'ligada' and r.gatilho ->> 'tipo' = 'evento'
            and r.gatilho ->> 'evento' = $1 and r.ligada_em <= $2`,
        [e.evento, e.criado_em],
      );
      for (const r of rotinas.rows) {
        if (!(await filtrosBatem(c, e.tarefa_id, r.gatilho))) continue;
        if (!(await pessoaVeTarefa(c, r.dono_pessoa_id, e.tarefa_id))) continue;
        // No máximo 3 disparos por minuto por rotina (decisão 13): passou, fica registrada como pulada.
        // Contado pela hora dos eventos (uma fila atrasada não vira pulo).
        const n = await c.query<{ n: number }>(
          `select count(*)::int as n from execucoes_de_rotina x
             join eventos_para_rotinas v on v.id = x.evento_id and v.empresa_id = x.empresa_id
            where x.empresa_id = empresa_ativa() and x.rotina_id = $1 and x.origem = 'evento' and x.situacao <> 'pulada'
              and v.criado_em > $2::timestamptz - interval '1 minute' and v.criado_em <= $2`,
          [r.id, e.criado_em],
        );
        const pulada = (n.rows[0]?.n ?? 0) >= MAXIMO_DE_DISPAROS_POR_MINUTO;
        await c.query(
          `insert into execucoes_de_rotina (empresa_id, rotina_id, origem, evento, tarefa_do_evento_id, evento_id,
                                            situacao, motivo, terminada_em)
           values (empresa_ativa(), $1, 'evento', $2, $3, $4, $5, $6, case when $7 then now() end)
           on conflict do nothing`,
          [
            r.id,
            e.evento,
            e.tarefa_id,
            e.id,
            pulada ? "pulada" : "na_fila",
            pulada ? `Passou do limite de ${MAXIMO_DE_DISPAROS_POR_MINUTO} disparos por minuto.` : null,
            pulada,
          ],
        );
      }
    }
  });
}

interface Contexto {
  execucao: ReturnType<typeof paraExecucao>;
  rotina: Rotina;
  dono: { nome: string; perfil: Perfil; ativo: boolean };
  /** O fuso da rotina: o do gatilho por horário; na rotina por evento, o do dono (ou o da empresa). */
  fuso: string;
  /**
   * A tarefa que disparou (rotina por evento): o título, a tarefa-mãe e se o título ou o comentário do evento são de
   * outra pessoa (texto de outros para o agente, M4-04).
   */
  disparo: { id: string; titulo: string; maeId: string | null; deOutros: boolean } | null;
}

async function carregar(c: pg.PoolClient, execucaoId: string): Promise<Contexto | null> {
  const e = await c.query(
    `select ${COLUNAS_DA_EXECUCAO} from execucoes_de_rotina where id = $1 and empresa_id = empresa_ativa()
      for update skip locked`,
    [execucaoId],
  );
  if (!e.rows[0]) return null;
  const execucao = paraExecucao(e.rows[0]);
  const rotina = await buscarRotina(c, TUDO, execucao.rotinaId);
  if (!rotina) return null;
  const d = await c.query<{ nome: string; perfil: Perfil; situacao: string; fuso: string }>(
    `select p.nome, v.perfil, v.situacao,
            coalesce(p.fuso_horario, (select e.fuso_horario from empresas e where e.id = empresa_ativa()), 'UTC') as fuso
       from vinculos v join pessoas p on p.id = v.pessoa_id
      where v.empresa_id = empresa_ativa() and v.pessoa_id = $1`,
    [rotina.donoPessoaId],
  );
  const dono = d.rows[0];
  return {
    execucao,
    rotina,
    dono: {
      nome: dono?.nome ?? "",
      perfil: dono?.perfil ?? "funcionario",
      ativo: dono?.situacao === "ativo",
    },
    fuso: rotina.gatilho.tipo === "horario" ? rotina.gatilho.fuso : (dono?.fuso ?? "UTC"),
    disparo: execucao.tarefaDoEventoId
      ? await disparoDe(c, execucao.id, execucao.tarefaDoEventoId, rotina.donoPessoaId)
      : null,
  };
}

async function disparoDe(
  c: pg.PoolClient,
  execucaoId: string,
  tarefaId: string,
  donoId: string,
): Promise<Contexto["disparo"]> {
  // De outra pessoa: escrito por quem não é o dono e não por um agente interno (o sistema conta, como na M4-04).
  const r = await c.query<{ titulo: string; mae: string | null; de_outros: boolean }>(
    `select t.titulo, t.tarefa_mae_id as mae,
            ((t.criada_por_pessoa_id is distinct from $2
              and not exists (select 1 from agentes a where a.id = t.criada_por_agente_id and a.tipo = 'interno'))
             or exists (select 1 from execucoes_de_rotina x
                          join eventos_para_rotinas v on v.id = x.evento_id and v.empresa_id = x.empresa_id
                          join comentarios_de_tarefa m on m.id = v.comentario_id and m.empresa_id = v.empresa_id
                         where x.id = $3 and m.autor_pessoa_id is distinct from $2
                           and not exists (select 1 from agentes a where a.id = m.autor_agente_id and a.tipo = 'interno')))
              as de_outros
       from tarefas t where t.id = $1 and t.empresa_id = empresa_ativa()`,
    [tarefaId, donoId, execucaoId],
  );
  const t = r.rows[0];
  return t ? { id: tarefaId, titulo: t.titulo, maeId: t.mae, deOutros: t.de_outros } : null;
}

/** Os textos da rotina por evento: {tarefa} vira o título da tarefa que disparou. */
function preencher(ctx: Contexto, texto: string): string {
  return ctx.disparo ? texto.replaceAll(MARCADOR_DA_TAREFA, ctx.disparo.titulo) : texto;
}

async function terminar(
  c: pg.PoolClient,
  id: string,
  situacao: "feita" | "pulada",
  extras: { motivo?: string | null; custo?: number } = {},
) {
  await c.query(
    `update execucoes_de_rotina set situacao = $2, motivo = coalesce($3, motivo), custo = custo + coalesce($4::numeric, 0),
            terminada_em = now(), proxima_tentativa_em = null
      where id = $1 and empresa_id = empresa_ativa()`,
    [id, situacao, extras.motivo ?? null, extras.custo ?? null],
  );
}

/**
 * A falha: com volta e tentativas sobrando, espera a próxima tentativa; senão, falhou de vez, o dono recebe o aviso
 * (que fica na central de prioridades) e a falha vai para a auditoria.
 */
async function falhar(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  ctx: Contexto,
  motivo: string,
  comVolta: boolean,
  agora: Date,
  custo?: number,
): Promise<void> {
  const curto = motivo.slice(0, 480);
  const { execucao, rotina } = ctx;
  const tentativa = execucao.tentativa;
  const minutos = MINUTOS_PARA_TENTAR_DE_NOVO[tentativa - 1];
  await comEmpresa(o.poolApp, empresaId, async (c) => {
    if (comVolta && minutos !== undefined) {
      await c.query(
        `update execucoes_de_rotina set situacao = 'esperando', tentativa = tentativa + 1, motivo = $2,
                proxima_tentativa_em = $3, execucao_de_agente_id = null, conversa_id = null,
                custo = custo + coalesce($4::numeric, 0)
          where id = $1 and empresa_id = empresa_ativa()`,
        [execucao.id, curto, new Date(agora.getTime() + minutos * 60_000), custo ?? null],
      );
      return;
    }
    await c.query(
      `update execucoes_de_rotina set situacao = 'falhou', motivo = $2, terminada_em = now(),
              proxima_tentativa_em = null, custo = custo + coalesce($3::numeric, 0)
        where id = $1 and empresa_id = empresa_ativa()`,
      [execucao.id, curto, custo ?? null],
    );
    await criarAviso(c, {
      pessoaId: rotina.donoPessoaId,
      tipo: "rotina_falhou",
      texto: `A rotina "${rotina.nome}" não conseguiu rodar: ${curto}`,
      link: `/rotinas/${rotina.id}`,
    });
  });
  if (comVolta && minutos !== undefined) return;
  await auditar(
    o.poolApp,
    {
      empresaId,
      ator: { tipo: "sistema", servico: "rotinas" },
      acao: "rotina.falhou",
      alvo: { tipo: "rotina", id: rotina.id },
      origem: SISTEMA,
      detalhes: { execucaoId: execucao.id, acao: rotina.acao.tipo, tentativas: tentativa },
    },
    o.log,
  );
}

/** Cuida de uma execução: roda a que está na fila ou chegou a hora, e confere a que espera o agente. */
export function cuidarDaExecucao(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  execucaoId: string,
  agora = new Date(),
): Promise<void> {
  // O que a rotina faz (e o agente que ela chama) fica marcado como da rotina: não dispara outra (decisão 0040).
  return comoRotina(() => cuidarDaExecucaoDaRotina(o, empresaId, execucaoId, agora));
}

async function cuidarDaExecucaoDaRotina(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  execucaoId: string,
  agora: Date,
): Promise<void> {
  const ctx = await comEmpresa(o.poolApp, empresaId, (c) => carregar(c, execucaoId));
  if (!ctx) return;
  const { execucao, rotina } = ctx;
  if (execucao.situacao === "rodando" && !execucao.execucaoDeAgenteId) {
    // Ficou "rodando" sem agente por mais de 10 minutos: a ação não terminou (o servidor reiniciou no meio). Criar
    // tarefa, avisar e abrir a conversa são tudo ou nada, então tenta de novo; a tarefa do agente já criada, não.
    const desde = execucao.iniciadaEm ? new Date(execucao.iniciadaEm).getTime() : agora.getTime();
    if (agora.getTime() - desde < MINUTOS_PARA_DAR_COMO_PRESA * 60_000) return;
    if (execucao.tarefaId)
      await falhar(o, empresaId, ctx, "O agente não começou a tarefa criada pela rotina.", false, agora);
    else await falhar(o, empresaId, ctx, "A execução parou no meio (o servidor reiniciou).", true, agora);
    return;
  }
  if (execucao.situacao === "rodando" && execucao.execucaoDeAgenteId) {
    await conferirAgente(o, empresaId, ctx, execucao.execucaoDeAgenteId, agora);
    return;
  }
  if (execucao.situacao === "esperando" && execucao.proximaTentativaEm === null) {
    // Esperando os agentes voltarem da parada.
    const parados = await comEmpresa(o.poolApp, empresaId, (c) => agentesParados(c, rotina.acao));
    if (parados) return;
  }
  if (!["na_fila", "esperando"].includes(execucao.situacao)) return;
  await rodar(o, empresaId, ctx, agora);
}

async function agentesParados(c: pg.PoolClient, acao: AcaoDaRotina): Promise<boolean> {
  if (acao.tipo !== "pedir_ao_agente") return false;
  return (await haParadaAtiva(c)) || (await paradaDoAgente(c, acao.agenteId)) !== null;
}

async function rodar(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  ctx: Contexto,
  agora: Date,
): Promise<void> {
  const { execucao, rotina } = ctx;
  // Antes de rodar, numa transação com a rotina travada: a execução ainda espera (outra cópia não pegou), a rotina
  // não foi desligada por alguém (a que terminou ainda roda a última vez), o limite do dia, a anterior terminada e o
  // dono ativo. Passou, a execução fica "rodando" já gravada, e outra cópia não a roda de novo.
  const seguir = await comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtextextended('rotina:' || $1, 0))", [rotina.id]);
    const atual = await c.query<{ situacao: string; iniciada_em: Date | null }>(
      "select situacao, iniciada_em from execucoes_de_rotina where id = $1 and empresa_id = empresa_ativa() for update",
      [execucao.id],
    );
    const agoraNaFila = atual.rows[0];
    if (!agoraNaFila || !["na_fila", "esperando"].includes(agoraNaFila.situacao)) return false;
    const pulo = await (async () => {
      if (
        execucao.origem === "horario" &&
        rotina.situacao === "desligada" &&
        rotina.desligadaPorque !== "terminou" &&
        execucao.tentativa === 1
      )
        return "A rotina foi desligada antes de rodar.";
      const hoje = diaNoFuso(agora, ctx.fuso);
      const n = await c.query<{ n: number; rodando: number }>(
        `select count(*) filter (where (iniciada_em at time zone $3)::date = $2::date)::int as n,
                count(*) filter (where situacao = 'rodando')::int as rodando
           from execucoes_de_rotina
          where empresa_id = empresa_ativa() and rotina_id = $1 and id <> $4 and iniciada_em is not null`,
        [rotina.id, hoje, ctx.fuso, execucao.id],
      );
      if (agoraNaFila.iniciada_em === null && (n.rows[0]?.n ?? 0) >= MAXIMO_DE_EXECUCOES_POR_DIA)
        return `Passou do limite de ${MAXIMO_DE_EXECUCOES_POR_DIA} vezes por dia.`;
      if ((n.rows[0]?.rodando ?? 0) > 0)
        // Na rotina por evento, cada evento é diferente: espera a anterior na fila (decisão 0040).
        return execucao.origem === "evento" ? "esperar" : "A vez anterior ainda estava rodando.";
      if (!ctx.dono.ativo) return "O dono da rotina não está mais ativo na empresa.";
      // Rotina por evento: a tarefa que disparou ainda existe e o dono ainda a vê.
      if (execucao.origem === "evento" || rotina.gatilho.tipo === "evento") {
        if (!ctx.disparo) return "A tarefa que disparou não existe mais.";
        if (!(await pessoaVeTarefa(c, rotina.donoPessoaId, ctx.disparo.id)))
          return "O dono da rotina não vê mais a tarefa que disparou.";
      }
      return null;
    })();
    if (pulo === "esperar") return false;
    if (pulo) {
      await terminar(c, execucao.id, "pulada", { motivo: pulo });
      return false;
    }
    await c.query(
      `update execucoes_de_rotina set situacao = 'rodando', iniciada_em = coalesce(iniciada_em, now()),
              proxima_tentativa_em = null where id = $1 and empresa_id = empresa_ativa()`,
      [execucao.id],
    );
    return true;
  });
  if (!seguir) return;
  const permissoes = await permissoesNaEmpresa(o.poolApp, rotina.donoPessoaId, empresaId, o.catalogo);
  if (!permissoes) {
    await falhar(o, empresaId, ctx, "O dono da rotina não está mais ativo na empresa.", false, agora);
    return;
  }
  const dono = { pessoaId: rotina.donoPessoaId, permissoes };
  let depois: (() => Promise<void>) | null = null;
  try {
    depois = await comPessoa(o.poolApp, rotina.donoPessoaId, empresaId, async (c) => {
      const recusa = await recusaDaAcao(c, dono, rotina.acao);
      if (recusa) throw new FalhaSemVolta(recusa);
      // A execução já está "rodando" (gravada antes); as ações marcam o resultado na mesma transação.
      const marcarInicio = async () => {};
      const acao = rotina.acao;
      switch (acao.tipo) {
        case "criar_tarefa":
          return criarTarefaDaRotina(o, empresaId, c, ctx, dono, acao, agora, marcarInicio);
        case "mandar_aviso":
          return mandarAvisoDaRotina(c, ctx, acao, marcarInicio);
        case "pedir_ao_agente":
          return pedirAoAgenteDaRotina(o, empresaId, c, ctx, dono, acao, agora, marcarInicio);
      }
    });
  } catch (erro) {
    if (erro instanceof FalhaSemVolta) {
      await falhar(o, empresaId, ctx, erro.message, false, agora);
      return;
    }
    o.log.warn({ erro, rotinaId: rotina.id }, "Rotinas: a execução falhou");
    // Criar tarefa e avisar são tudo ou nada (a transação desfez): tentar de novo é seguro.
    await falhar(o, empresaId, ctx, "Erro ao rodar a ação.", true, agora);
    return;
  }
  if (depois) await depois();
}

type Dono = { pessoaId: string; permissoes: NonNullable<Awaited<ReturnType<typeof permissoesNaEmpresa>>> };

/** O prazo relativo ("em 2 dias") a partir do dia de hoje no fuso da rotina. */
function prazoDaRotina(fuso: string, emDias: number, hora: string | null | undefined, agora: Date) {
  return { dia: somarDias(diaNoFuso(agora, fuso), emDias), hora: hora ?? null, fuso };
}

async function criarTarefaDaRotina(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  c: pg.PoolClient,
  ctx: Contexto,
  dono: Dono,
  acao: Extract<AcaoDaRotina, { tipo: "criar_tarefa" }>,
  agora: Date,
  marcarInicio: () => Promise<unknown>,
): Promise<() => Promise<void>> {
  const quem = quemPediu(dono.permissoes, dono.pessoaId, "criar");
  if (!quem) throw new FalhaSemVolta("O dono da rotina não pode criar tarefas.");
  await marcarInicio();
  const plano = {
    ...(acao.prazo ? { prazo: prazoDaRotina(ctx.fuso, acao.prazo.emDias, acao.prazo.hora, agora) } : {}),
    ...(acao.prioridade ? { prioridade: acao.prioridade } : {}),
  };
  const recusa = await recusaDoPlanejamento(c, null, plano);
  if (recusa) throw new FalhaSemVolta(recusa);
  // Como subtarefa da que disparou (ou ao lado dela, se ela já for subtarefa): fica no projeto e na lista da mãe.
  // Subtarefa só de uma mãe aberta (como na tela: mãe fechada não ganha subtarefa). Com a mãe já fechada, a tarefa
  // nasce solta, no projeto dela.
  const candidata = acao.comoSubtarefa && ctx.disparo ? (ctx.disparo.maeId ?? ctx.disparo.id) : null;
  const daMae = candidata
    ? (
        await c.query<{ aberta: boolean; projeto_id: string | null }>(
          `select status not in ('concluida', 'cancelada') as aberta, projeto_id from tarefas
            where id = $1 and empresa_id = empresa_ativa()`,
          [candidata],
        )
      ).rows[0]
    : undefined;
  const mae = daMae?.aberta ? candidata : null;
  let tarefa = await criarTarefa(c, quem, {
    titulo: preencher(ctx, acao.titulo).slice(0, 200),
    descricao: acao.descricao ? preencher(ctx, acao.descricao) : null,
    responsavel: acao.responsavel ?? { tipo: "pessoa", pessoaId: dono.pessoaId },
    ...(mae ? { tarefaMaeId: mae } : { projetoId: acao.projetoId ?? daMae?.projeto_id ?? null }),
  });
  if (Object.keys(plano).length > 0) {
    await planejar(c, tarefa, plano, ctx.fuso);
    tarefa =
      (await buscarTarefa(c, { tipo: "pessoa", pessoaId: dono.pessoaId, filtro: TUDO }, tarefa.id)) ?? tarefa;
  }
  await c.query(
    `update execucoes_de_rotina set situacao = 'feita', tarefa_id = $2, terminada_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [ctx.execucao.id, tarefa.id],
  );
  return async () => {
    await auditar(
      o.poolApp,
      {
        empresaId,
        ator: { tipo: "pessoa", pessoaId: dono.pessoaId },
        acao: "tarefa.criou",
        alvo: { tipo: "tarefa", id: tarefa.id },
        origem: SISTEMA,
        detalhes: { rotinaId: ctx.rotina.id },
      },
      o.log,
    );
    await avisarDepois(
      o.poolApp,
      empresaId,
      { tipo: "pessoa", pessoaId: dono.pessoaId },
      { tipo: "criou", tarefa },
      o.log,
    );
    if (tarefa.responsavel?.tipo === "agente")
      await entregarAoAgenteInterno(
        o.poolApp,
        empresaId,
        { tipo: "pessoa", pessoaId: dono.pessoaId },
        tarefa.id,
        o.acordar,
      );
  };
}

async function mandarAvisoDaRotina(
  c: pg.PoolClient,
  ctx: Contexto,
  acao: Extract<AcaoDaRotina, { tipo: "mandar_aviso" }>,
  marcarInicio: () => Promise<unknown>,
): Promise<null> {
  await marcarInicio();
  const texto = `${preencher(ctx, acao.texto)} (rotina "${ctx.rotina.nome}", de ${ctx.dono.nome})`.slice(
    0,
    500,
  );
  const link = acao.link ?? (ctx.disparo ? `/tarefas/${ctx.disparo.id}` : "/");
  let avisados = 0;
  for (const pessoaId of acao.para) {
    const canais = canaisDoTipo(await preferenciasDe(c, pessoaId), "aviso_de_rotina");
    if (!canais.tela && !canais.push && !canais.telegram) continue;
    const r = await c.query(
      `insert into avisos (empresa_id, pessoa_id, tipo, texto, link, push_pendente, lido_em, telegram_pendente)
       select empresa_ativa(), $1, 'aviso_de_rotina', $2, $3, $4, case when $5 then null else now() end, $6
        where exists (select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo')`,
      [pessoaId, texto, link, canais.push, canais.tela, canais.telegram],
    );
    avisados += r.rowCount ?? 0;
  }
  await c.query(
    `update execucoes_de_rotina set situacao = 'feita', avisados = $2, terminada_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [ctx.execucao.id, avisados],
  );
  return null;
}

async function pedirAoAgenteDaRotina(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  c: pg.PoolClient,
  ctx: Contexto,
  dono: Dono,
  acao: Extract<AcaoDaRotina, { tipo: "pedir_ao_agente" }>,
  agora: Date,
  marcarInicio: () => Promise<unknown>,
): Promise<(() => Promise<void>) | null> {
  const { execucao, rotina } = ctx;
  // Agentes parados (M4-09): espera; só a mais recente da rotina fica esperando.
  if (await agentesParados(c, acao)) {
    await c.query(
      `update execucoes_de_rotina set situacao = 'pulada', motivo = 'Veio uma vez mais nova enquanto os agentes estavam parados.',
              terminada_em = now()
        where empresa_id = empresa_ativa() and rotina_id = $1 and id <> $2 and situacao = 'esperando'
          and proxima_tentativa_em is null`,
      [rotina.id, execucao.id],
    );
    await c.query(
      `update execucoes_de_rotina set situacao = 'esperando', proxima_tentativa_em = null,
              motivo = 'Os agentes estão parados; roda uma vez quando eles voltarem.'
        where id = $1 and empresa_id = empresa_ativa()`,
      [execucao.id],
    );
    return null;
  }
  // Teto do mês da rotina: pula, e o dono é avisado uma vez no mês.
  if (rotina.tetoMensal !== null) {
    const g = await c.query<{ gasto: string; avisou: boolean }>(
      `select coalesce(sum(custo), 0) as gasto,
              bool_or(situacao = 'pulada' and motivo like 'Chegou no teto%') as avisou
         from execucoes_de_rotina
        where empresa_id = empresa_ativa() and rotina_id = $1
          and criada_em >= date_trunc('month', $2::timestamptz at time zone $3) at time zone $3`,
      [rotina.id, agora, ctx.fuso],
    );
    if (Number(g.rows[0]?.gasto ?? 0) >= rotina.tetoMensal) {
      await terminar(c, execucao.id, "pulada", { motivo: "Chegou no teto de gasto do mês desta rotina." });
      if (!g.rows[0]?.avisou)
        await criarAviso(c, {
          pessoaId: rotina.donoPessoaId,
          tipo: "rotina_falhou",
          texto: `A rotina "${rotina.nome}" chegou no teto de gasto do mês e só volta a chamar o agente no mês que vem (ou quando você subir o teto).`,
          link: `/rotinas/${rotina.id}`,
        });
      return null;
    }
  }
  const comSkill = acao.skill
    ? `${preencher(ctx, acao.pedido)}\n\nUse a skill ${acao.skill}.`
    : preencher(ctx, acao.pedido);
  const texto = ctx.disparo
    ? `${comSkill}\n\nTarefa que disparou a rotina: “${ctx.disparo.titulo}” (id ${ctx.disparo.id}).`
    : comSkill;
  const deOutros = ctx.disparo?.deOutros ?? false;
  if (acao.resultado === "mensagem") {
    const r = await receberMensagemDaPessoa(c, {
      pessoaId: dono.pessoaId,
      perfil: ctx.dono.perfil,
      texto,
      agenteId: acao.agenteId,
      canal: "rotina",
    });
    if ("erro" in r) {
      if (r.erro === "parados") {
        await c.query(
          `update execucoes_de_rotina set situacao = 'esperando', proxima_tentativa_em = null, motivo = $2
            where id = $1 and empresa_id = empresa_ativa()`,
          [execucao.id, "Os agentes estão parados; roda uma vez quando eles voltarem."],
        );
        return null;
      }
      throw new FalhaSemVolta(
        r.erro === "pausado"
          ? `O agente ${r.nome} está pausado.`
          : r.erro === "sem_permissao"
            ? "O dono da rotina não pode pedir direto a esse especialista."
            : "O agente não foi encontrado.",
      );
    }
    await c.query("update conversas set titulo = $2 where id = $1 and empresa_id = empresa_ativa()", [
      r.conversa.id,
      `Rotina: ${rotina.nome}`.slice(0, 120),
    ]);
    await marcarInicio();
    await c.query(
      `update execucoes_de_rotina set execucao_de_agente_id = $2, conversa_id = $3 where id = $1 and empresa_id = empresa_ativa()`,
      [execucao.id, r.execucaoId, r.conversa.id],
    );
    // O título ou o comentário da tarefa que disparou é de outra pessoa: o que mudar dados pede aprovação (M4-04).
    if (deOutros)
      await c.query(
        "update execucoes_de_agente set leu_texto_de_outros = true where id = $1 and empresa_id = empresa_ativa()",
        [r.execucaoId],
      );
    return async () => o.acordar(empresaId, r.execucaoId);
  }
  // Resultado numa tarefa: uma tarefa nova com o agente como responsável, que trabalha nela em nome do dono.
  const quem = quemPediu(dono.permissoes, dono.pessoaId, "criar");
  if (!quem) throw new FalhaSemVolta("O dono da rotina não pode criar tarefas.");
  const a = await c.query<{ situacao: string; nome: string }>(
    "select situacao, nome from agentes where id = $1 and empresa_id = empresa_ativa()",
    [acao.agenteId],
  );
  if (a.rows[0]?.situacao !== "ativo")
    throw new FalhaSemVolta(`O agente ${a.rows[0]?.nome ?? ""} não está ativo.`);
  await marcarInicio();
  const [ano, mes, dia] = diaNoFuso(agora, ctx.fuso).split("-");
  const tarefa = await criarTarefa(c, quem, {
    titulo: `${rotina.nome} (${dia}/${mes}/${ano})`.slice(0, 200),
    descricao: texto,
    responsavel: { tipo: "agente", agenteId: acao.agenteId },
  });
  await c.query(
    "update execucoes_de_rotina set tarefa_id = $2 where id = $1 and empresa_id = empresa_ativa()",
    [execucao.id, tarefa.id],
  );
  return async () => {
    await auditar(
      o.poolApp,
      {
        empresaId,
        ator: { tipo: "pessoa", pessoaId: dono.pessoaId },
        acao: "tarefa.criou",
        alvo: { tipo: "tarefa", id: tarefa.id },
        origem: SISTEMA,
        detalhes: { rotinaId: rotina.id, responsavel: "agente" },
      },
      o.log,
    );
    const id = await entregarAoAgenteInterno(
      o.poolApp,
      empresaId,
      { tipo: "pessoa", pessoaId: dono.pessoaId },
      tarefa.id,
      o.acordar,
      { leuTextoDeOutros: deOutros },
    );
    const comecou = await comEmpresa(o.poolApp, empresaId, async (c2) => {
      const exec =
        id ??
        (
          await c2.query<{ id: string }>(
            `select id from execucoes_de_agente where empresa_id = empresa_ativa() and tarefa_id = $1
              order by criada_em desc limit 1`,
            [tarefa.id],
          )
        ).rows[0]?.id;
      if (exec)
        await c2.query(
          "update execucoes_de_rotina set execucao_de_agente_id = $2 where id = $1 and empresa_id = empresa_ativa()",
          [execucao.id, exec],
        );
      return !!exec;
    });
    if (!comecou)
      await falhar(o, empresaId, ctx, "O agente não começou a tarefa criada pela rotina.", false, agora);
    await avisarDepois(
      o.poolApp,
      empresaId,
      { tipo: "pessoa", pessoaId: dono.pessoaId },
      { tipo: "criou", tarefa },
      o.log,
    );
  };
}

/** Confere a execução do agente: terminou bem (feita, com o custo), falhou (tenta de novo se ele não mudou nada). */
async function conferirAgente(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  ctx: Contexto,
  execucaoDeAgenteId: string,
  agora: Date,
): Promise<void> {
  const r = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const e = await c.query<{ situacao: string; resumo: string | null }>(
      "select situacao, resumo from execucoes_de_agente where id = $1 and empresa_id = empresa_ativa()",
      [execucaoDeAgenteId],
    );
    const custo = await c.query<{ micros: string }>(
      "select coalesce(sum(custo_micros), 0) as micros from consumo_de_ia where empresa_id = empresa_ativa() and execucao_id = $1",
      [execucaoDeAgenteId],
    );
    const mudou = await c.query(
      `select 1 from passos_de_execucao where empresa_id = empresa_ativa() and execucao_id = $1 and tipo = 'ferramenta'
          and not erro and not (ferramenta = any($2::text[])) limit 1`,
      [execucaoDeAgenteId, [...SO_LEEM]],
    );
    return {
      situacao: e.rows[0]?.situacao ?? "falhou",
      resumo: e.rows[0]?.resumo ?? null,
      custo: Number(custo.rows[0]?.micros ?? 0) / 10_000,
      mudou: (mudou.rowCount ?? 0) > 0,
    };
  });
  if (r.situacao === "na_fila" || r.situacao === "rodando") return;
  if (r.situacao === "concluida") {
    await comEmpresa(o.poolApp, empresaId, (c) => terminar(c, ctx.execucao.id, "feita", { custo: r.custo }));
    return;
  }
  const motivo = `O agente não terminou${r.resumo ? `: ${r.resumo}` : "."}`;
  // Tenta de novo só se o agente falhou sem mudar nada (parado pelos limites ou pelo botão, não).
  await falhar(o, empresaId, ctx, motivo, r.situacao === "falhou" && !r.mudou, agora, r.custo);
}
