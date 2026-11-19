/**
 * Conversa da tela com as rotas de espaços e projetos (M3-01). Os formatos vêm dos contratos.
 */
import type {
  Espaco,
  PedidoDeEditarEspaco,
  PedidoDeEditarProjeto,
  PedidoDeEspaco,
  PedidoDeProjeto,
  Projeto,
} from "@mago-os/contratos";
import { pedir } from "./tarefas";

export interface ListaDeProjetos {
  projetos: Projeto[];
  /** Tarefas abertas de cada projeto. */
  abertas: Record<string, number>;
  nomes: Record<string, string>;
}

export interface ProjetoAberto {
  projeto: Projeto;
  espaco: Espaco | null;
  nomes: Record<string, string>;
}

export const listarEspacos = (arquivados = false) =>
  pedir<{ espacos: Espaco[] }>("GET", `/espacos${arquivados ? "?arquivados=1" : ""}`);

export const criarEspaco = (dados: PedidoDeEspaco) => pedir<Espaco>("POST", "/espacos", dados);

export const editarEspaco = (id: string, dados: PedidoDeEditarEspaco) =>
  pedir<Espaco>("POST", `/espacos/${encodeURIComponent(id)}`, dados);

export function listarProjetos(filtro: { espacoId?: string; arquivados?: boolean } = {}) {
  const q = new URLSearchParams();
  if (filtro.espacoId) q.set("espaco", filtro.espacoId);
  if (filtro.arquivados) q.set("arquivados", "1");
  return pedir<ListaDeProjetos>("GET", `/projetos?${q}`);
}

export const abrirProjeto = (id: string) =>
  pedir<ProjetoAberto>("GET", `/projetos/${encodeURIComponent(id)}`);

export const criarProjeto = (dados: PedidoDeProjeto) => pedir<Projeto>("POST", "/projetos", dados);

export const editarProjeto = (id: string, dados: PedidoDeEditarProjeto) =>
  pedir<Projeto>("POST", `/projetos/${encodeURIComponent(id)}`, dados);

export const excluirProjeto = (id: string) =>
  pedir<{ ok: true }>("DELETE", `/projetos/${encodeURIComponent(id)}`);
