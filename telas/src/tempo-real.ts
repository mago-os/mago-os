/**
 * Tempo real na tela (M2-06): uma conexão WebSocket por aba com /api/tempo-real, dividida por todas as telas.
 *
 * O aviso diz só "a tarefa X mudou"; quem ouve busca de novo pela rota normal. Se a internet cai ou o celular volta
 * do segundo plano, reconecta sozinho e avisa "reconectou", para cada tela buscar o que mudou no meio tempo.
 */
import { useEffect, useRef } from "react";

export type AvisoDeMudanca =
  | { tipo: "tarefa" | "agente" | "projeto"; id: string; operacao: "insert" | "update" | "delete" }
  | { tipo: "reconectou" };

type Ouvinte = (aviso: AvisoDeMudanca) => void;

const ouvintes = new Set<Ouvinte>();
let socket: WebSocket | null = null;
let tentativas = 0;
let jaConectou = false;
let espera: ReturnType<typeof setTimeout> | null = null;
let escondidaDesde: number | null = null;

function avisar(aviso: AvisoDeMudanca) {
  for (const o of ouvintes) o(aviso);
}

function conectar() {
  if (ouvintes.size === 0) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const protocolo = window.location.protocol === "https:" ? "wss" : "ws";
  const novo = new WebSocket(`${protocolo}://${window.location.host}/api/tempo-real`);
  socket = novo;
  novo.onopen = () => {
    tentativas = 0;
    // Depois de uma queda, avisos podem ter se perdido: cada tela busca de novo.
    if (jaConectou) avisar({ tipo: "reconectou" });
    jaConectou = true;
  };
  novo.onmessage = (evento) => {
    try {
      avisar(JSON.parse(String(evento.data)) as AvisoDeMudanca);
    } catch {
      // Mensagem fora do formato: ignora.
    }
  };
  novo.onclose = (evento) => {
    if (socket === novo) socket = null;
    // 4401: a sessão acabou ou trocou de empresa. Se acabou, a casca manda para a tela de entrar; se não, tenta de
    // novo com calma (espera longa), sem martelar a API.
    if (evento.code === 4401) tentativas = Math.max(tentativas, 5);
    agendar();
  };
}

function agendar() {
  if (espera || ouvintes.size === 0) return;
  tentativas += 1;
  espera = setTimeout(
    () => {
      espera = null;
      conectar();
    },
    Math.min(30_000, 1000 * 2 ** Math.min(tentativas - 1, 5)),
  );
}

// Voltou do segundo plano ou a internet voltou: reconecta na hora, sem esperar a próxima tentativa.
function voltar() {
  if (document.visibilityState !== "visible") {
    escondidaDesde ??= Date.now();
    return;
  }
  // Depois de um tempo no segundo plano, a conexão pode ter morrido sem o navegador perceber: abre outra.
  const ficouLonge = escondidaDesde !== null && Date.now() - escondidaDesde > 20_000;
  escondidaDesde = null;
  if (ficouLonge && socket) {
    const velho = socket;
    socket = null;
    velho.onclose = null;
    velho.close(1000, "voltou do segundo plano");
  }
  if (espera) {
    clearTimeout(espera);
    espera = null;
  }
  conectar();
}
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", voltar);
  window.addEventListener("online", voltar);
}

/** Ouve os avisos enquanto a tela estiver aberta. O ouvinte mais recente é sempre o usado. */
export function useTempoReal(aoAvisar: Ouvinte) {
  const atual = useRef(aoAvisar);
  atual.current = aoAvisar;
  useEffect(() => {
    const ouvinte: Ouvinte = (a) => atual.current(a);
    ouvintes.add(ouvinte);
    conectar();
    return () => {
      ouvintes.delete(ouvinte);
      if (ouvintes.size === 0 && socket) {
        socket.close(1000, "sem telas ouvindo");
        socket = null;
        jaConectou = false;
      }
    };
  }, []);
}
