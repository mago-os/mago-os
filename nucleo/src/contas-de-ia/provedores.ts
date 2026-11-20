/**
 * Camada própria para falar com cada provedor de IA (M4-01, decisão 4 da spec do M4: sem framework de terceiros).
 * Na M4-01 só testa a chave e lista os modelos; a conversa com o modelo entra na M4-02, nesta mesma interface.
 *
 * A chave vai só no cabeçalho, nunca na URL. Os erros viram um texto curto, sem o corpo da resposta (que poderia
 * repetir a chave) e sem a chave.
 */
import { lookup } from "node:dns/promises";
import type { ModeloEscolhido, ModelosDoAgente, ProvedorDeIa, TesteDaContaDeIa } from "@mago-os/contratos";

export const ENDERECO_DA_ANTHROPIC = "https://api.anthropic.com/v1";
const VERSAO_DA_API_ANTHROPIC = "2023-06-01";
const TEMPO_MAXIMO_MS = 15_000;
const MAXIMO_DE_MODELOS = 1000;
/** A lista de modelos não passa disso (o OpenRouter, com centenas de modelos, fica bem abaixo). */
const MAXIMO_DA_RESPOSTA = 2_000_000;

export interface AcessoAoProvedor {
  provedor: ProvedorDeIa;
  /** Só para compativel_openai. */
  endereco: string | null;
  chave: string;
}

export interface Provedores {
  /** Testa a chave e lista os modelos que ela alcança. */
  testar(acesso: AcessoAoProvedor): Promise<TesteDaContaDeIa>;
}

const NOME_DE_MODELO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;

/** Endereço IP de rede interna, da própria máquina ou reservado (não pode receber a chave fora do Mac). */
export function ipInterno(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip.replace(/^::ffff:/i, ""));
  if (v4) {
    const [a = 0, b = 0, c = 0] = v4.slice(1).map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const h = ip.toLowerCase();
  if (!h.includes(":")) return false;
  return (
    h === "::" ||
    h === "::1" ||
    /^f[cd]/.test(h) ||
    /^fe[89ab]/.test(h) ||
    /^ff/.test(h) ||
    h.startsWith("::ffff:")
  );
}

/** Confere o formato do endereço (sem resolver o nome). Fora do Mac: só https e nada de rede interna escrita direto. */
export function enderecoPermitido(endereco: string, ambiente: "local" | "teste" | "producao"): boolean {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (ambiente === "local") return url.protocol === "https:" || url.protocol === "http:";
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  return !ipInterno(host);
}

export type Resolver = (host: string) => Promise<string[]>;

const resolverDoSistema: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/**
 * Confere o endereço e, fora do Mac, resolve o nome e recusa se algum IP for interno (um nome como
 * 127.0.0.1.nip.io passaria pela conferência do formato). Feito a cada pedido, logo antes de enviar a chave.
 */
export async function enderecoSeguro(
  endereco: string,
  ambiente: "local" | "teste" | "producao",
  resolver: Resolver = resolverDoSistema,
): Promise<boolean> {
  if (!enderecoPermitido(endereco, ambiente)) return false;
  if (ambiente === "local") return true;
  const host = new URL(endereco).hostname.replace(/^\[|\]$/g, "");
  try {
    const ips = await resolver(host);
    return ips.length > 0 && !ips.some(ipInterno);
  } catch {
    return false;
  }
}

function erroPeloCodigo(codigo: number): string {
  if (codigo === 401 || codigo === 403) return "O provedor recusou a chave.";
  if (codigo === 404) return "O endereço não tem a lista de modelos (confira o endereço).";
  if (codigo === 429) return "O provedor pediu para esperar (limite de pedidos ou sem crédito).";
  if (codigo >= 500) return `O provedor está com problema (erro ${codigo}).`;
  return `O provedor respondeu com erro ${codigo}.`;
}

async function pedirJson(
  url: string,
  cabecalhos: Record<string, string>,
): Promise<{ ok: true; corpo: unknown } | { ok: false; erro: string }> {
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json", ...cabecalhos },
      redirect: "error",
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
    if (!r.ok) {
      await r.body?.cancel();
      return { ok: false, erro: erroPeloCodigo(r.status) };
    }
    // Lê aos pedaços e para no limite: uma resposta enorme não enche a memória da API.
    const partes: Uint8Array[] = [];
    let tamanho = 0;
    if (r.body) {
      for await (const parte of r.body) {
        tamanho += parte.byteLength;
        if (tamanho > MAXIMO_DA_RESPOSTA) {
          await r.body.cancel().catch(() => {});
          return { ok: false, erro: "A resposta do provedor veio grande demais." };
        }
        partes.push(parte);
      }
    }
    return { ok: true, corpo: JSON.parse(Buffer.concat(partes).toString("utf8")) };
  } catch (erro) {
    if ((erro as Error).name === "TimeoutError")
      return { ok: false, erro: "O provedor demorou demais para responder." };
    if (erro instanceof SyntaxError) return { ok: false, erro: "A resposta do provedor não é JSON." };
    return { ok: false, erro: "Não foi possível conectar ao provedor." };
  }
}

/** Os nomes dos modelos de uma resposta { data: [{ id }] } (formato da Anthropic e da OpenAI). */
export function modelosDaResposta(corpo: unknown): string[] {
  const dados = (corpo as { data?: unknown })?.data;
  if (!Array.isArray(dados)) return [];
  const nomes = dados
    .map((m) => (m as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && NOME_DE_MODELO.test(id));
  return [...new Set(nomes)].slice(0, MAXIMO_DE_MODELOS);
}

export function provedoresDeVerdade(
  ambiente: "local" | "teste" | "producao",
  resolver: Resolver = resolverDoSistema,
): Provedores {
  return {
    async testar(a) {
      if (a.provedor === "compativel_openai" && !(await enderecoSeguro(a.endereco ?? "", ambiente, resolver)))
        return { ok: false, erro: "O endereço aponta para uma rede interna ou não existe." };
      const pedido =
        a.provedor === "anthropic"
          ? await pedirJson(`${ENDERECO_DA_ANTHROPIC}/models?limit=1000`, {
              "x-api-key": a.chave,
              "anthropic-version": VERSAO_DA_API_ANTHROPIC,
            })
          : await pedirJson(`${(a.endereco ?? "").replace(/\/+$/, "")}/models`, {
              authorization: `Bearer ${a.chave}`,
            });
      if (!pedido.ok) return { ok: false, erro: pedido.erro };
      return { ok: true, modelos: modelosDaResposta(pedido.corpo) };
    },
  };
}

/**
 * Provedor falso, para os testes (sem custo, sem rede): aceita só as chaves da lista e devolve os modelos dela.
 */
export function provedoresFalsos(chaves: Record<string, string[]>): Provedores & { chamadas: number } {
  const falso = {
    chamadas: 0,
    async testar(a: AcessoAoProvedor): Promise<TesteDaContaDeIa> {
      falso.chamadas += 1;
      const modelos = chaves[a.chave];
      return modelos ? { ok: true, modelos } : { ok: false, erro: "O provedor recusou a chave." };
    },
  };
  return falso;
}

/** Por que um modelo não pode ser usado agora (conta com erro, no teto, modelo desligado ou fora do ar). */
export type Indisponivel = (m: ModeloEscolhido) => Promise<string | null>;

/**
 * Roda o trabalho no modelo principal e, se ele não estiver disponível ou falhar, no reserva (M4-01: "o agente
 * passa para o reserva sem parar"). Devolve qual foi usado e, quando passou ao reserva, por quê.
 */
export async function comReserva<T>(
  modelos: ModelosDoAgente,
  indisponivel: Indisponivel,
  trabalho: (m: ModeloEscolhido) => Promise<T>,
): Promise<{ resultado: T; usado: ModeloEscolhido; passouAoReservaPorque: string | null }> {
  const motivo = await indisponivel(modelos.principal);
  if (motivo === null) {
    try {
      return {
        resultado: await trabalho(modelos.principal),
        usado: modelos.principal,
        passouAoReservaPorque: null,
      };
    } catch (erro) {
      if (!modelos.reserva) throw erro;
      return usarReserva(modelos.reserva, (erro as Error).message || "o principal falhou");
    }
  }
  if (!modelos.reserva) throw new Error(`Modelo principal indisponível: ${motivo}`);
  return usarReserva(modelos.reserva, motivo);

  async function usarReserva(reserva: ModeloEscolhido, porque: string) {
    const motivoDoReserva = await indisponivel(reserva);
    if (motivoDoReserva !== null)
      throw new Error(`Principal e reserva indisponíveis: ${porque}; ${motivoDoReserva}`);
    return { resultado: await trabalho(reserva), usado: reserva, passouAoReservaPorque: porque };
  }
}
