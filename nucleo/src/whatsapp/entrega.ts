/**
 * O que sai pelo WhatsApp da plataforma (M8-09, decisão 0059), na verificação a cada minuto e ao fim de cada execução:
 * as respostas do coordenador, os pedidos de aprovação (com os botões), os avisos e o resumo do dia.
 *
 * A janela de 24 horas da Meta conta da última mensagem da pessoa. Dentro dela, tudo vai como texto (sem custo de
 * modelo). Fora dela, só por modelo aprovado, que a Nolask paga: o aviso urgente e o pedido de aprovação vão pelo
 * aviso_do_mago_os, no máximo 10 por pessoa por dia; o resumo do dia e a decisão de um pedido não vão.
 */
import {
  type Aprovacao,
  canaisDoTipo,
  HORAS_PARA_DESISTIR_DO_AVISO_NO_TELEGRAM,
  horaDoResumo,
  MAXIMO_DA_MENSAGEM_DO_WHATSAPP,
  MODELOS_DO_WHATSAPP,
  MODELOS_POR_DIA_NO_WHATSAPP,
  type TipoDeAviso,
  textoDaAprovacaoNoTelegram,
  textoDoAvisoNoTelegram,
} from "@mago-os/contratos";
import type pg from "pg";
import { buscarAprovacao } from "../agentes/regras.ts";
import { quemPediu } from "../agentes-internos/ferramentas.ts";
import { agoraNoFuso, emSilencio, preferenciasDe } from "../avisos/notificacoes.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { listarPrioridades } from "../tarefas/prioridades.ts";
import { partesDoTexto, textoDasPrioridades } from "../telegram/conversa.ts";
import { ErroDaMeta } from "./carteiro.ts";
import { DENTRO_DA_JANELA, type OpcoesDoWhatsapp } from "./servico.ts";

type Opcoes = Pick<OpcoesDoWhatsapp, "poolApp" | "carteiro" | "log" | "conversa">;

/** Depois de 1 hora, a resposta que não foi pelo WhatsApp fica só no app. */
const MINUTOS_PARA_DESISTIR_DA_ENTREGA = 60;

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/**
 * Reserva um envio por modelo para a pessoa hoje (no fuso dela), até o máximo do dia. Falso: o dia chegou ao teto,
 * e o aviso fica só no app.
 */
async function reservarModelo(
  c: pg.PoolClient,
  pessoaId: string,
  fuso: string,
  agora: Date,
): Promise<boolean> {
  const { dia } = agoraNoFuso(fuso, agora);
  const r = await c.query<{ ok: boolean }>("select reservar_modelo_do_whatsapp($1, $2::date, $3) as ok", [
    pessoaId,
    dia,
    MODELOS_POR_DIA_NO_WHATSAPP,
  ]);
  return r.rows[0]?.ok === true;
}

/** As respostas do agente marcadas para o WhatsApp, em ordem, em partes (como no Telegram). */
export async function entregarNoWhatsapp(o: Opcoes, empresaId: string): Promise<number> {
  const gravar = (sql: string, valores: unknown[]) =>
    comEmpresa(o.poolApp, empresaId, (c) => c.query(sql, valores));
  return comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query(
      "select pg_advisory_xact_lock(hashtextextended('whatsapp-entrega:' || empresa_ativa()::text, 0))",
    );
    const r = await c.query<{
      id: string;
      texto: string;
      tarefas: string[];
      partes_enviadas: number;
      numero: string | null;
      velha: boolean;
    }>(
      `select m.id, m.texto, m.tarefas, m.whatsapp_partes_enviadas as partes_enviadas, w.numero,
              m.criada_em < now() - make_interval(mins => $1) as velha
         from mensagens_de_conversa m
         left join vinculos_do_whatsapp w on w.pessoa_id = m.pessoa_id and w.empresa_id = m.empresa_id
        where m.empresa_id = empresa_ativa() and m.whatsapp_pendente
        order by m.criada_em limit 50`,
      [MINUTOS_PARA_DESISTIR_DA_ENTREGA],
    );
    let enviadas = 0;
    const falhouPara = new Set<string>();
    for (const m of r.rows) {
      if (!m.numero || m.velha) {
        await gravar("update mensagens_de_conversa set whatsapp_pendente = false where id = $1", [m.id]);
        continue;
      }
      if (falhouPara.has(m.numero)) continue;
      const links = o.conversa
        ? m.tarefas.map((id) => `${o.conversa?.urlPublica}/tarefas/${id}`).join("\n")
        : "";
      const partes = partesDoTexto(
        links ? `${m.texto}\n\n${links}` : m.texto,
        MAXIMO_DA_MENSAGEM_DO_WHATSAPP,
      );
      try {
        for (let i = m.partes_enviadas; i < partes.length; i++) {
          await o.carteiro.enviarTexto(m.numero, partes[i] as string);
          await gravar(
            i === partes.length - 1
              ? `update mensagens_de_conversa set whatsapp_pendente = false, whatsapp_enviada_em = now(),
                   whatsapp_partes_enviadas = $2 where id = $1`
              : "update mensagens_de_conversa set whatsapp_partes_enviadas = $2 where id = $1",
            [m.id, i + 1],
          );
        }
      } catch (erro) {
        // A janela fechou: a resposta fica só no app (ela não vale um modelo pago).
        if (erro instanceof ErroDaMeta && erro.foraDaJanela)
          await gravar("update mensagens_de_conversa set whatsapp_pendente = false where id = $1", [m.id]);
        else
          o.log.warn({ erro: (erro as Error).message, mensagemId: m.id }, "WhatsApp: resposta não entregue");
        falhouPara.add(m.numero);
        continue;
      }
      enviadas++;
    }
    return enviadas;
  });
}

async function nomeDoAgente(c: pg.PoolClient, agenteId: string): Promise<string> {
  const r = await c.query<{ nome: string }>(
    "select nome from agentes where id = $1 and empresa_id = empresa_ativa()",
    [agenteId],
  );
  return r.rows[0]?.nome ?? "Um agente";
}

const SITUACAO_EM_TEXTO: Record<string, string> = {
  aprovada: "aprovado",
  recusada: "recusado",
  vencida: "vencida",
  falhou: "aprovado, mas a ação não deu certo",
};

/**
 * Os pedidos de aprovação: dentro da janela, com os botões Aprovar e Recusar; fora dela, pelo modelo (a pessoa aprova
 * no app). Quando o pedido termina por outro caminho (o app, o Telegram, venceu), a decisão vai como texto, só dentro
 * da janela (a Meta não deixa editar a mensagem nem tirar os botões; tocar num pedido decidido responde a situação).
 */
export async function cuidarDasAprovacoesNoWhatsapp(
  o: Opcoes,
  empresaId: string,
  agora = new Date(),
): Promise<{ mandadas: number; atualizadas: number }> {
  const urlPublica = o.conversa?.urlPublica ?? "";
  const novos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query(
      "delete from aprovacoes_no_whatsapp where empresa_id = empresa_ativa() and mensagem_id is null and enviada_em < now() - interval '5 minutes'",
    );
    const r = await c.query<{
      aprovacao_id: string;
      pessoa_id: string;
      numero: string;
      nome: string;
      janela: boolean;
      fuso: string;
    }>(
      `with novos as (
         insert into aprovacoes_no_whatsapp (empresa_id, aprovacao_id, pessoa_id, conferencia)
         select p.empresa_id, p.id, w.pessoa_id, p.conferencia
           from aprovacoes p
           join agentes g on g.id = p.agente_id and g.empresa_id = p.empresa_id
           join vinculos_do_whatsapp w on w.empresa_id = p.empresa_id and w.pessoa_id in (p.pedido_por, g.responsavel_id)
          where p.empresa_id = empresa_ativa() and p.situacao = 'pendente' and p.vence_em > now()
         on conflict do nothing
         returning aprovacao_id, pessoa_id)
       select n.aprovacao_id, n.pessoa_id, w.numero, pe.nome, w.${DENTRO_DA_JANELA} as janela,
              coalesce(pe.fuso_horario, 'UTC') as fuso
         from novos n join vinculos_do_whatsapp w on w.pessoa_id = n.pessoa_id
         join pessoas pe on pe.id = n.pessoa_id`,
    );
    const saida: {
      aprovacao: Aprovacao;
      agente: string;
      pessoaId: string;
      numero: string;
      nome: string;
      janela: boolean;
      modelo: boolean;
    }[] = [];
    for (const n of r.rows) {
      const a = await buscarAprovacao(c, n.aprovacao_id);
      if (!a) continue;
      const modelo = !n.janela && (await reservarModelo(c, n.pessoa_id, n.fuso, agora));
      saida.push({
        aprovacao: a,
        agente: await nomeDoAgente(c, a.agenteId),
        pessoaId: n.pessoa_id,
        numero: n.numero,
        nome: n.nome,
        janela: n.janela,
        modelo,
      });
    }
    return saida;
  });
  let mandadas = 0;
  for (const n of novos) {
    let mensagemId: string;
    try {
      if (n.janela) {
        const texto = `${textoDaAprovacaoNoTelegram({
          agente: n.agente,
          resumo: n.aprovacao.resumo,
          motivo: n.aprovacao.motivo,
          parametros: n.aprovacao.parametros,
          venceEm: n.aprovacao.venceEm,
        })}\n\nNo app: ${urlPublica}/aprovacoes/${n.aprovacao.id}`;
        mensagemId = await o.carteiro.enviarBotoes(n.numero, texto, [
          { id: `ap:a:${n.aprovacao.id}`, titulo: "Aprovar" },
          { id: `ap:r:${n.aprovacao.id}`, titulo: "Recusar" },
        ]);
      } else if (n.modelo) {
        mensagemId = await o.carteiro.enviarModelo(n.numero, MODELOS_DO_WHATSAPP.aviso, [
          primeiroNome(n.nome),
          `${n.agente} pede a sua aprovação: ${n.aprovacao.resumo}`.slice(0, 200),
        ]);
      } else mensagemId = "sem-envio";
    } catch (erro) {
      o.log.warn({ erro: (erro as Error).message }, "WhatsApp: o pedido de aprovação não foi mandado");
      // Fora da janela (ou o modelo ainda não aprovado na Meta): não tenta de novo, o pedido fica no app.
      mensagemId = "sem-envio";
    }
    await comEmpresa(o.poolApp, empresaId, (c) =>
      c.query(
        `update aprovacoes_no_whatsapp set mensagem_id = $3, atualizada_em = case when $3 = 'sem-envio' then now() end
          where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = $2`,
        [n.aprovacao.id, n.pessoaId, mensagemId],
      ),
    );
    if (mensagemId !== "sem-envio") mandadas++;
  }

  // Os pedidos que terminaram por outro caminho: a decisão, só dentro da janela.
  const decididos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<{
      aprovacao_id: string;
      pessoa_id: string;
      numero: string | null;
      janela: boolean | null;
    }>(
      `select n.aprovacao_id, n.pessoa_id, w.numero, w.${DENTRO_DA_JANELA} as janela
         from aprovacoes_no_whatsapp n
         join aprovacoes p on p.empresa_id = n.empresa_id and p.id = n.aprovacao_id
         left join vinculos_do_whatsapp w on w.pessoa_id = n.pessoa_id and w.empresa_id = n.empresa_id
        where n.empresa_id = empresa_ativa() and n.atualizada_em is null and n.mensagem_id is not null
          and (p.situacao in ('recusada', 'vencida', 'falhou') or (p.situacao = 'aprovada' and p.resultado is not null)
               or (p.situacao = 'pendente' and p.vence_em <= now()))
        limit 50`,
    );
    const saida: { aprovacao: Aprovacao; pessoaId: string; numero: string | null; janela: boolean }[] = [];
    for (const n of r.rows) {
      const a = await buscarAprovacao(c, n.aprovacao_id);
      if (a) saida.push({ aprovacao: a, pessoaId: n.pessoa_id, numero: n.numero, janela: n.janela === true });
    }
    return saida;
  });
  let atualizadas = 0;
  for (const d of decididos) {
    if (d.numero && d.janela) {
      const situacao = d.aprovacao.situacao === "pendente" ? "vencida" : d.aprovacao.situacao;
      const linha =
        situacao === "vencida"
          ? `O pedido "${d.aprovacao.resumo}" venceu: a ação não aconteceu.`
          : `O pedido "${d.aprovacao.resumo}" foi ${SITUACAO_EM_TEXTO[situacao] ?? situacao}.`;
      try {
        await o.carteiro.enviarTexto(d.numero, linha);
      } catch (erro) {
        if (!(erro instanceof ErroDaMeta && erro.foraDaJanela)) {
          o.log.warn({ erro: (erro as Error).message }, "WhatsApp: a decisão do pedido não foi avisada");
          continue;
        }
      }
    }
    await comEmpresa(o.poolApp, empresaId, (c) =>
      c.query(
        "update aprovacoes_no_whatsapp set atualizada_em = now() where empresa_id = empresa_ativa() and aprovacao_id = $1 and pessoa_id = $2",
        [d.aprovacao.id, d.pessoaId],
      ),
    );
    atualizadas++;
  }
  return { mandadas, atualizadas };
}

/**
 * O modelo de um aviso fora da janela: a tarefa nova vai pelo tarefa_atribuida e o prazo (de hoje ou vencido) pelo
 * lembrete_de_tarefa, com o primeiro nome e o título da tarefa; o resto, pelo aviso_do_mago_os, com o texto do aviso.
 */
export function modeloDoAviso(
  a: { tipo: TipoDeAviso; texto: string; titulo: string | null },
  nome: string,
): { nome: string; valores: string[] } {
  if (a.titulo && a.tipo === "tarefa_atribuida")
    return { nome: MODELOS_DO_WHATSAPP.tarefaAtribuida, valores: [nome, a.titulo.slice(0, 200)] };
  if (a.titulo && (a.tipo === "prazo_hoje" || a.tipo === "prazo_vencido"))
    return { nome: MODELOS_DO_WHATSAPP.lembreteDeTarefa, valores: [nome, a.titulo.slice(0, 200)] };
  return { nome: MODELOS_DO_WHATSAPP.aviso, valores: [nome, a.texto.slice(0, 200)] };
}

/**
 * Os avisos marcados de uma empresa, a quem tem o WhatsApp nela e o tipo ligado no WhatsApp (o padrão é o urgente,
 * como no Telegram). No silêncio, espera; depois de 12 horas, desiste. Dentro da janela, como texto; fora, pelo modelo
 * aviso_do_mago_os, até 10 por pessoa por dia. A marca sai antes de mandar: nada vai duas vezes.
 */
export async function avisarNoWhatsapp(o: Opcoes, empresaId: string, agora = new Date()): Promise<number> {
  const urlPublica = o.conversa?.urlPublica ?? "";
  const envios = await comEmpresa(o.poolApp, empresaId, async (c) => {
    await c.query(
      `update avisos a set whatsapp_pendente = false
        where a.empresa_id = empresa_ativa() and a.whatsapp_pendente
          and not exists (select 1 from vinculos_do_whatsapp w where w.empresa_id = a.empresa_id and w.pessoa_id = a.pessoa_id)`,
    );
    await c.query(
      `update avisos set whatsapp_pendente = false
        where empresa_id = empresa_ativa() and whatsapp_pendente and criado_em < now() - make_interval(hours => $1)`,
      [HORAS_PARA_DESISTIR_DO_AVISO_NO_TELEGRAM],
    );
    const pessoas = await c.query<{
      pessoa_id: string;
      numero: string;
      nome: string;
      fuso: string;
      janela: boolean;
    }>(
      `select distinct a.pessoa_id, w.numero, p.nome, coalesce(p.fuso_horario, 'UTC') as fuso, w.${DENTRO_DA_JANELA} as janela
         from avisos a
         join vinculos_do_whatsapp w on w.empresa_id = a.empresa_id and w.pessoa_id = a.pessoa_id
         join pessoas p on p.id = a.pessoa_id
        where a.empresa_id = empresa_ativa() and a.whatsapp_pendente`,
    );
    const saida: { numero: string; texto: string; modelo: { nome: string; valores: string[] } | null }[] = [];
    for (const pessoa of pessoas.rows) {
      const prefs = await preferenciasDe(c, pessoa.pessoa_id);
      if (emSilencio(prefs.silencio, agoraNoFuso(pessoa.fuso, agora).hora)) continue;
      const avisos = await c.query<{ tipo: TipoDeAviso; texto: string; link: string; titulo: string | null }>(
        `with marcados as (
           update avisos set whatsapp_pendente = false
            where id in (select id from avisos where empresa_id = empresa_ativa() and pessoa_id = $1 and whatsapp_pendente
                          order by criado_em limit 20 for update skip locked)
            returning tipo, texto, link, tarefa_id, empresa_id)
         select m.tipo, m.texto, m.link, t.titulo
           from marcados m left join tarefas t on t.id = m.tarefa_id and t.empresa_id = m.empresa_id`,
        [pessoa.pessoa_id],
      );
      for (const a of avisos.rows) {
        if (!canaisDoTipo(prefs, a.tipo).whatsapp) continue;
        if (pessoa.janela)
          saida.push({
            numero: pessoa.numero,
            texto: textoDoAvisoNoTelegram(a.texto, `${urlPublica}${a.link}`),
            modelo: null,
          });
        else if (await reservarModelo(c, pessoa.pessoa_id, pessoa.fuso, agora))
          saida.push({
            numero: pessoa.numero,
            texto: "",
            modelo: modeloDoAviso(a, primeiroNome(pessoa.nome)),
          });
      }
    }
    return saida;
  });
  let enviados = 0;
  for (const e of envios) {
    const envio = e.modelo
      ? o.carteiro.enviarModelo(e.numero, e.modelo.nome, e.modelo.valores)
      : o.carteiro.enviarTexto(e.numero, e.texto);
    await envio
      .then(() => {
        enviados++;
      })
      .catch((erro) =>
        o.log.warn({ erro: (erro as Error).message }, "WhatsApp: o aviso não foi (fica no app)"),
      );
  }
  return enviados;
}

const MINUTOS_DA_JANELA_DO_RESUMO = 120;
const emMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

/** O resumo do dia, uma vez por dia, na hora da pessoa, só dentro da janela (ele não vale um modelo pago). */
export async function resumoDoDiaNoWhatsapp(
  o: Opcoes,
  empresaId: string,
  agora = new Date(),
): Promise<number> {
  const conv = o.conversa;
  if (!conv) return 0;
  const devidos = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const livre = await c.query<{ ok: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended('whatsapp-resumo:' || empresa_ativa()::text, 0)) as ok",
    );
    if (!livre.rows[0]?.ok) return [];
    const r = await c.query<{
      pessoa_id: string;
      numero: string;
      fuso: string;
      resumo_do_dia_em: string | null;
      janela: boolean;
    }>(
      `select w.pessoa_id, w.numero, coalesce(p.fuso_horario, 'UTC') as fuso, w.resumo_do_dia_em::text,
              w.${DENTRO_DA_JANELA} as janela
         from vinculos_do_whatsapp w join pessoas p on p.id = w.pessoa_id
        where w.empresa_id = empresa_ativa()`,
    );
    const saida: { pessoaId: string; numero: string }[] = [];
    for (const v of r.rows) {
      const { dia, hora } = agoraNoFuso(v.fuso, agora);
      if (v.resumo_do_dia_em === dia) continue;
      const prefs = await preferenciasDe(c, v.pessoa_id);
      const horaDoDia = horaDoResumo(prefs);
      if (horaDoDia !== null) {
        const passou = emMinutos(hora) - emMinutos(horaDoDia);
        if (passou < 0) continue;
        if (passou < MINUTOS_DA_JANELA_DO_RESUMO && emSilencio(prefs.silencio, hora)) continue;
      }
      await c.query("select marcar_resumo_do_dia_no_whatsapp($1, $2::date)", [v.pessoa_id, dia]);
      if (
        v.janela &&
        horaDoDia !== null &&
        emMinutos(hora) - emMinutos(horaDoDia) < MINUTOS_DA_JANELA_DO_RESUMO
      )
        saida.push({ pessoaId: v.pessoa_id, numero: v.numero });
    }
    return saida;
  });
  let enviados = 0;
  for (const d of devidos) {
    try {
      const permissoes = await permissoesNaEmpresa(o.poolApp, d.pessoaId, empresaId, conv.catalogo);
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
      for (const parte of partesDoTexto(texto, MAXIMO_DA_MENSAGEM_DO_WHATSAPP))
        await o.carteiro.enviarTexto(d.numero, parte);
      enviados++;
    } catch (erro) {
      o.log.warn(
        { erro: (erro as Error).message, pessoaId: d.pessoaId },
        "WhatsApp: o resumo do dia não foi",
      );
    }
  }
  return enviados;
}

/** A verificação a cada minuto: o que espera para ir pelo WhatsApp em cada empresa, e o resumo do dia. */
export async function entregarPendentesNoWhatsapp(o: Opcoes, agora = new Date()): Promise<number> {
  const r = await o.poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_whatsapp_pendente()",
  );
  let total = 0;
  for (const e of r.rows) {
    total += await entregarNoWhatsapp(o, e.empresa_id).catch((erro) => {
      o.log.error({ erro: (erro as Error).message, empresaId: e.empresa_id }, "WhatsApp: entrega falhou");
      return 0;
    });
    await cuidarDasAprovacoesNoWhatsapp(o, e.empresa_id, agora).catch((erro) =>
      o.log.error(
        { erro: (erro as Error).message, empresaId: e.empresa_id },
        "WhatsApp: aprovações falharam",
      ),
    );
    await avisarNoWhatsapp(o, e.empresa_id, agora).catch((erro) =>
      o.log.error({ erro: (erro as Error).message, empresaId: e.empresa_id }, "WhatsApp: avisos falharam"),
    );
  }
  const com = await o.poolApp.query<{ empresa_id: string }>("select empresa_id from empresas_com_whatsapp()");
  for (const e of com.rows)
    await resumoDoDiaNoWhatsapp(o, e.empresa_id, agora).catch((erro) =>
      o.log.error(
        { erro: (erro as Error).message, empresaId: e.empresa_id },
        "WhatsApp: o resumo do dia falhou",
      ),
    );
  return total;
}
