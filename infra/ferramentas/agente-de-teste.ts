/**
 * Agente de teste genérico (M2-07): faz pelo MCP o mesmo ciclo que o Hermes (ou qualquer agente externo) vai fazer,
 * e serve de modelo e de teste para ligar um agente novo.
 *
 * A cada minuto: pergunta as tarefas (minhas_tarefas), pega a mais antiga em A fazer, comenta que começou e entrega
 * um resultado simples. Se der errado no meio, solta a tarefa com o motivo. Ver docs/operacao/agentes.md.
 *
 * Uso (a chave vem do ambiente, nunca da linha de comando nem de arquivo versionado):
 *   MAGO_MCP_URL=https://teste.osmago.com/mcp MAGO_AGENTE_CHAVE=mago_ag_... node infra/ferramentas/agente-de-teste.ts
 *   ... node infra/ferramentas/agente-de-teste.ts --uma-vez     (uma volta só, para testar)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface TarefaResumida {
  id: string;
  titulo: string;
  status: string;
  descricao: string | null;
  criadaEm: string;
}

interface Resposta {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
}

export interface OpcoesDoAgente {
  url: string;
  chave: string;
  /** O trabalho de verdade. O padrão só confirma que recebeu a tarefa. */
  trabalhar?: (tarefa: TarefaResumida) => Promise<string>;
  registrar?: (texto: string) => void;
}

async function conectar(url: string, chave: string): Promise<Client> {
  const cliente = new Client({ name: "agente-de-teste", version: "1.0.0" });
  await cliente.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${chave}` } },
    }),
  );
  return cliente;
}

async function chamar(cliente: Client, nome: string, args: Record<string, unknown> = {}): Promise<Resposta> {
  const r = (await cliente.callTool({ name: nome, arguments: args })) as Resposta;
  if (r.isError) throw new Error(`${nome}: ${r.content?.[0]?.text ?? "erro"}`);
  return r;
}

/** Uma volta do ciclo. Devolve o id da tarefa feita, ou nulo se não havia nada a fazer. */
export async function umaVolta(o: OpcoesDoAgente): Promise<string | null> {
  const registrar = o.registrar ?? ((t: string) => console.log(`[${new Date().toISOString()}] ${t}`));
  const trabalhar =
    o.trabalhar ??
    (async (t: TarefaResumida) =>
      `Agente de teste: recebi a tarefa "${t.titulo}" e confirmo que o caminho pelo MCP funciona (pegar, comentar e entregar).`);
  const cliente = await conectar(o.url, o.chave);
  try {
    const lista = await chamar(cliente, "minhas_tarefas", { status: ["a_fazer"] });
    const tarefas = ((lista.structuredContent?.tarefas ?? []) as TarefaResumida[]).sort((a, b) =>
      a.criadaEm.localeCompare(b.criadaEm),
    );
    const proxima = tarefas[0];
    if (!proxima) {
      registrar("Nenhuma tarefa em A fazer.");
      return null;
    }
    registrar(`Pegando: ${proxima.titulo}`);
    await chamar(cliente, "pegar_tarefa", { tarefaId: proxima.id });
    try {
      await chamar(cliente, "comentar", { tarefaId: proxima.id, texto: "Comecei a tarefa." });
      const resultado = await trabalhar(proxima);
      await chamar(cliente, "entregar_resultado", { tarefaId: proxima.id, resultado });
      registrar(`Entregue: ${proxima.titulo}`);
      return proxima.id;
    } catch (erro) {
      // Não soube fazer: devolve para a pessoa responsável, com o motivo.
      const motivo = `Não consegui concluir: ${(erro as Error).message}`.slice(0, 1000);
      await chamar(cliente, "soltar_tarefa", { tarefaId: proxima.id, motivo }).catch(() => {});
      registrar(`Solta: ${proxima.titulo} (${motivo})`);
      throw erro;
    }
  } finally {
    await cliente.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MAGO_MCP_URL ?? "https://teste.osmago.com/mcp";
  const chave = process.env.MAGO_AGENTE_CHAVE;
  if (!chave) {
    console.error("Informe a chave em MAGO_AGENTE_CHAVE (variável de ambiente).");
    process.exit(1);
  }
  const volta = async () => {
    try {
      await umaVolta({ url, chave });
    } catch (erro) {
      console.error(`[${new Date().toISOString()}] ${(erro as Error).message}`);
    }
  };
  await volta();
  if (!process.argv.includes("--uma-vez")) setInterval(() => void volta(), 60_000);
}
