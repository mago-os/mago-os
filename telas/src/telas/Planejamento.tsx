/**
 * Planejamento da tarefa (M3-03): prioridade, prazo (dia e hora, no fuso da empresa), início, etiquetas e
 * recorrência. Mostra o prazo no fuso de quem vê quando tem hora, e destaca o que está atrasado.
 */
import {
  type Etiqueta,
  type Frequencia,
  NOMES_PRIORIDADE,
  PRIORIDADES,
  type Prazo,
  type Prioridade,
  type RegraDeRecorrencia,
  type Tarefa,
} from "@mago-os/contratos";
import { useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { criarEtiqueta, listarEtiquetas, planejarTarefa } from "@/tarefas";
import { Aviso } from "./Acesso";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

export const COR_DA_PRIORIDADE: Record<Prioridade, string> = {
  urgente: "bg-perigo/15 text-perigo",
  alta: "bg-tinta/10 text-tinta",
  normal: "bg-suave text-texto-2",
  baixa: "bg-suave text-texto-2",
};

export function MarcaDePrioridade({ prioridade }: { prioridade: Prioridade | null }) {
  if (!prioridade) return null;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", COR_DA_PRIORIDADE[prioridade])}>
      {NOMES_PRIORIDADE[prioridade]}
    </span>
  );
}

/** O prazo como a pessoa lê: com hora, no fuso de quem vê; só o dia, o próprio dia. */
export function textoDoPrazo(prazo: Prazo): string {
  if (prazo.hora === null) {
    const [a, m, d] = prazo.dia.split("-");
    return `${d}/${m}/${a}`;
  }
  return new Date(prazo.em).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Prazo da tarefa aberta, em vermelho quando passou. */
export function MarcaDePrazo({ tarefa }: { tarefa: Pick<Tarefa, "prazo" | "status"> }) {
  if (!tarefa.prazo) return null;
  const aberta = tarefa.status !== "concluida" && tarefa.status !== "cancelada";
  const atrasada = aberta && new Date(tarefa.prazo.em).getTime() < Date.now();
  return (
    <span className={cn("text-xs", atrasada ? "font-medium text-perigo" : "text-texto-2")}>
      {atrasada ? "Atrasada: " : "Prazo: "}
      {textoDoPrazo(tarefa.prazo)}
    </span>
  );
}

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NOMES_FREQUENCIA: Record<Frequencia, string> = {
  diaria: "Todo dia",
  semanal: "Toda semana",
  mensal: "Todo mês",
  anual: "Todo ano",
};

export function useEtiquetas() {
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const recarregar = () => void listarEtiquetas().then((r) => setEtiquetas(r.dados?.etiquetas ?? []));
  useEffect(recarregar, []);
  return { etiquetas, recarregar };
}

export function PlanejamentoDaTarefa({
  tarefa,
  podeEditar,
  aoMudar,
}: {
  tarefa: Tarefa;
  podeEditar: boolean;
  aoMudar: () => void;
}) {
  const { etiquetas, recarregar } = useEtiquetas();
  const [editando, setEditando] = useState(false);
  const [prioridade, setPrioridade] = useState<Prioridade | "">(tarefa.prioridade ?? "");
  const [dia, setDia] = useState(tarefa.prazo?.dia ?? "");
  const [hora, setHora] = useState(tarefa.prazo?.hora ?? "");
  const [inicio, setInicio] = useState(tarefa.inicio ?? "");
  const [marcadas, setMarcadas] = useState<string[]>(tarefa.etiquetas);
  const [regra, setRegra] = useState<RegraDeRecorrencia | null>(tarefa.recorrencia);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  function abrir() {
    setPrioridade(tarefa.prioridade ?? "");
    setDia(tarefa.prazo?.dia ?? "");
    setHora(tarefa.prazo?.hora ?? "");
    setInicio(tarefa.inicio ?? "");
    setMarcadas(tarefa.etiquetas);
    setRegra(tarefa.recorrencia);
    setMensagem(null);
    setEditando(true);
  }

  async function aoSalvar() {
    const r = await planejarTarefa(tarefa.id, {
      prioridade: prioridade || null,
      // Mudou só o que a pessoa mexeu no prazo; o fuso continua o de antes (ou o da empresa, se era novo).
      prazo: dia ? { dia, hora: hora || null, ...(tarefa.prazo ? { fuso: tarefa.prazo.fuso } : {}) } : null,
      inicio: inicio || null,
      etiquetas: marcadas,
      recorrencia: dia ? regra : null,
    });
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
    if (r.ok) setEditando(false);
    aoMudar();
  }

  async function aoCriarEtiqueta() {
    const nome = window.prompt("Nome da nova etiqueta")?.trim();
    if (!nome) return;
    const r = await criarEtiqueta(nome, "#1aa39a");
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMarcadas((l) => [...l, r.dados?.id as string]);
    recarregar();
  }

  const nomesDasEtiquetas = tarefa.etiquetas
    .map((id) => etiquetas.find((e) => e.id === id))
    .filter((e): e is Etiqueta => e !== undefined);

  if (!editando) {
    return (
      <Card className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitulo>Planejamento</CardTitulo>
          {podeEditar && (
            <Button variant="fantasma" size="pequeno" onClick={abrir}>
              Editar
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tarefa.prioridade ? (
            <MarcaDePrioridade prioridade={tarefa.prioridade} />
          ) : (
            <span className="text-texto-2">Sem prioridade</span>
          )}
          {tarefa.prazo ? <MarcaDePrazo tarefa={tarefa} /> : <span className="text-texto-2">Sem prazo</span>}
          {tarefa.inicio && (
            <span className="text-xs text-texto-2">
              Início: {tarefa.inicio.split("-").reverse().join("/")}
            </span>
          )}
          {tarefa.recorrencia && (
            <span className="text-xs text-texto-2">
              Repete: {NOMES_FREQUENCIA[tarefa.recorrencia.frequencia].toLowerCase()} (vez {tarefa.ocorrencia}
              )
            </span>
          )}
        </div>
        {nomesDasEtiquetas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {nomesDasEtiquetas.map((e) => (
              <span
                key={e.id}
                className="rounded-full px-2 py-0.5 text-xs text-white"
                style={{ backgroundColor: e.cor }}
              >
                {e.nome}
              </span>
            ))}
          </div>
        )}
      </Card>
    );
  }

  const ehSemanal = regra?.frequencia === "semanal";
  return (
    <Card className="gap-3">
      <CardTitulo>Planejamento</CardTitulo>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium">
          Prioridade
          <select
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base font-normal"
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value as Prioridade | "")}
          >
            <option value="">Sem prioridade</option>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {NOMES_PRIORIDADE[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Início
          <input
            type="date"
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base font-normal"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Prazo
          <input
            type="date"
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base font-normal"
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Hora do prazo (opcional)
          <input
            type="time"
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base font-normal"
            value={hora}
            disabled={!dia}
            onChange={(e) => setHora(e.target.value)}
          />
        </label>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="text-sm font-medium">Etiquetas</legend>
        <div className="flex flex-wrap gap-2">
          {etiquetas.map((e) => {
            const marcada = marcadas.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                aria-pressed={marcada}
                onClick={() => setMarcadas((l) => (marcada ? l.filter((x) => x !== e.id) : [...l, e.id]))}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  marcada ? "text-white" : "text-texto-2",
                )}
                style={marcada ? { backgroundColor: e.cor, borderColor: e.cor } : { borderColor: e.cor }}
              >
                {e.nome}
              </button>
            );
          })}
          <Button type="button" variant="fantasma" size="pequeno" onClick={() => void aoCriarEtiqueta()}>
            Nova etiqueta
          </Button>
        </div>
      </fieldset>

      <fieldset className="grid gap-2" disabled={!dia}>
        <legend className="text-sm font-medium">Repetir {dia ? "" : "(marque um prazo antes)"}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Repetição"
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
            value={regra?.frequencia ?? ""}
            onChange={(e) =>
              setRegra(e.target.value ? { frequencia: e.target.value as Frequencia, intervalo: 1 } : null)
            }
          >
            <option value="">Não repete</option>
            {(Object.keys(NOMES_FREQUENCIA) as Frequencia[]).map((f) => (
              <option key={f} value={f}>
                {NOMES_FREQUENCIA[f]}
              </option>
            ))}
          </select>
          {regra && (
            <label className="flex items-center gap-2 text-sm">
              a cada
              <input
                type="number"
                min={1}
                max={365}
                aria-label="Intervalo"
                className="h-11 w-20 rounded-md border border-linha bg-cartao px-3 text-base"
                value={regra.intervalo}
                onChange={(e) => setRegra({ ...regra, intervalo: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
          )}
        </div>
        {ehSemanal && regra && (
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((nome, d) => {
              const marcado = regra.diasDaSemana?.includes(d) ?? false;
              return (
                <button
                  key={nome}
                  type="button"
                  aria-pressed={marcado}
                  onClick={() => {
                    const atuais = regra.diasDaSemana ?? [];
                    const novos = marcado ? atuais.filter((x) => x !== d) : [...atuais, d];
                    const { diasDaSemana: _, ...resto } = regra;
                    setRegra(novos.length > 0 ? { ...resto, diasDaSemana: novos } : resto);
                  }}
                  className={cn(
                    "rounded-full border border-linha px-3 py-1 text-sm",
                    marcado ? "bg-tinta text-sobre-tinta" : "text-texto-2",
                  )}
                >
                  {nome}
                </button>
              );
            })}
          </div>
        )}
        {regra && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              até
              <input
                type="date"
                className="h-10 rounded-md border border-linha bg-cartao px-2 text-base"
                value={regra.ate ?? ""}
                onChange={(e) => setRegra({ ...regra, ate: e.target.value || null })}
              />
            </label>
            <label className="flex items-center gap-2">
              ou depois de
              <input
                type="number"
                min={1}
                aria-label="Vezes"
                className="h-10 w-20 rounded-md border border-linha bg-cartao px-2 text-base"
                value={regra.vezes ?? ""}
                onChange={(e) =>
                  setRegra({ ...regra, vezes: e.target.value ? Number(e.target.value) : null })
                }
              />
              vezes
            </label>
          </div>
        )}
      </fieldset>

      {mensagem && <Aviso {...mensagem} />}
      <div className="flex gap-2">
        <Button size="pequeno" onClick={() => void aoSalvar()}>
          Salvar
        </Button>
        <Button variant="fantasma" size="pequeno" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </Card>
  );
}
