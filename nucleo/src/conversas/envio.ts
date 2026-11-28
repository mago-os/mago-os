/**
 * Mensagens pela Evolution (M8-03, decisão 0053): a mensagem nova que chega (com o arquivo passado pelo antivírus), a
 * entrega das que saem, mandar texto, foto e documento pela fila com o ritmo do número, "tentar de novo", o link do
 * arquivo e o prazo de 180 dias dos arquivos.
 */
import {
  type ConversaComContato,
  conferir,
  PedidoDeEnviarSugestao,
  PedidoDeMensagemNaConversa,
  type Problema,
  SEGUNDOS_ENTRE_MENSAGENS_AO_CONTATO,
  type SituacaoDeEntrega,
  TAMANHO_MAXIMO_DO_ARQUIVO_DA_CONVERSA,
} from "@mago-os/contratos";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { origemDoPedido } from "../acesso/rotas.ts";
import type { ServicosDosAnexos } from "../anexos/servico.ts";
import { auditar } from "../auditoria/registrar.ts";
import { criarAviso } from "../avisos/index.ts";
import { comEmpresa, comPessoa } from "../empresa.ts";
import { acessoDo, type Verificador } from "../permissoes/verificar.ts";
import { contarSugestaoSemEdicao, type OpcoesDoAtendimento, pedirAoAtendente } from "./atendimento.ts";
import { usarCodigoDoSite } from "./balao.ts";
import { type ClienteDaEvolution, ErroDaEvolution, nomeDaInstancia } from "./evolution.ts";
import {
  destinoDoIdentificador,
  lerEntregaDaEvolution,
  lerMensagemDaEvolution,
  nomeLimpo,
} from "./leitura.ts";
import { buscarConversa, quemOlhaConversas, RecusaDasConversas, receberMensagem } from "./servico.ts";

type Log = {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
};

export interface OpcoesDasMensagens {
  poolApp: pg.Pool;
  evolution: ClienteDaEvolution;
  /** O depósito e o antivírus dos anexos; nulo: os arquivos não são baixados (ficam "não baixados"). */
  arquivos: ServicosDosAnexos | null;
  log: Log;
  /** O agente do canal (M8-05): a mensagem do cliente pode virar trabalho para ele. */
  atendimento?: OpcoesDoAtendimento;
}

/** Até quantas vezes a fila tenta mandar uma mensagem antes de marcar "falhou". */
export const TENTATIVAS_DE_ENVIO = 3;

const caminhoDoArquivo = (empresaId: string, arquivoId: string) => `conversas/${empresaId}/${arquivoId}`;

// Chegou -----------------------------------------------------------------------------------------------------------

/**
 * Grava o arquivo de uma mensagem: passa pelo antivírus e, limpo, vai para o depósito. Bloqueado, grande demais ou
 * sem o depósito fica só o registro (a mensagem mostra o porquê).
 */
async function gravarArquivo(
  o: Pick<OpcoesDasMensagens, "poolApp" | "arquivos">,
  empresaId: string,
  mensagemId: string,
  a: { nome: string; mime: string | null; dados: Buffer | null },
) {
  // O id é sorteado antes, para o caminho no depósito ser o do registro.
  const idDoArquivo = crypto.randomUUID();
  const mime =
    a.mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(a.mime.split(";")[0] ?? "")
      ? (a.mime.split(";")[0] as string)
      : "application/octet-stream";
  const nome = nomeLimpo(a.nome, "arquivo");
  const registrar = (situacao: string, extra: { tamanho?: number; caminho?: string; achado?: string } = {}) =>
    comEmpresa(o.poolApp, empresaId, (c) =>
      c.query<{ id: string }>(
        `insert into arquivos_de_conversa (id, empresa_id, mensagem_id, nome, tipo, tamanho, situacao, caminho, achado_do_antivirus)
         values (coalesce($7::uuid, uuidv7()), empresa_ativa(), $1, $2, $3, $4, $5, $6, $8)
         on conflict (mensagem_id) do nothing returning id`,
        [
          mensagemId,
          nome,
          mime,
          extra.tamanho ?? null,
          situacao,
          extra.caminho ?? null,
          idDoArquivo,
          extra.achado ?? null,
        ],
      ),
    );
  if (!a.dados || !o.arquivos) return registrar("nao_baixado");
  if (a.dados.length > TAMANHO_MAXIMO_DO_ARQUIVO_DA_CONVERSA)
    return registrar("grande_demais", { tamanho: a.dados.length });
  const resultado = await o.arquivos.antivirus.conferir(a.dados);
  if (!resultado.limpo)
    return registrar("bloqueado", { tamanho: a.dados.length, achado: resultado.achado.slice(0, 200) });
  const caminho = caminhoDoArquivo(empresaId, idDoArquivo);
  await o.arquivos.deposito.gravar(caminho, a.dados, mime);
  try {
    return await registrar("disponivel", { tamanho: a.dados.length, caminho });
  } catch (erro) {
    await o.arquivos.deposito.apagar(caminho).catch(() => {});
    throw erro;
  }
}

/** Mensagem nova da Evolution (do contato ou do próprio número). Grupos, status e controle são ignorados. */
export async function tratarMensagemNova(
  o: OpcoesDasMensagens,
  quem: { empresaId: string; canalId: string },
  instancia: string,
  data: unknown,
): Promise<void> {
  const lida = lerMensagemDaEvolution(data);
  if (lida.ignorar) return;
  const r = await comEmpresa(o.poolApp, quem.empresaId, async (c) => {
    const canal = await c.query(
      "select 1 from canais_de_contato where id = $1 and empresa_id = empresa_ativa() and provedor = 'evolution'",
      [quem.canalId],
    );
    if ((canal.rowCount ?? 0) === 0) return null;
    const recebida = await receberMensagem(c, { ...lida.mensagem, canalId: quem.canalId });
    // "Continuar no WhatsApp" (M8-07): o código do balão liga o visitante do site a este contato.
    if (recebida.mensagemId && !lida.mensagem.doCelular)
      await usarCodigoDoSite(c, quem.canalId, recebida.contatoId, lida.mensagem.texto);
    return recebida;
  });
  if (!r?.mensagemId) return;
  // O agente do canal atende (M8-05). O arquivo, se houver, é gravado antes, para ele ver a mensagem inteira.
  const atender = async () => {
    if (o.atendimento && !lida.mensagem.doCelular)
      await pedirAoAtendente(o.atendimento, quem.empresaId, r.conversaId).catch((erro: unknown) =>
        o.log.error({ erro: (erro as Error).message }, "Atendimento: não pediu ao agente"),
      );
  };
  if (!lida.arquivo) return atender();
  let dados: Buffer | null = null;
  if (o.arquivos && lida.mensagem.idNoProvedor) {
    const baixado = await o.evolution
      .baixarArquivo(instancia, lida.mensagem.idNoProvedor)
      .catch((erro: unknown) => {
        o.log.warn({ erro: (erro as Error).message }, "Arquivo da mensagem não baixou da Evolution");
        return null;
      });
    if (baixado) {
      dados = Buffer.from(baixado.base64, "base64");
      lida.arquivo.mime = lida.arquivo.mime ?? baixado.mime;
    }
  }
  await gravarArquivo(o, quem.empresaId, r.mensagemId, { ...lida.arquivo, dados });
  await atender();
}

const ORDEM_DA_ENTREGA: Record<SituacaoDeEntrega, number> = {
  pendente: 0,
  enviada: 1,
  entregue: 2,
  lida: 3,
  falhou: 4,
};

/** Aviso de entrega: a situação só avança (lida não volta a entregue); falhou vale a qualquer momento. */
export async function tratarEntrega(
  o: OpcoesDasMensagens,
  quem: { empresaId: string; canalId: string },
  data: unknown,
) {
  const e = lerEntregaDaEvolution(data);
  if (!e) return;
  await comEmpresa(o.poolApp, quem.empresaId, async (c) => {
    const m = await c.query<{ id: string; entrega: SituacaoDeEntrega | null }>(
      `select id, entrega from mensagens_com_contatos where empresa_id = empresa_ativa() and canal_id = $1
          and id_no_provedor = $2 and direcao = 'saiu' for update`,
      [quem.canalId, e.id],
    );
    const atual = m.rows[0];
    if (!atual?.entrega) return;
    const avanca =
      e.entrega === "falhou"
        ? atual.entrega !== "lida"
        : ORDEM_DA_ENTREGA[e.entrega] > ORDEM_DA_ENTREGA[atual.entrega];
    if (!avanca || atual.entrega === "falhou") return;
    await c.query(
      `update mensagens_com_contatos set entrega = $2,
              motivo_da_falha = case when $2 = 'falhou' then 'O WhatsApp não entregou a mensagem.' else null end
        where id = $1 and empresa_id = empresa_ativa()`,
      [atual.id, e.entrega],
    );
  });
}

// Sai --------------------------------------------------------------------------------------------------------------

/** O tipo de arquivo que vai como foto (o resto vai como documento). */
const ehFoto = (tipo: string) => /^image\/(png|jpeg|webp)$/.test(tipo);

/**
 * Cria a mensagem que sai ("pendente"), com o arquivo já passado pelo antivírus. Quem manda pela fila é
 * enviarPendente. A conversa precisa estar aberta e o canal ser de WhatsApp.
 */
export async function criarMensagemQueSai(
  o: Pick<OpcoesDasMensagens, "poolApp" | "arquivos">,
  c: pg.PoolClient,
  empresaId: string,
  conversa: ConversaComContato,
  autor: { pessoaId: string } | { agenteId: string },
  pedido: { texto?: string; arquivo?: { nome: string; tipo: string; base64: string } },
): Promise<string> {
  // O balão do site (M8-07) recebe só texto: o visitante busca a mensagem pelo próprio balão.
  if (conversa.canal.provedor === "site" && pedido.arquivo)
    throw new RecusaDasConversas("Pelo balão do site, por enquanto, só texto.");
  if (conversa.situacao === "resolvida") throw new RecusaDasConversas("Reabra a conversa para responder.");
  let dados: Buffer | null = null;
  if (pedido.arquivo) {
    if (!o.arquivos) throw new RecusaDasConversas("Os arquivos ainda não estão ligados neste ambiente.");
    dados = Buffer.from(pedido.arquivo.base64, "base64");
    if (dados.length === 0 || dados.length > TAMANHO_MAXIMO_DO_ARQUIVO_DA_CONVERSA)
      throw new RecusaDasConversas("O arquivo precisa ter até 25 MB.");
    const r = await o.arquivos.antivirus.conferir(dados);
    if (!r.limpo) throw new RecusaDasConversas("O antivírus bloqueou o arquivo e ele não foi enviado.");
  }
  const tipo = pedido.arquivo ? (ehFoto(pedido.arquivo.tipo) ? "foto" : "documento") : "texto";
  const m = await c.query<{ id: string }>(
    `insert into mensagens_com_contatos (empresa_id, conversa_id, canal_id, direcao, autor, autor_pessoa_id,
                                         autor_agente_id, tipo, texto, entrega)
     values (empresa_ativa(), $1, $2, 'saiu', $3, $4, $5, $6, $7, 'pendente') returning id`,
    [
      conversa.id,
      conversa.canal.id,
      "pessoaId" in autor ? "pessoa" : "agente",
      "pessoaId" in autor ? autor.pessoaId : null,
      "agenteId" in autor ? autor.agenteId : null,
      tipo,
      pedido.texto?.trim() || null,
    ],
  );
  const mensagemId = m.rows[0]?.id as string;
  if (pedido.arquivo && dados && o.arquivos) {
    const arquivoId = crypto.randomUUID();
    const caminho = caminhoDoArquivo(empresaId, arquivoId);
    await o.arquivos.deposito.gravar(caminho, dados, pedido.arquivo.tipo);
    await c.query(
      `insert into arquivos_de_conversa (id, empresa_id, mensagem_id, nome, tipo, tamanho, situacao, caminho)
       values ($1, empresa_ativa(), $2, $3, $4, $5, 'disponivel', $6)`,
      [
        arquivoId,
        mensagemId,
        nomeLimpo(pedido.arquivo.nome, "arquivo"),
        pedido.arquivo.tipo,
        dados.length,
        caminho,
      ],
    );
  }
  await c.query(
    `update conversas_com_contatos set ultimo_a_responder = $2, ultima_mensagem_em = now(),
            situacao = 'esperando_cliente'
      where id = $1 and empresa_id = empresa_ativa()`,
    [conversa.id, "pessoaId" in autor ? "pessoa" : "agente"],
  );
  return mensagemId;
}

/** Avisa os administradores de que o ritmo segurou mensagens do canal (no máximo uma vez por hora). */
async function avisarQueSegurou(c: pg.PoolClient, canalId: string, nome: string) {
  const r = await c.query(
    `update canais_de_contato set segurando_avisado_em = now()
      where id = $1 and empresa_id = empresa_ativa()
        and (segurando_avisado_em is null or segurando_avisado_em < now() - interval '1 hour') returning id`,
    [canalId],
  );
  if ((r.rowCount ?? 0) === 0) return;
  const admins = await c.query<{ pessoa_id: string }>(
    "select pessoa_id from vinculos where empresa_id = empresa_ativa() and perfil = 'administrador' and situacao = 'ativo'",
  );
  for (const a of admins.rows)
    await criarAviso(c, {
      pessoaId: a.pessoa_id,
      tipo: "canal_segurando_mensagens",
      texto: `O canal "${nome}" chegou ao limite de mensagens por minuto ou por hora. As próximas saem sozinhas, um pouco depois, para diminuir o risco de bloqueio do número.`,
      link: "/canais",
    });
}

/**
 * Manda uma mensagem pendente (trabalho da fila). Devolve em quantos segundos tentar de novo (ritmo do número ou
 * falha da Evolution), ou nulo quando terminou (enviada ou falhou de vez).
 */
export async function enviarPendente(
  o: OpcoesDasMensagens,
  empresaId: string,
  mensagemId: string,
): Promise<number | null> {
  type Linha = {
    canal_id: string;
    canal_nome: string;
    canal_situacao: string;
    provedor: string;
    limite_por_minuto: number;
    limite_por_hora: number;
    identificador: string;
    tipo: string;
    texto: string | null;
    tentativas: number;
    arquivo_nome: string | null;
    arquivo_tipo: string | null;
    arquivo_caminho: string | null;
    no_minuto: number;
    na_hora: number;
    mais_antiga_do_minuto: Date | null;
    mais_antiga_da_hora: Date | null;
    ultima_ao_contato: Date | null;
  };
  const falhar = (motivo: string) =>
    comEmpresa(o.poolApp, empresaId, (c) =>
      c.query(
        `update mensagens_com_contatos set entrega = 'falhou', motivo_da_falha = $2
          where id = $1 and empresa_id = empresa_ativa() and entrega = 'pendente'`,
        [mensagemId, motivo],
      ),
    );
  const preparado = await comEmpresa(o.poolApp, empresaId, async (c) => {
    const r = await c.query<Linha>(
      `select m.canal_id, cn.nome as canal_nome, cn.situacao as canal_situacao, cn.limite_por_minuto, cn.limite_por_hora,
              cn.provedor,
              cv.identificador, m.tipo, m.texto, m.tentativas,
              a.nome as arquivo_nome, a.tipo as arquivo_tipo, a.caminho as arquivo_caminho,
              (select count(*)::int from mensagens_com_contatos x where x.canal_id = m.canal_id and x.empresa_id = m.empresa_id
                  and x.enviada_ao_provedor_em > now() - interval '1 minute') as no_minuto,
              (select count(*)::int from mensagens_com_contatos x where x.canal_id = m.canal_id and x.empresa_id = m.empresa_id
                  and x.enviada_ao_provedor_em > now() - interval '1 hour') as na_hora,
              (select min(x.enviada_ao_provedor_em) from mensagens_com_contatos x where x.canal_id = m.canal_id
                  and x.empresa_id = m.empresa_id and x.enviada_ao_provedor_em > now() - interval '1 minute') as mais_antiga_do_minuto,
              (select min(x.enviada_ao_provedor_em) from mensagens_com_contatos x where x.canal_id = m.canal_id
                  and x.empresa_id = m.empresa_id and x.enviada_ao_provedor_em > now() - interval '1 hour') as mais_antiga_da_hora,
              (select max(x.enviada_ao_provedor_em) from mensagens_com_contatos x where x.conversa_id = m.conversa_id
                  and x.empresa_id = m.empresa_id and x.id <> m.id) as ultima_ao_contato
         from mensagens_com_contatos m
         join canais_de_contato cn on cn.id = m.canal_id and cn.empresa_id = m.empresa_id
         join conversas_com_contatos cv on cv.id = m.conversa_id and cv.empresa_id = m.empresa_id
         left join arquivos_de_conversa a on a.mensagem_id = m.id and a.empresa_id = m.empresa_id
        where m.id = $1 and m.empresa_id = empresa_ativa() and m.entrega = 'pendente' and m.direcao = 'saiu'
        for update of m`,
      [mensagemId],
    );
    const l = r.rows[0];
    if (!l) return { fim: true as const };
    // O balão do site (M8-07) busca as mensagens sozinho: fica "pendente" até o balão receber.
    if (l.provedor === "site") return { fim: true as const };
    if (l.canal_situacao !== "conectado") return { falha: "O número do canal não está conectado." };
    const destino = destinoDoIdentificador(l.identificador);
    if (!destino) return { falha: "Este contato não tem um número de WhatsApp para responder." };
    const agora = Date.now();
    let esperar = 0;
    if (l.no_minuto >= l.limite_por_minuto && l.mais_antiga_do_minuto)
      esperar = Math.max(esperar, Math.ceil((l.mais_antiga_do_minuto.getTime() + 60_000 - agora) / 1000));
    if (l.na_hora >= l.limite_por_hora && l.mais_antiga_da_hora)
      esperar = Math.max(esperar, Math.ceil((l.mais_antiga_da_hora.getTime() + 3_600_000 - agora) / 1000));
    if (esperar > 0) {
      await avisarQueSegurou(c, l.canal_id, l.canal_nome);
      return { esperar };
    }
    if (l.ultima_ao_contato) {
      const falta = l.ultima_ao_contato.getTime() + SEGUNDOS_ENTRE_MENSAGENS_AO_CONTATO * 1000 - agora;
      if (falta > 0) return { esperar: Math.ceil(falta / 1000) };
    }
    // Reserva a vez no ritmo antes de mandar (duas filas ao mesmo tempo não passam do limite).
    await c.query(
      `update mensagens_com_contatos set enviada_ao_provedor_em = now(), tentativas = tentativas + 1
        where id = $1 and empresa_id = empresa_ativa()`,
      [mensagemId],
    );
    return { linha: l, destino };
  });
  if ("fim" in preparado) return null;
  if ("falha" in preparado) {
    await falhar(preparado.falha as string);
    return null;
  }
  if ("esperar" in preparado) return preparado.esperar as number;
  const { linha: l, destino } = preparado;
  const instancia = nomeDaInstancia(empresaId, l.canal_id);
  try {
    let id: string;
    if (l.arquivo_caminho && l.arquivo_tipo && o.arquivos) {
      const dados = await o.arquivos.deposito.ler(l.arquivo_caminho);
      id = (
        await o.evolution.enviarArquivo(instancia, destino, {
          tipo: ehFoto(l.arquivo_tipo) ? "image" : "document",
          mime: l.arquivo_tipo,
          nomeDoArquivo: l.arquivo_nome ?? "arquivo",
          base64: dados.toString("base64"),
          ...(l.texto ? { legenda: l.texto } : {}),
        })
      ).id;
    } else if (l.texto) {
      id = (await o.evolution.enviarTexto(instancia, destino, l.texto)).id;
    } else {
      await falhar("A mensagem não tem texto nem arquivo.");
      return null;
    }
    await comEmpresa(o.poolApp, empresaId, (c) =>
      c.query(
        `update mensagens_com_contatos set id_no_provedor = coalesce(id_no_provedor, $2),
                entrega = case when entrega = 'pendente' then 'enviada' else entrega end, motivo_da_falha = null
          where id = $1 and empresa_id = empresa_ativa()`,
        [mensagemId, id],
      ),
    );
    return null;
  } catch (erro) {
    if (!(erro instanceof ErroDaEvolution)) throw erro;
    o.log.warn({ erro: erro.message, mensagemId }, "Mensagem não saiu pela Evolution");
    if (l.tentativas + 1 >= TENTATIVAS_DE_ENVIO) {
      await falhar("O WhatsApp não aceitou a mensagem agora. Tente de novo.");
      return null;
    }
    // Volta para a fila, sem contar no ritmo (não saiu).
    await comEmpresa(o.poolApp, empresaId, (c) =>
      c.query(
        "update mensagens_com_contatos set enviada_ao_provedor_em = null where id = $1 and empresa_id = empresa_ativa()",
        [mensagemId],
      ),
    );
    return 30 * (l.tentativas + 1);
  }
}

// Prazo dos arquivos ---------------------------------------------------------------------------------------------------

/** Verificação diária: apaga do depósito os arquivos das conversas que passaram do prazo (o texto fica). */
export async function cuidarDoPrazoDosArquivos(
  poolApp: pg.Pool,
  arquivos: ServicosDosAnexos,
  log: Log,
): Promise<number> {
  let apagados = 0;
  const empresas = await poolApp.query<{ empresa_id: string }>(
    "select empresa_id from empresas_com_arquivos_de_conversa_vencidos()",
  );
  for (const { empresa_id } of empresas.rows) {
    const vencidos = await comEmpresa(poolApp, empresa_id, (c) =>
      c.query<{ id: string; caminho: string }>(
        `select id, caminho from arquivos_de_conversa where empresa_id = empresa_ativa() and situacao = 'disponivel'
            and apagar_em < now() order by apagar_em limit 500`,
      ),
    );
    for (const a of vencidos.rows) {
      try {
        await arquivos.deposito.apagar(a.caminho);
        await comEmpresa(poolApp, empresa_id, (c) =>
          c.query(
            "update arquivos_de_conversa set situacao = 'apagado', caminho = null where id = $1 and empresa_id = empresa_ativa()",
            [a.id],
          ),
        );
        apagados += 1;
      } catch (erro) {
        log.warn(
          { erro: (erro as Error).message, empresaId: empresa_id },
          "Arquivo de conversa vencido não apagou",
        );
      }
    }
  }
  return apagados;
}

// Rotas ------------------------------------------------------------------------------------------------------------

function invalido(resposta: FastifyReply, problemas: Problema[]) {
  const p = problemas[0];
  return resposta.code(400).send({
    code: "PEDIDO_INVALIDO",
    message: p ? `Confira ${p.caminho || "o pedido"}: ${p.mensagem}.` : "Confira os campos e tente de novo.",
  });
}

export interface OpcoesDasRotasDoEnvio {
  verificador: Verificador;
  poolApp: pg.Pool;
  arquivos: ServicosDosAnexos | null;
  /** Leva a mensagem à fila de envio (na API) ou manda na hora (nos testes). */
  enfileirar: (empresaId: string, mensagemId: string) => Promise<void>;
}

/** Os minutos do link de baixar o arquivo de uma conversa. */
const MINUTOS_DO_LINK = 5;

export function registrarRotasDoEnvio(app: FastifyInstance, o: OpcoesDasRotasDoEnvio): void {
  const naEmpresa = <T>(pedido: FastifyRequest, trabalho: (c: pg.PoolClient) => Promise<T>) => {
    const { sessao } = acessoDo(pedido);
    return comPessoa(o.poolApp, sessao.pessoa.id, sessao.empresaId, trabalho);
  };
  const olha = (pedido: FastifyRequest, acao: "ver" | "criar") => {
    const { sessao, permissoes } = acessoDo(pedido);
    return quemOlhaConversas(permissoes, sessao.pessoa.id, acao);
  };
  const registrar = (
    pedido: FastifyRequest,
    acao: string,
    conversaId: string,
    detalhes: Record<string, unknown>,
  ) => {
    const { sessao } = acessoDo(pedido);
    return auditar(
      o.poolApp,
      {
        empresaId: sessao.empresaId,
        ator: { tipo: "pessoa", pessoaId: sessao.pessoa.id },
        acao,
        alvo: { tipo: "conversa", id: conversaId },
        origem: origemDoPedido(pedido),
        rastreio: pedido.id,
        detalhes,
      },
      pedido.log,
    );
  };
  const naoEncontrada = (resposta: FastifyReply) =>
    resposta.code(404).send({ code: "NAO_ENCONTRADA", message: "Conversa não encontrada." });
  const recusa = (resposta: FastifyReply, erro: unknown) => {
    if (erro instanceof RecusaDasConversas)
      return resposta.code(400).send({ code: "MENSAGEM_RECUSADA", message: erro.message });
    throw erro;
  };

  app.post(
    "/conversas-com-contatos/:id/mensagens",
    { preHandler: o.verificador.exigir("conversas", "criar"), bodyLimit: 36 * 1024 * 1024 },
    async (pedido, resposta) => {
      const { id } = pedido.params as { id: string };
      const r = conferir(PedidoDeMensagemNaConversa, pedido.body);
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      try {
        const feito = await naEmpresa(pedido, async (c) => {
          const conversa = await buscarConversa(c, [olha(pedido, "criar")], id, true);
          if (!conversa) return null;
          return criarMensagemQueSai(
            o,
            c,
            sessao.empresaId,
            conversa,
            { pessoaId: sessao.pessoa.id },
            r.valor,
          );
        });
        if (!feito) return naoEncontrada(resposta);
        await o.enfileirar(sessao.empresaId, feito);
        await registrar(pedido, "conversa.enviou", id, { mensagemId: feito, comArquivo: !!r.valor.arquivo });
        return resposta.code(201).send({ mensagemId: feito });
      } catch (erro) {
        return recusa(resposta, erro);
      }
    },
  );

  app.post(
    "/conversas-com-contatos/:id/mensagens/:mensagemId/tentar",
    { preHandler: o.verificador.exigir("conversas", "criar") },
    async (pedido, resposta) => {
      const { id, mensagemId } = pedido.params as { id: string; mensagemId: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        const conversa = await buscarConversa(c, [olha(pedido, "criar")], id);
        if (!conversa) return null;
        const m = await c.query(
          `update mensagens_com_contatos set entrega = 'pendente', motivo_da_falha = null, tentativas = 0,
                  enviada_ao_provedor_em = null
            where id = $1 and conversa_id = $2 and empresa_id = empresa_ativa() and entrega = 'falhou'
              and direcao = 'saiu' and not pelo_celular returning id`,
          [/^[0-9a-f-]{36}$/i.test(mensagemId) ? mensagemId : null, id],
        );
        return (m.rowCount ?? 0) > 0;
      });
      if (feito === null) return naoEncontrada(resposta);
      if (!feito)
        return resposta
          .code(400)
          .send({ code: "NAO_FALHOU", message: "Só dá para mandar de novo a mensagem que falhou." });
      await o.enfileirar(sessao.empresaId, mensagemId);
      await registrar(pedido, "conversa.reenviou", id, { mensagemId });
      return { ok: true };
    },
  );

  // As sugestões do agente (M8-05): enviar como está (conta para a autonomia), enviar editada, ou descartar.
  app.post(
    "/conversas-com-contatos/:id/sugestoes/:sugestaoId/enviar",
    { preHandler: o.verificador.exigir("conversas", "criar") },
    async (pedido, resposta) => {
      const { id, sugestaoId } = pedido.params as { id: string; sugestaoId: string };
      const r = conferir(PedidoDeEnviarSugestao, pedido.body ?? {});
      if (!r.ok) return invalido(resposta, r.problemas);
      const { sessao } = acessoDo(pedido);
      try {
        const feito = await naEmpresa(pedido, async (c) => {
          const conversa = await buscarConversa(c, [olha(pedido, "criar")], id, true);
          if (!conversa) return null;
          const s = await c.query<{ texto: string; agente_id: string | null; com_pessoa: boolean }>(
            `select texto, agente_id, com_pessoa from sugestoes_de_resposta
              where id = $1 and conversa_id = $2 and empresa_id = empresa_ativa() and situacao = 'pendente' for update`,
            [/^[0-9a-f-]{36}$/i.test(sugestaoId) ? sugestaoId : null, id],
          );
          const sugestao = s.rows[0];
          if (!sugestao) throw new RecusaDasConversas("Essa sugestão já foi usada ou descartada.");
          const texto = r.valor.texto?.trim() || sugestao.texto;
          const editada = texto !== sugestao.texto;
          // Sem edição, vai como o agente escreveu (autor: o agente); editada, a pessoa é a autora. Com uma pessoa
          // na conversa (M8-06), a pessoa é sempre a autora e a sugestão não conta para a autonomia.
          const mensagemId = await criarMensagemQueSai(
            o,
            c,
            sessao.empresaId,
            conversa,
            !editada && sugestao.agente_id && !sugestao.com_pessoa
              ? { agenteId: sugestao.agente_id }
              : { pessoaId: sessao.pessoa.id },
            { texto },
          );
          await c.query(
            `update sugestoes_de_resposta set situacao = $2, decidida_por = $3, decidida_em = now(), mensagem_id = $4
              where id = $1 and empresa_id = empresa_ativa()`,
            [sugestaoId, editada ? "editada" : "enviada", sessao.pessoa.id, mensagemId],
          );
          if (!editada && !sugestao.com_pessoa) await contarSugestaoSemEdicao(c, conversa.canal.id);
          return { mensagemId, editada };
        });
        if (!feito) return naoEncontrada(resposta);
        await o.enfileirar(sessao.empresaId, feito.mensagemId);
        await registrar(pedido, "sugestao.enviou", id, {
          sugestaoId,
          mensagemId: feito.mensagemId,
          editada: feito.editada,
        });
        return resposta.code(201).send(feito);
      } catch (erro) {
        return recusa(resposta, erro);
      }
    },
  );

  app.post(
    "/conversas-com-contatos/:id/sugestoes/:sugestaoId/descartar",
    { preHandler: o.verificador.exigir("conversas", "criar") },
    async (pedido, resposta) => {
      const { id, sugestaoId } = pedido.params as { id: string; sugestaoId: string };
      const { sessao } = acessoDo(pedido);
      const feito = await naEmpresa(pedido, async (c) => {
        if (!(await buscarConversa(c, [olha(pedido, "criar")], id))) return null;
        const s = await c.query(
          `update sugestoes_de_resposta set situacao = 'descartada', decidida_por = $3, decidida_em = now()
            where id = $1 and conversa_id = $2 and empresa_id = empresa_ativa() and situacao = 'pendente' returning id`,
          [/^[0-9a-f-]{36}$/i.test(sugestaoId) ? sugestaoId : null, id, sessao.pessoa.id],
        );
        return (s.rowCount ?? 0) > 0;
      });
      if (feito === null) return naoEncontrada(resposta);
      if (!feito)
        return resposta
          .code(400)
          .send({ code: "SUGESTAO_USADA", message: "Essa sugestão já foi usada ou descartada." });
      await registrar(pedido, "sugestao.descartou", id, { sugestaoId });
      return { ok: true };
    },
  );

  // O link (5 minutos) para ver ou baixar o arquivo de uma mensagem, para quem vê a conversa.
  app.get(
    "/conversas-com-contatos/:id/arquivos/:arquivoId",
    { preHandler: o.verificador.exigir("conversas", "ver") },
    async (pedido, resposta) => {
      const { id, arquivoId } = pedido.params as { id: string; arquivoId: string };
      const arquivos = o.arquivos;
      const achado = await naEmpresa(pedido, async (c) => {
        if (!(await buscarConversa(c, [olha(pedido, "ver")], id))) return null;
        const a = await c.query<{ nome: string; tipo: string; caminho: string | null; situacao: string }>(
          `select a.nome, a.tipo, a.caminho, a.situacao from arquivos_de_conversa a
             join mensagens_com_contatos m on m.id = a.mensagem_id and m.empresa_id = a.empresa_id
            where a.id = $1 and m.conversa_id = $2 and a.empresa_id = empresa_ativa()`,
          [/^[0-9a-f-]{36}$/i.test(arquivoId) ? arquivoId : null, id],
        );
        return a.rows[0] ?? null;
      });
      if (!achado)
        return resposta.code(404).send({ code: "NAO_ENCONTRADO", message: "Arquivo não encontrado." });
      if (!achado.caminho || !arquivos)
        return resposta
          .code(410)
          .send({ code: "ARQUIVO_INDISPONIVEL", message: "Este arquivo não está disponível." });
      const link = arquivos.deposito.linkDeDownload(
        achado.caminho,
        achado.nome,
        achado.tipo,
        MINUTOS_DO_LINK * 60,
      );
      return { url: link.url, expiraEm: link.expiraEm.toISOString() };
    },
  );
}
