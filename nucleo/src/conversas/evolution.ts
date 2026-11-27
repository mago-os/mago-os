/**
 * Cliente da Evolution API (M8-02, decisão 0052), versão 2.3.x. Só o núcleo fala com ela, pela rede interna do
 * servidor, com a chave global (AUTHENTICATION_API_KEY). Cada canal de WhatsApp do Mago OS é uma "instância" da
 * Evolution com o nome igual ao id do canal: o aviso de uma instância só mexe no canal dela.
 *
 * Os formatos seguem a documentação da 2.3; o teste final com um número de verdade (decisão 5 da spec) confere. Os
 * testes usam a Evolution falsa (evolutionFalsa), que imita as respostas e os avisos.
 */
import { formasDoTelefone, telefoneInternacional } from "./telefone.ts";

export type EstadoDaConexao = "open" | "connecting" | "close";

export interface ClienteDaEvolution {
  /** Cria a instância, já com o endereço dos avisos e o segredo no cabeçalho. Grupos ficam de fora (decisão 11). */
  criarInstancia(nome: string): Promise<void>;
  /** O QR code atual (data URL PNG), ou nulo se já conectou. */
  pedirQr(nome: string): Promise<string | null>;
  /** O estado da conexão e o número conectado, quando há. */
  situacao(nome: string): Promise<{ estado: EstadoDaConexao; numero: string | null }>;
  /** Encerra a sessão do WhatsApp no aparelho (o canal fica desconectado). */
  desconectar(nome: string): Promise<void>;
  /** Apaga a instância (quando o canal é apagado). */
  apagarInstancia(nome: string): Promise<void>;
  /** Manda um texto (M8-03). "para" é o telefone sem o + ou o endereço LID ("...@lid"). Devolve o número da mensagem. */
  enviarTexto(nome: string, para: string, texto: string): Promise<{ id: string }>;
  /** Manda foto ou documento (base64 sem o prefixo data:), com a legenda opcional. */
  enviarArquivo(
    nome: string,
    para: string,
    arquivo: {
      tipo: "image" | "document";
      mime: string;
      nomeDoArquivo: string;
      base64: string;
      legenda?: string;
    },
  ): Promise<{ id: string }>;
  /** O arquivo de uma mensagem que chegou (base64), ou nulo se a Evolution não tem. */
  baixarArquivo(nome: string, idDaMensagem: string): Promise<{ base64: string; mime: string | null } | null>;
}

/** Erro da Evolution: fora do ar, chave errada ou resposta inesperada. A tela mostra uma mensagem simples. */
export class ErroDaEvolution extends Error {}

/** Os eventos que o Mago OS pede à Evolution (os de mensagem são usados a partir da M8-03). */
export const EVENTOS_DA_EVOLUTION = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
] as const;

/** O cabeçalho em que a Evolution manda o segredo dos avisos ao núcleo. */
export const CABECALHO_DO_SEGREDO = "x-mago-segredo";

export interface ConfigDaEvolution {
  /** Onde o núcleo alcança a Evolution (ex.: http://evolution:8080). */
  url: string;
  /** A chave global da Evolution. */
  chave: string;
  /** O segredo que a Evolution manda nos avisos. */
  segredo: string;
  /** Onde a Evolution alcança o núcleo (ex.: http://mago-nucleo:3000/interno/evolution/avisos). */
  urlDosAvisos: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O nome da instância na Evolution: a empresa e o canal. */
export const nomeDaInstancia = (empresaId: string, canalId: string) => `${empresaId}_${canalId}`;

/** A empresa e o canal de um nome de instância, ou nulo se não é um nome nosso. */
export function daInstancia(nome: string): { empresaId: string; canalId: string } | null {
  const [empresaId, canalId, ...resto] = nome.split("_");
  if (resto.length > 0 || !empresaId || !canalId || !UUID.test(empresaId) || !UUID.test(canalId)) return null;
  return { empresaId, canalId };
}

/** O número do WhatsApp (jid "5511...@s.whatsapp.net") no formato internacional. */
export function numeroDoJid(jid: unknown): string | null {
  return typeof jid === "string" && jid.length < 120
    ? telefoneInternacional(jid.replace(/:\d+@/, "@"))
    : null;
}

export function criarClienteDaEvolution(
  c: Pick<ConfigDaEvolution, "url" | "chave" | "segredo" | "urlDosAvisos">,
  buscar: typeof fetch = fetch,
): ClienteDaEvolution {
  const base = c.url.replace(/\/$/, "");
  async function pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await buscar(`${base}${caminho}`, {
        method: metodo,
        headers: { apikey: c.chave, ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (erro) {
      throw new ErroDaEvolution(`A Evolution não respondeu (${(erro as Error).name}).`);
    }
    if (!r.ok)
      throw new ErroDaEvolution(`A Evolution respondeu ${r.status} em ${metodo} ${caminho.split("/")[1]}.`);
    const texto = await r.text();
    return (texto ? JSON.parse(texto) : {}) as T;
  }
  const nomeNaUrl = (nome: string) => encodeURIComponent(nome);
  return {
    async criarInstancia(nome) {
      await pedir("POST", "/instance/create", {
        instanceName: nome,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        webhook: {
          enabled: true,
          url: c.urlDosAvisos,
          byEvents: false,
          base64: false,
          headers: { [CABECALHO_DO_SEGREDO]: c.segredo },
          events: EVENTOS_DA_EVOLUTION,
        },
      });
    },
    async pedirQr(nome) {
      const r = await pedir<{ base64?: unknown }>("GET", `/instance/connect/${nomeNaUrl(nome)}`);
      return typeof r.base64 === "string" && r.base64.startsWith("data:image/png;base64,") ? r.base64 : null;
    },
    async situacao(nome) {
      const r = await pedir<{ instance?: { state?: unknown } }>(
        "GET",
        `/instance/connectionState/${nomeNaUrl(nome)}`,
      );
      const estado = r.instance?.state;
      const e: EstadoDaConexao = estado === "open" || estado === "connecting" ? estado : "close";
      if (e !== "open") return { estado: e, numero: null };
      const lista = await pedir<{ ownerJid?: unknown }[]>(
        "GET",
        `/instance/fetchInstances?instanceName=${nomeNaUrl(nome)}`,
      );
      return { estado: e, numero: numeroDoJid(Array.isArray(lista) ? lista[0]?.ownerJid : null) };
    },
    async desconectar(nome) {
      await pedir("DELETE", `/instance/logout/${nomeNaUrl(nome)}`);
    },
    async apagarInstancia(nome) {
      await pedir("DELETE", `/instance/delete/${nomeNaUrl(nome)}`);
    },
    async enviarTexto(nome, para, texto) {
      const r = await pedir<{ key?: { id?: unknown } }>("POST", `/message/sendText/${nomeNaUrl(nome)}`, {
        number: para,
        text: texto,
      });
      return { id: idDaResposta(r) };
    },
    async enviarArquivo(nome, para, a) {
      const r = await pedir<{ key?: { id?: unknown } }>("POST", `/message/sendMedia/${nomeNaUrl(nome)}`, {
        number: para,
        mediatype: a.tipo,
        mimetype: a.mime,
        fileName: a.nomeDoArquivo,
        media: a.base64,
        ...(a.legenda ? { caption: a.legenda } : {}),
      });
      return { id: idDaResposta(r) };
    },
    async baixarArquivo(nome, idDaMensagem) {
      const r = await pedir<{ base64?: unknown; mimetype?: unknown }>(
        "POST",
        `/chat/getBase64FromMediaMessage/${nomeNaUrl(nome)}`,
        { message: { key: { id: idDaMensagem } }, convertToMp4: false },
      );
      if (typeof r.base64 !== "string" || r.base64.length === 0) return null;
      return {
        base64: r.base64.replace(/^data:[^,]*,/, ""),
        mime: typeof r.mimetype === "string" ? r.mimetype : null,
      };
    },
  };
}

function idDaResposta(r: { key?: { id?: unknown } }): string {
  const id = r.key?.id;
  if (typeof id !== "string" || id.length === 0 || id.length > 200)
    throw new ErroDaEvolution("A Evolution não devolveu o número da mensagem.");
  return id;
}

/** A Evolution falsa dos testes: guarda as instâncias na memória e deixa o teste mudar o estado. */
export interface EvolutionFalsa extends ClienteDaEvolution {
  instancias: Map<string, { estado: EstadoDaConexao; numero: string | null; qrs: number }>;
  /** O teste "lê o QR": a instância conecta com este número. */
  conectar(nome: string, numero: string): void;
  /** O número cai (celular sem internet ou sessão encerrada no aparelho). */
  cair(nome: string): void;
  /** Quando ligado, toda chamada falha como se a Evolution estivesse fora do ar. */
  foraDoAr: boolean;
  /** O que foi mandado (M8-03), na ordem. */
  enviadas: {
    instancia: string;
    para: string;
    id: string;
    texto?: string;
    arquivo?: { mime: string; nomeDoArquivo: string };
  }[];
  /** Os arquivos que a Evolution tem, pelo número da mensagem (o teste põe). */
  arquivos: Map<string, { base64: string; mime: string }>;
}

/** Um PNG de 1 pixel, para o QR falso. */
const PNG_FALSO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function evolutionFalsa(): EvolutionFalsa {
  const instancias: EvolutionFalsa["instancias"] = new Map();
  let numero = 0;
  const falsa: EvolutionFalsa = {
    instancias,
    foraDoAr: false,
    enviadas: [],
    arquivos: new Map(),
    async enviarTexto(nome, para, texto) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      if (instancias.get(nome)?.estado !== "open")
        throw new ErroDaEvolution("A Evolution respondeu 400 em POST message.");
      numero += 1;
      const id = `FALSA${numero}`;
      falsa.enviadas.push({ instancia: nome, para, id, texto });
      return { id };
    },
    async enviarArquivo(nome, para, a) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      if (instancias.get(nome)?.estado !== "open")
        throw new ErroDaEvolution("A Evolution respondeu 400 em POST message.");
      numero += 1;
      const id = `FALSA${numero}`;
      falsa.enviadas.push({
        instancia: nome,
        para,
        id,
        ...(a.legenda ? { texto: a.legenda } : {}),
        arquivo: { mime: a.mime, nomeDoArquivo: a.nomeDoArquivo },
      });
      return { id };
    },
    async baixarArquivo(_nome, idDaMensagem) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      return falsa.arquivos.get(idDaMensagem) ?? null;
    },
    conectar(nome, numero) {
      const i = instancias.get(nome);
      if (i) Object.assign(i, { estado: "open", numero: formasDoTelefone(numero)[0] ?? numero });
    },
    cair(nome) {
      const i = instancias.get(nome);
      if (i) Object.assign(i, { estado: "close" });
    },
    async criarInstancia(nome) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      if (instancias.has(nome)) throw new ErroDaEvolution("A Evolution respondeu 403 em POST instance.");
      instancias.set(nome, { estado: "connecting", numero: null, qrs: 0 });
    },
    async pedirQr(nome) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      const i = instancias.get(nome);
      if (!i) throw new ErroDaEvolution("A Evolution respondeu 404 em GET instance.");
      if (i.estado === "open") return null;
      i.qrs += 1;
      return PNG_FALSO;
    },
    async situacao(nome) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      const i = instancias.get(nome);
      if (!i) throw new ErroDaEvolution("A Evolution respondeu 404 em GET instance.");
      return { estado: i.estado, numero: i.estado === "open" ? i.numero : null };
    },
    async desconectar(nome) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      const i = instancias.get(nome);
      if (i) Object.assign(i, { estado: "close", numero: null });
    },
    async apagarInstancia(nome) {
      if (falsa.foraDoAr) throw new ErroDaEvolution("A Evolution não respondeu (falsa).");
      instancias.delete(nome);
    },
  };
  return falsa;
}
