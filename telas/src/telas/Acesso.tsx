/**
 * Telas de acesso, versão simples (adiantada da M1-10): entrar, pedir o link de senha e definir a senha.
 * A M1-10 completa com 2FA, convite, perfil e sessões, no design aprovado.
 */
import { useState } from "react";
import { definirSenha, entrar, entrarComGoogle, mensagemDoErro, pedirLinkDeSenha } from "@/acesso";
import { Mago } from "@/componentes/Mago";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";

function Moldura({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-sm content-center gap-4 px-4 py-8">
      <div className="flex justify-center">
        <Mago tamanho={96} estado="parado" rotulo="Mago" />
      </div>
      <Card className="gap-5">
        <div className="grid gap-1">
          <CardTitulo className="text-xl">{titulo}</CardTitulo>
          <CardDescricao>{descricao}</CardDescricao>
        </div>
        {children}
      </Card>
    </main>
  );
}

function Aviso({ texto, tipo }: { texto: string; tipo: "erro" | "ok" }) {
  return (
    <p
      role={tipo === "erro" ? "alert" : "status"}
      className={tipo === "erro" ? "text-sm text-perigo" : "text-sm text-ok"}
    >
      {texto}
    </p>
  );
}

function Separador() {
  return (
    <div className="flex items-center gap-3 text-xs text-texto-3">
      <span className="h-px flex-1 bg-linha" />
      ou
      <span className="h-px flex-1 bg-linha" />
    </div>
  );
}

export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const erroDoGoogle = new URLSearchParams(window.location.search).get("error");
  const [erro, setErro] = useState<string | null>(erroDoGoogle ? mensagemDoErro(erroDoGoogle) : null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    setEnviando(true);
    setErro(null);
    const r = await entrar(String(dados.get("email")), String(dados.get("senha")));
    setEnviando(false);
    if (r.ok) aoEntrar();
    else setErro(r.mensagem ?? null);
  }

  async function comGoogle() {
    setErro(null);
    const r = await entrarComGoogle();
    if (!r.ok) setErro(r.mensagem ?? null);
  }

  return (
    <Moldura titulo="Entrar no Mago OS" descricao="Use o e-mail do seu convite.">
      <Button variant="contorno" onClick={() => void comGoogle()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"
          />
          <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z" />
          <path
            fill="#EA4335"
            d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"
          />
        </svg>
        Entrar com Google
      </Button>
      <Separador />
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="email" name="email" type="email" rotulo="E-mail" autoComplete="email" required />
        <Campo
          id="senha"
          name="senha"
          type="password"
          rotulo="Senha"
          autoComplete="current-password"
          required
        />
        {erro && <Aviso texto={erro} tipo="erro" />}
        <Button type="submit" disabled={enviando}>
          {enviando ? "Entrando..." : "Entrar"}
        </Button>
      </form>
      <a
        href="/recuperar-senha"
        className="text-center text-sm text-texto-2 underline-offset-4 hover:underline"
      >
        Esqueci a senha
      </a>
    </Moldura>
  );
}

export function RecuperarSenha() {
  const [aviso, setAviso] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    const r = await pedirLinkDeSenha(String(new FormData(evento.currentTarget).get("email")));
    setEnviando(false);
    setAviso(
      r.ok
        ? {
            tipo: "ok",
            texto: "Se esse e-mail tiver acesso, enviamos um link para definir a senha. Ele vale 1 hora.",
          }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
  }

  return (
    <Moldura titulo="Esqueci a senha" descricao="Mandamos um link para você definir uma senha nova.">
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="email" name="email" type="email" rotulo="E-mail" autoComplete="email" required />
        {aviso && <Aviso {...aviso} />}
        <Button type="submit" disabled={enviando}>
          Mandar o link
        </Button>
      </form>
      <a href="/entrar" className="text-center text-sm text-texto-2 underline-offset-4 hover:underline">
        Voltar para entrar
      </a>
    </Moldura>
  );
}

export function RedefinirSenha() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [aviso, setAviso] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(
    token ? null : { tipo: "erro", texto: mensagemDoErro("INVALID_TOKEN") },
  );
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const senha = String(dados.get("senha"));
    if (senha !== String(dados.get("confirmacao"))) {
      setAviso({ tipo: "erro", texto: "As duas senhas não são iguais." });
      return;
    }
    setEnviando(true);
    const r = await definirSenha(token, senha);
    setEnviando(false);
    setPronto(r.ok);
    setAviso(
      r.ok
        ? { tipo: "ok", texto: "Senha definida. Agora é só entrar." }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
  }

  return (
    <Moldura
      titulo="Definir a senha"
      descricao="Use pelo menos 10 caracteres. Uma frase longa é mais segura e mais fácil de lembrar."
    >
      {pronto ? (
        <>
          {aviso && <Aviso {...aviso} />}
          <Button asChild>
            <a href="/entrar">Entrar</a>
          </Button>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
          <Campo
            id="senha"
            name="senha"
            type="password"
            rotulo="Senha nova"
            autoComplete="new-password"
            minLength={10}
            required
          />
          <Campo
            id="confirmacao"
            name="confirmacao"
            type="password"
            rotulo="Repita a senha"
            autoComplete="new-password"
            required
          />
          {aviso && <Aviso {...aviso} />}
          <Button type="submit" disabled={enviando || !token}>
            Definir a senha
          </Button>
        </form>
      )}
    </Moldura>
  );
}
