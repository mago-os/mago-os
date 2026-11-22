/**
 * Aprovar pelo Telegram (M5-04, decisão 0035).
 *
 * - O pedido de aprovação vai ao Telegram de quem pediu e do responsável pelo agente (os mesmos do aviso no app), com
 *   os botões Aprovar, Recusar e Abrir no app. Cada envio guarda a conferência mostrada.
 * - Aprovar abre um pedido de código de 5 minutos; a próxima mensagem com 6 dígitos é conferida com o app
 *   autenticador da pessoa e apagada do chat. Três erros em 15 minutos travam as aprovações pelo Telegram.
 * - Recusar pede o motivo na próxima mensagem.
 * - A decisão roda pelo mesmo serviço do app (decidirAprovacao), com a conferência do envio.
 * - Decidido (por aqui ou no app) ou vencido, a mensagem do pedido é editada com o que aconteceu, sem os botões.
 */
import {
  type Aprovacao,
  type BotaoTocadoNoTelegram,
  DADOS_DOS_BOTOES,
  ERROS_DE_CODIGO_NA_APROVACAO,
  type MensagemDoTelegram,
  MINUTOS_DA_TRAVA_DAS_APROVACOES,
  MINUTOS_PARA_MANDAR_O_CODIGO,
  RESPOSTAS_DO_TELEGRAM,
  respostaDeCodigoErrado,
  respostaDePedidoJaDecidido,
  respostaPedindoCodigo,
  textoDaAprovacaoNoTelegram,
} from "@mago-os/contratos";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { buscarAprovacao, podeDecidir } from "../agentes/regras.ts";
import { decidirAprovacao, type OpcoesDeDecidir } from "../agentes-internos/aprovacoes.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import type { Autenticador } from "./autenticador.ts";
import type { BotaoDoTelegram } from "./carteiro.ts";
import { type OpcoesDoTelegram, ORIGEM_TELEGRAM, type PessoaDoTelegram } from "./servico.ts";

/** O que as aprovações pelo Telegram precisam (na API, vem das aprovações e do login). */
export interface OpcoesDasAprovacoesNoTelegram {
  decidir: OpcoesDeDecidir;
  autenticador: Autenticador;
}

const SITUACAO_EM_TEXTO: Record<string, string> = {
  aprovada: "aprovado",
  recusada: "recusado",
  vencida: "vencida",
  falhou: "aprovado, mas a ação não deu certo",
  pendente: "pendente",
};

function botoesDoPedido(aprovacaoId: string, urlPublica: string): BotaoDoTelegram[][] {
  return [
    [
      { texto: "Aprovar", dados: `ap:a:${aprovacaoId}` },
      { texto: "Recusar", dados: `ap:r:${aprovacaoId}` },
    ],
    [{ texto: "Abrir no app", url: `${urlPublica}/aprovacoes/${aprovacaoId}` }],
  ];
}

async function nomeDoAgente(c: pg.PoolClient, agenteId: string): Promise<string> {
  const r = await c.query<{ nome: string }>(
    "select nome from agentes where id = $1 and empresa_id = empresa_ativa()",
    [agenteId],
  );
  return r.rows[0]?.nome ?? "Um agente";
}

/**
 * Manda ao Telegram os pedidos pendentes que ainda não foram, e edita as mensagens dos que já foram decididos ou
 * venceram. Na verificação a cada minuto e ao fim de cada execução de agente.
 */
export async function cuidarDasAprovacoesNoTelegram(
  o: Pick<OpcoesDoTelegram, "poolApp" | "carteiro" | "log" | "conversa">,
  empresaId: string,
): Promise<{ mandadas: number; atualizadas: number }> {
  const urlPublica = o.conversa?.urlPublica ?? "";
  // 1. Reserva os envios (uma linha por pedido e pessoa: dois cuidados ao mesmo tempo não mandam duas vezes).
  const novos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    // Reserva presa (a API caiu entre reservar e mandar): solta, para mandar de novo.
    await c.query(
      "delete from aprovacoes_no_telegram where empresa_id = empresa_ativa() and mensagem_id is null and enviada_em < now() - interval '5 minutes'",
    );
    const r = await c.query<{
      aprovacao_id: string;
      pessoa_id: string;
      chat_id: string;
    }>(
      `insert into aprovacoes_no_telegram (empresa_id, aprovacao_id, pessoa_id, chat_id, conferencia)
       select p.empresa_id, p.id, t.pessoa_id, t.chat_id, p.conferencia
         from aprovacoes p
         join agentes g on g.id = p.agente_id and g.empresa_id = p.empresa_id
         join vinculos_do_telegram t on t.empresa_id = p.empresa_id and t.pessoa_id in (p.pedido_por, g.responsavel_id)
        where p.empresa_id = empresa_ativa() and p.situacao = 'pendente' and p.vence_em > now()
       on conflict do nothing
       returning aprovacao_id, pessoa_id, chat_id`,
    );
    const pedidos: { aprovacao: Aprovacao; agente: string; pessoaId: string; chatId: number }[] = [];
    for (const n of r.rows) {
      const a = await buscarAprovacao(c, n.aprovacao_id);
      if (a)
        pedidos.push({
          aprovacao: a,
          agente: await nomeDoAgente(c, a.agenteId),
          pessoaId: n.pessoa_id,
          chatId: Number(n.chat_id),
        });
    }
    return pedidos;
  });
  let mandadas = 0;
  for (const n of novos) {
    const texto = textoDaAprovacaoNoTelegram({
      agente: n.agente,
      resumo: n.aprovacao.resumo,
      motivo: n.aprovacao.motivo,
      parametros: n.aprovacao.parametros,
      venceEm: n.aprovacao.venceEm,
    });
    try {
      const mensagemId = await o.carteiro.enviar(n.chatId, texto, {
        botoes: botoesDoPedido(n.aprovacao.id, urlPublica),
      });
      await comEmpresa(o.poolApp, empresaId, (c) =>
        c.query(
          "update aprovacoes_no_telegram set mensagem_id = $3 where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = $2",
          [n.aprovacao.id, n.pessoaId, mensagemId],
        ),
      );
      mandadas++;
    } catch (erro) {
      // Não foi: solta a reserva, para a próxima verificação tentar de novo (até o pedido vencer).
      o.log.warn({ erro, aprovacaoId: n.aprovacao.id }, "Telegram: o pedido de aprovação não foi mandado");
      await comEmpresa(o.poolApp, empresaId, (c) =>
        c.query(
          "delete from aprovacoes_no_telegram where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = $2",
          [n.aprovacao.id, n.pessoaId],
        ),
      ).catch(() => {});
    }
  }

  // 2. As mensagens dos pedidos que terminaram: o texto ganha a decisão e perde os botões. Aprovado e ainda rodando
  // (sem resultado) espera, para não mostrar "aprovado" de uma ação que ainda pode falhar. Só marca depois de editar.
  const decididos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{
      aprovacao_id: string;
      pessoa_id: string;
      chat_id: string;
      mensagem_id: string;
    }>(
      `select n.aprovacao_id, n.pessoa_id, n.chat_id, n.mensagem_id from aprovacoes_no_telegram n
         join aprovacoes p on p.empresa_id = n.empresa_id and p.id = n.aprovacao_id
        where n.empresa_id = empresa_ativa() and n.atualizada_em is null and n.mensagem_id is not null
          and (p.situacao in ('recusada', 'vencida', 'falhou') or (p.situacao = 'aprovada' and p.resultado is not null)
               or (p.situacao = 'pendente' and p.vence_em <= now()))
        limit 50`,
    );
    const saida: {
      aprovacao: Aprovacao;
      agente: string;
      decidiu: string | null;
      pessoaId: string;
      chatId: number;
      mensagemId: number;
    }[] = [];
    for (const n of r.rows) {
      const a = await buscarAprovacao(c, n.aprovacao_id);
      if (!a) continue;
      const quem = a.decididaPor
        ? (await c.query<{ nome: string }>("select nome from pessoas where id = $1", [a.decididaPor])).rows[0]
            ?.nome
        : null;
      saida.push({
        aprovacao: a,
        agente: await nomeDoAgente(c, a.agenteId),
        decidiu: quem ?? null,
        pessoaId: n.pessoa_id,
        chatId: Number(n.chat_id),
        mensagemId: Number(n.mensagem_id),
      });
    }
    return saida;
  });
  let atualizadas = 0;
  for (const d of decididos) {
    const situacao = d.aprovacao.situacao === "pendente" ? "vencida" : d.aprovacao.situacao;
    const linha =
      situacao === "vencida"
        ? "Venceu: a ação não aconteceu."
        : `${d.decidiu ?? "Alguém"} decidiu: ${SITUACAO_EM_TEXTO[situacao] ?? situacao}.`;
    const texto = `${textoDaAprovacaoNoTelegram({
      agente: d.agente,
      resumo: d.aprovacao.resumo,
      motivo: d.aprovacao.motivo,
      parametros: d.aprovacao.parametros,
      venceEm: d.aprovacao.venceEm,
    })}\n\n${linha}`;
    try {
      await o.carteiro.editar(d.chatId, d.mensagemId, texto);
    } catch (erro) {
      // Fica para a próxima verificação (a mensagem continua com os botões, que respondem com a decisão).
      o.log.warn({ erro }, "Telegram: a mensagem do pedido não foi atualizada");
      continue;
    }
    await comEmpresa(o.poolApp, empresaId, (c) =>
      c.query(
        "update aprovacoes_no_telegram set atualizada_em = now() where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = $2",
        [d.aprovacao.id, d.pessoaId],
      ),
    );
    atualizadas++;
  }
  return { mandadas, atualizadas };
}

/** Travado: 3 códigos errados (15 minutos a contar do terceiro), ou o 2FA do login travado. */
async function travado(poolApp: pg.Pool, pessoaId: string): Promise<boolean> {
  const r = await poolApp.query<{ t: boolean }>("select aprovacoes_travadas_no_telegram($1) as t", [
    pessoaId,
  ]);
  return r.rows[0]?.t === true;
}

/** A pessoa administra a empresa ativa (a mesma regra do app para decidir qualquer pedido). */
async function administra(c: pg.PoolClient): Promise<boolean> {
  const v = await c.query<{ perfil: string }>(
    "select perfil from vinculos where empresa_id = empresa_ativa() and pessoa_id = pessoa_ativa() and situacao = 'ativo'",
  );
  return v.rows[0]?.perfil === "administrador";
}

/** A empresa de um pedido mandado a esta pessoa (o botão vale mesmo depois de ela trocar a empresa do Telegram). */
async function empresaDoPedido(poolApp: pg.Pool, p: PessoaDoTelegram, aprovacaoId: string): Promise<string> {
  const r = await comPessoa(poolApp, p.pessoaId, null, (c) =>
    c.query<{ empresa_id: string }>(
      "select empresa_id from aprovacoes_no_telegram where aprovacao_id = $1 and pessoa_id = pessoa_ativa()",
      [aprovacaoId],
    ),
  );
  return r.rows[0]?.empresa_id ?? p.empresaId;
}

/** O toque em Aprovar ou Recusar. Responde sempre ao botão (senão o Telegram mostra o relógio). */
export async function tocarBotaoDeAprovacao(
  o: OpcoesDoTelegram,
  p: PessoaDoTelegram,
  b: BotaoTocadoNoTelegram,
): Promise<boolean> {
  const dados = b.data ?? "";
  const aprovar = DADOS_DOS_BOTOES.aprovar.exec(dados);
  const recusar = DADOS_DOS_BOTOES.recusar.exec(dados);
  const aprovacaoId = aprovar?.[1] ?? recusar?.[1];
  if (!aprovacaoId) return false;
  const ap = o.conversa?.aprovacoes;
  await o.carteiro.responderBotao(b.id).catch(() => {});
  if (!ap) {
    await o.carteiro.enviar(p.chatId, "As aprovações pelo Telegram ainda não estão ligadas neste ambiente.");
    return true;
  }
  const empresaId = await empresaDoPedido(o.poolApp, p, aprovacaoId);
  const visto = await comPessoa(o.poolApp, p.pessoaId, empresaId, async (c) => {
    const a = await buscarAprovacao(c, aprovacaoId);
    if (!a || !(await podeDecidir(c, a, p.pessoaId, await administra(c)))) return null;
    // A conferência que a pessoa viu na mensagem (ou a de agora, se o pedido chegou por outro caminho).
    const enviado = await c.query<{ conferencia: string }>(
      "select conferencia from aprovacoes_no_telegram where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = pessoa_ativa()",
      [aprovacaoId],
    );
    return { aprovacao: a, conferencia: enviado.rows[0]?.conferencia ?? a.conferencia };
  });
  if (!visto) {
    await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.pedidoNaoEncontrado);
    return true;
  }
  const a = visto.aprovacao;
  if (a.situacao !== "pendente" || Date.parse(a.venceEm) <= Date.now()) {
    await o.carteiro.enviar(
      p.chatId,
      respostaDePedidoJaDecidido(
        a.situacao === "pendente" ? "vencida" : (SITUACAO_EM_TEXTO[a.situacao] ?? a.situacao),
      ),
    );
    return true;
  }
  if (aprovar) {
    if (await travado(o.poolApp, p.pessoaId)) {
      await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.aprovacoesTravadas);
      return true;
    }
    if (!(await ap.autenticador.tem(p.pessoaId))) {
      await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.semAutenticador);
      return true;
    }
  }
  // Um pedido aberto por pessoa: tocar em outro botão troca o anterior.
  await comPessoa(o.poolApp, p.pessoaId, null, (c) =>
    c.query("delete from pedidos_de_codigo_no_telegram where pessoa_id = pessoa_ativa()"),
  );
  await comPessoa(o.poolApp, p.pessoaId, empresaId, (c) =>
    c.query(
      `insert into pedidos_de_codigo_no_telegram (empresa_id, pessoa_id, aprovacao_id, acao, conferencia, vale_ate)
       values (empresa_ativa(), pessoa_ativa(), $1, $2, $3, now() + make_interval(mins => $4))`,
      [aprovacaoId, aprovar ? "aprovar" : "recusar", visto.conferencia, MINUTOS_PARA_MANDAR_O_CODIGO],
    ),
  );
  await o.carteiro.enviar(
    p.chatId,
    aprovar ? respostaPedindoCodigo(a.resumo) : RESPOSTAS_DO_TELEGRAM.pecaOMotivo,
  );
  return true;
}

/**
 * A mensagem que chega com um pedido de código (ou de motivo) aberto. Devolve verdadeiro se ela era a resposta ao
 * pedido; falso para seguir como mensagem comum (o pedido aberto é fechado: a pessoa mudou de assunto).
 */
export async function receberCodigoOuMotivo(
  o: OpcoesDoTelegram,
  p: PessoaDoTelegram,
  m: MensagemDoTelegram,
): Promise<boolean> {
  const ap = o.conversa?.aprovacoes;
  if (!ap) return false;
  // O pedido aberto é da empresa do pedido de aprovação, que pode não ser a do Telegram agora.
  const pedido = await comPessoa(o.poolApp, p.pessoaId, null, async (c) => {
    const r = await c.query<{
      empresa_id: string;
      aprovacao_id: string;
      acao: "aprovar" | "recusar";
      conferencia: string;
      vale: boolean;
    }>(
      `select empresa_id, aprovacao_id, acao, conferencia, vale_ate > now() as vale from pedidos_de_codigo_no_telegram
        where pessoa_id = pessoa_ativa()`,
    );
    return r.rows[0] ?? null;
  });
  if (!pedido) return false;
  const texto = (m.text ?? "").trim();
  const fechar = () =>
    comPessoa(o.poolApp, p.pessoaId, null, (c) =>
      c.query("delete from pedidos_de_codigo_no_telegram where pessoa_id = pessoa_ativa()"),
    );
  const pareceCodigo = /^\d{6}$/.test(texto.replace(/\s/g, ""));
  if (!pedido.vale) {
    await fechar();
    if (pedido.acao === "aprovar" && pareceCodigo) {
      await o.carteiro.apagar(m.chat.id, m.message_id).catch(() => {});
      await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.foraDoTempo);
      return true;
    }
    return false;
  }
  const log = o.log as unknown as FastifyBaseLogger;
  const decidir = (decisao: "aprovar" | "recusar", motivo?: string) =>
    comPessoa(o.poolApp, p.pessoaId, pedido.empresa_id, administra).then((administrador) =>
      decidirAprovacao(ap.decidir, {
        empresaId: pedido.empresa_id,
        pessoaId: p.pessoaId,
        administrador,
        aprovacaoId: pedido.aprovacao_id,
        conferencia: pedido.conferencia,
        decisao,
        motivo,
        origem: ORIGEM_TELEGRAM,
        rastreio: null,
        log,
      }),
    );
  const contar = async (r: Awaited<ReturnType<typeof decidir>>, feito: string) => {
    if ("erro" in r) {
      await o.carteiro.enviar(
        p.chatId,
        r.erro === "mudou"
          ? (r.message ?? "Esse pedido já foi decidido ou venceu.")
          : r.erro === "nao_encontrado"
            ? RESPOSTAS_DO_TELEGRAM.pedidoNaoEncontrado
            : r.message,
      );
      return;
    }
    await o.carteiro.enviar(
      p.chatId,
      r.aprovacao.situacao === "falhou"
        ? `Aprovado, mas não deu certo: ${r.aprovacao.resumo}. ${r.aprovacao.observacao ?? ""}`.trim()
        : `${feito}: ${r.aprovacao.resumo}`,
    );
    // A mensagem do pedido mostra a decisão logo (sem esperar a verificação a cada minuto).
    await cuidarDasAprovacoesNoTelegram(o, pedido.empresa_id).catch(() => ({ mandadas: 0, atualizadas: 0 }));
  };

  if (pedido.acao === "recusar") {
    // Um comando no meio (/ajuda, /empresa) desiste da recusa e segue como comando.
    if (!texto || texto.startsWith("/")) {
      await fechar();
      return false;
    }
    await fechar();
    const motivo = /^sem motivo\.?$/i.test(texto) ? "Sem motivo." : texto.slice(0, 1000);
    await contar(await decidir("recusar", motivo), "Recusado");
    return true;
  }
  // Aprovar: só 6 dígitos contam. Outra coisa fecha o pedido e segue como conversa.
  if (!pareceCodigo) {
    await fechar();
    return false;
  }
  // O código não fica no chat.
  await o.carteiro.apagar(m.chat.id, m.message_id).catch(() => {});
  if (await travado(o.poolApp, p.pessoaId)) {
    await fechar();
    await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.aprovacoesTravadas);
    return true;
  }
  const conferido = await ap.autenticador.conferir(p.pessoaId, texto.replace(/\s/g, ""));
  if (conferido === "sem_autenticador") {
    await fechar();
    await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.semAutenticador);
    return true;
  }
  if (conferido !== "certo") {
    // Código repetido conta como errado: quem leu o chat não aprova com ele.
    const r = await o.poolApp.query<{ n: number }>(
      "select erros_de_codigo_no_telegram($1, true, $2, $3) as n",
      [p.pessoaId, MINUTOS_DA_TRAVA_DAS_APROVACOES, ERROS_DE_CODIGO_NA_APROVACAO],
    );
    const erros = r.rows[0]?.n ?? 0;
    if (erros >= ERROS_DE_CODIGO_NA_APROVACAO) {
      await fechar();
      await comEmpresa(o.poolApp, pedido.empresa_id, (c) =>
        criarAviso(c, {
          pessoaId: p.pessoaId,
          tipo: "telegram_aprovacoes_travadas",
          texto:
            "Três códigos errados ao aprovar pelo Telegram: as aprovações por lá ficam travadas por 15 minutos. Se não foi você, troque a senha e confira os aparelhos.",
          link: "/aprovacoes",
        }),
      ).catch(() => {});
      await o.carteiro.enviar(p.chatId, RESPOSTAS_DO_TELEGRAM.aprovacoesTravadas);
    } else await o.carteiro.enviar(p.chatId, respostaDeCodigoErrado(ERROS_DE_CODIGO_NA_APROVACAO - erros));
    return true;
  }
  await fechar();
  await contar(await decidir("aprovar"), "Aprovado");
  return true;
}
