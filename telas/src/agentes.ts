/**
 * Conversa da tela com a Central de agentes (M2-03). Os formatos vêm dos contratos.
 */
import type { Agente } from "@mago-os/contratos";
import type { Resposta } from "./tarefas";

export interface AgenteNaLista extends Agente {
  responsavelNome: string;
  tarefasAbertas: number;
}

async function pedir<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  try {
    const r = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: "same-origin",
      ...(corpo === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) }),
    });
    const dados = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
    if (r.ok) return { ok: true, dados: dados as T };
    return { ok: false, mensagem: dados?.message ?? "Confira os campos e tente de novo." };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o Mago OS. Confira a internet e tente de novo." };
  }
}

export const listarAgentes = () => pedir<AgenteNaLista[]>("GET", "/agentes");
export const verAgente = (id: string) => pedir<AgenteNaLista>("GET", `/agentes/${encodeURIComponent(id)}`);

export interface DadosDoAgente {
  nome: string;
  descricao: string | null;
  ondeRoda: string | null;
  responsavelId: string;
  minutosSemSinal: number;
}

export const cadastrarAgente = (d: DadosDoAgente) => pedir<Agente>("POST", "/agentes", d);
export const editarAgente = (id: string, d: Partial<DadosDoAgente>) =>
  pedir<Agente>("POST", `/agentes/${encodeURIComponent(id)}`, d);
export const acaoNoAgente = (id: string, acao: "pausar" | "retomar" | "desligar") =>
  pedir<Agente>("POST", `/agentes/${encodeURIComponent(id)}/${acao}`);
