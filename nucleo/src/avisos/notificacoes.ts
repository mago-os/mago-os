/**
 * Notificações (M3-06): quem recebe cada aviso de tarefa, os seguidores, as preferências, a verificação de prazos e o
 * envio do push (Web Push, chaves VAPID no Infisical). O aviso fica no sino; o push sai pela verificação a cada minuto,
 * fora do horário de silêncio. O texto do push nunca leva dado da tarefa: o detalhe aparece ao abrir, depois da checagem
 * de permissão.
 */
import {
  canaisDoTipo,
  type Perfil,
  type PreferenciasDeNotificacao,
  type TipoDeAviso,
} from "@mago-os/contratos";
import type pg from "pg";
import * as webPush from "web-push";
import { comEmpresa } from "../empresa.ts";
import { type Ajuste, filtroDoAlcance, permissaoNoModulo } from "../permissoes/calcular.ts";
import { MODULOS_DO_NUCLEO } from "../permissoes/modulos.ts";
import { buscarTarefa, type Quem } from "../tarefas/servico.ts";

/** O texto do push de cada tipo: genérico, sem título de tarefa nem nome (pode aparecer na tela bloqueada). */
export const TEXTO_DO_PUSH: Record<TipoDeAviso, string> = {
  agente_sem_sinal: "Um agente ficou sem sinal",
  agente_passou_do_limite: "Um agente passou do limite",
  agente_desligado: "Um agente foi desligado",
  tarefa_atribuida: "Uma tarefa foi passada para você",
  mencao: "Nova menção em uma tarefa",
  comentario: "Novo comentário em uma tarefa que você segue",
  resultado_entregue: "Resultado entregue em uma tarefa sua",
  precisa_de_ajuda: "Uma tarefa precisa de ajuda",
  prazo_hoje: "Uma tarefa vence hoje",
  prazo_vencido: "Uma tarefa passou do prazo",
  anexo_bloqueado: "O antivírus bloqueou um anexo",
  aprovacao_pedida: "Um agente pediu a sua aprovação",
  aprovacao_decidida: "Um pedido de aprovação foi decidido",
  teto_de_gasto: "Um teto de gasto com IA está perto ou chegou ao fim",
  agentes_parados: "Os agentes foram parados",
  agentes_retomados: "Os agentes voltaram ao trabalho",
  telegram_desvinculado: "O seu Telegram foi desvinculado",
  telegram_aprovacoes_travadas: "As aprovações pelo Telegram foram travadas",
  aviso_de_rotina: "Novo aviso de uma rotina",
  rotina_falhou: "Uma rotina sua não conseguiu rodar",
  rotina_desligada: "Rotinas foram desligadas",
  rotina_rodou: "Uma rotina sua rodou",
  convite_de_evento: "Você foi convidado para um evento",
  evento_mudou: "Um evento da sua agenda mudou",
  alerta_de_evento: "Um evento da sua agenda vai começar",
  chave_de_api_vencendo: "Uma chave de API vai vencer",
  webhook_desligado: "Um webhook foi desligado por falhas",
};

/**
 * A pessoa vê a tarefa, pela mesma regra das rotas: a permissão dela em "tarefas" e "projetos" (perfil e ajustes) vira
 * o alcance, e a consulta é a mesma de buscarTarefa. Seguir a tarefa não dá acesso a ela.
 */
export async function pessoaVeTarefa(c: pg.PoolClient, pessoaId: string, tarefaId: string): Promise<boolean> {
  const v = await c.query<{ id: string; perfil: Perfil; area: string | null }>(
    "select id, perfil, area from vinculos where empresa_id = empresa_ativa() and pessoa_id = $1 and situacao = 'ativo'",
    [pessoaId],
  );
  const vinculo = v.rows[0];
  if (!vinculo) return false;
  const a = await c.query<Ajuste>(
    "select modulo, acao, alcance from ajustes_de_permissao where vinculo_id = $1",
    [vinculo.id],
  );
  const modulo = (id: string) => MODULOS_DO_NUCLEO.find((m) => m.id === id);
  const tarefas = modulo("tarefas");
  const projetos = modulo("projetos");
  if (!tarefas) return false;
  const ver = permissaoNoModulo(vinculo, tarefas, a.rows).acoes.ver;
  const filtro = filtroDoAlcance(ver, pessoaId, vinculo.area);
  if (!filtro) return false;
  const verProjetos = projetos ? permissaoNoModulo(vinculo, projetos, a.rows).acoes.ver : "nada";
  const quem: Quem = {
    tipo: "pessoa",
    pessoaId,
    filtro,
    projetos: verProjetos === "nada" ? "nenhum" : verProjetos === "tudo" ? "todos" : "membro",
  };
  return (await buscarTarefa(c, quem, tarefaId)) !== null;
}

export async function preferenciasDe(c: pg.PoolClient, pessoaId: string): Promise<PreferenciasDeNotificacao> {
  const r = await c.query<{ preferencias: PreferenciasDeNotificacao }>(
    "select preferencias from preferencias_de_notificacao where empresa_id = empresa_ativa() and pessoa_id = $1",
    [pessoaId],
  );
  const p = r.rows[0]?.preferencias;
  return {
    porTipo: p?.porTipo ?? {},
    silencio: p?.silencio ?? null,
    // M5-08: sem o campo, o resumo do dia vai às 8h (horaDoResumo); nulo, desligado.
    ...(p && "resumoDoDia" in p ? { resumoDoDia: p.resumoDoDia ?? null } : {}),
  };
}

export async function salvarPreferencias(
  c: pg.PoolClient,
  pessoaId: string,
  p: PreferenciasDeNotificacao,
): Promise<void> {
  await c.query(
    `insert into preferencias_de_notificacao (empresa_id, pessoa_id, preferencias) values (empresa_ativa(), $1, $2::jsonb)
     on conflict (empresa_id, pessoa_id) do update set preferencias = excluded.preferencias, atualizadas_em = now()`,
    [pessoaId, JSON.stringify(p)],
  );
}

/** Passa a seguir a tarefa (só quem vê a tarefa; quem não vê fica de fora). */
export async function seguir(c: pg.PoolClient, tarefaId: string, todas: string[]): Promise<void> {
  const pessoas: string[] = [];
  for (const p of new Set(todas)) if (await pessoaVeTarefa(c, p, tarefaId)) pessoas.push(p);
  if (pessoas.length === 0) return;
  await c.query(
    `insert into seguidores_de_tarefa (empresa_id, tarefa_id, pessoa_id)
     select empresa_ativa(), $1, p from unnest($2::uuid[]) as p
      where exists (select 1 from vinculos v where v.empresa_id = empresa_ativa() and v.pessoa_id = p and v.situacao = 'ativo')
     on conflict do nothing`,
    [tarefaId, [...new Set(pessoas)]],
  );
}

export async function deixarDeSeguir(c: pg.PoolClient, tarefaId: string, pessoaId: string): Promise<void> {
  await c.query(
    "delete from seguidores_de_tarefa where tarefa_id = $1 and pessoa_id = $2 and empresa_id = empresa_ativa()",
    [tarefaId, pessoaId],
  );
}

export async function segue(c: pg.PoolClient, tarefaId: string, pessoaId: string): Promise<boolean> {
  const r = await c.query(
    "select 1 from seguidores_de_tarefa where tarefa_id = $1 and pessoa_id = $2 and empresa_id = empresa_ativa()",
    [tarefaId, pessoaId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function seguidores(c: pg.PoolClient, tarefaId: string): Promise<string[]> {
  const r = await c.query<{ pessoa_id: string }>(
    "select pessoa_id from seguidores_de_tarefa where tarefa_id = $1 and empresa_id = empresa_ativa()",
    [tarefaId],
  );
  return r.rows.map((l) => l.pessoa_id);
}

/**
 * Avisa as pessoas de algo numa tarefa: tira quem fez (exceto), quem não vê a tarefa e quem desligou os dois canais do
 * tipo. Sem o sino ligado, o aviso já nasce lido (só o push sai). Devolve quantos avisos nasceram.
 */
export async function notificarTarefa(
  c: pg.PoolClient,
  dados: {
    tipo: TipoDeAviso;
    tarefaId: string;
    texto: string;
    para: (string | null | undefined)[];
    exceto?: string | null;
  },
): Promise<number> {
  let criados = 0;
  const para = [...new Set(dados.para.filter((p): p is string => !!p && p !== dados.exceto))];
  for (const pessoaId of para) {
    if (!(await pessoaVeTarefa(c, pessoaId, dados.tarefaId))) continue;
    const prefs = await preferenciasDe(c, pessoaId);
    const canais = canaisDoTipo(prefs, dados.tipo);
    if (!canais.tela && !canais.push && !canais.telegram) continue;
    const r = await c.query(
      `insert into avisos (empresa_id, pessoa_id, tipo, texto, link, tarefa_id, push_pendente, lido_em, telegram_pendente)
       values (empresa_ativa(), $1, $2, $3, $4, $5, $6, case when $7 then null else now() end, $8)`,
      [
        pessoaId,
        dados.tipo,
        dados.texto.slice(0, 500),
        `/tarefas/${dados.tarefaId}`,
        dados.tarefaId,
        canais.push,
        canais.tela,
        canais.telegram,
      ],
    );
    criados += r.rowCount ?? 0;
  }
  return criados;
}

/** "Hoje" e a hora agora (HH:MM) no fuso. */
export function agoraNoFuso(fusoPedido: string, agora: Date): { dia: string; hora: string } {
  let fuso = fusoPedido;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
  } catch {
    fuso = "UTC";
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** Está no horário de silêncio (que pode atravessar a meia-noite, como 22:00 a 07:00). */
export function emSilencio(silencio: PreferenciasDeNotificacao["silencio"], hora: string): boolean {
  if (!silencio) return false;
  const { de, ate } = silencio;
  return de <= ate ? hora >= de && hora < ate : hora >= de || hora < ate;
}

/**
 * Verificação de prazos (fila, a cada minuto): avisa "vence hoje" (o dia do prazo é hoje no fuso de quem recebe) e
 * "venceu" uma vez por prazo. Recebe a pessoa responsável; com um agente responsável, a pessoa responsável por ele;
 * sem responsável, quem criou.
 */
export async function verificarPrazos(poolApp: pg.Pool, agora = new Date()): Promise<number> {
  const empresas = await poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_prazo_para_avisar()",
  );
  let total = 0;
  for (const { empresa_id } of empresas.rows) {
    total += await comEmpresa(poolApp, empresa_id, async (c) => {
      // Fuso inválido de uma pessoa não pode parar a verificação: cai para UTC.
      const r = await c.query<{
        id: string;
        titulo: string;
        prazo_em: Date;
        avisou_hoje: boolean;
        avisou_vencido: boolean;
        quem: string | null;
        fuso: string;
      }>(
        `select t.id, t.titulo, t.prazo_em, t.avisou_prazo_hoje_em is not null as avisou_hoje,
                t.avisou_prazo_vencido_em is not null as avisou_vencido,
                coalesce(t.responsavel_pessoa_id, a.responsavel_id, t.criada_por_pessoa_id) as quem,
                coalesce(p.fuso_horario, e.fuso_horario, 'UTC') as fuso
           from tarefas t
           left join agentes a on a.id = t.responsavel_agente_id and a.empresa_id = t.empresa_id
           left join pessoas p on p.id = coalesce(t.responsavel_pessoa_id, a.responsavel_id, t.criada_por_pessoa_id)
           join empresas e on e.id = t.empresa_id
          where t.empresa_id = empresa_ativa() and t.prazo_em is not null and t.status not in ('concluida', 'cancelada')
            and ((t.avisou_prazo_vencido_em is null and t.prazo_em < $1)
                 or (t.avisou_prazo_hoje_em is null and t.prazo_em < $1::timestamptz + interval '1 day'))
          for update of t`,
        [agora],
      );
      let n = 0;
      for (const t of r.rows) {
        const vencida = t.prazo_em.getTime() < agora.getTime();
        if (vencida && !t.avisou_vencido) {
          n += await notificarTarefa(c, {
            tipo: "prazo_vencido",
            tarefaId: t.id,
            texto: `A tarefa "${t.titulo}" passou do prazo.`,
            para: [t.quem],
          });
          await c.query(
            "update tarefas set avisou_prazo_vencido_em = now(), avisou_prazo_hoje_em = coalesce(avisou_prazo_hoje_em, now()) where id = $1",
            [t.id],
          );
          continue;
        }
        if (
          !vencida &&
          !t.avisou_hoje &&
          agoraNoFuso(t.fuso, t.prazo_em).dia === agoraNoFuso(t.fuso, agora).dia
        ) {
          n += await notificarTarefa(c, {
            tipo: "prazo_hoje",
            tarefaId: t.id,
            texto: `A tarefa "${t.titulo}" vence hoje.`,
            para: [t.quem],
          });
          await c.query("update tarefas set avisou_prazo_hoje_em = now() where id = $1", [t.id]);
        }
      }
      return n;
    });
  }
  return total;
}

export interface ChavesVapid {
  publica: string;
  privada: string;
  /** Contato do remetente (mailto:), exigido pelo padrão. */
  assunto: string;
}

export type Enviador = (
  assinatura: { endpoint: string; keys: { p256dh: string; auth: string } },
  conteudo: string,
) => Promise<{ statusCode: number }>;

/** Envio de verdade, pelo pacote web-push com as chaves VAPID. */
export function enviadorWebPush(chaves: ChavesVapid): Enviador {
  return (assinatura, conteudo) =>
    webPush.sendNotification(assinatura, conteudo, {
      vapidDetails: { subject: chaves.assunto, publicKey: chaves.publica, privateKey: chaves.privada },
      TTL: 60 * 60 * 24,
    });
}

/**
 * Manda os pushes pendentes (fila, a cada minuto). Por pessoa: no silêncio dela, os avisos esperam; fora dele, os
 * avisos são marcados como enviados numa transação curta e o envio pela internet acontece depois, fora da transação
 * (sem segurar o banco, e sem mandar duas vezes se algo falhar no meio). Tipo com o push desligado nas preferências
 * não sai. Assinatura que o serviço diz não existir mais (404, 410) é apagada.
 */
export async function enviarPushPendentes(
  poolApp: pg.Pool,
  enviar: Enviador,
  log: { warn(obj: unknown, msg?: string): void },
  agora = new Date(),
): Promise<number> {
  const empresas = await poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_push_pendente()",
  );
  let enviados = 0;
  for (const { empresa_id } of empresas.rows) {
    try {
      const lote = await comEmpresa(poolApp, empresa_id, async (c) => {
        const pessoas = await c.query<{ pessoa_id: string; fuso: string }>(
          `select distinct a.pessoa_id, coalesce(p.fuso_horario, 'UTC') as fuso
             from avisos a join pessoas p on p.id = a.pessoa_id
            where a.empresa_id = empresa_ativa() and a.push_pendente`,
        );
        const envios: {
          assinatura: { id: string; endpoint: string; p256dh: string; auth: string };
          conteudo: string;
        }[] = [];
        for (const pessoa of pessoas.rows) {
          const prefs = await preferenciasDe(c, pessoa.pessoa_id);
          if (emSilencio(prefs.silencio, agoraNoFuso(pessoa.fuso, agora).hora)) continue;
          const avisos = await c.query<{ id: string; tipo: TipoDeAviso; link: string }>(
            `update avisos set push_pendente = false
              where id in (select id from avisos where empresa_id = empresa_ativa() and pessoa_id = $1 and push_pendente
                            order by criado_em limit 50 for update skip locked)
              returning id, tipo, link`,
            [pessoa.pessoa_id],
          );
          const assinaturas = await c.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
            `select s.id, s.endpoint, s.p256dh, s.auth from assinaturas_de_push s
              where s.empresa_id = empresa_ativa() and s.pessoa_id = $1 and aparelho_conectado(s.aparelho_id, s.pessoa_id)`,
            [pessoa.pessoa_id],
          );
          for (const a of avisos.rows) {
            if (prefs.porTipo[a.tipo]?.push === false) continue;
            const conteudo = JSON.stringify({
              titulo: "Mago OS",
              corpo: TEXTO_DO_PUSH[a.tipo],
              link: a.link,
            });
            for (const assinatura of assinaturas.rows) envios.push({ assinatura, conteudo });
          }
        }
        return envios;
      });
      const entregues: string[] = [];
      const sumiram: string[] = [];
      for (const { assinatura: s, conteudo } of lote) {
        try {
          await enviar({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, conteudo);
          entregues.push(s.id);
          enviados += 1;
        } catch (erro) {
          const status = (erro as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) sumiram.push(s.id);
          else log.warn({ evento: "push.falhou", status }, "Push não saiu");
        }
      }
      if (entregues.length + sumiram.length > 0) {
        await comEmpresa(poolApp, empresa_id, async (c) => {
          await c.query("update assinaturas_de_push set ultimo_envio_em = now() where id = any($1::uuid[])", [
            entregues,
          ]);
          await c.query("delete from assinaturas_de_push where id = any($1::uuid[])", [sumiram]);
        });
      }
    } catch (erro) {
      log.warn({ erro, evento: "push.empresa_falhou" }, "Push de uma empresa não saiu");
    }
  }
  return enviados;
}
