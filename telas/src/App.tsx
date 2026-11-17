import { useCallback, useEffect, useState } from "react";
import {
  type AvisoDeAcesso,
  type EmpresaMinha,
  lerSessao,
  listarAvisos,
  listarEmpresas,
  type Sessao,
  sair,
  trocarEmpresa,
} from "./acesso";
import { BotaoDoTema, Casca, Logo } from "./componentes/Casca";
import { EstadoDoSistema } from "./componentes/EstadoDoSistema";
import { Mago } from "./componentes/Mago";
import { Button } from "./componentes/ui/button";
import { Card } from "./componentes/ui/card";
import { Entrar, RecuperarSenha, RedefinirSenha } from "./telas/Acesso";
import { AvisosDeAcesso, MeusAparelhos } from "./telas/Aparelhos";
import { AtivarDoisFatores, ConfirmarSegundoFator } from "./telas/DoisFatores";
import { MeuPerfil } from "./telas/Perfil";
import { aplicarTema, lerTema, type Tema } from "./tema";

/** Telas de acesso, abertas sem login (sem biblioteca de rotas por enquanto: o endereço escolhe a tela). */
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

/** Topo simples das telas sem a casca (entrar, 2FA). */
function TopoSimples({
  tema,
  aoTrocarTema,
  aoSair,
}: {
  tema: Tema;
  aoTrocarTema: (t: Tema) => void;
  aoSair?: () => void;
}) {
  return (
    <header className="border-b border-linha bg-cartao/90 pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Logo />
        <div className="flex items-center gap-1">
          <BotaoDoTema tema={tema} aoTrocar={aoTrocarTema} />
          {aoSair && (
            <Button variant="fantasma" size="pequeno" onClick={aoSair}>
              Sair
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export function App() {
  const [tema, setTema] = useState<Tema>(lerTema);
  const instalar = useInstalacao();
  const caminho = window.location.pathname;
  const [sessao, setSessao] = useState<Sessao | null | undefined>(undefined);
  const [empresas, setEmpresas] = useState<EmpresaMinha[]>([]);
  const [avisos, setAvisos] = useState<AvisoDeAcesso[]>([]);

  useEffect(() => aplicarTema(tema), [tema]);

  const conferirSessao = useCallback(async () => setSessao(await lerSessao()), []);
  useEffect(() => {
    void conferirSessao();
  }, [conferirSessao]);

  const completa = sessao?.falta === "nada";
  const carregarEmpresas = useCallback(async () => setEmpresas((await listarEmpresas()) ?? []), []);
  const carregarAvisos = useCallback(async () => setAvisos((await listarAvisos()) ?? []), []);
  useEffect(() => {
    if (!completa) return;
    void carregarEmpresas();
    void carregarAvisos();
  }, [completa, carregarEmpresas, carregarAvisos]);

  // A cada minuto, confere se a sessão ainda vale: um aparelho desconectado em outro lugar sai na hora.
  useEffect(() => {
    if (!sessao) return;
    const intervalo = setInterval(async () => {
      if ((await lerSessao()) === null) window.location.assign("/entrar");
    }, 60_000);
    return () => clearInterval(intervalo);
  }, [sessao]);

  async function aoSair() {
    await sair();
    window.location.assign("/entrar");
  }

  async function aoTrocarEmpresa(empresaId: string) {
    const r = await trocarEmpresa(empresaId);
    if (r.ok) window.location.reload();
  }

  // Telas de acesso: abertas sem login, sem a casca.
  if (TELAS_DE_ACESSO.includes(caminho)) {
    return (
      <div className="min-h-dvh">
        <TopoSimples tema={tema} aoTrocarTema={setTema} />
        {caminho === "/entrar" && <Entrar aoEntrar={() => window.location.assign("/")} />}
        {caminho === "/recuperar-senha" && <RecuperarSenha />}
        {caminho === "/redefinir-senha" && <RedefinirSenha />}
      </div>
    );
  }

  if (sessao === undefined) return <div className="min-h-dvh" aria-busy="true" />;
  // Sem login, nada aparece: vai para a tela de entrar.
  if (sessao === null) {
    window.location.replace("/entrar");
    return null;
  }

  if (sessao.falta !== "nada") {
    return (
      <div className="min-h-dvh">
        <TopoSimples tema={tema} aoTrocarTema={setTema} aoSair={() => void aoSair()} />
        {sessao.falta === "ativar" ? (
          <AtivarDoisFatores
            obrigatorio={sessao.doisFatores.obrigatorio}
            soPasskey={sessao.doisFatores.exigePasskey}
            aoConcluir={() => void conferirSessao()}
          />
        ) : (
          <ConfirmarSegundoFator
            soPasskey={sessao.doisFatores.exigePasskey}
            aoConfirmar={() => void conferirSessao()}
          />
        )}
      </div>
    );
  }

  let conteudo: React.ReactNode;
  if (caminho === "/perfil") conteudo = <MeuPerfil />;
  else if (caminho === "/aparelhos") conteudo = <MeusAparelhos />;
  else conteudo = <Inicio sessao={sessao} empresa={empresas.find((e) => e.ativa)?.nome ?? null} />;

  return (
    <Casca
      sessao={sessao}
      empresas={empresas}
      caminho={caminho}
      tema={tema}
      aoTrocarTema={setTema}
      aoTrocarEmpresa={(id) => void aoTrocarEmpresa(id)}
      aoSair={() => void aoSair()}
      instalar={instalar ? () => void instalar.prompt() : null}
    >
      <AvisosDeAcesso avisos={avisos} aoResponder={() => void carregarAvisos()} />
      {conteudo}
    </Casca>
  );
}

function Inicio({ sessao, empresa }: { sessao: Sessao; empresa: string | null }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-4 px-4 py-5 md:grid-cols-[1.4fr_1fr] md:gap-5 md:py-8">
      <Card className="items-center gap-2 overflow-hidden text-center md:flex-row md:items-center md:text-left">
        <div className="grid gap-2 md:flex-1">
          <p className="text-xs font-semibold tracking-[0.08em] text-texto-2 uppercase">
            {empresa ?? "Meu dia"}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-balance md:text-3xl">
            {saudacao()}, {sessao.pessoa.nome.split(" ")[0]}!
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
