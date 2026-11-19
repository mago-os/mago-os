/**
 * Partes da página da tarefa que entraram no M3-02: subtarefas e checklist. Mudou algo, a página busca de novo
 * (aoMudar), e o tempo real avisa as outras telas abertas.
 */
import type { ItemDeChecklist, Tarefa } from "@mago-os/contratos";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/componentes/ui/button";
import { cn } from "@/lib/utils";
import { criarItemDoChecklist, criarTarefa, editarItemDoChecklist, excluirItemDoChecklist } from "@/tarefas";
import { Aviso } from "./Acesso";
import { Etiqueta, MarcaDeAgente, nomeDe } from "./Tarefas";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

/** Subtarefas da tarefa, com o progresso e um campo para criar mais. */
export function Subtarefas({
  tarefa,
  subtarefas,
  nomes,
  podeCriar,
  aoMudar,
}: {
  tarefa: Tarefa;
  subtarefas: Tarefa[];
  nomes: Record<string, string>;
  podeCriar: boolean;
  aoMudar: () => void;
}) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const prontas = subtarefas.filter((s) => s.status === "concluida" || s.status === "cancelada").length;

  async function aoCriar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const titulo = String(new FormData(form).get("subtarefa")).trim();
    if (!titulo) return;
    const r = await criarTarefa({ titulo, descricao: null, tarefaMaeId: tarefa.id });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem(null);
    form.reset();
    aoMudar();
  }

  // Subtarefa não tem subtarefas (um nível só).
  if (tarefa.tarefaMaeId !== null) return null;
  return (
    <section className="grid gap-3" aria-label="Subtarefas">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Subtarefas</h2>
        {subtarefas.length > 0 && (
          <span className="text-sm text-texto-2">
            {prontas} de {subtarefas.length} prontas
          </span>
        )}
      </div>
      {subtarefas.length === 0 && <p className="text-sm text-texto-2">Nenhuma subtarefa.</p>}
      <ul className="grid gap-2">
        {subtarefas.map((s) => (
          <li key={s.id}>
            <a
              href={`/tarefas/${s.id}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-linha bg-cartao p-3 hover:bg-suave"
            >
              <span
                className={cn(
                  "font-medium text-pretty",
                  (s.status === "concluida" || s.status === "cancelada") && "text-texto-2 line-through",
                )}
              >
                {s.titulo}
              </span>
              <span className="ml-auto flex items-center gap-2 text-xs text-texto-2">
                <Etiqueta status={s.status} />
                <span>{nomeDe(s.responsavel, nomes)}</span>
                <MarcaDeAgente quem={s.responsavel} />
              </span>
            </a>
          </li>
        ))}
      </ul>
      {mensagem && <Aviso {...mensagem} />}
      {podeCriar && (
        <form className="flex gap-2" onSubmit={(e) => void aoCriar(e)}>
          <label htmlFor="subtarefa" className="sr-only">
            Nova subtarefa
          </label>
          <input
            id="subtarefa"
            name="subtarefa"
            maxLength={200}
            placeholder="Nova subtarefa"
            className="h-11 flex-1 rounded-md border border-linha bg-cartao px-3 text-base"
          />
          <Button type="submit" variant="contorno">
            <Plus /> Criar
          </Button>
        </form>
      )}
    </section>
  );
}

/** Checklist da tarefa: marcar, acrescentar e tirar itens. */
export function Checklist({
  tarefaId,
  itens,
  nomes,
  podeMexer,
  aoMudar,
}: {
  tarefaId: string;
  itens: ItemDeChecklist[];
  nomes: Record<string, string>;
  /** Quem edita a tarefa e, travada, é quem pegou (a API confere de novo). */
  podeMexer: boolean;
  aoMudar: () => void;
}) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const feitos = itens.filter((i) => i.marcado).length;

  async function resposta(r: { ok: boolean; mensagem?: string }) {
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
    aoMudar();
  }

  async function aoAcrescentar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const texto = String(new FormData(form).get("item")).trim();
    if (!texto) return;
    const r = await criarItemDoChecklist(tarefaId, texto);
    if (r.ok) form.reset();
    await resposta(r);
  }

  return (
    <section className="grid gap-3" aria-label="Checklist">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Checklist</h2>
        {itens.length > 0 && (
          <span className="text-sm text-texto-2">
            {feitos} de {itens.length}
          </span>
        )}
      </div>
      {itens.length === 0 && <p className="text-sm text-texto-2">Nenhum item.</p>}
      <ul className="grid gap-1">
        {itens.map((i) => (
          <li key={i.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
            <input
              type="checkbox"
              id={`item-${i.id}`}
              className="size-5"
              checked={i.marcado}
              disabled={!podeMexer}
              onChange={(e) =>
                void editarItemDoChecklist(tarefaId, i.id, { marcado: e.target.checked }).then(resposta)
              }
            />
            <label
              htmlFor={`item-${i.id}`}
              className={cn("flex-1 text-pretty", i.marcado && "text-texto-2 line-through")}
            >
              {i.texto}
            </label>
            {i.marcadoPor && (
              <span className="flex items-center gap-1 text-xs text-texto-2">
                {nomeDe(i.marcadoPor, nomes)} <MarcaDeAgente quem={i.marcadoPor} />
              </span>
            )}
            {podeMexer && (
              <button
                type="button"
                aria-label={`Tirar ${i.texto}`}
                className="text-texto-2 hover:text-perigo"
                onClick={() => void excluirItemDoChecklist(tarefaId, i.id).then(resposta)}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {mensagem && <Aviso {...mensagem} />}
      {podeMexer && (
        <form className="flex gap-2" onSubmit={(e) => void aoAcrescentar(e)}>
          <label htmlFor="item" className="sr-only">
            Novo item do checklist
          </label>
          <input
            id="item"
            name="item"
            maxLength={500}
            placeholder="Novo item do checklist"
            className="h-11 flex-1 rounded-md border border-linha bg-cartao px-3 text-base"
          />
          <Button type="submit" variant="contorno">
            <Plus /> Acrescentar
          </Button>
        </form>
      )}
    </section>
  );
}
