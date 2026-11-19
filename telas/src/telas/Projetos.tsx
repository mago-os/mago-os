/**
 * Projetos (M3-01), pensada primeiro para o celular: os espaços com os projetos dentro, e a página do projeto com
 * diretor, gerente, membros e as tarefas dele. Só aparece o que a pessoa alcança (a API confere de novo).
 */
import type { Espaco, Projeto, Responsavel, Tarefa } from "@mago-os/contratos";
import { ArrowLeft, FolderPlus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import {
  abrirProjeto,
  criarEspaco,
  criarProjeto,
  editarEspaco,
  editarProjeto,
  excluirProjeto,
  type ListaDeProjetos,
  listarEspacos,
  listarProjetos,
  type ProjetoAberto,
} from "@/projetos";
import { listarTarefas } from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { useAoVoltar } from "./Administrador";
import { ListasDoProjeto, StatusDoProjetoEditor } from "./ConfigDoProjeto";
import {
  Etiqueta,
  Filtro,
  MarcaDeAgente,
  NovaTarefa,
  nomeDe,
  quando,
  responsavelDoValor,
  SeletorDeResponsavel,
  useAgentesAtivos,
  useDestaques,
  usePessoas,
  valorDoResponsavel,
} from "./Tarefas";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

/** Cores para escolher (a secundária do Mago OS primeiro). */
const CORES = ["#1aa39a", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#64748b"];

function SeletorDeCor({ valor, aoMudar }: { valor: string; aoMudar: (c: string) => void }) {
  return (
    <fieldset className="flex flex-wrap gap-2" aria-label="Cor">
      {CORES.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Cor ${c}`}
          aria-pressed={valor === c}
          onClick={() => aoMudar(c)}
          className={cn("size-7 rounded-full border-2", valor === c ? "border-tinta" : "border-transparent")}
          style={{ backgroundColor: c }}
        />
      ))}
    </fieldset>
  );
}

function Bolinha({ cor }: { cor: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: cor }}
    />
  );
}

/** Lista dos espaços e projetos. */
export function Projetos({
  podeCriarEspaco,
  podeEditarEspaco,
  podeCriarProjeto,
  euId,
}: {
  podeCriarEspaco: boolean;
  podeEditarEspaco: boolean;
  podeCriarProjeto: boolean;
  euId: string;
}) {
  const [arquivados, setArquivados] = useState(false);
  const [espacos, setEspacos] = useState<Espaco[] | null>(null);
  const [lista, setLista] = useState<ListaDeProjetos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState<"espaco" | "projeto" | null>(null);

  const ultimoPedido = useRef(0);
  const carregar = useCallback(async () => {
    const numero = ++ultimoPedido.current;
    const [e, p] = await Promise.all([listarEspacos(true), listarProjetos({ arquivados })]);
    if (numero !== ultimoPedido.current) return;
    if (e.ok && e.dados && p.ok && p.dados) {
      setEspacos(e.dados.espacos);
      setLista(p.dados);
      setErro(null);
    } else setErro(e.mensagem ?? p.mensagem ?? null);
  }, [arquivados]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);
  useTempoReal((aviso) => {
    if (aviso.tipo === "reconectou" || aviso.tipo === "projeto" || aviso.tipo === "tarefa") void carregar();
  });

  const ativos = (espacos ?? []).filter((e) => e.situacao === "ativo");

  async function aoArquivarEspaco(e: Espaco) {
    const arquivar = e.situacao === "ativo";
    if (arquivar && !window.confirm(`Arquivar o espaço ${e.nome}? Os projetos dele continuam guardados.`))
      return;
    const r = await editarEspaco(e.id, { situacao: arquivar ? "arquivado" : "ativo" });
    if (!r.ok) setErro(r.mensagem ?? null);
    void carregar();
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Projetos</h1>
        <div className="flex gap-2">
          {podeCriarEspaco && criando === null && (
            <Button variant="contorno" onClick={() => setCriando("espaco")}>
              <FolderPlus /> Novo espaço
            </Button>
          )}
          {podeCriarProjeto && criando === null && ativos.length > 0 && (
            <Button onClick={() => setCriando("projeto")}>
              <Plus /> Novo projeto
            </Button>
          )}
        </div>
      </div>
      {criando === "espaco" && (
        <NovoEspaco
          aoCancelar={() => setCriando(null)}
          aoCriar={() => {
            setCriando(null);
            void carregar();
          }}
        />
      )}
      {criando === "projeto" && (
        <FormularioDoProjeto
          euId={euId}
          espacos={ativos}
          aoCancelar={() => setCriando(null)}
          aoSalvar={(p) => window.location.assign(`/projetos/${p.id}`)}
        />
      )}
      <fieldset className="flex flex-wrap gap-2" aria-label="Filtros">
        <Filtro ativo={!arquivados} aoClicar={() => setArquivados(false)}>
          Ativos
        </Filtro>
        <Filtro ativo={arquivados} aoClicar={() => setArquivados(true)}>
          Com os arquivados
        </Filtro>
      </fieldset>
      {erro && <Aviso tipo="erro" texto={erro} />}
      {espacos && espacos.length === 0 && (
        <p className="text-sm text-texto-2">
          {podeCriarEspaco
            ? "Nenhum espaço ainda. Crie o primeiro para organizar os projetos (ex.: Operações, Comercial)."
            : "Nenhum espaço ainda."}
        </p>
      )}
      {espacos?.map((e) => {
        const doEspaco = (lista?.projetos ?? []).filter((p) => p.espacoId === e.id);
        // Espaço arquivado só aparece com o filtro, ou quando ainda tem projeto ativo dentro.
        if (e.situacao === "arquivado" && !arquivados && doEspaco.length === 0) return null;
        return (
          <section key={e.id} className="grid gap-2" aria-label={e.nome}>
            <div className="flex items-center gap-2">
              <Bolinha cor={e.cor} />
              <h2 className="text-lg font-semibold">{e.nome}</h2>
              {e.situacao === "arquivado" && <span className="text-xs text-texto-2">arquivado</span>}
              {podeEditarEspaco && (
                <Button
                  variant="fantasma"
                  size="pequeno"
                  className="ml-auto"
                  onClick={() => void aoArquivarEspaco(e)}
                >
                  {e.situacao === "ativo" ? "Arquivar" : "Desarquivar"}
                </Button>
              )}
            </div>
            {doEspaco.length === 0 && (
              <p className="text-sm text-texto-2">Nenhum projeto que você vê aqui.</p>
            )}
            <ul className="grid gap-2">
              {doEspaco.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/projetos/${p.id}`}
                    className="grid gap-1.5 rounded-lg border border-linha bg-cartao p-3 hover:bg-suave"
                  >
                    <span className="flex items-center gap-2 font-medium text-pretty">
                      <Bolinha cor={p.cor} /> {p.nome}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                      <span>Diretor: {lista?.nomes[p.diretorId] ?? "Pessoa"}</span>
                      {p.gerente && <span>Gerente: {nomeDe(p.gerente, lista?.nomes ?? {})}</span>}
                      <MarcaDeAgente quem={p.gerente} />
                      {p.situacao === "arquivado" && <span>arquivado</span>}
                      <span className="ml-auto">
                        {lista?.abertas[p.id] ?? 0} {(lista?.abertas[p.id] ?? 0) === 1 ? "aberta" : "abertas"}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

function NovoEspaco({ aoCancelar, aoCriar }: { aoCancelar: () => void; aoCriar: (e: Espaco) => void }) {
  const [cor, setCor] = useState(CORES[0] as string);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    setEnviando(true);
    const r = await criarEspaco({
      nome: String(f.get("nome")).trim(),
      descricao: String(f.get("descricao")).trim() || null,
      cor,
    });
    setEnviando(false);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoCriar(r.dados);
  }

  return (
    <Card className="gap-4">
      <CardTitulo>Novo espaço</CardTitulo>
      <form className="grid gap-3" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="nome-espaco" name="nome" rotulo="Nome (ex.: Operações)" required maxLength={80} />
        <Campo id="descricao-espaco" name="descricao" rotulo="Para que serve (opcional)" maxLength={5000} />
        <SeletorDeCor valor={cor} aoMudar={setCor} />
        {mensagem && <Aviso {...mensagem} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={enviando}>
            Criar espaço
          </Button>
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Criar (sem "projeto") ou editar um projeto. */
function FormularioDoProjeto({
  euId,
  espacos,
  projeto,
  podeTrocarDiretor = false,
  aoCancelar,
  aoSalvar,
}: {
  euId: string;
  espacos: Espaco[];
  projeto?: Projeto;
  podeTrocarDiretor?: boolean;
  aoCancelar: () => void;
  aoSalvar: (p: Projeto) => void;
}) {
  const pessoas = usePessoas();
  const agentes = useAgentesAtivos();
  const [espacoId, setEspacoId] = useState(projeto?.espacoId ?? espacos[0]?.id ?? "");
  const [cor, setCor] = useState(projeto?.cor ?? (CORES[0] as string));
  const [diretor, setDiretor] = useState(projeto?.diretorId ?? euId);
  const [gerente, setGerente] = useState(valorDoResponsavel(projeto?.gerente ?? null));
  const [membros, setMembros] = useState<Responsavel[]>(
    projeto?.membros.filter((m) => m.papel === "membro").map((m) => m.quem) ?? [],
  );
  const [recebe, setRecebe] = useState(projeto?.gerenteRecebeSemResponsavel ?? false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);

  const chave = (r: Responsavel) => valorDoResponsavel(r);
  const ehMembro = (valor: string) => membros.some((m) => chave(m) === valor);
  function alternarMembro(valor: string) {
    const r = responsavelDoValor(valor);
    if (!r) return;
    setMembros((l) => (ehMembro(valor) ? l.filter((m) => chave(m) !== valor) : [...l, r]));
  }

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const gerenteEscolhido = responsavelDoValor(gerente);
    const dados = {
      espacoId,
      nome: String(f.get("nome")).trim(),
      descricao: String(f.get("descricao")).trim() || null,
      cor,
      gerente: gerenteEscolhido,
      membros: membros.filter((m) => chave(m) !== diretor && chave(m) !== gerente),
      gerenteRecebeSemResponsavel: recebe && gerenteEscolhido !== null,
      inicio: String(f.get("inicio")) || null,
      fim: String(f.get("fim")) || null,
      ...(projeto === undefined || podeTrocarDiretor ? { diretorId: diretor } : {}),
    };
    setEnviando(true);
    const r = projeto ? await editarProjeto(projeto.id, dados) : await criarProjeto(dados);
    setEnviando(false);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoSalvar(r.dados);
  }

  const outrasPessoas = pessoas.filter((p) => p.id !== diretor);
  return (
    <Card className="gap-4">
      <CardTitulo>{projeto ? "Editar projeto" : "Novo projeto"}</CardTitulo>
      <form className="grid gap-3" onSubmit={(e) => void aoEnviar(e)}>
        <Campo
          id="nome-projeto"
          name="nome"
          rotulo="Nome do projeto"
          required
          maxLength={120}
          defaultValue={projeto?.nome}
        />
        <div className="grid gap-1.5">
          <label htmlFor="espaco-projeto" className="text-sm font-medium">
            Espaço
          </label>
          <select
            id="espaco-projeto"
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
            value={espacoId}
            onChange={(e) => setEspacoId(e.target.value)}
          >
            {espacos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="descricao-projeto" className="text-sm font-medium">
            Para que serve (opcional)
          </label>
          <textarea
            id="descricao-projeto"
            name="descricao"
            rows={2}
            maxLength={5000}
            defaultValue={projeto?.descricao ?? ""}
            className="rounded-md border border-linha bg-cartao px-3 py-2 text-base"
          />
        </div>
        {(projeto === undefined || podeTrocarDiretor) && (
          <div className="grid gap-1.5">
            <label htmlFor="diretor-projeto" className="text-sm font-medium">
              Diretor (dono do projeto e das decisões)
            </label>
            <select
              id="diretor-projeto"
              className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
              value={diretor}
              onChange={(e) => setDiretor(e.target.value)}
            >
              {pessoas.length === 0 && <option value={euId}>Eu</option>}
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === euId ? `${p.nome} (eu)` : p.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor="gerente-projeto" className="text-sm font-medium">
            Gerente (cuida da rotina, pode ser um agente)
          </label>
          <SeletorDeResponsavel
            id="gerente-projeto"
            valor={gerente}
            aoMudar={setGerente}
            pessoas={outrasPessoas}
            agentes={agentes}
            extras={[{ valor: "", nome: "Sem gerente" }]}
          />
        </div>
        {gerente && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recebe} onChange={(e) => setRecebe(e.target.checked)} />O gerente
            recebe as tarefas do projeto criadas sem responsável
          </label>
        )}
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Membros</legend>
          <div className="flex flex-wrap gap-2">
            {[
              ...outrasPessoas.map((p) => ({ valor: p.id, nome: p.nome })),
              ...agentes.map((a) => ({ valor: `agente:${a.id}`, nome: a.nome })),
            ]
              .filter((x) => x.valor !== gerente)
              .map((x) => (
                <button
                  key={x.valor}
                  type="button"
                  aria-pressed={ehMembro(x.valor)}
                  onClick={() => alternarMembro(x.valor)}
                  className={cn(
                    "rounded-full border border-linha px-3 py-1.5 text-sm",
                    ehMembro(x.valor) ? "bg-tinta text-sobre-tinta" : "text-texto-2",
                  )}
                >
                  {x.nome}
                </button>
              ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Campo
            id="inicio-projeto"
            name="inicio"
            type="date"
            rotulo="Início"
            defaultValue={projeto?.inicio ?? ""}
          />
          <Campo
            id="fim-projeto"
            name="fim"
            type="date"
            rotulo="Fim previsto"
            defaultValue={projeto?.fim ?? ""}
          />
        </div>
        <SeletorDeCor valor={cor} aoMudar={setCor} />
        {mensagem && <Aviso {...mensagem} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={enviando || !espacoId}>
            {projeto ? "Salvar" : "Criar projeto"}
          </Button>
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Página de um projeto: quem faz parte e as tarefas dele. */
export function PaginaDoProjeto({
  id,
  euId,
  administra,
  podeCriarTarefa,
  podeExcluir,
}: {
  id: string;
  euId: string;
  /** Vê e edita todos os projetos (o administrador): troca o diretor de qualquer um. */
  administra: boolean;
  podeCriarTarefa: boolean;
  podeExcluir: boolean;
}) {
  const [aberto, setAberto] = useState<ProjetoAberto | null | undefined>(undefined);
  const [tarefas, setTarefas] = useState<{
    tarefas: Tarefa[];
    nomes: Record<string, string>;
    subtarefas?: Record<string, { total: number; prontas: number }>;
  } | null>(null);
  const [abertas, setAbertas] = useState(true);
  const [espacos, setEspacos] = useState<Espaco[]>([]);
  const [editando, setEditando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  const ultimoPedido = useRef(0);
  const carregar = useCallback(async () => {
    const numero = ++ultimoPedido.current;
    const [p, t] = await Promise.all([
      abrirProjeto(id),
      listarTarefas({
        minhas: false,
        status: abertas ? ["a_fazer", "em_andamento", "precisa_de_ajuda"] : [],
        projetoId: id,
      }),
    ]);
    if (numero !== ultimoPedido.current) return;
    setAberto(p.ok && p.dados ? p.dados : null);
    if (t.ok && t.dados) setTarefas(t.dados);
  }, [id, abertas]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useEffect(() => {
    void listarEspacos().then((r) => setEspacos(r.dados?.espacos ?? []));
  }, []);
  useAoVoltar(carregar);
  const [destaques, destacar] = useDestaques();
  useTempoReal((aviso) => {
    if (aviso.tipo === "reconectou") void carregar();
    // O projeto, o espaço dele, ou uma tarefa nova ou desta lista mudou.
    if (aviso.tipo === "projeto" && (aviso.id === id || aviso.id === aberto?.projeto.espacoId))
      void carregar();
    if (
      aviso.tipo === "tarefa" &&
      (aviso.operacao === "insert" || tarefas?.tarefas.some((t) => t.id === aviso.id))
    ) {
      void carregar();
      destacar(aviso.id);
    }
  });

  if (aberto === undefined) return <main className="min-h-dvh" aria-busy="true" />;
  if (aberto === null) {
    return (
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
        <Voltar />
        <p className="text-texto-2">Projeto não encontrado, ou você não tem acesso a ele.</p>
      </main>
    );
  }
  const { projeto, espaco, nomes, listas, status } = aberto;
  // As subtarefas aparecem dentro da tarefa-mãe (com o progresso), não soltas na lista.
  const principais = (tarefas?.tarefas ?? []).filter((t) => t.tarefaMaeId === null);
  // Edita o diretor e quem vê todos os projetos com a permissão de editar (a API confere de novo).
  const podeEditar = administra || projeto.diretorId === euId;

  async function aoArquivar() {
    const arquivar = projeto.situacao === "ativo";
    if (arquivar && !window.confirm("Arquivar este projeto? Ele some das listas, sem apagar nada.")) return;
    const r = await editarProjeto(projeto.id, { situacao: arquivar ? "arquivado" : "ativo" });
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
    void carregar();
  }

  async function aoExcluir() {
    if (!window.confirm("Excluir este projeto de vez? Isso não tem volta.")) return;
    const r = await excluirProjeto(projeto.id);
    if (r.ok) window.location.assign("/projetos");
    else setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }

  const membros = projeto.membros.filter((m) => m.papel === "membro");
  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <Voltar />
      <div className="grid gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-texto-2 uppercase">
          {espaco && <Bolinha cor={espaco.cor} />} {espaco?.nome ?? "Espaço"}
        </p>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-pretty">
          <Bolinha cor={projeto.cor} /> {projeto.nome}
        </h1>
        {projeto.situacao === "arquivado" && <p className="text-sm text-texto-2">Projeto arquivado.</p>}
        {projeto.descricao && <p className="whitespace-pre-wrap text-pretty">{projeto.descricao}</p>}
      </div>
      {mensagem && <Aviso {...mensagem} />}

      {editando ? (
        <FormularioDoProjeto
          euId={euId}
          espacos={espacos.filter((e) => e.situacao === "ativo" || e.id === projeto.espacoId)}
          projeto={projeto}
          podeTrocarDiretor={administra}
          aoCancelar={() => setEditando(false)}
          aoSalvar={() => {
            setEditando(false);
            setMensagem({ tipo: "ok", texto: "Projeto salvo." });
            void carregar();
          }}
        />
      ) : (
        <Card className="gap-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-texto-2">Diretor</dt>
              <dd className="font-medium">{nomes[projeto.diretorId] ?? "Pessoa"}</dd>
            </div>
            <div>
              <dt className="text-texto-2">Gerente</dt>
              <dd className="flex items-center gap-2 font-medium">
                {projeto.gerente ? nomeDe(projeto.gerente, nomes) : "Sem gerente"}
                <MarcaDeAgente quem={projeto.gerente} />
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-texto-2">Membros</dt>
              <dd>
                {membros.length === 0
                  ? "Nenhum outro membro"
                  : membros.map((m) => nomeDe(m.quem, nomes)).join(", ")}
              </dd>
            </div>
            {(projeto.inicio || projeto.fim) && (
              <div className="sm:col-span-2">
                <dt className="text-texto-2">Datas</dt>
                <dd>
                  {projeto.inicio ? `De ${dia(projeto.inicio)}` : ""}
                  {projeto.fim ? ` até ${dia(projeto.fim)}` : ""}
                </dd>
              </div>
            )}
          </dl>
          {projeto.gerenteRecebeSemResponsavel && (
            <p className="text-sm text-texto-2">O gerente recebe as tarefas criadas sem responsável.</p>
          )}
          {podeEditar && (
            <div className="flex flex-wrap gap-2">
              <Button variant="contorno" size="pequeno" onClick={() => setEditando(true)}>
                Editar
              </Button>
              <Button variant="fantasma" size="pequeno" onClick={() => void aoArquivar()}>
                {projeto.situacao === "ativo" ? "Arquivar" : "Desarquivar"}
              </Button>
              {podeExcluir && (
                <Button
                  variant="fantasma"
                  size="pequeno"
                  className="text-perigo"
                  onClick={() => void aoExcluir()}
                >
                  Excluir
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {podeEditar && !editando && (
        <details className="grid gap-3">
          <summary className="cursor-pointer text-sm font-medium text-texto-2">
            Listas e status do projeto
          </summary>
          <div className="mt-3 grid gap-3">
            <ListasDoProjeto projetoId={projeto.id} listas={listas} aoMudar={() => void carregar()} />
            <StatusDoProjetoEditor projetoId={projeto.id} status={status} aoMudar={() => void carregar()} />
          </div>
        </details>
      )}

      <section className="grid gap-3" aria-label="Tarefas do projeto">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Tarefas</h2>
          {podeCriarTarefa && projeto.situacao === "ativo" && !criando && (
            <Button size="pequeno" onClick={() => setCriando(true)}>
              <Plus /> Nova tarefa
            </Button>
          )}
        </div>
        {criando && (
          <NovaTarefa
            euId={euId}
            projetoId={projeto.id}
            aoCancelar={() => setCriando(false)}
            aoCriar={(t) => window.location.assign(`/tarefas/${t.id}`)}
          />
        )}
        <fieldset className="flex flex-wrap gap-2" aria-label="Filtros das tarefas">
          <Filtro ativo={abertas} aoClicar={() => setAbertas(true)}>
            Abertas
          </Filtro>
          <Filtro ativo={!abertas} aoClicar={() => setAbertas(false)}>
            Todas
          </Filtro>
        </fieldset>
        {tarefas && principais.length === 0 && (
          <p className="text-sm text-texto-2">Nenhuma tarefa que você vê neste projeto.</p>
        )}
        {listas.map((l) => {
          const daLista = principais.filter((t) => t.listaId === l.id);
          if (daLista.length === 0 && listas.length > 1) return null;
          return (
            <div key={l.id} className="grid gap-2">
              {listas.length > 1 && <h3 className="text-sm font-semibold text-texto-2">{l.nome}</h3>}
              <ul className="grid gap-2">
                {daLista.map((t) => {
                  const s2 = status.find((x) => x.id === t.statusDoProjetoId);
                  const sub = tarefas?.subtarefas?.[t.id];
                  return (
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
                          {s2 ? (
                            <span className="flex items-center gap-1.5 rounded-full bg-suave px-2.5 py-0.5 font-medium">
                              <span
                                aria-hidden
                                className="size-2 rounded-full"
                                style={{ backgroundColor: s2.cor }}
                              />
                              {s2.nome}
                            </span>
                          ) : (
                            <Etiqueta status={t.status} />
                          )}
                          <span>{nomeDe(t.responsavel, tarefas?.nomes ?? {})}</span>
                          <MarcaDeAgente quem={t.responsavel} />
                          {sub && (
                            <span>
                              {sub.prontas}/{sub.total} subtarefas
                            </span>
                          )}
                          <span className="ml-auto">{quando(t.atualizadaEm)}</span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
    </main>
  );
}

const dia = (d: string) => {
  const [a, m, di] = d.split("-");
  return `${di}/${m}/${a}`;
};

function Voltar() {
  return (
    <a href="/projetos" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
      <ArrowLeft className="size-4" /> Projetos
    </a>
  );
}
