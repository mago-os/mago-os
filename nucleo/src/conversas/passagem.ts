/**
 * Passagem da conversa para uma pessoa (M8-06, decisão 0056). Os sinais em duas camadas: o sistema passa sozinho,
 * sem chamar a IA (o contato pede uma pessoa com palavras claras, repete a mesma pergunta, fala de um assunto do
 * canal, ou o agente já respondeu 15 vezes seguidas), e o agente passa com a ferramenta passar_para_uma_pessoa. Ao
 * passar: a conversa vai para "esperando a equipe" com o motivo e o resumo, sai a mensagem de passagem ao contato, e
 * o responsável pelo contato (ou a equipe do canal) é avisado, sem o resumo. Se ninguém assumir no prazo do canal,
 * dentro do horário, o gestor da área é avisado, uma vez.
 */
import type { HorarioDoCanal, MotivoDaPassagem } from "@mago-os/contratos";
import type pg from "pg";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa } from "../empresa.ts";
import { fusoDaEmpresa } from "../tarefas/planejamento.ts";
import { dentroDoHorario } from "./atendimento.ts";

/** Respostas seguidas do agente (sem uma pessoa falar) até a conversa ir para uma pessoa: a conversa em círculos. */
export const RESPOSTAS_SEGUIDAS_DO_AGENTE = 15;
/** A pergunta repetida só conta com este tamanho (para não contar "oi" e "ok"). */
const LETRAS_DA_PERGUNTA_REPETIDA = 10;

/** O texto sem acento, sem pontuação e em minúsculas, com um espaço entre as palavras. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** O contato pede uma pessoa com palavras claras. */
const PEDE_UMA_PESSOA =
  /(^| )(atendente|humano|humana|gerente|pessoa de verdade|pessoa real|falar com (uma pessoa|alguem|uma atendente|um atendente))( |$)/;

export function pedeUmaPessoa(texto: string): boolean {
  return PEDE_UMA_PESSOA.test(normalizar(texto));
}

/** A mensagem fala de um dos assuntos do canal (a palavra inteira, sem acento). */
export function falaDeAssunto(texto: string, assuntos: string[]): boolean {
  const t = ` ${normalizar(texto)} `;
  return assuntos.some((a) => {
    const n = normalizar(a);
    return n.length > 0 && t.includes(` ${n} `);
  });
}

/**
 * Os sinais do sistema na última mensagem do contato (sem chamar a IA). A ordem: pediu uma pessoa, um assunto do
 * canal, a pergunta repetida e as respostas seguidas do agente.
 */
export async function sinalDoSistema(c: pg.PoolClient, conversaId: string): Promise<MotivoDaPassagem | null> {
  const r = await c.query<{ assuntos: string[]; desde: Date }>(
    `select cn.assuntos_para_pessoas as assuntos, cv.com_agente_desde as desde
       from conversas_com_contatos cv join canais_de_contato cn on cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
      where cv.id = $1 and cv.empresa_id = empresa_ativa()`,
    [conversaId],
  );
  const l = r.rows[0];
  if (!l) return null;
  const m = await c.query<{ autor: string; texto: string | null; enviada_em: Date }>(
    `select autor, texto, enviada_em from (
       select autor, texto, enviada_em, id from mensagens_com_contatos
        where conversa_id = $1 and empresa_id = empresa_ativa() and direcao <> 'interna'
        order by enviada_em desc, id desc limit 60) m
      order by enviada_em, id`,
    [conversaId],
  );
  const mensagens = m.rows;
  const ultima = [...mensagens].reverse().find((x) => x.autor === "contato");
  const texto = ultima?.texto ?? "";
  if (texto && pedeUmaPessoa(texto)) return "pediu_pessoa";
  if (texto && falaDeAssunto(texto, l.assuntos)) return "assunto_do_canal";
  // A mesma pergunta pela segunda vez, depois de o agente responder.
  const n = normalizar(texto);
  if (n.length >= LETRAS_DA_PERGUNTA_REPETIDA) {
    const i = mensagens.lastIndexOf(ultima as (typeof mensagens)[number]);
    for (let j = i - 1; j >= 0; j--) {
      const antes = mensagens[j];
      if (antes?.autor !== "contato" || normalizar(antes.texto ?? "") !== n) continue;
      if (mensagens.slice(j + 1, i).some((x) => x.autor === "agente")) return "repetiu";
    }
  }
  // As respostas seguidas do agente, desde que a conversa está com ele e desde a última fala de uma pessoa.
  const ultimaDaPessoa = [...mensagens].reverse().find((x) => x.autor === "pessoa")?.enviada_em;
  const desde = ultimaDaPessoa && ultimaDaPessoa > l.desde ? ultimaDaPessoa : l.desde;
  const seguidas = mensagens.filter((x) => x.autor === "agente" && x.enviada_em > desde).length;
  if (seguidas >= RESPOSTAS_SEGUIDAS_DO_AGENTE) return "em_circulos";
  return null;
}

const MOTIVOS: Record<MotivoDaPassagem, string> = {
  pediu_pessoa: "pediu para falar com uma pessoa",
  irritado: "parece irritado",
  repetiu: "repetiu a mesma pergunta",
  em_circulos: "a conversa não anda",
  nao_soube: "o agente não soube responder",
  assunto_do_canal: "o assunto vai sempre para uma pessoa",
};

/** Quem vê as conversas do canal pela regra das conversas (M8-01): o gestor e o administrador veem todas. */
const VE_O_CANAL = `v.situacao = 'ativo' and (v.perfil in ('administrador', 'gestor_area') or $1::text is null or v.area = $1)`;

export interface Passagem {
  motivo: MotivoDaPassagem;
  resumo?: string | null;
  sugestao?: string | null;
  agenteId?: string | null;
  execucaoId?: string | null;
}

/** A sugestão de resposta da passagem (ou do silêncio): substitui a pendente; sai pela pessoa que enviar. */
export async function guardarSugestaoComPessoa(
  c: pg.PoolClient,
  conversaId: string,
  texto: string,
  agenteId: string | null,
  execucaoId: string | null,
): Promise<string | null> {
  const limpo = texto.trim().slice(0, 4096);
  if (!limpo) return null;
  await c.query(
    `update sugestoes_de_resposta set situacao = 'descartada', decidida_em = now()
      where conversa_id = $1 and empresa_id = empresa_ativa() and situacao = 'pendente'`,
    [conversaId],
  );
  const s = await c.query<{ id: string }>(
    `insert into sugestoes_de_resposta (empresa_id, conversa_id, agente_id, execucao_id, texto, com_pessoa)
     values (empresa_ativa(), $1, $2, $3, $4, true) returning id`,
    [conversaId, agenteId, execucaoId, limpo],
  );
  return s.rows[0]?.id ?? null;
}

/**
 * Passa a conversa do agente para uma pessoa: "esperando a equipe", sem dono, com o motivo e o resumo; a mensagem de
 * passagem entra para sair ao contato (uma vez por passagem); o responsável pelo contato (se vê o canal) ou a equipe
 * do canal é avisado, sem o resumo. Nula quando a conversa já não estava com o agente. Devolve a mensagem a mandar.
 */
export async function passarParaUmaPessoa(
  c: pg.PoolClient,
  conversaId: string,
  p: Passagem,
): Promise<{ mensagemId: string | null } | null> {
  const r = await c.query<{
    canal_id: string;
    area: string | null;
    canal: string;
    contato: string;
    responsavel_id: string | null;
    mensagem: string;
  }>(
    `update conversas_com_contatos cv
        set com_agente = false, dono_id = null, situacao = 'esperando_equipe', passada_em = now(),
            motivo_da_passagem = $2, resumo_da_passagem = $3, escalada_em = null
       from canais_de_contato cn, contatos k
      where cv.id = $1 and cv.empresa_id = empresa_ativa() and cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
        and k.id = cv.contato_id and k.empresa_id = cv.empresa_id and cv.com_agente and cv.situacao <> 'resolvida'
      returning cn.id as canal_id, cn.area, cn.nome as canal, k.nome as contato, k.responsavel_id,
                cn.mensagem_de_passagem as mensagem`,
    [conversaId, p.motivo, p.resumo?.trim().slice(0, 2000) || null],
  );
  const cv = r.rows[0];
  if (!cv) return null;
  const m = await c.query<{ id: string }>(
    `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, tipo, texto, entrega)
     values (empresa_ativa(), $1, $2, 'saiu', 'sistema', 'texto', $3, 'pendente') returning id`,
    [conversaId, cv.canal_id, cv.mensagem],
  );
  if (p.sugestao?.trim())
    await guardarSugestaoComPessoa(c, conversaId, p.sugestao, p.agenteId ?? null, p.execucaoId ?? null);
  // O responsável pelo contato, se ele vê o canal; senão, a equipe do canal.
  let quem: string[] = [];
  if (cv.responsavel_id) {
    const v = await c.query<{ pessoa_id: string }>(
      `select v.pessoa_id from vinculos v where v.empresa_id = empresa_ativa() and v.pessoa_id = $2 and ${VE_O_CANAL}`,
      [cv.area, cv.responsavel_id],
    );
    quem = v.rows.map((x) => x.pessoa_id);
  }
  if (quem.length === 0) {
    const equipe = await c.query<{ pessoa_id: string }>(
      `select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
          and (case when $1::text is null then perfil in ('administrador', 'gestor_area') else area = $1 end)`,
      [cv.area],
    );
    quem = equipe.rows.map((x) => x.pessoa_id);
  }
  for (const pessoaId of quem)
    await criarAviso(c, {
      pessoaId,
      tipo: "conversa_precisa_de_pessoa",
      texto: `O agente passou para a equipe a conversa de "${cv.contato}" no canal "${cv.canal}": ${MOTIVOS[p.motivo]}.`,
      link: `/conversas/${conversaId}`,
    });
  return { mensagemId: m.rows[0]?.id ?? null };
}

/** O resumo e a sugestão que o agente escreve depois de o sistema passar a conversa (o motivo fica o do sistema). */
export async function completarPassagem(
  c: pg.PoolClient,
  conversaId: string,
  p: { resumo: string; sugestao?: string | null; agenteId: string; execucaoId: string },
): Promise<void> {
  const r = await c.query(
    `update conversas_com_contatos set resumo_da_passagem = $2
      where id = $1 and empresa_id = empresa_ativa() and passada_em is not null and resumo_da_passagem is null`,
    [conversaId, p.resumo.trim().slice(0, 2000) || null],
  );
  if ((r.rowCount ?? 0) > 0 && p.sugestao?.trim())
    await guardarSugestaoComPessoa(c, conversaId, p.sugestao, p.agenteId, p.execucaoId);
}

/** Devolver ao agente: a passagem e o prazo acabam, a sugestão pendente sai, e a contagem das respostas recomeça. */
export async function limparPassagem(c: pg.PoolClient, conversaId: string): Promise<void> {
  await c.query(
    `update conversas_com_contatos
        set passada_em = null, motivo_da_passagem = null, resumo_da_passagem = null, escalada_em = null,
            com_agente_desde = now()
      where id = $1 and empresa_id = empresa_ativa()`,
    [conversaId],
  );
  await c.query(
    `update sugestoes_de_resposta set situacao = 'descartada', decidida_em = now()
      where conversa_id = $1 and empresa_id = empresa_ativa() and situacao = 'pendente'`,
    [conversaId],
  );
}

/**
 * A verificação do prazo (a cada minuto): a conversa passada que ninguém assumiu nem respondeu no prazo do canal vai
 * ao gestor da área (sem gestor ou sem área, aos administradores), uma vez. Fora do horário, espera a abertura.
 */
export async function cuidarDasPassagensVencidas(
  poolApp: pg.Pool,
  agora: Date = new Date(),
): Promise<number> {
  const empresas = await poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_passagens_vencidas()",
  );
  let n = 0;
  for (const { empresa_id } of empresas.rows)
    n += await comEmpresa(poolApp, empresa_id, async (c) => {
      const fuso = await fusoDaEmpresa(c);
      const r = await c.query<{
        id: string;
        area: string | null;
        horario: HorarioDoCanal;
        canal: string;
        contato: string;
        prazo: number;
      }>(
        `select cv.id, cn.area, cn.horario, cn.nome as canal, k.nome as contato, cn.prazo_para_assumir as prazo
           from conversas_com_contatos cv
           join canais_de_contato cn on cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
           join contatos k on k.id = cv.contato_id and k.empresa_id = cv.empresa_id
          where cv.empresa_id = empresa_ativa() and cv.passada_em is not null and cv.escalada_em is null
            and cv.dono_id is null and not cv.com_agente and cv.situacao <> 'resolvida'
            and cv.passada_em + make_interval(mins => cn.prazo_para_assumir) < $1
            and not exists (select 1 from mensagens_com_contatos m where m.conversa_id = cv.id
                              and m.empresa_id = cv.empresa_id and m.autor = 'pessoa' and m.enviada_em > cv.passada_em)
          for update of cv skip locked`,
        [agora],
      );
      let feitas = 0;
      for (const cv of r.rows) {
        if (!dentroDoHorario(cv.horario, fuso, agora)) continue;
        await c.query(
          "update conversas_com_contatos set escalada_em = now() where id = $1 and empresa_id = empresa_ativa()",
          [cv.id],
        );
        const gestores = await c.query<{ pessoa_id: string }>(
          `select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
              and perfil = 'gestor_area' and $1::text is not null and area = $1`,
          [cv.area],
        );
        const quem =
          gestores.rows.length > 0
            ? gestores.rows
            : (
                await c.query<{ pessoa_id: string }>(
                  "select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo' and perfil = 'administrador'",
                )
              ).rows;
        for (const p of quem)
          await criarAviso(c, {
            pessoaId: p.pessoa_id,
            tipo: "conversa_passou_do_prazo",
            texto: `Ninguém assumiu em ${cv.prazo} minutos a conversa de "${cv.contato}" no canal "${cv.canal}", que o agente passou para a equipe.`,
            link: `/conversas/${cv.id}`,
          });
        feitas += 1;
      }
      return feitas;
    });
  return n;
}
