import { Download, LogIn, LogOut, Monitor, MonitorSmartphone, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type AvisoDeAcesso, lerSessao, listarAvisos, type Sessao, sair } from "./acesso";
import { EstadoDoSistema } from "./componentes/EstadoDoSistema";
import { Mago } from "./componentes/Mago";
import { Button } from "./componentes/ui/button";
import { Card } from "./componentes/ui/card";
import { Entrar, RecuperarSenha, RedefinirSenha } from "./telas/Acesso";
import { AvisosDeAcesso, MeusAparelhos } from "./telas/Aparelhos";
import { AtivarDoisFatores, ConfirmarSegundoFator } from "./telas/DoisFatores";
import { aplicarTema, lerTema, NOME_DO_TEMA, PROXIMO_TEMA, type Tema } from "./tema";

/** Telas de acesso, escolhidas pelo endereço (sem biblioteca de rotas por enquanto). */
const TELAS_DE_ACESSO = ["/entrar", "/recuperar-senha", "/redefinir-senha"];

function saudacao(hora = new Date().getHours()): string {
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** Evento do navegador que permite instalar o app (Chrome e Android). */
interface PedidoDeInstalacao extends Event {
  prompt(): Promise<void>;
}

function useInstalacao() {
  const [pedido, setPedido] = useState<PedidoDeInstalacao | null>(null);
  useEffect(() => {
    const guardar = (e: Event) => {
      e.preventDefault();
      setPedido(e as PedidoDeInstalacao);
    };
    const instalado = () => setPedido(null);
    window.addEventListener("beforeinstallprompt", guardar);
    window.addEventListener("appinstalled", instalado);
    return () => {
      window.removeEventListener("beforeinstallprompt", guardar);
      window.removeEventListener("appinstalled", instalado);
    };
  }, []);
  return pedido;
}

const ICONE_DO_TEMA = { automatico: Monitor, claro: Sun, escuro: Moon } as const;

export function App() {
  const [tema, setTema] = useState<Tema>(lerTema);
  const instalar = useInstalacao();
  const IconeDoTema = ICONE_DO_TEMA[tema];
  const caminho = window.location.pathname;
  const [sessao, setSessao] = useState<Sessao | null | undefined>(undefined);

  useEffect(() => aplicarTema(tema), [tema]);

  const conferirSessao = useCallback(async () => setSessao(await lerSessao()), []);
  useEffect(() => {
    void conferirSessao();
  }, [conferirSessao]);

  // A cada minuto, confere se a sessão ainda vale: um aparelho desconectado em outro lugar sai na hora.
  useEffect(() => {
    if (!sessao) return;
    const intervalo = setInterval(async () => {
      const agora = await lerSessao();
      if (agora === null) window.location.assign("/entrar");
    }, 60_000);
    return () => clearInterval(intervalo);
  }, [sessao]);

  // Avisos de acesso por aparelho novo, para quem já está com a sessão completa.
  const [avisos, setAvisos] = useState<AvisoDeAcesso[]>([]);
  const carregarAvisos = useCallback(async () => setAvisos((await listarAvisos()) ?? []), []);
  useEffect(() => {
    if (sessao?.falta === "nada") void carregarAvisos();
  }, [sessao, carregarAvisos]);

  async function aoSair() {
    await sair();
    setSessao(null);
  }

  let conteudo: React.ReactNode;
  if (caminho === "/entrar") conteudo = <Entrar aoEntrar={() => window.location.assign("/")} />;
  else if (caminho === "/recuperar-senha") conteudo = <RecuperarSenha />;
  else if (caminho === "/redefinir-senha") conteudo = <RedefinirSenha />;
  else if (caminho === "/aparelhos" && sessao?.falta === "nada") conteudo = <MeusAparelhos />;
  else if (sessao?.falta === "ativar")
    conteudo = (
      <AtivarDoisFatores
        obrigatorio={sessao.doisFatores.obrigatorio}
        soPasskey={sessao.doisFatores.exigePasskey}
        aoConcluir={() => void conferirSessao()}
      />
    );
  else if (sessao?.falta === "confirmar")
    conteudo = (
      <ConfirmarSegundoFator
        soPasskey={sessao.doisFatores.exigePasskey}
        aoConfirmar={() => void conferirSessao()}
      />
    );
  else conteudo = <Inicio sessao={sessao ?? null} />;

  return (
    <div className="min-h-dvh pb-[env(safe-area-inset-bottom)]">
      <header className="sticky top-0 z-10 border-b border-linha bg-cartao/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-md bg-tinta">
              <Mago tamanho={26} cor="sobre-tinta" />
            </span>
            <span className="font-semibold tracking-tight">Mago OS</span>
          </div>
          <div className="flex items-center gap-1">
            {sessao?.falta === "nada" && (
              <Button variant="fantasma" size="icone" asChild>
                <a href="/aparelhos" aria-label="Meus aparelhos" title="Meus aparelhos">
                  <MonitorSmartphone />
                </a>
              </Button>
            )}
            {sessao && (
              <>
                <span className="hidden max-w-40 truncate px-2 text-sm text-texto-2 sm:inline">
                  {sessao.pessoa.nome}
                </span>
                <Button variant="fantasma" size="pequeno" onClick={() => void aoSair()}>
                  <LogOut />
                  Sair
                </Button>
              </>
            )}
            {sessao === null && !TELAS_DE_ACESSO.includes(caminho) && (
              <Button variant="fantasma" size="pequeno" asChild>
                <a href="/entrar">
                  <LogIn />
                  Entrar
                </a>
              </Button>
            )}
            {instalar && (
              <Button variant="fantasma" size="pequeno" onClick={() => void instalar.prompt()}>
                <Download />
                Instalar app
              </Button>
            )}
            <Button
              variant="fantasma"
              size="icone"
              onClick={() => setTema(PROXIMO_TEMA[tema])}
              aria-label={`Tema: ${NOME_DO_TEMA[tema]}. Trocar para ${NOME_DO_TEMA[PROXIMO_TEMA[tema]]}`}
              title={`Tema: ${NOME_DO_TEMA[tema]}`}
            >
              <IconeDoTema />
            </Button>
          </div>
        </div>
      </header>

      {sessao?.falta === "nada" && (
        <AvisosDeAcesso avisos={avisos} aoResponder={() => void carregarAvisos()} />
      )}
      {conteudo}
    </div>
  );
}

function Inicio({ sessao }: { sessao: Sessao | null }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-4 px-4 py-5 md:grid-cols-[1.4fr_1fr] md:gap-5 md:py-8">
      <Card className="items-center gap-2 overflow-hidden text-center md:flex-row md:items-center md:text-left">
        <div className="grid gap-2 md:flex-1">
          <p className="text-xs font-semibold tracking-[0.08em] text-texto-2 uppercase">Primeira versão</p>
          <h1 className="text-2xl font-bold tracking-tight text-balance md:text-3xl">
            {saudacao()}
            {sessao ? `, ${sessao.pessoa.nome.split(" ")[0]}` : ""}!
          </h1>
          <p className="text-texto-2 text-pretty">
            O Mago OS está sendo construído. Aqui pessoas e agentes de IA vão trabalhar juntos em tarefas,
            projetos e rotinas.
          </p>
        </div>
        <Mago tamanho={190} estado="parado" rotulo="Rosto animado do mago" className="shrink-0" />
      </Card>
      <EstadoDoSistema />
    </main>
  );
}
