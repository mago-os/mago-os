/**
 * Painéis (M3-10): no computador, a tela dividida em painéis encaixáveis (dockview: dividir, redimensionar, abas,
 * maximizar, fechar); no celular, os mesmos painéis em abas, na ordem e com os favoritos da pessoa. O layout é salvo
 * com nome ("Meu dia") e o último usado abre sozinho. Cada painel baixa o código só quando aparece, e painel escondido
 * não fica atualizando.
 */
import {
  type Aviso,
  type EstruturaDoLayout,
  type LayoutDeTela,
  type PainelDoLayout,
  TIPOS_DE_PAINEL,
  type TipoDePainel,
} from "@mago-os/contratos";
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { ArrowLeft, ArrowRight, Star, X } from "lucide-react";
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import { listarMeusAvisos } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { cn } from "@/lib/utils";
import { listarProjetos } from "@/projetos";
import { pedir } from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso as Mensagem } from "./Acesso";

const NOMES: Record<TipoDePainel, string> = {
  inicio: "Início",
  tarefas: "Tarefas",
  projeto: "Projeto",
  prioridades: "Prioridades",
  notificacoes: "Notificações",
  agentes: "Agentes",
};

/** O que os painéis precisam saber de quem está usando (as mesmas permissões das telas). */
export interface Permissoes {
  euId: string;
  podeCriarTarefa: boolean;
  podeEditarTarefa: boolean;
  podeVerAgentes: boolean;
  podeCadastrarAgentes: boolean;
  podeVerProjetos: boolean;
  administraProjetos: boolean;
  podeExcluirProjetos: boolean;
}
const ContextoDosPaineis = createContext<Permissoes | null>(null);
const usePermissoes = () => useContext(ContextoDosPaineis) as Permissoes;

// Cada painel baixa o código só quando entra na tela.
const TarefasPreguicosa = lazy(() => import("./Tarefas").then((m) => ({ default: m.Tarefas })));
const ProjetoPreguicoso = lazy(() => import("./Projetos").then((m) => ({ default: m.PaginaDoProjeto })));
const PrioridadesPreguicosa = lazy(() =>
  import("./Prioridades").then((m) => ({ default: m.CentralDePrioridades })),
);
const AgentesPreguicosos = lazy(() => import("./Agentes").then((m) => ({ default: m.Agentes })));

function Notificacoes() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const carregar = useCallback(async () => setAvisos((await listarMeusAvisos()).dados ?? []), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useTempoReal((a) => {
    if (a.tipo === "aviso" || a.tipo === "reconectou") void carregar();
  });
  if (avisos.length === 0) return <p className="p-4 text-sm text-texto-2">Nada novo por aqui.</p>;
  return (
    <ul className="grid gap-1 p-2">
      {avisos.map((a) => (
        <li key={a.id}>
          <a href={a.link} className="block rounded-md px-2 py-2 text-sm hover:bg-suave">
            {a.texto}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Inicio() {
  return (
    <div className="grid gap-2 p-4 text-sm">
      <p className="font-semibold">Bem-vindo aos painéis.</p>
      <p className="text-texto-2">
        Use "Adicionar painel" para pôr tarefas, um projeto, as prioridades, as notificações ou os agentes
        lado a lado. Arraste a aba de um painel para dividir a tela ou empilhar, e salve o jeito com um nome.
      </p>
    </div>
  );
}

/** O conteúdo de um painel (o mesmo no computador e no celular). */
function ConteudoDoPainel({
  painel,
  aoEscolherProjeto,
}: {
  painel: PainelDoLayout;
  aoEscolherProjeto: (projetoId: string) => void;
}) {
  const p = usePermissoes();
  return (
    <Suspense fallback={<p className="p-4 text-sm text-texto-2">Carregando...</p>}>
      {painel.tipo === "inicio" && <Inicio />}
      {painel.tipo === "tarefas" && (
        <TarefasPreguicosa podeCriar={p.podeCriarTarefa} podeEditar={p.podeEditarTarefa} euId={p.euId} />
      )}
      {painel.tipo === "projeto" &&
        (painel.projetoId ? (
          <ProjetoPreguicoso
            id={painel.projetoId}
            euId={p.euId}
            administra={p.administraProjetos}
            podeCriarTarefa={p.podeCriarTarefa}
            podeEditarTarefa={p.podeEditarTarefa}
            podeExcluir={p.podeExcluirProjetos}
          />
        ) : (
          <EscolherProjeto aoEscolher={aoEscolherProjeto} />
        ))}
      {painel.tipo === "prioridades" && <PrioridadesPreguicosa />}
      {painel.tipo === "notificacoes" && <Notificacoes />}
      {painel.tipo === "agentes" &&
        (p.podeVerAgentes ? (
          <AgentesPreguicosos podeCadastrar={p.podeCadastrarAgentes} euId={p.euId} />
        ) : (
          <p className="p-4 text-sm text-texto-2">Você não tem acesso aos agentes.</p>
        ))}
    </Suspense>
  );
}

function EscolherProjeto({ aoEscolher }: { aoEscolher: (id: string) => void }) {
  const [projetos, setProjetos] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    void listarProjetos().then((r) => setProjetos(r.dados?.projetos ?? []));
  }, []);
  return (
    <label className="grid gap-2 p-4 text-sm">
      Qual projeto este painel mostra?
      <select
        className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
        defaultValue=""
        onChange={(e) => e.target.value && aoEscolher(e.target.value)}
      >
        <option value="" disabled>
          Escolha o projeto
        </option>
        {projetos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </label>
  );
}

type Parametros = { painel: PainelDoLayout };

/** Painel do dockview: só mostra (e só atualiza) o conteúdo enquanto está visível. */
function PainelDoDock(props: IDockviewPanelProps<Parametros>) {
  const [visivel, setVisivel] = useState(props.api.isVisible);
  const [painel, setPainel] = useState(props.params.painel);
  useEffect(() => {
    const d = props.api.onDidVisibilityChange((e) => setVisivel(e.isVisible));
    return () => d.dispose();
  }, [props.api]);
  return (
    <section className="h-full overflow-auto bg-fundo" aria-label={props.api.title ?? NOMES[painel.tipo]}>
      {visivel && (
        <ConteudoDoPainel
          painel={painel}
          aoEscolherProjeto={(projetoId) => {
            const novo = { ...painel, projetoId };
            setPainel(novo);
            props.api.updateParameters({ painel: novo });
          }}
        />
      )}
    </section>
  );
}

const COMPONENTES = Object.fromEntries(TIPOS_DE_PAINEL.map((t) => [t, PainelDoDock])) as Record<
  TipoDePainel,
  typeof PainelDoDock
>;

let contador = 0;
const novoId = (tipo: TipoDePainel) => `${tipo}-${Date.now().toString(36)}-${(contador++).toString(36)}`;

const PADRAO: EstruturaDoLayout = {
  paineis: [
    { id: "tarefas-1", tipo: "tarefas" },
    { id: "prioridades-1", tipo: "prioridades" },
  ],
};

const ehCelular = () => window.matchMedia("(max-width: 767px)").matches;

export function Paineis(permissoes: Permissoes) {
  // O aparelho é decidido ao abrir a tela (girar ou estreitar a janela não troca o layout no meio do uso).
  const [aparelho] = useState<"celular" | "computador">(() => (ehCelular() ? "celular" : "computador"));
  const [layouts, setLayouts] = useState<LayoutDeTela[]>([]);
  const [atual, setAtual] = useState<LayoutDeTela | null>(null);
  const [estrutura, setEstrutura] = useState<EstruturaDoLayout | null>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(null);
  const api = useRef<DockviewApi | null>(null);

  const carregar = useCallback(async () => {
    const r = await pedir<{ layouts: LayoutDeTela[] }>("GET", `/layouts?aparelho=${aparelho}`);
    const lista = r.dados?.layouts ?? [];
    setLayouts(lista);
    return lista;
  }, [aparelho]);

  // Abre o último usado (ou o padrão: tarefas ao lado das prioridades).
  useEffect(() => {
    void carregar().then((lista) => {
      const ultimo = lista[0] ?? null;
      setAtual(ultimo);
      setEstrutura(ultimo?.estrutura ?? PADRAO);
    });
  }, [carregar]);

  /** O layout que está na tela agora, para salvar. */
  function estruturaAtual(): EstruturaDoLayout | null {
    if (aparelho === "celular") return estrutura;
    const dock = api.current;
    if (!dock || dock.panels.length === 0) return null;
    return {
      paineis: dock.panels.map((p) => ({ ...(p.params as Parametros).painel, id: p.id })),
      divisao: dock.toJSON() as unknown as Record<string, unknown>,
    };
  }

  async function salvar(comoNovo: boolean) {
    const e = estruturaAtual();
    if (!e) return setMensagem({ tipo: "erro", texto: "Ponha pelo menos um painel antes de salvar." });
    let nome = atual?.nome ?? "";
    if (comoNovo || !atual) {
      nome = window.prompt("Nome do layout (ex.: Meu dia):", comoNovo ? "" : nome)?.trim() ?? "";
      if (!nome) return;
    }
    const r = await pedir<LayoutDeTela>("POST", comoNovo || !atual ? "/layouts" : `/layouts/${atual.id}`, {
      nome,
      aparelho,
      estrutura: e,
    });
    if (!r.ok || !r.dados)
      return setMensagem({
        tipo: "erro",
        texto: r.mensagem || "Não foi possível salvar o layout. Confira o nome.",
      });
    setAtual(r.dados);
    setMensagem({ tipo: "ok", texto: `Layout "${r.dados.nome}" salvo.` });
    void carregar();
  }

  async function trocar(id: string) {
    const r = await pedir<LayoutDeTela>("POST", `/layouts/${id}/usar`);
    if (!r.ok || !r.dados) return;
    setAtual(r.dados);
    setEstrutura(r.dados.estrutura);
    if (api.current) montar(api.current, r.dados.estrutura);
    setMensagem(null);
  }

  async function apagar() {
    if (!atual || !window.confirm(`Apagar o layout "${atual.nome}"?`)) return;
    const r = await pedir("DELETE", `/layouts/${atual.id}`);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem || "Não foi possível apagar o layout." });
    setAtual(null);
    setMensagem({ tipo: "ok", texto: "Layout apagado." });
    void carregar();
  }

  function adicionar(tipo: TipoDePainel) {
    const painel: PainelDoLayout = { id: novoId(tipo), tipo };
    if (aparelho === "celular") {
      setEstrutura((e) => ({ ...(e ?? PADRAO), paineis: [...(e ?? PADRAO).paineis, painel] }));
      return;
    }
    api.current?.addPanel({
      id: painel.id,
      component: tipo,
      title: NOMES[tipo],
      params: { painel },
      ...(api.current.activePanel
        ? { position: { referencePanel: api.current.activePanel.id, direction: "right" } }
        : {}),
    });
  }

  function montar(dock: DockviewApi, e: EstruturaDoLayout) {
    dock.clear();
    if (e.divisao) {
      try {
        dock.fromJSON(e.divisao as never);
        return;
      } catch {
        dock.clear();
      }
    }
    let anterior: string | null = null;
    for (const painel of e.paineis) {
      dock.addPanel({
        id: painel.id,
        component: painel.tipo,
        title: NOMES[painel.tipo],
        params: { painel },
        ...(anterior ? { position: { referencePanel: anterior, direction: "right" as const } } : {}),
      });
      anterior = painel.id;
    }
  }

  const aoFicarPronto = (evento: DockviewReadyEvent) => {
    api.current = evento.api;
    if (estrutura) montar(evento.api, estrutura);
  };

  return (
    <ContextoDosPaineis.Provider value={permissoes}>
      <main className="flex h-[calc(100dvh-8rem)] flex-col gap-2 px-2 py-2 md:h-[calc(100dvh-4rem)] md:px-4">
        {/* Só mexe depois que o layout salvo chegou (senão ele chegaria por cima do que a pessoa fez). */}
        <fieldset
          disabled={estrutura === null}
          className="flex flex-wrap items-center gap-2"
          aria-label="Layouts e painéis"
        >
          <h1 className="mr-2 text-lg font-bold">Painéis</h1>
          <select
            aria-label="Layout"
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value={atual?.id ?? ""}
            onChange={(e) => e.target.value && e.target.value !== atual?.id && void trocar(e.target.value)}
          >
            {!atual && <option value="">Layout sem nome</option>}
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </select>
          <select
            aria-label="Adicionar painel"
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value=""
            onChange={(e) => e.target.value && adicionar(e.target.value as TipoDePainel)}
          >
            <option value="">Adicionar painel...</option>
            {TIPOS_DE_PAINEL.filter(
              (t) =>
                (t !== "agentes" || permissoes.podeVerAgentes) &&
                (t !== "projeto" || permissoes.podeVerProjetos),
            ).map((t) => (
              <option key={t} value={t}>
                {NOMES[t]}
              </option>
            ))}
          </select>
          <Button size="pequeno" onClick={() => void salvar(false)}>
            Salvar
          </Button>
          <Button size="pequeno" variant="contorno" onClick={() => void salvar(true)}>
            Salvar como...
          </Button>
          {atual && (
            <Button size="pequeno" variant="fantasma" onClick={() => void apagar()}>
              Apagar layout
            </Button>
          )}
        </fieldset>
        {mensagem && <Mensagem {...mensagem} />}
        {estrutura &&
          (aparelho === "celular" ? (
            <div className="grid min-h-0 flex-1">
              <AbasDoCelular estrutura={estrutura} aoMudar={setEstrutura} />
            </div>
          ) : (
            <DockviewReact
              className="dockview-theme-light dockview-theme-mago min-h-0 flex-1 rounded-lg border border-linha"
              components={COMPONENTES}
              onReady={aoFicarPronto}
            />
          ))}
      </main>
    </ContextoDosPaineis.Provider>
  );
}

/** No celular: os painéis em abas (favoritos primeiro), com mudar a ordem, favoritar e fechar. */
function AbasDoCelular({
  estrutura,
  aoMudar,
}: {
  estrutura: EstruturaDoLayout;
  aoMudar: (e: EstruturaDoLayout) => void;
}) {
  const favoritos = new Set(estrutura.favoritos ?? []);
  const ordem = [
    ...estrutura.paineis.filter((p) => favoritos.has(p.id)),
    ...estrutura.paineis.filter((p) => !favoritos.has(p.id)),
  ];
  const [aberta, setAberta] = useState(ordem[0]?.id ?? "");
  const painel = ordem.find((p) => p.id === aberta) ?? ordem[0];

  // Mexe na ordem que a pessoa vê (favoritos primeiro) e guarda essa mesma ordem.
  function mover(id: string, passo: -1 | 1) {
    const lista = [...ordem];
    const i = lista.findIndex((p) => p.id === id);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j] as PainelDoLayout, lista[i] as PainelDoLayout];
    aoMudar({ ...estrutura, paineis: lista });
  }
  function favoritar(id: string) {
    const f = new Set(favoritos);
    if (f.has(id)) f.delete(id);
    else f.add(id);
    aoMudar({ ...estrutura, favoritos: [...f] });
  }
  function fechar(id: string) {
    if (estrutura.paineis.length === 1) return;
    aoMudar({
      ...estrutura,
      paineis: estrutura.paineis.filter((p) => p.id !== id),
      favoritos: (estrutura.favoritos ?? []).filter((f) => f !== id),
    });
  }
  function aoTeclar(e: React.KeyboardEvent, i: number) {
    const proxima = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (proxima === null) return;
    const alvo = ordem[(proxima + ordem.length) % ordem.length];
    if (alvo) {
      setAberta(alvo.id);
      document.getElementById(`aba-${alvo.id}`)?.focus();
    }
  }

  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-2">
      <div role="tablist" aria-label="Painéis" className="flex gap-1 overflow-x-auto">
        {ordem.map((p, i) => (
          <button
            key={p.id}
            id={`aba-${p.id}`}
            type="button"
            role="tab"
            aria-selected={p.id === painel?.id}
            aria-controls="painel-aberto"
            tabIndex={p.id === painel?.id ? 0 : -1}
            onClick={() => setAberta(p.id)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={cn(
              "shrink-0 rounded-full border border-linha px-3 py-1.5 text-sm",
              p.id === painel?.id && "bg-tinta text-sobre-tinta",
            )}
          >
            {favoritos.has(p.id) && "★ "}
            {NOMES[p.tipo]}
          </button>
        ))}
      </div>
      {painel && (
        <div className="flex gap-1" role="toolbar" aria-label="Arrumar o painel aberto">
          <Button
            size="icone"
            variant="fantasma"
            aria-label="Mover para a esquerda"
            onClick={() => mover(painel.id, -1)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <Button
            size="icone"
            variant="fantasma"
            aria-label="Mover para a direita"
            onClick={() => mover(painel.id, 1)}
          >
            <ArrowRight className="size-4" />
          </Button>
          <Button
            size="icone"
            variant="fantasma"
            aria-label={favoritos.has(painel.id) ? "Tirar dos favoritos" : "Favoritar"}
            aria-pressed={favoritos.has(painel.id)}
            onClick={() => favoritar(painel.id)}
          >
            <Star className="size-4" />
          </Button>
          <Button
            size="icone"
            variant="fantasma"
            aria-label="Fechar o painel"
            onClick={() => fechar(painel.id)}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      <div
        id="painel-aberto"
        role="tabpanel"
        aria-labelledby={painel ? `aba-${painel.id}` : undefined}
        className="min-h-0 overflow-auto"
      >
        {painel && (
          <ConteudoDoPainel
            key={painel.id}
            painel={painel}
            aoEscolherProjeto={(projetoId) =>
              aoMudar({
                ...estrutura,
                paineis: estrutura.paineis.map((p) => (p.id === painel.id ? { ...p, projetoId } : p)),
              })
            }
          />
        )}
      </div>
    </div>
  );
}
