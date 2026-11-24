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
  type TipoDeAviso,
  textoDoAvisoNoTelegram,
} from "@mago-os/contratos";
import { quemPediu } from "../agentes-internos/ferramentas.ts";
import { agoraNoFuso, emSilencio, preferenciasDe } from "../avisos/notificacoes.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import type { BotaoDoTelegram } from "./carteiro.ts";
import { partesDoTexto, textoDasPrioridades } from "./conversa.ts";
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
    const saida: { chatId: number; texto: string; botoes?: BotaoDoTelegram[][] }[] = [];
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
        if (canaisDoTipo(prefs, a.tipo).telegram) {
          // O convite para um evento (M5-07) leva os botões Vou, Não vou e Talvez.
          const evento =
            a.tipo === "convite_de_evento" ? /^\/agenda\/([0-9a-f-]{36})$/.exec(a.link)?.[1] : undefined;
          saida.push({
            chatId: Number(pessoa.chat_id),
            texto: textoDoAvisoNoTelegram(a.texto, `${urlPublica}${a.link}`),
            ...(evento
              ? {
                  botoes: [
                    [
                      { texto: "Vou", dados: `ev:vou:${evento}` },
                      { texto: "Não vou", dados: `ev:nao:${evento}` },
                      { texto: "Talvez", dados: `ev:talvez:${evento}` },
                    ],
                  ],
                }
              : {}),
          });
        }
    }
    return saida;
  });
  let enviados = 0;
  for (const e of envios)
    await o.carteiro
      .enviar(e.chatId, e.texto, e.botoes ? { botoes: e.botoes } : undefined)
      .then(() => {
        enviados++;
      })
      .catch((erro) => o.log.warn({ erro }, "Telegram: o aviso não foi enviado (fica no sino e no push)"));
  return enviados;
}

/** Depois da hora escolhida, o resumo ainda vai por 2 horas; mais tarde, o dia é pulado (nada de resumo à noite). */
const MINUTOS_DA_JANELA_DO_RESUMO = 120;

const emMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** Manda o resumo do dia de quem chegou na hora, uma vez por dia. Devolve quantos foram. */
export async function resumoDoDiaNoTelegram(
  o: Opcoes,
  empresaId: string,
  agora = new Date(),
): Promise<number> {
  const conv = o.conversa;
  if (!conv) return 0;
  const catalogo: Map<string, DeclaracaoDeModulo> = conv.catalogo;
  // 1. Quem está na hora: marca o dia antes de mandar (a verificação seguinte não repete). Uma verificação por vez
  // por empresa (duas cópias da API, ou uma demorada, não mandam dois resumos).
  const devidos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const livre = await c.query<{ ok: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended('telegram-resumo:' || empresa_ativa()::text, 0)) as ok",
    );
    if (!livre.rows[0]?.ok) return [];
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
      if (horaDoDia !== null) {
        const passou = emMinutos(hora) - emMinutos(horaDoDia);
        // Antes da hora, ou no silêncio dentro da janela: espera a próxima verificação.
        if (passou < 0) continue;
        if (passou < MINUTOS_DA_JANELA_DO_RESUMO && emSilencio(prefs.silencio, hora)) continue;
      }
      await c.query("select marcar_resumo_do_dia_no_telegram($1, $2::date)", [v.pessoa_id, dia]);
      // Desligado, ou já passou da janela (vinculou à noite, o servidor ficou fora): o dia fica pulado.
      if (horaDoDia !== null && emMinutos(hora) - emMinutos(horaDoDia) < MINUTOS_DA_JANELA_DO_RESUMO)
        saida.push({ pessoaId: v.pessoa_id, chatId: Number(v.chat_id) });
    }
    return saida;
  });
  // 2. Monta e manda com a permissão e o contexto de cada pessoa (a mesma lista da central de prioridades, com o que
  // ela adiou ou resolveu).
  let enviados = 0;
  for (const d of devidos) {
    try {
      const permissoes = await permissoesNaEmpresa(o.poolApp, d.pessoaId, empresaId, catalogo);
      const quem = permissoes ? quemPediu(permissoes, d.pessoaId, "ver") : null;
      const { itens, naoLidos } = await comPessoa(o.poolApp, d.pessoaId, empresaId, async (c) => {
        const lista = quem?.tipo === "pessoa" ? await listarPrioridades(c, quem, agora) : [];
        const n = await c.query<{ n: number }>(
          "select count(*)::int as n from avisos where empresa_id = empresa_ativa() and pessoa_id = $1 and lido_em is null",
          [d.pessoaId],
        );
        return { itens: lista, naoLidos: n.rows[0]?.n ?? 0 };
      });
      const avisos =
        naoLidos === 0
          ? ""
          : naoLidos === 1
            ? "\n\n1 aviso por ler no app."
            : `\n\n${naoLidos} avisos por ler no app.`;
      const texto =
        itens.length === 0
          ? `Resumo do dia: nada pedindo a sua atenção hoje.${avisos}`
          : `Resumo do dia. Prioridades de hoje:\n\n${textoDasPrioridades(itens, conv.urlPublica)}${avisos}`;
      for (const parte of partesDoTexto(texto)) await o.carteiro.enviar(d.chatId, parte);
      enviados++;
    } catch (erro) {
      o.log.warn({ erro, pessoaId: d.pessoaId }, "Telegram: o resumo do dia não foi enviado");
    }
  }
  return enviados;
}
