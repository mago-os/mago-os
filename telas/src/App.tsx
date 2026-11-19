import { Bot, Building2, ScrollText, Shield, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type AvisoDeAcesso,
  destinoDepoisDeEntrar,
  type EmpresaMinha,
  lerPerfil,
  lerSessao,
  listarAvisos,
  listarEmpresas,
  listarPessoas,
  type MinhasPermissoes,
  minhasPermissoes,
  type Sessao,
  sair,
  trocarEmpresa,
} from "./acesso";
import { BotaoDoTema, Casca, type ItemDoMenu, Logo } from "./componentes/Casca";
import { EstadoDoSistema } from "./componentes/EstadoDoSistema";
import { Mago } from "./componentes/Mago";
import { Button } from "./componentes/ui/button";
import { Card } from "./componentes/ui/card";
import { Entrar, RecuperarSenha, RedefinirSenha } from "./telas/Acesso";
import { Auditoria, Pessoas, Seguranca } from "./telas/Administrador";
import { Agentes, PaginaDoAgente } from "./telas/Agentes";
import { AvisosDeAcesso, MeusAparelhos } from "./telas/Aparelhos";
import { AvisosDoMago } from "./telas/Avisos";
import { AceitarConvite } from "./telas/Convite";
import { AtivarDoisFatores, ConfirmarSegundoFator } from "./telas/DoisFatores";
import { Empresas } from "./telas/Empresas";
import { NovaConta } from "./telas/NovaConta";
import { MeuPerfil } from "./telas/Perfil";
import { PaginaDoProjeto, Projetos } from "./telas/Projetos";
import { PaginaDaTarefa, Tarefas } from "./telas/Tarefas";
import { aplicarTema, lerTema, type Tema } from "./tema";

/** Telas de acesso, abertas sem login (sem biblioteca de rotas por enquanto: o endereço escolhe a tela). */
const TELAS_DE_ACESSO = ["/entrar", "/recuperar-senha", "/redefinir-senha", "/convite", "/nova-conta"];

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
  const [permissoes, setPermissoes] = useState<MinhasPermissoes | null>(null);
  const [dono, setDono] = useState(false);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());

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
    void lerPerfil().then((p) => setDono(p?.donoDaPlataforma ?? false));
  }, [completa, carregarEmpresas, carregarAvisos]);

  // Permissões na empresa ativa (só existe com uma empresa escolhida; sem empresa, não há o que pedir à API).
  const temEmpresaAtiva = empresas.some((e) => e.ativa);
  useEffect(() => {
    if (temEmpresaAtiva) void minhasPermissoes().then(setPermissoes);
  }, [temEmpresaAtiva]);

  // Nomes das pessoas da empresa, para a auditoria mostrar quem fez.
  useEffect(() => {
    if (caminho !== "/auditoria" || !completa || !temEmpresaAtiva) return;
    void listarPessoas().then((l) => setNomes(new Map((l ?? []).map((p) => [p.id, p.nome]))));
  }, [caminho, completa, temEmpresaAtiva]);

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
        {caminho === "/entrar" && <Entrar aoEntrar={() => window.location.assign(destinoDepoisDeEntrar())} />}
        {caminho === "/convite" && <AceitarConvite />}
        {caminho === "/nova-conta" && <NovaConta />}
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

  // Telas do administrador: aparecem só para quem tem a permissão (a API confere de novo).
  const pode = (modulo: string, acao: "ver" | "criar" | "editar" | "aprovar" | "excluir") =>
    (permissoes?.modulos[modulo]?.acoes[acao] ?? "nada") !== "nada";
  const menuExtra: ItemDoMenu[] = [
    ...(pode("pessoas", "ver") && permissoes?.perfil !== "funcionario"
      ? [{ caminho: "/pessoas", nome: "Pessoas", icone: Users }]
      : []),
    ...(pode("agentes", "ver") ? [{ caminho: "/agentes", nome: "Agentes", icone: Bot }] : []),
    ...(pode("seguranca", "ver") || dono
      ? [{ caminho: "/seguranca", nome: "Segurança", icone: Shield }]
      : []),
    ...(pode("auditoria", "ver") ? [{ caminho: "/auditoria", nome: "Auditoria", icone: ScrollText }] : []),
    ...(dono ? [{ caminho: "/empresas", nome: "Empresas", icone: Building2 }] : []),
  ];

  let conteudo: React.ReactNode;
  const tarefaAberta = /^\/tarefas\/([0-9a-f-]{36})$/i.exec(caminho)?.[1];
  const agenteAberto = /^\/agentes\/([0-9a-f-]{36})$/i.exec(caminho)?.[1];
  const projetoAberto = /^\/projetos\/([0-9a-f-]{36})$/i.exec(caminho)?.[1];
  if (caminho === "/perfil") conteudo = <MeuPerfil />;
  else if (caminho === "/agentes" && pode("agentes", "ver"))
    conteudo = <Agentes podeCadastrar={pode("agentes", "criar")} euId={sessao.pessoa.id} />;
  else if (agenteAberto && pode("agentes", "ver"))
    conteudo = (
      <PaginaDoAgente
        id={agenteAberto}
        podeEditar={pode("agentes", "editar")}
        podeDesligar={pode("agentes", "excluir")}
        euId={sessao.pessoa.id}
      />
    );
  else if (caminho === "/tarefas" && temEmpresaAtiva)
    conteudo = <Tarefas podeCriar={pode("tarefas", "criar")} euId={sessao.pessoa.id} />;
  else if (tarefaAberta && temEmpresaAtiva)
    conteudo = (
      <PaginaDaTarefa
        id={tarefaAberta}
        euId={sessao.pessoa.id}
        podeEditar={pode("tarefas", "editar")}
        podeDestravar={pode("tarefas", "aprovar")}
        podeExcluir={pode("tarefas", "excluir")}
      />
    );
  else if (caminho === "/projetos" && temEmpresaAtiva && pode("projetos", "ver"))
    conteudo = (
      <Projetos
        podeCriarEspaco={pode("espacos", "criar")}
        podeEditarEspaco={pode("espacos", "editar")}
        podeCriarProjeto={pode("projetos", "criar")}
        euId={sessao.pessoa.id}
      />
    );
  else if (projetoAberto && temEmpresaAtiva && pode("projetos", "ver"))
    conteudo = (
      <PaginaDoProjeto
        id={projetoAberto}
        euId={sessao.pessoa.id}
        administra={permissoes?.modulos.projetos?.acoes.editar === "tudo"}
        podeCriarTarefa={pode("tarefas", "criar")}
        podeExcluir={pode("projetos", "excluir")}
      />
    );
  else if (caminho === "/pessoas" && menuExtra.some((m) => m.caminho === "/pessoas"))
    conteudo = (
      <Pessoas
        podeAjustar={pode("permissoes", "editar")}
        podeConvidar={pode("pessoas", "criar")}
        podeDesligar={pode("pessoas", "excluir")}
        euId={sessao.pessoa.id}
      />
    );
  else if (caminho === "/seguranca" && menuExtra.some((m) => m.caminho === "/seguranca"))
    conteudo = <Seguranca podeEditar={pode("seguranca", "editar")} donoDaPlataforma={dono} />;
  else if (caminho === "/auditoria" && menuExtra.some((m) => m.caminho === "/auditoria"))
    conteudo = <Auditoria nomes={nomes} />;
  else if (caminho === "/empresas" && dono) conteudo = <Empresas />;
  else if (caminho === "/aparelhos") conteudo = <MeusAparelhos />;
  else conteudo = <Inicio sessao={sessao} empresa={empresas.find((e) => e.ativa)?.nome ?? null} />;

  return (
    <Casca
      sessao={sessao}
      empresas={empresas}
      caminho={caminho}
      menuExtra={menuExtra}
      tema={tema}
      aoTrocarTema={setTema}
      aoTrocarEmpresa={(id) => void aoTrocarEmpresa(id)}
      aoSair={() => void aoSair()}
      instalar={instalar ? () => void instalar.prompt() : null}
    >
      <AvisosDeAcesso avisos={avisos} aoResponder={() => void carregarAvisos()} />
      {temEmpresaAtiva && <AvisosDoMago />}
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
