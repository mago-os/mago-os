/**
 * Avisos do Mago OS para a pessoa (M2-04): o agente dela ficou sem sinal, passou do limite ou foi desligado.
 * Aparecem no alto da tela até ela marcar como lido. O e-mail vai junto.
 */
import type { Aviso } from "@mago-os/contratos";
import { Bot } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listarMeusAvisos, marcarAvisoComoLido } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { useAoVoltar } from "./Administrador";

export function AvisosDoMago() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const carregar = useCallback(async () => {
    const r = await listarMeusAvisos();
    if (r.ok && r.dados) setAvisos(r.dados.filter((a) => a.tipo.startsWith("agente_")));
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);
  if (avisos.length === 0) return null;

  async function lido(id: string) {
    await marcarAvisoComoLido(id);
    setAvisos((lista) => lista.filter((a) => a.id !== id));
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-2 px-4 pt-4">
      {avisos.map((a) => (
        <div
          key={a.id}
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-cartao border border-alerta/40 bg-cartao p-3 text-sm"
        >
          <Bot className="size-4 shrink-0 text-texto-2" />
          <span className="flex-1">{a.texto}</span>
          <Button size="pequeno" variant="contorno" asChild>
            <a href={a.link}>Ver</a>
          </Button>
          <Button size="pequeno" variant="fantasma" onClick={() => void lido(a.id)}>
            Marcar como lido
          </Button>
        </div>
      ))}
    </div>
  );
}
