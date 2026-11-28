/**
 * O balão do site (M8-07, decisão 0057). A linha de código carrega o `balao.js`, que desenha o botão e abre um quadro
 * (iframe) com a página do balão, servida aqui. O cabeçalho da página só deixa o quadro abrir nos domínios do canal
 * (frame-ancestors); o site e o quadro não leem um ao outro (só trocam o endereço e o título da página).
 *
 * As rotas do balão são públicas (sem login) e ficam separadas em /balao/*: o balão se identifica pela chave pública
 * do canal (não é o id), e o visitante pelo código que o navegador guarda por 30 dias (o banco guarda só o resumo).
 * O visitante só lê e escreve a própria conversa. Proteções: os limites (por visitante, por endereço de internet e
 * por canal), o tamanho das mensagens, o campo escondido, o tempo mínimo e a prova de trabalho ao entrar.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type ConfiguracaoDoBalao,
  type ContinuarNoWhatsapp,
  conferir,
  type MensagemDoBalao,
  PedidoDeMensagemDoBalao,
  PedidoDeVisitante,
  type VisitanteDoBalao,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { auditar } from "../auditoria/registrar.ts";
import { comEmpresa } from "../empresa.ts";
import { type OpcoesDoAtendimento, pedirAoAtendente } from "./atendimento.ts";
import { buscarConversa, RecusaDasConversas, receberMensagem, trocarContatoDaConversa } from "./servico.ts";

/** Os limites do balão (decisão 0057, item 6). */
export const LIMITES_DO_BALAO = {
  /** Mensagens de um visitante em 10 minutos. */
  porVisitante: 20,
  /** Mensagens (e entradas) de um endereço de internet num minuto. */
  porEndereco: 30,
  /** Mensagens de um canal numa hora. */
  porCanal: 300,
  /** Visitantes novos de um canal numa hora. */
  visitantesPorHora: 60,
};
/** Bits zerados no começo do SHA-256 da prova de trabalho (cerca de 16 mil tentativas: menos de 1 segundo). */
export const DIFICULDADE_DO_BALAO = 14;
/** O tempo mínimo entre abrir o balão e entrar (pessoas não escrevem em menos de 2 segundos). */
const SEGUNDOS_MINIMOS = 2;
/** O desafio vale 10 minutos. */
const MINUTOS_DO_DESAFIO = 10;
/** O código de "continuar no WhatsApp": sem as letras e os números parecidos (I, O, 0, 1). */
const LETRAS_DO_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface OpcoesDoBalao {
  poolApp: pg.Pool;
  /** O segredo que assina os desafios e o sal do resumo dos endereços de internet. */
  segredo: string;
  /** O endereço público do Mago OS (as rotas do balão só aceitam pedido do próprio quadro). */
  urlPublica: string;
  atendimento: OpcoesDoAtendimento;
  log: { warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex");
const CHAVE = /^[A-Za-z0-9]{22}$/;
const CODIGO = /^[A-Za-z0-9_-]{43}$/;

/** Os arquivos do balão: o script da linha de código, o do quadro e o estilo. */
const ARQUIVOS = {
  "balao.js": readFileSync(new URL("./balao/balao.js", import.meta.url), "utf8"),
  "quadro.js": readFileSync(new URL("./balao/quadro.js", import.meta.url), "utf8"),
  "quadro.css": readFileSync(new URL("./balao/quadro.css", import.meta.url), "utf8"),
};

class LimiteDoBalao extends Error {}

/** O canal da chave (a empresa vem do banco, por uma função que só devolve os ids). */
async function canalDaChave(
  poolApp: pg.Pool,
  chave: string,
): Promise<{ empresaId: string; canalId: string } | null> {
  if (!CHAVE.test(chave)) return null;
  const r = await poolApp.query<{ empresa_id: string; canal_id: string }>(
    "select empresa_id, canal_id from canal_do_balao($1)",
    [chave],
  );
  const l = r.rows[0];
  return l ? { empresaId: l.empresa_id, canalId: l.canal_id } : null;
}

interface CanalDoBalao {
  id: string;
  nome: string;
  dominios: string[];
  cor: string;
  posicao: "direita" | "esquerda";
  boas_vindas: string;
  politica_url: string | null;
  whatsapp: string | null;
}

async function lerCanal(c: pg.PoolClient, canalId: string): Promise<CanalDoBalao | null> {
  const r = await c.query<CanalDoBalao>(
    `select cn.id, cn.nome, cn.dominios, cn.cor, cn.posicao, cn.boas_vindas, cn.politica_url,
            w.identificador as whatsapp
       from canais_de_contato cn
       left join canais_de_contato w on w.id = cn.whatsapp_canal_id and w.empresa_id = cn.empresa_id
                                     and w.provedor = 'evolution' and w.identificador is not null
      where cn.id = $1 and cn.empresa_id = empresa_ativa() and cn.provedor = 'site' and cn.situacao <> 'pausado'`,
    [canalId],
  );
  const l = r.rows[0];
  // Sem domínio ou sem a política de privacidade, o balão não abre (decisão 0057, itens 2 e 6).
  return l && l.dominios.length > 0 && l.politica_url ? l : null;
}

/** O desafio da prova de trabalho: o canal, a hora e um sal, assinados (não precisa guardar nada). */
export function criarDesafio(segredo: string, canalId: string, agora = Date.now()): string {
  const corpo = Buffer.from(
    JSON.stringify({ c: canalId, t: agora, n: randomBytes(12).toString("base64url") }),
  ).toString("base64url");
  return `${corpo}.${createHmac("sha256", segredo).update(corpo).digest("base64url")}`;
}

/** Os primeiros bits do SHA-256 do desafio com a resposta são zero. */
export function provaValida(desafio: string, resposta: string, dificuldade = DIFICULDADE_DO_BALAO): boolean {
  const h = createHash("sha256").update(`${desafio}:${resposta}`).digest();
  let bits = dificuldade;
  for (const byte of h) {
    if (bits <= 0) return true;
    if (bits >= 8) {
      if (byte !== 0) return false;
      bits -= 8;
    } else return byte >> (8 - bits) === 0;
  }
  return true;
}

/** Confere o desafio: assinado por nós, do canal, nem novo demais (o tempo mínimo) nem vencido. */
export function desafioValido(
  segredo: string,
  canalId: string,
  desafio: string,
  agora = Date.now(),
): boolean {
  const [corpo, assinatura] = desafio.split(".");
  if (!corpo || !assinatura) return false;
  const certa = Buffer.from(createHmac("sha256", segredo).update(corpo).digest("base64url"));
  const veio = Buffer.from(assinatura);
  if (certa.length !== veio.length || !timingSafeEqual(certa, veio)) return false;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as { c?: string; t?: number };
    if (d.c !== canalId || typeof d.t !== "number") return false;
    const idade = agora - d.t;
    return idade >= SEGUNDOS_MINIMOS * 1000 && idade <= MINUTOS_DO_DESAFIO * 60_000;
  } catch {
    return false;
  }
}

/** O endereço de internet de quem pede (o que o Caddy informa), só como resumo com sal. */
function enderecoDe(pedido: FastifyRequest, segredo: string): string {
  const encaminhado = pedido.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(encaminhado) ? encaminhado[0] : encaminhado)?.split(",")[0]?.trim() || pedido.ip || "?";
  return sha256(`${segredo}:balao:${ip}`);
}

/** Conta o pedido do endereço de internet e recusa acima do limite por minuto. */
async function contarEndereco(c: pg.PoolClient, canalId: string, ipHash: string): Promise<void> {
  const r = await c.query<{ n: number }>(
    `select count(*)::int as n from pedidos_do_balao
      where canal_id = $1 and empresa_id = empresa_ativa() and ip_hash = $2 and criado_em > now() - interval '1 minute'`,
    [canalId, ipHash],
  );
  if ((r.rows[0]?.n ?? 0) >= LIMITES_DO_BALAO.porEndereco) throw new LimiteDoBalao();
  await c.query(
    "insert into pedidos_do_balao (empresa_id, canal_id, ip_hash) values (empresa_ativa(), $1, $2)",
    [canalId, ipHash],
  );
}

/** O visitante do código, no canal (renova os 30 dias a cada uso). */
async function visitanteDoCodigo(c: pg.PoolClient, canalId: string, codigo: string): Promise<string | null> {
  if (!CODIGO.test(codigo)) return null;
  const r = await c.query<{ id: string }>(
    `update visitantes_do_site set visto_em = now(), vence_em = now() + interval '30 days'
      where codigo_hash = $1 and canal_id = $2 and empresa_id = empresa_ativa() and vence_em > now()
      returning id`,
    [sha256(codigo), canalId],
  );
  return r.rows[0]?.id ?? null;
}

/** As conversas do visitante no balão (a nota interna nunca sai). */
async function mensagensDoVisitante(
  c: pg.PoolClient,
  canalId: string,
  visitanteId: string,
  aberto: boolean,
): Promise<MensagemDoBalao[]> {
  const r = await c.query<{
    id: string;
    autor: string;
    texto: string | null;
    tipo: string;
    enviada_em: Date;
    agente: string | null;
    pessoa: string | null;
    canal: string;
  }>(
    `select m.id, m.autor, m.texto, m.tipo, m.enviada_em, a.nome as agente, split_part(p.nome, ' ', 1) as pessoa,
            cn.nome as canal
       from mensagens_com_contatos m
       join conversas_com_contatos cv on cv.id = m.conversa_id and cv.empresa_id = m.empresa_id
       join canais_de_contato cn on cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
       left join agentes a on a.id = m.autor_agente_id and a.empresa_id = m.empresa_id
       left join pessoas p on p.id = m.autor_pessoa_id
      where m.empresa_id = empresa_ativa() and cv.canal_id = $1 and cv.identificador = $2 and m.direcao <> 'interna'
        and (m.entrega is null or m.entrega <> 'falhou')
      order by m.enviada_em desc, m.id desc limit 100`,
    [canalId, `visitante:${visitanteId}`],
  );
  // O que a empresa mandou chega ao balão: entregue; com o balão aberto, lida.
  await c.query(
    `update mensagens_com_contatos m set entrega = $3
       from conversas_com_contatos cv
      where cv.id = m.conversa_id and cv.empresa_id = m.empresa_id and m.empresa_id = empresa_ativa()
        and cv.canal_id = $1 and cv.identificador = $2 and m.direcao = 'saiu'
        and m.entrega in ('pendente', 'enviada'${aberto ? ", 'entregue'" : ""})`,
    [canalId, `visitante:${visitanteId}`, aberto ? "lida" : "entregue"],
  );
  return r.rows.reverse().map((l) => ({
    id: l.id,
    de: l.autor === "contato" ? "visitante" : "empresa",
    nome:
      l.autor === "contato"
        ? null
        : l.autor === "agente"
          ? l.agente
          : l.autor === "pessoa"
            ? l.pessoa
            : l.canal,
    texto: l.texto ?? (l.tipo === "texto" ? "" : "A equipe mandou um arquivo. Peça o link por aqui."),
    enviadaEm: l.enviada_em.toISOString(),
  }));
}

/** A política de conteúdo da página do balão: só os domínios do canal podem abrir o quadro. */
export function politicaDoQuadro(dominios: string[]): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    `frame-ancestors ${dominios.join(" ")}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Conversa</title>
<link rel="stylesheet" href="/balao/quadro.css">
</head>
<body>
<main id="balao" aria-live="polite"></main>
<script src="/balao/quadro.js"></script>
</body>
</html>
`;

/** O código de "continuar no WhatsApp". */
function novoCodigo(): string {
  return [...randomBytes(6)].map((b) => LETRAS_DO_CODIGO[b % LETRAS_DO_CODIGO.length]).join("");
}

export function registrarRotasDoBalao(app: FastifyInstance, o: OpcoesDoBalao): void {
  const nossaOrigem = new URL(o.urlPublica).origin;
  const auditarDoBalao = (empresaId: string, acao: string, alvo: string, detalhes: Record<string, unknown>) =>
    auditar(
      o.poolApp,
      {
        empresaId,
        ator: { tipo: "sistema", servico: "balao" },
        acao,
        alvo: { tipo: "canal", id: alvo },
        origem: { canal: "sistema", ip: null, aparelho: null },
        rastreio: null,
        detalhes,
      },
      o.log as Parameters<typeof auditar>[2],
    );

  /** As rotas do quadro só aceitam pedido do próprio Mago OS (o navegador manda a origem nos POST). */
  const deFora = (pedido: FastifyRequest) => {
    const origem = pedido.headers.origin;
    return typeof origem === "string" && origem !== nossaOrigem;
  };
  const naoAchou = (resposta: FastifyReply) =>
    resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Balão não encontrado." });
  const tratar = async (resposta: FastifyReply, trabalho: () => Promise<unknown>) => {
    try {
      return await trabalho();
    } catch (erro) {
      if (erro instanceof LimiteDoBalao)
        return resposta.code(429).send({
          code: "LIMITE",
          message: "Muitas mensagens em pouco tempo. Espere um pouco e tente de novo.",
        });
      if (erro instanceof RecusaDasConversas)
        return resposta.code(400).send({ code: "RECUSADO", message: erro.message });
      throw erro;
    }
  };

  // Os arquivos do balão (o script da linha de código pode ser lido de qualquer site).
  for (const [nome, tipo] of [
    ["balao.js", "text/javascript; charset=utf-8"],
    ["quadro.js", "text/javascript; charset=utf-8"],
    ["quadro.css", "text/css; charset=utf-8"],
  ] as const)
    app.get(nome === "balao.js" ? "/balao.js" : `/balao/${nome}`, async (_pedido, resposta) =>
      resposta
        .header("content-type", tipo)
        .header("cache-control", "public, max-age=3600")
        .header("x-content-type-options", "nosniff")
        .header("cross-origin-resource-policy", "cross-origin")
        .send(ARQUIVOS[nome]),
    );

  // A página do quadro: abre só dentro dos domínios do canal.
  app.get("/balao/:chave", async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    const achado = await canalDaChave(o.poolApp, chave);
    const canal = achado
      ? await comEmpresa(o.poolApp, achado.empresaId, (c) => lerCanal(c, achado.canalId))
      : null;
    if (!canal) return naoAchou(resposta);
    return resposta
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .header("content-security-policy", politicaDoQuadro(canal.dominios))
      .header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff")
      .header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
      .send(PAGINA);
  });

  // O que o balão mostra. O script da linha de código lê daqui, do site do cliente: só os domínios do canal.
  app.get("/balao/:chave/configuracao", async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    const achado = await canalDaChave(o.poolApp, chave);
    const canal = achado
      ? await comEmpresa(o.poolApp, achado.empresaId, (c) => lerCanal(c, achado.canalId))
      : null;
    if (!canal) return naoAchou(resposta);
    const origem = pedido.headers.origin;
    if (typeof origem === "string" && origem !== nossaOrigem) {
      if (!canal.dominios.includes(origem)) return naoAchou(resposta);
      resposta.header("access-control-allow-origin", origem).header("vary", "Origin");
    }
    const config: ConfiguracaoDoBalao = {
      nome: canal.nome,
      cor: canal.cor,
      posicao: canal.posicao,
      boasVindas: canal.boas_vindas,
      politicaUrl: canal.politica_url as string,
      whatsapp: !!canal.whatsapp,
    };
    return resposta.header("cache-control", "no-store").send(config);
  });

  // O desafio da prova de trabalho (pedido quando o balão abre).
  app.get("/balao/:chave/desafio", async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    if (deFora(pedido)) return naoAchou(resposta);
    const achado = await canalDaChave(o.poolApp, chave);
    if (!achado) return naoAchou(resposta);
    return resposta
      .header("cache-control", "no-store")
      .send({ desafio: criarDesafio(o.segredo, achado.canalId), dificuldade: DIFICULDADE_DO_BALAO });
  });

  // Entrar como visitante: a prova resolvida, o campo escondido vazio e os limites.
  app.post("/balao/:chave/visitante", { bodyLimit: 4096 }, async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    if (deFora(pedido)) return naoAchou(resposta);
    const achado = await canalDaChave(o.poolApp, chave);
    if (!achado) return naoAchou(resposta);
    const r = conferir(PedidoDeVisitante, pedido.body);
    if (!r.ok) return resposta.code(400).send({ code: "INVALIDO", message: "Pedido inválido." });
    // O campo escondido preenchido, o desafio de outro lugar ou a prova errada: robô.
    if (
      r.valor.site ||
      !desafioValido(o.segredo, achado.canalId, r.valor.desafio) ||
      !provaValida(r.valor.desafio, r.valor.resposta)
    )
      return resposta
        .code(400)
        .send({ code: "PROVA", message: "Não deu para abrir a conversa. Recarregue a página." });
    const ipHash = enderecoDe(pedido, o.segredo);
    return tratar(resposta, async () => {
      const feito = await comEmpresa(o.poolApp, achado.empresaId, async (c) => {
        if (!(await lerCanal(c, achado.canalId))) return null;
        await contarEndereco(c, achado.canalId, ipHash);
        const novos = await c.query<{ n: number }>(
          `select count(*)::int as n from visitantes_do_site
            where canal_id = $1 and empresa_id = empresa_ativa() and criado_em > now() - interval '1 hour'`,
          [achado.canalId],
        );
        if ((novos.rows[0]?.n ?? 0) >= LIMITES_DO_BALAO.visitantesPorHora) throw new LimiteDoBalao();
        const codigo = randomBytes(32).toString("base64url");
        const v = await c.query<{ id: string; vence_em: Date }>(
          `insert into visitantes_do_site (empresa_id, canal_id, codigo_hash, prova_hash)
           values (empresa_ativa(), $1, $2, $3) on conflict (prova_hash) do nothing returning id, vence_em`,
          [achado.canalId, sha256(codigo), sha256(r.valor.desafio)],
        );
        const l = v.rows[0];
        if (!l) return "repetida" as const;
        return { codigo, venceEm: l.vence_em.toISOString(), id: l.id };
      });
      if (!feito) return naoAchou(resposta);
      if (feito === "repetida")
        return resposta
          .code(400)
          .send({ code: "PROVA", message: "Não deu para abrir a conversa. Recarregue a página." });
      await auditarDoBalao(achado.empresaId, "balao.visitante_entrou", achado.canalId, {
        visitanteId: feito.id,
      });
      const corpo: VisitanteDoBalao = { codigo: feito.codigo, venceEm: feito.venceEm };
      return resposta.code(201).header("cache-control", "no-store").send(corpo);
    });
  });

  const doVisitante = (pedido: FastifyRequest) => {
    const v = pedido.headers["x-visitante"];
    return typeof v === "string" ? v : "";
  };

  // O visitante escreve: só texto, até 1.000 letras, com a página; o agente do canal atende.
  app.post("/balao/:chave/mensagens", { bodyLimit: 8192 }, async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    if (deFora(pedido)) return naoAchou(resposta);
    const achado = await canalDaChave(o.poolApp, chave);
    if (!achado) return naoAchou(resposta);
    const r = conferir(PedidoDeMensagemDoBalao, pedido.body);
    if (!r.ok || !r.valor.texto.trim())
      return resposta.code(400).send({ code: "INVALIDO", message: "Escreva até 1.000 letras." });
    const ipHash = enderecoDe(pedido, o.segredo);
    return tratar(resposta, async () => {
      const feito = await comEmpresa(o.poolApp, achado.empresaId, async (c) => {
        if (!(await lerCanal(c, achado.canalId))) return null;
        const visitanteId = await visitanteDoCodigo(c, achado.canalId, doVisitante(pedido));
        if (!visitanteId) return "sem_visitante" as const;
        await contarEndereco(c, achado.canalId, ipHash);
        const contagem = await c.query<{ do_visitante: number; do_canal: number }>(
          `select count(*) filter (where cv.identificador = $2 and m.enviada_em > now() - interval '10 minutes')::int
                    as do_visitante,
                  count(*)::int as do_canal
             from mensagens_com_contatos m
             join conversas_com_contatos cv on cv.id = m.conversa_id and cv.empresa_id = m.empresa_id
            where m.empresa_id = empresa_ativa() and m.canal_id = $1 and m.direcao = 'chegou'
              and m.enviada_em > now() - interval '1 hour'`,
          [achado.canalId, `visitante:${visitanteId}`],
        );
        const n = contagem.rows[0];
        if ((n?.do_visitante ?? 0) >= LIMITES_DO_BALAO.porVisitante) throw new LimiteDoBalao();
        if ((n?.do_canal ?? 0) >= LIMITES_DO_BALAO.porCanal) throw new LimiteDoBalao();
        const recebida = await receberMensagem(c, {
          canalId: achado.canalId,
          identificador: `visitante:${visitanteId}`,
          nomeDoPerfil: null,
          tipo: "texto",
          texto: r.valor.texto.trim(),
          ...(r.valor.pagina ? { pagina: r.valor.pagina } : {}),
        });
        return { ...recebida, visitanteId };
      });
      if (!feito) return naoAchou(resposta);
      if (feito === "sem_visitante")
        return resposta
          .code(401)
          .send({ code: "VISITANTE", message: "A conversa venceu. Recarregue a página." });
      await auditarDoBalao(achado.empresaId, "balao.mensagem_chegou", achado.canalId, {
        visitanteId: feito.visitanteId,
        conversaId: feito.conversaId,
        mensagemId: feito.mensagemId,
      });
      if (feito.mensagemId)
        await pedirAoAtendente(o.atendimento, achado.empresaId, feito.conversaId).catch((erro: unknown) =>
          o.log.error({ erro: (erro as Error).message }, "Balão: não pediu ao agente"),
        );
      return resposta.code(201).send({ mensagemId: feito.mensagemId });
    });
  });

  // As mensagens da conversa do visitante (o quadro pergunta a cada poucos segundos).
  app.get("/balao/:chave/mensagens", async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    if (deFora(pedido)) return naoAchou(resposta);
    const achado = await canalDaChave(o.poolApp, chave);
    if (!achado) return naoAchou(resposta);
    const aberto = (pedido.query as { aberto?: string }).aberto === "1";
    const feito = await comEmpresa(o.poolApp, achado.empresaId, async (c) => {
      if (!(await lerCanal(c, achado.canalId))) return null;
      const visitanteId = await visitanteDoCodigo(c, achado.canalId, doVisitante(pedido));
      if (!visitanteId) return "sem_visitante" as const;
      return mensagensDoVisitante(c, achado.canalId, visitanteId, aberto);
    });
    if (!feito) return naoAchou(resposta);
    if (feito === "sem_visitante")
      return resposta
        .code(401)
        .send({ code: "VISITANTE", message: "A conversa venceu. Recarregue a página." });
    return resposta.header("cache-control", "no-store").send({ mensagens: feito });
  });

  // "Continuar no WhatsApp": o link do wa.me com o código (30 minutos, uso único).
  app.post("/balao/:chave/whatsapp", { bodyLimit: 1024 }, async (pedido, resposta) => {
    const { chave } = pedido.params as { chave: string };
    if (deFora(pedido)) return naoAchou(resposta);
    const achado = await canalDaChave(o.poolApp, chave);
    if (!achado) return naoAchou(resposta);
    const ipHash = enderecoDe(pedido, o.segredo);
    return tratar(resposta, async () => {
      const feito = await comEmpresa(o.poolApp, achado.empresaId, async (c) => {
        const canal = await lerCanal(c, achado.canalId);
        if (!canal?.whatsapp) return null;
        const visitanteId = await visitanteDoCodigo(c, achado.canalId, doVisitante(pedido));
        if (!visitanteId) return "sem_visitante" as const;
        await contarEndereco(c, achado.canalId, ipHash);
        const w = await c.query<{ id: string }>(
          "select whatsapp_canal_id as id from canais_de_contato where id = $1 and empresa_id = empresa_ativa()",
          [achado.canalId],
        );
        for (let tentativa = 0; tentativa < 5; tentativa++) {
          const codigo = novoCodigo();
          const r = await c.query<{ vence_em: Date }>(
            `insert into codigos_para_o_whatsapp (empresa_id, visitante_id, whatsapp_canal_id, codigo)
             values (empresa_ativa(), $1, $2, $3) on conflict do nothing returning vence_em`,
            [visitanteId, w.rows[0]?.id, codigo],
          );
          const l = r.rows[0];
          if (l) {
            const texto = `Oi! Vim do site (código ${codigo}).`;
            const link = `https://wa.me/${canal.whatsapp.slice(1)}?text=${encodeURIComponent(texto)}`;
            return { link, codigo, venceEm: l.vence_em.toISOString(), visitanteId } as ContinuarNoWhatsapp & {
              visitanteId: string;
            };
          }
        }
        throw new RecusaDasConversas("Não deu para gerar o código agora. Tente de novo.");
      });
      if (!feito) return naoAchou(resposta);
      if (feito === "sem_visitante")
        return resposta
          .code(401)
          .send({ code: "VISITANTE", message: "A conversa venceu. Recarregue a página." });
      await auditarDoBalao(achado.empresaId, "balao.pediu_whatsapp", achado.canalId, {
        visitanteId: feito.visitanteId,
      });
      const corpo: ContinuarNoWhatsapp = { link: feito.link, codigo: feito.codigo, venceEm: feito.venceEm };
      return resposta.code(201).send(corpo);
    });
  });
}

/**
 * A mensagem que chega pelo WhatsApp com o código do balão (válido, de uso único): o visitante vira o contato daquele
 * telefone, e as conversas do site passam para ele (a linha do tempo mostra as duas). Sem código válido, nada muda.
 * Roda dentro de comEmpresa, logo depois de gravar a mensagem.
 */
export async function usarCodigoDoSite(
  c: pg.PoolClient,
  whatsappCanalId: string,
  contatoId: string,
  texto: string | null | undefined,
): Promise<{ visitanteId: string } | null> {
  const achado = /c[oó]digo\s+([A-HJ-NP-Z2-9]{6})\b/i.exec(texto ?? "");
  if (!achado?.[1]) return null;
  const r = await c.query<{ visitante_id: string }>(
    `update codigos_para_o_whatsapp set usado_em = now()
      where whatsapp_canal_id = $1 and codigo = $2 and empresa_id = empresa_ativa() and usado_em is null
        and vence_em > now()
      returning visitante_id`,
    [whatsappCanalId, achado[1].toUpperCase()],
  );
  const visitanteId = r.rows[0]?.visitante_id;
  if (!visitanteId) return null;
  const v = await c.query<{ contato_id: string | null; canal_id: string }>(
    "select contato_id, canal_id from visitantes_do_site where id = $1 and empresa_id = empresa_ativa() for update",
    [visitanteId],
  );
  const antes = v.rows[0];
  if (!antes) return null;
  const conversas = await c.query<{ id: string }>(
    `select id from conversas_com_contatos where empresa_id = empresa_ativa() and canal_id = $1 and identificador = $2
      order by aberta_em`,
    [antes.canal_id, `visitante:${visitanteId}`],
  );
  const todos = [{ pessoaId: "00000000-0000-0000-0000-000000000000", alcance: "tudo" as const, area: null }];
  for (const { id } of conversas.rows) {
    const conversa = await buscarConversa(c, todos, id);
    if (conversa) await trocarContatoDaConversa(c, conversa, contatoId).catch(() => {});
  }
  await c.query(
    "update visitantes_do_site set contato_id = $2 where id = $1 and empresa_id = empresa_ativa()",
    [visitanteId, contatoId],
  );
  // O contato do visitante, sem nome nem conversa sobrando, não fica de enfeite.
  if (antes.contato_id && antes.contato_id !== contatoId)
    await apagarContatoDoVisitanteSeVazio(c, antes.contato_id);
  return { visitanteId };
}

/** Apaga o contato "Visitante do site" que ficou sem conversa e sem ser identificado. */
async function apagarContatoDoVisitanteSeVazio(c: pg.PoolClient, contatoId: string): Promise<void> {
  await c.query("savepoint visitante_vazio");
  try {
    await c.query(
      `delete from contatos k where k.id = $1 and k.empresa_id = empresa_ativa() and not k.identificado
          and not exists (select 1 from conversas_com_contatos cv where cv.contato_id = k.id and cv.empresa_id = k.empresa_id)
          and not exists (select 1 from identificadores_de_contato i where i.contato_id = k.id and i.empresa_id = k.empresa_id)`,
      [contatoId],
    );
    await c.query("release savepoint visitante_vazio");
  } catch {
    // Ligado a outra coisa (uma tarefa, um anexo): fica.
    await c.query("rollback to savepoint visitante_vazio");
  }
}

/**
 * A verificação diária do balão: os visitantes vencidos saem (o código para de valer), os pedidos de mais de um dia
 * saem, e a conversa do visitante que não deixou contato some depois de 90 dias, com o contato dele (decisão 9).
 */
export async function cuidarDosVisitantesVencidos(poolApp: pg.Pool): Promise<number> {
  const empresas = await poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_visitantes_vencidos()",
  );
  let n = 0;
  for (const { empresa_id } of empresas.rows)
    n += await comEmpresa(poolApp, empresa_id, async (c) => {
      await c.query("delete from visitantes_do_site where empresa_id = empresa_ativa() and vence_em < now()");
      await c.query(
        "delete from pedidos_do_balao where empresa_id = empresa_ativa() and criado_em < now() - interval '1 day'",
      );
      const velhas = await c.query<{ id: string; contato_id: string }>(
        `delete from conversas_com_contatos cv using canais_de_contato cn, contatos k
          where cv.empresa_id = empresa_ativa() and cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
            and k.id = cv.contato_id and k.empresa_id = cv.empresa_id and cn.provedor = 'site' and not k.identificado
            and coalesce(cv.ultima_mensagem_em, cv.aberta_em) < now() - interval '90 days'
          returning cv.id, cv.contato_id`,
      );
      for (const l of velhas.rows) await apagarContatoDoVisitanteSeVazio(c, l.contato_id);
      return velhas.rows.length;
    });
  return n;
}
