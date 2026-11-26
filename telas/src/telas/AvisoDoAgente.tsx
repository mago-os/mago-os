/**
 * Aviso imediato ao agente externo (M7-04, decisão 0049), na página do agente: o endereço que recebe o aviso na hora,
 * o segredo (uma vez só), Mandar teste, Trocar segredo, Desligar e as últimas entregas.
 */
import type { AvisoDoAgente as Aviso, EntregaDeWebhook } from "@mago-os/contratos";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso as Mensagem } from "./Acesso";

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export function AvisoDoAgente({ agenteId }: { agenteId: string }) {
  const [dados, setDados] = useState<{ aviso: Aviso | null; entregas: EntregaDeWebhook[] } | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await pedir<{ aviso: Aviso | null; entregas: EntregaDeWebhook[] }>(
      "GET",
      `/agentes/${agenteId}/aviso`,
    );
    setDados(r.ok && r.dados ? r.dados : null);
  }, [agenteId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function ligar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const url = String(new FormData(evento.currentTarget).get("url")).trim();
    const r = await pedir<{ aviso: Aviso; segredo: string | null }>("POST", `/agentes/${agenteId}/aviso`, {
      url,
    });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    if (r.dados.segredo) setSegredo(r.dados.segredo);
    setMensagem({ tipo: "ok", texto: "Aviso imediato ligado." });
    void carregar();
  }

  async function acao(qual: "teste" | "segredo" | "desligar") {
    if (qual === "desligar" && !confirm("Desligar o aviso? O agente volta a só perguntar a cada minuto."))
      return;
    if (qual === "segredo" && !confirm("Trocar o segredo? O agente precisa do segredo novo na hora.")) return;
    const r =
      qual === "teste"
        ? await pedir("POST", `/agentes/${agenteId}/aviso/teste`, {})
        : qual === "segredo"
          ? await pedir<{ segredo: string }>("POST", `/agentes/${agenteId}/aviso/trocar-segredo`, {})
          : await pedir("DELETE", `/agentes/${agenteId}/aviso`);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    if (qual === "segredo") setSegredo((r.dados as { segredo: string }).segredo);
    setMensagem({
      tipo: "ok",
      texto:
        qual === "teste"
          ? "Teste enviado. Veja o resultado abaixo em alguns segundos."
          : qual === "segredo"
            ? "Segredo trocado."
            : "Aviso desligado.",
    });
    if (qual === "teste") setTimeout(() => void carregar(), 6000);
    void carregar();
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      setCopiado(false);
    }
  }

  if (!dados) return null;
  const aviso = dados.aviso;
  return (
    <Card className="gap-3">
      <CardTitulo>Aviso imediato</CardTitulo>
      <CardDescricao>
        O Mago OS avisa o agente na hora em que ele recebe uma tarefa, é mencionado com @ ou tem uma aprovação
        respondida. A pergunta a cada minuto continua como reserva. Como conferir a assinatura: veja o guia
        dos agentes.
      </CardDescricao>
      {segredo && (
        <div className="grid gap-2 rounded-md border border-alerta/40 p-3">
          <p className="text-sm font-medium">Copie o segredo agora: ele aparece só esta vez.</p>
          <code
            className={cn(
              "break-all rounded p-2 text-sm transition-colors",
              copiado ? "bg-ok/10 ring-2 ring-ok/40" : "bg-suave",
            )}
          >
            {segredo}
          </code>
          <div className="flex gap-2">
            <Button size="pequeno" variant="contorno" onClick={() => void copiar(segredo)}>
              {copiado ? <Check /> : <Copy />}
              {copiado ? "Copiado!" : "Copiar"}
            </Button>
            <Button size="pequeno" variant="fantasma" onClick={() => setSegredo(null)}>
              Já guardei
            </Button>
          </div>
        </div>
      )}
      <form className="grid gap-2" onSubmit={(e) => void ligar(e)}>
        <Campo
          id={`aviso-${agenteId}`}
          name="url"
          type="url"
          rotulo="Endereço de aviso (https)"
          placeholder="https://hermes.minhaempresa.com/mago"
          defaultValue={aviso?.url ?? ""}
          required
          maxLength={500}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="pequeno">
            {aviso ? "Salvar endereço" : "Ligar aviso"}
          </Button>
          {aviso && (
            <>
              <Button type="button" size="pequeno" variant="contorno" onClick={() => void acao("teste")}>
                Mandar teste
              </Button>
              <Button type="button" size="pequeno" variant="fantasma" onClick={() => void acao("segredo")}>
                Trocar segredo
              </Button>
              <Button
                type="button"
                size="pequeno"
                variant="fantasma"
                className="text-perigo"
                onClick={() => void acao("desligar")}
              >
                Desligar
              </Button>
            </>
          )}
        </div>
      </form>
      {aviso && (
        <p className="text-xs text-texto-2">
          {aviso.situacao === "ligado"
            ? "Ligado"
            : aviso.desligadoPorque === "falhas"
              ? "Desligado: 3 dias sem conseguir entregar. Salve o endereço de novo para ligar."
              : "Desligado"}
          {` · segredo terminado em ${aviso.finalDoSegredo}`}
          {aviso.ultimaEntregaEm ? ` · última entrega ${quando(aviso.ultimaEntregaEm)}` : ""}
        </p>
      )}
      {mensagem && <Mensagem tipo={mensagem.tipo} texto={mensagem.texto} />}
      {dados.entregas.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {dados.entregas.slice(0, 10).map((e) => (
            <li key={e.id} className="flex flex-wrap gap-2 border-t border-linha pt-1">
              <span className="font-medium">{e.evento}</span>
              <span className={e.situacao === "entregue" ? "text-ok" : "text-texto-2"}>
                {e.situacao === "entregue"
                  ? "Entregue"
                  : e.situacao === "esperando"
                    ? "Na fila"
                    : "Não entregue"}
              </span>
              <span className="text-texto-2">
                {quando(e.criadaEm)}
                {e.ultimoCodigo !== null ? ` · código ${e.ultimoCodigo}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
