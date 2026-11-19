/**
 * Conversa da tela com as rotas de espaços e projetos (M3-01). Os formatos vêm dos contratos.
 */
import type {
  Espaco,
  Lista,
  PedidoDeEditarEspaco,
  PedidoDeEditarProjeto,
  PedidoDeEspaco,
  PedidoDeProjeto,
  PedidoDeStatusDoProjeto,
  Projeto,
  StatusDoProjeto,
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
  listas: Lista[];
  status: StatusDoProjeto[];
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

export const criarLista = (projetoId: string, nome: string) =>
  pedir<Lista>("POST", `/projetos/${encodeURIComponent(projetoId)}/listas`, { nome });

export const editarLista = (id: string, mudanca: { nome?: string; ordem?: number }) =>
  pedir<Lista>("POST", `/listas/${encodeURIComponent(id)}`, mudanca);

export const excluirLista = (id: string) =>
  pedir<{ ok: true; tarefasPara: string }>("DELETE", `/listas/${encodeURIComponent(id)}`);

export const salvarStatus = (projetoId: string, dados: PedidoDeStatusDoProjeto) =>
  pedir<{ status: StatusDoProjeto[] }>("POST", `/projetos/${encodeURIComponent(projetoId)}/status`, dados);
