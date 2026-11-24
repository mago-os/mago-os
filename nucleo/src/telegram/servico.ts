/**
 * O que o bot faz com cada mensagem (M5-01, decisão 0032): vincular pelo código, reconhecer a pessoa, /empresa,
 * /sair e /ajuda. A conversa com o coordenador entra na M5-02.
 *
 * Toda mensagem passa primeiro pelas travas (só conversa individual, mensagens por minuto, códigos errados). Quem
 * não tem vínculo recebe sempre a mesma resposta fixa, que não diz se a conta ou o código existem.
 */
import { createHash, randomInt } from "node:crypto";
import {
  type AtualizacaoDoTelegram,
  type BotaoTocadoNoTelegram,
  CODIGOS_ERRADOS_DO_TELEGRAM,
  COMANDOS_DO_TELEGRAM,
  DADOS_DOS_BOTOES,
  extensaoBloqueada,
  HORAS_PARA_ANEXAR_O_ARQUIVO_DO_TELEGRAM,
  LETRAS_DO_CODIGO_DO_TELEGRAM,
  MENSAGENS_POR_MINUTO_DO_TELEGRAM,
  type MensagemDoTelegram,
  MINUTOS_DA_TRAVA_DO_TELEGRAM,
  RESPOSTAS_DO_TELEGRAM,
  TAMANHO_DO_CODIGO_DO_TELEGRAM,
  TAMANHO_MAXIMO_DO_ARQUIVO_DO_TELEGRAM,
  textoDoArquivoParaOAgente,
} from "@mago-os/contratos";
import type pg from "pg";
import { eventoPorId, responderConvite } from "../agenda/servico.ts";
import { auditar, type DadosDoEvento } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { permissoesNaEmpresa } from "../permissoes/verificar.ts";
import { receberCodigoOuMotivo, tocarBotaoDeAprovacao } from "./aprovacoes.ts";
import type { CarteiroDoTelegram } from "./carteiro.ts";
import { conversarPeloTelegram, type OpcoesDaConversaPeloTelegram } from "./conversa.ts";

export interface Registro {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface OpcoesDoTelegram {
  poolApp: pg.Pool;
  carteiro: CarteiroDoTelegram;
  log: Registro;
  /** A conversa com o coordenador (M5-02). Sem ela, o texto solto recebe a ajuda. */
  conversa?: OpcoesDaConversaPeloTelegram;
}

/** A origem dos eventos de auditoria que nascem no Telegram. */
export const ORIGEM_TELEGRAM: DadosDoEvento["origem"] = { canal: "telegram", ip: null, aparelho: "Telegram" };

/** Um código novo, com as letras do contrato (sem as que confundem). */
export function gerarCodigoDoTelegram(): string {
  let codigo = "";
  for (let i = 0; i < TAMANHO_DO_CODIGO_DO_TELEGRAM; i++)
    codigo += LETRAS_DO_CODIGO_DO_TELEGRAM[randomInt(LETRAS_DO_CODIGO_DO_TELEGRAM.length)];
  return codigo;
}

export function resumoDoCodigo(codigo: string): string {
  return createHash("sha256").update(codigo).digest("hex");
}

/**
 * O código que a pessoa mandou, se a mensagem parece um: "/start CODIGO" (o link do app) ou o código digitado,
 * com ou sem espaços e hífen, em maiúsculas ou minúsculas. Nulo se não parece código.
 */
export function codigoDaMensagem(texto: string): { codigo: string; peloLink: boolean } | null {
  const t = texto.trim();
  const comStart = /^\/start(?:@\w+)?\s+(\S+)$/i.exec(t);
  const bruto = (comStart ? comStart[1] : t)?.replace(/[\s-]/g, "").toUpperCase() ?? "";
  return FORMATO_DO_CODIGO.test(bruto) ? { codigo: bruto, peloLink: comStart !== null } : null;
}

/** Só as letras do contrato: texto com 0, O, 1, I ou L nunca é código (e não conta como erro). */
const FORMATO_DO_CODIGO = new RegExp(`^[${LETRAS_DO_CODIGO_DO_TELEGRAM}]{${TAMANHO_DO_CODIGO_DO_TELEGRAM}}$`);

/** Os comandos que já funcionam (o menu do bot e a ajuda mostram só estes). Desde a M5-02, todos. */
export const COMANDOS_LIGADOS = COMANDOS_DO_TELEGRAM;

/** O comando da mensagem (sem a barra e sem o @bot), e o resto. */
export function comandoDaMensagem(texto: string): { comando: string; resto: string } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(texto.trim());
  return m ? { comando: (m[1] as string).toLowerCase(), resto: (m[2] ?? "").trim() } : null;
}

export interface PessoaDoTelegram {
  pessoaId: string;
  empresaId: string;
  chatId: number;
  pessoaNome: string;
  empresaNome: string;
}

/** Quem é a conta do Telegram (só vínculos ativos), ou nulo. */
export async function reconhecerTelegram(pool: pg.Pool, conta: number): Promise<PessoaDoTelegram | null> {
  const r = await pool.query<{
    pessoa_id: string;
    empresa_id: string;
    chat_id: string;
    pessoa_nome: string;
    empresa_nome: string;
  }>("select * from reconhecer_telegram($1)", [conta]);
  const l = r.rows[0];
  return l
    ? {
        pessoaId: l.pessoa_id,
        empresaId: l.empresa_id,
        chatId: Number(l.chat_id),
        pessoaNome: l.pessoa_nome,
        empresaNome: l.empresa_nome,
      }
    : null;
}

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

/** O texto de /ajuda e de /start sem código. */
export function textoDaAjuda(p: PessoaDoTelegram): string {
  return [
    `Oi, ${primeiroNome(p.pessoaNome)}. Você está na ${p.empresaNome}.`,
    "",
    "Comandos:",
    ...COMANDOS_LIGADOS.map((c) => `/${c.comando}: ${c.descricao}`),
    "",
    "O Mago OS nunca pede senha nem código por aqui fora de uma aprovação que você mesmo abriu.",
  ].join("\n");
}

/**
 * Trata uma atualização do webhook. Nunca lança por causa do conteúdo nem do envio: a fila não repete o trabalho
 * (vincular e as travas não podem rodar duas vezes), e o pior caso é a resposta não chegar.
 */
export async function tratarAtualizacao(opcoes: OpcoesDoTelegram, a: AtualizacaoDoTelegram): Promise<void> {
  const carteiro = opcoes.carteiro;
  const o: OpcoesDoTelegram = {
    ...opcoes,
    carteiro: {
      ...carteiro,
      enviar: (chatId, texto, op) =>
        carteiro.enviar(chatId, texto, op).catch((erro) => {
          opcoes.log.warn({ erro }, "Telegram: a resposta não foi enviada");
          return 0;
        }),
    },
  };
  if (a.callback_query) return tocarBotao(o, a.callback_query);
  const m = a.message;
  if (!m?.from || m.from.is_bot) return;
  if (m.chat.type !== "private") {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.soConversaIndividual);
    await o.carteiro.sairDoChat(m.chat.id).catch(() => {});
    return;
  }
  const conta = m.from.id;
  const n = await o.poolApp.query<{ n: number }>("select contar_mensagem_do_telegram($1) as n", [conta]);
  if ((n.rows[0]?.n ?? 0) > MENSAGENS_POR_MINUTO_DO_TELEGRAM) return;

  const texto = m.text ?? "";
  const pessoa = await reconhecerTelegram(o.poolApp, conta);
  // Quem já está vinculado só vincula de novo pelo link (/start CODIGO): texto solto de 8 letras é conversa.
  const codigo = codigoDaMensagem(texto);
  if (codigo && (codigo.peloLink || !pessoa)) return vincular(o, m, codigo.codigo);
  if (!pessoa) {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.semVinculo);
    return;
  }
  // Com um toque em Aprovar ou Recusar aberto (M5-04), a mensagem é o código ou o motivo.
  if (await receberCodigoOuMotivo(o, pessoa, m)) return;
  // Foto, documento, áudio, vídeo (M5-03): o arquivo espera uma tarefa, e o coordenador decide onde anexar.
  if (m.sticker || m.animation) {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.figurinha);
    return;
  }
  const arquivo = arquivoDaMensagem(m);
  if (arquivo) return receberArquivo(o, pessoa, m, arquivo);
  if (!texto.trim()) {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.soTexto);
    return;
  }
  const cmd = comandoDaMensagem(texto);
  if (cmd?.comando === "sair") return sair(o, pessoa, m.chat.id);
  if (cmd?.comando === "empresa") return trocarEmpresa(o, pessoa, m.chat.id, cmd.resto);
  if (cmd?.comando === "start" || cmd?.comando === "ajuda" || (!cmd && !o.conversa)) {
    await o.carteiro.enviar(m.chat.id, textoDaAjuda(pessoa));
    return;
  }
  if (!cmd || cmd.comando === "nova" || cmd.comando === "tarefas")
    return conversarPeloTelegram(o, pessoa, m.chat.id, texto, cmd);
  await o.carteiro.enviar(m.chat.id, `Esse comando não existe por aqui. ${textoDaAjuda(pessoa)}`);
}

export interface ArquivoDaMensagem {
  idNoTelegram: string;
  nome: string;
  tipo: string;
  tamanho: number | null;
}

const FORMATO_DO_TIPO = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;

/** Tipos (MIME) que rodam programa: valem como a lista de extensões, para o documento que chega sem nome. */
const TIPOS_QUE_RODAM_PROGRAMA =
  /(msdownload|msdos-program|x-executable|x-sh\b|x-bat|x-msi|ms-installer|portable-executable|java-archive|android\.package-archive|apple-diskimage|x-ms-shortcut)/;

/** O arquivo é de um tipo que roda programa, pelo nome ou pelo tipo. */
export function arquivoQueRodaPrograma(a: Pick<ArquivoDaMensagem, "nome" | "tipo">): boolean {
  return extensaoBloqueada(a.nome) || TIPOS_QUE_RODAM_PROGRAMA.test(a.tipo);
}

/** O arquivo da mensagem (a maior versão da foto), com nome e tipo, ou nulo se a mensagem não tem arquivo. */
export function arquivoDaMensagem(m: MensagemDoTelegram, agora = new Date()): ArquivoDaMensagem | null {
  const quando = agora.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const opcoes = [
    { a: m.photo?.at(-1), nome: `foto-${quando}.jpg`, tipo: "image/jpeg" },
    { a: m.document, nome: `arquivo-${quando}`, tipo: "application/octet-stream" },
    { a: m.audio, nome: `audio-${quando}.mp3`, tipo: "audio/mpeg" },
    { a: m.voice, nome: `audio-${quando}.ogg`, tipo: "audio/ogg" },
    { a: m.video, nome: `video-${quando}.mp4`, tipo: "video/mp4" },
    { a: m.video_note, nome: `video-${quando}.mp4`, tipo: "video/mp4" },
  ];
  const achado = opcoes.find((x) => x.a);
  if (!achado?.a) return null;
  const nomeDoAparelho = achado.a.file_name
    ?.replace(/[\r\n/\\]/g, "_")
    .trim()
    .slice(0, 200);
  const tipoDoAparelho = achado.a.mime_type?.toLowerCase();
  return {
    idNoTelegram: achado.a.file_id,
    nome: nomeDoAparelho || achado.nome,
    tipo:
      tipoDoAparelho && FORMATO_DO_TIPO.test(tipoDoAparelho) && tipoDoAparelho.length <= 120
        ? tipoDoAparelho
        : achado.tipo,
    tamanho: achado.a.file_size ?? null,
  };
}

/** Registra o arquivo (esperando por 24 horas) e passa ao coordenador a legenda com os dados dele. */
async function receberArquivo(
  o: OpcoesDoTelegram,
  p: PessoaDoTelegram,
  m: MensagemDoTelegram,
  a: ArquivoDaMensagem,
): Promise<void> {
  if ((a.tamanho ?? 0) > TAMANHO_MAXIMO_DO_ARQUIVO_DO_TELEGRAM) {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.arquivoGrande);
    return;
  }
  if (arquivoQueRodaPrograma(a)) {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.tipoBloqueado);
    return;
  }
  // O arquivo só fica guardado para quem conversa com os agentes (senão, a conversa recusaria logo depois).
  const permissoes = o.conversa
    ? await permissoesNaEmpresa(o.poolApp, p.pessoaId, p.empresaId, o.conversa.catalogo)
    : null;
  if (!permissoes || (permissoes.modulos.get("agentes")?.acoes.ver ?? "nada") === "nada") {
    await o.carteiro.enviar(
      m.chat.id,
      o.conversa
        ? RESPOSTAS_DO_TELEGRAM.semAcessoAosAgentes
        : "A conversa pelo Telegram ainda não está ligada neste ambiente.",
    );
    return;
  }
  const id = await comPessoa(o.poolApp, p.pessoaId, p.empresaId, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into arquivos_do_telegram (empresa_id, pessoa_id, nome, tipo, tamanho, id_no_telegram, vence_em)
       values (empresa_ativa(), pessoa_ativa(), $1, $2, $3, $4, now() + make_interval(hours => $5)) returning id`,
      [a.nome, a.tipo, a.tamanho, a.idNoTelegram, HORAS_PARA_ANEXAR_O_ARQUIVO_DO_TELEGRAM],
    );
    return r.rows[0]?.id as string;
  });
  const legenda = m.caption?.trim() ?? "";
  const dados = textoDoArquivoParaOAgente({ id, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho });
  await conversarPeloTelegram(o, p, m.chat.id, legenda ? `${legenda}\n\n${dados}` : dados, null, a);
}

/** O toque num botão (M5-04): aprovar, recusar ou trocar de empresa. Só de conta vinculada, em conversa individual. */
async function tocarBotao(o: OpcoesDoTelegram, b: BotaoTocadoNoTelegram): Promise<void> {
  if (b.from.is_bot) return;
  if (b.message && b.message.chat.type !== "private") {
    await o.carteiro.responderBotao(b.id).catch(() => {});
    return;
  }
  const n = await o.poolApp.query<{ n: number }>("select contar_mensagem_do_telegram($1) as n", [b.from.id]);
  if ((n.rows[0]?.n ?? 0) > MENSAGENS_POR_MINUTO_DO_TELEGRAM) return;
  const pessoa = await reconhecerTelegram(o.poolApp, b.from.id);
  if (!pessoa) {
    await o.carteiro.responderBotao(b.id, RESPOSTAS_DO_TELEGRAM.semVinculo).catch(() => {});
    return;
  }
  const empresa = DADOS_DOS_BOTOES.empresa.exec(b.data ?? "");
  if (empresa) {
    await o.carteiro.responderBotao(b.id).catch(() => {});
    return trocarEmpresa(o, pessoa, pessoa.chatId, empresa[1] as string);
  }
  if (await tocarBotaoDeAprovacao(o, pessoa, b)) return;
  const convite = DADOS_DOS_BOTOES.convite.exec(b.data ?? "");
  if (convite) {
    const resposta = convite[1] === "vou" ? "vou" : convite[1] === "nao" ? "nao_vou" : "talvez";
    const ok = await comPessoa(o.poolApp, pessoa.pessoaId, pessoa.empresaId, async (c) => {
      const e = await eventoPorId(c, convite[2] as string);
      if (!e || e.situacao === "cancelado") return false;
      return responderConvite(c, e, pessoa.pessoaId, resposta);
    }).catch(() => false);
    if (ok)
      await auditar(o.poolApp, {
        empresaId: pessoa.empresaId,
        ator: { tipo: "pessoa", pessoaId: pessoa.pessoaId },
        acao: "evento.respondeu",
        alvo: { tipo: "evento", id: convite[2] as string },
        origem: { canal: "telegram", ip: null, aparelho: null },
        detalhes: { resposta },
      });
    await o.carteiro
      .responderBotao(
        b.id,
        ok
          ? `Resposta registrada: ${resposta === "vou" ? "Vou" : resposta === "nao_vou" ? "Não vou" : "Talvez"}.`
          : "Esse convite não está mais valendo (o evento mudou ou foi cancelado).",
      )
      .catch(() => {});
    return;
  }
  await o.carteiro.responderBotao(b.id).catch(() => {});
}

async function vincular(o: OpcoesDoTelegram, m: MensagemDoTelegram, codigo: string): Promise<void> {
  const de = m.from as NonNullable<MensagemDoTelegram["from"]>;
  const errados = async (errou: boolean) =>
    (
      await o.poolApp.query<{ n: number }>("select codigos_errados_do_telegram($1, $2, $3) as n", [
        de.id,
        errou,
        MINUTOS_DA_TRAVA_DO_TELEGRAM,
      ])
    ).rows[0]?.n ?? 0;
  if ((await errados(false)) >= CODIGOS_ERRADOS_DO_TELEGRAM) {
    await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.travado);
    return;
  }
  const nome = [de.first_name, de.last_name].filter(Boolean).join(" ").slice(0, 200) || "Sem nome";
  const r = await o.poolApp.query<{
    pessoa_id: string;
    empresa_id: string;
    pessoa_nome: string;
    empresa_nome: string;
    tirada_de: string | null;
    tirada_de_empresa: string | null;
    trocou_conta: boolean;
  }>("select * from vincular_telegram($1, $2, $3, $4, $5)", [
    resumoDoCodigo(codigo),
    de.id,
    m.chat.id,
    de.username?.slice(0, 64) ?? null,
    nome,
  ]);
  const v = r.rows[0];
  if (!v) {
    const agora = await errados(true);
    if (agora >= CODIGOS_ERRADOS_DO_TELEGRAM) {
      // Só a trava vai para a auditoria (sem o código nem o número do Telegram): erro solto é ruído.
      await auditar(
        o.poolApp,
        {
          empresaId: null,
          ator: { tipo: "sistema", servico: "telegram" },
          acao: "telegram.codigo_errado",
          origem: ORIGEM_TELEGRAM,
          detalhes: { travouPorMinutos: MINUTOS_DA_TRAVA_DO_TELEGRAM },
        },
        o.log,
      );
      await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.travado);
    } else await o.carteiro.enviar(m.chat.id, RESPOSTAS_DO_TELEGRAM.codigoInvalido);
    return;
  }
  await auditar(
    o.poolApp,
    {
      empresaId: v.empresa_id,
      ator: { tipo: "pessoa", pessoaId: v.pessoa_id },
      acao: "telegram.vinculou",
      alvo: { tipo: "pessoa", id: v.pessoa_id },
      origem: ORIGEM_TELEGRAM,
      detalhes: { trocouConta: v.trocou_conta },
    },
    o.log,
  );
  if (v.tirada_de && v.tirada_de_empresa) {
    // A conta do Telegram era de outra pessoa: ela perde o vínculo e fica sabendo no app.
    const tirada = v.tirada_de;
    const empresa = v.tirada_de_empresa;
    await comEmpresa(o.poolApp, empresa, (c) =>
      criarAviso(c, {
        pessoaId: tirada,
        tipo: "telegram_desvinculado",
        texto:
          "A conta do Telegram ligada a você foi vinculada a outra pessoa. Vincule de novo em Meu perfil se for sua.",
        link: "/perfil",
      }),
    ).catch((erro) => o.log.warn({ erro }, "Aviso de Telegram desvinculado não foi criado"));
    await auditar(
      o.poolApp,
      {
        empresaId: empresa,
        ator: { tipo: "sistema", servico: "telegram" },
        acao: "telegram.desvinculou",
        alvo: { tipo: "pessoa", id: tirada },
        origem: ORIGEM_TELEGRAM,
        detalhes: { motivo: "outra_pessoa" },
      },
      o.log,
    );
  }
  await o.carteiro.enviar(
    m.chat.id,
    `Pronto, ${primeiroNome(v.pessoa_nome)}. Você está na ${v.empresa_nome}.\n\nMande /ajuda para ver o que dá para fazer por aqui.`,
  );
}

async function sair(o: OpcoesDoTelegram, p: PessoaDoTelegram, chatId: number): Promise<void> {
  await comPessoa(o.poolApp, p.pessoaId, p.empresaId, (c) =>
    c.query("delete from vinculos_do_telegram where pessoa_id = pessoa_ativa()"),
  );
  await auditar(
    o.poolApp,
    {
      empresaId: p.empresaId,
      ator: { tipo: "pessoa", pessoaId: p.pessoaId },
      acao: "telegram.desvinculou",
      alvo: { tipo: "pessoa", id: p.pessoaId },
      origem: ORIGEM_TELEGRAM,
      detalhes: { motivo: "sair" },
    },
    o.log,
  );
  await o.carteiro.enviar(chatId, RESPOSTAS_DO_TELEGRAM.desvinculado);
}

/** /empresa lista as empresas da pessoa; /empresa N troca para a de número N. */
async function trocarEmpresa(
  o: OpcoesDoTelegram,
  p: PessoaDoTelegram,
  chatId: number,
  resto: string,
): Promise<void> {
  const empresas = await comPessoa(o.poolApp, p.pessoaId, null, async (c) => {
    const r = await c.query<{ id: string; nome: string }>(
      `select e.id, e.nome from empresas e
         join vinculos v on v.empresa_id = e.id and v.pessoa_id = pessoa_ativa() and v.situacao = 'ativo'
        where e.situacao = 'ativa' order by e.nome, e.id`,
    );
    return r.rows;
  });
  if (empresas.length <= 1) {
    await o.carteiro.enviar(chatId, `Você só está na ${p.empresaNome}.`);
    return;
  }
  // Pelo número da lista (/empresa 2) ou pelo id (o botão).
  const escolha = /^\d{1,3}$/.test(resto)
    ? empresas[Number(resto) - 1]
    : empresas.find((e) => e.id === resto);
  if (!escolha) {
    const lista = empresas.map((e, i) => `${i + 1}. ${e.nome}${e.id === p.empresaId ? " (agora)" : ""}`);
    await o.carteiro.enviar(
      chatId,
      ["Em qual empresa você quer conversar? Toque nela (ou mande /empresa e o número).", "", ...lista].join(
        "\n",
      ),
      { botoes: empresas.map((e) => [{ texto: e.nome.slice(0, 60), dados: `em:${e.id}` }]) },
    );
    return;
  }
  if (escolha.id === p.empresaId) {
    await o.carteiro.enviar(chatId, `Você já está na ${escolha.nome}.`);
    return;
  }
  await comPessoa(o.poolApp, p.pessoaId, null, (c) =>
    // A conversa atual era da outra empresa: a próxima mensagem começa uma nova.
    c.query(
      "update vinculos_do_telegram set empresa_id = $1, conversa_id = null where pessoa_id = pessoa_ativa()",
      [escolha.id],
    ),
  );
  await auditar(
    o.poolApp,
    {
      empresaId: escolha.id,
      ator: { tipo: "pessoa", pessoaId: p.pessoaId },
      acao: "telegram.trocou_empresa",
      alvo: { tipo: "pessoa", id: p.pessoaId },
      origem: ORIGEM_TELEGRAM,
      detalhes: { de: p.empresaId },
    },
    o.log,
  );
  await o.carteiro.enviar(chatId, `Pronto. Agora você está na ${escolha.nome}.`);
}
