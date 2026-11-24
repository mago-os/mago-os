/**
 * Agenda simples (M5-07, decisão 0041): o calendário com as visões Dia, Semana e Mês (pedido do Sandro em
 * 24/11/2026), com os eventos meus e, se quiser, os de colegas lado a lado (uma cor por pessoa), marcar um evento
 * (tocando num horário vazio, já com o dia e a hora), e a página do evento com as respostas, editar e cancelar ("só este", "este e os seguintes" ou
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
import { useCallback, useEffect, useRef, useState } from "react";
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

type Visao = "dia" | "semana" | "mes";
const VISOES: { valor: Visao; nome: string }[] = [
  { valor: "dia", nome: "Dia" },
  { valor: "semana", nome: "Semana" },
  { valor: "mes", nome: "Mês" },
];
/** Altura de uma hora na grade (px). */
const HORA_PX = 48;
const HORAS = Array.from({ length: 24 }, (_, h) => h);
const NOMES_DOS_DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
/** Uma cor por pessoa na agenda (a primeira é a de quem olha). */
const CORES = [
  "border-secundaria bg-secundaria/15",
  "border-agente bg-agente/15",
  "border-ok bg-ok/15",
  "border-perigo bg-perigo/15",
  "border-texto-3 bg-suave text-texto-2",
];
const CHAVE_DA_VISAO = "mago-agenda-visao";

function lerVisao(): Visao {
  try {
    const v = localStorage.getItem(CHAVE_DA_VISAO);
    return v === "dia" || v === "semana" || v === "mes" ? v : "semana";
  } catch {
    return "semana";
  }
}

function guardarVisao(v: Visao) {
  try {
    localStorage.setItem(CHAVE_DA_VISAO, v);
  } catch {
    // Sem armazenamento (janela anônima): só não lembra a visão.
  }
}

/** Os dias que a visão mostra: o dia, a semana (seg a dom) ou as semanas inteiras do mês. */
function diasDaVisao(visao: Visao, referencia: string): string[] {
  if (visao === "dia") return [referencia];
  if (visao === "semana") return Array.from({ length: 7 }, (_, i) => somarDias(segundaDe(referencia), i));
  const primeiro = `${referencia.slice(0, 8)}01`;
  const inicio = segundaDe(primeiro);
  const [a, m] = referencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const dias: string[] = [];
  for (let d = inicio; d <= ultimo || dias.length % 7 !== 0; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

function andar(visao: Visao, referencia: string, passo: number): string {
  if (visao === "dia") return somarDias(referencia, passo);
  if (visao === "semana") return somarDias(referencia, 7 * passo);
  const [a, m] = referencia.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m - 1 + passo, 1)).toISOString().slice(0, 10);
}

function tituloDaVisao(visao: Visao, referencia: string, dias: string[]): string {
  const data = (dia: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${dia}T12:00:00`).toLocaleDateString("pt-BR", o);
  if (visao === "dia")
    return data(referencia, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (visao === "mes") return data(referencia, { month: "long", year: "numeric" });
  const de = dias[0] as string;
  const ate = dias.at(-1) as string;
  return `${data(de, { day: "numeric", month: "short" })} a ${data(ate, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Os minutos do dia (no relógio de quem olha) em que a vez começa e acaba, cortada ao dia. */
function trechoNoDia(o: OcorrenciaNaAgenda, dia: string): { de: number; ate: number } | null {
  const inicio = new Date(o.inicioEm);
  const fim = new Date(o.fimEm);
  const zero = new Date(`${dia}T00:00:00`);
  const amanha = new Date(`${somarDias(dia, 1)}T00:00:00`);
  if (fim <= zero || inicio >= amanha) return null;
  const de = Math.max(0, (inicio.getTime() - zero.getTime()) / 60_000);
  const ate = Math.min(1440, (fim.getTime() - zero.getTime()) / 60_000);
  return ate > de ? { de, ate } : null;
}

/** Vai na faixa "dia todo": o evento de dia inteiro ou o que passa de um dia para o outro. */
function ehDoDiaTodo(o: OcorrenciaNaAgenda): boolean {
  if (o.diaInteiro) return true;
  return diaLocal(new Date(o.inicioEm)) !== diaLocal(new Date(new Date(o.fimEm).getTime() - 60_000));
}

function encostaNoDia(o: OcorrenciaNaAgenda, dia: string): boolean {
  return trechoNoDia(o, dia) !== null;
}

/** Colunas lado a lado para as vezes que se sobrepõem no dia. */
function colunasDoDia(itens: { o: OcorrenciaNaAgenda; de: number; ate: number }[]) {
  const ordenados = [...itens].sort((a, b) => a.de - b.de || b.ate - a.ate);
  const saida: { o: OcorrenciaNaAgenda; de: number; ate: number; coluna: number; colunas: number }[] = [];
  let grupo: typeof saida = [];
  let fimDoGrupo = -1;
  const fechar = () => {
    const n = Math.max(1, ...grupo.map((g) => g.coluna + 1));
    for (const g of grupo) g.colunas = n;
    saida.push(...grupo);
    grupo = [];
  };
  for (const item of ordenados) {
    if (item.de >= fimDoGrupo && grupo.length > 0) fechar();
    const ocupadas = grupo.filter((g) => g.ate > item.de).map((g) => g.coluna);
    let coluna = 0;
    while (ocupadas.includes(coluna)) coluna++;
    grupo.push({ ...item, coluna, colunas: 1 });
    fimDoGrupo = Math.max(fimDoGrupo, item.ate);
  }
  if (grupo.length > 0) fechar();
  return saida;
}

export function Agenda({ euId }: { euId: string }) {
  const [visao, setVisao] = useState<Visao>(lerVisao);
  const [referencia, setReferencia] = useState(diaLocal(new Date()));
  const [pessoas, setPessoas] = useState<string[]>([euId]);
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaNaAgenda[] | null>(null);
  const [criando, setCriando] = useState<{ dia: string; hora?: string } | null>(null);
  const todas = usePessoas();
  const nomeDe = (id: string) => (id === euId ? "Eu" : (todas.find((p) => p.id === id)?.nome ?? "Alguém"));
  const dias = diasDaVisao(visao, referencia);
  const primeiro = dias[0] as string;
  const ultimo = dias.at(-1) as string;
  const carregar = useCallback(async () => {
    const r = await pedir<{ ocorrencias: OcorrenciaNaAgenda[] }>(
      "GET",
      `/agenda?de=${primeiro}&ate=${ultimo}&pessoas=${pessoas.join(",")}`,
    );
    setOcorrencias(r.ok && r.dados ? r.dados.ocorrencias : []);
  }, [primeiro, ultimo, pessoas]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  const corDe = (o: OcorrenciaNaAgenda) => {
    if (o.ocupado) return CORES[4] as string;
    const i = pessoas.indexOf(o.pessoas[0] ?? euId);
    return CORES[Math.max(0, Math.min(3, i))] as string;
  };
  const mudarVisao = (v: Visao) => {
    setVisao(v);
    guardarVisao(v);
  };
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold tracking-tight">Agenda</h1>
        <Button variant="contorno" size="pequeno" onClick={() => setReferencia(diaLocal(new Date()))}>
          Hoje
        </Button>
        <Button
          variant="fantasma"
          size="pequeno"
          aria-label="Anterior"
          onClick={() => setReferencia(andar(visao, referencia, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="fantasma"
          size="pequeno"
          aria-label="Próximo"
          onClick={() => setReferencia(andar(visao, referencia, 1))}
        >
          <ChevronRight />
        </Button>
        <span className="font-semibold first-letter:uppercase">{tituloDaVisao(visao, referencia, dias)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <fieldset className="flex overflow-hidden rounded-md border border-linha" aria-label="Visão">
            {VISOES.map((v) => (
              <button
                key={v.valor}
                type="button"
                aria-pressed={visao === v.valor}
                onClick={() => mudarVisao(v.valor)}
                className={cn(
                  "px-3 py-1.5 text-sm",
                  visao === v.valor ? "bg-tinta text-sobre-tinta" : "bg-cartao hover:bg-suave",
                )}
              >
                {v.nome}
              </button>
            ))}
          </fieldset>
          <Button size="pequeno" onClick={() => setCriando({ dia: referencia })}>
            <Plus /> Novo evento
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {pessoas.map((p, i) => (
          <span
            key={p}
            className={cn("flex items-center gap-1 rounded-full border px-2.5 py-0.5", CORES[Math.min(3, i)])}
          >
            {nomeDe(p)}
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
        <select
          aria-label="Ver a agenda de um colega"
          className="h-8 rounded-md border border-linha bg-cartao px-2 text-sm"
          value=""
          onChange={(e) =>
            e.target.value && setPessoas([...new Set([...pessoas, e.target.value])].slice(0, 4))
          }
        >
          <option value="">+ ver a agenda de um colega</option>
          {todas
            .filter((p) => !pessoas.includes(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
        </select>
      </div>
      {criando && (
        <FormularioDoEvento
          key={`${criando.dia}-${criando.hora ?? ""}`}
          euId={euId}
          sugestao={criando}
          aoCancelar={() => setCriando(null)}
          aoSalvar={() => {
            setCriando(null);
            void carregar();
          }}
        />
      )}
      {visao === "mes" ? (
        <GradeDoMes
          dias={dias}
          mes={referencia.slice(0, 7)}
          ocorrencias={ocorrencias ?? []}
          corDe={corDe}
          aoAbrirDia={(dia) => {
            setReferencia(dia);
            mudarVisao("dia");
          }}
          aoCriar={(dia) => setCriando({ dia })}
        />
      ) : (
        <GradeDeHoras
          dias={dias}
          ocorrencias={ocorrencias ?? []}
          corDe={corDe}
          nomeDe={pessoas.length > 1 ? nomeDe : null}
          aoCriar={(dia, h) => setCriando({ dia, hora: h })}
        />
      )}
    </main>
  );
}

function linkDa(o: OcorrenciaNaAgenda): string | undefined {
  return o.ocupado ? undefined : `/agenda/${o.eventoId}?dia=${o.ocorrencia}`;
}

function GradeDeHoras({
  dias,
  ocorrencias,
  corDe,
  nomeDe,
  aoCriar,
}: {
  dias: string[];
  ocorrencias: OcorrenciaNaAgenda[];
  corDe: (o: OcorrenciaNaAgenda) => string;
  nomeDe: ((id: string) => string) | null;
  aoCriar: (dia: string, hora: string) => void;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [agora, setAgora] = useState(new Date());
  useEffect(() => {
    // Abre perto das 7h; a linha de agora anda a cada minuto.
    if (rolagem.current) rolagem.current.scrollTop = 7 * HORA_PX;
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const hoje = diaLocal(agora);
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
  const colunas = `3.5rem repeat(${dias.length}, minmax(0, 1fr))`;
  const doDiaTodo = (dia: string) => ocorrencias.filter((o) => ehDoDiaTodo(o) && encostaNoDia(o, dia));
  const temDiaTodo = dias.some((d) => doDiaTodo(d).length > 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-linha bg-cartao">
      <div className={cn(dias.length > 1 && "min-w-[44rem]")}>
        <div className="grid border-b border-linha" style={{ gridTemplateColumns: colunas }}>
          <div />
          {dias.map((dia, i) => (
            <div key={dia} className={cn("p-2 text-center text-xs", dia === hoje && "font-bold text-tinta")}>
              {dias.length > 1 && <span className="block text-texto-2">{NOMES_DOS_DIAS[i]}</span>}
              <span className="text-base">{Number(dia.slice(8, 10))}</span>
            </div>
          ))}
        </div>
        {temDiaTodo && (
          <div className="grid border-b border-linha" style={{ gridTemplateColumns: colunas }}>
            <div className="p-1 text-right text-[0.65rem] text-texto-2">dia todo</div>
            {dias.map((dia) => (
              <div key={dia} className="grid content-start gap-0.5 border-l border-linha p-0.5">
                {doDiaTodo(dia).map((o) => (
                  <a
                    key={`${o.eventoId}:${o.ocorrencia}`}
                    href={linkDa(o)}
                    className={cn("truncate rounded border-l-4 px-1.5 py-0.5 text-xs", corDe(o))}
                    title={o.titulo ?? "Ocupado"}
                  >
                    {o.titulo ?? "Ocupado"}
                  </a>
                ))}
              </div>
            ))}
          </div>
        )}
        <div ref={rolagem} className="max-h-[36rem] overflow-y-auto">
          <div className="relative grid" style={{ gridTemplateColumns: colunas, height: 24 * HORA_PX }}>
            <div className="relative">
              {HORAS.map((h) => (
                <span
                  key={h}
                  className="absolute right-1 -translate-y-1/2 text-[0.65rem] text-texto-2"
                  style={{ top: h * HORA_PX }}
                >
                  {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>
            {dias.map((dia) => {
              const itens = colunasDoDia(
                ocorrencias
                  .filter((o) => !ehDoDiaTodo(o))
                  .flatMap((o) => {
                    const t = trechoNoDia(o, dia);
                    return t ? [{ o, ...t }] : [];
                  }),
              );
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: o teclado usa o botão "Novo evento"
                <section
                  key={dia}
                  aria-label={`Dia ${dia}`}
                  className="relative border-l border-linha"
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const y = e.nativeEvent.offsetY;
                    const meiaHora = Math.floor(y / (HORA_PX / 2));
                    const h = Math.min(23, Math.floor(meiaHora / 2));
                    aoCriar(dia, `${String(h).padStart(2, "0")}:${meiaHora % 2 === 0 ? "00" : "30"}`);
                  }}
                >
                  {HORAS.map((h) => (
                    <div
                      key={h}
                      className="pointer-events-none absolute inset-x-0 border-t border-linha/60"
                      style={{ top: h * HORA_PX }}
                    />
                  ))}
                  {dia === hoje && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-perigo"
                      style={{ top: (minutosAgora / 60) * HORA_PX }}
                    />
                  )}
                  {itens.map(({ o, de, ate, coluna, colunas: n }) => (
                    <a
                      key={`${o.eventoId}:${o.ocorrencia}`}
                      href={linkDa(o)}
                      className={cn(
                        "absolute overflow-hidden rounded border-l-4 px-1.5 py-0.5 text-xs leading-tight shadow-sm",
                        corDe(o),
                        !o.ocupado && "hover:brightness-95",
                      )}
                      style={{
                        top: (de / 60) * HORA_PX + 1,
                        height: Math.max(20, ((ate - de) / 60) * HORA_PX - 2),
                        left: `calc(${(coluna / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                      }}
                      title={`${hora(o.inicioEm)}–${hora(o.fimEm)} ${o.titulo ?? "Ocupado"}`}
                    >
                      <span className="block truncate font-medium">{o.titulo ?? "Ocupado"}</span>
                      <span className="block truncate text-texto-2">
                        {hora(o.inicioEm)}–{hora(o.fimEm)}
                        {nomeDe && o.pessoas.length > 0 ? ` · ${o.pessoas.map(nomeDe).join(", ")}` : ""}
                      </span>
                    </a>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function GradeDoMes({
  dias,
  mes,
  ocorrencias,
  corDe,
  aoAbrirDia,
  aoCriar,
}: {
  dias: string[];
  mes: string;
  ocorrencias: OcorrenciaNaAgenda[];
  corDe: (o: OcorrenciaNaAgenda) => string;
  aoAbrirDia: (dia: string) => void;
  aoCriar: (dia: string) => void;
}) {
  const hoje = diaLocal(new Date());
  const MAXIMO = 3;
  return (
    <div className="overflow-hidden rounded-lg border border-linha">
      <div className="grid grid-cols-7 bg-suave text-center text-xs font-medium text-texto-2">
        {NOMES_DOS_DIAS.map((d) => (
          <div key={d} className="p-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-linha">
        {dias.map((dia) => {
          const doDia = ocorrencias.filter((o) => encostaNoDia(o, dia));
          const foraDoMes = dia.slice(0, 7) !== mes;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: o teclado usa o botão "Novo evento"
            <section
              key={dia}
              aria-label={`Dia ${dia}`}
              className={cn(
                "grid min-h-24 content-start gap-0.5 bg-cartao p-1",
                foraDoMes && "bg-suave/60 text-texto-2",
              )}
              onClick={(e) => e.target === e.currentTarget && aoCriar(dia)}
            >
              <button
                type="button"
                onClick={() => aoAbrirDia(dia)}
                className={cn(
                  "ml-auto grid size-6 place-items-center rounded-full text-xs hover:bg-suave",
                  dia === hoje && "bg-tinta font-bold text-sobre-tinta hover:bg-tinta",
                )}
                aria-label={`Abrir o dia ${dia}`}
              >
                {Number(dia.slice(8, 10))}
              </button>
              {doDia.slice(0, MAXIMO).map((o) => (
                <a
                  key={`${o.eventoId}:${o.ocorrencia}`}
                  href={linkDa(o)}
                  className={cn("truncate rounded border-l-4 px-1 py-0.5 text-[0.7rem]", corDe(o))}
                  title={o.titulo ?? "Ocupado"}
                >
                  {ehDoDiaTodo(o) ? "" : `${hora(o.inicioEm)} `}
                  {o.titulo ?? "Ocupado"}
                </a>
              ))}
              {doDia.length > MAXIMO && (
                <button
                  type="button"
                  className="text-left text-[0.7rem] text-tinta"
                  onClick={() => aoAbrirDia(dia)}
                >
                  + {doDia.length - MAXIMO} mais
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
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
  sugestao,
  aoCancelar,
  aoSalvar,
}: {
  euId: string;
  inicial?: EventoDaAgenda;
  alcance?: { valor: AlcanceDaMudanca; dia: string } | undefined;
  /** No evento novo: o dia (e a hora) do horário tocado no calendário. */
  sugestao?: { dia: string; hora?: string | undefined } | undefined;
  aoCancelar: () => void;
  aoSalvar: (e: EventoDaAgenda) => void;
}) {
  const pessoas = usePessoas();
  const hoje = diaLocal(new Date());
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [diaInteiro, setDiaInteiro] = useState(inicial?.diaInteiro ?? false);
  const [dia, setDia] = useState(
    alcance && alcance.valor !== "todos" ? alcance.dia : (inicial?.inicio.dia ?? sugestao?.dia ?? hoje),
  );
  const horaSugerida = sugestao?.hora ?? "15:00";
  const [inicio, setInicio] = useState(inicial?.inicio.hora ?? horaSugerida);
  const [fim, setFim] = useState(
    inicial?.fim.hora ??
      (Number(horaSugerida.slice(0, 2)) >= 23
        ? "23:59"
        : `${String(Number(horaSugerida.slice(0, 2)) + 1).padStart(2, "0")}:${horaSugerida.slice(3, 5)}`),
  );
  // Numa vez da série, o fim fica a mesma distância do começo (eventos de mais de um dia).
  const duracao = inicial
    ? Math.round((Date.parse(inicial.fim.dia) - Date.parse(inicial.inicio.dia)) / 86_400_000)
    : 0;
  const [diaDoFim, setDiaDoFim] = useState(
    inicial ? new Date(Date.parse(dia) + duracao * 86_400_000).toISOString().slice(0, 10) : dia,
  );
  const [local, setLocal] = useState(inicial?.local ?? "");
  const [link, setLink] = useState(inicial?.link ?? "");
  const [participantes, setParticipantes] = useState<string[]>(
    inicial?.participantes.map((p) => p.pessoaId).filter((p) => p !== inicial.criadoPor) ?? [],
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
      // Na edição, a repetição só vai se a pessoa mudou o "Repetir" (senão a regra fica como estava, inteira).
      ...(!inicial || repetir !== (inicial.regra?.frequencia ?? "")
        ? { regra: repetir ? { frequencia: repetir, intervalo: 1 } : null }
        : {}),
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
              .filter((p) => p.id !== (inicial?.criadoPor ?? euId))
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
