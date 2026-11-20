/**
 * Conversa com o mago (M4-02, decisão 5 da spec): a pessoa fala com o coordenador, que cria as tarefas e passa ao
 * especialista. Aberta pelo mago no menu de baixo do celular, pelo botão do menu lateral ou por Ctrl+J. Cada pessoa
 * vê só as conversas dela. O texto do agente aparece sempre como texto (nunca HTML). Enquanto o agente trabalha, a
 * tela pergunta a cada 2 segundos se ele já respondeu.
 */
import type { Conversa as ConversaDoContrato, MensagemDeConversa } from "@mago-os/contratos";
import { ArrowLeft, Plus, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mago } from "@/componentes/Mago";
import { Button } from "@/componentes/ui/button";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

interface Lista {
  coordenador: { id: string; nome: string; situacao: string } | null;
  conversas: ConversaDoContrato[];
}

interface Aberta {
  conversa: ConversaDoContrato;
  mensagens: MensagemDeConversa[];
  emAndamento: number;
}

const SUGESTOES = [
  "Planeja a migração do blog para o WordPress novo, com prazo sexta",
  "Cria uma tarefa para revisar o contrato do cliente até amanhã",
];

export function Conversa({ euId }: { euId: string }) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("c"),
  );
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  const carregarLista = useCallback(async () => {
    const r = await pedir<Lista>("GET", "/conversas");
    if (r.ok && r.dados) setLista(r.dados);
  }, []);
  const carregarAberta = useCallback(async (id: string) => {
    const r = await pedir<Aberta>("GET", `/conversas/${encodeURIComponent(id)}`);
    if (r.ok && r.dados) setAberta(r.dados);
    else {
      setAberta(null);
      setAbertaId(null);
    }
  }, []);

  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);
  useEffect(() => {
    if (abertaId) void carregarAberta(abertaId);
    else setAberta(null);
    const url = abertaId ? `/conversa?c=${abertaId}` : "/conversa";
    if (location.pathname + location.search !== url) history.replaceState(null, "", url);
  }, [abertaId, carregarAberta]);
  // Enquanto o agente trabalha, pergunta de novo a cada 2 segundos.
  useEffect(() => {
    if (!abertaId || !aberta || aberta.emAndamento === 0) return;
    const t = window.setTimeout(() => void carregarAberta(abertaId), 2000);
    return () => window.clearTimeout(t);
  }, [aberta, abertaId, carregarAberta]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [aberta?.mensagens.length, aberta?.emAndamento]);

  async function enviar(conteudo: string) {
    const limpo = conteudo.trim();
    if (!limpo || enviando) return;
    setEnviando(true);
    setErro(null);
    const r = await pedir<{ conversa: ConversaDoContrato }>("POST", "/conversas/mensagens", {
      ...(abertaId ? { conversaId: abertaId } : {}),
      texto: limpo,
    });
    setEnviando(false);
    if (!r.ok || !r.dados) return setErro(r.mensagem ?? "Não foi possível enviar.");
    setTexto("");
    if (r.dados.conversa.id !== abertaId) setAbertaId(r.dados.conversa.id);
    else void carregarAberta(r.dados.conversa.id);
    void carregarLista();
  }

  async function apagar(id: string) {
    if (!window.confirm("Apagar esta conversa? As tarefas criadas continuam.")) return;
    await pedir("DELETE", `/conversas/${encodeURIComponent(id)}`);
    if (abertaId === id) setAbertaId(null);
    void carregarLista();
  }

  const coordenador = lista?.coordenador;
  const pensando = (aberta?.emAndamento ?? 0) > 0;
  const nome = coordenador?.nome ?? "Coordenador";

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-5 md:grid-cols-[240px_1fr] md:py-8">
      <aside className={cn("grid content-start gap-2", abertaId && "hidden md:grid")}>
        <Button onClick={() => setAbertaId(null)} variant="contorno">
          <Plus /> Conversa nova
        </Button>
        {lista?.conversas.length === 0 && <p className="text-sm text-texto-2">Nenhuma conversa ainda.</p>}
        <ul className="grid gap-1">
          {lista?.conversas.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => setAbertaId(c.id)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left text-sm",
                  c.id === abertaId ? "bg-tinta text-sobre-tinta" : "hover:bg-suave",
                )}
              >
                {c.titulo}
              </button>
              <button
                type="button"
                onClick={() => void apagar(c.id)}
                aria-label={`Apagar a conversa ${c.titulo}`}
                className="rounded p-1.5 text-texto-2 opacity-60 hover:text-perigo group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="grid min-h-[60dvh] min-w-0 grid-rows-[auto_1fr_auto] gap-3">
        <div className="flex items-center gap-2">
          {abertaId && (
            <button
              type="button"
              onClick={() => setAbertaId(null)}
              className="md:hidden"
              aria-label="Voltar às conversas"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <Mago tamanho={32} estado={pensando ? "pensando" : enviando ? "ouvindo" : "parado"} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {aberta?.conversa.titulo ?? `Fale com o ${nome}`}
            </h1>
            <p className="text-xs text-texto-2">
              {pensando ? `${nome} está trabalhando...` : "Peça uma tarefa, um plano ou um acompanhamento."}
            </p>
          </div>
        </div>

        <div className="grid min-h-0 content-start gap-3 overflow-y-auto">
          {coordenador && coordenador.situacao !== "ativo" && (
            <Aviso
              tipo="erro"
              texto={`${nome} ainda está pausado. O administrador escolhe o modelo de IA e liga em Agentes.`}
            />
          )}
          {!aberta && (
            <div className="grid gap-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTexto(s)}
                  className="rounded-lg border border-linha p-3 text-left text-sm hover:bg-suave"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {aberta?.mensagens.map((m) => (
            <BolhaDaMensagem
              key={m.id}
              mensagem={m}
              minha={m.autor.tipo === "pessoa" && m.autor.pessoaId === euId}
            />
          ))}
          {pensando && <p className="text-sm text-texto-2">...</p>}
          <div ref={fim} />
        </div>

        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(texto);
          }}
        >
          {erro && <Aviso tipo="erro" texto={erro} />}
          <div className="flex items-end gap-2">
            <label htmlFor="mensagem" className="sr-only">
              Mensagem para o {nome}
            </label>
            <textarea
              id="mensagem"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar(texto);
                }
              }}
              maxLength={4000}
              rows={2}
              placeholder={`Escreva para o ${nome}`}
              className="min-h-11 min-w-0 flex-1 resize-none rounded-md border border-linha bg-cartao px-3 py-2 text-base"
            />
            <Button type="submit" disabled={enviando || pensando || !texto.trim()} aria-label="Enviar">
              <Send />
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}

function BolhaDaMensagem({ mensagem, minha }: { mensagem: MensagemDeConversa; minha: boolean }) {
  const sistema = mensagem.autor.tipo === "sistema";
  return (
    <div className={cn("grid max-w-[85%] gap-1", minha ? "justify-self-end" : "justify-self-start")}>
      <div
        className={cn(
          "whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
          minha ? "bg-tinta text-sobre-tinta" : sistema ? "border border-alerta/40 bg-suave" : "bg-suave",
        )}
      >
        {/* Texto puro: o React não interpreta HTML vindo do agente. */}
        {mensagem.texto}
      </div>
      {mensagem.tarefas.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {mensagem.tarefas.map((id, i) => (
            <a key={id} href={`/tarefas/${id}`} className="underline">
              {mensagem.tarefas.length > 1 ? `Abrir tarefa ${i + 1}` : "Abrir a tarefa"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
