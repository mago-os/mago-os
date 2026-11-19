/**
 * Central de prioridades (M3-07): o que pede atenção agora, na ordem fixa (atrasadas, vence hoje, precisa de ajuda,
 * menções, avisos de agentes), com as ações sem sair da lista. É a primeira coisa do Início no celular.
 */
import {
  type ItemDePrioridade,
  NOMES_STATUS_TAREFA,
  STATUS_TAREFA,
  type StatusTarefa,
  type TipoDePrioridade,
} from "@mago-os/contratos";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import {
  adiarPrioridade,
  comentarTarefa,
  listarPrioridades,
  mudarStatus,
  resolverPrioridade,
  trocarResponsavel,
} from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { responsavelDoValor, SeletorDeResponsavel, useAgentesAtivos, usePessoas } from "./Tarefas";

const ROTULO: Record<TipoDePrioridade, string> = {
  atrasada: "Atrasada",
  vence_hoje: "Vence hoje",
  precisa_de_ajuda: "Precisa de ajuda",
  mencao: "Menção",
  aviso_de_agente: "Aviso de agente",
  aprovacao: "Aprovação",
};

const COR: Record<TipoDePrioridade, string> = {
  atrasada: "bg-perigo/15 text-perigo",
  vence_hoje: "bg-alerta/15 text-alerta",
  precisa_de_ajuda: "bg-alerta/15 text-alerta",
  mencao: "bg-suave text-tinta",
  aviso_de_agente: "bg-suave text-tinta",
  aprovacao: "bg-suave text-tinta",
};

/** AAAA-MM-DD do dia daqui a "n" dias (no relógio do aparelho). */
function diaDaqui(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

/** A próxima segunda-feira (nunca hoje). */
function proximaSegunda(): string {
  const hoje = new Date().getDay();
  return diaDaqui((8 - hoje) % 7 || 7);
}

type Aberto = { chave: string; acao: "responder" | "status" | "passar" | "adiar" } | null;

export function CentralDePrioridades({ compacta = false }: { compacta?: boolean }) {
  const [itens, setItens] = useState<ItemDePrioridade[] | null>(null);
  const [aberto, setAberto] = useState<Aberto>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarPrioridades();
    if (r.ok && r.dados) setItens(r.dados.itens);
    else setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  // Item novo entra sem recarregar: tarefas, comentários e avisos mudam a lista.
  useTempoReal((aviso) => {
    if (aviso.tipo === "tarefa" || aviso.tipo === "aviso" || aviso.tipo === "reconectou") void carregar();
  });

  async function depois(r: { ok: boolean; mensagem?: string }, ok?: string) {
    setMensagem(r.ok ? (ok ? { tipo: "ok", texto: ok } : null) : { tipo: "erro", texto: r.mensagem ?? "" });
    if (r.ok) setAberto(null);
    await carregar();
  }

  const mostrar = compacta ? (itens ?? []).slice(0, 5) : (itens ?? []);

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitulo>Prioridades</CardTitulo>
        {compacta && (itens?.length ?? 0) > 5 && (
          <a href="/prioridades" className="text-sm text-texto-2 hover:underline">
            Ver todas ({itens?.length})
          </a>
        )}
      </div>
      {mensagem && <Aviso {...mensagem} />}
      {itens === null && <p className="text-sm text-texto-2">Carregando...</p>}
      {itens?.length === 0 && (
        <p className="text-sm text-texto-2">Nada pedindo atenção agora. Bom trabalho!</p>
      )}
      <ul className="grid gap-2" aria-label="Itens da central de prioridades">
        {mostrar.map((item) => (
          <li key={item.chave} className="grid gap-2 rounded-lg border border-linha p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <a href={item.link} className="grid min-w-0 flex-1 gap-0.5 hover:underline">
                <span className="font-medium text-pretty">{item.titulo}</span>
                <span className="text-sm text-texto-2">{item.motivo}</span>
              </a>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", COR[item.tipo])}>
                {ROTULO[item.tipo]}
              </span>
            </div>
            <Acoes
              item={item}
              aberto={aberto?.chave === item.chave ? aberto.acao : null}
              aoAbrir={(acao) => setAberto(acao ? { chave: item.chave, acao } : null)}
              aoTerminar={depois}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Acoes({
  item,
  aberto,
  aoAbrir,
  aoTerminar,
}: {
  item: ItemDePrioridade;
  aberto: "responder" | "status" | "passar" | "adiar" | null;
  aoAbrir: (a: "responder" | "status" | "passar" | "adiar" | null) => void;
  aoTerminar: (r: { ok: boolean; mensagem?: string }, ok?: string) => Promise<void>;
}) {
  const [texto, setTexto] = useState("");
  const [data, setData] = useState(diaDaqui(1));
  const tarefa = item.tarefaId;
  const alternar = (a: "responder" | "status" | "passar" | "adiar") => aoAbrir(aberto === a ? null : a);
  const adiar = (ate: string) => void adiarPrioridade(item.chave, ate).then((r) => aoTerminar(r, "Adiado."));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {tarefa && (
          <>
            <Button variant="contorno" size="pequeno" onClick={() => alternar("responder")}>
              Responder
            </Button>
            <Button variant="contorno" size="pequeno" onClick={() => alternar("status")}>
              Mudar status
            </Button>
            <Button variant="contorno" size="pequeno" onClick={() => alternar("passar")}>
              Passar
            </Button>
          </>
        )}
        <Button variant="contorno" size="pequeno" onClick={() => alternar("adiar")}>
          Adiar
        </Button>
        <Button
          variant="fantasma"
          size="pequeno"
          onClick={() => void resolverPrioridade(item.chave).then((r) => aoTerminar(r, "Resolvido."))}
        >
          Resolvido
        </Button>
      </div>
      {aberto === "responder" && tarefa && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!texto.trim()) return;
            void comentarTarefa(tarefa, texto.trim()).then((r) => {
              if (r.ok) setTexto("");
              return aoTerminar(r, "Comentário enviado.");
            });
          }}
        >
          <textarea
            aria-label="Sua resposta"
            className="min-h-20 rounded-md border border-linha bg-cartao p-2 text-base"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <Button type="submit" size="pequeno" className="justify-self-start">
            Enviar
          </Button>
        </form>
      )}
      {aberto === "status" && tarefa && (
        <select
          aria-label="Novo status"
          className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
          defaultValue=""
          onChange={(e) =>
            e.target.value &&
            void mudarStatus(tarefa, e.target.value as StatusTarefa).then((r) =>
              aoTerminar(r, "Status mudado."),
            )
          }
        >
          <option value="" disabled>
            Escolha o status
          </option>
          {STATUS_TAREFA.map((s) => (
            <option key={s} value={s}>
              {NOMES_STATUS_TAREFA[s]}
            </option>
          ))}
        </select>
      )}
      {aberto === "passar" && tarefa && <Passar tarefa={tarefa} aoTerminar={aoTerminar} />}
      {aberto === "adiar" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="contorno" size="pequeno" onClick={() => adiar(diaDaqui(1))}>
            Até amanhã
          </Button>
          <Button variant="contorno" size="pequeno" onClick={() => adiar(proximaSegunda())}>
            Até segunda
          </Button>
          <input
            type="date"
            aria-label="Adiar até"
            min={diaDaqui(1)}
            className="h-8 rounded-md border border-linha bg-cartao px-2 text-sm"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
          <Button size="pequeno" onClick={() => adiar(data)}>
            Adiar
          </Button>
        </div>
      )}
    </div>
  );
}

function Passar({
  tarefa,
  aoTerminar,
}: {
  tarefa: string;
  aoTerminar: (r: { ok: boolean; mensagem?: string }, ok?: string) => Promise<void>;
}) {
  const pessoas = usePessoas();
  const agentes = useAgentesAtivos();
  return (
    <SeletorDeResponsavel
      id={`passar-${tarefa}`}
      valor=""
      pessoas={pessoas}
      agentes={agentes}
      extras={[{ valor: "", nome: "Passar para..." }]}
      aoMudar={(v) =>
        v &&
        void trocarResponsavel(tarefa, responsavelDoValor(v)).then((r) => aoTerminar(r, "Tarefa passada."))
      }
    />
  );
}

/** A tela /prioridades. */
export function Prioridades() {
  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <CentralDePrioridades />
    </main>
  );
}
