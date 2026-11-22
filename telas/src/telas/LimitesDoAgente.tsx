/**
 * Limites de cada execução do agente interno (M4-08): rodadas e minutos. O administrador ajusta; os outros veem.
 * O núcleo também para o agente que repete a mesma ação ou que passa a tarefa para lá e para cá.
 */
import {
  LIMITE_PADRAO_DE_MINUTOS,
  LIMITE_PADRAO_DE_RODADAS,
  type LimitesDoAgente as Limites,
  MAXIMO_DE_MINUTOS,
  MAXIMO_DE_RODADAS,
} from "@mago-os/contratos";
import { useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

export function LimitesDoAgente({ agenteId, podeEditar }: { agenteId: string; podeEditar: boolean }) {
  const [limites, setLimites] = useState<Limites | null>(null);
  const [rodadas, setRodadas] = useState("");
  const [minutos, setMinutos] = useState("");
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const caminho = `/agentes/${encodeURIComponent(agenteId)}/limites`;
  const mostrar = (l: Limites) => {
    setLimites(l);
    setRodadas(String(l.rodadas));
    setMinutos(String(l.minutos));
  };
  useEffect(() => {
    void pedir<Limites>("GET", caminho).then((r) => r.ok && r.dados && mostrar(r.dados));
  }, [caminho]);

  async function salvar(padrao: boolean) {
    const r = await pedir<Limites>(
      "POST",
      caminho,
      padrao
        ? { rodadas: null, minutos: null }
        : {
            // O valor igual ao padrão fica como padrão (se o padrão mudar um dia, o agente acompanha).
            rodadas: Number(rodadas) === LIMITE_PADRAO_DE_RODADAS ? null : Number(rodadas),
            minutos: Number(minutos) === LIMITE_PADRAO_DE_MINUTOS ? null : Number(minutos),
          },
    );
    if (!r.ok || !r.dados)
      return setMensagem({ tipo: "erro", texto: r.mensagem || "Confira os números e tente de novo." });
    mostrar(r.dados);
    setMensagem({ tipo: "ok", texto: padrao ? "Limites de volta ao padrão." : "Limites salvos." });
  }

  if (!limites) return null;
  return (
    <Card className="gap-3">
      <CardTitulo>Limites de cada execução</CardTitulo>
      <CardDescricao>
        Passou do limite, o agente para, a tarefa vai para "precisa de ajuda" e o responsável recebe o aviso.
        Ele também para se repetir a mesma ação três vezes seguidas. Padrão: {LIMITE_PADRAO_DE_RODADAS}{" "}
        rodadas e {LIMITE_PADRAO_DE_MINUTOS} minutos.
      </CardDescricao>
      {mensagem && <Aviso {...mensagem} />}
      {podeEditar ? (
        <form
          className="flex flex-wrap items-end gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar(false);
          }}
        >
          <label className="grid gap-1">
            Rodadas
            <input
              type="number"
              required
              min={1}
              max={MAXIMO_DE_RODADAS}
              value={rodadas}
              onChange={(e) => setRodadas(e.target.value)}
              className="h-9 w-24 rounded-md border border-linha bg-cartao px-2"
            />
          </label>
          <label className="grid gap-1">
            Minutos
            <input
              type="number"
              required
              min={1}
              max={MAXIMO_DE_MINUTOS}
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              className="h-9 w-24 rounded-md border border-linha bg-cartao px-2"
            />
          </label>
          <Button type="submit" size="pequeno">
            Salvar
          </Button>
          {limites.ajustados && (
            <Button type="button" size="pequeno" variant="fantasma" onClick={() => void salvar(true)}>
              Voltar ao padrão
            </Button>
          )}
        </form>
      ) : (
        <p className="text-sm">
          {limites.rodadas} rodadas e {limites.minutos} minutos por execução.
        </p>
      )}
    </Card>
  );
}
