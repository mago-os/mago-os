/**
 * Conversa com o modelo (M4-02, decisão 0023): a camada própria que manda o pedido a cada provedor, com as
 * ferramentas, e devolve o texto e as ferramentas que o modelo quer chamar. Sem framework de terceiros.
 *
 * Anthropic (chave de API ou token do plano), compatível com OpenAI (chat/completions) e ChatGPT (o login do Codex,
 * pela API de respostas do Codex). A chave só vai no cabeçalho; os erros voltam em texto curto, sem o corpo.
 */
import { lerLoginDoCodex } from "@mago-os/contratos";
import {
  type AcessoAoProvedor,
  CLIENTE_DO_CODEX,
  ENDERECO_DA_ANTHROPIC,
  enderecoSeguro,
  erroPeloCodigo,
  esperaPedida,
  pedirJson,
  RENOVAR_LOGIN_DO_CHATGPT,
  type Resolver,
  type RespostaJson,
  VERSAO_DA_API_ANTHROPIC,
} from "./provedores.ts";

export interface FerramentaParaModelo {
  nome: string;
  descricao: string;
  /** JSON Schema da entrada (o mesmo do contrato). */
  entrada: unknown;
}

export interface ChamadaDeFerramenta {
  id: string;
  nome: string;
  entrada: unknown;
}

export type ParteDaConversa =
  | { papel: "usuario"; texto: string }
  | { papel: "assistente"; texto: string | null; chamadas: ChamadaDeFerramenta[] }
  | { papel: "resultado"; chamadaId: string; conteudo: string; erro: boolean };

export interface PedidoAoModelo {
  modelo: string;
  sistema: string;
  partes: ParteDaConversa[];
  ferramentas: FerramentaParaModelo[];
  maximoDeTokens?: number;
}

export interface RespostaDoModelo {
  texto: string | null;
  chamadas: ChamadaDeFerramenta[];
  tokens: { entrada: number; saida: number; cache: number };
  /** ChatGPT: o login renovado, que precisa voltar ao cofre. */
  credencialNova?: string;
}

/** Falha do modelo. "limiteAte": o limite do plano acabou (passar ao reserva). */
export class ErroDoModelo extends Error {
  override name = "ErroDoModelo";
  readonly limiteAte: Date | null;
  constructor(mensagem: string, limiteAte: Date | null = null) {
    super(mensagem);
    this.limiteAte = limiteAte;
  }
}

export interface Modelos {
  conversar(acesso: AcessoAoProvedor, pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
}

const MAXIMO_PADRAO = 4096;
const TEMPO_DO_MODELO_MS = 120_000;

function falha(r: Extract<RespostaJson, { ok: false }>, assinatura: boolean): never {
  if (r.status === 429 && assinatura)
    throw new ErroDoModelo(
      "O limite do plano de assinatura acabou por enquanto.",
      new Date(Date.now() + (r.esperarSegundos ?? 3600) * 1000),
    );
  throw new ErroDoModelo(r.erro);
}

/** As partes no formato da Anthropic: resultados seguidos vão juntos numa mensagem do usuário. */
export function partesParaAnthropic(partes: ParteDaConversa[]) {
  const mensagens: { role: "user" | "assistant"; content: unknown[] }[] = [];
  for (const p of partes) {
    if (p.papel === "usuario") mensagens.push({ role: "user", content: [{ type: "text", text: p.texto }] });
    else if (p.papel === "assistente")
      mensagens.push({
        role: "assistant",
        content: [
          ...(p.texto ? [{ type: "text", text: p.texto }] : []),
          ...p.chamadas.map((c) => ({ type: "tool_use", id: c.id, name: c.nome, input: c.entrada })),
        ],
      });
    else {
      const bloco = { type: "tool_result", tool_use_id: p.chamadaId, content: p.conteudo, is_error: p.erro };
      const ultima = mensagens.at(-1);
      if (ultima?.role === "user" && (ultima.content[0] as { type?: string })?.type === "tool_result")
        ultima.content.push(bloco);
      else mensagens.push({ role: "user", content: [bloco] });
    }
  }
  return mensagens;
}

async function conversarAnthropic(a: AcessoAoProvedor, p: PedidoAoModelo): Promise<RespostaDoModelo> {
  const assinatura = a.credencial === "assinatura";
  const r = await pedirJson(
    `${ENDERECO_DA_ANTHROPIC}/messages`,
    {
      "anthropic-version": VERSAO_DA_API_ANTHROPIC,
      ...(assinatura
        ? { authorization: `Bearer ${a.chave}`, "anthropic-beta": "oauth-2025-04-20" }
        : { "x-api-key": a.chave }),
    },
    {
      model: p.modelo,
      max_tokens: p.maximoDeTokens ?? MAXIMO_PADRAO,
      system: p.sistema,
      messages: partesParaAnthropic(p.partes),
      tools: p.ferramentas.map((f) => ({ name: f.nome, description: f.descricao, input_schema: f.entrada })),
    },
    TEMPO_DO_MODELO_MS,
  );
  if (!r.ok) falha(r, assinatura);
  const corpo = r.corpo as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };
  const blocos = corpo.content ?? [];
  const texto = blocos
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
  return {
    texto: texto || null,
    chamadas: blocos
      .filter((b) => b.type === "tool_use" && b.id && b.name)
      .map((b) => ({ id: b.id as string, nome: b.name as string, entrada: b.input ?? {} })),
    tokens: {
      entrada: corpo.usage?.input_tokens ?? 0,
      saida: corpo.usage?.output_tokens ?? 0,
      cache: corpo.usage?.cache_read_input_tokens ?? 0,
    },
  };
}

/** As partes no formato da OpenAI (chat/completions). */
export function partesParaOpenAi(sistema: string, partes: ParteDaConversa[]) {
  return [
    { role: "system", content: sistema },
    ...partes.map((p) =>
      p.papel === "usuario"
        ? { role: "user", content: p.texto }
        : p.papel === "assistente"
          ? {
              role: "assistant",
              content: p.texto,
              ...(p.chamadas.length > 0
                ? {
                    tool_calls: p.chamadas.map((c) => ({
                      id: c.id,
                      type: "function",
                      function: { name: c.nome, arguments: JSON.stringify(c.entrada) },
                    })),
                  }
                : {}),
            }
          : { role: "tool", tool_call_id: p.chamadaId, content: p.conteudo },
    ),
  ];
}

function lerArgumentos(texto: unknown): unknown {
  if (typeof texto !== "string") return texto ?? {};
  try {
    return JSON.parse(texto);
  } catch {
    // O modelo mandou algo que não é JSON: a ferramenta recusa pela conferência da entrada.
    return { argumentosInvalidos: texto.slice(0, 200) };
  }
}

async function conversarCompativel(a: AcessoAoProvedor, p: PedidoAoModelo): Promise<RespostaDoModelo> {
  const r = await pedirJson(
    `${(a.endereco ?? "").replace(/\/+$/, "")}/chat/completions`,
    { authorization: `Bearer ${a.chave}` },
    {
      model: p.modelo,
      max_tokens: p.maximoDeTokens ?? MAXIMO_PADRAO,
      messages: partesParaOpenAi(p.sistema, p.partes),
      tools: p.ferramentas.map((f) => ({
        type: "function",
        function: { name: f.nome, description: f.descricao, parameters: f.entrada },
      })),
    },
    TEMPO_DO_MODELO_MS,
  );
  if (!r.ok) falha(r, false);
  const corpo = r.corpo as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
      };
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const m = corpo.choices?.[0]?.message;
  return {
    texto: m?.content || null,
    chamadas: (m?.tool_calls ?? [])
      .filter((c) => c.id && c.function?.name)
      .map((c) => ({
        id: c.id as string,
        nome: c.function?.name as string,
        entrada: lerArgumentos(c.function?.arguments),
      })),
    tokens: {
      entrada: corpo.usage?.prompt_tokens ?? 0,
      saida: corpo.usage?.completion_tokens ?? 0,
      cache: 0,
    },
  };
}

const RESPOSTAS_DO_CODEX = "https://chatgpt.com/backend-api/codex/responses";
/** O acesso do login do Codex dura pouco: renova antes de 50 minutos. */
const RENOVAR_DEPOIS_MS = 50 * 60_000;

/** As partes no formato da API de respostas (Codex). */
export function partesParaRespostas(partes: ParteDaConversa[]): Record<string, unknown>[] {
  return partes.flatMap((p): Record<string, unknown>[] => {
    if (p.papel === "usuario") return [{ role: "user", content: [{ type: "input_text", text: p.texto }] }];
    if (p.papel === "assistente")
      return [
        ...(p.texto ? [{ role: "assistant", content: [{ type: "output_text", text: p.texto }] }] : []),
        ...p.chamadas.map((c) => ({
          type: "function_call",
          call_id: c.id,
          name: c.nome,
          arguments: JSON.stringify(c.entrada),
        })),
      ];
    return [{ type: "function_call_output", call_id: p.chamadaId, output: p.conteudo }];
  });
}

/** Lê o fluxo de eventos (SSE) da API de respostas e devolve a resposta final. */
export async function respostaDoFluxo(texto: string): Promise<unknown> {
  let final: unknown = null;
  for (const linha of texto.split("\n")) {
    if (!linha.startsWith("data:")) continue;
    const dado = linha.slice(5).trim();
    if (!dado || dado === "[DONE]") continue;
    try {
      const evento = JSON.parse(dado) as { type?: string; response?: unknown };
      if (evento.type === "response.completed" || evento.type === "response.done") final = evento.response;
    } catch {
      // linha incompleta: ignora
    }
  }
  return final;
}

async function conversarChatGpt(a: AcessoAoProvedor, p: PedidoAoModelo): Promise<RespostaDoModelo> {
  const login = lerLoginDoCodex(a.chave);
  if (!login) throw new ErroDoModelo("O login do Codex guardado não está no formato do auth.json.");
  let credencialNova: string | undefined;
  let acesso = login.tokens.access_token;
  const ultima = login.last_refresh ? Date.parse(login.last_refresh) : 0;
  if (!acesso || !(Date.now() - ultima < RENOVAR_DEPOIS_MS)) {
    const r = await pedirJson(
      RENOVAR_LOGIN_DO_CHATGPT,
      {},
      {
        client_id: CLIENTE_DO_CODEX,
        grant_type: "refresh_token",
        refresh_token: login.tokens.refresh_token,
        scope: "openid profile email",
      },
    );
    if (!r.ok) throw new ErroDoModelo("O ChatGPT recusou o login. Cole o auth.json novo na conta de IA.");
    const novo = r.corpo as { access_token?: unknown; refresh_token?: unknown; id_token?: unknown };
    if (typeof novo.access_token !== "string") throw new ErroDoModelo("O ChatGPT não devolveu o acesso.");
    acesso = novo.access_token;
    credencialNova = JSON.stringify({
      ...login,
      tokens: {
        ...login.tokens,
        access_token: novo.access_token,
        ...(typeof novo.refresh_token === "string" ? { refresh_token: novo.refresh_token } : {}),
        ...(typeof novo.id_token === "string" ? { id_token: novo.id_token } : {}),
      },
      last_refresh: new Date().toISOString(),
    });
  }
  let resposta: Response;
  try {
    resposta = await fetch(RESPOSTAS_DO_CODEX, {
      method: "POST",
      headers: {
        authorization: `Bearer ${acesso}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "OpenAI-Beta": "responses=experimental",
        ...(login.tokens.account_id ? { "chatgpt-account-id": login.tokens.account_id } : {}),
      },
      body: JSON.stringify({
        model: p.modelo,
        instructions: p.sistema,
        input: partesParaRespostas(p.partes),
        tools: p.ferramentas.map((f) => ({
          type: "function",
          name: f.nome,
          description: f.descricao,
          parameters: f.entrada,
        })),
        stream: true,
        store: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(TEMPO_DO_MODELO_MS),
    });
  } catch {
    throw new ErroDoModelo("Não foi possível conectar ao ChatGPT.");
  }
  if (!resposta.ok) {
    await resposta.body?.cancel();
    falha(
      {
        ok: false,
        erro: erroPeloCodigo(resposta.status),
        status: resposta.status,
        ...(esperaPedida(resposta.headers.get("retry-after")) !== undefined
          ? { esperarSegundos: esperaPedida(resposta.headers.get("retry-after")) as number }
          : {}),
      },
      true,
    );
  }
  const final = (await respostaDoFluxo(await resposta.text())) as {
    output?: {
      type?: string;
      content?: { type?: string; text?: string }[];
      call_id?: string;
      name?: string;
      arguments?: unknown;
    }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  } | null;
  if (!final) throw new ErroDoModelo("O ChatGPT não terminou a resposta.");
  const itens = final.output ?? [];
  const texto = itens
    .filter((i) => i.type === "message")
    .flatMap((i) => i.content ?? [])
    .filter((c) => c.type === "output_text" && c.text)
    .map((c) => c.text)
    .join("\n");
  return {
    texto: texto || null,
    chamadas: itens
      .filter((i) => i.type === "function_call" && i.call_id && i.name)
      .map((i) => ({ id: i.call_id as string, nome: i.name as string, entrada: lerArgumentos(i.arguments) })),
    tokens: { entrada: final.usage?.input_tokens ?? 0, saida: final.usage?.output_tokens ?? 0, cache: 0 },
    ...(credencialNova ? { credencialNova } : {}),
  };
}

export function modelosDeVerdade(ambiente: "local" | "teste" | "producao", resolver?: Resolver): Modelos {
  return {
    async conversar(a, p) {
      if (a.provedor === "anthropic") return conversarAnthropic(a, p);
      if (a.provedor === "chatgpt") return conversarChatGpt(a, p);
      if (!(await enderecoSeguro(a.endereco ?? "", ambiente, resolver)))
        throw new ErroDoModelo("O endereço aponta para uma rede interna ou não existe.");
      return conversarCompativel(a, p);
    },
  };
}

/**
 * Modelo falso para os testes (sem custo, sem rede): segue um roteiro. Cada passo recebe o pedido e devolve a
 * resposta (texto e ferramentas a chamar), ou lança ErroDoModelo para simular falha.
 */
export function modelosFalsos(
  roteiro: ((pedido: PedidoAoModelo, acesso: AcessoAoProvedor) => Partial<RespostaDoModelo>)[],
): Modelos & { pedidos: PedidoAoModelo[]; acessos: AcessoAoProvedor[] } {
  const falso = {
    pedidos: [] as PedidoAoModelo[],
    acessos: [] as AcessoAoProvedor[],
    async conversar(a: AcessoAoProvedor, p: PedidoAoModelo): Promise<RespostaDoModelo> {
      falso.pedidos.push(structuredClone(p));
      falso.acessos.push(a);
      const passo = roteiro.shift();
      if (!passo) return { texto: "Pronto.", chamadas: [], tokens: { entrada: 1, saida: 1, cache: 0 } };
      const r = passo(p, a);
      return {
        texto: r.texto ?? null,
        chamadas: r.chamadas ?? [],
        tokens: r.tokens ?? { entrada: 10, saida: 5, cache: 0 },
      };
    },
  };
  return falso;
}
