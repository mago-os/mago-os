/**
 * Chave do agente e agente vivo (M2-04). Ver docs/decisoes/0017-chave-do-agente.md.
 *
 * - gerarChave: a chave inteira (mostrada uma vez), o começo e o resumo SHA-256 (o que fica no banco).
 * - autenticarAgente: confere a chave a cada pedido (sem cache: revogar vale no pedido seguinte), aplica o limite de
 *   pedidos por minuto e registra o sinal de vida. Toda recusa vira chave.recusou na auditoria, sem a chave.
 * - contarLeituras: o limite de registros lidos por hora, para o MCP (M2-05).
 * - verificarAgentesVivos: a cada minuto, devolve para A fazer as tarefas de agentes sem sinal.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type ChaveDeAgente,
  FORMATO_DA_CHAVE,
  LIMITES_DO_AGENTE,
  type MotivoDeRecusa,
} from "@mago-os/contratos";
import type pg from "pg";
import type { Carteiro } from "../acesso/login.ts";
import type { ServicosDosAnexos } from "../anexos/servico.ts";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { avisarResponsavel } from "../avisos/index.ts";
import { comEmpresa } from "../empresa.ts";
import { devolverTarefasPegadas } from "./servico.ts";

const LETRAS = "0123456789abcdefghijklmnopqrstuvwxyz";

export function resumoDaChave(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

/** Gera uma chave nova: 10 caracteres de identificação e 32 bytes aleatórios de segredo. */
export function gerarChave(): { chave: string; prefixo: string; resumo: string } {
  const bytes = randomBytes(10);
  const id = [...bytes].map((b) => LETRAS[b % LETRAS.length]).join("");
  const prefixo = `mago_ag_${id}`;
  const chave = `${prefixo}_${randomBytes(32).toString("base64url")}`;
  return { chave, prefixo, resumo: resumoDaChave(chave) };
}

interface LinhaDaChave {
  id: string;
  empresa_id: string;
  agente_id: string;
  nome: string;
  prefixo: string;
  criada_por: string;
  criada_em: Date;
  valida_ate: Date | null;
  ultimo_uso_em: Date | null;
  revogada_em: Date | null;
  revogada_por: string | null;
}

const COLUNAS = `id, empresa_id, agente_id, nome, prefixo, criada_por, criada_em, valida_ate, ultimo_uso_em,
  revogada_em, revogada_por`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function linhaParaChave(l: LinhaDaChave): ChaveDeAgente {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    agenteId: l.agente_id,
    nome: l.nome,
    prefixo: l.prefixo,
    criadaPor: l.criada_por,
    criadaEm: l.criada_em.toISOString(),
    validaAte: iso(l.valida_ate),
    ultimoUsoEm: iso(l.ultimo_uso_em),
    revogadaEm: iso(l.revogada_em),
    revogadaPor: l.revogada_por,
  };
}

export async function listarChaves(c: pg.PoolClient, agenteId: string): Promise<ChaveDeAgente[]> {
  const r = await c.query<LinhaDaChave>(
    `select ${COLUNAS} from chaves_de_agente where empresa_id = empresa_ativa() and agente_id = $1
      order by (revogada_em is not null), criada_em desc`,
    [agenteId],
  );
  return r.rows.map(linhaParaChave);
}

export async function criarChave(
  c: pg.PoolClient,
  d: { agenteId: string; nome: string; validaAte: string | null; criadaPor: string },
): Promise<{ chave: ChaveDeAgente; segredo: string }> {
  const nova = gerarChave();
  const r = await c.query<LinhaDaChave>(
    `insert into chaves_de_agente (empresa_id, agente_id, nome, prefixo, resumo, criada_por, valida_ate)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6) returning ${COLUNAS}`,
    [d.agenteId, d.nome.trim(), nova.prefixo, nova.resumo, d.criadaPor, d.validaAte],
  );
  return { chave: linhaParaChave(r.rows[0] as LinhaDaChave), segredo: nova.chave };
}

export async function revogarChave(
  c: pg.PoolClient,
  agenteId: string,
  chaveId: string,
  quem: string,
): Promise<ChaveDeAgente | null> {
  if (!/^[0-9a-f-]{36}$/i.test(chaveId)) return null;
  const r = await c.query<LinhaDaChave>(
    `update chaves_de_agente set revogada_em = now(), revogada_por = $3
      where id = $1 and agente_id = $2 and empresa_id = empresa_ativa() and revogada_em is null
      returning ${COLUNAS}`,
    [chaveId, agenteId, quem],
  );
  return r.rows[0] ? linhaParaChave(r.rows[0]) : null;
}

/** Quem está pedindo pelo MCP, depois de a chave passar. */
export interface AgenteDoPedido {
  empresaId: string;
  agenteId: string;
  chaveId: string;
}

export type ResultadoDaChave =
  | { ok: true; agente: AgenteDoPedido }
  | { ok: false; motivo: MotivoDeRecusa; status: 401 | 403 | 429 };

export interface OpcoesDaChave {
  poolApp: pg.Pool;
  carteiro: Carteiro;
  urlPublica: string;
  log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  origem: DadosDoEvento["origem"];
  rastreio?: string | null;
  /** Limites (os testes usam valores pequenos). */
  limites?: { pedidosPorMinuto: number; leiturasPorHora: number };
  /** Anexos (M3-08), para o MCP: nulo quando estão desligados. */
  anexos?: ServicosDosAnexos | null;
  /**
   * Telegram (M5-03), para a ferramenta anexar_arquivo dos agentes internos: baixar o arquivo e acordar a fila do
   * antivírus. Nulo quando o bot está desligado.
   */
  telegram?: { baixar(idNoTelegram: string): Promise<Buffer>; acordarAnexos(): void } | null;
  /** Conversas (M8-11): põe a mensagem do agente ao contato na fila de envio. Sem ela, mandar mensagem recusa. */
  enviarAoContato?: (empresaId: string, mensagemId: string) => Promise<void>;
}

/** Pausa o agente que passou do limite, avisa o responsável e registra. Roda na transação da empresa. */
async function pausarPorLimite(
  c: pg.PoolClient,
  agenteId: string,
  o: OpcoesDaChave,
  qual: "pedidos" | "leituras",
): Promise<(() => Promise<void>) | null> {
  const r = await c.query<{ nome: string; responsavel_id: string }>(
    `update agentes set situacao = 'pausado', atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa() and situacao = 'ativo' returning nome, responsavel_id`,
    [agenteId],
  );
  const agente = r.rows[0];
  if (!agente) return null; // Outro pedido já pausou.
  return avisarResponsavel(
    c,
    {
      agenteId,
      agenteNome: agente.nome,
      responsavelId: agente.responsavel_id,
      tipo: "agente_passou_do_limite",
      oQueAconteceu:
        qual === "pedidos"
          ? "passou do limite de pedidos por minuto e foi pausado"
          : "passou do limite de leitura por hora e foi pausado",
      tarefas: [],
    },
    o.carteiro,
    o.urlPublica,
    o.log,
  );
}

/** Soma ao contador da janela atual e devolve o total. */
async function somar(
  c: pg.PoolClient,
  d: { agenteId: string; chaveId: string | null; janela: "pedidos_minuto" | "leituras_hora"; quanto: number },
): Promise<number> {
  const corte = d.janela === "pedidos_minuto" ? "minute" : "hour";
  const r = await c.query<{ valor: number }>(
    `insert into contadores_de_agente (empresa_id, agente_id, chave_id, janela, inicio, valor)
     values (empresa_ativa(), $1, $2, $3, date_trunc('${corte}', now()), $4)
     on conflict (agente_id, chave_id, janela, inicio)
     do update set valor = contadores_de_agente.valor + excluded.valor returning valor`,
    [d.agenteId, d.chaveId, d.janela, d.quanto],
  );
  return r.rows[0]?.valor ?? 0;
}

/**
 * Confere o cabeçalho Authorization de um pedido de agente. Aceita: agente reconhecido, limite contado e sinal de
 * vida registrado. Recusa: motivo e status, e o evento chave.recusou quando a chave é de alguma empresa.
 */
export async function autenticarAgente(
  cabecalho: string | undefined,
  o: OpcoesDaChave,
  /** Por onde o pedido entrou (M7-02): o MCP direto ou a API pública. */
  canal: "mcp" | "api" = "mcp",
): Promise<ResultadoDaChave> {
  const limites = o.limites ?? LIMITES_DO_AGENTE;
  const chave = /^Bearer\s+(\S+)$/i.exec(cabecalho ?? "")?.[1] ?? "";
  const formato = FORMATO_DA_CHAVE.exec(chave);
  if (!formato) return { ok: false, motivo: "formato", status: 401 };
  const prefixo = `mago_ag_${formato[1]}`;

  const achada = await o.poolApp.query<{
    chave_id: string;
    empresa_id: string;
    agente_id: string;
    resumo: string;
    valida_ate: Date | null;
    revogada_em: Date | null;
    situacao_do_agente: string;
    situacao_da_empresa: string;
    canais: "mcp" | "api" | "os_dois";
  }>("select * from reconhecer_chave($1)", [prefixo]);
  const linha = achada.rows[0];
  const resumo = Buffer.from(resumoDaChave(chave), "hex");
  // Sem a chave, a comparação roda do mesmo jeito (contra um resumo qualquer), para não dar pista pelo tempo.
  const guardado = Buffer.from(linha?.resumo ?? "0".repeat(64), "hex");
  if (!linha || !timingSafeEqual(resumo, guardado)) {
    o.log.warn({ evento: "chave.recusou", motivo: "desconhecida", prefixo }, "Chave de agente desconhecida");
    return { ok: false, motivo: "desconhecida", status: 401 };
  }

  const recusar = async (motivo: MotivoDeRecusa, status: 401 | 403 | 429): Promise<ResultadoDaChave> => {
    await auditar(
      o.poolApp,
      {
        empresaId: linha.empresa_id,
        ator: { tipo: "agente", agenteId: linha.agente_id },
        acao: "chave.recusou",
        alvo: { tipo: "chave", id: linha.chave_id },
        origem: o.origem,
        rastreio: o.rastreio ?? null,
        detalhes: { motivo, prefixo },
      },
      o.log,
    );
    return { ok: false, motivo, status };
  };

  // Empresa suspensa: ninguém dela entra, nem os agentes (sem auditoria, como uma chave que não existe).
  if (linha.situacao_da_empresa !== "ativa") return { ok: false, motivo: "desconhecida", status: 401 };
  if (linha.revogada_em) return recusar("revogada", 401);
  if (linha.valida_ate && linha.valida_ate.getTime() <= Date.now()) return recusar("vencida", 401);
  if (linha.situacao_do_agente === "desligado") return recusar("agente_desligado", 403);
  if (linha.situacao_do_agente === "pausado") return recusar("agente_pausado", 403);
  if (linha.canais !== "os_dois" && linha.canais !== canal) return recusar("canal", 403);

  const feito = await comEmpresa(o.poolApp, linha.empresa_id, async (c) => {
    const pedidos = await somar(c, {
      agenteId: linha.agente_id,
      chaveId: linha.chave_id,
      janela: "pedidos_minuto",
      quanto: 1,
    });
    if (pedidos > limites.pedidosPorMinuto) {
      return { passou: true as const, avisar: await pausarPorLimite(c, linha.agente_id, o, "pedidos") };
    }
    // Sinal de vida: todo pedido aceito conta.
    await c.query("update chaves_de_agente set ultimo_uso_em = now() where id = $1", [linha.chave_id]);
    await c.query(
      "update agentes set ultimo_sinal_em = now() where id = $1 and empresa_id = empresa_ativa()",
      [linha.agente_id],
    );
    return { passou: false as const };
  });
  if (feito.passou) {
    if (feito.avisar) {
      await auditarDoAgente(o, linha.empresa_id, linha.agente_id, "agente.passou_do_limite", {
        limite: "pedidos_minuto",
      });
      // O e-mail sai sem segurar a resposta ao agente.
      void feito.avisar();
    }
    return recusar("passou_do_limite", 429);
  }
  return {
    ok: true,
    agente: { empresaId: linha.empresa_id, agenteId: linha.agente_id, chaveId: linha.chave_id },
  };
}

function auditarDoAgente(
  o: Pick<OpcoesDaChave, "poolApp" | "log" | "origem" | "rastreio">,
  empresaId: string,
  agenteId: string,
  acao: string,
  detalhes: Record<string, unknown>,
) {
  return auditar(
    o.poolApp,
    {
      empresaId,
      ator: { tipo: "sistema", servico: "agentes" },
      acao,
      alvo: { tipo: "agente", id: agenteId },
      origem: o.origem,
      rastreio: o.rastreio ?? null,
      detalhes,
    },
    o.log,
  );
}

/**
 * Conta registros lidos pelo agente na hora (M2-05 chama ao devolver tarefas e comentários). Passou do limite: o
 * agente é pausado, o responsável avisado, e quem chamou recusa o pedido.
 */
export async function contarLeituras(
  agente: AgenteDoPedido,
  quantos: number,
  o: OpcoesDaChave,
): Promise<boolean> {
  const limite = (o.limites ?? LIMITES_DO_AGENTE).leiturasPorHora;
  const feito = await comEmpresa(o.poolApp, agente.empresaId, async (c) => {
    const total = await somar(c, {
      agenteId: agente.agenteId,
      chaveId: null,
      janela: "leituras_hora",
      quanto: quantos,
    });
    if (total <= limite) return { passou: false as const };
    return { passou: true as const, avisar: await pausarPorLimite(c, agente.agenteId, o, "leituras") };
  });
  if (!feito.passou) return true;
  if (feito.avisar) {
    await auditarDoAgente(o, agente.empresaId, agente.agenteId, "agente.passou_do_limite", {
      limite: "leituras_hora",
    });
    await feito.avisar();
  }
  return false;
}

/**
 * Verificação a cada minuto (pg-boss): tarefas pegadas por agentes sem sinal voltam para A fazer, com comentário do
 * sistema; a pessoa responsável recebe aviso no Mago OS e por e-mail. Também apaga contadores com mais de 2 horas.
 */
export async function verificarAgentesVivos(o: Omit<OpcoesDaChave, "origem" | "rastreio">): Promise<number> {
  await o.poolApp.query("select limpar_contadores_de_agente()");
  const sem = await o.poolApp.query<{ empresa_id: string; agente_id: string }>(
    "select * from agentes_sem_sinal()",
  );
  let devolvidas = 0;
  for (const { empresa_id, agente_id } of sem.rows) {
    // Uma empresa com problema não segura a verificação das outras.
    try {
      devolvidas += await devolverDoAgenteSemSinal(o, empresa_id, agente_id);
    } catch (erro) {
      o.log.error({ erro, empresaId: empresa_id, agenteId: agente_id }, "Verificação de agente vivo falhou");
    }
  }
  return devolvidas;
}

async function devolverDoAgenteSemSinal(
  o: Omit<OpcoesDaChave, "origem" | "rastreio">,
  empresa_id: string,
  agente_id: string,
): Promise<number> {
  {
    const feito = await comEmpresa(o.poolApp, empresa_id, async (c) => {
      // Confere de novo com a linha travada: o agente pode ter dado sinal entre a lista e agora.
      const a = await c.query<{
        nome: string;
        responsavel_id: string;
        minutos_sem_sinal: number;
        situacao: string;
      }>(
        `select nome, responsavel_id, minutos_sem_sinal, situacao from agentes
          where id = $1 and empresa_id = empresa_ativa()
            and (ultimo_sinal_em is null or ultimo_sinal_em < now() - make_interval(mins => minutos_sem_sinal))
          for update`,
        [agente_id],
      );
      const agente = a.rows[0];
      if (!agente) return null;
      const tarefas = await devolverTarefasPegadas(
        c,
        agente_id,
        `O agente ${agente.nome} ficou mais de ${agente.minutos_sem_sinal} minutos sem sinal e a tarefa voltou para A fazer.`,
      );
      if (tarefas.length === 0) return null;
      const avisar = await avisarResponsavel(
        c,
        {
          agenteId: agente_id,
          agenteNome: agente.nome,
          responsavelId: agente.responsavel_id,
          tipo: "agente_sem_sinal",
          // Pausado não consegue mais entrar: a tarefa volta para não ficar presa com ele.
          oQueAconteceu: agente.situacao === "pausado" ? "está pausado e ficou sem sinal" : "ficou sem sinal",
          tarefas: tarefas.map((t) => t.titulo),
        },
        o.carteiro,
        o.urlPublica,
        o.log,
      );
      return { tarefas, avisar };
    });
    if (!feito) return 0;
    await auditarDoAgente(
      { ...o, origem: { canal: "sistema", ip: null, aparelho: null } },
      empresa_id,
      agente_id,
      "agente.sem_sinal",
      { tarefasDevolvidas: feito.tarefas.length },
    );
    await feito.avisar();
    return feito.tarefas.length;
  }
}
