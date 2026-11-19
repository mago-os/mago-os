/**
 * Conversa da tela com a Central de agentes (M2-03). Os formatos vêm dos contratos.
 */
import type {
  Agente,
  Aviso,
  ChaveCriada,
  ChaveDeAgente,
  PedidoDeAssinaturaDePush,
  PreferenciasDeNotificacao,
} from "@mago-os/contratos";
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

/** Chaves do agente (M2-04). A chave inteira vem só na resposta de criar. */
export const listarChaves = (agenteId: string) =>
  pedir<ChaveDeAgente[]>("GET", `/agentes/${encodeURIComponent(agenteId)}/chaves`);
export const criarChave = (agenteId: string, d: { nome: string; validaAte: string | null }) =>
  pedir<ChaveCriada>("POST", `/agentes/${encodeURIComponent(agenteId)}/chaves`, d);
export const revogarChave = (agenteId: string, chaveId: string) =>
  pedir<ChaveDeAgente>(
    "POST",
    `/agentes/${encodeURIComponent(agenteId)}/chaves/${encodeURIComponent(chaveId)}/revogar`,
  );

/** Avisos da própria pessoa (agente sem sinal, passou do limite, desligado). */
export const listarMeusAvisos = () => pedir<Aviso[]>("GET", "/avisos");

/** Notificações (M3-06): marcar todos como lidos, push neste aparelho e preferências. */
export const marcarTodosComoLidos = () => pedir<{ ok: true }>("POST", "/avisos/lidos");
export const lerNotificacoes = () =>
  pedir<{ chavePublica: string | null; pushNesteAparelho: boolean; preferencias: PreferenciasDeNotificacao }>(
    "GET",
    "/notificacoes",
  );
export const ligarPush = (dados: PedidoDeAssinaturaDePush) =>
  pedir<{ ok: true }>("POST", "/notificacoes/push", dados);
export const desligarPush = () => pedir<{ ok: true }>("DELETE", "/notificacoes/push");
export const salvarPreferenciasDeNotificacao = (p: PreferenciasDeNotificacao) =>
  pedir<PreferenciasDeNotificacao>("POST", "/notificacoes/preferencias", p);
export const marcarAvisoComoLido = (id: string) =>
  pedir<{ ok: true }>("POST", `/avisos/${encodeURIComponent(id)}/lido`);
