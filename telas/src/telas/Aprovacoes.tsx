/**
 * Pedidos de aprovação dos agentes (M4-03): a lista e a página de um pedido, onde quem pode decidir aprova (podendo
 * editar os parâmetros) ou recusa com motivo. O texto do agente aparece sempre como texto. A decisão manda de volta a
 * conferência dos parâmetros que a pessoa viu.
 */
import type { Aprovacao, SituacaoDaAprovacao } from "@mago-os/contratos";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

const NOME_DA_SITUACAO: Record<SituacaoDaAprovacao, string> = {
  pendente: "Esperando decisão",
  aprovada: "Aprovada",
  recusada: "Recusada",
  vencida: "Venceu sem decisão",
  falhou: "Aprovada, mas não deu certo",
};

const COR: Record<SituacaoDaAprovacao, string> = {
  pendente: "bg-alerta/10 text-alerta",
  aprovada: "bg-ok/10 text-ok",
  recusada: "bg-suave text-texto-2",
  vencida: "bg-suave text-texto-2",
  falhou: "bg-perigo/10 text-perigo",
};

type ComAgente = Aprovacao & { agenteNome: string };

function Situacao({ situacao }: { situacao: SituacaoDaAprovacao }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", COR[situacao])}>
      {NOME_DA_SITUACAO[situacao]}
    </span>
  );
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ListaDeAprovacoes() {
  const [lista, setLista] = useState<ComAgente[] | null>(null);
  useEffect(() => {
    void pedir<ComAgente[]>("GET", "/aprovacoes").then((r) => setLista(r.ok && r.dados ? r.dados : []));
  }, []);
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Aprovações</h1>
        <p className="text-sm text-texto-2">O que os agentes pediram para fazer e esperam a sua decisão.</p>
      </div>
      {lista && lista.length === 0 && <p className="text-sm text-texto-2">Nenhum pedido de aprovação.</p>}
      <ul className="grid gap-2">
        {lista?.map((a) => (
          <li key={a.id}>
            <a
              href={`/aprovacoes/${a.id}`}
              className="grid gap-1.5 rounded-lg border border-linha bg-cartao p-3 hover:bg-suave"
            >
              <span className="font-medium">{a.resumo}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <Situacao situacao={a.situacao} />
                <span>{a.agenteNome}</span>
                <span>{quando(a.criadaEm)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function PaginaDaAprovacao({ id }: { id: string }) {
  const [a, setA] = useState<(ComAgente & { vencida: boolean }) | null | undefined>(undefined);
  const [parametros, setParametros] = useState("");
  const [motivo, setMotivo] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    const r = await pedir<ComAgente & { vencida: boolean }>("GET", `/aprovacoes/${encodeURIComponent(id)}`);
    setA(r.ok && r.dados ? r.dados : null);
    if (r.ok && r.dados) setParametros(JSON.stringify(r.dados.parametros, null, 2));
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function decidir(decisao: "aprovar" | "recusar") {
    if (!a) return;
    let editados: Record<string, unknown> | undefined;
    if (decisao === "aprovar" && parametros.trim() !== JSON.stringify(a.parametros, null, 2)) {
      try {
        editados = JSON.parse(parametros) as Record<string, unknown>;
      } catch {
        return setMensagem({ tipo: "erro", texto: "Os parâmetros editados não estão num formato válido." });
      }
    }
    setOcupado(true);
    const r = await pedir<Aprovacao>("POST", `/aprovacoes/${encodeURIComponent(id)}/decidir`, {
      decisao,
      conferencia: a.conferencia,
      ...(decisao === "recusar" ? { motivo: motivo.trim() } : editados ? { parametros: editados } : {}),
    });
    setOcupado(false);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: decisao === "aprovar" ? "Aprovado." : "Recusado." });
    setRecusando(false);
    void carregar();
  }

  if (a === undefined) return <main className="px-4 py-8 text-sm text-texto-2">Carregando...</main>;
  if (a === null)
    return (
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
        <Aviso tipo="erro" texto="Pedido não encontrado, ou você não decide sobre ele." />
      </main>
    );
  const aberto = a.situacao === "pendente" && !a.vencida;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/aprovacoes" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
        <ArrowLeft className="size-4" /> Aprovações
      </a>
      <div className="grid gap-1">
        <h1 className="text-xl font-bold tracking-tight">{a.resumo}</h1>
        <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
          <Situacao situacao={a.vencida && a.situacao === "pendente" ? "vencida" : a.situacao} />
          <span>Pedido por {a.agenteNome}</span>
          <span>em {quando(a.criadaEm)}</span>
          {aberto && <span>vence {quando(a.venceEm)}</span>}
        </span>
      </div>
      {mensagem && <Aviso {...mensagem} />}
      <Card className="gap-3">
        {a.motivo && (
          <div className="grid gap-1">
            <CardTitulo>Por quê</CardTitulo>
            {/* Texto do agente ou do pedido: só texto. */}
            <p className="whitespace-pre-wrap break-words text-sm">{a.motivo}</p>
          </div>
        )}
        {a.tarefaId && (
          <a href={`/tarefas/${a.tarefaId}`} className="text-sm underline">
            Abrir a tarefa
          </a>
        )}
        <div className="grid gap-1.5">
          <CardTitulo>O que vai ser feito</CardTitulo>
          <CardDescricao>
            Os dados exatos da ação. {aberto ? "Você pode editar antes de aprovar." : ""}
          </CardDescricao>
          <textarea
            aria-label="Parâmetros da ação"
            value={parametros}
            onChange={(e) => setParametros(e.target.value)}
            readOnly={!aberto}
            rows={Math.min(14, parametros.split("\n").length + 1)}
            spellCheck={false}
            className="w-full min-w-0 rounded-md border border-linha bg-cartao px-3 py-2 font-mono text-xs"
          />
        </div>
        {a.observacao && <Aviso tipo={a.situacao === "falhou" ? "erro" : "ok"} texto={a.observacao} />}
        {aberto && !recusando && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={ocupado} onClick={() => void decidir("aprovar")}>
              {ocupado ? "Executando..." : "Aprovar"}
            </Button>
            <Button variant="contorno" onClick={() => setRecusando(true)}>
              Recusar
            </Button>
          </div>
        )}
        {aberto && recusando && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void decidir("recusar");
            }}
          >
            <label htmlFor="motivo-da-recusa" className="text-sm font-medium">
              Por que recusar (o agente e quem pediu recebem)
            </label>
            <textarea
              id="motivo-da-recusa"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              required
              maxLength={1000}
              rows={3}
              className="w-full min-w-0 rounded-md border border-linha bg-cartao px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={ocupado || !motivo.trim()}>
                Recusar
              </Button>
              <Button type="button" variant="fantasma" onClick={() => setRecusando(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>
    </main>
  );
}
