/**
 * Plano de assinatura da Anthropic pelo Claude Code oficial (M4-10, decisão 0024).
 *
 * A Anthropic só aceita o token do plano (claude setup-token) no próprio Claude Code: chamada direta à API com ele
 * é recusada. Então, para uma conta "assinatura" da Anthropic, o agente interno roda dentro do Claude Code, pelo
 * Claude Agent SDK, do mesmo jeito que a Ratoeira faz: o token vai na variável CLAUDE_CODE_OAUTH_TOKEN, as
 * ferramentas do Claude Code ficam desligadas e as únicas ferramentas são as do Mago OS (um servidor MCP dentro do
 * próprio processo). O Claude Code roda o laço das rodadas; cada ferramenta volta para o núcleo, com as mesmas
 * regras de sempre.
 *
 * Nada fica guardado no servidor: cada execução usa uma pasta temporária, apagada no fim.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ErroDoModelo, type FerramentaParaModelo } from "./conversa.ts";

export interface PedidoAoClaudeCode {
  token: string;
  modelo: string;
  sistema: string;
  /** O pedido (a conversa ou a tarefa), em texto. */
  prompt: string;
  ferramentas: FerramentaParaModelo[];
  /** Executa uma ferramenta do Mago OS e devolve o texto para o modelo. */
  executar(nome: string, entrada: unknown): Promise<{ texto: string; erro: boolean }>;
  maximoDeRodadas: number;
  tempoMaximoMs: number;
}

export interface ResultadoDoClaudeCode {
  /** O texto final do modelo (quando ele termina sem chamar responder). */
  texto: string | null;
  tokens: { entrada: number; saida: number; cache: number };
}

export type RodarClaudeCode = (p: PedidoAoClaudeCode) => Promise<ResultadoDoClaudeCode>;

const NOME_DO_SERVIDOR = "mago";

/** O servidor MCP com as ferramentas do Mago OS, dentro do próprio processo. */
function servidorDasFerramentas(p: PedidoAoClaudeCode): McpServer {
  const mcp = new McpServer({ name: "mago-os", version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: p.ferramentas.map((f) => ({
      name: f.nome,
      description: f.descricao,
      inputSchema: f.entrada as { type: "object" },
    })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (chamada) => {
    const r = await p.executar(chamada.params.name, chamada.params.arguments ?? {});
    return { content: [{ type: "text" as const, text: r.texto }], isError: r.erro };
  });
  return mcp;
}

/** O motivo de uma execução que terminou com erro, em texto curto (sem token). */
function motivoDoResultado(m: { subtype?: string; errors?: unknown; result?: unknown }): string {
  const detalhe = Array.isArray(m.errors)
    ? m.errors.join("; ")
    : typeof m.result === "string"
      ? m.result
      : "";
  const limpo = detalhe
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[chave]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (m.subtype === "error_max_turns") return "Passou do limite de rodadas da execução.";
  return limpo ? `O Claude Code não concluiu: ${limpo}` : "O Claude Code não concluiu.";
}

export const rodarPeloClaudeCode: RodarClaudeCode = async (p) => {
  const pasta = await mkdtemp(path.join(tmpdir(), "mago-claude-"));
  const parar = new AbortController();
  const relogio = setTimeout(() => parar.abort(), p.tempoMaximoMs);
  const permitidas = p.ferramentas.map((f) => `mcp__${NOME_DO_SERVIDOR}__${f.nome}`);
  try {
    let texto: string | null = null;
    let tokens = { entrada: 0, saida: 0, cache: 0 };
    const conversa = query({
      prompt: p.prompt,
      options: {
        model: p.modelo,
        systemPrompt: { type: "custom", prompt: p.sistema },
        // Nenhuma ferramenta do Claude Code (arquivos, terminal, internet): só as do Mago OS.
        tools: [],
        mcpServers: {
          [NOME_DO_SERVIDOR]: { type: "sdk", name: NOME_DO_SERVIDOR, instance: servidorDasFerramentas(p) },
        },
        allowedTools: permitidas,
        // O que não está na lista é negado sem perguntar (não há ninguém para responder).
        permissionMode: "dontAsk",
        maxTurns: p.maximoDeRodadas,
        cwd: pasta,
        settingSources: [],
        persistSession: false,
        abortController: parar,
        // O ambiente do processo do Claude Code é só este (não herda as variáveis da API, como as senhas do banco).
        env: {
          PATH: process.env.PATH,
          HOME: pasta,
          CLAUDE_CONFIG_DIR: path.join(pasta, ".claude"),
          CLAUDE_CODE_OAUTH_TOKEN: p.token,
          CLAUDE_AGENT_SDK_CLIENT_APP: "mago-os",
          DISABLE_AUTOUPDATER: "1",
          DISABLE_TELEMETRY: "1",
        },
      },
    });
    for await (const m of conversa) {
      if (m.type !== "result") continue;
      const uso = (
        m as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } }
      ).usage;
      tokens = {
        entrada: uso?.input_tokens ?? 0,
        saida: uso?.output_tokens ?? 0,
        cache: uso?.cache_read_input_tokens ?? 0,
      };
      if (m.subtype === "success" && !(m as { is_error?: boolean }).is_error) {
        texto = typeof m.result === "string" && m.result.trim() ? m.result.trim() : null;
      } else {
        throw new ErroDoModelo(motivoDoResultado(m as never));
      }
    }
    return { texto, tokens };
  } catch (erro) {
    if (erro instanceof ErroDoModelo) throw erro;
    if (parar.signal.aborted) throw new ErroDoModelo("Passou do tempo máximo da execução.");
    const mensagem = erro instanceof Error ? erro.message.replace(/sk-[A-Za-z0-9_-]{6,}/g, "[chave]") : "";
    throw new ErroDoModelo(`O Claude Code não concluiu: ${mensagem.slice(0, 200) || "erro desconhecido"}`);
  } finally {
    clearTimeout(relogio);
    await rm(pasta, { recursive: true, force: true }).catch(() => {});
  }
};

/** Teste da conta: uma conversa mínima pelo Claude Code, sem ferramentas. */
export async function testarPeloClaudeCode(
  rodar: RodarClaudeCode,
  token: string,
  modelo: string,
): Promise<string | null> {
  try {
    await rodar({
      token,
      modelo,
      sistema: "Responda apenas: ok",
      prompt: "ok?",
      ferramentas: [],
      executar: async () => ({ texto: "", erro: true }),
      maximoDeRodadas: 1,
      tempoMaximoMs: 60_000,
    });
    return null;
  } catch (erro) {
    return erro instanceof Error ? erro.message : "O Claude Code não concluiu.";
  }
}
