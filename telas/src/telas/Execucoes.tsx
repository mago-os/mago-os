/**
 * Passo a passo das execuções (M4-07): a página de uma execução, a lista de execuções de uma tarefa (com o que os
 * agentes externos fizeram nela pelo MCP) e a lista de execuções recentes de um agente. Texto do agente e resultados
 * aparecem só como texto, nunca como HTML.
 */
import type {
  AtividadeExterna,
  DetalheDaExecucao,
  ExecucaoNaLista,
  PassoDaExecucao,
} from "@mago-os/contratos";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { dolares } from "./Custos";

const NOME_DA_SITUACAO: Record<string, string> = {
  na_fila: "Na fila",
  rodando: "Rodando",
  concluida: "Concluída",
  falhou: "Falhou",
  parada: "Parada",
};
const NOME_DA_ORIGEM: Record<string, string> = {
  conversa: "Conversa",
  tarefa: "Tarefa atribuída",
  delegacao: "Delegação",
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const duracao = (ms: number | null) =>
  ms === null
    ? ""
    : ms < 1000
      ? `${ms} ms`
      : ms < 60_000
        ? `${(ms / 1000).toFixed(1)} s`
        : `${Math.round(ms / 60_000)} min`;

/** Um valor de ferramenta (parâmetros ou resultado) como texto formatado. */
function Dados({ rotulo, valor }: { rotulo: string; valor: unknown }) {
  if (valor === null || valor === undefined) return null;
  const texto = typeof valor === "string" ? valor : JSON.stringify(valor, null, 2);
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-texto-2">{rotulo}</summary>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-suave p-2 whitespace-pre-wrap break-words">
        {texto}
      </pre>
    </details>
  );
}

function Passo({ p }: { p: PassoDaExecucao }) {
  return (
    <li className="grid gap-1 rounded-md border border-linha p-2.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium">
          {p.numero}.{" "}
          {p.tipo === "modelo"
            ? `Modelo${p.modelo ? ` (${p.modelo})` : ""}`
            : p.tipo === "ferramenta"
              ? `Ferramenta ${p.ferramenta}`
              : "Aviso do sistema"}
        </span>
        {p.erro && <span className="rounded-full bg-perigo/10 px-2 text-xs text-perigo">recusou</span>}
        {p.aprovacaoId && (
          <a href={`/aprovacoes/${p.aprovacaoId}`} className="text-xs underline">
            pedido de aprovação
          </a>
        )}
        <span className="ml-auto text-xs text-texto-2">
          {quando(p.criadoEm)}
          {p.duracaoMs !== null ? ` · ${duracao(p.duracaoMs)}` : ""}
          {p.custo !== null ? ` · ${dolares(p.custo)}` : ""}
          {p.tokens
            ? ` · ${(p.tokens.entrada + p.tokens.saida + p.tokens.cache).toLocaleString("pt-BR")} tokens`
            : ""}
        </span>
      </div>
      {p.tipo === "modelo" && p.ferramenta && <p className="text-xs text-texto-2">Pediu: {p.ferramenta}</p>}
      {p.texto && <p className="whitespace-pre-wrap break-words">{p.texto}</p>}
      <Dados rotulo="Parâmetros" valor={p.entrada} />
      <Dados rotulo={p.erro ? "Recusa" : "Resultado"} valor={p.resultado} />
      {p.cortado && (
        <p className="text-xs text-texto-2">Parte dos dados foi cortada (passou do limite guardado).</p>
      )}
    </li>
  );
}

export function PaginaDaExecucao({ id }: { id: string }) {
  const [d, setD] = useState<DetalheDaExecucao | null | undefined>(undefined);
  useEffect(() => {
    void pedir<DetalheDaExecucao>("GET", `/execucoes/${encodeURIComponent(id)}`).then((r) =>
      setD(r.ok && r.dados ? r.dados : null),
    );
  }, [id]);
  if (d === undefined) return <main className="px-4 py-8 text-sm text-texto-2">Carregando...</main>;
  if (d === null)
    return (
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-8">
        <Aviso tipo="erro" texto="Execução não encontrada, ou você não vê a tarefa dela." />
      </main>
    );
  const e = d.execucao;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a
        href={e.tarefaId ? `/tarefas/${e.tarefaId}` : `/agentes/${e.agenteId}`}
        className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta"
      >
        <ArrowLeft className="size-4" /> {e.tarefaId ? "Tarefa" : d.agenteNome}
      </a>
      <div className="grid gap-1">
        <h1 className="text-xl font-bold tracking-tight">Execução de {d.agenteNome}</h1>
        <p className="flex flex-wrap gap-x-3 text-sm text-texto-2">
          <span>{NOME_DA_ORIGEM[e.origem] ?? e.origem}</span>
          <span>Pedida por {d.pedidoPorNome}</span>
          <span>{NOME_DA_SITUACAO[e.situacao] ?? e.situacao}</span>
          <span>{quando(e.criadaEm)}</span>
        </p>
      </div>
      <Card className="gap-2">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <CardDescricao>Custo</CardDescricao>
            <p className="font-semibold">{dolares(d.custo)}</p>
          </div>
          <div>
            <CardDescricao>Tokens</CardDescricao>
            <p className="font-semibold">
              {(d.tokens.entrada + d.tokens.saida + d.tokens.cache).toLocaleString("pt-BR")}
            </p>
          </div>
          <div>
            <CardDescricao>Duração</CardDescricao>
            <p className="font-semibold">{duracao(d.duracaoMs) || "-"}</p>
          </div>
          <div>
            <CardDescricao>Modelo</CardDescricao>
            <p className="font-semibold break-words">{e.modeloUsado?.modelo ?? "-"}</p>
          </div>
        </div>
        {e.passouAoReservaPorque && (
          <p className="text-xs text-texto-2">Passou ao modelo reserva: {e.passouAoReservaPorque}</p>
        )}
        {e.resumo && <p className="whitespace-pre-wrap break-words text-sm">{e.resumo}</p>}
      </Card>
      <Card className="gap-3">
        <CardTitulo>Passo a passo</CardTitulo>
        {!d.comDetalhes && (
          <CardDescricao>
            Você vê os passos, mas não os dados: parâmetros e resultados ficam com quem pediu, o responsável
            pelo agente e o administrador.
          </CardDescricao>
        )}
        {d.passosApagados ? (
          <p className="text-sm text-texto-2">
            Os passos ficam 90 dias. Desta execução, ficou só o resumo acima.
          </p>
        ) : d.passos.length === 0 ? (
          <p className="text-sm text-texto-2">Nenhum passo registrado.</p>
        ) : (
          <ol className="grid gap-2">
            {d.passos.map((p) => (
              <Passo key={p.id} p={p} />
            ))}
          </ol>
        )}
      </Card>
    </main>
  );
}

function LinhaDeExecucao({ e }: { e: ExecucaoNaLista }) {
  return (
    <li>
      <a
        href={`/execucoes/${e.id}`}
        className="grid gap-0.5 rounded-md border border-linha p-2 text-sm hover:bg-suave"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{e.agenteNome}</span>
          <span className={cn("text-xs", e.situacao === "falhou" ? "text-perigo" : "text-texto-2")}>
            {NOME_DA_SITUACAO[e.situacao] ?? e.situacao}
          </span>
          <span className="ml-auto text-xs text-texto-2">
            {quando(e.criadaEm)}
            {e.duracaoMs !== null ? ` · ${duracao(e.duracaoMs)}` : ""} · {dolares(e.custo)}
          </span>
        </span>
        {e.resumo && <span className="line-clamp-2 text-xs text-texto-2">{e.resumo}</span>}
      </a>
    </li>
  );
}

/**
 * Na página da tarefa: as execuções dos agentes internos e o que os externos fizeram pelo MCP. Aparece sempre que a
 * tarefa está com um agente (mesmo antes de ele começar) ou já teve execução; nas tarefas só de pessoas, não aparece.
 */
export function ExecucoesDaTarefa({ tarefaId, comAgente }: { tarefaId: string; comAgente: boolean }) {
  const [d, setD] = useState<{ execucoes: ExecucaoNaLista[]; externos: AtividadeExterna[] } | null>(null);
  useEffect(() => {
    void pedir<{ execucoes: ExecucaoNaLista[]; externos: AtividadeExterna[] }>(
      "GET",
      `/tarefas/${encodeURIComponent(tarefaId)}/execucoes`,
    ).then((r) => setD(r.ok && r.dados ? r.dados : null));
  }, [tarefaId]);
  const vazio = !d || (d.execucoes.length === 0 && d.externos.length === 0);
  if (vazio && !comAgente) return null;
  return (
    <Card className="gap-3">
      <CardTitulo>Execuções de agentes</CardTitulo>
      {vazio && (
        <p className="text-sm text-texto-2">
          Ainda não rodou. Quando o agente trabalhar nesta tarefa, o passo a passo aparece aqui.
        </p>
      )}
      {d && d.execucoes.length > 0 && (
        <ul className="grid gap-1.5">
          {d.execucoes.map((e) => (
            <LinhaDeExecucao key={e.id} e={e} />
          ))}
        </ul>
      )}
      {d?.externos.map((a) => (
        <details key={a.agenteId} className="rounded-md border border-linha p-2 text-sm">
          <summary className="cursor-pointer">
            O que {a.agenteNome} fez pelo MCP ({a.passos.length} {a.passos.length === 1 ? "passo" : "passos"})
          </summary>
          <ol className="mt-2 grid gap-2">
            {a.passos.map((p) => (
              <Passo key={p.id} p={p} />
            ))}
          </ol>
        </details>
      ))}
    </Card>
  );
}

/** Na página do agente: as execuções recentes. */
export function ExecucoesDoAgente({ agenteId }: { agenteId: string }) {
  const [lista, setLista] = useState<ExecucaoNaLista[] | null>(null);
  useEffect(() => {
    void pedir<ExecucaoNaLista[]>("GET", `/agentes/${encodeURIComponent(agenteId)}/execucoes`).then((r) =>
      setLista(r.ok && r.dados ? r.dados : []),
    );
  }, [agenteId]);
  if (!lista || lista.length === 0) return null;
  return (
    <Card className="gap-3">
      <CardTitulo>Execuções recentes</CardTitulo>
      <ul className="grid gap-1.5">
        {lista.slice(0, 20).map((e) => (
          <LinhaDeExecucao key={e.id} e={e} />
        ))}
      </ul>
    </Card>
  );
}
