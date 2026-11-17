/**
 * Casca do app (M1-10), no design aprovado (proposta v2): menu lateral no computador, menu embaixo no celular
 * com o mago no centro, e no topo o seletor de empresa, o tema e a pessoa.
 */
import { Download, House, LogOut, Monitor, MonitorSmartphone, Moon, Sun, UserRound } from "lucide-react";
import type * as React from "react";
import type { EmpresaMinha, Sessao } from "@/acesso";
import { cn } from "@/lib/utils";
import { NOME_DO_TEMA, PROXIMO_TEMA, type Tema } from "@/tema";
import { Mago } from "./Mago";
import { Button } from "./ui/button";

export interface ItemDoMenu {
  caminho: string;
  nome: string;
  icone: React.ComponentType<{ className?: string }>;
}

export const MENU_DA_PESSOA: ItemDoMenu[] = [
  { caminho: "/", nome: "Início", icone: House },
  { caminho: "/perfil", nome: "Meu perfil", icone: UserRound },
  { caminho: "/aparelhos", nome: "Meus aparelhos", icone: MonitorSmartphone },
];

const ICONE_DO_TEMA = { automatico: Monitor, claro: Sun, escuro: Moon } as const;

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-md bg-tinta">
        <Mago tamanho={26} cor="sobre-tinta" />
      </span>
      <span className="font-semibold tracking-tight">Mago OS</span>
    </a>
  );
}

export function BotaoDoTema({ tema, aoTrocar }: { tema: Tema; aoTrocar: (t: Tema) => void }) {
  const Icone = ICONE_DO_TEMA[tema];
  return (
    <Button
      variant="fantasma"
      size="icone"
      onClick={() => aoTrocar(PROXIMO_TEMA[tema])}
      aria-label={`Tema: ${NOME_DO_TEMA[tema]}. Trocar para ${NOME_DO_TEMA[PROXIMO_TEMA[tema]]}`}
      title={`Tema: ${NOME_DO_TEMA[tema]}`}
    >
      <Icone />
    </Button>
  );
}

interface PropsDaCasca {
  sessao: Sessao;
  empresas: EmpresaMinha[];
  caminho: string;
  menuExtra?: ItemDoMenu[];
  tema: Tema;
  aoTrocarTema: (t: Tema) => void;
  aoTrocarEmpresa: (empresaId: string) => void;
  aoSair: () => void;
  instalar: (() => void) | null;
  children: React.ReactNode;
}

export function Casca(props: PropsDaCasca) {
  const { sessao, empresas, caminho, tema } = props;
  const menu = [...MENU_DA_PESSOA, ...(props.menuExtra ?? [])];
  const ativa = empresas.find((e) => e.ativa);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      {/* Menu lateral (computador) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-linha bg-cartao p-4 md:flex">
        <Logo />
        <nav aria-label="Menu principal" className="grid gap-1">
          {menu.map((item) => {
            const Icone = item.icone;
            const aqui = item.caminho === caminho;
            return (
              <a
                key={item.caminho}
                href={item.caminho}
                aria-current={aqui ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                  aqui ? "bg-tinta text-sobre-tinta" : "text-texto-2 hover:bg-suave hover:text-tinta",
                )}
              >
                <Icone className="size-4" />
                {item.nome}
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* Topo */}
        <header className="sticky top-0 z-10 border-b border-linha bg-cartao/90 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="md:hidden">
                <Logo />
              </span>
              {empresas.length > 1 ? (
                <select
                  aria-label="Empresa"
                  className="h-9 max-w-44 truncate rounded-md border border-linha bg-cartao px-2 text-sm"
                  value={ativa?.id ?? ""}
                  onChange={(e) => props.aoTrocarEmpresa(e.target.value)}
                >
                  {!ativa && <option value="">Escolha a empresa</option>}
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              ) : (
                ativa && <span className="hidden truncate text-sm text-texto-2 sm:inline">{ativa.nome}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {props.instalar && (
                <Button
                  variant="fantasma"
                  size="pequeno"
                  onClick={props.instalar}
                  className="hidden sm:inline-flex"
                >
                  <Download />
                  Instalar app
                </Button>
              )}
              <BotaoDoTema tema={tema} aoTrocar={props.aoTrocarTema} />
              <a
                href="/perfil"
                className="grid size-8 place-items-center rounded-full bg-suave text-xs font-semibold"
                title={sessao.pessoa.nome}
                aria-label={`Meu perfil: ${sessao.pessoa.nome}`}
              >
                {iniciais(sessao.pessoa.nome)}
              </a>
              <Button variant="fantasma" size="pequeno" onClick={props.aoSair} aria-label="Sair">
                <LogOut />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1">{props.children}</div>
      </div>

      {/* Menu de baixo (celular), ao alcance do polegar, com o mago no centro */}
      <nav
        aria-label="Menu do celular"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 items-end border-t border-linha bg-cartao/95 px-2 pt-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ItemDeBaixo item={MENU_DA_PESSOA[0] as ItemDoMenu} aqui={caminho === "/"} />
        <ItemDeBaixo item={MENU_DA_PESSOA[2] as ItemDoMenu} aqui={caminho === "/aparelhos"} />
        <a href="/" aria-label="Fale com o mago" className="mx-auto -mt-5 grid">
          <span className="grid size-14 place-items-center rounded-full bg-tinta shadow-lg">
            <Mago tamanho={44} cor="sobre-tinta" />
          </span>
        </a>
        <ItemDeBaixo item={MENU_DA_PESSOA[1] as ItemDoMenu} aqui={caminho === "/perfil"} />
      </nav>
    </div>
  );
}

function ItemDeBaixo({ item, aqui }: { item: ItemDoMenu; aqui: boolean }) {
  const Icone = item.icone;
  return (
    <a
      href={item.caminho}
      aria-current={aqui ? "page" : undefined}
      className={cn(
        "grid min-h-14 place-items-center gap-0.5 py-1 text-[11px] font-medium",
        aqui ? "text-tinta" : "text-texto-2",
      )}
    >
      <Icone className="size-5" />
      {item.nome.replace("Meus ", "").replace("Meu ", "")}
    </a>
  );
}
