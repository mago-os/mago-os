/**
 * Sino das notificações (M3-06): contador no topo, lista dos avisos não lidos e um aviso rápido no canto quando chega
 * algo com o sistema aberto (pelo tempo real).
 */
import type { Aviso } from "@mago-os/contratos";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { listarMeusAvisos, marcarAvisoComoLido, marcarTodosComoLidos } from "@/agentes";
import { useTempoReal } from "@/tempo-real";
import { Button } from "./ui/button";

export function Sino() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [aberto, setAberto] = useState(false);
  const [rapido, setRapido] = useState<Aviso | null>(null);
  const conhecidos = useRef<Set<string> | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarMeusAvisos();
    if (!r.ok || !r.dados) return;
    const lista = r.dados;
    // Aviso que chegou com a tela aberta aparece rapidinho no canto.
    if (conhecidos.current) {
      const novo = lista.find((a) => !conhecidos.current?.has(a.id));
      if (novo) {
        setRapido(novo);
        if (relogio.current) clearTimeout(relogio.current);
        relogio.current = setTimeout(() => setRapido(null), 6000);
      }
    }
    conhecidos.current = new Set(lista.map((a) => a.id));
    setAvisos(lista);
  }, []);
  useEffect(() => {
    void carregar();
    return () => {
      if (relogio.current) clearTimeout(relogio.current);
    };
  }, [carregar]);
  useTempoReal((aviso) => {
    if (aviso.tipo === "aviso" || aviso.tipo === "reconectou") void carregar();
  });

  async function abrirAviso(a: Aviso) {
    await marcarAvisoComoLido(a.id);
    window.location.assign(a.link);
  }

  async function todosLidos() {
    await marcarTodosComoLidos();
    setAvisos([]);
    setAberto(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={avisos.length > 0 ? `Notificações: ${avisos.length} não lidas` : "Notificações"}
        aria-expanded={aberto}
        onClick={() => setAberto((x) => !x)}
        className="relative grid size-9 place-items-center rounded-full hover:bg-suave"
      >
        <Bell className="size-5" />
        {avisos.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-perigo px-1 text-[10px] font-bold text-white">
            {avisos.length > 9 ? "9+" : avisos.length}
          </span>
        )}
      </button>
      {aberto && (
        <div
          role="dialog"
          aria-label="Notificações"
          className="absolute right-0 z-30 mt-2 grid w-80 max-w-[90vw] gap-1 rounded-lg border border-linha bg-cartao p-2 shadow-xl"
        >
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-sm font-semibold">Notificações</span>
            {avisos.length > 0 && (
              <Button variant="fantasma" size="pequeno" onClick={() => void todosLidos()}>
                Marcar todas como lidas
              </Button>
            )}
          </div>
          {avisos.length === 0 && <p className="px-1 py-3 text-sm text-texto-2">Nada novo por aqui.</p>}
          <ul className="grid max-h-96 gap-1 overflow-y-auto">
            {avisos.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => void abrirAviso(a)}
                  className="grid w-full gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-suave"
                >
                  <span className="text-pretty">{a.texto}</span>
                  <span className="text-xs text-texto-2">
                    {new Date(a.criadoEm).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rapido && !aberto && (
        <output className="fixed right-4 bottom-24 z-40 max-w-sm rounded-lg border border-linha bg-cartao p-3 text-sm shadow-xl md:bottom-6">
          <a href={rapido.link} className="block text-pretty hover:underline">
            {rapido.texto}
          </a>
        </output>
      )}
    </div>
  );
}
