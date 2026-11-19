/**
 * Listas e status do projeto (M3-02), na página do projeto, para quem edita o projeto (o diretor, ou quem edita
 * todos). A API confere de novo e o banco mantém as tarefas no lugar certo.
 */
import {
  type Lista,
  NOMES_STATUS_TAREFA,
  STATUS_TAREFA,
  type StatusDoProjeto,
  type StatusTarefa,
} from "@mago-os/contratos";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { criarLista, editarLista, excluirLista, salvarStatus } from "@/projetos";
import { Aviso } from "./Acesso";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

export function ListasDoProjeto({
  projetoId,
  listas,
  aoMudar,
}: {
  projetoId: string;
  listas: Lista[];
  aoMudar: () => void;
}) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  async function resposta(r: { ok: boolean; mensagem?: string }, ok?: string) {
    setMensagem(r.ok ? (ok ? { tipo: "ok", texto: ok } : null) : { tipo: "erro", texto: r.mensagem ?? "" });
    aoMudar();
  }

  async function aoCriar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const form = evento.currentTarget;
    const nome = String(new FormData(form).get("lista")).trim();
    if (!nome) return;
    const r = await criarLista(projetoId, nome);
    if (r.ok) form.reset();
    await resposta(r);
  }

  async function aoRenomear(l: Lista) {
    const nome = window.prompt("Novo nome da lista", l.nome)?.trim();
    if (!nome || nome === l.nome) return;
    await resposta(await editarLista(l.id, { nome }));
  }

  async function aoExcluir(l: Lista) {
    if (!window.confirm(`Excluir a lista ${l.nome}? As tarefas dela passam para a primeira outra lista.`))
      return;
    await resposta(await excluirLista(l.id), "Lista excluída. As tarefas foram para outra lista.");
  }

  return (
    <Card className="gap-3">
      <CardTitulo>Listas</CardTitulo>
      <ul className="grid gap-1">
        {listas.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <span className="flex-1">{l.nome}</span>
            <Button variant="fantasma" size="pequeno" onClick={() => void aoRenomear(l)}>
              Renomear
            </Button>
            {listas.length > 1 && (
              <button
                type="button"
                aria-label={`Excluir a lista ${l.nome}`}
                className="text-texto-2 hover:text-perigo"
                onClick={() => void aoExcluir(l)}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {mensagem && <Aviso {...mensagem} />}
      <form className="flex gap-2" onSubmit={(e) => void aoCriar(e)}>
        <label htmlFor="nova-lista" className="sr-only">
          Nova lista
        </label>
        <input
          id="nova-lista"
          name="lista"
          maxLength={80}
          placeholder="Nova lista (ex.: Execução)"
          className="h-11 flex-1 rounded-md border border-linha bg-cartao px-3 text-base"
        />
        <Button type="submit" variant="contorno">
          <Plus /> Criar
        </Button>
      </form>
    </Card>
  );
}

interface StatusEditado {
  id?: string;
  nome: string;
  cor: string;
  tipo: StatusTarefa;
}

/** Os status do projeto, editados juntos e gravados de uma vez. */
export function StatusDoProjetoEditor({
  projetoId,
  status,
  aoMudar,
}: {
  projetoId: string;
  status: StatusDoProjeto[];
  aoMudar: () => void;
}) {
  const [editados, setEditados] = useState<StatusEditado[]>([]);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  useEffect(() => setEditados(status.map(({ id, nome, cor, tipo }) => ({ id, nome, cor, tipo }))), [status]);

  const mudar = (i: number, m: Partial<StatusEditado>) =>
    setEditados((l) => l.map((s, j) => (j === i ? { ...s, ...m } : s)));

  async function aoSalvar() {
    const r = await salvarStatus(projetoId, {
      status: editados.map((s) => ({
        ...(s.id ? { id: s.id } : {}),
        nome: s.nome.trim(),
        cor: s.cor,
        tipo: s.tipo,
      })),
    });
    setMensagem(
      r.ok
        ? { tipo: "ok", texto: "Status salvos." }
        : { tipo: "erro", texto: r.mensagem ?? "Confira: um status de cada tipo, sem nome repetido." },
    );
    aoMudar();
  }

  return (
    <Card className="gap-3">
      <CardTitulo>Status do projeto</CardTitulo>
      <p className="text-sm text-texto-2">
        Cada status pertence a um tipo fixo, e o projeto precisa de pelo menos um de cada tipo. O tipo de um
        status já criado não muda.
      </p>
      <ul className="grid gap-2">
        {editados.map((s, i) => (
          <li key={s.id ?? `novo-${i}`} className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label={`Cor de ${s.nome}`}
              value={s.cor}
              onChange={(e) => mudar(i, { cor: e.target.value.toLowerCase() })}
              className="size-9 rounded border border-linha"
            />
            <input
              aria-label="Nome do status"
              value={s.nome}
              maxLength={40}
              onChange={(e) => mudar(i, { nome: e.target.value })}
              className="h-10 min-w-0 flex-1 rounded-md border border-linha bg-cartao px-3 text-base"
            />
            {s.id ? (
              <span className="text-xs text-texto-2">{NOMES_STATUS_TAREFA[s.tipo]}</span>
            ) : (
              <select
                aria-label="Tipo do status"
                value={s.tipo}
                onChange={(e) => mudar(i, { tipo: e.target.value as StatusTarefa })}
                className="h-10 rounded-md border border-linha bg-cartao px-2 text-sm"
              >
                {STATUS_TAREFA.map((t) => (
                  <option key={t} value={t}>
                    {NOMES_STATUS_TAREFA[t]}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              aria-label={`Tirar ${s.nome}`}
              className="text-texto-2 hover:text-perigo"
              onClick={() => setEditados((l) => l.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {mensagem && <Aviso {...mensagem} />}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="contorno"
          size="pequeno"
          onClick={() =>
            setEditados((l) => [...l, { nome: "Novo status", cor: "#64748b", tipo: "em_andamento" }])
          }
        >
          <Plus /> Novo status
        </Button>
        <Button size="pequeno" onClick={() => void aoSalvar()}>
          Salvar status
        </Button>
      </div>
    </Card>
  );
}
