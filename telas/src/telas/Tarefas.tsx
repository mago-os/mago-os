/**
 * Tarefas (M2-01), pensada para o celular: a lista com "Nova tarefa" e filtros, e a página da tarefa com status,
 * responsável, comentários e resultado. Texto que vem de agente aparece sempre como texto (o React não monta HTML
 * a partir dele), com a marca "agente".
 */
import {
  type Autor,
  NOMES_STATUS_TAREFA,
  type Responsavel,
  STATUS_TAREFA,
  type StatusTarefa,
  type Tarefa,
} from "@mago-os/contratos";
import { ArrowLeft, Bot, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { listarPessoas, type PessoaDaEmpresa } from "@/acesso";
import { type AgenteNaLista, listarAgentes } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { listarProjetos } from "@/projetos";
import {
  abrirTarefa,
  acaoNaTrava,
  comentarTarefa,
  criarTarefa,
  excluirTarefa,
  listarTarefas,
  mudarLista,
  mudarProjeto,
  mudarStatus,
  type TarefaAberta,
  trocarResponsavel,
} from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { useAoVoltar } from "./Administrador";
import { Checklist, Subtarefas } from "./PartesDaTarefa";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

const COR_DO_STATUS: Record<StatusTarefa, string> = {
  a_fazer: "bg-suave text-texto-2",
  em_andamento: "bg-tinta/10 text-tinta",
  precisa_de_ajuda: "bg-perigo/10 text-perigo",
  concluida: "bg-ok/10 text-ok",
  cancelada: "bg-suave text-texto-2 line-through",
};

const ABERTOS: StatusTarefa[] = ["a_fazer", "em_andamento", "precisa_de_ajuda"];

export const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function Etiqueta({ status }: { status: StatusTarefa }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", COR_DO_STATUS[status])}>
      {NOMES_STATUS_TAREFA[status]}
    </span>
  );
}

export function nomeDe(quem: Autor | Responsavel | null, nomes: Record<string, string>): string {
  if (!quem) return "Sem responsável";
  if (quem.tipo === "pessoa") return nomes[quem.pessoaId] ?? "Pessoa";
  if (quem.tipo === "agente") return nomes[quem.agenteId] ?? "Agente";
  return "Mago OS";
}

export function MarcaDeAgente({ quem }: { quem: Autor | Responsavel | null }) {
  if (quem?.tipo !== "agente") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-suave px-2 py-0.5 text-[11px] text-texto-2">
      <Bot className="size-3" /> agente
    </span>
  );
}

/** Ids que acabaram de mudar, destacados por 2,5 segundos. */
export function useDestaques(): [Set<string>, (id: string) => void] {
  const [destaques, setDestaques] = useState<Set<string>>(new Set());
  const relogios = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const todos = relogios.current;
    return () => {
      for (const r of todos.values()) clearTimeout(r);
    };
  }, []);
  const destacar = useCallback((id: string) => {
    setDestaques((d) => new Set(d).add(id));
    // Mudou de novo: o destaque recomeça do zero.
    clearTimeout(relogios.current.get(id));
    relogios.current.set(
      id,
      setTimeout(() => {
        relogios.current.delete(id);
        setDestaques((d) => {
          const novo = new Set(d);
          novo.delete(id);
          return novo;
        });
      }, 2500),
    );
  }, []);
  return [destaques, destacar];
}

/** Lista das tarefas. */
export function Tarefas({ podeCriar, euId }: { podeCriar: boolean; euId: string }) {
  const [minhas, setMinhas] = useState(true);
  const [abertas, setAbertas] = useState(true);
  const [lista, setLista] = useState<{ tarefas: Tarefa[]; nomes: Record<string, string> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const ultimoPedido = useRef(0);
  const carregar = useCallback(async () => {
    // Vários avisos seguidos: só a resposta do pedido mais recente vale (uma antiga não sobrescreve a nova).
    const numero = ++ultimoPedido.current;
    const r = await listarTarefas({ minhas, status: abertas ? ABERTOS : [] });
    if (numero !== ultimoPedido.current) return;
    if (r.ok && r.dados) {
      setLista(r.dados);
      setErro(null);
    } else setErro(r.mensagem ?? null);
  }, [minhas, abertas]);
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

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Tarefas</h1>
        {podeCriar && !criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Nova tarefa
          </Button>
        )}
      </div>
      {criando && (
        <NovaTarefa
          euId={euId}
          aoCancelar={() => setCriando(false)}
          aoCriar={(t) => {
            window.location.assign(`/tarefas/${t.id}`);
          }}
        />
      )}
      <fieldset className="flex flex-wrap gap-2" aria-label="Filtros">
        <Filtro ativo={minhas} aoClicar={() => setMinhas(true)}>
          Minhas
        </Filtro>
        <Filtro ativo={!minhas} aoClicar={() => setMinhas(false)}>
          Todas que vejo
        </Filtro>
        <span className="w-px bg-linha" />
        <Filtro ativo={abertas} aoClicar={() => setAbertas(true)}>
          Abertas
        </Filtro>
        <Filtro ativo={!abertas} aoClicar={() => setAbertas(false)}>
          Todas
        </Filtro>
      </fieldset>
      {erro && <Aviso tipo="erro" texto={erro} />}
      {lista && lista.tarefas.length === 0 && (
        <p className="text-sm text-texto-2">Nenhuma tarefa por aqui.</p>
      )}
      <ul className="grid gap-2">
        {lista?.tarefas.map((t) => (
          <li key={t.id}>
            <a
              href={`/tarefas/${t.id}`}
              data-destaque={destaques.has(t.id) || undefined}
              className={cn(
                "grid gap-1.5 rounded-lg border border-linha bg-cartao p-3 transition-colors duration-700 hover:bg-suave",
                destaques.has(t.id) && "border-tinta/40 bg-suave",
              )}
            >
              <span className="font-medium text-pretty">{t.titulo}</span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <Etiqueta status={t.status} />
                <span>{nomeDe(t.responsavel, lista.nomes)}</span>
                <MarcaDeAgente quem={t.responsavel} />
                <span className="ml-auto">{quando(t.atualizadaEm)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function Filtro({
  ativo,
  aoClicar,
  children,
}: {
  ativo: boolean;
  aoClicar: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoClicar}
      className={cn(
        "rounded-full border border-linha px-3 py-1.5 text-sm",
        ativo ? "bg-tinta text-sobre-tinta" : "text-texto-2",
      )}
    >
      {children}
    </button>
  );
}

export function usePessoas() {
  const [pessoas, setPessoas] = useState<PessoaDaEmpresa[]>([]);
  useEffect(() => {
    void listarPessoas().then((l) => setPessoas((l ?? []).filter((p) => p.situacao === "ativo")));
  }, []);
  return pessoas;
}

/** Agentes ativos (só eles recebem tarefa nova). */
export function useAgentesAtivos() {
  const [agentes, setAgentes] = useState<AgenteNaLista[]>([]);
  useEffect(() => {
    void listarAgentes().then((r) => setAgentes((r.dados ?? []).filter((a) => a.situacao === "ativo")));
  }, []);
  return agentes;
}

/** Projetos ativos que a pessoa vê (para pôr uma tarefa num projeto). */
export function useProjetosAtivos() {
  const [projetos, setProjetos] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    void listarProjetos().then((r) => setProjetos(r.dados?.projetos ?? []));
  }, []);
  return projetos;
}

/** No seletor, agente vale "agente:<id>" e pessoa vale o id dela. */
export function valorDoResponsavel(r: Responsavel | null): string {
  if (r?.tipo === "agente") return `agente:${r.agenteId}`;
  return r?.tipo === "pessoa" ? r.pessoaId : "";
}

export function responsavelDoValor(v: string): Responsavel | null {
  if (!v || v === "nenhum") return null;
  if (v.startsWith("agente:")) return { tipo: "agente", agenteId: v.slice("agente:".length) };
  return { tipo: "pessoa", pessoaId: v };
}

export function SeletorDeResponsavel({
  id,
  valor,
  aoMudar,
  pessoas,
  agentes,
  extras,
  disabled,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  pessoas: PessoaDaEmpresa[];
  agentes: AgenteNaLista[];
  /** Opções antes das pessoas (ex.: "Sem responsável"), com o valor que cada uma manda. */
  extras: { valor: string; nome: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      className="h-11 rounded-md border border-linha bg-cartao px-3 text-base disabled:opacity-60"
      value={valor}
      disabled={disabled}
      onChange={(e) => aoMudar(e.target.value)}
    >
      {extras.map((x) => (
        <option key={x.valor} value={x.valor}>
          {x.nome}
        </option>
      ))}
      {pessoas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
      {agentes.length > 0 && (
        <optgroup label="Agentes">
          {agentes.map((a) => (
            <option key={a.id} value={`agente:${a.id}`}>
              {a.nome}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export function NovaTarefa({
  euId,
  projetoId,
  aoCancelar,
  aoCriar,
}: {
  euId: string;
  /** Cria a tarefa já neste projeto (M3-01). */
  projetoId?: string;
  aoCancelar: () => void;
  aoCriar: (t: Tarefa) => void;
}) {
  const pessoas = usePessoas();
  const agentes = useAgentesAtivos();
  // "": fica com quem criou (a API decide). "nenhum": sem responsável. Outro valor: a pessoa ou o agente escolhido.
  const [responsavel, setResponsavel] = useState("");
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    setEnviando(true);
    const r = await criarTarefa({
      titulo: String(f.get("titulo")).trim(),
      descricao: String(f.get("descricao")).trim() || null,
      ...(projetoId ? { projetoId } : {}),
      ...(responsavel === ""
        ? {}
        : {
            responsavel: responsavelDoValor(responsavel),
          }),
    });
    setEnviando(false);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoCriar(r.dados);
  }

  return (
    <Card className="gap-4">
      <CardTitulo>Nova tarefa</CardTitulo>
      <form className="grid gap-3" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="titulo" name="titulo" rotulo="O que precisa ser feito" required maxLength={200} />
        <div className="grid gap-1.5">
          <label htmlFor="descricao" className="text-sm font-medium">
            Detalhes (opcional)
          </label>
          <textarea
            id="descricao"
            name="descricao"
            rows={3}
            maxLength={20000}
            className="rounded-md border border-linha bg-cartao px-3 py-2 text-base"
          />
        </div>
        {(pessoas.length > 1 || agentes.length > 0) && (
          <div className="grid gap-1.5">
            <label htmlFor="responsavel-nova" className="text-sm font-medium">
              Responsável
            </label>
            <SeletorDeResponsavel
              id="responsavel-nova"
              valor={responsavel}
              aoMudar={setResponsavel}
              pessoas={pessoas.filter((p) => p.id !== euId)}
              agentes={agentes}
              extras={[
                { valor: "", nome: "Eu" },
                { valor: "nenhum", nome: "Sem responsável" },
              ]}
            />
          </div>
        )}
        {mensagem && <Aviso {...mensagem} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={enviando}>
            Criar tarefa
          </Button>
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Página de uma tarefa. */
export function PaginaDaTarefa({
  id,
  euId,
  podeEditar,
  podeDestravar,
  podeExcluir,
}: {
  id: string;
  euId: string;
  podeEditar: boolean;
  /** Destravar a tarefa pegada por outro (ação "aprovar" das tarefas; padrão: o administrador). */
  podeDestravar: boolean;
  podeExcluir: boolean;
}) {
  const [aberta, setAberta] = useState<Omit<TarefaAberta, "tarefas"> | null | undefined>(undefined);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [concluindo, setConcluindo] = useState(false);
  /** Status do projeto escolhido para concluir (M3-02); sem ele, o primeiro do tipo Concluída. */
  const [concluirEm, setConcluirEm] = useState<string | null>(null);
  const pessoas = usePessoas();
  const agentes = useAgentesAtivos();
  const projetos = useProjetosAtivos();

  const ultimoPedido = useRef(0);
  const carregar = useCallback(async () => {
    const numero = ++ultimoPedido.current;
    const r = await abrirTarefa(id);
    if (numero !== ultimoPedido.current) return;
    setAberta(r.ok && r.dados ? r.dados : null);
  }, [id]);
  const [destaques, destacar] = useDestaques();
  const comentariosAntes = useRef<Set<string> | null>(null);
  useTempoReal((aviso) => {
    if (aviso.tipo === "reconectou" || (aviso.tipo === "tarefa" && aviso.id === id)) void carregar();
  });
  // Comentário que chegou depois de a página abrir ganha um destaque curto.
  useEffect(() => {
    if (!aberta) return;
    const ids = new Set(aberta.comentarios.map((c) => c.id));
    if (comentariosAntes.current) for (const c of ids) if (!comentariosAntes.current.has(c)) destacar(c);
    comentariosAntes.current = ids;
  }, [aberta, destacar]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);

  if (aberta === undefined) return <main className="min-h-dvh" aria-busy="true" />;
  if (aberta === null) {
    return (
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
        <Voltar />
        <p className="text-texto-2">Tarefa não encontrada, ou você não tem acesso a ela.</p>
      </main>
    );
  }
  const { tarefa, comentarios, nomes } = aberta;
  const nomesTodos = { ...nomes, ...Object.fromEntries(pessoas.map((p) => [p.id, p.nome])) };

  async function aoMudarStatus(status: StatusTarefa, extra: { resultado?: string; statusId?: string } = {}) {
    const r = await mudarStatus(tarefa.id, status, extra);
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
    if (r.ok) setConcluindo(false);
    void carregar();
  }

  async function aoTrocar(valor: string) {
    const r = await trocarResponsavel(tarefa.id, responsavelDoValor(valor));
    setMensagem(
      r.ok ? { tipo: "ok", texto: "Responsável trocado." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  async function aoMudarProjeto(valor: string) {
    const r = await mudarProjeto(tarefa.id, valor || null);
    setMensagem(r.ok ? { tipo: "ok", texto: "Projeto trocado." } : { tipo: "erro", texto: r.mensagem ?? "" });
    void carregar();
  }

  async function aoMudarLista(listaId: string) {
    const r = await mudarLista(tarefa.id, listaId);
    setMensagem(r.ok ? { tipo: "ok", texto: "Lista trocada." } : { tipo: "erro", texto: r.mensagem ?? "" });
    void carregar();
  }

  /** Status do projeto escolhido: concluir pede o resultado; os outros mudam na hora. */
  function aoEscolherStatusDoProjeto(id: string) {
    const s = aberta?.status.find((x) => x.id === id);
    if (!s || s.id === tarefa.statusDoProjetoId) return;
    if (s.tipo === "concluida") {
      setConcluirEm(s.id);
      setConcluindo(true);
      return;
    }
    void aoMudarStatus(s.tipo, { statusId: s.id });
  }

  async function aoComentar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const texto = String(new FormData(form).get("comentario")).trim();
    if (!texto) return;
    const r = await comentarTarefa(tarefa.id, texto);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    form.reset();
    void carregar();
  }

  async function aoConcluir(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const resultado = String(new FormData(evento.currentTarget).get("resultado")).trim();
    // Subtarefas abertas não impedem, mas a pessoa confirma (M3-02).
    const abertas =
      aberta?.subtarefas.filter((s) => s.status !== "concluida" && s.status !== "cancelada") ?? [];
    if (
      abertas.length > 0 &&
      !window.confirm(
        `Esta tarefa tem ${abertas.length} ${abertas.length === 1 ? "subtarefa aberta" : "subtarefas abertas"}. Concluir mesmo assim?`,
      )
    )
      return;
    await aoMudarStatus("concluida", {
      ...(resultado ? { resultado } : {}),
      ...(concluirEm ? { statusId: concluirEm } : {}),
    });
  }

  async function aoTrava(qual: "pegar" | "soltar" | "destravar") {
    let motivo: string | undefined;
    if (qual === "destravar") {
      motivo = window.prompt("Por que destravar? (vai para os comentários e para a auditoria)")?.trim();
      if (!motivo) return;
    }
    const r = await acaoNaTrava(tarefa.id, qual, motivo);
    setMensagem(
      r.ok
        ? {
            tipo: "ok",
            texto: {
              pegar: "A tarefa é sua agora.",
              soltar: "Tarefa solta.",
              destravar: "Tarefa destravada.",
            }[qual],
          }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  async function aoExcluir() {
    if (!window.confirm("Excluir esta tarefa e os comentários dela? Isso não tem volta.")) return;
    const r = await excluirTarefa(tarefa.id);
    if (r.ok) window.location.assign("/tarefas");
    else setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }

  const responsavelAtual = valorDoResponsavel(tarefa.responsavel);
  const conhecido =
    pessoas.some((p) => p.id === responsavelAtual) ||
    agentes.some((a) => `agente:${a.id}` === responsavelAtual);
  const encerrada = tarefa.status === "concluida" || tarefa.status === "cancelada";
  const listas = aberta.listas;
  const statusDoProjeto = aberta.status.find((s) => s.id === tarefa.statusDoProjetoId) ?? null;
  const travadaPorMim = tarefa.trava?.por.tipo === "pessoa" && tarefa.trava.por.pessoaId === euId;
  const travadaPorOutro = tarefa.trava !== null && !travadaPorMim;
  // Travada por outro: só quem pegou muda status e responsável (a API confere de novo).
  const podeMexer = podeEditar && !travadaPorOutro;
  const statusDosBotoes: StatusTarefa[] = encerrada
    ? ["a_fazer"]
    : STATUS_TAREFA.filter(
        (s) =>
          s !== tarefa.status &&
          s !== "concluida" &&
          // Sem trava, "Em andamento" é pegar a tarefa; com a trava, voltar para A fazer é soltar.
          !(tarefa.trava === null && s === "em_andamento") &&
          !(tarefa.trava !== null && s === "a_fazer"),
      );

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <Voltar />
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-pretty">{tarefa.titulo}</h1>
        {tarefa.tarefaMaeId && (
          <a
            href={`/tarefas/${tarefa.tarefaMaeId}`}
            className="text-sm text-texto-2 underline underline-offset-2"
          >
            Subtarefa de outra tarefa: abrir a tarefa-mãe
          </a>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
          <Etiqueta status={tarefa.status} />
          {statusDoProjeto && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: statusDoProjeto.cor }}
              />
              {statusDoProjeto.nome}
            </span>
          )}
          <span>Criada por {nomeDe(tarefa.criadaPor, nomesTodos)}</span>
          <span>em {quando(tarefa.criadaEm)}</span>
        </div>
        {tarefa.trava && (
          <p className="text-sm text-texto-2">
            Em andamento com {nomeDe(tarefa.trava.por, nomesTodos)} desde {quando(tarefa.trava.desde)}
          </p>
        )}
      </div>
      {tarefa.descricao && <p className="whitespace-pre-wrap text-pretty">{tarefa.descricao}</p>}
      {mensagem && <Aviso {...mensagem} />}

      <Card className="gap-3">
        <div className="grid gap-1.5">
          <label htmlFor="projeto" className="text-sm font-medium">
            Projeto
          </label>
          {podeEditar ? (
            <select
              id="projeto"
              className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
              value={tarefa.projetoId ?? ""}
              onChange={(e) => void aoMudarProjeto(e.target.value)}
            >
              <option value="">Sem projeto</option>
              {/* O projeto de hoje aparece mesmo arquivado ou fora da lista de quem vê. */}
              {tarefa.projetoId && !projetos.some((p) => p.id === tarefa.projetoId) && (
                <option value={tarefa.projetoId}>Projeto atual</option>
              )}
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          ) : tarefa.projetoId ? (
            <a id="projeto" href={`/projetos/${tarefa.projetoId}`} className="underline underline-offset-2">
              {projetos.find((p) => p.id === tarefa.projetoId)?.nome ?? "Abrir o projeto"}
            </a>
          ) : (
            <p id="projeto">Sem projeto</p>
          )}
        </div>
        {tarefa.projetoId && listas.length > 0 && (
          <div className="grid gap-1.5">
            <label htmlFor="lista" className="text-sm font-medium">
              Lista
            </label>
            {podeEditar && tarefa.tarefaMaeId === null ? (
              <select
                id="lista"
                className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
                value={tarefa.listaId ?? ""}
                onChange={(e) => void aoMudarLista(e.target.value)}
              >
                {listas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome}
                  </option>
                ))}
              </select>
            ) : (
              <p id="lista">{listas.find((l) => l.id === tarefa.listaId)?.nome ?? "Lista do projeto"}</p>
            )}
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor="responsavel" className="text-sm font-medium">
            Responsável
          </label>
          {podeMexer ? (
            <SeletorDeResponsavel
              id="responsavel"
              valor={responsavelAtual}
              aoMudar={(v) => void aoTrocar(v)}
              pessoas={pessoas}
              agentes={agentes}
              extras={[
                { valor: "", nome: "Sem responsável" },
                // Quem é responsável hoje aparece mesmo que a lista de pessoas não o mostre a quem vê.
                ...(responsavelAtual && !conhecido
                  ? [{ valor: responsavelAtual, nome: nomeDe(tarefa.responsavel, nomesTodos) }]
                  : []),
              ]}
            />
          ) : (
            <p className="flex items-center gap-2" id="responsavel">
              {nomeDe(tarefa.responsavel, nomesTodos)} <MarcaDeAgente quem={tarefa.responsavel} />
            </p>
          )}
        </div>
        {podeMexer && (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Status</span>
            <div className="flex flex-wrap gap-2">
              {!encerrada && tarefa.trava === null && (
                <Button size="pequeno" onClick={() => void aoTrava("pegar")}>
                  Pegar a tarefa
                </Button>
              )}
              {travadaPorMim && (
                <Button variant="contorno" size="pequeno" onClick={() => void aoTrava("soltar")}>
                  Soltar
                </Button>
              )}
              {/* Encerrada só sai reabrindo (volta para A fazer). */}
              {statusDosBotoes.map((s) => (
                <Button key={s} variant="contorno" size="pequeno" onClick={() => void aoMudarStatus(s)}>
                  {encerrada ? "Reabrir" : s === "cancelada" ? "Cancelar" : NOMES_STATUS_TAREFA[s]}
                </Button>
              ))}
              {!encerrada && !concluindo && (
                <Button
                  size="pequeno"
                  onClick={() => {
                    setConcluirEm(null);
                    setConcluindo(true);
                  }}
                >
                  Concluir
                </Button>
              )}
            </div>
            {/* Status do projeto (M3-02): os nomes que o projeto escolheu, cada um de um tipo fixo. */}
            {aberta.status.length > 0 && !encerrada && (
              <select
                aria-label="Status do projeto"
                className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
                value={tarefa.statusDoProjetoId ?? ""}
                onChange={(e) => aoEscolherStatusDoProjeto(e.target.value)}
              >
                {aberta.status
                  .filter(
                    (s) => s.tipo !== "a_fazer" || tarefa.trava === null || s.id === tarefa.statusDoProjetoId,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
              </select>
            )}
          </div>
        )}
        {travadaPorOutro && tarefa.trava && (
          <div className="grid gap-2">
            <p className="text-sm text-texto-2">
              Só {nomeDe(tarefa.trava.por, nomesTodos)} muda o status e entrega o resultado enquanto estiver
              com a tarefa. Você ainda pode comentar.
            </p>
            {podeDestravar && (
              <Button
                variant="contorno"
                size="pequeno"
                className="justify-self-start"
                onClick={() => void aoTrava("destravar")}
              >
                Destravar
              </Button>
            )}
          </div>
        )}
        {concluindo && (
          <form className="grid gap-2" onSubmit={(e) => void aoConcluir(e)}>
            <label htmlFor="resultado" className="text-sm font-medium">
              Resultado (o que foi entregue)
            </label>
            <textarea
              id="resultado"
              name="resultado"
              rows={4}
              maxLength={50000}
              className="rounded-md border border-linha bg-cartao px-3 py-2 text-base"
            />
            <div className="flex gap-2">
              <Button type="submit" size="pequeno">
                Concluir tarefa
              </Button>
              <Button type="button" variant="fantasma" size="pequeno" onClick={() => setConcluindo(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Subtarefas
        tarefa={tarefa}
        subtarefas={aberta.subtarefas}
        nomes={nomesTodos}
        podeCriar={podeMexer && !encerrada}
        aoMudar={() => void carregar()}
      />
      <Checklist
        tarefaId={tarefa.id}
        itens={aberta.checklist}
        nomes={nomesTodos}
        podeMexer={podeMexer}
        aoMudar={() => void carregar()}
      />

      {tarefa.resultado && (
        <Card className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitulo>Resultado</CardTitulo>
            <span className="text-sm text-texto-2">por {nomeDe(tarefa.resultadoPor, nomesTodos)}</span>
            <MarcaDeAgente quem={tarefa.resultadoPor} />
          </div>
          <p className="whitespace-pre-wrap text-pretty">{tarefa.resultado}</p>
        </Card>
      )}

      <section className="grid gap-3" aria-label="Comentários">
        <h2 className="text-lg font-semibold">Comentários</h2>
        {comentarios.length === 0 && <p className="text-sm text-texto-2">Nenhum comentário ainda.</p>}
        <ul className="grid gap-2">
          {comentarios.map((c) => (
            <li
              key={c.id}
              data-destaque={destaques.has(c.id) || undefined}
              className={cn(
                "grid gap-1 rounded-lg border border-linha bg-cartao p-3 transition-colors duration-700",
                destaques.has(c.id) && "border-tinta/40 bg-suave",
              )}
            >
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <span className="font-medium text-tinta">{nomeDe(c.autor, nomesTodos)}</span>
                <MarcaDeAgente quem={c.autor} />
                <span>{quando(c.criadoEm)}</span>
              </span>
              <p className="whitespace-pre-wrap text-pretty">{c.texto}</p>
            </li>
          ))}
        </ul>
        <form className="grid gap-2" onSubmit={(e) => void aoComentar(e)}>
          <label htmlFor="comentario" className="sr-only">
            Escrever um comentário
          </label>
          <textarea
            id="comentario"
            name="comentario"
            rows={2}
            maxLength={10000}
            placeholder="Escreva um comentário"
            className="rounded-md border border-linha bg-cartao px-3 py-2 text-base"
          />
          <Button type="submit" variant="contorno" className="justify-self-start">
            Comentar
          </Button>
        </form>
      </section>

      {podeExcluir && (
        <Button
          variant="fantasma"
          className="justify-self-start text-perigo"
          onClick={() => void aoExcluir()}
        >
          Excluir tarefa
        </Button>
      )}
    </main>
  );
}

function Voltar() {
  return (
    <a href="/tarefas" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
      <ArrowLeft className="size-4" /> Tarefas
    </a>
  );
}
