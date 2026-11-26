/**
 * Webhooks de saída (M7-03, decisão 0048): cadastro, segredo, entrega com assinatura e novas tentativas, e o
 * desligamento depois de 3 dias falhando. Os avisos nascem nos gatilhos do banco (migração 0050), na mesma transação
 * da mudança; aqui só se entrega.
 */
import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import {
  type AvisoDoAgente,
  CABECALHO_DA_ASSINATURA,
  CABECALHO_DA_ENTREGA,
  CABECALHO_DO_EVENTO,
  DIAS_DO_HISTORICO_DE_ENTREGAS,
  DIAS_FALHANDO_ATE_DESLIGAR,
  type EntregaDeWebhook,
  ESPERAS_DAS_TENTATIVAS,
  type EventoDeWebhook,
  MAXIMO_DE_WEBHOOKS,
  SEGUNDOS_DE_ESPERA_DA_RESPOSTA,
  type Webhook,
} from "@mago-os/contratos";
import type pg from "pg";
import { auditar } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import type { Cofre } from "../contas-de-ia/cofre.ts";
import { comEmpresa } from "../empresa.ts";

export class RecusaDoWebhook extends Error {}

const rotuloDoSegredo = (webhookId: string) => `webhook:${webhookId}`;

interface LinhaDoWebhook {
  id: string;
  empresa_id: string;
  nome: string;
  url: string;
  eventos: EventoDeWebhook[];
  situacao: "ligado" | "desligado";
  desligado_porque: "manual" | "falhas" | null;
  final_do_segredo: string;
  falhando_desde: Date | null;
  ultima_entrega_em: Date | null;
  criado_por: string;
  criado_em: Date;
  atualizado_em: Date;
}

const COLUNAS = `id, empresa_id, nome, url, eventos, situacao, desligado_porque, final_do_segredo, falhando_desde,
  ultima_entrega_em, criado_por, criado_em, atualizado_em`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const paraWebhook = (l: LinhaDoWebhook): Webhook => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  url: l.url,
  eventos: l.eventos,
  situacao: l.situacao,
  desligadoPorque: l.desligado_porque,
  finalDoSegredo: l.final_do_segredo,
  falhandoDesde: iso(l.falhando_desde),
  ultimaEntregaEm: iso(l.ultima_entrega_em),
  criadoPor: l.criado_por,
  criadoEm: l.criado_em.toISOString(),
  atualizadoEm: l.atualizado_em.toISOString(),
});

export const gerarSegredo = () => `whsec_${randomBytes(32).toString("base64url")}`;

export async function listarWebhooks(c: pg.PoolClient): Promise<Webhook[]> {
  const r = await c.query<LinhaDoWebhook>(
    `select ${COLUNAS} from webhooks where empresa_id = empresa_ativa() and agente_id is null order by criado_em`,
  );
  return r.rows.map(paraWebhook);
}

export async function buscarWebhook(
  c: pg.PoolClient,
  id: string,
  paraMudar = false,
): Promise<Webhook | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await c.query<LinhaDoWebhook>(
    `select ${COLUNAS} from webhooks where id = $1 and empresa_id = empresa_ativa() and agente_id is null
      ${paraMudar ? "for update" : ""}`,
    [id],
  );
  return r.rows[0] ? paraWebhook(r.rows[0]) : null;
}

export async function criarWebhook(
  c: pg.PoolClient,
  cofre: Cofre,
  empresaId: string,
  d: { nome: string; url: string; eventos: EventoDeWebhook[]; criadoPor: string },
): Promise<{ webhook: Webhook; segredo: string }> {
  const n = await c.query<{ n: number }>(
    "select count(*)::int as n from webhooks where empresa_id = empresa_ativa()",
  );
  if ((n.rows[0]?.n ?? 0) >= MAXIMO_DE_WEBHOOKS)
    throw new RecusaDoWebhook(`A empresa pode ter no máximo ${MAXIMO_DE_WEBHOOKS} webhooks.`);
  const segredo = gerarSegredo();
  const id = (await c.query<{ id: string }>("select uuidv7() as id")).rows[0]?.id as string;
  const cifrado = await cofre.guardarSegredo(c, empresaId, rotuloDoSegredo(id), segredo);
  const r = await c.query<LinhaDoWebhook>(
    `insert into webhooks (id, empresa_id, nome, url, eventos, segredo_cifrado, final_do_segredo, criado_por)
     values ($1, empresa_ativa(), $2, $3, $4, $5, $6, $7) returning ${COLUNAS}`,
    [id, d.nome.trim(), d.url, d.eventos, cifrado, segredo.slice(-4), d.criadoPor],
  );
  return { webhook: paraWebhook(r.rows[0] as LinhaDoWebhook), segredo };
}

export async function editarWebhook(
  c: pg.PoolClient,
  atual: Webhook,
  m: { nome?: string; url?: string; eventos?: EventoDeWebhook[]; situacao?: "ligado" | "desligado" },
): Promise<Webhook> {
  const situacao = m.situacao ?? atual.situacao;
  const religou = situacao === "ligado" && atual.situacao === "desligado";
  const r = await c.query<LinhaDoWebhook>(
    `update webhooks set nome = $2, url = $3, eventos = $4, situacao = $5,
            desligado_porque = case when $5 = 'desligado' then coalesce(desligado_porque, 'manual') end,
            falhando_desde = case when $6 then null else falhando_desde end, atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [
      atual.id,
      (m.nome ?? atual.nome).trim(),
      m.url ?? atual.url,
      m.eventos ?? atual.eventos,
      situacao,
      religou,
    ],
  );
  return paraWebhook(r.rows[0] as LinhaDoWebhook);
}

export async function trocarSegredo(c: pg.PoolClient, cofre: Cofre, empresaId: string, w: Webhook) {
  const segredo = gerarSegredo();
  const cifrado = await cofre.guardarSegredo(c, empresaId, rotuloDoSegredo(w.id), segredo);
  const r = await c.query<LinhaDoWebhook>(
    `update webhooks set segredo_cifrado = $2, final_do_segredo = $3, atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa() returning ${COLUNAS}`,
    [w.id, cifrado, segredo.slice(-4)],
  );
  return { webhook: paraWebhook(r.rows[0] as LinhaDoWebhook), segredo };
}

export async function apagarWebhook(c: pg.PoolClient, id: string): Promise<boolean> {
  const r = await c.query("delete from webhooks where id = $1 and empresa_id = empresa_ativa()", [id]);
  return (r.rowCount ?? 0) > 0;
}

/** O aviso de teste (botão "Mandar teste"), entregue como qualquer outro. */
export async function mandarTeste(c: pg.PoolClient, w: Webhook): Promise<string> {
  const r = await c.query<{ id: string }>(
    `insert into entregas_de_webhook (empresa_id, webhook_id, evento, corpo, proxima_em)
     values (empresa_ativa(), $1, 'webhook.teste', jsonb_build_object('evento', 'webhook.teste',
       'ocorridoEm', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'empresaId', empresa_ativa(),
       'dados', jsonb_build_object('tipo', 'webhook', 'id', $2::text)), now()) returning id`,
    [w.id, w.id],
  );
  return r.rows[0]?.id as string;
}

interface LinhaDaEntrega {
  id: string;
  webhook_id: string;
  evento: string;
  situacao: EntregaDeWebhook["situacao"];
  tentativas: number;
  ultimo_codigo: number | null;
  ultimo_erro: string | null;
  ultimo_tempo_ms: number | null;
  proxima_em: Date | null;
  criada_em: Date;
  entregue_em: Date | null;
}

const paraEntrega = (l: LinhaDaEntrega): EntregaDeWebhook => ({
  id: l.id,
  webhookId: l.webhook_id,
  evento: l.evento,
  situacao: l.situacao,
  tentativas: l.tentativas,
  ultimoCodigo: l.ultimo_codigo,
  ultimoErro: l.ultimo_erro,
  ultimoTempoMs: l.ultimo_tempo_ms,
  proximaEm: iso(l.proxima_em),
  criadaEm: l.criada_em.toISOString(),
  entregueEm: iso(l.entregue_em),
});

export async function listarEntregas(c: pg.PoolClient, webhookId: string): Promise<EntregaDeWebhook[]> {
  const r = await c.query<LinhaDaEntrega>(
    `select id, webhook_id, evento, situacao, tentativas, ultimo_codigo, ultimo_erro, ultimo_tempo_ms, proxima_em,
            criada_em, entregue_em from entregas_de_webhook
      where empresa_id = empresa_ativa() and webhook_id = $1 order by criada_em desc limit 100`,
    [webhookId],
  );
  return r.rows.map(paraEntrega);
}

/** Põe a entrega de novo na fila, agora (o botão "Tentar de novo"). */
export async function reenviar(c: pg.PoolClient, webhookId: string, entregaId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(entregaId)) return false;
  const r = await c.query(
    `update entregas_de_webhook set situacao = 'esperando', proxima_em = now()
      where id = $1 and webhook_id = $2 and empresa_id = empresa_ativa()`,
    [entregaId, webhookId],
  );
  return (r.rowCount ?? 0) > 0;
}

// Entrega ----------------------------------------------------------------------------------------------------

/** A assinatura do aviso: "t=<segundos>,v1=<HMAC SHA-256 em hex de "<t>.<corpo>">". */
export function assinar(segredo: string, corpo: string, segundos: number): string {
  const v1 = createHmac("sha256", segredo).update(`${segundos}.${corpo}`).digest("hex");
  return `t=${segundos},v1=${v1}`;
}

/** O resultado de uma tentativa: o código (nulo se nem respondeu) e o erro em português. */
export interface ResultadoDoEnvio {
  codigo: number | null;
  erro: string | null;
  ms: number;
}

/** Quem manda de verdade. Os testes trocam por um falso. */
export type Enviar = (
  url: string,
  cabecalhos: Record<string, string>,
  corpo: string,
) => Promise<ResultadoDoEnvio>;

/** O IP é de rede interna (não pode receber aviso: protege a rede do próprio servidor). */
export function ipInterno(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
}

/** O envio de verdade: https, IP público conferido e fixado (sem trocar no meio), 10 segundos, sem redirecionar. */
export const enviarDeVerdade: Enviar = async (url, cabecalhos, corpo) => {
  const inicio = Date.now();
  const alvo = new URL(url);
  let ip: string;
  try {
    const achado = await lookup(alvo.hostname);
    ip = achado.address;
  } catch {
    return { codigo: null, erro: "O nome do endereço não foi encontrado.", ms: Date.now() - inicio };
  }
  if (ipInterno(ip))
    return {
      codigo: null,
      erro: "O endereço aponta para uma rede interna: recusado.",
      ms: Date.now() - inicio,
    };
  return new Promise((resolver) => {
    const pedido = request(
      {
        host: ip,
        servername: alvo.hostname,
        port: alvo.port || 443,
        path: `${alvo.pathname}${alvo.search}`,
        method: "POST",
        headers: { ...cabecalhos, host: alvo.host, "content-length": Buffer.byteLength(corpo) },
        timeout: SEGUNDOS_DE_ESPERA_DA_RESPOSTA * 1000,
      },
      (resposta) => {
        resposta.resume();
        const codigo = resposta.statusCode ?? 0;
        resolver({
          codigo,
          erro: codigo >= 200 && codigo < 300 ? null : `O endereço respondeu ${codigo}.`,
          ms: Date.now() - inicio,
        });
      },
    );
    pedido.on("timeout", () => pedido.destroy(new Error("tempo")));
    pedido.on("error", (e) =>
      resolver({
        codigo: null,
        erro:
          e.message === "tempo"
            ? "O endereço não respondeu em 10 segundos."
            : "Não deu para conectar ao endereço.",
        ms: Date.now() - inicio,
      }),
    );
    pedido.end(corpo);
  });
};

export interface OpcoesDaEntrega {
  poolApp: pg.Pool;
  cofre: Cofre;
  log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  enviar?: Enviar;
  agora?: () => Date;
}

/** Entrega o que está na hora, de todas as empresas, e desliga o webhook que falha há 3 dias. */
export async function cuidarDosWebhooks(o: OpcoesDaEntrega): Promise<number> {
  const r = await o.poolApp.query<{ empresa_id: string }>(
    "select empresas_com_entregas_de_webhook() as empresa_id",
  );
  let feitas = 0;
  for (const { empresa_id } of r.rows) {
    try {
      feitas += await cuidarDaEmpresa(o, empresa_id);
    } catch (erro) {
      o.log.error({ erro, empresaId: empresa_id }, "Webhooks: falha ao entregar");
    }
  }
  return feitas;
}

async function cuidarDaEmpresa(o: OpcoesDaEntrega, empresaId: string): Promise<number> {
  const enviar = o.enviar ?? enviarDeVerdade;
  let feitas = 0;
  for (;;) {
    // Reivindica uma entrega de cada vez (outra cópia da API pula a que esta pegou).
    const pegou = await comEmpresa(o.poolApp, empresaId, async (c) => {
      const e = await c.query<{
        id: string;
        evento: string;
        corpo: Record<string, unknown>;
        tentativas: number;
        webhook_id: string;
        url: string;
        segredo_cifrado: Buffer;
        situacao_do_webhook: string;
      }>(
        `select e.id, e.evento, e.corpo, e.tentativas, e.webhook_id, w.url, w.segredo_cifrado,
                w.situacao as situacao_do_webhook
           from entregas_de_webhook e join webhooks w on w.id = e.webhook_id and w.empresa_id = e.empresa_id
          where e.empresa_id = empresa_ativa() and e.proxima_em <= now()
          order by e.proxima_em limit 1 for update of e skip locked`,
      );
      const linha = e.rows[0];
      if (!linha) return null;
      // Webhook desligado: a entrega não sai (a não ser o teste, que a pessoa pediu).
      if (linha.situacao_do_webhook !== "ligado" && linha.evento !== "webhook.teste") {
        await c.query(
          "update entregas_de_webhook set situacao = 'desistiu', proxima_em = null, ultimo_erro = $2 where id = $1",
          [linha.id, "O webhook está desligado."],
        );
        return { pulada: true as const };
      }
      // Marca a tentativa antes de mandar: se a API cair no meio, a entrega volta daqui a 10 minutos.
      await c.query(
        "update entregas_de_webhook set proxima_em = now() + interval '10 minutes' where id = $1",
        [linha.id],
      );
      const segredo = await o.cofre.abrirSegredo(
        c,
        empresaId,
        rotuloDoSegredo(linha.webhook_id),
        linha.segredo_cifrado,
      );
      return { linha, segredo };
    });
    if (!pegou) break;
    if ("pulada" in pegou) continue;
    const { linha, segredo } = pegou;
    const corpo = JSON.stringify({ id: linha.id, ...linha.corpo });
    const agora = o.agora?.() ?? new Date();
    const resultado = await enviar(
      linha.url,
      {
        "content-type": "application/json",
        "user-agent": "Mago-OS-Webhooks/1",
        [CABECALHO_DA_ASSINATURA]: assinar(segredo, corpo, Math.floor(agora.getTime() / 1000)),
        [CABECALHO_DO_EVENTO]: linha.evento,
        [CABECALHO_DA_ENTREGA]: linha.id,
      },
      corpo,
    ).catch((): ResultadoDoEnvio => ({ codigo: null, erro: "Não deu para mandar o aviso.", ms: 0 }));
    const certo = resultado.codigo !== null && resultado.codigo >= 200 && resultado.codigo < 300;
    const tentativas = linha.tentativas + 1;
    const espera = ESPERAS_DAS_TENTATIVAS[tentativas - 1];
    await comEmpresa(o.poolApp, empresaId, async (c) => {
      await c.query(
        `update entregas_de_webhook set tentativas = $2, ultimo_codigo = $3, ultimo_erro = $4, ultimo_tempo_ms = $5,
                situacao = $6, proxima_em = $7, entregue_em = case when $6 = 'entregue' then now() end
          where id = $1`,
        [
          linha.id,
          tentativas,
          resultado.codigo,
          resultado.erro?.slice(0, 300) ?? null,
          resultado.ms,
          certo ? "entregue" : espera === undefined ? "desistiu" : "falhou",
          certo || espera === undefined ? null : new Date(agora.getTime() + espera * 60_000),
        ],
      );
      if (linha.evento === "webhook.teste") return;
      await c.query(
        certo
          ? "update webhooks set ultima_entrega_em = now(), falhando_desde = null where id = $1"
          : "update webhooks set falhando_desde = coalesce(falhando_desde, now()) where id = $1",
        [linha.webhook_id],
      );
    });
    feitas += 1;
  }
  await desligarOsQueFalham(o, empresaId);
  // O histórico fica 30 dias.
  await comEmpresa(o.poolApp, empresaId, (c) =>
    c.query(
      `delete from entregas_de_webhook where empresa_id = empresa_ativa() and proxima_em is null
         and criada_em < now() - interval '${DIAS_DO_HISTORICO_DE_ENTREGAS} days'`,
    ),
  );
  return feitas;
}

/** Desliga o webhook que passou 3 dias sem nenhuma entrega certa e avisa os administradores. */
async function desligarOsQueFalham(o: OpcoesDaEntrega, empresaId: string) {
  const desligados = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{ id: string; nome: string; responsavel_id: string | null }>(
      `update webhooks w set situacao = 'desligado', desligado_porque = 'falhas', atualizado_em = now()
        where w.empresa_id = empresa_ativa() and w.situacao = 'ligado'
          and w.falhando_desde < now() - interval '${DIAS_FALHANDO_ATE_DESLIGAR} days'
        returning w.id, w.nome,
          (select g.responsavel_id from agentes g where g.id = w.agente_id and g.empresa_id = w.empresa_id) as responsavel_id`,
    );
    if (r.rows.length === 0) return [];
    const admins = await c.query<{ pessoa_id: string }>(
      "select pessoa_id from vinculos where empresa_id = empresa_ativa() and perfil = 'administrador' and situacao = 'ativo'",
    );
    // O aviso de um agente (M7-04) também vai para a pessoa responsável por ele.
    for (const w of r.rows)
      for (const pessoaId of new Set([
        ...admins.rows.map((a) => a.pessoa_id),
        ...(w.responsavel_id ? [w.responsavel_id] : []),
      ]))
        await criarAviso(c, {
          pessoaId,
          tipo: "webhook_desligado",
          texto: `O webhook "${w.nome}" passou ${DIAS_FALHANDO_ATE_DESLIGAR} dias sem conseguir entregar os avisos e foi desligado. Confira o endereço e ligue de novo em Webhooks.`,
          link: "/webhooks",
        });
    return r.rows;
  });
  for (const w of desligados)
    await auditar(
      o.poolApp,
      {
        empresaId,
        ator: { tipo: "sistema", servico: "webhooks" },
        acao: "webhook.desligou_por_falhas",
        alvo: { tipo: "webhook", id: w.id },
        origem: { canal: "sistema", ip: null, aparelho: null },
        rastreio: null,
        detalhes: { dias: DIAS_FALHANDO_ATE_DESLIGAR },
      },
      o.log,
    );
}

// Aviso imediato ao agente externo (M7-04, decisão 0049): um webhook ligado ao agente, fora da tela Webhooks. ---

const EVENTOS_DO_AVISO = ["agente.tarefa_recebida", "agente.mencionado", "agente.aprovacao_respondida"];

interface LinhaDoAviso {
  id: string;
  url: string;
  situacao: "ligado" | "desligado";
  desligado_porque: "manual" | "falhas" | null;
  final_do_segredo: string;
  falhando_desde: Date | null;
  ultima_entrega_em: Date | null;
}

const paraAviso = (l: LinhaDoAviso): AvisoDoAgente => ({
  webhookId: l.id,
  url: l.url,
  situacao: l.situacao,
  desligadoPorque: l.desligado_porque,
  finalDoSegredo: l.final_do_segredo,
  falhandoDesde: iso(l.falhando_desde),
  ultimaEntregaEm: iso(l.ultima_entrega_em),
});

export async function avisoDoAgente(c: pg.PoolClient, agenteId: string, paraMudar = false) {
  const r = await c.query<LinhaDoAviso>(
    `select id, url, situacao, desligado_porque, final_do_segredo, falhando_desde, ultima_entrega_em from webhooks
      where empresa_id = empresa_ativa() and agente_id = $1 ${paraMudar ? "for update" : ""}`,
    [agenteId],
  );
  return r.rows[0] ? paraAviso(r.rows[0]) : null;
}

/**
 * Liga o aviso do agente com o endereço (ou troca o endereço). Na primeira vez gera o segredo e devolve; ao trocar só
 * o endereço, o segredo continua (segredo nulo na resposta). Ligar de novo zera a contagem de falhas.
 */
export async function ligarAvisoDoAgente(
  c: pg.PoolClient,
  cofre: Cofre,
  empresaId: string,
  agente: { id: string; nome: string },
  url: string,
  por: string,
): Promise<{ aviso: AvisoDoAgente; segredo: string | null }> {
  const atual = await avisoDoAgente(c, agente.id, true);
  if (atual) {
    await c.query(
      `update webhooks set url = $2, situacao = 'ligado', desligado_porque = null, falhando_desde = null,
              atualizado_em = now() where id = $1 and empresa_id = empresa_ativa()`,
      [atual.webhookId, url],
    );
    return { aviso: (await avisoDoAgente(c, agente.id)) as AvisoDoAgente, segredo: null };
  }
  const segredo = gerarSegredo();
  const id = (await c.query<{ id: string }>("select uuidv7() as id")).rows[0]?.id as string;
  const cifrado = await cofre.guardarSegredo(c, empresaId, rotuloDoSegredo(id), segredo);
  await c.query(
    `insert into webhooks (id, empresa_id, agente_id, nome, url, eventos, segredo_cifrado, final_do_segredo, criado_por)
     values ($1, empresa_ativa(), $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      agente.id,
      `Aviso de ${agente.nome}`.slice(0, 80),
      url,
      EVENTOS_DO_AVISO,
      cifrado,
      segredo.slice(-4),
      por,
    ],
  );
  return { aviso: (await avisoDoAgente(c, agente.id)) as AvisoDoAgente, segredo };
}

/** Troca o segredo do aviso do agente. */
export async function trocarSegredoDoAviso(
  c: pg.PoolClient,
  cofre: Cofre,
  empresaId: string,
  webhookId: string,
) {
  const segredo = gerarSegredo();
  const cifrado = await cofre.guardarSegredo(c, empresaId, rotuloDoSegredo(webhookId), segredo);
  await c.query(
    `update webhooks set segredo_cifrado = $2, final_do_segredo = $3, atualizado_em = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [webhookId, cifrado, segredo.slice(-4)],
  );
  return segredo;
}

/** Desliga o aviso (apaga o webhook do agente e o histórico): o agente volta a só perguntar. */
export async function desligarAvisoDoAgente(c: pg.PoolClient, agenteId: string): Promise<boolean> {
  const r = await c.query("delete from webhooks where empresa_id = empresa_ativa() and agente_id = $1", [
    agenteId,
  ]);
  return (r.rowCount ?? 0) > 0;
}

/** O teste do aviso do agente (o mesmo do botão dos webhooks). */
export async function mandarTesteDoAviso(c: pg.PoolClient, webhookId: string): Promise<string> {
  return mandarTeste(c, { id: webhookId } as Webhook);
}
