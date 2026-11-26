/**
 * Chaves da API pública (M7-02, decisão 0047): criar, listar, trocar, revogar e conferir num pedido. Como a chave do
 * agente (decisão 0017): o banco guarda só o começo e o resumo SHA-256, e a chave inteira aparece uma vez só.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  type ChaveDeApi,
  DIAS_DE_VALIDADE_PADRAO,
  type EscopoDaChave,
  FORMATO_DA_CHAVE_DE_API,
  HORAS_DA_CHAVE_ANTIGA_NA_TROCA,
  LIMITES_DA_API,
  type MotivoDeRecusaDaApi,
} from "@mago-os/contratos";
import type pg from "pg";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa } from "../empresa.ts";

const LETRAS = "0123456789abcdefghijklmnopqrstuvwxyz";

export function resumoDaChaveDeApi(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

export function gerarChaveDeApi(): { chave: string; prefixo: string; resumo: string } {
  const id = [...randomBytes(10)].map((b) => LETRAS[b % LETRAS.length]).join("");
  const prefixo = `mago_api_${id}`;
  const chave = `${prefixo}_${randomBytes(32).toString("base64url")}`;
  return { chave, prefixo, resumo: resumoDaChaveDeApi(chave) };
}

interface LinhaDaChave {
  id: string;
  empresa_id: string;
  nome: string;
  prefixo: string;
  pessoa_id: string;
  escopo: EscopoDaChave;
  ips: string[];
  valida_ate: Date;
  criada_por: string;
  criada_em: Date;
  ultimo_uso_em: Date | null;
  revogada_em: Date | null;
  revogada_por: string | null;
  trocada_por_id: string | null;
}

const COLUNAS = `id, empresa_id, nome, prefixo, pessoa_id, escopo, ips::text[] as ips, valida_ate, criada_por, criada_em,
  ultimo_uso_em, revogada_em, revogada_por, trocada_por_id`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function linhaParaChaveDeApi(l: LinhaDaChave): ChaveDeApi {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    nome: l.nome,
    prefixo: l.prefixo,
    pessoaId: l.pessoa_id,
    escopo: l.escopo,
    // O PostgreSQL escreve o IP sozinho com a máscara (/32): na tela, volta como foi escrito.
    ips: l.ips.map((ip) => ip.replace(/\/(32|128)$/, "")),
    validaAte: l.valida_ate.toISOString(),
    criadaPor: l.criada_por,
    criadaEm: l.criada_em.toISOString(),
    ultimoUsoEm: iso(l.ultimo_uso_em),
    revogadaEm: iso(l.revogada_em),
    revogadaPor: l.revogada_por,
    trocadaPorId: l.trocada_por_id,
  };
}

export class RecusaDaChaveDeApi extends Error {}

export async function listarChavesDeApi(c: pg.PoolClient): Promise<ChaveDeApi[]> {
  const r = await c.query<LinhaDaChave>(
    `select ${COLUNAS} from chaves_de_api where empresa_id = empresa_ativa() and removida_em is null
      order by (revogada_em is not null), criada_em desc`,
  );
  return r.rows.map(linhaParaChaveDeApi);
}

export async function buscarChaveDeApi(c: pg.PoolClient, id: string, paraMudar = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await c.query<LinhaDaChave>(
    `select ${COLUNAS} from chaves_de_api where id = $1 and empresa_id = empresa_ativa() ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? linhaParaChaveDeApi(r.rows[0]) : null;
}

export async function criarChaveDeApi(
  c: pg.PoolClient,
  d: {
    nome: string;
    escopo: EscopoDaChave;
    pessoaId: string;
    ips: string[];
    validaAte: string | null;
    criadaPor: string;
  },
): Promise<{ chave: ChaveDeApi; segredo: string }> {
  const v = await c.query(
    "select 1 from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo'",
    [d.pessoaId],
  );
  if (!v.rowCount)
    throw new RecusaDaChaveDeApi("A chave precisa agir em nome de uma pessoa ativa da empresa.");
  const nova = gerarChaveDeApi();
  const validaAte = d.validaAte ?? new Date(Date.now() + DIAS_DE_VALIDADE_PADRAO * 86_400_000).toISOString();
  const r = await c.query<LinhaDaChave>(
    `insert into chaves_de_api (empresa_id, nome, prefixo, resumo, pessoa_id, escopo, ips, valida_ate, criada_por)
     values (empresa_ativa(), $1, $2, $3, $4, $5, $6::cidr[], $7, $8) returning ${COLUNAS}`,
    [
      d.nome.trim(),
      nova.prefixo,
      nova.resumo,
      d.pessoaId,
      JSON.stringify(d.escopo),
      d.ips,
      validaAte,
      d.criadaPor,
    ],
  );
  return { chave: linhaParaChaveDeApi(r.rows[0] as LinhaDaChave), segredo: nova.chave };
}

/** Troca: a chave nova copia o resto, e a antiga vale mais 24 horas (ou até a validade dela, se for antes). */
export async function trocarChaveDeApi(c: pg.PoolClient, antiga: ChaveDeApi, criadaPor: string) {
  if (antiga.revogadaEm || antiga.trocadaPorId)
    throw new RecusaDaChaveDeApi("Essa chave já foi revogada ou trocada.");
  const nova = await criarChaveDeApi(c, {
    nome: antiga.nome,
    escopo: antiga.escopo,
    pessoaId: antiga.pessoaId,
    ips: antiga.ips,
    validaAte: null,
    criadaPor,
  });
  await c.query(
    `update chaves_de_api set trocada_por_id = $2,
            valida_ate = least(valida_ate, now() + interval '${HORAS_DA_CHAVE_ANTIGA_NA_TROCA} hours')
      where id = $1 and empresa_id = empresa_ativa()`,
    [antiga.id, nova.chave.id],
  );
  return nova;
}

export async function revogarChaveDeApi(c: pg.PoolClient, id: string, por: string): Promise<boolean> {
  const r = await c.query(
    `update chaves_de_api set revogada_em = now(), revogada_por = $2
      where id = $1 and empresa_id = empresa_ativa() and revogada_em is null`,
    [id, por],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Tira da lista da tela uma chave já revogada ou vencida (a linha fica, para a auditoria). */
export async function removerChaveDeApi(c: pg.PoolClient, id: string): Promise<"ok" | "ativa" | "nao"> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "nao";
  const r = await c.query<{ parada: boolean }>(
    `select (revogada_em is not null or valida_ate <= now()) as parada from chaves_de_api
      where id = $1 and empresa_id = empresa_ativa() and removida_em is null for update`,
    [id],
  );
  const linha = r.rows[0];
  if (!linha) return "nao";
  if (!linha.parada) return "ativa";
  await c.query(
    "update chaves_de_api set removida_em = now() where id = $1 and empresa_id = empresa_ativa()",
    [id],
  );
  return "ok";
}

/** O IP está na lista (IP exato ou faixa CIDR). Lista vazia: qualquer um. */
export function ipPermitido(ip: string | null, lista: string[]): boolean {
  if (lista.length === 0) return true;
  if (!ip || !isIP(ip)) return false;
  return lista.some((faixa) => dentroDaFaixa(ip, faixa));
}

function paraBits(ip: string): { bits: bigint; tamanho: number } | null {
  const tipo = isIP(ip);
  if (tipo === 4) {
    const partes = ip.split(".").map(Number);
    return { bits: partes.reduce((a, p) => (a << 8n) | BigInt(p), 0n), tamanho: 32 };
  }
  if (tipo === 6) {
    const [esq, dir] = ip.split("::");
    const a = esq ? esq.split(":") : [];
    const b = dir !== undefined ? (dir ? dir.split(":") : []) : [];
    const meio = ip.includes("::") ? Array(8 - a.length - b.length).fill("0") : [];
    const grupos = [...a, ...meio, ...b];
    return {
      bits: grupos.reduce((x, g) => (x << 16n) | BigInt(Number.parseInt(g || "0", 16)), 0n),
      tamanho: 128,
    };
  }
  return null;
}

function dentroDaFaixa(ip: string, faixa: string): boolean {
  const [base, mascara] = faixa.split("/");
  const x = paraBits(ip.replace(/^::ffff:/, ""));
  const y = paraBits(base ?? "");
  if (!x || !y || x.tamanho !== y.tamanho) return false;
  const m = mascara === undefined ? x.tamanho : Number(mascara);
  const corte = BigInt(x.tamanho - m);
  return x.bits >> corte === y.bits >> corte;
}

/** A chave aceita: a empresa, a pessoa em nome de quem age e o escopo. */
export interface ChaveDoPedido {
  chaveId: string;
  empresaId: string;
  pessoaId: string;
  escopo: EscopoDaChave;
}

export type ResultadoDaChaveDeApi =
  | { ok: true; chave: ChaveDoPedido }
  | { ok: false; motivo: MotivoDeRecusaDaApi; status: 401 | 403 | 429 };

export interface OpcoesDaChaveDeApi {
  poolApp: pg.Pool;
  log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  origem: DadosDoEvento["origem"];
  rastreio?: string | null;
  limites?: { pedidosPorMinutoPorChave: number; pedidosPorMinutoPorEmpresa: number };
}

/** Registra a recusa de uma chave reconhecida (nunca a chave, só o começo e o motivo). */
export function registrarRecusa(
  o: OpcoesDaChaveDeApi,
  chave: { empresaId: string; chaveId: string; pessoaId: string },
  motivo: MotivoDeRecusaDaApi,
  detalhes: Record<string, unknown> = {},
) {
  return auditar(
    o.poolApp,
    {
      empresaId: chave.empresaId,
      ator: { tipo: "pessoa", pessoaId: chave.pessoaId },
      acao: "chave_api.recusou",
      alvo: { tipo: "chave_de_api", id: chave.chaveId },
      origem: o.origem,
      rastreio: o.rastreio ?? null,
      detalhes: { motivo, ...detalhes },
    },
    o.log,
  );
}

/** Confere a chave do pedido: formato, resumo, revogação, validade, pessoa ativa, IP e os limites por minuto. */
export async function autenticarChaveDeApi(
  chave: string,
  o: OpcoesDaChaveDeApi,
): Promise<ResultadoDaChaveDeApi> {
  const limites = o.limites ?? LIMITES_DA_API;
  const formato = FORMATO_DA_CHAVE_DE_API.exec(chave);
  if (!formato) return { ok: false, motivo: "formato", status: 401 };
  const prefixo = `mago_api_${formato[1]}`;
  const achada = await o.poolApp.query<{
    chave_id: string;
    empresa_id: string;
    pessoa_id: string;
    resumo: string;
    escopo: EscopoDaChave;
    ips: string[];
    valida_ate: Date;
    revogada_em: Date | null;
    situacao_do_vinculo: string;
    situacao_da_empresa: string;
  }>(
    `select chave_id, empresa_id, pessoa_id, resumo, escopo, ips::text[] as ips, valida_ate, revogada_em,
            situacao_do_vinculo, situacao_da_empresa from reconhecer_chave_de_api($1)`,
    [prefixo],
  );
  const linha = achada.rows[0];
  const resumo = Buffer.from(resumoDaChaveDeApi(chave), "hex");
  // Sem a chave, a comparação roda do mesmo jeito (contra um resumo qualquer), para não dar pista pelo tempo.
  const guardado = Buffer.from(linha?.resumo ?? "0".repeat(64), "hex");
  if (!linha || !timingSafeEqual(resumo, guardado)) {
    o.log.warn({ evento: "chave_api.recusou", motivo: "desconhecida", prefixo }, "Chave de API desconhecida");
    return { ok: false, motivo: "desconhecida", status: 401 };
  }
  const quem = { empresaId: linha.empresa_id, chaveId: linha.chave_id, pessoaId: linha.pessoa_id };
  const recusar = async (motivo: MotivoDeRecusaDaApi, status: 401 | 403 | 429) => {
    await registrarRecusa(o, quem, motivo, { prefixo });
    return { ok: false as const, motivo, status };
  };
  if (linha.situacao_da_empresa !== "ativa") return { ok: false, motivo: "desconhecida", status: 401 };
  if (linha.revogada_em) return recusar("revogada", 401);
  if (linha.valida_ate.getTime() <= Date.now()) return recusar("vencida", 401);
  // A pessoa saiu da empresa: a chave para na hora (decisão 0047, item 4).
  if (linha.situacao_do_vinculo !== "ativo") return recusar("sem_permissao", 403);
  if (!ipPermitido(o.origem.ip, linha.ips)) return recusar("ip", 403);

  const passou = await comEmpresa(o.poolApp, linha.empresa_id, async (c) => {
    const somar = async (chaveId: string | null) => {
      const r = await c.query<{ valor: number }>(
        `insert into contadores_da_api (empresa_id, chave_id, inicio, valor)
         values (empresa_ativa(), $1, date_trunc('minute', now()), 1)
         on conflict (empresa_id, chave_id, inicio) do update set valor = contadores_da_api.valor + 1
         returning valor`,
        [chaveId],
      );
      return r.rows[0]?.valor ?? 0;
    };
    const daChave = await somar(linha.chave_id);
    const daEmpresa = await somar(null);
    if (daChave > limites.pedidosPorMinutoPorChave || daEmpresa > limites.pedidosPorMinutoPorEmpresa)
      return true;
    await c.query("update chaves_de_api set ultimo_uso_em = now() where id = $1", [linha.chave_id]);
    return false;
  });
  if (passou) return recusar("passou_do_limite", 429);
  return { ok: true, chave: { ...quem, escopo: linha.escopo } };
}

/** Avisa quem criou cada chave que vence em até 30 dias, uma vez (verificação a cada minuto). */
export async function avisarChavesVencendo(poolApp: pg.Pool): Promise<number> {
  const r = await poolApp.query<{ empresa_id: string; chave_id: string }>(
    "select * from chaves_de_api_vencendo()",
  );
  for (const l of r.rows) {
    await comEmpresa(poolApp, l.empresa_id, async (c) => {
      const k = await c.query<{ nome: string; criada_por: string; valida_ate: Date }>(
        `update chaves_de_api set avisou_vencimento_em = now()
          where id = $1 and empresa_id = empresa_ativa() and avisou_vencimento_em is null
          returning nome, criada_por, valida_ate`,
        [l.chave_id],
      );
      const chave = k.rows[0];
      if (!chave) return;
      await criarAviso(c, {
        pessoaId: chave.criada_por,
        tipo: "chave_de_api_vencendo",
        texto: `A chave de API "${chave.nome}" vence em ${chave.valida_ate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Troque em Chaves de API.`,
        link: "/chaves-de-api",
      });
    });
  }
  return r.rows.length;
}
