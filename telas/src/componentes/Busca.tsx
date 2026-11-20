/**
 * Busca Ctrl+K (M3-09): Ctrl+K (Cmd+K no Mac) ou a lupa abrem a caixa. Resultados agrupados por tipo, comandos rápidos
 * na mesma caixa, e tudo dá para fazer só com o teclado (setas, Enter, Esc).
 */
import type { ResultadoDaBusca, TipoDeResultado } from "@mago-os/contratos";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";

const GRUPOS: Record<TipoDeResultado, string> = {
  tarefa: "Tarefas",
  comentario: "Comentários",
  projeto: "Projetos",
  espaco: "Espaços",
  pessoa: "Pessoas",
  agente: "Agentes",
};

interface Comando {
  nome: string;
  link: string;
}

/** Comandos rápidos (só os que a pessoa pode usar aparecem). */
function comandos(podeAgentes: boolean): Comando[] {
  return [
    { nome: "Nova tarefa", link: "/tarefas?nova=1" },
    { nome: "Novo projeto", link: "/projetos?novo=1" },
    { nome: "Minhas tarefas", link: "/tarefas" },
    { nome: "Abrir central de prioridades", link: "/prioridades" },
    ...(podeAgentes ? [{ nome: "Abrir agentes", link: "/agentes" }] : []),
  ];
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Item = { tipo: "comando"; c: Comando } | { tipo: "resultado"; r: ResultadoDaBusca };

export function Busca({ podeAgentes }: { podeAgentes: boolean }) {
  const [aberta, setAberta] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ResultadoDaBusca[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [escolhido, setEscolhido] = useState(0);
  const caixa = useRef<HTMLInputElement>(null);
  const ultimo = useRef(0);

  // Ctrl+K / Cmd+K abre (e fecha) de qualquer tela.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAberta((a) => !a);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  useEffect(() => {
    if (aberta) {
      setTexto("");
      setResultados([]);
      setEscolhido(0);
      setTimeout(() => caixa.current?.focus(), 0);
    }
  }, [aberta]);

  // Busca depois de uma pausa na digitação; resposta atrasada de um texto antigo não sobrescreve a nova.
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setResultados([]);
      return;
    }
    const numero = ++ultimo.current;
    const espera = setTimeout(async () => {
      setBuscando(true);
      const r = await pedir<{ resultados: ResultadoDaBusca[] }>(
        "GET",
        `/busca?texto=${encodeURIComponent(q)}`,
      );
      if (numero !== ultimo.current) return;
      setBuscando(false);
      setResultados(r.ok && r.dados ? r.dados.resultados : []);
      setEscolhido(0);
    }, 200);
    return () => clearTimeout(espera);
  }, [texto]);

  const q = semAcento(texto.trim());
  const cmds = comandos(podeAgentes).filter((c) => q === "" || semAcento(c.nome).includes(q));
  const itens: Item[] = [
    ...resultados.map((r) => ({ tipo: "resultado" as const, r })),
    ...cmds.map((c) => ({ tipo: "comando" as const, c })),
  ];

  function ir(item: Item | undefined) {
    if (!item) return;
    setAberta(false);
    window.location.assign(item.tipo === "comando" ? item.c.link : item.r.link);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "Escape") setAberta(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setEscolhido((i) => Math.min(i + 1, itens.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setEscolhido((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      ir(itens[escolhido]);
    }
  }

  // Cabeçalho de grupo antes do primeiro item de cada tipo.
  let grupoAnterior: string | null = null;

  return (
    <>
      <button
        type="button"
        aria-label="Buscar (Ctrl+K)"
        onClick={() => setAberta(true)}
        className="grid size-9 place-items-center rounded-full hover:bg-suave"
      >
        <Search className="size-5" />
      </button>
      {aberta && (
        <div className="fixed inset-0 z-50 grid items-start justify-items-center px-4 pt-[10vh]">
          {/* Clicar fora fecha. */}
          <button
            type="button"
            aria-label="Fechar a busca"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-black/40"
            onClick={() => setAberta(false)}
          />
          <div
            role="dialog"
            aria-label="Buscar"
            className="relative grid w-full max-w-xl gap-1 overflow-hidden rounded-xl border border-linha bg-cartao shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-linha px-3">
              <Search className="size-5 shrink-0 text-texto-2" />
              <input
                ref={caixa}
                role="combobox"
                aria-expanded={itens.length > 0}
                aria-controls="busca-resultados"
                aria-activedescendant={itens.length > 0 ? `busca-item-${escolhido}` : undefined}
                aria-label="O que você procura?"
                placeholder="Buscar tarefas, projetos, pessoas... ou um comando"
                className="h-12 w-full bg-transparent text-base outline-none"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={aoTeclar}
              />
              <kbd className="hidden rounded border border-linha px-1.5 text-xs text-texto-2 sm:inline">
                Esc
              </kbd>
            </div>
            <div
              id="busca-resultados"
              role="listbox"
              aria-label="Resultados"
              className="max-h-[60vh] overflow-y-auto p-1"
            >
              {itens.map((item, i) => {
                const grupo = item.tipo === "comando" ? "Comandos" : GRUPOS[item.r.tipo];
                const cabecalho = grupo !== grupoAnterior;
                grupoAnterior = grupo;
                return (
                  <div
                    key={item.tipo === "comando" ? item.c.link : `${item.r.tipo}:${item.r.id}`}
                    role="presentation"
                  >
                    {cabecalho && (
                      <p className="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-texto-2 uppercase">
                        {grupo}
                      </p>
                    )}
                    <div
                      id={`busca-item-${i}`}
                      role="option"
                      aria-selected={i === escolhido}
                      tabIndex={-1}
                      onMouseEnter={() => setEscolhido(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => ir(item)}
                      onKeyDown={aoTeclar}
                      className={cn(
                        "grid cursor-pointer gap-0.5 rounded-md px-2 py-2 text-sm",
                        i === escolhido && "bg-suave",
                      )}
                    >
                      <span className="truncate font-medium">
                        {item.tipo === "comando" ? item.c.nome : item.r.titulo}
                      </span>
                      {item.tipo === "resultado" && item.r.trecho && (
                        <span className="truncate text-xs text-texto-2">{item.r.trecho}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {texto.trim().length >= 2 && !buscando && resultados.length === 0 && (
              <p className="px-3 pb-3 text-sm text-texto-2">Nada encontrado com "{texto.trim()}".</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
