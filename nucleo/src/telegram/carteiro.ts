/**
 * Carteiro do Telegram (M5-01, decisão 0032): as poucas chamadas da API de bots que o Mago OS usa, sem biblioteca de
 * terceiros. As mensagens vão sempre como texto simples (sem parse_mode): o texto que um agente escreve nunca vira
 * formatação. Nos testes, o carteiroFalsoDoTelegram guarda o que seria enviado, sem rede.
 *
 * O token do bot nunca aparece no log: os erros levam só o nome do método e a descrição que o Telegram devolveu.
 */

/** Um botão embaixo da mensagem (M5-04 em diante): ou abre um endereço, ou devolve os dados ao bot. */
export type BotaoDoTelegram = { texto: string; url: string } | { texto: string; dados: string };

export interface OpcoesDaMensagem {
  /** Linhas de botões. */
  botoes?: BotaoDoTelegram[][];
}

export interface CarteiroDoTelegram {
  /** Manda uma mensagem de texto simples. Devolve o número da mensagem no Telegram. */
  enviar(chatId: number, texto: string, opcoes?: OpcoesDaMensagem): Promise<number>;
  /** Mostra "digitando" na conversa (o Telegram mostra por cerca de 5 segundos). */
  digitando(chatId: number): Promise<void>;
  /** O @ do bot (getMe). */
  quemSouEu(): Promise<string>;
  /** Baixa um arquivo pelo número dele no Telegram (getFile e o download), até o limite de 20 MB (M5-03). */
  baixarArquivo(idNoTelegram: string): Promise<Buffer>;
  /** Liga o webhook com o segredo, só para os tipos de atualização usados. */
  ligarWebhook(url: string, segredo: string): Promise<void>;
  /** O menu de comandos do bot. */
  definirComandos(comandos: readonly { comando: string; descricao: string }[]): Promise<void>;
  /** Sai de um grupo ou canal em que alguém pôs o bot. */
  sairDoChat(chatId: number): Promise<void>;
}

/** Erro de uma chamada ao Telegram, sem o token. */
export class ErroDoTelegram extends Error {
  override name = "ErroDoTelegram";
  readonly metodo: string;
  readonly codigo: number;
  /** Quantos segundos o Telegram pediu para esperar (limite de envio). */
  readonly esperar: number | null;
  constructor(metodo: string, codigo: number, descricao: string, esperar: number | null = null) {
    super(`Telegram ${metodo}: ${codigo} ${descricao}`);
    this.metodo = metodo;
    this.codigo = codigo;
    this.esperar = esperar;
  }
}

/** O Telegram aceita até 4096 caracteres por mensagem. */
export const MAXIMO_DA_MENSAGEM_DO_TELEGRAM = 4096;

function teclado(botoes: BotaoDoTelegram[][] | undefined) {
  if (!botoes?.length) return undefined;
  return {
    inline_keyboard: botoes.map((linha) =>
      linha.map((b) =>
        "url" in b ? { text: b.texto, url: b.url } : { text: b.texto, callback_data: b.dados },
      ),
    ),
  };
}

/** O Telegram não deixa um bot baixar mais que isto. */
const LIMITE_PARA_BAIXAR = 20 * 1024 * 1024;

export function carteiroDoTelegram(
  token: string,
  buscar: typeof fetch = fetch,
  base = "https://api.telegram.org",
): CarteiroDoTelegram {
  async function chamar<T>(metodo: string, corpo: Record<string, unknown>): Promise<T> {
    const r = await buscar(`${base}/bot${token}/${metodo}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
    const dados = (await r.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
      error_code?: number;
      parameters?: { retry_after?: number };
    } | null;
    if (!dados?.ok)
      throw new ErroDoTelegram(
        metodo,
        dados?.error_code ?? r.status,
        String(dados?.description ?? "sem resposta").slice(0, 200),
        dados?.parameters?.retry_after ?? null,
      );
    return dados.result as T;
  }
  return {
    async enviar(chatId, texto, opcoes) {
      const m = await chamar<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text: texto.slice(0, MAXIMO_DA_MENSAGEM_DO_TELEGRAM),
        link_preview_options: { is_disabled: true },
        reply_markup: teclado(opcoes?.botoes),
      });
      return m.message_id;
    },
    async digitando(chatId) {
      await chamar("sendChatAction", { chat_id: chatId, action: "typing" });
    },
    async quemSouEu() {
      const eu = await chamar<{ username: string }>("getMe", {});
      return eu.username;
    },
    async baixarArquivo(idNoTelegram) {
      const f = await chamar<{ file_path?: string; file_size?: number }>("getFile", {
        file_id: idNoTelegram,
      });
      if (!f.file_path) throw new ErroDoTelegram("getFile", 400, "arquivo sem caminho para baixar");
      if ((f.file_size ?? 0) > LIMITE_PARA_BAIXAR)
        throw new ErroDoTelegram("getFile", 400, "arquivo grande demais");
      const r = await buscar(`${base}/file/bot${token}/${f.file_path}`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new ErroDoTelegram("download", r.status, "o arquivo não veio");
      const dados = Buffer.from(await r.arrayBuffer());
      if (dados.length > LIMITE_PARA_BAIXAR)
        throw new ErroDoTelegram("download", 400, "arquivo grande demais");
      return dados;
    },
    async ligarWebhook(url, segredo) {
      await chamar("setWebhook", {
        url,
        secret_token: segredo,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
        max_connections: 10,
      });
    },
    async definirComandos(comandos) {
      await chamar("setMyCommands", {
        commands: comandos.map((c) => ({ command: c.comando, description: c.descricao })),
      });
    },
    async sairDoChat(chatId) {
      await chamar("leaveChat", { chat_id: chatId });
    },
  };
}

export interface CarteiroFalsoDoTelegram extends CarteiroDoTelegram {
  enviadas: { chatId: number; texto: string; opcoes?: OpcoesDaMensagem }[];
  saiuDe: number[];
  digitandoEm: number[];
  /** Faz o próximo envio falhar (para testar a entrega que fica para depois). */
  falharProximo: boolean;
  /** Os arquivos que o "Telegram" tem, pelo número de cada um. */
  arquivos: Map<string, Buffer>;
}

/** Para os testes: guarda as mensagens em vez de mandar. */
export function carteiroFalsoDoTelegram(bot = "OsMagoTesteBot"): CarteiroFalsoDoTelegram {
  const falso: CarteiroFalsoDoTelegram = {
    enviadas: [],
    saiuDe: [],
    digitandoEm: [],
    falharProximo: false,
    arquivos: new Map(),
    async enviar(chatId, texto, opcoes) {
      if (falso.falharProximo) {
        falso.falharProximo = false;
        throw new ErroDoTelegram("sendMessage", 500, "falha de teste");
      }
      falso.enviadas.push({ chatId, texto, ...(opcoes ? { opcoes } : {}) });
      return falso.enviadas.length;
    },
    async digitando(chatId) {
      falso.digitandoEm.push(chatId);
    },
    async quemSouEu() {
      return bot;
    },
    async baixarArquivo(idNoTelegram) {
      const dados = falso.arquivos.get(idNoTelegram);
      if (!dados) throw new ErroDoTelegram("getFile", 400, "arquivo não encontrado");
      return dados;
    },
    async ligarWebhook() {},
    async definirComandos() {},
    async sairDoChat(chatId) {
      falso.saiuDe.push(chatId);
    },
  };
  return falso;
}
