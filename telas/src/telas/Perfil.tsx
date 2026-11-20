/**
 * Meu perfil (M1-10): dados, senha e o 2FA completo (passkeys, app autenticador e códigos de recuperação).
 * Ações perigosas pedem o segundo fator de novo depois de 10 minutos: a tela pede a confirmação e tenta de novo.
 */
import { Fingerprint, KeyRound, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  apagarPasskey,
  cadastrarPasskey,
  gerarCodigosNovos,
  lerPerfil,
  listarPasskeys,
  type PasskeyCadastrada,
  type Perfil,
  type Resultado,
  salvarPerfil,
  trocarSenha,
} from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { Aviso } from "./Acesso";
import { AtivarDoisFatores, ConfirmarSegundoFator } from "./DoisFatores";
import { Notificacoes } from "./Notificacoes";
import { usePasskeyPronta } from "./usePasskey";

export const IDIOMAS = [
  ["pt-BR", "Português (Brasil)"],
  ["pt-PT", "Português (Portugal)"],
  ["en", "English"],
  ["es", "Español"],
] as const;

export const FUSOS = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Fortaleza",
  "America/Recife",
  "America/Cuiaba",
  "America/Rio_Branco",
  "Europe/Lisbon",
  "UTC",
];

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

function nomeDoAparelho(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Aparelho";
}

export function MeuPerfil() {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyCadastrada[]>([]);
  const [confirmar, setConfirmar] = useState<null | (() => Promise<void>)>(null);
  const [ativandoApp, setAtivandoApp] = useState(false);

  const carregar = useCallback(async () => {
    setPerfil(await lerPerfil());
    setPasskeys((await listarPasskeys()) ?? []);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  /** Roda a ação; se ela pedir o segundo fator de novo, mostra a confirmação e tenta outra vez. */
  async function comConfirmacao(acao: () => Promise<Resultado>, depois: (r: Resultado) => void) {
    const r = await acao();
    if (!r.ok && r.codigo === "CONFIRMACAO_NECESSARIA") {
      setConfirmar(() => async () => {
        setConfirmar(null);
        depois(await acao());
      });
      return;
    }
    depois(r);
  }

  if (confirmar) {
    return (
      <ConfirmarSegundoFator
        soPasskey={perfil?.doisFatores.exigePasskey ?? false}
        aoConfirmar={() => void confirmar()}
      />
    );
  }
  if (ativandoApp) {
    return (
      <AtivarDoisFatores
        obrigatorio={false}
        apenasApp
        aoConcluir={() => {
          setAtivandoApp(false);
          void carregar();
        }}
      />
    );
  }
  if (!perfil) return <main className="px-4 py-8 text-sm text-texto-2">Carregando...</main>;

  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Meu perfil</h1>
        {/* No celular, Meus aparelhos saiu do menu de baixo para dar lugar a Projetos (M3-01). */}
        <a href="/aparelhos" className="text-sm text-texto-2 underline underline-offset-2 hover:text-tinta">
          Meus aparelhos
        </a>
      </div>
      <Dados perfil={perfil} aoSalvar={carregar} />
      {perfil.temSenha && <Senha comConfirmacao={comConfirmacao} />}
      <Seguranca
        perfil={perfil}
        passkeys={passkeys}
        comConfirmacao={comConfirmacao}
        aoMudar={carregar}
        aoAtivarApp={() => setAtivandoApp(true)}
      />
      <Notificacoes />
    </main>
  );
}

function Dados({ perfil, aoSalvar }: { perfil: Perfil; aoSalvar: () => void }) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const d = new FormData(evento.currentTarget);
    const r = await salvarPerfil({
      nome: String(d.get("nome")),
      idioma: String(d.get("idioma")),
      fusoHorario: String(d.get("fuso")),
    });
    setMensagem(r.ok ? { tipo: "ok", texto: "Dados salvos." } : { tipo: "erro", texto: r.mensagem ?? "" });
    if (r.ok) aoSalvar();
  }

  return (
    <Card className="gap-4">
      <div className="grid gap-1">
        <CardTitulo>Dados</CardTitulo>
        <CardDescricao>{perfil.email}</CardDescricao>
      </div>
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="nome" name="nome" rotulo="Nome" defaultValue={perfil.nome} required maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Selecao
            id="idioma"
            rotulo="Idioma"
            valor={perfil.idioma}
            opcoes={IDIOMAS.map(([v, n]) => [v, n])}
          />
          <Selecao
            id="fuso"
            rotulo="Fuso horário"
            valor={perfil.fusoHorario}
            opcoes={[...new Set([perfil.fusoHorario, ...FUSOS])].map((f) => [f, f.replace("_", " ")])}
          />
        </div>
        {mensagem && <Aviso {...mensagem} />}
        <Button type="submit" className="justify-self-start">
          Salvar
        </Button>
      </form>
    </Card>
  );
}

function Selecao({
  id,
  rotulo,
  valor,
  opcoes,
}: {
  id: string;
  rotulo: string;
  valor: string;
  opcoes: (readonly [string, string])[];
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {rotulo}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={valor}
        className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
      >
        {opcoes.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

type ComConfirmacao = (acao: () => Promise<Resultado>, depois: (r: Resultado) => void) => Promise<void>;

function Senha({ comConfirmacao }: { comConfirmacao: ComConfirmacao }) {
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const d = new FormData(formulario);
    const nova = String(d.get("nova"));
    if (nova !== String(d.get("repita")))
      return setMensagem({ tipo: "erro", texto: "As duas senhas não são iguais." });
    await comConfirmacao(
      () => trocarSenha(String(d.get("atual")), nova),
      (r) => {
        setMensagem(
          r.ok
            ? { tipo: "ok", texto: "Senha trocada. Os outros aparelhos foram desconectados." }
            : { tipo: "erro", texto: r.mensagem ?? "" },
        );
        if (r.ok) formulario.reset();
      },
    );
  }

  return (
    <Card className="gap-4">
      <div className="grid gap-1">
        <CardTitulo>Senha</CardTitulo>
        <CardDescricao>Ao trocar, os outros aparelhos são desconectados.</CardDescricao>
      </div>
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo
          id="atual"
          name="atual"
          type="password"
          rotulo="Senha atual"
          autoComplete="current-password"
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            id="nova"
            name="nova"
            type="password"
            rotulo="Senha nova"
            autoComplete="new-password"
            minLength={10}
            required
          />
          <Campo
            id="repita"
            name="repita"
            type="password"
            rotulo="Repita a senha nova"
            autoComplete="new-password"
            required
          />
        </div>
        {mensagem && <Aviso {...mensagem} />}
        <Button type="submit" className="justify-self-start">
          Trocar a senha
        </Button>
      </form>
    </Card>
  );
}

function Seguranca(props: {
  perfil: Perfil;
  passkeys: PasskeyCadastrada[];
  comConfirmacao: ComConfirmacao;
  aoMudar: () => void;
  aoAtivarApp: () => void;
}) {
  const { perfil, passkeys, comConfirmacao } = props;
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const pronta = usePasskeyPronta("cadastro");
  const dois = perfil.doisFatores;

  async function novaPasskey() {
    setMensagem(null);
    if (pronta.erro?.codigo === "CONFIRMACAO_NECESSARIA") {
      // Já há segundo fator: cadastrar outra passkey é ação perigosa. Confirma, e a tela pede o toque de novo.
      let primeira = true;
      await comConfirmacao(
        async () => {
          if (primeira) {
            primeira = false;
            return { ok: false, codigo: "CONFIRMACAO_NECESSARIA" };
          }
          return { ok: true };
        },
        () =>
          setMensagem({
            tipo: "ok",
            texto: 'Confirmado. Toque de novo em "Cadastrar passkey neste aparelho".',
          }),
      );
      return;
    }
    if (pronta.erro) return setMensagem({ tipo: "erro", texto: pronta.erro.mensagem ?? "" });
    const r = await cadastrarPasskey(pronta.opcoes, nomeDoAparelho());
    setMensagem(
      r.ok
        ? { tipo: "ok", texto: "Passkey cadastrada neste aparelho." }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    props.aoMudar();
  }

  async function apagar(id: string) {
    await comConfirmacao(
      () => apagarPasskey(id),
      (r) => {
        setMensagem(
          r.ok ? { tipo: "ok", texto: "Passkey apagada." } : { tipo: "erro", texto: r.mensagem ?? "" },
        );
        props.aoMudar();
      },
    );
  }

  async function codigosNovos() {
    const senha = perfil.temSenha
      ? (window.prompt("Para gerar códigos novos, digite a sua senha:") ?? "")
      : undefined;
    if (perfil.temSenha && !senha) return;
    await comConfirmacao(
      () => gerarCodigosNovos(senha),
      (r) => {
        const lista = (r as Resultado & { codigos?: string[] }).codigos;
        if (r.ok && lista) setCodigos(lista);
        else setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
      },
    );
  }

  return (
    <Card className="gap-4">
      <div className="grid gap-1">
        <CardTitulo className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          Autenticação em 2 fatores
        </CardTitulo>
        <CardDescricao>
          {dois.obrigatorio
            ? "Obrigatória para o seu perfil. Tenha pelo menos duas formas, para não ficar sem acesso se perder um aparelho."
            : "Uma segunda prova, além da senha, de que é você."}
          {dois.exigePasskey ? " Para o seu perfil, só a passkey vale para confirmar." : ""}
        </CardDescricao>
      </div>

      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Fingerprint className="size-4" />
          Passkeys
        </h3>
        {passkeys.length === 0 && <p className="text-sm text-texto-2">Nenhuma passkey cadastrada.</p>}
        <ul className="grid">
          {passkeys.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 border-t border-linha py-2 first:border-t-0"
            >
              <span className="grid">
                <span className="text-sm font-medium">{p.name || "Passkey"}</span>
                <span className="text-xs text-texto-2">
                  Cadastrada em {new Date(p.createdAt).toLocaleDateString("pt-BR")}
                  {p.deviceType === "multiDevice" ? " · sincronizada" : ""}
                </span>
              </span>
              <Button
                variant="fantasma"
                size="icone"
                aria-label={`Apagar a passkey ${p.name ?? ""}`}
                onClick={() => void apagar(p.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="contorno" className="justify-self-start" onClick={() => void novaPasskey()}>
          <Fingerprint />
          Cadastrar passkey neste aparelho
        </Button>
      </section>

      {!dois.exigePasskey && (
        <section className="grid gap-2 border-t border-linha pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Smartphone className="size-4" />
            App autenticador
          </h3>
          {dois.appAutenticador ? (
            <p className="text-sm text-ok">Ativado.</p>
          ) : (
            <Button variant="contorno" className="justify-self-start" onClick={props.aoAtivarApp}>
              Ativar o app autenticador
            </Button>
          )}
        </section>
      )}

      {dois.appAutenticador && (
        <section className="grid gap-2 border-t border-linha pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4" />
            Códigos de recuperação
          </h3>
          {codigos ? (
            <>
              <p className="text-sm text-texto-2">
                Guarde estes códigos agora. Os anteriores deixaram de valer.
              </p>
              <ul className="grid grid-cols-2 gap-2 rounded-md border border-linha bg-suave p-3 font-mono text-sm">
                {codigos.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          ) : (
            <Button variant="contorno" className="justify-self-start" onClick={() => void codigosNovos()}>
              Gerar códigos novos
            </Button>
          )}
        </section>
      )}

      {mensagem && <Aviso {...mensagem} />}
    </Card>
  );
}
