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

const NOME_DA_ESPECIALIDADE: Record<NonNullable<Agente["especialidade"]>, string> = {
  gerente_de_projetos: "Gerente de projetos",
};

/**
 * O tipo do agente para mostrar na lista (pedido do Sandro no teste do M7, 27/11/2026): externo, coordenador ou
 * especialista com a especialidade e, se souber, a quem responde.
 */
export function tipoDoAgente(
  a: Pick<Agente, "tipo" | "papel" | "especialidade">,
  respondeA?: string | null,
): string {
  if (a.tipo === "externo") return "Externo";
  if (a.papel === "coordenador") return "Coordenador";
  const partes = ["Especialista"];
  if (a.especialidade) partes.push(NOME_DA_ESPECIALIDADE[a.especialidade]);
  if (respondeA) partes.push(`responde a ${respondeA}`);
  return partes.join(" · ");
}

export const listarAgentes = () => pedir<AgenteNaLista[]>("GET", "/agentes");
export const verAgente = (id: string) => pedir<AgenteNaLista>("GET", `/agentes/${encodeURIComponent(id)}`);

export interface DadosDoAgente {
  nome: string;
  descricao: string | null;
  ondeRoda: string | null;
  responsavelId: string;
  minutosSemSinal: number;
  /** Só na edição do agente externo (M7-02): por onde a chave dele entra. */
  canais?: "mcp" | "api" | "os_dois";
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
/** Os avisos de todas as empresas da pessoa (M7-05), com o nome de cada uma. */
export const listarAvisosDeTodas = () =>
  pedir<{ avisos: { aviso: Aviso; empresaNome: string }[] }>("GET", "/conta/avisos");

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
