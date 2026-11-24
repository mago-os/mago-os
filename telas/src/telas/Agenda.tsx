/**
 * Agenda simples (M5-07, decisão 0041): a semana com os eventos (meus e, se quiser, os de colegas lado a lado),
 * marcar um evento, e a página do evento com as respostas, editar e cancelar ("só este", "este e os seguintes" ou
 * "todos" numa série). Na agenda de um colega, o funcionário vê só "ocupado".
 */
import {
  type AlcanceDaMudanca,
  type EventoDaAgenda,
  NOMES_DAS_RESPOSTAS,
  type OcorrenciaNaAgenda,
  type PedidoDeEvento,
  type RespostaAoConvite,
} from "@mago-os/contratos";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { usePessoas } from "./Tarefas";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;
const caixa = "h-11 rounded-md border border-linha bg-cartao px-3 text-base";
const FUSO_DAQUI = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";

function diaLocal(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A segunda-feira da semana do dia. */
function segundaDe(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number) as [number, number, number];
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return somarDias(dia, semana === 0 ? -6 : 1 - semana);
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaPorExtenso = (dia: string) =>
  new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });

export function Agenda({ euId }: { euId: string }) {
  const [segunda, setSegunda] = useState(segundaDe(diaLocal(new Date())));
  const [pessoas, setPessoas] = useState<string[]>([euId]);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaNaAgenda[] | null>(null);
  const [criando, setCriando] = useState(false);
  const todas = usePessoas();
  const nomeDe = (id: string) => todas.find((p) => p.id === id)?.nome ?? "Alguém";
  const carregar = useCallback(async () => {
    const r = await pedir<{ ocorrencias: OcorrenciaNaAgenda[] }>(
      "GET",
      `/agenda?de=${segunda}&ate=${somarDias(segunda, 6)}&pessoas=${pessoas.join(",")}`,
    );
    setOcorrencias(r.ok && r.dados ? r.dados.ocorrencias : []);
  }, [segunda, pessoas]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
  const doDia = (dia: string) =>
    (ocorrencias ?? []).filter((o) => {
      const de = diaLocal(new Date(o.inicioEm));
      const ate = diaLocal(new Date(new Date(o.fimEm).getTime() - 60_000));
      return de <= dia && dia <= ate;
    });
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
          <p className="text-sm text-texto-2">Os seus eventos e, se quiser, os de colegas lado a lado.</p>
        </div>
        {!criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Novo evento
          </Button>
        )}
      </div>
      {criando && (
        <FormularioDoEvento
          euId={euId}
          aoCancelar={() => setCriando(false)}
          aoSalvar={() => {
            setCriando(false);
            void carregar();
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="fantasma"
          size="pequeno"
          aria-label="Semana anterior"
          onClick={() => setSegunda(somarDias(segunda, -7))}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-40 text-center font-semibold">Semana de {diaPorExtenso(segunda)}</span>
        <Button
          variant="fantasma"
          size="pequeno"
          aria-label="Próxima semana"
          onClick={() => setSegunda(somarDias(segunda, 7))}
        >
          <ChevronRight />
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          Ver também
          <select
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value=""
            onChange={(e) =>
              e.target.value && setPessoas([...new Set([...pessoas, e.target.value])].slice(0, 10))
            }
          >
            <option value="">escolher colega</option>
            {todas
              .filter((p) => !pessoas.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </select>
        </label>
      </div>
      {pessoas.length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {pessoas.map((p) => (
            <span key={p} className="flex items-center gap-1 rounded-full bg-suave px-2.5 py-0.5">
              {p === euId ? "Eu" : nomeDe(p)}
              {p !== euId && (
                <button
                  type="button"
                  aria-label={`Tirar ${nomeDe(p)}`}
                  onClick={() => setPessoas(pessoas.filter((x) => x !== p))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <ul className="grid gap-3">
        {dias.map((dia) => (
          <li key={dia} className="grid gap-1.5">
            <h2
              className={cn("text-sm font-semibold capitalize", dia === diaLocal(new Date()) && "text-tinta")}
            >
              {diaPorExtenso(dia)}
            </h2>
            {doDia(dia).length === 0 && <p className="text-xs text-texto-2">Nada marcado.</p>}
            {doDia(dia).map((o) => (
              <a
                key={`${o.eventoId}:${o.ocorrencia}`}
                href={o.ocupado ? undefined : `/agenda/${o.eventoId}?dia=${o.ocorrencia}`}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border border-linha bg-cartao p-2.5 text-sm",
                  !o.ocupado && "hover:bg-suave",
                )}
              >
                <span className="font-mono text-xs text-texto-2">
                  {o.diaInteiro ? "Dia todo" : `${hora(o.inicioEm)}–${hora(o.fimEm)}`}
                </span>
                <span className="font-medium">{o.titulo ?? "Ocupado"}</span>
                {pessoas.length > 1 && (
                  <span className="text-xs text-texto-2">
                    {o.pessoas.map((p) => (p === euId ? "Eu" : nomeDe(p))).join(", ")}
                  </span>
                )}
                {o.minhaResposta && o.minhaResposta !== "vou" && (
                  <span className="rounded-full bg-alerta/10 px-2 py-0.5 text-xs text-alerta">
                    {NOMES_DAS_RESPOSTAS[o.minhaResposta]}
                  </span>
                )}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </main>
  );
}

export function PaginaDoEvento({ id, euId }: { id: string; euId: string }) {
  const dia = new URLSearchParams(location.search).get("dia");
  const [d, setD] = useState<
    { evento: EventoDaAgenda; nomes: Record<string, string>; podeMudar: boolean } | null | undefined
  >(undefined);
  const [editando, setEditando] = useState(false);
  const [alcance, setAlcance] = useState<AlcanceDaMudanca>("so_este");
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<NonNullable<typeof d>>("GET", `/agenda/eventos/${encodeURIComponent(id)}`);
    setD(r.ok && r.dados ? r.dados : null);
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  if (d === undefined) return null;
  if (d === null)
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-sm text-texto-2">Evento não encontrado.</p>
      </main>
    );
  const { evento: e } = d;
  const eu = e.participantes.find((p) => p.pessoaId === euId);
  const naSerie = e.regra !== null && dia !== null;
  async function responder(resposta: Exclude<RespostaAoConvite, "pendente">) {
    const r = await pedir("POST", `/agenda/eventos/${e.id}/resposta`, { resposta });
    setMensagem(
      r.ok ? { tipo: "ok", texto: "Resposta registrada." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }
  async function cancelar() {
    if (!confirm("Cancelar o evento? Os participantes serão avisados.")) return;
    const r = await pedir(
      "POST",
      `/agenda/eventos/${e.id}/cancelar`,
      naSerie ? { alcance, ocorrencia: dia } : {},
    );
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    location.href = "/agenda";
  }
  const quando = e.diaInteiro
    ? `${e.inicio.dia}${e.fim.dia !== e.inicio.dia ? ` a ${e.fim.dia}` : ""} (dia todo)`
    : `${e.inicio.dia} ${e.inicio.hora}–${e.fim.dia !== e.inicio.dia ? `${e.fim.dia} ` : ""}${e.fim.hora} (${e.fuso})`;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/agenda" className="flex items-center gap-1 text-sm text-texto-2 hover:text-texto">
        <ArrowLeft className="size-4" /> Agenda
      </a>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {e.titulo}
          {e.situacao === "cancelado" && <span className="ml-2 text-base text-perigo">(cancelado)</span>}
        </h1>
        <p className="text-sm text-texto-2">
          {naSerie ? `Esta vez: ${dia}. ` : ""}
          {quando}
          {e.regra ? " · repete" : ""}
        </p>
      </div>
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      {eu && e.situacao === "marcado" && e.criadoPor !== euId && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Você vai?</span>
          {(["vou", "nao_vou", "talvez"] as const).map((r) => (
            <Button
              key={r}
              variant={eu.resposta === r ? "principal" : "contorno"}
              onClick={() => void responder(r)}
            >
              {NOMES_DAS_RESPOSTAS[r]}
            </Button>
          ))}
        </div>
      )}
      {editando ? (
        <FormularioDoEvento
          euId={euId}
          inicial={e}
          alcance={naSerie ? { valor: alcance, dia: dia as string } : undefined}
          aoCancelar={() => setEditando(false)}
          aoSalvar={(novo) => {
            setEditando(false);
            if (novo.id !== e.id) location.href = `/agenda/${novo.id}`;
            else void carregar();
          }}
        />
      ) : (
        <Card>
          {e.descricao && <p className="whitespace-pre-wrap text-sm">{e.descricao}</p>}
          {e.local && <p className="text-sm">Local: {e.local}</p>}
          {e.link && (
            <a className="text-sm text-tinta underline" href={e.link} target="_blank" rel="noreferrer">
              Entrar na reunião
            </a>
          )}
          <CardTitulo className="mt-2">Participantes</CardTitulo>
          <ul className="grid gap-1 text-sm">
            {e.participantes.map((p) => (
              <li key={p.pessoaId}>
                {d.nomes[p.pessoaId] ?? "Alguém"}
                {p.pessoaId === e.criadoPor ? " (marcou)" : ""}: {NOMES_DAS_RESPOSTAS[p.resposta]}
              </li>
            ))}
          </ul>
          {e.criadoPorAgenteId && (
            <CardDescricao>
              Marcado por {d.nomes[e.criadoPorAgenteId] ?? "um agente"}, a pedido.
            </CardDescricao>
          )}
          {d.podeMudar && e.situacao === "marcado" && (
            <div className="mt-3 grid gap-2">
              {naSerie && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Mudar ou cancelar
                  <select
                    className={caixa}
                    value={alcance}
                    onChange={(x) => setAlcance(x.target.value as AlcanceDaMudanca)}
                  >
                    <option value="so_este">Só esta vez</option>
                    <option value="este_e_seguintes">Esta e as seguintes</option>
                    <option value="todos">Todas as vezes</option>
                  </select>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="contorno" onClick={() => setEditando(true)}>
                  Editar
                </Button>
                <Button variant="perigo" onClick={() => void cancelar()}>
                  Cancelar evento
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </main>
  );
}

/** Criar ou editar: título, quando (com hora ou dia todo), repetir, onde, participantes e alertas. */
export function FormularioDoEvento({
  euId,
  inicial,
  alcance,
  aoCancelar,
  aoSalvar,
}: {
  euId: string;
  inicial?: EventoDaAgenda;
  alcance?: { valor: AlcanceDaMudanca; dia: string } | undefined;
  aoCancelar: () => void;
  aoSalvar: (e: EventoDaAgenda) => void;
}) {
  const pessoas = usePessoas();
  const hoje = diaLocal(new Date());
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [diaInteiro, setDiaInteiro] = useState(inicial?.diaInteiro ?? false);
  const [dia, setDia] = useState(
    alcance && alcance.valor !== "todos" ? alcance.dia : (inicial?.inicio.dia ?? hoje),
  );
  const [inicio, setInicio] = useState(inicial?.inicio.hora ?? "15:00");
  const [fim, setFim] = useState(inicial?.fim.hora ?? "16:00");
  const [diaDoFim, setDiaDoFim] = useState(inicial?.fim.dia ?? dia);
  const [local, setLocal] = useState(inicial?.local ?? "");
  const [link, setLink] = useState(inicial?.link ?? "");
  const [participantes, setParticipantes] = useState<string[]>(
    inicial?.participantes.map((p) => p.pessoaId).filter((p) => p !== euId) ?? [],
  );
  const [repetir, setRepetir] = useState<"" | "diaria" | "semanal" | "mensal">(
    (inicial?.regra?.frequencia as "diaria" | "semanal" | "mensal" | undefined) ?? "",
  );
  const [alertas, setAlertas] = useState(inicial?.alertas ? inicial.alertas.join(", ") : "");
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    if (!titulo.trim()) return setMensagem({ tipo: "erro", texto: "Dê um título ao evento." });
    const listaDeAlertas = alertas.trim()
      ? [
          ...new Set(
            alertas
              .split(/[,\s]+/)
              .filter(Boolean)
              .map(Number),
          ),
        ]
      : null;
    if (listaDeAlertas?.some((n) => !Number.isInteger(n) || n < 0 || n > 10080))
      return setMensagem({
        tipo: "erro",
        texto: "Escreva os alertas em minutos antes, separados por vírgula (ex.: 10, 60).",
      });
    // O dia do fim nunca antes do começo (as datas no formato AAAA-MM-DD se comparam como texto).
    const ultimoDia = [dia, diaDoFim].sort().at(-1) as string;
    const corpo: PedidoDeEvento = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      inicio: diaInteiro ? { dia } : { dia, hora: inicio },
      fim: diaInteiro ? { dia: ultimoDia } : { dia: ultimoDia, hora: fim },
      diaInteiro,
      ...(inicial ? {} : { fuso: FUSO_DAQUI }),
      local: local.trim() || null,
      link: link.trim() || null,
      participantes,
      regra: repetir ? { frequencia: repetir, intervalo: 1 } : null,
      alertas: listaDeAlertas,
    };
    setOcupado(true);
    const r = inicial
      ? await pedir<EventoDaAgenda>("POST", `/agenda/eventos/${inicial.id}`, {
          ...corpo,
          ...(alcance && inicial.regra ? { alcance: alcance.valor, ocorrencia: alcance.dia } : {}),
          ...(alcance && alcance.valor === "so_este" ? { regra: undefined } : {}),
        })
      : await pedir<EventoDaAgenda>("POST", "/agenda/eventos", corpo);
    setOcupado(false);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoSalvar(r.dados);
  }

  return (
    <Card>
      <CardTitulo>{inicial ? "Editar evento" : "Novo evento"}</CardTitulo>
      {!inicial && <CardDescricao>Os participantes recebem o convite no sino e no Telegram.</CardDescricao>}
      <div className="grid gap-3">
        <Campo
          id="evento-titulo"
          rotulo="Título"
          maxLength={200}
          value={titulo}
          onChange={(x) => setTitulo(x.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={diaInteiro} onChange={(x) => setDiaInteiro(x.target.checked)} />
          Dia todo
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            id="evento-dia"
            rotulo="Dia"
            type="date"
            value={dia}
            onChange={(x) => {
              setDia(x.target.value);
              if (diaDoFim < x.target.value) setDiaDoFim(x.target.value);
            }}
          />
          <Campo
            id="evento-dia-fim"
            rotulo="Até o dia"
            type="date"
            value={diaDoFim}
            onChange={(x) => setDiaDoFim(x.target.value)}
          />
          {!diaInteiro && (
            <>
              <Campo
                id="evento-inicio"
                rotulo="Começa às"
                type="time"
                value={inicio}
                onChange={(x) => setInicio(x.target.value)}
              />
              <Campo
                id="evento-fim"
                rotulo="Termina às"
                type="time"
                value={fim}
                onChange={(x) => setFim(x.target.value)}
              />
            </>
          )}
        </div>
        {!(alcance && alcance.valor === "so_este") && (
          <label className="grid gap-1.5 text-sm font-medium">
            Repetir
            <select
              className={caixa}
              value={repetir}
              onChange={(x) => setRepetir(x.target.value as typeof repetir)}
            >
              <option value="">Não repete</option>
              <option value="diaria">Todo dia</option>
              <option value="semanal">Toda semana</option>
              <option value="mensal">Todo mês</option>
            </select>
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo
            id="evento-local"
            rotulo="Local (opcional)"
            value={local}
            onChange={(x) => setLocal(x.target.value)}
          />
          <Campo
            id="evento-link"
            rotulo="Link da reunião (opcional, https)"
            value={link}
            onChange={(x) => setLink(x.target.value)}
          />
        </div>
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">Participantes</span>
          <div className="flex flex-wrap gap-3">
            {pessoas
              .filter((p) => p.id !== euId)
              .map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={participantes.includes(p.id)}
                    onChange={(x) =>
                      setParticipantes(
                        x.target.checked ? [...participantes, p.id] : participantes.filter((y) => y !== p.id),
                      )
                    }
                  />
                  {p.nome}
                </label>
              ))}
          </div>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">
          Descrição (opcional)
          <textarea
            className="min-h-20 rounded-md border border-linha bg-cartao p-3 text-base"
            value={descricao}
            onChange={(x) => setDescricao(x.target.value)}
          />
        </label>
        <Campo
          id="evento-alertas"
          rotulo="Alertas para todos, em minutos antes (vazio: cada um usa o seu padrão, 10 minutos)"
          value={alertas}
          onChange={(x) => setAlertas(x.target.value)}
        />
        {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
        <div className="flex flex-wrap gap-2">
          <Button disabled={ocupado} onClick={() => void salvar()}>
            Salvar
          </Button>
          <Button variant="contorno" onClick={aoCancelar}>
            Voltar
          </Button>
        </div>
      </div>
    </Card>
  );
}
