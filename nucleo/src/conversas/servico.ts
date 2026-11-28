/**
 * Conversas com contatos (M8-01, decisão 0051). Quem vê vem do alcance do módulo "conversas": tudo; equipe (as
 * conversas dos canais da área da pessoa, as dos canais sem equipe e as de que ela é dona); meus (só as de que é
 * dona). O banco isola as empresas. Cada função recebe uma lista de quem olha: na tela é a pessoa; no agente, quem
 * pediu e o responsável por ele (vale o menor dos dois, M4-04).
 */
import {
  type Alcance,
  type Canal,
  type ConversaComContato,
  type FiltroDeConversas,
  type MensagemDaConversa,
  type MensagemQueChegou,
  MINUTOS_DE_FOLGA_DEPOIS_DE_RESOLVER,
  MINUTOS_ENTRE_AVISOS_DA_CONVERSA,
  type ProvedorDeCanal,
  type ResumoDaConversa,
} from "@mago-os/contratos";
import type pg from "pg";
import { criarAviso } from "../avisos/index.ts";
import type { PermissoesNaEmpresa } from "../permissoes/verificar.ts";
import { formasDoTelefone, telefoneInternacional } from "./telefone.ts";

/** Recusa com texto para a tela e para o agente. */
export class RecusaDasConversas extends Error {}

export interface QuemOlhaConversas {
  pessoaId: string;
  alcance: Alcance;
  area: string | null;
}

export type AcaoNasConversas = "ver" | "criar" | "editar" | "excluir";

export function quemOlhaConversas(
  p: PermissoesNaEmpresa,
  pessoaId: string,
  acao: AcaoNasConversas,
): QuemOlhaConversas {
  return { pessoaId, alcance: p.modulos.get("conversas")?.acoes[acao] ?? "nada", area: p.area };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A condição SQL (sobre a conversa "cv" e o canal "cn") das conversas que todos os que olham alcançam. Acrescenta
 * os valores em "valores". Alguém com "nada": nenhuma conversa.
 */
export function condicaoDasConversas(
  olham: QuemOlhaConversas[],
  valores: unknown[],
  cv = "cv",
  cn = "cn",
): string {
  const v = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  const partes = olham.map((q) => {
    if (q.alcance === "nada") return "false";
    if (q.alcance === "tudo") return "true";
    const minhas = `${cv}.dono_id = ${v(q.pessoaId)}::uuid`;
    if (q.alcance === "meus") return `(${minhas})`;
    const daEquipe = q.area === null ? "false" : `${cn}.area = ${v(q.area)}`;
    return `(${minhas} or ${cn}.area is null or ${daEquipe})`;
  });
  return partes.length === 0 ? "false" : `(${partes.join(" and ")})`;
}

interface LinhaDaConversa {
  id: string;
  empresa_id: string;
  canal_id: string;
  canal_nome: string;
  canal_provedor: ProvedorDeCanal;
  canal_situacao: Canal["situacao"];
  contato_id: string;
  contato_nome: string;
  contato_identificado: boolean;
  identificador: string;
  mais_de_um_contato: boolean;
  dono_id: string | null;
  com_agente: boolean;
  situacao: ConversaComContato["situacao"];
  ultimo_a_responder: ConversaComContato["ultimoAResponder"];
  ultima_mensagem_em: Date | null;
  aberta_em: Date;
  resolvida_em: Date | null;
  resolvida_por: string | null;
}

const COLUNAS = `cv.id, cv.empresa_id, cv.canal_id, cn.nome as canal_nome, cn.provedor as canal_provedor,
  cn.situacao as canal_situacao, cv.contato_id, k.nome as contato_nome, k.identificado as contato_identificado,
  cv.identificador, cv.mais_de_um_contato, cv.dono_id, cv.com_agente, cv.situacao, cv.ultimo_a_responder,
  cv.ultima_mensagem_em, cv.aberta_em, cv.resolvida_em, cv.resolvida_por`;

const DE = `conversas_com_contatos cv
  join canais_de_contato cn on cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
  join contatos k on k.id = cv.contato_id and k.empresa_id = cv.empresa_id`;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function paraConversa(l: LinhaDaConversa): ConversaComContato {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    canal: { id: l.canal_id, nome: l.canal_nome, provedor: l.canal_provedor, situacao: l.canal_situacao },
    contatoId: l.contato_id,
    contatoNome: l.contato_nome,
    contatoIdentificado: l.contato_identificado,
    identificador: l.identificador,
    maisDeUmContato: l.mais_de_um_contato,
    donoId: l.dono_id,
    comAgente: l.com_agente,
    situacao: l.situacao,
    ultimoAResponder: l.ultimo_a_responder,
    ultimaMensagemEm: iso(l.ultima_mensagem_em),
    abertaEm: l.aberta_em.toISOString(),
    resolvidaEm: iso(l.resolvida_em),
    resolvidaPor: l.resolvida_por,
  };
}

/** A lista de conversas que todos os que olham veem, da mais recente para a mais antiga (até "limite"). */
export async function listarConversas(
  c: pg.PoolClient,
  olham: QuemOlhaConversas[],
  filtro: FiltroDeConversas,
  limite = 200,
): Promise<ResumoDaConversa[]> {
  const valores: unknown[] = [];
  const v = (x: unknown) => {
    valores.push(x);
    return `$${valores.length}`;
  };
  const partes = [condicaoDasConversas(olham, valores)];
  if (filtro.situacoes) partes.push(`cv.situacao = any(${v(filtro.situacoes)}::text[])`);
  if (filtro.canalId) partes.push(`cv.canal_id = ${v(filtro.canalId)}::uuid`);
  if (filtro.contatoId) partes.push(`cv.contato_id = ${v(filtro.contatoId)}::uuid`);
  if (filtro.donoId === "sem") partes.push("cv.dono_id is null");
  else if (filtro.donoId) partes.push(`cv.dono_id = ${v(filtro.donoId)}::uuid`);
  if (filtro.comAgente !== undefined) partes.push(`cv.com_agente = ${v(filtro.comAgente)}`);
  // Busca (M8-04): o nome do contato (com erro de digitação), o telefone e o texto das mensagens, sem acento.
  if (filtro.texto) {
    const Q = `para_busca(${v(filtro.texto)}::text)`;
    const contem = `('%' || replace(replace(replace(${Q}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')`;
    const digitos = filtro.texto.replace(/[\s().+-]/g, "");
    const noTelefone = /^[0-9]{4,15}$/.test(digitos)
      ? ` or cv.identificador like '%' || ${v(digitos)} || '%'`
      : "";
    partes.push(`(para_busca(k.nome) like ${contem} or ${Q} <% para_busca(k.nome)${noTelefone}
       or exists (select 1 from mensagens_com_contatos mt where mt.conversa_id = cv.id and mt.empresa_id = cv.empresa_id
                    and para_busca(coalesce(mt.texto, '')) like ${contem}))`);
  }
  const r = await c.query<
    LinhaDaConversa & { ultima_autor: string | null; ultima_tipo: string | null; ultima_texto: string | null }
  >(
    `select ${COLUNAS}, u.autor as ultima_autor, u.tipo as ultima_tipo, left(u.texto, 140) as ultima_texto
       from ${DE}
       left join lateral (select m.autor, m.tipo, m.texto from mensagens_com_contatos m
                           where m.conversa_id = cv.id and m.empresa_id = cv.empresa_id and m.direcao <> 'interna'
                           order by m.enviada_em desc, m.id desc limit 1) u on true
      where cv.empresa_id = empresa_ativa() and ${partes.join(" and ")}
      order by coalesce(cv.ultima_mensagem_em, cv.aberta_em) desc, cv.id desc
      limit ${Math.max(1, Math.min(limite, 500))}`,
    valores,
  );
  return r.rows.map((l) => ({
    conversa: paraConversa(l),
    ultimaMensagem: l.ultima_autor
      ? {
          autor: l.ultima_autor as MensagemDaConversa["autor"],
          tipo: l.ultima_tipo as MensagemDaConversa["tipo"],
          trecho: l.ultima_texto,
        }
      : null,
  }));
}

/** A conversa, se todos os que olham a alcançam. "Para mudar" trava a linha até o fim da transação. */
export async function buscarConversa(
  c: pg.PoolClient,
  olham: QuemOlhaConversas[],
  id: string,
  paraMudar = false,
): Promise<ConversaComContato | null> {
  if (!UUID.test(id)) return null;
  const valores: unknown[] = [id];
  const alcance = condicaoDasConversas(olham, valores);
  const r = await c.query<LinhaDaConversa>(
    `select ${COLUNAS} from ${DE}
      where cv.id = $1 and cv.empresa_id = empresa_ativa() and ${alcance} ${paraMudar ? "for update of cv" : ""}`,
    valores,
  );
  const l = r.rows[0];
  return l ? paraConversa(l) : null;
}

interface LinhaDaMensagem {
  id: string;
  conversa_id: string;
  direcao: MensagemDaConversa["direcao"];
  autor: MensagemDaConversa["autor"];
  autor_pessoa_id: string | null;
  autor_agente_id: string | null;
  tipo: MensagemDaConversa["tipo"];
  texto: string | null;
  enviada_em: Date;
  pelo_celular: boolean;
  entrega: MensagemDaConversa["entrega"];
  motivo_da_falha: string | null;
  arquivo: MensagemDaConversa["arquivo"];
}

const paraMensagem = (l: LinhaDaMensagem): MensagemDaConversa => ({
  id: l.id,
  conversaId: l.conversa_id,
  direcao: l.direcao,
  autor: l.autor,
  autorPessoaId: l.autor_pessoa_id,
  autorAgenteId: l.autor_agente_id,
  tipo: l.tipo,
  texto: l.texto,
  enviadaEm: l.enviada_em.toISOString(),
  peloCelular: l.pelo_celular,
  entrega: l.entrega,
  motivoDaFalha: l.motivo_da_falha,
  arquivo: l.arquivo,
});

/** As últimas mensagens da conversa (já conferida), na ordem em que aconteceram. */
export async function mensagensDaConversa(
  c: pg.PoolClient,
  conversaId: string,
  limite = 200,
): Promise<MensagemDaConversa[]> {
  const r = await c.query<LinhaDaMensagem>(
    `select * from (
       select m.id, m.conversa_id, m.direcao, m.autor, m.autor_pessoa_id, m.autor_agente_id, m.tipo, m.texto,
              m.enviada_em, m.pelo_celular, m.entrega, m.motivo_da_falha,
              (select json_build_object('id', a.id, 'nome', a.nome, 'tipo', a.tipo, 'tamanho', a.tamanho,
                                        'situacao', a.situacao)
                 from arquivos_de_conversa a where a.mensagem_id = m.id and a.empresa_id = m.empresa_id) as arquivo
         from mensagens_com_contatos m where m.conversa_id = $1 and m.empresa_id = empresa_ativa()
        order by enviada_em desc, id desc limit ${Math.max(1, Math.min(limite, 1000))}) m
      order by enviada_em, id`,
    [conversaId],
  );
  return r.rows.map(paraMensagem);
}

/** A conversa resolvida logo antes desta, do mesmo contato no mesmo canal (o contexto da "conversa anterior"). */
export async function conversaAnterior(
  c: pg.PoolClient,
  olham: QuemOlhaConversas[],
  conversa: ConversaComContato,
): Promise<ConversaComContato | null> {
  const valores: unknown[] = [conversa.canal.id, conversa.contatoId, conversa.abertaEm, conversa.id];
  const alcance = condicaoDasConversas(olham, valores);
  const r = await c.query<LinhaDaConversa>(
    `select ${COLUNAS} from ${DE}
      where cv.empresa_id = empresa_ativa() and cv.canal_id = $1 and cv.contato_id = $2
        and cv.aberta_em <= $3 and cv.id <> $4 and cv.situacao = 'resolvida' and ${alcance}
      order by cv.aberta_em desc, cv.id desc limit 1`,
    valores,
  );
  const l = r.rows[0];
  return l ? paraConversa(l) : null;
}

// Canais -------------------------------------------------------------------------------------------------------

interface LinhaDoCanal {
  id: string;
  empresa_id: string;
  nome: string;
  provedor: ProvedorDeCanal;
  situacao: Canal["situacao"];
  identificador: string | null;
  area: string | null;
  agente_id: string | null;
  criado_por: string;
  criado_em: Date;
}

const COLUNAS_DO_CANAL =
  "id, empresa_id, nome, provedor, situacao, identificador, area, agente_id, criado_por, criado_em";

const paraCanal = (l: LinhaDoCanal): Canal => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  provedor: l.provedor,
  situacao: l.situacao,
  identificador: l.identificador,
  area: l.area,
  agenteId: l.agente_id,
  criadoEm: l.criado_em.toISOString(),
});

/** Os canais da empresa (ou só um, pelo id; "para mudar" trava a linha até o fim da transação). */
export async function listarCanais(
  c: pg.PoolClient,
  so: { id: string; paraMudar?: boolean } | null = null,
): Promise<Canal[]> {
  const r = await c.query<LinhaDoCanal>(
    `select ${COLUNAS_DO_CANAL} from canais_de_contato where empresa_id = empresa_ativa()
      ${so ? "and id = $1" : ""} order by lower(nome), id ${so?.paraMudar ? "for update" : ""}`,
    so ? [so.id] : [],
  );
  return r.rows.map(paraCanal);
}

/**
 * Cadastra um canal (a tela de canais é a M8-02 e a M8-07). Um número fica preso a uma empresa só: o banco recusa o
 * número que já está em outro canal, de qualquer empresa.
 */
export async function criarCanal(
  c: pg.PoolClient,
  autorId: string,
  dados: { nome: string; provedor: ProvedorDeCanal; identificador?: string | null; area?: string | null },
): Promise<Canal> {
  try {
    await c.query("savepoint criar_canal");
    const r = await c.query<LinhaDoCanal>(
      `insert into canais_de_contato (empresa_id, nome, provedor, identificador, area, criado_por)
       values (empresa_ativa(), $1, $2, $3, $4, $5) returning ${COLUNAS_DO_CANAL}`,
      [dados.nome.trim(), dados.provedor, dados.identificador ?? null, dados.area ?? null, autorId],
    );
    await c.query("release savepoint criar_canal");
    return paraCanal(r.rows[0] as LinhaDoCanal);
  } catch (erro) {
    await c.query("rollback to savepoint criar_canal");
    if ((erro as { constraint?: string }).constraint === "canais_de_contato_numero_unico")
      throw new RecusaDasConversas("Esse número já está conectado em outro canal.");
    throw erro;
  }
}

// Achar o contato e receber a mensagem ------------------------------------------------------------------------

/**
 * O contato do telefone (decisão 0051, item 2), procurando também a forma com e sem o nono dígito: o contato em que o
 * telefone é o principal; empatado, o que tem o telefone marcado como WhatsApp; ainda empatado, o mais antigo. Os
 * juntados não aparecem (os identificadores passaram para o que ficou). "varios": o telefone está em mais de um.
 */
export async function acharContatoPeloTelefone(
  c: pg.PoolClient,
  telefone: string,
): Promise<{ contatoId: string; varios: boolean } | null> {
  const r = await c.query<{ contato_id: string }>(
    `select i.contato_id from identificadores_de_contato i
       join contatos k on k.id = i.contato_id and k.empresa_id = i.empresa_id and k.situacao <> 'juntado'
      where i.empresa_id = empresa_ativa() and i.tipo = 'telefone' and i.valor = any($1::text[])
      group by i.contato_id, k.criado_em
      order by bool_or(i.principal) desc, bool_or(i.whatsapp) desc, k.criado_em, i.contato_id`,
    [formasDoTelefone(telefone)],
  );
  const primeiro = r.rows[0];
  return primeiro ? { contatoId: primeiro.contato_id, varios: r.rows.length > 1 } : null;
}

export interface MensagemRecebida {
  conversaId: string;
  contatoId: string;
  /** Nula quando a mensagem já tinha chegado (o provedor mandou o aviso de novo). */
  mensagemId: string | null;
  contatoNovo: boolean;
  conversaNova: boolean;
  /** Caiu na conversa resolvida, na folga depois de resolver. */
  naFolga: boolean;
}

/** O identificador de quem escreve: o telefone no formato internacional, ou o visitante do site. */
function identificadorDoContato(provedor: ProvedorDeCanal, bruto: string): string {
  if (provedor === "site") {
    if (!/^visitante:[0-9a-zA-Z_-]{8,80}$/.test(bruto))
      throw new RecusaDasConversas("Visitante do site sem identificação válida.");
    return bruto;
  }
  // O WhatsApp às vezes esconde o telefone atrás de um endereço LID (M8-03): sem o telefone, fica o LID.
  if (/^lid:[0-9]{5,40}$/.test(bruto)) return bruto;
  const telefone = telefoneInternacional(bruto);
  if (!telefone) throw new RecusaDasConversas("Telefone de quem escreveu fora do formato.");
  return telefone;
}

/**
 * Grava a mensagem que chegou de um contato (trabalho do sistema, dentro de comEmpresa): acha o contato pelo
 * telefone (ou cria um "não identificado"), continua a conversa não resolvida dele no canal (ou abre outra) e grava
 * a mensagem sem repetir. Depois de resolvida, a mensagem que chega na folga de 1 hora cai na conversa resolvida,
 * sem reabrir; passada a folga, abre outra conversa (decisão 1 da spec do M8, aprovada com a folga em 27/11/2026).
 */
export async function receberMensagem(c: pg.PoolClient, m: MensagemQueChegou): Promise<MensagemRecebida> {
  if (!UUID.test(m.canalId)) throw new RecusaDasConversas("Canal não encontrado.");
  const canal = (
    await c.query<{ provedor: ProvedorDeCanal; criado_por: string }>(
      "select provedor, criado_por from canais_de_contato where id = $1 and empresa_id = empresa_ativa()",
      [m.canalId],
    )
  ).rows[0];
  if (!canal) throw new RecusaDasConversas("Canal não encontrado.");
  const identificador = identificadorDoContato(canal.provedor, m.identificador);
  const formas = identificador.startsWith("+") ? formasDoTelefone(identificador) : [identificador];
  const enviadaEm = m.enviadaEm ?? new Date().toISOString();

  // Duas mensagens do mesmo número ao mesmo tempo não criam dois contatos nem duas conversas.
  await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${m.canalId}:${[...formas].sort()[0]}`,
  ]);

  if (m.idNoProvedor) {
    const ja = await c.query<{ conversa_id: string; contato_id: string }>(
      `select m.conversa_id, cv.contato_id from mensagens_com_contatos m
         join conversas_com_contatos cv on cv.id = m.conversa_id and cv.empresa_id = m.empresa_id
        where m.empresa_id = empresa_ativa() and m.canal_id = $1 and m.id_no_provedor = $2`,
      [m.canalId, m.idNoProvedor],
    );
    const l = ja.rows[0];
    if (l)
      return {
        conversaId: l.conversa_id,
        contatoId: l.contato_id,
        mensagemId: null,
        contatoNovo: false,
        conversaNova: false,
        naFolga: false,
      };
  }

  // A conversa mais recente desse telefone no canal: a não resolvida, ou a resolvida ainda na folga.
  const ultima = (
    await c.query<{ id: string; contato_id: string; situacao: string; na_folga: boolean }>(
      `select id, contato_id, situacao,
              (situacao = 'resolvida' and resolvida_em >= now() - make_interval(mins => $3)) as na_folga
         from conversas_com_contatos
        where empresa_id = empresa_ativa() and canal_id = $1 and identificador = any($2::text[])
        order by (situacao <> 'resolvida') desc, aberta_em desc, id desc limit 1`,
      [m.canalId, formas, MINUTOS_DE_FOLGA_DEPOIS_DE_RESOLVER],
    )
  ).rows[0];

  let conversaId: string;
  let contatoId: string;
  let contatoNovo = false;
  let conversaNova = false;
  let naFolga = false;
  if (ultima && (ultima.situacao !== "resolvida" || ultima.na_folga)) {
    conversaId = ultima.id;
    contatoId = ultima.contato_id;
    naFolga = ultima.situacao === "resolvida";
  } else {
    const achado = identificador.startsWith("+") ? await acharContatoPeloTelefone(c, identificador) : null;
    if (achado) {
      contatoId = achado.contatoId;
    } else {
      contatoId = await criarContatoNaoIdentificado(c, m.canalId, canal, identificador, m.nomeDoPerfil);
      contatoNovo = true;
    }
    // O mesmo contato pode ter uma conversa aberta neste canal por outro número (ex.: o celular e o fixo): continua.
    const aberta = (
      await c.query<{ id: string }>(
        `select id from conversas_com_contatos where empresa_id = empresa_ativa() and canal_id = $1
            and contato_id = $2 and situacao <> 'resolvida'`,
        [m.canalId, contatoId],
      )
    ).rows[0];
    if (aberta) {
      conversaId = aberta.id;
    } else {
      const nova = await c.query<{ id: string }>(
        `insert into conversas_com_contatos (empresa_id, canal_id, contato_id, identificador, mais_de_um_contato)
         values (empresa_ativa(), $1, $2, $3, $4) returning id`,
        [m.canalId, contatoId, identificador, achado?.varios ?? false],
      );
      conversaId = nova.rows[0]?.id as string;
      conversaNova = true;
    }
  }

  if (m.doCelular) {
    const mensagemId = await gravarDoCelular(c, conversaId, m, enviadaEm);
    return { conversaId, contatoId, mensagemId, contatoNovo, conversaNova, naFolga };
  }
  const gravada = await c.query<{ id: string }>(
    `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, tipo, texto,
                                         id_no_provedor, enviada_em)
     values (empresa_ativa(), $1, $2, 'chegou', 'contato', $3, $4, $5, $6)
     on conflict (canal_id, id_no_provedor) where id_no_provedor is not null do nothing
     returning id`,
    [conversaId, m.canalId, m.tipo, m.texto?.trim() || null, m.idNoProvedor ?? null, enviadaEm],
  );
  const mensagemId = gravada.rows[0]?.id ?? null;
  if (mensagemId) {
    // A mensagem que chegou atrasada (mais antiga que a última) não muda quem respondeu por último.
    await c.query(
      `update conversas_com_contatos set
          ultimo_a_responder = case when ultima_mensagem_em is null or ultima_mensagem_em <= $2
                                    then 'contato' else ultimo_a_responder end,
          ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, $2), $2),
          situacao = case when situacao = 'resolvida' then situacao else 'esperando_equipe' end
        where id = $1 and empresa_id = empresa_ativa()`,
      [conversaId, enviadaEm],
    );
    await avisarDaMensagemNova(c, conversaId, conversaNova);
  }
  return { conversaId, contatoId, mensagemId, contatoNovo, conversaNova, naFolga };
}

/**
 * Os avisos da caixa (M8-04, decisão 0054): a conversa nova sem dono vai para a equipe do canal (sem equipe, os
 * administradores e os gestores); a mensagem nova numa conversa com dono vai para o dono, no máximo uma vez a cada 5
 * minutos por conversa. O texto do aviso nunca leva o que o cliente escreveu.
 */
async function avisarDaMensagemNova(c: pg.PoolClient, conversaId: string, conversaNova: boolean) {
  const r = await c.query<{
    dono_id: string | null;
    com_agente: boolean;
    area: string | null;
    canal: string;
    contato: string;
  }>(
    `select cv.dono_id, cv.com_agente, cn.area, cn.nome as canal, k.nome as contato
       from conversas_com_contatos cv
       join canais_de_contato cn on cn.id = cv.canal_id and cn.empresa_id = cv.empresa_id
       join contatos k on k.id = cv.contato_id and k.empresa_id = cv.empresa_id
      where cv.id = $1 and cv.empresa_id = empresa_ativa()`,
    [conversaId],
  );
  const cv = r.rows[0];
  if (!cv) return;
  const link = `/conversas/${conversaId}`;
  if (conversaNova && !cv.dono_id && !cv.com_agente) {
    const equipe = await c.query<{ pessoa_id: string }>(
      `select pessoa_id from vinculos where empresa_id = empresa_ativa() and situacao = 'ativo'
          and (case when $1::text is null then perfil in ('administrador', 'gestor_area') else area = $1 end)`,
      [cv.area],
    );
    for (const p of equipe.rows)
      await criarAviso(c, {
        pessoaId: p.pessoa_id,
        tipo: "conversa_nova",
        texto: `Conversa nova de "${cv.contato}" no canal "${cv.canal}", esperando a equipe.`,
        link,
      });
    return;
  }
  if (!cv.dono_id) return;
  const pode = await c.query(
    `update conversas_com_contatos set avisado_em = now()
      where id = $1 and empresa_id = empresa_ativa()
        and (avisado_em is null or avisado_em < now() - make_interval(mins => $2)) returning id`,
    [conversaId, MINUTOS_ENTRE_AVISOS_DA_CONVERSA],
  );
  if ((pode.rowCount ?? 0) > 0)
    await criarAviso(c, {
      pessoaId: cv.dono_id,
      tipo: "mensagem_na_conversa",
      texto: `"${cv.contato}" mandou mensagem nova na conversa do canal "${cv.canal}".`,
      link,
    });
}

/**
 * A mensagem que o próprio número mandou (M8-03, decisão 0053 item 4): entra como "saiu", "pelo celular". Se a caixa
 * acabou de mandar o mesmo texto e a Evolution ainda não devolveu o número, junta-se a ela em vez de repetir.
 */
async function gravarDoCelular(
  c: pg.PoolClient,
  conversaId: string,
  m: MensagemQueChegou,
  enviadaEm: string,
): Promise<string | null> {
  const texto = m.texto?.trim() || null;
  if (m.idNoProvedor && texto) {
    const junta = await c.query<{ id: string }>(
      `update mensagens_com_contatos set id_no_provedor = $3, entrega = case when entrega = 'pendente' then 'enviada' else entrega end
        where id = (select id from mensagens_com_contatos
                     where empresa_id = empresa_ativa() and conversa_id = $1 and direcao = 'saiu'
                       and id_no_provedor is null and texto = $2 and not pelo_celular
                       and recebida_em > now() - interval '2 minutes'
                     order by recebida_em limit 1)
        returning id`,
      [conversaId, texto, m.idNoProvedor],
    );
    if (junta.rows[0]) return null;
  }
  const gravada = await c.query<{ id: string }>(
    `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, tipo, texto,
                                         id_no_provedor, enviada_em, pelo_celular, entrega, enviada_ao_provedor_em)
     values (empresa_ativa(), $1, $2, 'saiu', 'pessoa', $3, $4, $5, $6, true, 'enviada', $6)
     on conflict (canal_id, id_no_provedor) where id_no_provedor is not null do nothing
     returning id`,
    [conversaId, m.canalId, m.tipo, texto, m.idNoProvedor ?? null, enviadaEm],
  );
  const mensagemId = gravada.rows[0]?.id ?? null;
  if (mensagemId)
    await c.query(
      `update conversas_com_contatos set
          ultimo_a_responder = case when ultima_mensagem_em is null or ultima_mensagem_em <= $2
                                    then 'pessoa' else ultimo_a_responder end,
          ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, $2), $2),
          situacao = case when situacao = 'resolvida' then situacao else 'esperando_cliente' end
        where id = $1 and empresa_id = empresa_ativa()`,
      [conversaId, enviadaEm],
    );
  return mensagemId;
}

/**
 * O contato "não identificado" (decisão 0051, item 2): pessoa, com o nome do perfil do WhatsApp (ou o telefone, ou
 * "Visitante do site"), o telefone como principal e com WhatsApp, sem responsável. Quem "cadastrou" é quem conectou
 * o canal (o contato precisa de alguém, e o canal é dele).
 */
async function criarContatoNaoIdentificado(
  c: pg.PoolClient,
  canalId: string,
  canal: { provedor: ProvedorDeCanal; criado_por: string },
  identificador: string,
  nomeDoPerfil: string | null | undefined,
): Promise<string> {
  const perfil = nomeDoPerfil?.replace(/\s+/g, " ").trim().slice(0, 200);
  const nome = perfil || (canal.provedor === "site" ? "Visitante do site" : identificador);
  const r = await c.query<{ id: string }>(
    `insert into contatos (empresa_id, tipo, nome, responsavel_id, criado_por, identificado, origem_canal_id)
     values (empresa_ativa(), 'pessoa', $1, null, $2, false, $3) returning id`,
    [nome, canal.criado_por, canalId],
  );
  const id = r.rows[0]?.id as string;
  if (identificador.startsWith("+"))
    await c.query(
      `insert into identificadores_de_contato (empresa_id, contato_id, tipo, valor, principal, whatsapp)
       values (empresa_ativa(), $1, 'telefone', $2, true, true)`,
      [id, identificador],
    );
  return id;
}

/** Resolve a conversa (a caixa é a M8-04). */
export async function resolverConversa(
  c: pg.PoolClient,
  conversaId: string,
  pessoaId: string | null,
): Promise<void> {
  await c.query(
    `update conversas_com_contatos set situacao = 'resolvida', resolvida_em = now(), resolvida_por = $2, com_agente = false
      where id = $1 and empresa_id = empresa_ativa() and situacao <> 'resolvida'`,
    [conversaId, pessoaId],
  );
}

/**
 * Liga a conversa a outro contato (o telefone está em mais de um contato). Vale para as próximas mensagens dela. O
 * contato precisa estar ativo e não ter outra conversa aberta no mesmo canal.
 */
export async function trocarContatoDaConversa(
  c: pg.PoolClient,
  conversa: ConversaComContato,
  contatoId: string,
): Promise<void> {
  if (conversa.contatoId === contatoId) return;
  if (conversa.situacao !== "resolvida") {
    const outra = await c.query(
      `select 1 from conversas_com_contatos where empresa_id = empresa_ativa() and canal_id = $1
          and contato_id = $2 and situacao <> 'resolvida'`,
      [conversa.canal.id, contatoId],
    );
    if ((outra.rowCount ?? 0) > 0)
      throw new RecusaDasConversas("Esse contato já tem uma conversa aberta neste canal.");
  }
  await c.query(
    `update conversas_com_contatos set contato_id = $2, mais_de_um_contato = false
      where id = $1 and empresa_id = empresa_ativa()`,
    [conversa.id, contatoId],
  );
}
