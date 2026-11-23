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
import { preferenciasDe } from "../avisos/notificacoes.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { planejar, recusaDoPlanejamento } from "../tarefas/planejamento.ts";
import { buscarTarefa, criarTarefa } from "../tarefas/servico.ts";
import { diaNoFuso, ultimaEProxima } from "./horarios.ts";
import { buscarRotina, COLUNAS_DA_EXECUCAO, paraExecucao, recusaDaAcao } from "./servico.ts";

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
  // 1. As que chegaram na hora viram execução (uma verificação por vez por empresa).
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
        where empresa_id = empresa_ativa() and situacao = 'ligada' and proxima_em <= $1
        order by proxima_em limit 100 for update skip locked`,
      [agora],
    );
    for (const v of vencidas.rows) {
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
  // 2. As execuções a cuidar.
  const ids = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{ id: string }>(
      `select id from execucoes_de_rotina
        where empresa_id = empresa_ativa()
          and (situacao = 'na_fila'
               or (situacao = 'esperando' and (proxima_tentativa_em is null or proxima_tentativa_em <= $1))
               or (situacao = 'rodando' and execucao_de_agente_id is not null))
        order by criada_em limit 50`,
      [agora],
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

interface Contexto {
  execucao: ReturnType<typeof paraExecucao>;
  rotina: Rotina;
  dono: { nome: string; perfil: Perfil; ativo: boolean };
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
  const d = await c.query<{ nome: string; perfil: Perfil; situacao: string }>(
    `select p.nome, v.perfil, v.situacao from vinculos v join pessoas p on p.id = v.pessoa_id
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
  };
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
export async function cuidarDaExecucao(
  o: OpcoesDoMotorDasRotinas,
  empresaId: string,
  execucaoId: string,
  agora = new Date(),
): Promise<void> {
  const ctx = await comEmpresa(o.poolApp, empresaId, (c) => carregar(c, execucaoId));
  if (!ctx) return;
  const { execucao, rotina } = ctx;
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
  // Antes de rodar: a rotina ainda ligada (pelo horário), o limite do dia, a anterior terminada, o dono ativo.
  const pulo = await comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtextextended('rotina:' || $1, 0))", [rotina.id]);
    if (execucao.origem === "horario" && rotina.situacao === "desligada" && execucao.tentativa === 1)
      return "A rotina foi desligada antes de rodar.";
    const hoje = diaNoFuso(agora, rotina.gatilho.fuso);
    const n = await c.query<{ n: number; rodando: number }>(
      `select count(*) filter (where (iniciada_em at time zone $3)::date = $2::date)::int as n,
              count(*) filter (where situacao = 'rodando')::int as rodando
         from execucoes_de_rotina
        where empresa_id = empresa_ativa() and rotina_id = $1 and id <> $4 and iniciada_em is not null`,
      [rotina.id, hoje, rotina.gatilho.fuso, execucao.id],
    );
    if (execucao.iniciadaEm === null && (n.rows[0]?.n ?? 0) >= MAXIMO_DE_EXECUCOES_POR_DIA)
      return `Passou do limite de ${MAXIMO_DE_EXECUCOES_POR_DIA} vezes por dia.`;
    if ((n.rows[0]?.rodando ?? 0) > 0) return "A vez anterior ainda estava rodando.";
    if (!ctx.dono.ativo) return "O dono da rotina não está mais ativo na empresa.";
    return null;
  });
  if (pulo) {
    await comEmpresa(o.poolApp, empresaId, (c) => terminar(c, execucao.id, "pulada", { motivo: pulo }));
    return;
  }
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
      const marcarInicio = () =>
        c.query(
          `update execucoes_de_rotina set situacao = 'rodando', iniciada_em = coalesce(iniciada_em, now()),
                  proxima_tentativa_em = null where id = $1 and empresa_id = empresa_ativa()`,
          [execucao.id],
        );
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
function prazoDaRotina(rotina: Rotina, emDias: number, hora: string | null | undefined, agora: Date) {
  const fuso = rotina.gatilho.fuso;
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
    ...(acao.prazo ? { prazo: prazoDaRotina(ctx.rotina, acao.prazo.emDias, acao.prazo.hora, agora) } : {}),
    ...(acao.prioridade ? { prioridade: acao.prioridade } : {}),
  };
  const recusa = await recusaDoPlanejamento(c, null, plano);
  if (recusa) throw new FalhaSemVolta(recusa);
  let tarefa = await criarTarefa(c, quem, {
    titulo: acao.titulo,
    descricao: acao.descricao ?? null,
    responsavel: acao.responsavel ?? { tipo: "pessoa", pessoaId: dono.pessoaId },
    projetoId: acao.projetoId ?? null,
  });
  if (Object.keys(plano).length > 0) {
    await planejar(c, tarefa, plano, ctx.rotina.gatilho.fuso);
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
  const texto = `${acao.texto} (rotina "${ctx.rotina.nome}", de ${ctx.dono.nome})`.slice(0, 500);
  let avisados = 0;
  for (const pessoaId of acao.para) {
    const canais = canaisDoTipo(await preferenciasDe(c, pessoaId), "aviso_de_rotina");
    if (!canais.tela && !canais.push && !canais.telegram) continue;
    const r = await c.query(
      `insert into avisos (empresa_id, pessoa_id, tipo, texto, link, push_pendente, lido_em, telegram_pendente)
       select empresa_ativa(), $1, 'aviso_de_rotina', $2, $3, $4, case when $5 then null else now() end, $6
        where exists (select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo')`,
      [pessoaId, texto, acao.link ?? "/", canais.push, canais.tela, canais.telegram],
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
        where empresa_id = empresa_ativa() and rotina_id = $1 and criada_em >= date_trunc('month', $2::timestamptz)`,
      [rotina.id, agora],
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
  const texto = acao.skill ? `${acao.pedido}\n\nUse a skill ${acao.skill}.` : acao.pedido;
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
  const [ano, mes, dia] = diaNoFuso(agora, rotina.gatilho.fuso).split("-");
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
