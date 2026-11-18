/**
 * Conversa da tela com a Central de agentes (M2-03). Os formatos vêm dos contratos.
 */
import type { Agente } from "@mago-os/contratos";
import { pedir } from "./tarefas";

export interface AgenteNaLista extends Agente {
  responsavelNome: string;
  tarefasAbertas: number;
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
