/**
 * Conversa da tela com as rotas de tarefas (M2-01). Os formatos vêm dos contratos.
 */
import type { ComentarioDeTarefa, Responsavel, StatusTarefa, Tarefa } from "@mago-os/contratos";

export interface Resposta<T> {
  ok: boolean;
  dados?: T;
  mensagem?: string;
}

const SEM_CONEXAO = "Sem conexão com o Mago OS. Confira a internet e tente de novo.";
const PADRAO = "Não foi possível concluir agora. Tente de novo em instantes.";

export async function pedir<T>(
  metodo: "GET" | "POST" | "DELETE",
  caminho: string,
  corpo?: unknown,
): Promise<Resposta<T>> {
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
    if (r.status === 400 && !dados?.message)
      return { ok: false, mensagem: "Confira os campos e tente de novo." };
    return { ok: false, mensagem: dados?.message ?? PADRAO };
  } catch {
    return { ok: false, mensagem: SEM_CONEXAO };
  }
}

export interface ListaDeTarefas {
  tarefas: Tarefa[];
  nomes: Record<string, string>;
}

export interface TarefaAberta extends ListaDeTarefas {
  tarefa: Tarefa;
  comentarios: ComentarioDeTarefa[];
}

export function listarTarefas(filtro: { minhas: boolean; status: StatusTarefa[] }) {
  const q = new URLSearchParams();
  if (filtro.minhas) q.set("minhas", "1");
  if (filtro.status.length > 0) q.set("status", filtro.status.join(","));
  return pedir<ListaDeTarefas>("GET", `/tarefas?${q}`);
}

export const abrirTarefa = (id: string) =>
  pedir<Omit<TarefaAberta, "tarefas">>("GET", `/tarefas/${encodeURIComponent(id)}`);

export const criarTarefa = (dados: {
  titulo: string;
  descricao: string | null;
  responsavel?: Responsavel | null;
}) => pedir<Tarefa>("POST", "/tarefas", dados);

export const mudarStatus = (
  id: string,
  status: StatusTarefa,
  extra: { resultado?: string; motivo?: string } = {},
) => pedir<Tarefa>("POST", `/tarefas/${encodeURIComponent(id)}/status`, { status, ...extra });

export const trocarResponsavel = (id: string, responsavel: Responsavel | null) =>
  pedir<Tarefa>("POST", `/tarefas/${encodeURIComponent(id)}/responsavel`, { responsavel });

export const comentarTarefa = (id: string, texto: string) =>
  pedir<ComentarioDeTarefa>("POST", `/tarefas/${encodeURIComponent(id)}/comentarios`, { texto });

export const excluirTarefa = (id: string) =>
  pedir<{ ok: true }>("DELETE", `/tarefas/${encodeURIComponent(id)}`);

/** Pegar, soltar ou (administrador) destravar a tarefa (M2-02). Destravar pede o motivo. */
export const acaoNaTrava = (id: string, acao: "pegar" | "soltar" | "destravar", motivo?: string) =>
  pedir<Tarefa>(
    "POST",
    `/tarefas/${encodeURIComponent(id)}/${acao}`,
    acao === "destravar" ? { motivo } : undefined,
  );
