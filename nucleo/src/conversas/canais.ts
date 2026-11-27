/**
 * Canais de WhatsApp pela Evolution API (M8-02, decisão 0052): conectar um número pelo QR code, ver a situação,
 * mudar o nome e a equipe, desconectar e apagar (módulo de permissão "canais", padrão só o administrador), e os
 * avisos que a Evolution manda ao núcleo pela rede interna (número conectou ou caiu).
 *
 * Cada canal é uma instância da Evolution com o nome "<empresa>_<canal>": o aviso diz de que empresa é, e o banco
 * (RLS) só deixa mexer num canal daquela empresa. Os avisos passam pela fila para nunca se perderem.
 */
import { timingSafeEqual } from "node:crypto";
import {
  AvisoDaEvolution,
  type Canal,
  conferir,
  PedidoDeCanalDeWhatsapp,
  PedidoDeEditarCanal,
  type Problema,
  type QrDoCanal,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import { auditar } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { CABECALHO_DO_SEGREDO, type ClienteDaEvolution, ErroDaEvolution, numeroDoJid } from "./evolution.ts";
import { criarCanal, listarCanais, RecusaDasConversas } from "./servico.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O nome da instância na Evolution: a empresa e o canal. */
export const nomeDaInstancia = (empresaId: string, canalId: string) => `${empresaId}_${canalId}`;

/** A empresa e o canal de um nome de instância, ou nulo se não é um nome nosso. */
export function daInstancia(nome: string): { empresaId: string; canalId: string } | null {
  const [empresaId, canalId, ...resto] = nome.split("_");
  if (resto.length > 0 || !empresaId || !canalId || !UUID.test(empresaId) || !UUID.test(canalId)) return null;
  return { empresaId, canalId };
}

export async function buscarCanal(c: pg.PoolClient, id: string, paraMudar = false): Promise<Canal | null> {
  if (!UUID.test(id)) return null;
  return (await listarCanais(c, paraMudar ? { id, paraMudar } : { id }))[0] ?? null;
}

/**
 * Marca a situação do canal (e o número, ao conectar). Devolve a situação de antes, ou nulo se o canal não existe.
 * O número que já está noutro canal (de qualquer empresa) é recusado pelo banco: o canal fica desconectado.
 */
export async function marcarSituacao(
  c: pg.PoolClient,
  canalId: string,
  situacao: Canal["situacao"],
  numero?: string | null,
): Promise<{ antes: Canal["situacao"]; numeroEmUso: boolean } | null> {
  const antes = await c.query<{ situacao: Canal["situacao"] }>(
    "select situacao from canais_de_contato where id = $1 and empresa_id = empresa_ativa() for update",
    [canalId],
  );
  const a = antes.rows[0]?.situacao;
  if (!a) return null;
  try {
    await c.query("savepoint marcar_situacao");
    await c.query(
      `update canais_de_contato set situacao = $2, identificador = coalesce($3, identificador), atualizado_em = now()
        where id = $1 and empresa_id = empresa_ativa()`,
      [canalId, situacao, numero ?? null],
    );
    await c.query("release savepoint marcar_situacao");
    return { antes: a, numeroEmUso: false };
  } catch (erro) {
    await c.query("rollback to savepoint marcar_situacao");
    if ((erro as { constraint?: string }).constraint !== "canais_de_contato_numero_unico") throw erro;
    await c.query(
      "update canais_de_contato set situacao = 'desconectado', atualizado_em = now() where id = $1 and empresa_id = empresa_ativa()",
      [canalId],
    );
    return { antes: a, numeroEmUso: true };
  }
}

/** Avisa os administradores e a equipe do canal (tela, push e Telegram) de que o número caiu. */
async function avisarQueCaiu(c: pg.PoolClient, canal: Canal, texto: string) {
  const r = await c.query<{ pessoa_id: string }>(
    `select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
        and (perfil = 'administrador' or ($1::text is not null and area = $1))`,
    [canal.area],
  );
  for (const v of r.rows)
    await criarAviso(c, { pessoaId: v.pessoa_id, tipo: "canal_desconectado", texto, link: "/canais" });
}

export interface OpcoesDosAvisosDaEvolution {
  poolApp: pg.Pool;
  evolution: ClienteDaEvolution;
  log: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
}

const SISTEMA = { tipo: "sistema" as const, servico: "evolution" };
const ORIGEM_DO_SISTEMA = { canal: "sistema" as const, ip: null, aparelho: null };

/**
 * Trata um aviso da Evolution (trabalho da fila). Conectou: o canal fica conectado, com o número. Caiu depois de
 * conectado: fica desconectado, e os administradores e a equipe do canal são avisados. O QR code que expira antes de
 * alguém ler não avisa ninguém. Os avisos de mensagem são da M8-03.
 */
export async function tratarAvisoDaEvolution(
  o: OpcoesDosAvisosDaEvolution,
  aviso: AvisoDaEvolution,
): Promise<void> {
  const quem = daInstancia(aviso.instance);
  if (!quem)
    return o.log.warn({ evento: "evolution.instancia_desconhecida" }, "Aviso de instância que não é nossa");
  if (aviso.event !== "connection.update" && aviso.event !== "CONNECTION_UPDATE") return;
  const data = (aviso.data ?? {}) as { state?: unknown; wuid?: unknown };
  const estado = data.state;
  if (estado !== "open" && estado !== "close") return;
  const nome = aviso.instance;
  // Ao conectar, o número vem no aviso; se não vier, a Evolution informa.
  const numero =
    estado === "open"
      ? (numeroDoJid(data.wuid) ?? (await o.evolution.situacao(nome).catch(() => null))?.numero ?? null)
      : null;
  const feito = await comEmpresa(o.poolApp, quem.empresaId, async (c) => {
    const canal = await buscarCanal(c, quem.canalId);
    if (!canal || canal.provedor !== "evolution") return null;
    if (estado === "open") {
      const m = await marcarSituacao(c, canal.id, "conectado", numero);
      if (m?.numeroEmUso) {
        await avisarQueCaiu(
          c,
          canal,
          `O número lido no canal "${canal.nome}" já está conectado em outro canal. Use outro número.`,
        );
        return { acao: "canal.desconectou" as const, canal, numeroEmUso: true };
      }
      return m && m.antes !== "conectado"
        ? { acao: "canal.conectou" as const, canal, numeroEmUso: false }
        : null;
    }
    if (canal.situacao !== "conectado") return null;
    await marcarSituacao(c, canal.id, "desconectado");
    await avisarQueCaiu(
      c,
      canal,
      `O número de WhatsApp do canal "${canal.nome}" foi desconectado e as mensagens dos clientes não estão chegando. Leia o QR code de novo em Canais.`,
    );
    return { acao: "canal.desconectou" as const, canal, numeroEmUso: false };
  });
  if (!feito) return;
  if (feito.numeroEmUso) await o.evolution.desconectar(nome).catch(() => {});
  await auditar(
    o.poolApp,
    {
      empresaId: quem.empresaId,
      ator: SISTEMA,
      acao: feito.acao,
      alvo: { tipo: "canal", id: feito.canal.id },
      origem: ORIGEM_DO_SISTEMA,
      rastreio: null,
      detalhes: feito.numeroEmUso ? { motivo: "numero_em_uso" } : {},
    },
    o.log,
  );
}

function mesmoSegredo(recebido: unknown, esperado: string): boolean {
  if (typeof recebido !== "string") return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

const naoEncontrado = (resposta: FastifyReply) =>
  resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Canal não encontrado." });

const semWhatsapp = (resposta: FastifyReply) =>
  resposta.code(503).send({
    code: "WHATSAPP_DESLIGADO",
    message: "A conexão de WhatsApp ainda não está ligada neste ambiente.",
  });

export interface OpcoesDasRotasDosCanais {
  verificador: Verificador;
  poolApp: pg.Pool;
  /** Nulo: a Evolution não está configurada neste ambiente (a tela avisa). */
  evolution: { cliente: ClienteDaEvolution; segredo: string } | null;
  /** Leva o aviso da Evolution à fila (na API) ou trata na hora (nos testes). */
  receber: (aviso: AvisoDaEvolution) => Promise<void>;
}

export function registrarRotasDosCanais(app: FastifyInstance, o: OpcoesDasRotasDosCanais): void {
  const { verificador, poolApp } = o;
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const registrar = (
    pedido: FastifyRequest,
    acao: string,
    id: string,
    detalhes: Record<string, unknown> = {},
  ) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "canal", id },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  };
  const tratar = async <T>(resposta: FastifyReply, trabalho: () => Promise<T>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof RecusaDasConversas)
        return resposta.code(400).send({ code: "CANAL_RECUSADO", message: erro.message });
      if (erro instanceof ErroDaEvolution) {
        resposta.log.warn({ erro: erro.message }, "Evolution");
        return resposta.code(502).send({
          code: "EVOLUTION_FORA",
          message: "A conexão de WhatsApp não respondeu agora. Tente de novo em alguns minutos.",
        });
      }
      throw erro;
    }
  };

  // Os avisos da Evolution: só pela rede interna do servidor (o Caddy não deixa /api/interno passar) e com o segredo.
  if (o.evolution) {
    const segredo = o.evolution.segredo;
    app.post("/interno/evolution/avisos", { bodyLimit: 1024 * 1024 }, async (pedido, resposta) => {
      if (!mesmoSegredo(pedido.headers[CABECALHO_DO_SEGREDO], segredo))
        return resposta.code(401).send({ code: "SEM_SEGREDO" });
      const r = conferir(AvisoDaEvolution, pedido.body);
      // Formato desconhecido: 200 mesmo assim, senão a Evolution manda de novo sem parar.
      if (!r.ok) return { ok: true };
      await o.receber(r.valor);
      return { ok: true };
    });
  }

  app.get("/canais", { preHandler: verificador.exigir("canais", "ver") }, async (pedido) =>
    naEmpresa(pedido, async (c) => ({ canais: await listarCanais(c), whatsappLigado: o.evolution !== null })),
  );

  app.post("/canais", { preHandler: verificador.exigir("canais", "criar") }, async (pedido, resposta) => {
    const r = conferir(PedidoDeCanalDeWhatsapp, pedido.body);
    if (!r.ok) return invalido(resposta, r.problemas);
    const evolution = o.evolution;
    if (!evolution) return semWhatsapp(resposta);
    const { sessao } = acessoDo(pedido);
    return tratar(resposta, async () => {
      // A instância é criada dentro da transação: se a Evolution recusar, o canal não fica pela metade.
      const canal = await naEmpresa(pedido, async (c) => {
        const novo = await criarCanal(c, sessao.pessoa.id, {
          nome: r.valor.nome,
          provedor: "evolution",
          area: r.valor.area ?? null,
        });
        await evolution.cliente.criarInstancia(nomeDaInstancia(sessao.empresaId, novo.id));
        return novo;
      });
      await registrar(pedido, "canal.criou", canal.id, { provedor: "evolution" });
      return resposta.code(201).send({ canal });
    });
  });

  app.post(
    "/canais/:id",
    { preHandler: verificador.exigir("canais", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeEditarCanal, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const feito = await naEmpresa(pedido, async (c) => {
        const antes = await buscarCanal(c, id, true);
        if (!antes) return null;
        await c.query(
          `update canais_de_contato set nome = coalesce($2, nome),
                area = case when $3::boolean then $4 else area end, atualizado_em = now()
          where id = $1 and empresa_id = empresa_ativa()`,
          [id, r.valor.nome?.trim() ?? null, r.valor.area !== undefined, r.valor.area ?? null],
        );
        return { antes, depois: (await buscarCanal(c, id)) as Canal };
      });
      if (!feito) return naoEncontrado(resposta);
      const campos = (["nome", "area"] as const).filter((k) => feito.antes[k] !== feito.depois[k]);
      if (campos.length > 0) await registrar(pedido, "canal.editou", id, { campos });
      return { canal: feito.depois };
    },
  );

  // O QR code para ler no celular. A situação é conferida na Evolution também (um aviso pode ter se perdido).
  app.get(
    "/canais/:id/qr",
    { preHandler: verificador.exigir("canais", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const evolution = o.evolution;
      if (!evolution) return semWhatsapp(resposta);
      const { sessao } = acessoDo(pedido);
      return tratar(resposta, async (): Promise<QrDoCanal | FastifyReply> => {
        const canal = await naEmpresa(pedido, (c) => buscarCanal(c, id));
        if (!canal || canal.provedor !== "evolution") return naoEncontrado(resposta);
        const nome = nomeDaInstancia(sessao.empresaId, id);
        const agora = await evolution.cliente.situacao(nome);
        if (agora.estado === "open") {
          if (canal.situacao !== "conectado")
            await tratarAvisoDaEvolution(
              { poolApp, evolution: evolution.cliente, log: pedido.log },
              { event: "connection.update", instance: nome, data: { state: "open" } },
            );
          const depois = await naEmpresa(pedido, (c) => buscarCanal(c, id));
          return {
            situacao: depois?.situacao ?? "conectado",
            qr: null,
            identificador: depois?.identificador ?? null,
          };
        }
        if (canal.situacao === "pausado")
          return { situacao: "pausado", qr: null, identificador: canal.identificador };
        const qr = await evolution.cliente.pedirQr(nome);
        if (canal.situacao === "desconectado")
          await naEmpresa(pedido, (c) => marcarSituacao(c, id, "esperando_conexao"));
        return { situacao: "esperando_conexao", qr, identificador: canal.identificador };
      });
    },
  );

  app.post(
    "/canais/:id/desconectar",
    { preHandler: verificador.exigir("canais", "editar") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const evolution = o.evolution;
      if (!evolution) return semWhatsapp(resposta);
      const { sessao } = acessoDo(pedido);
      return tratar(resposta, async () => {
        const canal = await naEmpresa(pedido, (c) => buscarCanal(c, id));
        if (!canal || canal.provedor !== "evolution") return naoEncontrado(resposta);
        await evolution.cliente.desconectar(nomeDaInstancia(sessao.empresaId, id));
        await naEmpresa(pedido, (c) => marcarSituacao(c, id, "desconectado"));
        await registrar(pedido, "canal.desconectou", id);
        return { canal: await naEmpresa(pedido, (c) => buscarCanal(c, id)) };
      });
    },
  );

  // Apagar só o canal sem conversas (o banco recusa o resto): para os outros, desconectar.
  app.delete(
    "/canais/:id",
    { preHandler: verificador.exigir("canais", "excluir") },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const { sessao } = acessoDo(pedido);
      return tratar(resposta, async () => {
        const apagado = await naEmpresa(pedido, async (c) => {
          const canal = await buscarCanal(c, id, true);
          if (!canal) return null;
          const conversas = await c.query(
            "select 1 from conversas_com_contatos where canal_id = $1 and empresa_id = empresa_ativa() limit 1",
            [id],
          );
          if ((conversas.rowCount ?? 0) > 0)
            throw new RecusaDasConversas(
              "Esse canal já tem conversas e não pode ser apagado. Desconecte o número em vez disso.",
            );
          await c.query("delete from canais_de_contato where id = $1 and empresa_id = empresa_ativa()", [id]);
          if (canal.provedor === "evolution" && o.evolution)
            await o.evolution.cliente.apagarInstancia(nomeDaInstancia(sessao.empresaId, id));
          return canal;
        });
        if (!apagado) return naoEncontrado(resposta);
        await registrar(pedido, "canal.apagou", id);
        return { ok: true };
      });
    },
  );
}
