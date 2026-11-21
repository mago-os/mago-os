/**
 * Custo de cada chamada ao modelo e tetos de gasto por mês (M4-06, decisão 0028). As funções rodam na transação do
 * chamador, dentro da empresa. O mês segue o fuso da empresa.
 */
import {
  type AoChegarNoLimite,
  custoEmMicros,
  PERCENTUAL_DE_AVISO,
  PRECO_SEM_REFERENCIA,
  type PrecoDeModelo,
  precoDeReferencia,
  type ResumoDeCustos,
  TETO_PADRAO_DA_EMPRESA,
  TETO_PADRAO_DO_AGENTE,
} from "@mago-os/contratos";
import type pg from "pg";
import { criarAviso } from "../avisos/index.ts";

/** Início do mês e do dia de hoje no fuso da empresa (ou de um mês dado, AAAA-MM). */
async function periodo(c: pg.PoolClient, mes: string | null = null) {
  const r = await c.query<{ inicio: Date; fim: Date; hoje: Date; mes: string; fuso: string }>(
    `with f as (select coalesce((select fuso_horario from empresas where id = empresa_ativa()), 'America/Sao_Paulo') as fuso),
          m as (select coalesce(to_date($1, 'YYYY-MM'), date_trunc('month', now() at time zone f.fuso)::date) as dia, f.fuso from f)
     select (m.dia::timestamp at time zone m.fuso) as inicio,
            ((m.dia + interval '1 month')::timestamp at time zone m.fuso) as fim,
            (date_trunc('day', now() at time zone m.fuso) at time zone m.fuso) as hoje,
            to_char(m.dia, 'YYYY-MM') as mes, m.fuso
       from m`,
    [mes],
  );
  return r.rows[0] as { inicio: Date; fim: Date; hoje: Date; mes: string; fuso: string };
}

/** O preço de um modelo: o do administrador, o de referência ou (sem nenhum) o maior da tabela. */
async function precoDoModelo(
  c: pg.PoolClient,
  contaId: string,
  modelo: string,
): Promise<{ preco: PrecoDeModelo; semPreco: boolean }> {
  const r = await c.query<{
    preco_entrada: number | null;
    preco_saida: number | null;
    preco_cache: number | null;
  }>(
    `select preco_entrada, preco_saida, preco_cache from modelos_de_conta_de_ia
      where conta_id = $1 and modelo = $2 and empresa_id = empresa_ativa()`,
    [contaId, modelo],
  );
  const l = r.rows[0];
  if (l && l.preco_entrada !== null && l.preco_saida !== null && l.preco_cache !== null)
    return {
      preco: { entrada: l.preco_entrada, saida: l.preco_saida, cache: l.preco_cache },
      semPreco: false,
    };
  const ref = precoDeReferencia(modelo);
  return ref ? { preco: ref, semPreco: false } : { preco: PRECO_SEM_REFERENCIA, semPreco: true };
}

/** Registra uma chamada ao modelo. Na conta por assinatura, o custo é zero (os tokens contam). */
export async function registrarConsumo(
  c: pg.PoolClient,
  d: {
    execucaoId: string | null;
    agenteId: string;
    contaId: string;
    modelo: string;
    tokens: { entrada: number; saida: number; cache: number };
  },
): Promise<void> {
  const conta = await c.query<{ credencial: string }>(
    "select credencial from contas_de_ia where id = $1 and empresa_id = empresa_ativa()",
    [d.contaId],
  );
  const assinatura = conta.rows[0]?.credencial === "assinatura";
  const { preco, semPreco } = assinatura
    ? { preco: { entrada: 0, saida: 0, cache: 0 }, semPreco: false }
    : await precoDoModelo(c, d.contaId, d.modelo);
  const t = {
    entrada: Math.max(0, Math.round(d.tokens.entrada)),
    saida: Math.max(0, Math.round(d.tokens.saida)),
    cache: Math.max(0, Math.round(d.tokens.cache)),
  };
  await c.query(
    `insert into consumo_de_ia (empresa_id, execucao_id, agente_id, conta_id, modelo, tokens_entrada, tokens_saida,
       tokens_cache, custo_micros, sem_preco)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      d.execucaoId,
      d.agenteId,
      d.contaId,
      d.modelo.slice(0, 120),
      t.entrada,
      t.saida,
      t.cache,
      custoEmMicros(t, preco),
      semPreco,
    ],
  );
}

/** O teto da empresa (agenteId null) ou de um agente: o ajustado, ou o padrão; null = sem teto. */
export async function tetoDe(c: pg.PoolClient, agenteId: string | null): Promise<number | null> {
  const r = await c.query<{ teto: number | null }>(
    "select teto from tetos_de_gasto where empresa_id = empresa_ativa() and agente_id is not distinct from $1",
    [agenteId],
  );
  if (r.rows[0]) return r.rows[0].teto;
  return agenteId ? TETO_PADRAO_DO_AGENTE : TETO_PADRAO_DA_EMPRESA;
}

export async function mudarTeto(
  c: pg.PoolClient,
  agenteId: string | null,
  teto: number | null,
  pessoaId: string,
): Promise<void> {
  await c.query(
    `insert into tetos_de_gasto (empresa_id, agente_id, teto, mudado_por) values (empresa_ativa(), $1, $2, $3)
     on conflict (empresa_id, coalesce(agente_id, '00000000-0000-0000-0000-000000000000'::uuid))
     do update set teto = excluded.teto, mudado_por = excluded.mudado_por, mudado_em = now()`,
    [agenteId, teto, pessoaId],
  );
}

interface Somas {
  custo: number;
  tokens: number;
}

async function somar(
  c: pg.PoolClient,
  desde: Date,
  filtro: { agenteId?: string; contaId?: string } = {},
): Promise<Somas> {
  const r = await c.query<{ custo: string; tokens: string }>(
    `select coalesce(sum(custo_micros), 0) as custo,
            coalesce(sum(tokens_entrada + tokens_saida + tokens_cache), 0) as tokens
       from consumo_de_ia
      where empresa_id = empresa_ativa() and criado_em >= $1
        and ($2::uuid is null or agente_id = $2) and ($3::uuid is null or conta_id = $3)`,
    [desde, filtro.agenteId ?? null, filtro.contaId ?? null],
  );
  return { custo: Number(r.rows[0]?.custo ?? 0), tokens: Number(r.rows[0]?.tokens ?? 0) };
}

/** Centavos → microdólares. */
const micros = (centavos: number) => centavos * 10_000;

export interface SituacaoDaConta {
  /** A conta não pode ser usada neste mês (teto em dólar, ou limite de tokens com "parar"). */
  parada: boolean;
  motivo: string | null;
  nivel: 0 | 80 | 100;
}

async function situacaoDaConta(c: pg.PoolClient, contaId: string, inicio: Date): Promise<SituacaoDaConta> {
  const r = await c.query<{
    nome: string;
    credencial: string;
    teto_mensal: number | null;
    limite_de_tokens: string | null;
    ao_chegar_no_limite: AoChegarNoLimite;
  }>(
    `select nome, credencial, teto_mensal, limite_de_tokens, ao_chegar_no_limite from contas_de_ia
      where id = $1 and empresa_id = empresa_ativa()`,
    [contaId],
  );
  const conta = r.rows[0];
  if (!conta) return { parada: false, motivo: null, nivel: 0 };
  const gasto = await somar(c, inicio, { contaId });
  if (conta.credencial === "assinatura") {
    if (conta.limite_de_tokens === null) return { parada: false, motivo: null, nivel: 0 };
    const limite = Number(conta.limite_de_tokens);
    const p = (gasto.tokens / limite) * 100;
    const nivel = p >= 100 ? 100 : p >= PERCENTUAL_DE_AVISO ? 80 : 0;
    const parada = nivel === 100 && conta.ao_chegar_no_limite === "parar";
    return {
      parada,
      motivo: nivel === 100 ? `a conta "${conta.nome}" chegou ao limite de tokens do mês` : null,
      nivel,
    };
  }
  if (conta.teto_mensal === null) return { parada: false, motivo: null, nivel: 0 };
  const p = conta.teto_mensal === 0 ? 100 : (gasto.custo / micros(conta.teto_mensal)) * 100;
  const nivel = p >= 100 ? 100 : p >= PERCENTUAL_DE_AVISO ? 80 : 0;
  return {
    parada: nivel === 100,
    motivo: nivel === 100 ? `a conta "${conta.nome}" chegou ao teto de gasto do mês` : null,
    nivel,
  };
}

/** Manda o aviso de um teto (uma vez por mês e por nível). */
async function avisarUmaVez(
  c: pg.PoolClient,
  alvo: string,
  mes: string,
  nivel: 80 | 100,
  para: string[],
  texto: string,
): Promise<void> {
  const r = await c.query(
    `insert into avisos_de_gasto (empresa_id, alvo, mes, nivel) values (empresa_ativa(), $1, $2, $3)
     on conflict do nothing`,
    [alvo, mes, nivel],
  );
  if ((r.rowCount ?? 0) === 0) return;
  for (const pessoaId of new Set(para))
    await criarAviso(c, { pessoaId, tipo: "teto_de_gasto", texto, link: "/agentes/custos" });
}

async function administradores(c: pg.PoolClient): Promise<string[]> {
  const r = await c.query<{ pessoa_id: string }>(
    `select pessoa_id from vinculos where empresa_id = empresa_ativa() and perfil = 'administrador'
        and situacao = 'ativo'`,
  );
  return r.rows.map((l) => l.pessoa_id);
}

export type ConferenciaDosTetos = { parar: string } | { parar: null; usarReserva: string | null };

/**
 * Antes de cada execução: os tetos do mês (empresa, agente e a conta do modelo principal), com os avisos de 80% e
 * 100% (uma vez por mês cada). Empresa ou agente no teto: não começa. Só a conta principal parada: segue pelo
 * reserva (se a conta dele não estiver parada também).
 */
export async function conferirTetos(
  c: pg.PoolClient,
  agente: { id: string; nome: string; responsavelId: string },
  contas: { principal: string; reserva: string | null },
): Promise<ConferenciaDosTetos> {
  const { inicio, mes } = await periodo(c);
  const admins = await administradores(c);
  const usd = (centavos: number) => `US$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

  const tetoEmpresa = await tetoDe(c, null);
  let parar: string | null = null;
  if (tetoEmpresa !== null) {
    const gasto = (await somar(c, inicio)).custo;
    const p = tetoEmpresa === 0 ? 100 : (gasto / micros(tetoEmpresa)) * 100;
    if (p >= PERCENTUAL_DE_AVISO)
      await avisarUmaVez(
        c,
        "empresa",
        mes,
        p >= 100 ? 100 : 80,
        admins,
        p >= 100
          ? `A empresa chegou ao teto de gasto com IA do mês (${usd(tetoEmpresa)}). Os agentes internos param até o teto subir ou o mês virar.`
          : `A empresa passou de ${PERCENTUAL_DE_AVISO}% do teto de gasto com IA do mês (${usd(tetoEmpresa)}).`,
      );
    if (p >= 100) parar = `a empresa chegou ao teto de gasto com IA do mês (${usd(tetoEmpresa)})`;
  }
  const tetoAgente = await tetoDe(c, agente.id);
  if (tetoAgente !== null) {
    const gasto = (await somar(c, inicio, { agenteId: agente.id })).custo;
    const p = tetoAgente === 0 ? 100 : (gasto / micros(tetoAgente)) * 100;
    if (p >= PERCENTUAL_DE_AVISO)
      await avisarUmaVez(
        c,
        `agente:${agente.id}`,
        mes,
        p >= 100 ? 100 : 80,
        [agente.responsavelId],
        p >= 100
          ? `${agente.nome} chegou ao teto de gasto do mês (${usd(tetoAgente)}) e parou.`
          : `${agente.nome} passou de ${PERCENTUAL_DE_AVISO}% do teto de gasto do mês (${usd(tetoAgente)}).`,
      );
    if (p >= 100 && !parar) parar = `${agente.nome} chegou ao teto de gasto do mês (${usd(tetoAgente)})`;
  }

  const avisarConta = async (contaId: string, s: SituacaoDaConta) => {
    if (s.nivel === 0) return;
    const nome = (
      await c.query<{ nome: string }>(
        "select nome from contas_de_ia where id = $1 and empresa_id = empresa_ativa()",
        [contaId],
      )
    ).rows[0]?.nome;
    await avisarUmaVez(
      c,
      `conta:${contaId}`,
      mes,
      s.nivel,
      admins,
      s.nivel === 100
        ? `A conta de IA "${nome}" chegou ao limite do mês${s.parada ? " e deixou de ser usada pelos agentes" : ""}.`
        : `A conta de IA "${nome}" passou de ${PERCENTUAL_DE_AVISO}% do limite do mês.`,
    );
  };
  const principal = await situacaoDaConta(c, contas.principal, inicio);
  await avisarConta(contas.principal, principal);
  if (parar) return { parar };
  if (!principal.parada) return { parar: null, usarReserva: null };
  if (contas.reserva) {
    const reserva = await situacaoDaConta(c, contas.reserva, inicio);
    await avisarConta(contas.reserva, reserva);
    if (!reserva.parada) return { parar: null, usarReserva: principal.motivo };
  }
  return { parar: principal.motivo ?? "a conta de IA chegou ao limite do mês" };
}

/** O painel de um mês (AAAA-MM; sem mês, o atual). */
export async function resumoDeCustos(c: pg.PoolClient, mes: string | null): Promise<ResumoDeCustos> {
  const p = await periodo(c, mes);
  const somaEntre = async (de: Date, ate: Date, extra = "", valores: unknown[] = []) => {
    const r = await c.query<{ custo: string; tokens: string }>(
      `select coalesce(sum(custo_micros), 0) as custo, coalesce(sum(tokens_entrada + tokens_saida + tokens_cache), 0) as tokens
         from consumo_de_ia where empresa_id = empresa_ativa() and criado_em >= $1 and criado_em < $2 ${extra}`,
      [de, ate, ...valores],
    );
    return { custo: Number(r.rows[0]?.custo ?? 0), tokens: Number(r.rows[0]?.tokens ?? 0) };
  };
  const hojeAte = new Date(p.hoje.getTime() + 86_400_000);
  const ehMesAtual = p.hoje >= p.inicio && p.hoje < p.fim;
  const agentes = await c.query<{ id: string; nome: string }>(
    `select id, nome from agentes where empresa_id = empresa_ativa() and tipo = 'interno'
        and (situacao <> 'desligado' or exists (select 1 from consumo_de_ia k where k.agente_id = agentes.id
               and k.criado_em >= $1 and k.criado_em < $2))
      order by nome`,
    [p.inicio, p.fim],
  );
  const contas = await c.query<{
    id: string;
    nome: string;
    credencial: "chave_de_api" | "assinatura";
    teto_mensal: number | null;
    limite_de_tokens: string | null;
    ao_chegar_no_limite: AoChegarNoLimite;
  }>(
    `select id, nome, credencial, teto_mensal, limite_de_tokens, ao_chegar_no_limite from contas_de_ia
      where empresa_id = empresa_ativa() order by nome`,
  );
  const dias = await c.query<{ dia: string; custo: string }>(
    `select to_char(criado_em at time zone $3, 'YYYY-MM-DD') as dia, sum(custo_micros) as custo
       from consumo_de_ia where empresa_id = empresa_ativa() and criado_em >= $1 and criado_em < $2
      group by 1 order by 1`,
    [p.inicio, p.fim, p.fuso],
  );
  const semPreco = await c.query<{ conta_id: string; modelo: string }>(
    `select distinct conta_id, modelo from consumo_de_ia
      where empresa_id = empresa_ativa() and sem_preco and conta_id is not null and criado_em >= $1 and criado_em < $2`,
    [p.inicio, p.fim],
  );
  const vazio = { custo: 0, tokens: 0 };
  return {
    mes: p.mes,
    total: await somaEntre(p.inicio, p.fim),
    hoje: ehMesAtual ? await somaEntre(p.hoje, hojeAte) : vazio,
    tetoDaEmpresa: await tetoDe(c, null),
    porAgente: await Promise.all(
      agentes.rows.map(async (a) => ({
        agenteId: a.id,
        nome: a.nome,
        teto: await tetoDe(c, a.id),
        mes: await somaEntre(p.inicio, p.fim, "and agente_id = $3", [a.id]),
        hoje: ehMesAtual ? await somaEntre(p.hoje, hojeAte, "and agente_id = $3", [a.id]) : vazio,
      })),
    ),
    porConta: await Promise.all(
      contas.rows.map(async (k) => ({
        contaId: k.id,
        nome: k.nome,
        credencial: k.credencial,
        teto: k.teto_mensal,
        avisoDeTokens: k.limite_de_tokens === null ? null : Number(k.limite_de_tokens),
        aoChegar: k.ao_chegar_no_limite,
        mes: await somaEntre(p.inicio, p.fim, "and conta_id = $3", [k.id]),
      })),
    ),
    porDia: dias.rows.map((d) => ({ dia: d.dia, custo: Number(d.custo) })),
    semPreco: semPreco.rows.map((l) => ({ contaId: l.conta_id, modelo: l.modelo })),
  };
}

/** O limite em tokens de uma conta por assinatura. Conta por chave de API: false. */
export async function mudarLimiteDeTokens(
  c: pg.PoolClient,
  contaId: string,
  tokens: number | null,
  aoChegar: AoChegarNoLimite,
): Promise<boolean> {
  const r = await c.query(
    `update contas_de_ia set limite_de_tokens = $2, ao_chegar_no_limite = $3
      where id = $1 and empresa_id = empresa_ativa() and credencial = 'assinatura'`,
    [contaId, tokens, aoChegar],
  );
  return (r.rowCount ?? 0) > 0;
}

/** O preço que o administrador dá a um modelo de uma conta (null volta para a referência). */
export async function mudarPrecoDoModelo(
  c: pg.PoolClient,
  contaId: string,
  modelo: string,
  preco: PrecoDeModelo | null,
): Promise<boolean> {
  const r = await c.query(
    `update modelos_de_conta_de_ia set preco_entrada = $3, preco_saida = $4, preco_cache = $5
      where conta_id = $1 and modelo = $2 and empresa_id = empresa_ativa()`,
    [contaId, modelo, preco?.entrada ?? null, preco?.saida ?? null, preco?.cache ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}
