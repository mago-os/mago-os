/**
 * Avisos e resumo do dia pelo Telegram (M5-08, decisão 0037), na verificação a cada minuto.
 *
 * - Aviso novo fica marcado (avisos.telegram_pendente). Para quem tem o Telegram vinculado nesta empresa e o tipo ligado
 *   no Telegram (por padrão, só o urgente), ele vai com o link para abrir no app. No horário de silêncio, espera; depois
 *   de 12 horas, desiste (fica no sino e no push). A marca sai antes de mandar: nada vai duas vezes.
 * - O resumo do dia vai uma vez por dia, na hora escolhida (padrão 8h) e no fuso da pessoa, fora do silêncio: as
 *   prioridades de hoje, com o link de cada uma, e quantos avisos faltam ler.
 */
import {
  canaisDoTipo,
  type DeclaracaoDeModulo,
  HORAS_PARA_DESISTIR_DO_AVISO_NO_TELEGRAM,
  horaDoResumo,
  MAXIMO_DE_PRIORIDADES_NO_TELEGRAM,
  type TipoDeAviso,
  textoDoAvisoNoTelegram,
} from "@mago-os/contratos";
import { quemPediu } from "../agentes-internos/ferramentas.ts";
import { agoraNoFuso, emSilencio, preferenciasDe } from "../avisos/notificacoes.ts";
import { comEmpresa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import { partesDoTexto } from "./conversa.ts";
import type { OpcoesDoTelegram } from "./servico.ts";

type Opcoes = Pick<OpcoesDoTelegram, "poolApp" | "carteiro" | "log" | "conversa">;

/** Manda os avisos marcados de uma empresa a quem tem o Telegram nela. Devolve quantos foram. */
export async function avisarNoTelegram(o: Opcoes, empresaId: string, agora = new Date()): Promise<number> {
  const urlPublica = o.conversa?.urlPublica ?? "";
  const envios = await comEmpresa(o.poolApp, empresaId, async (c) => {
    // Quem não tem o Telegram nesta empresa: os avisos deixam de esperar (ficam no sino e no push).
    await c.query(
      `update avisos a set telegram_pendente = false
        where a.empresa_id = empresa_ativa() and a.telegram_pendente
          and not exists (select 1 from vinculos_do_telegram t
                           where t.empresa_id = a.empresa_id and t.pessoa_id = a.pessoa_id)`,
    );
    await c.query(
      `update avisos set telegram_pendente = false
        where empresa_id = empresa_ativa() and telegram_pendente and criado_em < now() - make_interval(hours => $1)`,
      [HORAS_PARA_DESISTIR_DO_AVISO_NO_TELEGRAM],
    );
    const pessoas = await c.query<{ pessoa_id: string; chat_id: string; fuso: string }>(
      `select distinct a.pessoa_id, t.chat_id, coalesce(p.fuso_horario, 'UTC') as fuso
         from avisos a
         join vinculos_do_telegram t on t.empresa_id = a.empresa_id and t.pessoa_id = a.pessoa_id
         join pessoas p on p.id = a.pessoa_id
        where a.empresa_id = empresa_ativa() and a.telegram_pendente`,
    );
    const saida: { chatId: number; texto: string }[] = [];
    for (const pessoa of pessoas.rows) {
      const prefs = await preferenciasDe(c, pessoa.pessoa_id);
      // No silêncio, espera (o push faz o mesmo).
      if (emSilencio(prefs.silencio, agoraNoFuso(pessoa.fuso, agora).hora)) continue;
      const avisos = await c.query<{ tipo: TipoDeAviso; texto: string; link: string }>(
        `update avisos set telegram_pendente = false
          where id in (select id from avisos where empresa_id = empresa_ativa() and pessoa_id = $1 and telegram_pendente
                        order by criado_em limit 20 for update skip locked)
          returning tipo, texto, link`,
        [pessoa.pessoa_id],
      );
      for (const a of avisos.rows)
        if (canaisDoTipo(prefs, a.tipo).telegram)
          saida.push({
            chatId: Number(pessoa.chat_id),
            texto: textoDoAvisoNoTelegram(a.texto, `${urlPublica}${a.link}`),
          });
    }
    return saida;
  });
  let enviados = 0;
  for (const e of envios)
    await o.carteiro
      .enviar(e.chatId, e.texto)
      .then(() => {
        enviados++;
      })
      .catch((erro) => o.log.warn({ erro }, "Telegram: o aviso não foi enviado (fica no sino e no push)"));
  return enviados;
}

/** Manda o resumo do dia de quem chegou na hora, uma vez por dia. Devolve quantos foram. */
export async function resumoDoDiaNoTelegram(
  o: Opcoes,
  empresaId: string,
  agora = new Date(),
): Promise<number> {
  const conv = o.conversa;
  if (!conv) return 0;
  const catalogo: Map<string, DeclaracaoDeModulo> = conv.catalogo;
  // 1. Quem está na hora: marca o dia antes de mandar (a verificação seguinte não repete).
  const devidos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{
      pessoa_id: string;
      chat_id: string;
      fuso: string;
      resumo_do_dia_em: string | null;
    }>(
      `select t.pessoa_id, t.chat_id, coalesce(p.fuso_horario, 'UTC') as fuso, t.resumo_do_dia_em::text
         from vinculos_do_telegram t join pessoas p on p.id = t.pessoa_id
        where t.empresa_id = empresa_ativa()`,
    );
    const saida: { pessoaId: string; chatId: number }[] = [];
    for (const v of r.rows) {
      const { dia, hora } = agoraNoFuso(v.fuso, agora);
      if (v.resumo_do_dia_em === dia) continue;
      const prefs = await preferenciasDe(c, v.pessoa_id);
      const horaDoDia = horaDoResumo(prefs);
      // Desligado: o dia fica marcado (sem resumo). Antes da hora ou no silêncio: espera.
      if (horaDoDia !== null && (hora < horaDoDia || emSilencio(prefs.silencio, hora))) continue;
      await c.query("select marcar_resumo_do_dia_no_telegram($1, $2::date)", [v.pessoa_id, dia]);
      if (horaDoDia !== null) saida.push({ pessoaId: v.pessoa_id, chatId: Number(v.chat_id) });
    }
    return saida;
  });
  // 2. Monta e manda, com a permissão de cada pessoa (a mesma lista da central de prioridades).
  let enviados = 0;
  for (const d of devidos) {
    try {
      const permissoes = await permissoesNaEmpresa(o.poolApp, d.pessoaId, empresaId, catalogo);
      const quem = permissoes ? quemPediu(permissoes, d.pessoaId, "ver") : null;
      const { itens, naoLidos } = await comEmpresa(o.poolApp, empresaId, async (c) => {
        const lista = quem?.tipo === "pessoa" ? await listarPrioridades(c, quem, agora) : [];
        const n = await c.query<{ n: number }>(
          "select count(*)::int as n from avisos where empresa_id = empresa_ativa() and pessoa_id = $1 and lido_em is null",
          [d.pessoaId],
        );
        return { itens: lista, naoLidos: n.rows[0]?.n ?? 0 };
      });
      const linhas = itens
        .slice(0, MAXIMO_DE_PRIORIDADES_NO_TELEGRAM)
        .map((i, n) => `${n + 1}. ${i.titulo}\n${i.motivo}\n${conv.urlPublica}${i.link}`);
      const avisos =
        naoLidos === 0
          ? ""
          : naoLidos === 1
            ? "\n\n1 aviso por ler no app."
            : `\n\n${naoLidos} avisos por ler no app.`;
      const texto =
        itens.length === 0
          ? `Resumo do dia: nada pedindo a sua atenção hoje.${avisos}`
          : `Resumo do dia. Prioridades de hoje:\n\n${linhas.join("\n\n")}${
              itens.length > MAXIMO_DE_PRIORIDADES_NO_TELEGRAM
                ? `\n\nE mais ${itens.length - MAXIMO_DE_PRIORIDADES_NO_TELEGRAM} no app.`
                : ""
            }${avisos}`;
      for (const parte of partesDoTexto(texto)) await o.carteiro.enviar(d.chatId, parte);
      enviados++;
    } catch (erro) {
      o.log.warn({ erro, pessoaId: d.pessoaId }, "Telegram: o resumo do dia não foi enviado");
    }
  }
  return enviados;
}
