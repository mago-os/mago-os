/**
 * Conversa com o coordenador pelo Telegram (M5-02, decisão 0033).
 *
 * O texto entra pelo mesmo caminho da conversa no app (receberMensagemDaPessoa), com a permissão calculada como numa
 * tela. A conversa atual fica no vínculo do Telegram; depois de 6 horas sem mensagem, com /nova ou ao trocar de
 * empresa, começa outra. A resposta do agente fica marcada na mensagem (telegram_pendente) e é mandada aqui, ao fim
 * da execução e na verificação a cada minuto.
 */
import {
  type DeclaracaoDeModulo,
  HORAS_PARA_CONVERSA_NOVA_NO_TELEGRAM,
  MAXIMO_DE_PRIORIDADES_NO_TELEGRAM,
  mencaoNoComeco,
  RESPOSTAS_DO_TELEGRAM,
  respostaDeAgentePausado,
  respostaDeAgentesParados,
} from "@mago-os/contratos";
import type pg from "pg";
import { quemPediu } from "../agentes-internos/ferramentas.ts";
import { podeFalarComEspecialista, receberMensagemDaPessoa } from "../agentes-internos/mensagem-da-pessoa.ts";
import { paraBusca } from "../busca/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import { MAXIMO_DA_MENSAGEM_DO_TELEGRAM } from "./carteiro.ts";
import type { OpcoesDoTelegram, PessoaDoTelegram } from "./servico.ts";

/** O que a conversa pelo Telegram precisa além do bot (na API, vem do motor e do verificador). */
export interface OpcoesDaConversaPeloTelegram {
  catalogo: Map<string, DeclaracaoDeModulo>;
  /** Põe a execução na fila dos agentes internos. */
  acordar(empresaId: string, execucaoId: string): void;
  /** Endereço do site, para os links das tarefas (ex.: https://teste.osmago.com). */
  urlPublica: string;
}

/** Depois de 1 hora, a resposta que não chegou ao Telegram fica só no app. */
const MINUTOS_PARA_DESISTIR_DA_ENTREGA = 60;

/** Divide um texto longo em partes que cabem numa mensagem, quebrando em linha ou espaço quando dá. */
export function partesDoTexto(texto: string, maximo = MAXIMO_DA_MENSAGEM_DO_TELEGRAM): string[] {
  const partes: string[] = [];
  let resto = texto.trim();
  while (resto.length > maximo) {
    // Prefere quebrar numa linha; sem linha na segunda metade, num espaço; sem nenhum dos dois, no limite.
    const linha = resto.lastIndexOf("\n", maximo);
    const espaco = resto.lastIndexOf(" ", maximo);
    const ate = linha > maximo / 2 ? linha : espaco > maximo / 2 ? espaco : maximo;
    partes.push(resto.slice(0, ate).trimEnd());
    resto = resto.slice(ate).trimStart();
  }
  if (resto) partes.push(resto);
  return partes;
}

/** Texto, /nova, /tarefas e a menção a um especialista, de quem já está vinculado. */
export async function conversarPeloTelegram(
  o: OpcoesDoTelegram,
  p: PessoaDoTelegram,
  chatId: number,
  texto: string,
  comando: { comando: string; resto: string } | null,
): Promise<void> {
  const conv = o.conversa;
  if (!conv) {
    await o.carteiro.enviar(chatId, "A conversa pelo Telegram ainda não está ligada neste ambiente.");
    return;
  }
  const permissoes = await permissoesNaEmpresa(o.poolApp, p.pessoaId, p.empresaId, conv.catalogo);
  if (!permissoes) {
    await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.semVinculo);
    return;
  }
  // /tarefas não fala com agente: vale a permissão de ver tarefas, como a central de prioridades.
  if (comando?.comando === "tarefas") {
    await mandarPrioridades(o, conv, p, chatId, permissoes);
    return;
  }
  if ((permissoes.modulos.get("agentes")?.acoes.ver ?? "nada") === "nada") {
    await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.semAcessoAosAgentes);
    return;
  }

  if (comando?.comando === "nova") {
    await comPessoa(o.poolApp, p.pessoaId, p.empresaId, (c) =>
      c.query("update vinculos_do_telegram set conversa_id = null where pessoa_id = pessoa_ativa()"),
    );
    await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.conversaNova);
    if (!comando.resto) return;
    texto = comando.resto;
  }

  // "@gerente planeja o lançamento": conversa nova direto com o especialista. Só conta como menção a um agente
  // interno (pelo começo de uma palavra do nome); outro "@" ("@Ana, cria...") vai inteiro ao coordenador.
  const mencao = mencaoNoComeco(texto);
  let agenteId: string | undefined;
  if (mencao) {
    const agentes = await comPessoa(o.poolApp, p.pessoaId, p.empresaId, async (c) => {
      const r = await c.query<{ id: string; nome: string; papel: string }>(
        `select id, nome, papel from agentes where empresa_id = empresa_ativa() and tipo = 'interno'
            and situacao <> 'desligado' order by papel, lower(nome)`,
      );
      return r.rows;
    });
    const procurado = paraBusca(mencao.mencao);
    const achado = agentes.find((a) =>
      paraBusca(a.nome)
        .split(/[\s_-]+/)
        .some((w) => w.startsWith(procurado)),
    );
    if (achado?.papel === "coordenador") texto = mencao.resto;
    else if (achado) {
      if (!podeFalarComEspecialista(permissoes.perfil)) {
        await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.semPermissaoDeEspecialista);
        return;
      }
      agenteId = achado.id;
      texto = mencao.resto;
    }
  }

  const feito = await comPessoa(o.poolApp, p.pessoaId, p.empresaId, async (c) => {
    // A linha do vínculo fica travada até o fim: duas mensagens ao mesmo tempo não abrem duas conversas.
    const v = await c.query<{ conversa_id: string | null; recente: boolean | null }>(
      `select t.conversa_id, v.atualizada_em > now() - make_interval(hours => $1) as recente
         from vinculos_do_telegram t
         left join conversas v on v.id = t.conversa_id and v.empresa_id = t.empresa_id
        where t.pessoa_id = pessoa_ativa() and t.empresa_id = empresa_ativa()
          for update of t`,
      [HORAS_PARA_CONVERSA_NOVA_NO_TELEGRAM],
    );
    // A conversa atual, se ainda vale: sem menção, e com mensagem nas últimas 6 horas.
    const atual = !agenteId && v.rows[0]?.recente ? v.rows[0].conversa_id : null;
    const pedido = {
      pessoaId: p.pessoaId,
      perfil: permissoes.perfil,
      texto: texto.slice(0, 4000),
      agenteId,
      canal: "telegram" as const,
    };
    let r = await receberMensagemDaPessoa(c, { ...pedido, conversaId: atual ?? undefined });
    // O agente da conversa atual foi desligado (ou a conversa sumiu): começa outra, com o coordenador.
    if (atual && "erro" in r && (r.erro === "nao_encontrada" || r.erro === "sem_coordenador"))
      r = await receberMensagemDaPessoa(c, pedido);
    if ("conversa" in r && r.conversa.id !== atual)
      await c.query("update vinculos_do_telegram set conversa_id = $1 where pessoa_id = pessoa_ativa()", [
        r.conversa.id,
      ]);
    return r;
  });
  if ("erro" in feito) {
    const resposta =
      feito.erro === "ocupado"
        ? RESPOSTAS_DO_TELEGRAM.ocupado
        : feito.erro === "parados"
          ? respostaDeAgentesParados(feito.motivo)
          : feito.erro === "pausado"
            ? respostaDeAgentePausado(feito.nome)
            : feito.erro === "sem_permissao"
              ? RESPOSTAS_DO_TELEGRAM.semPermissaoDeEspecialista
              : feito.erro === "nao_encontrada"
                ? RESPOSTAS_DO_TELEGRAM.especialistaNaoEncontrado
                : "Esta empresa ainda não tem coordenador.";
    await o.carteiro.enviar(chatId, resposta);
    return;
  }
  await o.carteiro.digitando(chatId).catch(() => {});
  conv.acordar(p.empresaId, feito.execucaoId);
}

async function mandarPrioridades(
  o: OpcoesDoTelegram,
  conv: OpcoesDaConversaPeloTelegram,
  p: PessoaDoTelegram,
  chatId: number,
  permissoes: NonNullable<Awaited<ReturnType<typeof permissoesNaEmpresa>>>,
): Promise<void> {
  const quem = quemPediu(permissoes, p.pessoaId, "ver");
  if (quem?.tipo !== "pessoa") {
    await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.semPrioridades);
    return;
  }
  const itens = await comPessoa(o.poolApp, p.pessoaId, p.empresaId, (c) => listarPrioridades(c, quem));
  if (itens.length === 0) {
    await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.semPrioridades);
    return;
  }
  const linhas = itens
    .slice(0, MAXIMO_DE_PRIORIDADES_NO_TELEGRAM)
    .map((i, n) => `${n + 1}. ${i.titulo}\n${i.motivo}\n${conv.urlPublica}${i.link}`);
  const mais =
    itens.length > MAXIMO_DE_PRIORIDADES_NO_TELEGRAM
      ? `\n\nE mais ${itens.length - MAXIMO_DE_PRIORIDADES_NO_TELEGRAM} no app.`
      : "";
  for (const parte of partesDoTexto(`Prioridades de hoje:\n\n${linhas.join("\n\n")}${mais}`))
    await o.carteiro.enviar(chatId, parte);
}

/**
 * Manda ao Telegram as mensagens marcadas de uma empresa, em ordem. A que falhar fica para a próxima vez (até 1 hora;
 * depois, só no app). Mensagem de quem não tem mais o Telegram nesta empresa deixa de esperar.
 *
 * Uma entrega por vez por empresa: a trava do banco espera a outra terminar (o fim de uma execução e a verificação a
 * cada minuto podem se cruzar), e quem chega depois lê de novo o que falta. Cada parte enviada fica gravada na hora,
 * fora da transação da trava, para nada ir duas vezes se algo cair no meio.
 */
export async function entregarNoTelegram(
  o: Pick<OpcoesDoTelegram, "poolApp" | "carteiro" | "log" | "conversa">,
  empresaId: string,
): Promise<number> {
  const gravar = (sql: string, valores: unknown[]) =>
    comEmpresa(o.poolApp, empresaId, (c) => c.query(sql, valores));
  return comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query(
      "select pg_advisory_xact_lock(hashtextextended('telegram-entrega:' || empresa_ativa()::text, 0))",
    );
    const r = await c.query<{
      id: string;
      texto: string;
      tarefas: string[];
      partes_enviadas: number;
      chat_id: string | null;
      velha: boolean;
    }>(
      `select m.id, m.texto, m.tarefas, m.telegram_partes_enviadas as partes_enviadas, t.chat_id,
              m.criada_em < now() - make_interval(mins => $1) as velha
         from mensagens_de_conversa m
         left join vinculos_do_telegram t on t.pessoa_id = m.pessoa_id and t.empresa_id = m.empresa_id
        where m.empresa_id = empresa_ativa() and m.telegram_pendente
        order by m.criada_em limit 50`,
      [MINUTOS_PARA_DESISTIR_DA_ENTREGA],
    );
    let enviadas = 0;
    const falhouPara = new Set<string>();
    for (const m of r.rows) {
      if (!m.chat_id || m.velha) {
        await gravar("update mensagens_de_conversa set telegram_pendente = false where id = $1", [m.id]);
        continue;
      }
      // Depois de uma falha para o mesmo chat, as seguintes esperam (para não chegarem fora de ordem).
      if (falhouPara.has(m.chat_id)) continue;
      const links = o.conversa
        ? m.tarefas.map((id) => `${o.conversa?.urlPublica}/tarefas/${id}`).join("\n")
        : "";
      const partes = partesDoTexto(links ? `${m.texto}\n\n${links}` : m.texto);
      try {
        // Uma resposta longa que parou no meio continua da parte que faltava.
        for (let i = m.partes_enviadas; i < partes.length; i++) {
          await o.carteiro.enviar(Number(m.chat_id), partes[i] as string);
          await gravar(
            i === partes.length - 1
              ? `update mensagens_de_conversa set telegram_pendente = false, telegram_enviada_em = now(),
                   telegram_partes_enviadas = $2 where id = $1`
              : "update mensagens_de_conversa set telegram_partes_enviadas = $2 where id = $1",
            [m.id, i + 1],
          );
        }
      } catch (erro) {
        o.log.warn({ erro, mensagemId: m.id }, "Telegram: resposta não entregue; tenta de novo em 1 minuto");
        falhouPara.add(m.chat_id);
        continue;
      }
      enviadas++;
    }
    return enviadas;
  });
}

/** A verificação a cada minuto: as empresas com resposta esperando para ir ao Telegram. */
export async function entregarPendentesNoTelegram(
  o: Pick<OpcoesDoTelegram, "poolApp" | "carteiro" | "log" | "conversa">,
): Promise<number> {
  const r = await o.poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_telegram_pendente()",
  );
  let total = 0;
  for (const e of r.rows)
    total += await entregarNoTelegram(o, e.empresa_id).catch((erro) => {
      o.log.error({ erro, empresaId: e.empresa_id }, "Telegram: entrega da empresa falhou");
      return 0;
    });
  return total;
}

/** "Digitando" no Telegram da dona da conversa, se a última mensagem dela veio de lá (senão a resposta vai ao app). */
export async function digitandoNoTelegram(
  o: Pick<OpcoesDoTelegram, "poolApp" | "carteiro">,
  empresaId: string,
  conversaId: string,
): Promise<void> {
  const r = await comEmpresa(o.poolApp, empresaId, (c) =>
    c.query<{ chat_id: string }>(
      `select t.chat_id from vinculos_do_telegram t
        where t.empresa_id = empresa_ativa() and t.conversa_id = $1
          and (select m.canal from mensagens_de_conversa m where m.conversa_id = $1 and m.empresa_id = empresa_ativa()
                  and m.autor_pessoa_id is not null order by m.criada_em desc limit 1) = 'telegram'`,
      [conversaId],
    ),
  );
  const chat = r.rows[0]?.chat_id;
  if (chat) await o.carteiro.digitando(Number(chat));
}
