/**
 * Rotinas (M5-05, decisão 0039): criar, ver, editar, ligar, desligar e apagar, e a conferência da ação com a
 * permissão do dono. O que roda no horário está em motor.ts.
 *
 * Quem pode o quê: só o dono faz a rotina agir (editar, ligar e "Rodar agora"). Quem vê a rotina pelo alcance de
 * "rotinas.ver" a vê; quem tem "rotinas.editar" com alcance "tudo" (o administrador) desliga qualquer uma; quem tem
 * "rotinas.excluir" no alcance dela apaga.
 */
import {
  type AcaoDaRotina,
  type ExecucaoDeRotina,
  type GatilhoDaRotina,
  MAXIMO_DE_ROTINAS_POR_PESSOA,
  type MotivoDeDesligar,
  type PedidoDeEdicaoDeRotina,
  type PedidoDeRotina,
  type Rotina,
  type SituacaoDaExecucaoDeRotina,
} from "@mago-os/contratos";
import type pg from "pg";
import { podeFalarComEspecialista } from "../agentes-internos/mensagem-da-pessoa.ts";
import { skillsDoAgente } from "../instrucoes/servico.ts";
import type { Filtro } from "../permissoes/calcular.ts";
import type { PermissoesNaEmpresa } from "../permissoes/verificar.ts";
import { proximaVez } from "./horarios.ts";

export class RecusaDaRotina extends Error {}

interface LinhaDaRotina {
  id: string;
  empresa_id: string;
  dono_pessoa_id: string;
  criada_por_agente_id: string | null;
  nome: string;
  gatilho: GatilhoDaRotina;
  acao: AcaoDaRotina;
  situacao: "ligada" | "desligada";
  desligada_porque: MotivoDeDesligar | null;
  teto_mensal: number | null;
  proxima_em: Date | null;
  vezes: number;
  criada_em: Date;
  atualizada_em: Date;
}

const COLUNAS =
  "r.id, r.empresa_id, r.dono_pessoa_id, r.criada_por_agente_id, r.nome, r.gatilho, r.acao, r.situacao, r.desligada_porque, r.teto_mensal, r.proxima_em, r.vezes, r.criada_em, r.atualizada_em";

export const paraRotina = (l: LinhaDaRotina): Rotina => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  donoPessoaId: l.dono_pessoa_id,
  criadaPorAgenteId: l.criada_por_agente_id,
  gatilho: l.gatilho,
  acao: l.acao,
  situacao: l.situacao,
  desligadaPorque: l.desligada_porque,
  tetoMensal: l.teto_mensal,
  proximaEm: l.proxima_em ? l.proxima_em.toISOString() : null,
  vezes: l.vezes,
  criadaEm: l.criada_em.toISOString(),
  atualizadaEm: l.atualizada_em.toISOString(),
});

interface LinhaDaExecucao {
  id: string;
  empresa_id: string;
  rotina_id: string;
  origem: "horario" | "rodar_agora";
  prevista_para: Date | null;
  situacao: SituacaoDaExecucaoDeRotina;
  tentativa: number;
  proxima_tentativa_em: Date | null;
  motivo: string | null;
  tarefa_id: string | null;
  execucao_de_agente_id: string | null;
  conversa_id: string | null;
  avisados: number;
  custo: string;
  criada_em: Date;
  iniciada_em: Date | null;
  terminada_em: Date | null;
}

export const COLUNAS_DA_EXECUCAO =
  "id, empresa_id, rotina_id, origem, prevista_para, situacao, tentativa, proxima_tentativa_em, motivo, tarefa_id, execucao_de_agente_id, conversa_id, avisados, custo, criada_em, iniciada_em, terminada_em";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const paraExecucao = (l: LinhaDaExecucao): ExecucaoDeRotina => ({
  id: l.id,
  empresaId: l.empresa_id,
  rotinaId: l.rotina_id,
  origem: l.origem,
  previstaPara: iso(l.prevista_para),
  situacao: l.situacao,
  tentativa: l.tentativa,
  proximaTentativaEm: iso(l.proxima_tentativa_em),
  motivo: l.motivo,
  tarefaId: l.tarefa_id,
  execucaoDeAgenteId: l.execucao_de_agente_id,
  conversaId: l.conversa_id,
  avisados: l.avisados,
  custo: Number(l.custo),
  criadaEm: l.criada_em.toISOString(),
  iniciadaEm: iso(l.iniciada_em),
  terminadaEm: iso(l.terminada_em),
});

/** A condição do alcance de "rotinas" sobre o dono (r.dono_pessoa_id), com os parâmetros a partir de "n". */
function condicao(filtro: Filtro, n: number): { sql: string; params: unknown[] } {
  if (filtro.tipo === "tudo") return { sql: "true", params: [] };
  if (filtro.tipo === "equipe")
    return {
      sql: `(r.dono_pessoa_id = $${n} or exists (select 1 from vinculos v where v.empresa_id = r.empresa_id
              and v.pessoa_id = r.dono_pessoa_id and v.area = $${n + 1}))`,
      params: [filtro.pessoaId, filtro.area],
    };
  return { sql: `r.dono_pessoa_id = $${n}`, params: [filtro.pessoaId] };
}

/** As rotinas que o filtro alcança, as mais novas primeiro, e os nomes dos donos e agentes citados. */
export async function listarRotinas(
  c: pg.PoolClient,
  filtro: Filtro,
): Promise<{ rotinas: Rotina[]; nomes: Record<string, string> }> {
  const w = condicao(filtro, 1);
  const r = await c.query<LinhaDaRotina>(
    `select ${COLUNAS} from rotinas r where r.empresa_id = empresa_ativa() and ${w.sql}
      order by r.criada_em desc limit 500`,
    w.params,
  );
  const rotinas = r.rows.map(paraRotina);
  return { rotinas, nomes: await nomesDasRotinas(c, rotinas) };
}

/** Os nomes das pessoas e dos agentes citados nas rotinas (dono, agente que criou, agente e responsável da ação). */
export async function nomesDasRotinas(c: pg.PoolClient, rotinas: Rotina[]): Promise<Record<string, string>> {
  const ids = new Set<string>();
  for (const r of rotinas) {
    ids.add(r.donoPessoaId);
    if (r.criadaPorAgenteId) ids.add(r.criadaPorAgenteId);
    if (r.acao.tipo === "pedir_ao_agente") ids.add(r.acao.agenteId);
    if (r.acao.tipo === "criar_tarefa" && r.acao.responsavel)
      ids.add(
        r.acao.responsavel.tipo === "pessoa" ? r.acao.responsavel.pessoaId : r.acao.responsavel.agenteId,
      );
    if (r.acao.tipo === "mandar_aviso") for (const p of r.acao.para) ids.add(p);
  }
  if (ids.size === 0) return {};
  const n = await c.query<{ id: string; nome: string }>(
    `select p.id, p.nome from pessoas p join vinculos v on v.pessoa_id = p.id and v.empresa_id = empresa_ativa()
      where p.id = any($1::uuid[])
     union all
     select a.id, a.nome from agentes a where a.empresa_id = empresa_ativa() and a.id = any($1::uuid[])`,
    [[...ids]],
  );
  return Object.fromEntries(n.rows.map((x) => [x.id, x.nome]));
}

export async function buscarRotina(
  c: pg.PoolClient,
  filtro: Filtro,
  id: string,
  paraMudar = false,
): Promise<Rotina | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const w = condicao(filtro, 2);
  const r = await c.query<LinhaDaRotina>(
    `select ${COLUNAS} from rotinas r where r.id = $1 and r.empresa_id = empresa_ativa() and ${w.sql}
     ${paraMudar ? "for update" : ""}`,
    [id, ...w.params],
  );
  return r.rows[0] ? paraRotina(r.rows[0]) : null;
}

/** As execuções da rotina nos últimos 90 dias (as mais novas primeiro, até 100). */
export async function listarExecucoes(
  c: pg.PoolClient,
  rotinaId: string,
  limite = 100,
): Promise<ExecucaoDeRotina[]> {
  const r = await c.query<LinhaDaExecucao>(
    `select ${COLUNAS_DA_EXECUCAO} from execucoes_de_rotina
      where empresa_id = empresa_ativa() and rotina_id = $1 and criada_em > now() - interval '90 days'
      order by criada_em desc limit $2`,
    [rotinaId, limite],
  );
  return r.rows.map(paraExecucao);
}

/** O fuso existe de verdade (o contrato só confere o formato). */
function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** O alcance de um módulo para o dono. */
const alcance = (p: PermissoesNaEmpresa, modulo: string, acao: "ver" | "criar") =>
  p.modulos.get(modulo)?.acoes[acao] ?? "nada";

/**
 * Confere a ação com a permissão do dono: na criação, na edição e de novo a cada vez que roda (ele pode ter perdido
 * uma permissão). Devolve o motivo da recusa, ou nulo.
 */
export async function recusaDaAcao(
  c: pg.PoolClient,
  dono: { pessoaId: string; permissoes: PermissoesNaEmpresa },
  acao: AcaoDaRotina,
): Promise<string | null> {
  const { pessoaId, permissoes } = dono;
  switch (acao.tipo) {
    case "criar_tarefa": {
      if (alcance(permissoes, "tarefas", "criar") === "nada")
        return "O dono da rotina não pode criar tarefas.";
      const r = acao.responsavel;
      if (r?.tipo === "pessoa") {
        const ativo = await c.query(
          "select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo'",
          [r.pessoaId],
        );
        if (!ativo.rowCount) return "A pessoa responsável não está ativa nesta empresa.";
      } else if (r?.tipo === "agente") {
        const ativo = await c.query(
          "select 1 from agentes where empresa_id = empresa_ativa() and id = $1 and situacao <> 'desligado'",
          [r.agenteId],
        );
        if (!ativo.rowCount) return "O agente responsável não existe mais nesta empresa.";
      }
      if (acao.projetoId) {
        const verTodos = alcance(permissoes, "projetos", "ver") === "tudo";
        const p = await c.query(
          `select 1 from projetos p where p.id = $1 and p.empresa_id = empresa_ativa() and p.situacao = 'ativo'
              and ($2::boolean or membro_do_projeto(p.id, $3))`,
          [acao.projetoId, verTodos, pessoaId],
        );
        if (!p.rowCount) return "O projeto não existe mais ou está fora do alcance do dono da rotina.";
      }
      return null;
    }
    case "pedir_ao_agente": {
      const a = await c.query<{ papel: string; situacao: string }>(
        "select papel, situacao from agentes where empresa_id = empresa_ativa() and id = $1 and tipo = 'interno'",
        [acao.agenteId],
      );
      const agente = a.rows[0];
      if (!agente || agente.situacao === "desligado") return "O agente não existe mais nesta empresa.";
      if (agente.papel === "especialista") {
        const perfil = await c.query<{ perfil: string }>(
          "select perfil from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1",
          [pessoaId],
        );
        if (!podeFalarComEspecialista((perfil.rows[0]?.perfil ?? "funcionario") as never))
          return "Só administrador e gestor pedem direto a um especialista; escolha o coordenador.";
      }
      if (acao.skill) {
        const skills = await skillsDoAgente(c, acao.agenteId);
        if (!skills.some((s) => s.id === acao.skill)) return "Essa skill não é uma das skills do agente.";
      }
      return null;
    }
    case "mandar_aviso": {
      // Só para quem o dono pode ver em Pessoas: o funcionário avisa a si mesmo, o gestor a equipe, o administrador
      // qualquer pessoa ativa da empresa.
      const ver = alcance(permissoes, "pessoas", "ver");
      const r = await c.query<{ pessoa_id: string }>(
        `select v.pessoa_id from vinculos v where v.empresa_id = empresa_ativa() and v.situacao = 'ativo'
            and v.pessoa_id = any($1::uuid[])
            and ($2 = 'tudo' or v.pessoa_id = $3 or ($2 = 'equipe' and v.area is not distinct from $4::text and $4 is not null))`,
        [acao.para, ver, pessoaId, permissoes.area],
      );
      if (r.rows.length !== acao.para.length)
        return "O aviso só vai para pessoas ativas que o dono da rotina pode ver em Pessoas.";
      return null;
    }
  }
}

function conferirGatilho(g: GatilhoDaRotina): void {
  if (!fusoValido(g.fuso)) throw new RecusaDaRotina("Fuso horário desconhecido.");
}

/** Cria a rotina, desligada (decisão 10), em nome do dono. */
export async function criarRotina(
  c: pg.PoolClient,
  dono: { pessoaId: string; permissoes: PermissoesNaEmpresa },
  pedido: PedidoDeRotina,
  criadaPorAgenteId: string | null = null,
): Promise<Rotina> {
  conferirGatilho(pedido.gatilho);
  await c.query("select pg_advisory_xact_lock(hashtextextended('rotinas-de:' || $1, 0))", [dono.pessoaId]);
  const n = await c.query<{ n: number }>(
    "select count(*)::int as n from rotinas where empresa_id = empresa_ativa() and dono_pessoa_id = $1",
    [dono.pessoaId],
  );
  if ((n.rows[0]?.n ?? 0) >= MAXIMO_DE_ROTINAS_POR_PESSOA)
    throw new RecusaDaRotina(
      `Cada pessoa tem até ${MAXIMO_DE_ROTINAS_POR_PESSOA} rotinas. Apague uma antes.`,
    );
  const recusa = await recusaDaAcao(c, dono, pedido.acao);
  if (recusa) throw new RecusaDaRotina(recusa);
  const r = await c.query<LinhaDaRotina>(
    `insert into rotinas as r (empresa_id, dono_pessoa_id, criada_por_agente_id, nome, gatilho, acao, teto_mensal)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6) returning ${COLUNAS}`,
    [
      dono.pessoaId,
      criadaPorAgenteId,
      pedido.nome.trim(),
      JSON.stringify(pedido.gatilho),
      JSON.stringify(pedido.acao),
      pedido.tetoMensal ?? null,
    ],
  );
  return paraRotina(r.rows[0] as LinhaDaRotina);
}

/** Edita (só o dono, conferido por quem chama). Ligada com gatilho novo: a próxima vez é contada de novo. */
export async function editarRotina(
  c: pg.PoolClient,
  rotina: Rotina,
  dono: { pessoaId: string; permissoes: PermissoesNaEmpresa },
  pedido: PedidoDeEdicaoDeRotina,
  agora = new Date(),
): Promise<Rotina> {
  if (pedido.gatilho) conferirGatilho(pedido.gatilho);
  if (pedido.acao) {
    const recusa = await recusaDaAcao(c, dono, pedido.acao);
    if (recusa) throw new RecusaDaRotina(recusa);
  }
  const gatilho = pedido.gatilho ?? rotina.gatilho;
  let proxima = rotina.proximaEm;
  let situacao = rotina.situacao;
  let porque = rotina.desligadaPorque;
  if (pedido.gatilho && rotina.situacao === "ligada") {
    const p = proximaVez(gatilho, agora, rotina.vezes);
    proxima = p ? p.toISOString() : null;
    if (!p) {
      situacao = "desligada";
      porque = "terminou";
    }
  }
  const r = await c.query<LinhaDaRotina>(
    `update rotinas r set nome = $2, gatilho = $3, acao = $4, teto_mensal = $5, proxima_em = $6, situacao = $7,
            desligada_porque = $8, atualizada_em = now()
      where r.id = $1 and r.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [
      rotina.id,
      (pedido.nome ?? rotina.nome).trim(),
      JSON.stringify(gatilho),
      JSON.stringify(pedido.acao ?? rotina.acao),
      pedido.tetoMensal === undefined ? rotina.tetoMensal : pedido.tetoMensal,
      proxima,
      situacao,
      porque,
    ],
  );
  return paraRotina(r.rows[0] as LinhaDaRotina);
}

/** Liga (só o dono): confere a ação de novo e marca a próxima vez. */
export async function ligarRotina(
  c: pg.PoolClient,
  rotina: Rotina,
  dono: { pessoaId: string; permissoes: PermissoesNaEmpresa },
  agora = new Date(),
): Promise<Rotina> {
  if (rotina.situacao === "ligada") return rotina;
  const recusa = await recusaDaAcao(c, dono, rotina.acao);
  if (recusa) throw new RecusaDaRotina(recusa);
  const proxima = proximaVez(rotina.gatilho, agora, rotina.vezes);
  if (!proxima)
    throw new RecusaDaRotina(
      "Os horários dessa rotina já acabaram (data final ou número de vezes). Mude o quando.",
    );
  const r = await c.query<LinhaDaRotina>(
    `update rotinas r set situacao = 'ligada', desligada_porque = null, proxima_em = $2, atualizada_em = now()
      where r.id = $1 and r.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [rotina.id, proxima],
  );
  return paraRotina(r.rows[0] as LinhaDaRotina);
}

export async function desligarRotina(
  c: pg.PoolClient,
  rotina: Rotina,
  motivo: MotivoDeDesligar,
): Promise<Rotina> {
  if (rotina.situacao === "desligada") return rotina;
  const r = await c.query<LinhaDaRotina>(
    `update rotinas r set situacao = 'desligada', desligada_porque = $2, proxima_em = null, atualizada_em = now()
      where r.id = $1 and r.empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [rotina.id, motivo],
  );
  return paraRotina(r.rows[0] as LinhaDaRotina);
}

export async function apagarRotina(c: pg.PoolClient, rotinaId: string): Promise<void> {
  await c.query("delete from rotinas where id = $1 and empresa_id = empresa_ativa()", [rotinaId]);
}

/** Põe na fila uma execução do "Rodar agora" (o limite do dia é conferido ao rodar). */
export async function pedirParaRodarAgora(c: pg.PoolClient, rotinaId: string): Promise<ExecucaoDeRotina> {
  const r = await c.query<LinhaDaExecucao>(
    `insert into execucoes_de_rotina (empresa_id, rotina_id, origem) values (empresa_ativa(), $1, 'rodar_agora')
     returning ${COLUNAS_DA_EXECUCAO}`,
    [rotinaId],
  );
  return paraExecucao(r.rows[0] as LinhaDaExecucao);
}
