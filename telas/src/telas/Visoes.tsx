/**
 * Visões das tarefas (M3-04): lista (agrupada, com mudar várias de uma vez), Kanban (uma coluna por status, arrastar
 * muda o status) e calendário (mês ou semana, arrastar muda o prazo), com filtros e visões salvas. Vale para todas as
 * tarefas que a pessoa vê, um espaço ou um projeto: a mesma rota e a mesma permissão por trás.
 */
import {
  type Agrupamento,
  type FiltroDeTarefas,
  NOMES_PRIORIDADE,
  NOMES_STATUS_TAREFA,
  PRIORIDADES,
  type Prioridade,
  type Responsavel,
  STATUS_TAREFA,
  type StatusDoProjeto,
  type StatusTarefa,
  type Tarefa,
  type TipoDeVisao,
  type VisaoSalva,
} from "@mago-os/contratos";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lerPerfil } from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { cn } from "@/lib/utils";
import {
  buscarTarefas,
  excluirVisao,
  type ListaDeTarefas,
  listarVisoes,
  mudarStatus,
  planejarTarefa,
  salvarVisao,
  trocarResponsavel,
} from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { useAoVoltar } from "./Administrador";
import { diaBr, MarcaDePrazo, MarcaDePrioridade } from "./Planejamento";
import {
  Etiqueta,
  Filtro,
  MarcaDeAgente,
  nomeDe,
  responsavelDoValor,
  SeletorDeResponsavel,
  useAgentesAtivos,
  useDestaques,
  usePessoas,
} from "./Tarefas";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;
const ABERTOS: StatusTarefa[] = ["a_fazer", "em_andamento", "precisa_de_ajuda"];

/** O que a pessoa escolheu na barra de filtros (vira o FiltroDeTarefas da rota). */
interface Escolhas {
  minhas: boolean;
  abertas: boolean;
  prazo: "" | NonNullable<FiltroDeTarefas["prazo"]>;
  prioridade: "" | Prioridade | "sem";
  responsavel: string;
  deAgente: boolean;
  /** Texto livre (título, descrição e comentários). */
  texto: string;
}

const ESCOLHAS_PADRAO: Escolhas = {
  minhas: true,
  abertas: true,
  prazo: "",
  prioridade: "",
  responsavel: "",
  deAgente: false,
  texto: "",
};

function filtroDasEscolhas(e: Escolhas, escopo: { projetoId?: string }): FiltroDeTarefas {
  const responsavel = responsavelDoValor(e.responsavel);
  return {
    ...(escopo.projetoId ? { projetoId: escopo.projetoId } : e.minhas ? { minhas: true } : {}),
    ...(e.abertas ? { status: ABERTOS } : {}),
    ...(e.prazo ? { prazo: e.prazo } : {}),
    ...(e.prioridade ? { prioridades: [e.prioridade] } : {}),
    ...(responsavel ? { responsaveis: [responsavel] } : {}),
    ...(e.deAgente ? { deAgente: true } : {}),
    ...(e.texto.trim().length >= 2 ? { texto: e.texto.trim() } : {}),
  };
}

function escolhasDoFiltro(f: FiltroDeTarefas): Escolhas {
  const r: Responsavel | undefined = f.responsaveis?.[0];
  return {
    minhas: f.minhas === true,
    abertas: (f.status?.length ?? 0) > 0,
    prazo: f.prazo ?? "",
    prioridade: f.prioridades?.[0] ?? "",
    responsavel: r ? (r.tipo === "pessoa" ? r.pessoaId : `agente:${r.agenteId}`) : "",
    deAgente: f.deAgente === true,
    texto: f.texto ?? "",
  };
}

/**
 * Dia (AAAA-MM-DD) em que a tarefa cai no calendário de quem vê, no fuso da pessoa (o mesmo que o servidor usa no
 * filtro): prazo com hora, o dia daquele momento no fuso dela; só o dia, o próprio dia.
 */
function diaNoCalendario(t: Tarefa, fuso?: string): string | null {
  if (!t.prazo) return null;
  if (t.prazo.hora === null) return t.prazo.dia;
  return partesNoFuso(new Date(t.prazo.em), fuso).dia;
}

/** Dia e hora (HH:MM) de um momento no fuso dado (ou no do navegador). */
function partesNoFuso(momento: Date, fuso?: string): { dia: string; hora: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    ...(fuso ? { timeZone: fuso } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(momento).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/** O fuso da pessoa (do perfil), para o calendário bater com o filtro do servidor. */
function useFusoDaPessoa(): string | undefined {
  const [fuso, setFuso] = useState<string | undefined>(undefined);
  useEffect(() => {
    void lerPerfil().then((p) => setFuso(p?.fusoHorario));
  }, []);
  return fuso;
}

const textoDoDia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hojeLocal = () => textoDoDia(new Date());

export function VisoesDeTarefas({
  escopo: escopoRecebido = {},
  statusDoProjeto = [],
  listas = [],
  podeEditar,
  visaoInicial = "lista",
  agrupamentoInicial = null,
  vazio = "Nenhuma tarefa por aqui.",
}: {
  escopo?: { projetoId?: string };
  /** No projeto, as colunas do Kanban são os status dele. */
  statusDoProjeto?: StatusDoProjeto[];
  listas?: { id: string; nome: string }[];
  podeEditar: boolean;
  visaoInicial?: TipoDeVisao;
  agrupamentoInicial?: Agrupamento | null;
  vazio?: string;
}) {
  // O escopo vem como objeto novo a cada render: guardar pelo id evita buscar de novo sem parar.
  const projetoId = escopoRecebido.projetoId;
  const escopo = useMemo(() => (projetoId ? { projetoId } : {}), [projetoId]);
  const fuso = useFusoDaPessoa();
  const [visao, setVisao] = useState<TipoDeVisao>(visaoInicial);
  const [escolhas, setEscolhas] = useState<Escolhas>(
    escopo.projetoId ? { ...ESCOLHAS_PADRAO, minhas: false } : ESCOLHAS_PADRAO,
  );
  const [agruparPor, setAgruparPor] = useState<Agrupamento | null>(agrupamentoInicial);
  const [lista, setLista] = useState<ListaDeTarefas | null>(null);
  const [semPrazo, setSemPrazo] = useState<Tarefa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [referencia, setReferencia] = useState(() => new Date());
  const [modoDoCalendario, setModoDoCalendario] = useState<"mes" | "semana">("mes");
  const [salvas, setSalvas] = useState<VisaoSalva[]>([]);
  const pessoas = usePessoas();
  const agentes = useAgentesAtivos();

  const dias = useMemo(() => diasDoCalendario(referencia, modoDoCalendario), [referencia, modoDoCalendario]);
  const filtro = useMemo<FiltroDeTarefas>(() => {
    const base = filtroDasEscolhas(escolhas, escopo);
    if (visao === "kanban") {
      // O Kanban mostra todas as colunas, inclusive as encerradas, e as subtarefas ficam dentro das mães.
      const { status: _, ...semStatus } = base;
      return { ...semStatus, subtarefas: false };
    }
    if (visao === "calendario") return { ...base, de: dias[0] as string, ate: dias.at(-1) as string };
    return base;
  }, [escolhas, escopo, visao, dias]);

  const ultimoPedido = useRef(0);
  const carregar = useCallback(async () => {
    const numero = ++ultimoPedido.current;
    const [r, sem] = await Promise.all([
      buscarTarefas(filtro),
      visao === "calendario"
        ? buscarTarefas({ ...filtroDasEscolhas(escolhas, escopo), prazo: "sem_prazo" })
        : Promise.resolve(null),
    ]);
    if (numero !== ultimoPedido.current) return;
    if (r.ok && r.dados) {
      setLista(r.dados);
      setErro(null);
    } else setErro(r.mensagem ?? null);
    setSemPrazo(sem?.dados?.tarefas ?? []);
  }, [filtro, visao, escolhas, escopo]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);
  const [destaques, destacar] = useDestaques();
  useTempoReal((aviso) => {
    if (aviso.tipo === "reconectou") void carregar();
    if (aviso.tipo === "tarefa") {
      void carregar();
      destacar(aviso.id);
    }
  });
  // Só as visões do mesmo lugar: as de um projeto aparecem nele; as gerais, na tela de tarefas.
  const carregarSalvas = useCallback(
    async () =>
      setSalvas(((await listarVisoes()).dados?.visoes ?? []).filter((v) => v.filtro.projetoId === projetoId)),
    [projetoId],
  );
  useEffect(() => {
    void carregarSalvas();
  }, [carregarSalvas]);

  const mudar = (m: Partial<Escolhas>) => setEscolhas((e) => ({ ...e, ...m }));
  // O texto digitado vira filtro depois de uma pausa curta (não pede ao servidor a cada letra).
  const [textoDigitado, setTextoDigitado] = useState("");
  useEffect(() => setTextoDigitado(escolhas.texto), [escolhas.texto]);
  useEffect(() => {
    const espera = setTimeout(
      () => setEscolhas((e) => (e.texto === textoDigitado ? e : { ...e, texto: textoDigitado })),
      400,
    );
    return () => clearTimeout(espera);
  }, [textoDigitado]);

  async function aoSalvarVisao() {
    const nome = window.prompt("Nome da visão (ex.: Atrasadas do Mago OS)")?.trim();
    if (!nome) return;
    const r = await salvarVisao({
      nome,
      tipo: visao,
      filtro: filtroDasEscolhas(escolhas, escopo),
      ...(visao === "lista" ? { agruparPor } : {}),
    });
    setMensagem(
      r.ok ? { tipo: "ok", texto: `Visão "${nome}" salva.` } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregarSalvas();
  }

  function aoAbrirVisao(v: VisaoSalva) {
    setVisao(v.tipo);
    setEscolhas(escolhasDoFiltro(v.filtro));
    setAgruparPor(v.agruparPor);
  }

  async function aoExcluirVisao(v: VisaoSalva) {
    if (!window.confirm(`Apagar a visão ${v.nome}?`)) return;
    const r = await excluirVisao(v.id);
    if (!r.ok) setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    void carregarSalvas();
  }

  const tarefas = lista?.tarefas ?? [];
  const nomes = { ...(lista?.nomes ?? {}), ...Object.fromEntries(pessoas.map((p) => [p.id, p.nome])) };

  return (
    <section className="grid gap-3" aria-label="Visões das tarefas">
      {salvas.length > 0 && (
        <nav aria-label="Visões salvas" className="flex flex-wrap gap-2">
          {salvas.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center rounded-full border border-linha bg-cartao text-sm"
            >
              <button type="button" className="py-1 pl-3" onClick={() => aoAbrirVisao(v)}>
                {v.nome}
              </button>
              <button
                type="button"
                aria-label={`Apagar a visão ${v.nome}`}
                className="px-2 py-1 text-texto-2 hover:text-perigo"
                onClick={() => void aoExcluirVisao(v)}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Visão">
        {(["lista", "kanban", "calendario"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={visao === v}
            onClick={() => setVisao(v)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              visao === v ? "bg-tinta text-sobre-tinta" : "text-texto-2 hover:bg-suave",
            )}
          >
            {{ lista: "Lista", kanban: "Kanban", calendario: "Calendário" }[v]}
          </button>
        ))}
        <Button variant="fantasma" size="pequeno" className="ml-auto" onClick={() => void aoSalvarVisao()}>
          Salvar visão
        </Button>
      </div>

      <input
        type="search"
        aria-label="Procurar nas tarefas"
        placeholder="Procurar no título, na descrição ou nos comentários"
        value={textoDigitado}
        onChange={(e) => setTextoDigitado(e.target.value)}
        maxLength={200}
        className="h-10 w-full min-w-0 rounded-md border border-linha bg-cartao px-3 text-sm"
      />
      <fieldset className="flex flex-wrap items-center gap-2" aria-label="Filtros">
        {!escopo.projetoId && (
          <>
            <Filtro ativo={escolhas.minhas} aoClicar={() => mudar({ minhas: true })}>
              Minhas
            </Filtro>
            <Filtro ativo={!escolhas.minhas} aoClicar={() => mudar({ minhas: false })}>
              Todas que vejo
            </Filtro>
            <span className="w-px self-stretch bg-linha" />
          </>
        )}
        {visao !== "kanban" && (
          <>
            <Filtro ativo={escolhas.abertas} aoClicar={() => mudar({ abertas: true })}>
              Abertas
            </Filtro>
            <Filtro ativo={!escolhas.abertas} aoClicar={() => mudar({ abertas: false })}>
              Todas
            </Filtro>
          </>
        )}
        <select
          aria-label="Prazo"
          className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
          value={escolhas.prazo}
          onChange={(e) => mudar({ prazo: e.target.value as Escolhas["prazo"] })}
        >
          <option value="">Qualquer prazo</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="hoje">Vencem hoje</option>
          <option value="semana">Próximos 7 dias</option>
          <option value="sem_prazo">Sem prazo</option>
        </select>
        <select
          aria-label="Prioridade"
          className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
          value={escolhas.prioridade}
          onChange={(e) => mudar({ prioridade: e.target.value as Escolhas["prioridade"] })}
        >
          <option value="">Qualquer prioridade</option>
          {PRIORIDADES.map((p) => (
            <option key={p} value={p}>
              {NOMES_PRIORIDADE[p]}
            </option>
          ))}
          <option value="sem">Sem prioridade</option>
        </select>
        <SeletorDeResponsavel
          id="filtro-responsavel"
          valor={escolhas.responsavel}
          aoMudar={(v) => mudar({ responsavel: v })}
          pessoas={pessoas}
          agentes={agentes}
          extras={[{ valor: "", nome: "Qualquer responsável" }]}
        />
        <Filtro ativo={escolhas.deAgente} aoClicar={() => mudar({ deAgente: !escolhas.deAgente })}>
          Com agentes
        </Filtro>
        {visao === "lista" && (
          <select
            aria-label="Agrupar por"
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value={agruparPor ?? ""}
            onChange={(e) => setAgruparPor((e.target.value || null) as Agrupamento | null)}
          >
            <option value="">Sem agrupar</option>
            <option value="status">Agrupar por status</option>
            {listas.length > 0 && <option value="lista">Agrupar por lista</option>}
            <option value="responsavel">Agrupar por responsável</option>
            <option value="prioridade">Agrupar por prioridade</option>
            <option value="prazo">Agrupar por prazo</option>
          </select>
        )}
      </fieldset>

      {erro && <Aviso tipo="erro" texto={erro} />}
      {mensagem && <Aviso {...mensagem} />}
      {tarefas.length >= 200 && (
        <p className="text-xs text-texto-2">
          Mostrando as 200 tarefas mudadas mais recentemente. Use os filtros para ver as outras.
        </p>
      )}

      {visao === "lista" && (
        <VisaoEmLista
          tarefas={tarefas}
          nomes={nomes}
          resumo={lista?.subtarefas ?? {}}
          agruparPor={agruparPor}
          statusDoProjeto={statusDoProjeto}
          listas={listas}
          destaques={destaques}
          podeEditar={podeEditar}
          pessoas={pessoas}
          agentes={agentes}
          vazio={lista ? vazio : null}
          fuso={fuso}
          aoMudar={(m) => {
            setMensagem(m);
            void carregar();
          }}
        />
      )}
      {visao === "kanban" && (
        <VisaoKanban
          tarefas={tarefas}
          nomes={nomes}
          statusDoProjeto={statusDoProjeto}
          podeEditar={podeEditar}
          aoMudar={(m) => {
            setMensagem(m);
            void carregar();
          }}
        />
      )}
      {visao === "calendario" && (
        <VisaoCalendario
          tarefas={tarefas}
          semPrazo={semPrazo}
          dias={dias}
          referencia={referencia}
          modo={modoDoCalendario}
          fuso={fuso}
          podeEditar={podeEditar}
          aoMudarModo={setModoDoCalendario}
          aoNavegar={(passo) => setReferencia((r) => andar(r, modoDoCalendario, passo))}
          aoMudar={(m) => {
            setMensagem(m);
            void carregar();
          }}
        />
      )}
    </section>
  );
}

// Lista -----------------------------------------------------------------------------------------------------------

function grupoDe(
  t: Tarefa,
  fuso: string | undefined,
  por: Agrupamento,
  nomes: Record<string, string>,
  statusDoProjeto: StatusDoProjeto[],
  listas: { id: string; nome: string }[],
): string {
  switch (por) {
    case "status":
      return statusDoProjeto.find((s) => s.id === t.statusDoProjetoId)?.nome ?? NOMES_STATUS_TAREFA[t.status];
    case "lista":
      return listas.find((l) => l.id === t.listaId)?.nome ?? "Sem lista";
    case "responsavel":
      return nomeDe(t.responsavel, nomes);
    case "prioridade":
      return t.prioridade ? NOMES_PRIORIDADE[t.prioridade] : "Sem prioridade";
    case "prazo": {
      const dia = diaNoCalendario(t, fuso);
      if (!dia) return "Sem prazo";
      const hoje = hojeLocal();
      if (dia < hoje) return "Atrasadas";
      if (dia === hoje) return "Hoje";
      const semana = textoDoDia(new Date(Date.now() + 7 * 86_400_000));
      return dia <= semana ? "Próximos 7 dias" : "Depois";
    }
  }
}

const ORDEM_DOS_GRUPOS: Partial<Record<Agrupamento, string[]>> = {
  prioridade: [...PRIORIDADES.map((p) => NOMES_PRIORIDADE[p]), "Sem prioridade"],
  prazo: ["Atrasadas", "Hoje", "Próximos 7 dias", "Depois", "Sem prazo"],
};

function VisaoEmLista({
  tarefas,
  nomes,
  resumo,
  agruparPor,
  statusDoProjeto,
  listas,
  destaques,
  podeEditar,
  pessoas,
  agentes,
  vazio,
  fuso,
  aoMudar,
}: {
  fuso: string | undefined;
  tarefas: Tarefa[];
  nomes: Record<string, string>;
  resumo: Record<string, { total: number; prontas: number }>;
  agruparPor: Agrupamento | null;
  statusDoProjeto: StatusDoProjeto[];
  listas: { id: string; nome: string }[];
  destaques: Set<string>;
  podeEditar: boolean;
  pessoas: ReturnType<typeof usePessoas>;
  agentes: ReturnType<typeof useAgentesAtivos>;
  vazio: string | null;
  aoMudar: (m: Mensagem) => void;
}) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const grupos = useMemo(() => {
    if (!agruparPor) return [["", tarefas]] as [string, Tarefa[]][];
    const mapa = new Map<string, Tarefa[]>();
    for (const t of tarefas) {
      const g = grupoDe(t, fuso, agruparPor, nomes, statusDoProjeto, listas);
      mapa.set(g, [...(mapa.get(g) ?? []), t]);
    }
    const ordem = ORDEM_DOS_GRUPOS[agruparPor];
    return [...mapa.entries()].sort(([a], [b]) =>
      ordem ? ordem.indexOf(a) - ordem.indexOf(b) : a.localeCompare(b, "pt-BR"),
    );
  }, [tarefas, fuso, agruparPor, nomes, statusDoProjeto, listas]);

  /** Muda as tarefas marcadas, uma por uma, pelas rotas de sempre (cada uma com permissão, trava e auditoria). */
  async function emMassa(mudanca: (id: string) => Promise<{ ok: boolean }>) {
    const ids = [...marcadas];
    let certas = 0;
    // Cinco de cada vez: rápido sem sobrecarregar a API.
    for (let i = 0; i < ids.length; i += 5) {
      const lote = await Promise.all(ids.slice(i, i + 5).map(mudanca));
      certas += lote.filter((r) => r.ok).length;
    }
    setMarcadas(new Set());
    const recusadas = ids.length - certas;
    aoMudar(
      recusadas === 0
        ? { tipo: "ok", texto: `${certas} ${certas === 1 ? "tarefa mudada" : "tarefas mudadas"}.` }
        : {
            tipo: "erro",
            texto: `${certas} mudadas e ${recusadas} recusadas (travadas com outra pessoa ou sem permissão).`,
          },
    );
  }

  if (tarefas.length === 0) return vazio ? <p className="text-sm text-texto-2">{vazio}</p> : null;
  return (
    <div className="grid gap-3">
      {podeEditar && marcadas.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-tinta/30 bg-suave p-2 text-sm">
          <span className="font-medium">{marcadas.size} marcadas</span>
          <select
            aria-label="Mudar o status das marcadas"
            className="h-9 rounded-md border border-linha bg-cartao px-2"
            value=""
            onChange={(e) => {
              const s = e.target.value as StatusTarefa;
              if (s) void emMassa((id) => mudarStatus(id, s));
            }}
          >
            <option value="">Mudar status</option>
            {STATUS_TAREFA.map((s) => (
              <option key={s} value={s}>
                {NOMES_STATUS_TAREFA[s]}
              </option>
            ))}
          </select>
          <SeletorDeResponsavel
            id="responsavel-das-marcadas"
            valor=""
            aoMudar={(v) => {
              if (v)
                void emMassa((id) => trocarResponsavel(id, v === "nenhum" ? null : responsavelDoValor(v)));
            }}
            pessoas={pessoas}
            agentes={agentes}
            extras={[
              { valor: "", nome: "Trocar responsável" },
              { valor: "nenhum", nome: "Sem responsável" },
            ]}
          />
          <label className="flex items-center gap-1">
            Prazo
            <input
              type="date"
              aria-label="Prazo das marcadas"
              className="h-9 rounded-md border border-linha bg-cartao px-2"
              onChange={(e) => {
                const dia = e.target.value;
                if (dia) void emMassa((id) => planejarTarefa(id, { prazo: { dia } }));
              }}
            />
          </label>
          <Button variant="fantasma" size="pequeno" onClick={() => setMarcadas(new Set())}>
            Desmarcar
          </Button>
        </div>
      )}
      {grupos.map(([grupo, doGrupo]) => (
        <div key={grupo || "todas"} className="grid gap-2">
          {grupo && (
            <h3 className="text-sm font-semibold text-texto-2">
              {grupo} <span className="font-normal">({doGrupo.length})</span>
            </h3>
          )}
          <ul className="grid gap-2">
            {doGrupo.map((t) => {
              const sub = resumo[t.id];
              return (
                <li key={t.id} className="flex items-stretch gap-2">
                  {podeEditar && (
                    <input
                      type="checkbox"
                      aria-label={`Marcar ${t.titulo}`}
                      className="mt-4 size-4 shrink-0"
                      checked={marcadas.has(t.id)}
                      onChange={(e) =>
                        setMarcadas((m) => {
                          const nova = new Set(m);
                          if (e.target.checked) nova.add(t.id);
                          else nova.delete(t.id);
                          return nova;
                        })
                      }
                    />
                  )}
                  <a
                    href={`/tarefas/${t.id}`}
                    data-destaque={destaques.has(t.id) || undefined}
                    className={cn(
                      "grid flex-1 gap-1.5 rounded-lg border border-linha bg-cartao p-3 transition-colors duration-700 hover:bg-suave",
                      destaques.has(t.id) && "border-tinta/40 bg-suave",
                    )}
                  >
                    <span className="font-medium text-pretty">{t.titulo}</span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                      <MarcaDeStatus tarefa={t} statusDoProjeto={statusDoProjeto} />
                      <MarcaDePrioridade prioridade={t.prioridade} />
                      <span>{nomeDe(t.responsavel, nomes)}</span>
                      <MarcaDeAgente quem={t.responsavel} />
                      {sub && (
                        <span>
                          {sub.prontas}/{sub.total} subtarefas
                        </span>
                      )}
                      <span className="ml-auto">
                        <MarcaDePrazo tarefa={t} />
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MarcaDeStatus({ tarefa, statusDoProjeto }: { tarefa: Tarefa; statusDoProjeto: StatusDoProjeto[] }) {
  const s = statusDoProjeto.find((x) => x.id === tarefa.statusDoProjetoId);
  if (!s) return <Etiqueta status={tarefa.status} />;
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-suave px-2.5 py-0.5 font-medium">
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: s.cor }} />
      {s.nome}
    </span>
  );
}

// Kanban ----------------------------------------------------------------------------------------------------------

interface Coluna {
  id: string;
  nome: string;
  tipo: StatusTarefa;
  statusId: string | null;
  cor: string | null;
}

function VisaoKanban({
  tarefas,
  nomes,
  statusDoProjeto,
  podeEditar,
  aoMudar,
}: {
  tarefas: Tarefa[];
  nomes: Record<string, string>;
  statusDoProjeto: StatusDoProjeto[];
  podeEditar: boolean;
  aoMudar: (m: Mensagem) => void;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const colunas: Coluna[] =
    statusDoProjeto.length > 0
      ? statusDoProjeto.map((s) => ({ id: s.id, nome: s.nome, tipo: s.tipo, statusId: s.id, cor: s.cor }))
      : STATUS_TAREFA.map((s) => ({
          id: s,
          nome: NOMES_STATUS_TAREFA[s],
          tipo: s,
          statusId: null,
          cor: null,
        }));
  const daColuna = (c: Coluna) =>
    tarefas.filter((t) =>
      c.statusId
        ? t.statusDoProjetoId === c.statusId
        : t.status === c.tipo && (statusDoProjeto.length === 0 || !t.statusDoProjetoId),
    );

  /** Pôr numa coluna: muda o status (pôr em andamento é pegar a tarefa, como na tela da tarefa). */
  async function mover(id: string, c: Coluna) {
    const t = tarefas.find((x) => x.id === id);
    if (!t || (t.statusDoProjetoId === c.statusId && t.status === c.tipo)) return;
    const r = await mudarStatus(id, c.tipo, c.statusId ? { statusId: c.statusId } : {});
    aoMudar(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "Não foi possível mover a tarefa." });
  }

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
      {colunas.map((c) => {
        const cartoes = daColuna(c);
        return (
          <section
            key={c.id}
            aria-label={`Coluna ${c.nome}`}
            data-coluna={c.nome}
            onDragOver={(e) => {
              if (!podeEditar) return;
              e.preventDefault();
              setSobre(c.id);
            }}
            onDragLeave={() => setSobre((s) => (s === c.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) void mover(id, c);
            }}
            className={cn(
              "grid w-72 shrink-0 snap-start content-start gap-2 rounded-lg bg-suave/60 p-2",
              sobre === c.id && "ring-2 ring-tinta/40",
            )}
          >
            <h3 className="flex items-center gap-2 px-1 text-sm font-semibold">
              {c.cor && (
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: c.cor }} />
              )}
              {c.nome} <span className="font-normal text-texto-2">{cartoes.length}</span>
            </h3>
            {cartoes.map((t) => (
              <article
                key={t.id}
                draggable={podeEditar}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
                aria-label={t.titulo}
                className="grid gap-1.5 rounded-md border border-linha bg-cartao p-2.5 shadow-sm"
              >
                <a href={`/tarefas/${t.id}`} className="font-medium text-pretty hover:underline">
                  {t.titulo}
                </a>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-texto-2">
                  <MarcaDePrioridade prioridade={t.prioridade} />
                  <span>{nomeDe(t.responsavel, nomes)}</span>
                  <MarcaDeAgente quem={t.responsavel} />
                  <MarcaDePrazo tarefa={t} />
                </span>
                {podeEditar && (
                  // No celular (e para quem usa o teclado), mover sem arrastar.
                  <select
                    aria-label={`Mover ${t.titulo}`}
                    className="h-8 rounded border border-linha bg-cartao px-1 text-xs"
                    value={c.id}
                    onChange={(e) => {
                      const destino = colunas.find((x) => x.id === e.target.value);
                      if (destino) void mover(t.id, destino);
                    }}
                  >
                    {colunas.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </select>
                )}
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// Calendário ------------------------------------------------------------------------------------------------------

/** Os dias que o calendário mostra: o mês inteiro (semanas completas, começando na segunda) ou a semana. */
function diasDoCalendario(referencia: Date, modo: "mes" | "semana"): string[] {
  const inicio = new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    modo === "mes" ? 1 : referencia.getDate(),
  );
  const deslocamento = (inicio.getDay() + 6) % 7; // segunda = 0
  inicio.setDate(inicio.getDate() - deslocamento);
  const fim = new Date(inicio);
  if (modo === "semana") fim.setDate(inicio.getDate() + 6);
  else {
    const ultimo = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0);
    fim.setTime(ultimo.getTime());
    fim.setDate(fim.getDate() + ((7 - ((fim.getDay() + 6) % 7) - 1) % 7));
  }
  const dias: string[] = [];
  for (const d = new Date(inicio); d <= fim; d.setDate(d.getDate() + 1)) dias.push(textoDoDia(d));
  return dias;
}

function andar(r: Date, modo: "mes" | "semana", passo: number): Date {
  return modo === "mes"
    ? new Date(r.getFullYear(), r.getMonth() + passo, 1)
    : new Date(r.getFullYear(), r.getMonth(), r.getDate() + 7 * passo);
}

function VisaoCalendario({
  tarefas,
  semPrazo,
  dias,
  referencia,
  modo,
  fuso,
  podeEditar,
  aoMudarModo,
  aoNavegar,
  aoMudar,
}: {
  tarefas: Tarefa[];
  semPrazo: Tarefa[];
  dias: string[];
  referencia: Date;
  modo: "mes" | "semana";
  fuso: string | undefined;
  podeEditar: boolean;
  aoMudarModo: (m: "mes" | "semana") => void;
  aoNavegar: (passo: number) => void;
  aoMudar: (m: Mensagem) => void;
}) {
  const [sobre, setSobre] = useState<string | null>(null);
  const todas = [...tarefas, ...semPrazo];
  const doDia = (dia: string) => tarefas.filter((t) => diaNoCalendario(t, fuso) === dia);
  const mesDaReferencia = referencia.getMonth() + 1;

  /** Arrastar para um dia muda o prazo para ele (a hora e o fuso continuam os mesmos). */
  async function aoSoltar(id: string, dia: string) {
    const t = todas.find((x) => x.id === id);
    if (!t || diaNoCalendario(t, fuso) === dia) return;
    // Com hora: a mesma hora que a pessoa vê, no fuso dela, no dia novo (o cartão cai onde foi solto).
    const prazo =
      t.prazo?.hora != null
        ? fuso
          ? { dia, hora: partesNoFuso(new Date(t.prazo.em), fuso).hora, fuso }
          : { dia, hora: t.prazo.hora, fuso: t.prazo.fuso }
        : t.prazo
          ? { dia, fuso: t.prazo.fuso }
          : { dia };
    const r = await planejarTarefa(id, { prazo });
    aoMudar(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "Não foi possível mudar o prazo." });
  }

  const Cartao = ({ t }: { t: Tarefa }) => (
    <a
      href={`/tarefas/${t.id}`}
      draggable={podeEditar}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
      className={cn(
        "block truncate rounded px-1.5 py-0.5 text-xs",
        t.status === "concluida" || t.status === "cancelada"
          ? "bg-suave text-texto-2 line-through"
          : "bg-tinta/10",
      )}
      title={t.titulo}
    >
      {t.titulo}
    </a>
  );

  const titulo =
    modo === "mes"
      ? referencia.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : `Semana de ${diaBr(dias[0] as string)}`;
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="fantasma" size="pequeno" aria-label="Anterior" onClick={() => aoNavegar(-1)}>
            <ChevronLeft />
          </Button>
          <h3 className="min-w-40 text-center font-semibold capitalize">{titulo}</h3>
          <Button variant="fantasma" size="pequeno" aria-label="Próximo" onClick={() => aoNavegar(1)}>
            <ChevronRight />
          </Button>
          <span className="ml-auto flex gap-1">
            <Filtro ativo={modo === "mes"} aoClicar={() => aoMudarModo("mes")}>
              Mês
            </Filtro>
            <Filtro ativo={modo === "semana"} aoClicar={() => aoMudarModo("semana")}>
              Semana
            </Filtro>
          </span>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-linha bg-linha text-xs">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
            <div key={d} className="bg-cartao p-1 text-center font-medium text-texto-2">
              {d}
            </div>
          ))}
          {dias.map((dia) => {
            const foraDoMes = modo === "mes" && Number(dia.slice(5, 7)) !== mesDaReferencia;
            return (
              <section
                key={dia}
                data-dia={dia}
                aria-label={`Dia ${diaBr(dia)}`}
                onDragOver={(e) => {
                  if (!podeEditar) return;
                  e.preventDefault();
                  setSobre(dia);
                }}
                onDragLeave={() => setSobre((s) => (s === dia ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setSobre(null);
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) void aoSoltar(id, dia);
                }}
                className={cn(
                  "grid min-h-20 content-start gap-0.5 bg-cartao p-1",
                  modo === "semana" && "min-h-48",
                  foraDoMes && "bg-suave/60 text-texto-2",
                  sobre === dia && "ring-2 ring-inset ring-tinta/40",
                )}
              >
                <span className={cn("text-right", dia === hojeLocal() && "font-bold text-tinta")}>
                  {Number(dia.slice(8, 10))}
                </span>
                {doDia(dia).map((t) => (
                  <Cartao key={t.id} t={t} />
                ))}
              </section>
            );
          })}
        </div>
      </div>
      <aside className="grid content-start gap-1.5" aria-label="Sem prazo">
        <h3 className="text-sm font-semibold">Sem prazo</h3>
        {semPrazo.length === 0 && <p className="text-xs text-texto-2">Todas têm prazo.</p>}
        {semPrazo.map((t) => (
          <Cartao key={t.id} t={t} />
        ))}
        {podeEditar && semPrazo.length > 0 && (
          <p className="text-xs text-texto-2">Arraste para um dia para marcar o prazo.</p>
        )}
      </aside>
    </div>
  );
}
