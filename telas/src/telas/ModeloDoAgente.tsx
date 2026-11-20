/**
 * Modelo de IA de um agente interno (M4-01 e M4-02): o principal e o reserva, entre os modelos liberados nas contas
 * de IA. Sem modelo, o agente não liga.
 */
import type { ModeloEscolhido, ModelosDoAgente } from "@mago-os/contratos";
import { useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

interface ModeloLiberado {
  contaId: string;
  conta: string;
  credencial: string;
  modelo: string;
}

const chave = (m: ModeloEscolhido | null | undefined) => (m ? `${m.contaId}|${m.modelo}` : "");
const deChave = (k: string): ModeloEscolhido | null => {
  const [contaId, ...resto] = k.split("|");
  return contaId && resto.length > 0 ? { contaId, modelo: resto.join("|") } : null;
};

export function ModeloDoAgente({
  agenteId,
  pausado = false,
  aoMudar,
}: {
  agenteId: string;
  /** O agente está pausado: depois de salvar, lembra de clicar em Retomar. */
  pausado?: boolean;
  aoMudar?: () => void;
}) {
  const [liberados, setLiberados] = useState<ModeloLiberado[] | null>(null);
  const [principal, setPrincipal] = useState("");
  const [reserva, setReserva] = useState("");
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const [l, atual] = await Promise.all([
        pedir<ModeloLiberado[]>("GET", "/ia/modelos"),
        pedir<{ modelos: ModelosDoAgente | null }>("GET", `/agentes/${encodeURIComponent(agenteId)}/modelos`),
      ]);
      setLiberados(l.ok && l.dados ? l.dados : []);
      setPrincipal(chave(atual.dados?.modelos?.principal));
      setReserva(chave(atual.dados?.modelos?.reserva));
    })();
  }, [agenteId]);

  async function salvar() {
    const p = deChave(principal);
    const r = await pedir<{ modelos: ModelosDoAgente | null }>(
      "POST",
      `/agentes/${encodeURIComponent(agenteId)}/modelos`,
      { modelos: p ? { principal: p, reserva: deChave(reserva) } : null },
    );
    setMensagem(
      r.ok
        ? {
            tipo: "ok",
            texto:
              pausado && p
                ? "Modelo salvo. Agora clique em Retomar, no fim da página, para ligar o agente."
                : "Modelo salvo.",
          }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    if (r.ok) aoMudar?.();
  }

  const opcoes = (liberados ?? []).map((m) => (
    <option key={chave(m)} value={chave(m)}>
      {m.modelo} ({m.conta}
      {m.credencial === "assinatura" ? ", assinatura" : ""})
    </option>
  ));

  return (
    <Card className="gap-3">
      <CardTitulo>Modelo de IA</CardTitulo>
      <CardDescricao>
        O agente usa o principal. Se ele falhar ou a conta chegar no limite, entra o reserva sem parar.
      </CardDescricao>
      {liberados && liberados.length === 0 && (
        <Aviso
          tipo="erro"
          texto="Nenhum modelo liberado. Conecte uma conta em Agentes › Contas de IA e libere os modelos."
        />
      )}
      {liberados && liberados.length > 0 && (
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            Principal
            <select
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              className="h-11 w-full min-w-0 rounded-md border border-linha bg-cartao px-3 text-base font-normal"
            >
              <option value="">Nenhum (o agente fica sem modelo)</option>
              {opcoes}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Reserva (opcional)
            <select
              value={reserva}
              onChange={(e) => setReserva(e.target.value)}
              className="h-11 w-full min-w-0 rounded-md border border-linha bg-cartao px-3 text-base font-normal"
            >
              <option value="">Sem reserva</option>
              {opcoes}
            </select>
          </label>
          <div>
            <Button size="pequeno" onClick={() => void salvar()}>
              Salvar modelo
            </Button>
          </div>
        </div>
      )}
      {mensagem && <Aviso {...mensagem} />}
    </Card>
  );
}
