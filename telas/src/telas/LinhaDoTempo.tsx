/**
 * Linha do tempo da tarefa (M3-05): comentários, notas internas (fundo próprio, só pessoas veem) e os acontecimentos,
 * em ordem. Menções com @ (a lista sugere pessoas e agentes ao digitar), Markdown simples mostrado com limpeza (o
 * React monta só texto e elementos conhecidos, nunca HTML do texto), editar em até 15 minutos e apagar.
 */
import {
  type AcontecimentoDaTarefa,
  type ComentarioDeTarefa,
  NOMES_PRIORIDADE,
  NOMES_STATUS_TAREFA,
  type Prioridade,
  type Responsavel,
  type StatusTarefa,
} from "@mago-os/contratos";
import { Lock } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { PessoaDaEmpresa } from "@/acesso";
import type { AgenteNaLista } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { cn } from "@/lib/utils";
import { apagarComentario, comentarTarefa, editarComentario } from "@/tarefas";
import { Aviso } from "./Acesso";
import { MarcaDeAgente, nomeDe, quando } from "./Tarefas";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

// Markdown simples -----------------------------------------------------------------------------------------------

/** Trecho de uma linha: **negrito**, `código` e [link](https://...) (só http e https). O resto é texto. */
function emLinha(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const padrao = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let ultimo = 0;
  let m: RegExpExecArray | null = padrao.exec(texto);
  while (m) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    const pedaco = m[0];
    if (pedaco.startsWith("**")) partes.push(<strong key={m.index}>{pedaco.slice(2, -2)}</strong>);
    else if (pedaco.startsWith("`"))
      partes.push(
        <code key={m.index} className="rounded bg-suave px-1 text-[0.9em]">
          {pedaco.slice(1, -1)}
        </code>,
      );
    else {
      const rotulo = pedaco.slice(1, pedaco.indexOf("]"));
      partes.push(
        <a key={m.index} href={m[2]} target="_blank" rel="noopener noreferrer nofollow" className="underline">
          {rotulo}
        </a>,
      );
    }
    ultimo = m.index + pedaco.length;
    m = padrao.exec(texto);
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

/** Markdown simples em elementos do React: parágrafos, listas com "- " e o que emLinha entende. */
export function TextoComFormatacao({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  const linhas = texto.split("\n");
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length === 0) return;
    blocos.push(
      <ul key={`l${blocos.length}`} className="list-disc pl-5">
        {lista.map((item, i) => (
          <li key={`${i}:${item}`}>{emLinha(item)}</li>
        ))}
      </ul>,
    );
    lista = [];
  };
  for (const linha of linhas) {
    if (/^\s*[-*] /.test(linha)) {
      lista.push(linha.replace(/^\s*[-*] /, ""));
      continue;
    }
    fecharLista();
    blocos.push(
      <p key={`p${blocos.length}`} className="whitespace-pre-wrap text-pretty">
        {emLinha(linha)}
      </p>,
    );
  }
  fecharLista();
  return <div className="grid gap-1">{blocos}</div>;
}

// Acontecimentos -------------------------------------------------------------------------------------------------

function textoDoAcontecimento(a: AcontecimentoDaTarefa, nomes: Record<string, string>): string {
  const d = a.detalhes as Record<string, unknown>;
  switch (a.tipo) {
    case "criou":
      return "criou a tarefa";
    case "mudou_status":
      return `mudou o status para ${NOMES_STATUS_TAREFA[d.para as StatusTarefa] ?? "outro"}`;
    case "entregou_resultado":
      return "entregou o resultado e concluiu";
    case "trocou_responsavel":
      return d.para ? `passou a tarefa para ${nomeDe(d.para as Responsavel, nomes)}` : "tirou o responsável";
    case "mudou_prazo":
      return d.dia ? `mudou o prazo para ${String(d.dia).split("-").reverse().join("/")}` : "tirou o prazo";
    case "mudou_prioridade":
      return d.para
        ? `mudou a prioridade para ${NOMES_PRIORIDADE[d.para as Prioridade]}`
        : "tirou a prioridade";
    case "mudou_projeto":
      return d.para ? "mudou o projeto" : "tirou do projeto";
    case "mudou_lista":
      return "mudou de lista";
    case "pegou":
      return "pegou a tarefa";
    case "soltou":
      return "soltou a tarefa";
  }
}

// A linha do tempo -----------------------------------------------------------------------------------------------

type Item =
  | { tipo: "comentario"; c: ComentarioDeTarefa }
  | { tipo: "acontecimento"; a: AcontecimentoDaTarefa };

export function LinhaDoTempo({
  tarefaId,
  comentarios,
  acontecimentos,
  nomes,
  pessoas,
  agentes,
  euId,
  podeApagarTodos,
  destaques,
  aoMudar,
}: {
  tarefaId: string;
  comentarios: ComentarioDeTarefa[];
  acontecimentos: AcontecimentoDaTarefa[];
  nomes: Record<string, string>;
  pessoas: PessoaDaEmpresa[];
  agentes: AgenteNaLista[];
  euId: string;
  /** Apaga comentários dos outros (quem exclui qualquer tarefa). */
  podeApagarTodos: boolean;
  destaques: Set<string>;
  aoMudar: () => void;
}) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const itens: Item[] = [
    ...comentarios.map((c) => ({ tipo: "comentario" as const, c })),
    ...acontecimentos.map((a) => ({ tipo: "acontecimento" as const, a })),
  ].sort((x, y) =>
    (x.tipo === "comentario" ? x.c.criadoEm : x.a.criadoEm).localeCompare(
      y.tipo === "comentario" ? y.c.criadoEm : y.a.criadoEm,
    ),
  );

  async function aoApagar(c: ComentarioDeTarefa) {
    if (!window.confirm('Apagar este comentário? Fica "comentário apagado" no lugar.')) return;
    const r = await apagarComentario(tarefaId, c.id);
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
    aoMudar();
  }

  async function aoSalvarEdicao(c: ComentarioDeTarefa, texto: string) {
    const r = await editarComentario(tarefaId, c.id, texto);
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
    if (r.ok) setEditando(null);
    aoMudar();
  }

  return (
    <section className="grid gap-3" aria-label="Comentários">
      <h2 className="text-lg font-semibold">Comentários</h2>
      {itens.length === 0 && <p className="text-sm text-texto-2">Nenhum comentário ainda.</p>}
      <ul className="grid gap-2">
        {itens.map((item) => {
          if (item.tipo === "acontecimento") {
            const a = item.a;
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-texto-2">
                <span className="font-medium">{nomeDe(a.autor, nomes)}</span>
                <MarcaDeAgente quem={a.autor} />
                <span>{textoDoAcontecimento(a, nomes)}</span>
                <span>· {quando(a.criadoEm)}</span>
              </li>
            );
          }
          const c = item.c;
          const meu = c.autor.tipo === "pessoa" && c.autor.pessoaId === euId;
          const podeEditar = meu && !c.apagadoEm && Date.now() - new Date(c.criadoEm).getTime() < 15 * 60_000;
          const interna = c.tipo === "nota_interna";
          return (
            <li
              key={c.id}
              data-destaque={destaques.has(c.id) || undefined}
              className={cn(
                "grid gap-1 rounded-lg border p-3 transition-colors duration-700",
                interna ? "border-amber-300/60 bg-amber-50 dark:bg-amber-950/30" : "border-linha bg-cartao",
                destaques.has(c.id) && "border-tinta/40 bg-suave",
              )}
            >
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <span className="font-medium text-tinta">{nomeDe(c.autor, nomes)}</span>
                <MarcaDeAgente quem={c.autor} />
                {interna && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                    <Lock className="size-3" /> nota interna
                  </span>
                )}
                <span>{quando(c.criadoEm)}</span>
                {c.editadoEm && !c.apagadoEm && <span>(editado)</span>}
                <span className="ml-auto flex gap-1">
                  {podeEditar && editando !== c.id && (
                    <button type="button" className="hover:text-tinta" onClick={() => setEditando(c.id)}>
                      Editar
                    </button>
                  )}
                  {!c.apagadoEm && (meu || podeApagarTodos) && (
                    <button type="button" className="hover:text-perigo" onClick={() => void aoApagar(c)}>
                      Apagar
                    </button>
                  )}
                </span>
              </span>
              {c.apagadoEm ? (
                <p className="text-sm italic text-texto-2">Comentário apagado.</p>
              ) : editando === c.id ? (
                <EdicaoDoComentario
                  inicial={c.texto ?? ""}
                  aoSalvar={(t) => void aoSalvarEdicao(c, t)}
                  aoCancelar={() => setEditando(null)}
                />
              ) : c.autor.tipo === "agente" ? (
                // O que vem de agente aparece só como texto (M2-05).
                <p className="whitespace-pre-wrap text-pretty">{c.texto}</p>
              ) : (
                <TextoComFormatacao texto={c.texto ?? ""} />
              )}
            </li>
          );
        })}
      </ul>
      {mensagem && <Aviso {...mensagem} />}
      <NovoComentario tarefaId={tarefaId} pessoas={pessoas} agentes={agentes} aoComentar={aoMudar} />
    </section>
  );
}

function EdicaoDoComentario({
  inicial,
  aoSalvar,
  aoCancelar,
}: {
  inicial: string;
  aoSalvar: (texto: string) => void;
  aoCancelar: () => void;
}) {
  const [texto, setTexto] = useState(inicial);
  return (
    <div className="grid gap-2">
      <textarea
        aria-label="Editar o comentário"
        rows={2}
        maxLength={10000}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        className="rounded-md border border-linha bg-cartao px-3 py-2 text-base"
      />
      <div className="flex gap-2">
        <Button size="pequeno" disabled={!texto.trim()} onClick={() => aoSalvar(texto.trim())}>
          Salvar
        </Button>
        <Button variant="fantasma" size="pequeno" onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

const chaveDe = (r: Responsavel) => (r.tipo === "pessoa" ? `p:${r.pessoaId}` : `a:${r.agenteId}`);

interface Mencionavel {
  quem: Responsavel;
  nome: string;
}

/** Caixa de comentário com @ (sugere pessoas e agentes ao digitar) e a opção de nota interna. */
function NovoComentario({
  tarefaId,
  pessoas,
  agentes,
  aoComentar,
}: {
  tarefaId: string;
  pessoas: PessoaDaEmpresa[];
  agentes: AgenteNaLista[];
  aoComentar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [interna, setInterna] = useState(false);
  const [mencoes, setMencoes] = useState<Mencionavel[]>([]);
  const [busca, setBusca] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);
  const todos: Mencionavel[] = [
    ...pessoas.map((p) => ({ quem: { tipo: "pessoa" as const, pessoaId: p.id }, nome: p.nome })),
    ...agentes.map((a) => ({ quem: { tipo: "agente" as const, agenteId: a.id }, nome: a.nome })),
  ];
  const sugestoes =
    busca === null ? [] : todos.filter((m) => m.nome.toLowerCase().includes(busca.toLowerCase())).slice(0, 6);

  function aoDigitar(valor: string, cursor: number) {
    setTexto(valor);
    // "@" seguido de letras logo antes do cursor abre as sugestões.
    const m = /(?:^|\s)@([\p{L}\p{N} ]{0,30})$/u.exec(valor.slice(0, cursor));
    setBusca(m ? (m[1] ?? "") : null);
  }

  function escolher(m: Mencionavel) {
    const cursor = caixa.current?.selectionStart ?? texto.length;
    const antes = texto.slice(0, cursor).replace(/@([\p{L}\p{N} ]{0,30})$/u, `@${m.nome} `);
    setTexto(antes + texto.slice(cursor));
    setMencoes((l) => (l.some((x) => chaveDe(x.quem) === chaveDe(m.quem)) ? l : [...l, m]));
    setBusca(null);
    caixa.current?.focus();
  }

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!texto.trim()) return;
    // Só vale a menção que continua no texto.
    const valendo = mencoes.filter((m) => texto.includes(`@${m.nome}`)).map((m) => m.quem);
    const enviado = texto;
    const r = await comentarTarefa(tarefaId, texto.trim(), { interna, mencoes: valendo });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem(null);
    // O tempo real pode mostrar o comentário antes da resposta chegar: o que a pessoa já começou a escrever depois
    // não se perde.
    const agora = caixa.current?.value ?? enviado;
    if (agora !== enviado) {
      // Só fica o que foi escrito depois do envio (ou o texto novo inteiro, se a caixa foi trocada).
      setTexto(agora.startsWith(enviado) ? agora.slice(enviado.length).trimStart() : agora);
      setMencoes([]);
      return aoComentar();
    }
    setTexto("");
    setMencoes([]);
    setInterna(false);
    aoComentar();
  }

  return (
    <form className="relative grid gap-2" onSubmit={(e) => void aoEnviar(e)}>
      <label htmlFor="comentario" className="sr-only">
        Escrever um comentário
      </label>
      <textarea
        ref={caixa}
        id="comentario"
        name="comentario"
        rows={2}
        maxLength={10000}
        placeholder="Escreva um comentário (use @ para mencionar)"
        value={texto}
        onChange={(e) => aoDigitar(e.target.value, e.target.selectionStart)}
        className={cn(
          "rounded-md border bg-cartao px-3 py-2 text-base",
          interna ? "border-amber-400" : "border-linha",
        )}
      />
      {sugestoes.length > 0 && (
        <ul
          aria-label="Mencionar"
          className="absolute top-full z-10 mt-1 grid w-64 gap-0.5 rounded-md border border-linha bg-cartao p-1 shadow-lg"
        >
          {sugestoes.map((m) => (
            <li key={chaveDe(m.quem)}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-suave"
                onClick={() => escolher(m)}
              >
                {m.nome}
                {m.quem.tipo === "agente" && <MarcaDeAgente quem={m.quem} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {mensagem && <Aviso {...mensagem} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="contorno">
          {interna ? "Salvar nota interna" : "Comentar"}
        </Button>
        <label className="flex items-center gap-2 text-sm text-texto-2">
          <input type="checkbox" checked={interna} onChange={(e) => setInterna(e.target.checked)} />
          Nota interna (só pessoas da empresa veem)
        </label>
        <span className="text-xs text-texto-2">
          **negrito**, `código`, [link](https://...) e listas com "- "
        </span>
      </div>
    </form>
  );
}
