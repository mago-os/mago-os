/**
 * Parar todos os agentes (M4-09): o botão na tela Agentes, o aviso no topo enquanto os agentes estão parados (com a
 * retomada de cada agente ou de todos) e, na tela Empresas, o botão do Dono da plataforma. Parar e retomar pedem o
 * segundo fator recente.
 */
import type { Parada } from "@mago-os/contratos";
import { OctagonX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { useAoVoltar } from "./Administrador";
import { ConfirmarSegundoFator } from "./DoisFatores";

/** Avisa o aviso do topo e as listas de que a parada mudou. */
const EVENTO = "mago:parada";
const avisarQueMudou = () => window.dispatchEvent(new Event(EVENTO));

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

type Mensagem = { tipo: "ok" | "erro"; texto: string } | null;

/** O formulário de parar: o motivo e o botão vermelho. */
function FormularioDeParar({
  caminho,
  titulo,
  explicacao,
  aoParar,
  aoCancelar,
}: {
  caminho: string;
  titulo: string;
  explicacao: string;
  aoParar: (texto: string) => void;
  aoCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  async function parar() {
    setEnviando(true);
    setMensagem(null);
    const r = await pedir<{ empresas?: number }>("POST", caminho, { motivo });
    setEnviando(false);
    if (r.codigo === "CONFIRMACAO_NECESSARIA") return setConfirmar(true);
    if (!r.ok)
      return setMensagem({ tipo: "erro", texto: r.mensagem || "Não foi possível parar os agentes." });
    avisarQueMudou();
    aoParar(
      typeof r.dados?.empresas === "number"
        ? `Agentes parados em ${r.dados.empresas} ${r.dados.empresas === 1 ? "empresa" : "empresas"}.`
        : "Os agentes foram parados.",
    );
  }

  if (confirmar)
    return (
      <ConfirmarSegundoFator
        aoConfirmar={() => {
          setConfirmar(false);
          void parar();
        }}
      />
    );

  return (
    <Card className="gap-3 border-perigo/40">
      <CardTitulo>{titulo}</CardTitulo>
      <CardDescricao>{explicacao}</CardDescricao>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void parar();
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Motivo</span>
          <textarea
            name="motivo"
            required
            maxLength={500}
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: um agente está mandando coisa errada"
            className="rounded-md border border-linha bg-fundo px-3 py-2"
          />
        </label>
        {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="perigo" disabled={enviando || motivo.trim().length === 0}>
            <OctagonX /> Parar agora
          </Button>
          <Button type="button" variant="contorno" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Na tela Agentes: o botão "Parar todos os agentes" (quem pode desligar agentes). */
export function PararTodosOsAgentes() {
  const [abrindo, setAbrindo] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  if (abrindo)
    return (
      <FormularioDeParar
        caminho="/agentes/parar-todos"
        titulo="Parar todos os agentes"
        explicacao="Todos os agentes ativos param agora: o que está rodando termina no passo atual e nada novo começa. As tarefas ficam como estão. Para retomar, use o aviso no topo."
        aoParar={(texto) => {
          setAbrindo(false);
          setMensagem({ tipo: "ok", texto });
        }}
        aoCancelar={() => setAbrindo(false)}
      />
    );
  return (
    <div className="grid gap-2">
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      <div>
        <Button variant="perigo" onClick={() => setAbrindo(true)}>
          <OctagonX /> Parar todos os agentes
        </Button>
      </div>
    </div>
  );
}

/** No topo, para quem pode parar e retomar: os agentes estão parados, por quê, e a retomada. */
export function AvisoDaParada() {
  const [parada, setParada] = useState<Parada | null>(null);
  const [confirmar, setConfirmar] = useState<string[] | null | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<{ parada: Parada | null }>("GET", "/agentes/parada");
    if (r.ok && r.dados) setParada(r.dados.parada);
  }, []);
  useEffect(() => {
    void carregar();
    const aoMudar = () => void carregar();
    window.addEventListener(EVENTO, aoMudar);
    return () => window.removeEventListener(EVENTO, aoMudar);
  }, [carregar]);
  useAoVoltar(carregar);
  useTempoReal(() => void carregar());

  async function retomar(agenteIds: string[] | null) {
    setEnviando(true);
    setMensagem(null);
    const r = await pedir<Parada>("POST", "/agentes/retomar-todos", { agenteIds });
    setEnviando(false);
    if (r.codigo === "CONFIRMACAO_NECESSARIA") return setConfirmar(agenteIds);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem || "Não foi possível retomar." });
    avisarQueMudou();
    void carregar();
  }

  if (!parada) return null;
  if (confirmar !== undefined)
    return (
      <div className="mx-auto grid max-w-5xl gap-2 px-4 pt-4">
        <ConfirmarSegundoFator
          aoConfirmar={() => {
            const ids = confirmar;
            setConfirmar(undefined);
            void retomar(ids);
          }}
        />
      </div>
    );
  const parados = parada.agentes.filter((a) => !a.retomadoEm);
  return (
    <div className="mx-auto grid max-w-5xl gap-2 px-4 pt-4">
      <div role="alert" className="grid gap-2 rounded-cartao border border-perigo/50 bg-cartao p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <OctagonX className="size-4 shrink-0 text-perigo" />
          <span className="flex-1 font-medium">
            Os agentes estão parados desde {quando(parada.paradaEm)}, por {parada.paradaPor.nome}
            {parada.daPlataforma ? " (Dono da plataforma)" : ""}.
          </span>
          {!parada.daPlataforma && parados.length > 0 && (
            <Button size="pequeno" variant="contorno" disabled={enviando} onClick={() => void retomar(null)}>
              Retomar todos
            </Button>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-texto-2">Motivo: {parada.motivo}</p>
        {parada.daPlataforma ? (
          <p className="text-texto-2">Só o Dono da plataforma retoma.</p>
        ) : (
          parados.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {parados.map((a) => (
                <li key={a.agenteId}>
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => void retomar([a.agenteId])}
                    className="rounded-full border border-linha px-2.5 py-1 text-xs hover:bg-suave"
                  >
                    Retomar {a.nome}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
        {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      </div>
    </div>
  );
}

/** Na tela Empresas, para o Dono da plataforma: parar os agentes de todas as empresas e retomar. */
export function ParadaDaPlataforma() {
  const [paradas, setParadas] = useState<{ empresaId: string; empresaNome: string; parada: Parada }[]>([]);
  const [abrindo, setAbrindo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<{ paradas: typeof paradas }>("GET", "/plataforma/agentes/paradas");
    if (r.ok && r.dados) setParadas(r.dados.paradas);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function retomar() {
    setMensagem(null);
    const r = await pedir<{ empresas: number }>("POST", "/plataforma/agentes/retomar-todos");
    if (r.codigo === "CONFIRMACAO_NECESSARIA") return setConfirmar(true);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem || "Não foi possível retomar." });
    setMensagem({ tipo: "ok", texto: `Agentes retomados em ${r.dados?.empresas ?? 0} empresas.` });
    avisarQueMudou();
    void carregar();
  }

  if (confirmar)
    return (
      <ConfirmarSegundoFator
        aoConfirmar={() => {
          setConfirmar(false);
          void retomar();
        }}
      />
    );
  if (abrindo)
    return (
      <FormularioDeParar
        caminho="/plataforma/agentes/parar-todos"
        titulo="Parar os agentes de todas as empresas"
        explicacao="Os agentes ativos de todas as empresas param agora, e só você retoma. Os administradores de cada empresa recebem o aviso com o motivo."
        aoParar={(texto) => {
          setAbrindo(false);
          setMensagem({ tipo: "ok", texto });
          void carregar();
        }}
        aoCancelar={() => setAbrindo(false)}
      />
    );
  const minhas = paradas.filter((p) => p.parada.daPlataforma);
  return (
    <Card className="gap-3">
      <CardTitulo>Freio dos agentes da plataforma</CardTitulo>
      {paradas.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {paradas.map((p) => (
            <li key={p.empresaId}>
              <span className="font-medium">{p.empresaNome}</span>: parados desde {quando(p.parada.paradaEm)}
              {p.parada.daPlataforma ? " por você" : ` por ${p.parada.paradaPor.nome}`}. Motivo:{" "}
              {p.parada.motivo}
            </li>
          ))}
        </ul>
      ) : (
        <CardDescricao>Nenhuma empresa está com os agentes parados.</CardDescricao>
      )}
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="perigo" onClick={() => setAbrindo(true)}>
          <OctagonX /> Parar todos os agentes
        </Button>
        {minhas.length > 0 && (
          <Button variant="contorno" onClick={() => void retomar()}>
            Retomar os agentes
          </Button>
        )}
      </div>
    </Card>
  );
}
