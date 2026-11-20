/**
 * Camada própria para falar com cada provedor de IA (M4-01, decisão 4 da spec do M4: sem framework de terceiros).
 * Na M4-01 só testa a chave e lista os modelos; a conversa com o modelo entra na M4-02, nesta mesma interface.
 *
 * A chave vai só no cabeçalho, nunca na URL. Os erros viram um texto curto, sem o corpo da resposta (que poderia
 * repetir a chave) e sem a chave.
 */
import { lookup } from "node:dns/promises";
import type {
  ModeloEscolhido,
  ModelosDoAgente,
  ProvedorDeIa,
  TesteDaContaDeIa,
  TipoDeCredencial,
} from "@mago-os/contratos";
import { type LoginDoCodex, lerLoginDoCodex } from "@mago-os/contratos";

export const ENDERECO_DA_ANTHROPIC = "https://api.anthropic.com/v1";
export const VERSAO_DA_API_ANTHROPIC = "2023-06-01";
const TEMPO_MAXIMO_MS = 15_000;
const MAXIMO_DE_MODELOS = 1000;
/** A lista de modelos não passa disso (o OpenRouter, com centenas de modelos, fica bem abaixo). */
const MAXIMO_DA_RESPOSTA = 2_000_000;

export interface AcessoAoProvedor {
  provedor: ProvedorDeIa;
  /** Chave de API (padrão) ou o login de um plano de assinatura (M4-10). */
  credencial?: TipoDeCredencial;
  /** Só para compativel_openai. */
  endereco: string | null;
  chave: string;
}

/**
 * O teste e, na assinatura, o que mudou: o login renovado (o ChatGPT troca o token de renovação, e o novo precisa
 * voltar ao cofre) e até quando o limite do plano acabou.
 */
export type ResultadoDoTeste = TesteDaContaDeIa & { credencialNova?: string; limiteAte?: Date };

export interface Provedores {
  /** Testa a chave (ou o login do plano) e lista os modelos que ela alcança. */
  testar(acesso: AcessoAoProvedor): Promise<ResultadoDoTeste>;
}

/**
 * Modelos conhecidos dos planos de assinatura do ChatGPT, que não têm uma lista pública: atualizada por nós, como a
 * tabela de preços. Chegam desligados, e o administrador libera os que o plano dele tem.
 */
export const MODELOS_DO_CHATGPT = ["gpt-5.1", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5"] as const;

/** Endereço e cliente públicos do login do Codex (os mesmos que o Codex usa para renovar o acesso). */
export const RENOVAR_LOGIN_DO_CHATGPT = "https://auth.openai.com/oauth/token";
export const CLIENTE_DO_CODEX = "app_EMoamEEZ73f0CkXaXp7hrann";

/** Os 4 caracteres que identificam a credencial na tela (no JSON do Codex, o fim da conta ou do token). */
export function finalDaCredencial(provedor: ProvedorDeIa, chave: string): string {
  if (provedor === "chatgpt") {
    const login = lerLoginDoCodex(chave);
    const base = login?.tokens.account_id ?? login?.tokens.refresh_token ?? "";
    return base.length >= 4 ? base.slice(-4) : "json";
  }
  return chave.slice(-4);
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

export function erroPeloCodigo(codigo: number): string {
  if (codigo === 401 || codigo === 403) return "O provedor recusou a chave.";
  if (codigo === 404) return "O endereço não tem a lista de modelos (confira o endereço).";
  if (codigo === 429) return "O provedor pediu para esperar (limite de pedidos ou sem crédito).";
  if (codigo >= 500) return `O provedor está com problema (erro ${codigo}).`;
  return `O provedor respondeu com erro ${codigo}.`;
}

export type RespostaJson =
  | { ok: true; corpo: unknown }
  | { ok: false; erro: string; status?: number; esperarSegundos?: number; motivo?: string };

/** Lê só o começo do corpo de uma resposta de erro (até 8 KB) e solta o resto. */
export async function lerPouco(r: Response): Promise<string> {
  if (!r.body) return "";
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for await (const parte of r.body) {
      partes.push(parte);
      tamanho += parte.byteLength;
      if (tamanho >= 8192) break;
    }
  } catch {
    // corpo interrompido: fica o que veio
  }
  await r.body.cancel().catch(() => {});
  return Buffer.concat(partes).toString("utf8").slice(0, 8192);
}

/**
 * O motivo que o provedor deu para o erro, em texto curto (até 200 caracteres), para o administrador entender o que
 * houve (limite de verdade, token recusado, modelo errado). Tira qualquer coisa parecida com chave ou token.
 */
export function motivoDoProvedor(corpo: string): string | null {
  let texto: unknown = null;
  try {
    const j = JSON.parse(corpo) as { error?: unknown; message?: unknown; detail?: unknown };
    const e = j.error as { message?: unknown; type?: unknown } | string | undefined;
    texto =
      typeof e === "string"
        ? e
        : typeof e?.message === "string"
          ? `${typeof e.type === "string" ? `${e.type}: ` : ""}${e.message}`
          : (j.message ?? j.detail ?? null);
  } catch {
    texto = corpo;
  }
  if (typeof texto !== "string") return null;
  const limpo = texto
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[chave]")
    .replace(/[A-Za-z0-9_\-.]{32,}/g, "[omitido]")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpo ? limpo.slice(0, 200) : null;
}

/** Segundos de espera que o provedor pediu (retry-after em segundos ou em data), se pediu. */
export function esperaPedida(valor: string | null, agora = Date.now()): number | undefined {
  if (valor === null || valor.trim() === "") return undefined;
  const segundos = /^\d+$/.test(valor.trim()) ? Number(valor) : (Date.parse(valor) - agora) / 1000;
  return Number.isFinite(segundos) && segundos >= 0
    ? Math.min(Math.ceil(segundos), 7 * 24 * 3600)
    : undefined;
}

export async function pedirJson(
  url: string,
  cabecalhos: Record<string, string>,
  corpo?: unknown,
  tempoMaximoMs = TEMPO_MAXIMO_MS,
): Promise<RespostaJson> {
  try {
    const r = await fetch(url, {
      method: corpo === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        ...(corpo === undefined ? {} : { "content-type": "application/json" }),
        ...cabecalhos,
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      redirect: "error",
      signal: AbortSignal.timeout(tempoMaximoMs),
    });
    if (!r.ok) {
      const espera = esperaPedida(r.headers.get("retry-after"));
      const motivo = motivoDoProvedor(await lerPouco(r));
      return {
        ok: false,
        erro: motivo ? `${erroPeloCodigo(r.status)} Motivo: ${motivo}` : erroPeloCodigo(r.status),
        status: r.status,
        ...(motivo ? { motivo } : {}),
        ...(espera !== undefined ? { esperarSegundos: espera } : {}),
      };
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
  /** Conversa mínima pelo Claude Code (plano da Anthropic): devolve o erro, ou null se respondeu. */
  conversaPeloClaudeCode?: (token: string, modelo: string) => Promise<string | null>,
): Provedores {
  return {
    async testar(a) {
      if (a.credencial === "assinatura") return testarAssinatura(a, conversaPeloClaudeCode);
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

/** Limite do plano: 429 do provedor. Sem hora informada, uma hora. */
function limiteDoPlano(pedido: Extract<RespostaJson, { ok: false }>): ResultadoDoTeste | null {
  if (pedido.status !== 429) return null;
  return {
    ok: false,
    erro: `O limite do plano de assinatura acabou por enquanto.${pedido.motivo ? ` Motivo do provedor: ${pedido.motivo}` : ""}`,
    limiteAte: new Date(Date.now() + (pedido.esperarSegundos ?? 3600) * 1000),
  };
}

/**
 * Assinatura (M4-10, decisão 0022). Anthropic: o token do `claude setup-token`, no cabeçalho Authorization, lista os
 * modelos. ChatGPT: o login do Codex é renovado (o que testa o token de renovação), e o login novo volta ao cofre.
 * Cumprir os termos do provedor é responsabilidade do administrador, que aceitou o aviso ao conectar.
 */
async function testarAssinatura(
  a: AcessoAoProvedor,
  conversaPeloClaudeCode?: (token: string, modelo: string) => Promise<string | null>,
): Promise<ResultadoDoTeste> {
  if (a.provedor === "anthropic") {
    const pedido = await pedirJson(`${ENDERECO_DA_ANTHROPIC}/models?limit=1000`, {
      authorization: `Bearer ${a.chave}`,
      "anthropic-version": VERSAO_DA_API_ANTHROPIC,
      "anthropic-beta": "oauth-2025-04-20",
    });
    if (!pedido.ok) return limiteDoPlano(pedido) ?? { ok: false, erro: pedido.erro };
    const modelos = modelosDaResposta(pedido.corpo);
    // Listar modelos a Anthropic deixa; conversar com o plano, só pelo Claude Code: o teste faz uma conversa
    // mínima por ele, com o modelo mais leve, para a conta não aparecer "Funcionando" sem funcionar.
    if (conversaPeloClaudeCode && modelos.length > 0) {
      const leve = modelos.find((m) => m.includes("haiku")) ?? (modelos[0] as string);
      const erro = await conversaPeloClaudeCode(a.chave, leve);
      if (erro) return { ok: false, erro: erro.slice(0, 300) };
    }
    return { ok: true, modelos };
  }
  if (a.provedor === "chatgpt") {
    const login = lerLoginDoCodex(a.chave);
    if (!login) return { ok: false, erro: "O login do Codex não está no formato do auth.json." };
    const pedido = await pedirJson(
      RENOVAR_LOGIN_DO_CHATGPT,
      {},
      {
        client_id: CLIENTE_DO_CODEX,
        grant_type: "refresh_token",
        refresh_token: login.tokens.refresh_token,
        scope: "openid profile email",
      },
    );
    // Aqui o 429 é do serviço de login, não do plano: vira erro comum, sem marcar o limite do plano.
    if (!pedido.ok)
      return {
        ok: false,
        erro:
          pedido.status === 400 || pedido.status === 401
            ? "O ChatGPT recusou o login. Entre de novo no Codex e cole o auth.json novo."
            : pedido.erro,
      };
    const novo = pedido.corpo as { access_token?: unknown; refresh_token?: unknown; id_token?: unknown };
    if (typeof novo?.access_token !== "string")
      return { ok: false, erro: "O ChatGPT não devolveu o acesso." };
    const renovado: LoginDoCodex = {
      ...login,
      tokens: {
        ...login.tokens,
        access_token: novo.access_token,
        ...(typeof novo.refresh_token === "string" ? { refresh_token: novo.refresh_token } : {}),
        ...(typeof novo.id_token === "string" ? { id_token: novo.id_token } : {}),
      },
      last_refresh: new Date().toISOString(),
    };
    return { ok: true, modelos: [...MODELOS_DO_CHATGPT], credencialNova: JSON.stringify(renovado) };
  }
  return { ok: false, erro: "Este provedor não aceita assinatura." };
}

/**
 * Provedor falso, para os testes (sem custo, sem rede): aceita só as chaves da lista e devolve os modelos dela.
 */
export function provedoresFalsos(
  chaves: Record<string, string[]>,
  opcoes: { noLimite?: Set<string>; renovar?: (chave: string) => string | undefined } = {},
): Provedores & { chamadas: number; ultimoAcesso: AcessoAoProvedor | null } {
  const falso = {
    chamadas: 0,
    ultimoAcesso: null as AcessoAoProvedor | null,
    async testar(a: AcessoAoProvedor): Promise<ResultadoDoTeste> {
      falso.chamadas += 1;
      falso.ultimoAcesso = a;
      if (opcoes.noLimite?.has(a.chave))
        return {
          ok: false,
          erro: "O limite do plano de assinatura acabou por enquanto.",
          limiteAte: new Date(Date.now() + 3600_000),
        };
      const modelos = chaves[a.chave];
      if (!modelos) return { ok: false, erro: "O provedor recusou a chave." };
      const nova = a.credencial === "assinatura" ? opcoes.renovar?.(a.chave) : undefined;
      return { ok: true, modelos, ...(nova ? { credencialNova: nova } : {}) };
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
