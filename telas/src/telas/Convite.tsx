/**
 * Aceitar o convite (M1-07), aberta pelo link do e-mail: /convite?codigo=...
 *
 * - Quem ainda não tem conta define a senha aqui mesmo e depois entra.
 * - Quem já tem conta entra antes (senha, passkey ou Google) e volta para cá para aceitar.
 */
import { useEffect, useState } from "react";
import { abrirConvite, aceitarConvite, type ConviteAberto, lerSessao, type Sessao, sair } from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Aviso, Moldura } from "./Acesso";

export function AceitarConvite() {
  const codigo = new URLSearchParams(window.location.search).get("codigo") ?? "";
  const [convite, setConvite] = useState<ConviteAberto | null | undefined>(undefined);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    void (async () => {
      setSessao(await lerSessao());
      setConvite(codigo ? await abrirConvite(codigo) : null);
    })();
  }, [codigo]);

  const volta = `/entrar?volta=${encodeURIComponent(`/convite?codigo=${codigo}`)}`;

  if (convite === undefined) return <div className="min-h-dvh" aria-busy="true" />;
  if (convite === null && !pronto)
    return (
      <Moldura
        titulo="Convite inválido"
        descricao="Este convite expirou, foi cancelado ou já foi usado. Peça um novo a quem convidou você."
      >
        <Button asChild>
          <a href="/entrar">Ir para entrar</a>
        </Button>
      </Moldura>
    );

  async function aceitar(senha?: string) {
    setEnviando(true);
    setAviso(null);
    const r = await aceitarConvite(codigo, senha);
    setEnviando(false);
    if (!r.ok) return setAviso({ tipo: "erro", texto: r.mensagem ?? "" });
    if (sessao) window.location.assign("/");
    else setPronto(true);
  }

  async function aoDefinirSenha(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const senha = String(dados.get("senha"));
    if (senha !== String(dados.get("confirmacao")))
      return setAviso({ tipo: "erro", texto: "As duas senhas não são iguais." });
    await aceitar(senha);
  }

  if (pronto)
    return (
      <Moldura
        titulo="Tudo certo"
        descricao="Convite aceito e senha definida. Agora é só entrar com o seu e-mail."
      >
        <Button asChild>
          <a href="/entrar">Entrar</a>
        </Button>
      </Moldura>
    );

  const c = convite as ConviteAberto;
  const descricao = `${c.quemConvidou} convidou você para a ${c.empresa} no Mago OS.`;

  // Já tem conta: precisa estar conectado com o e-mail convidado.
  if (c.temConta) {
    const mesmaPessoa = sessao?.pessoa.email === c.email;
    return (
      <Moldura titulo={`Entrar na ${c.empresa}`} descricao={descricao}>
        <p className="text-sm text-texto-2">
          Convite para <strong className="text-texto">{c.email}</strong>.
        </p>
        {aviso && <Aviso {...aviso} />}
        {mesmaPessoa ? (
          <Button disabled={enviando} onClick={() => void aceitar()}>
            Aceitar o convite
          </Button>
        ) : sessao ? (
          <>
            <p className="text-sm">
              Você está conectado como {sessao.pessoa.email}. Saia e entre com a conta do e-mail convidado.
            </p>
            <Button variant="contorno" onClick={() => void sair().then(() => window.location.assign(volta))}>
              Sair e entrar com outra conta
            </Button>
          </>
        ) : (
          <Button asChild>
            <a href={volta}>Entrar para aceitar</a>
          </Button>
        )}
      </Moldura>
    );
  }

  // Ainda sem conta: define a senha aqui.
  return (
    <Moldura titulo={`Bem-vindo, ${c.nome.split(" ")[0]}`} descricao={descricao}>
      <p className="text-sm text-texto-2">
        Crie a sua senha para entrar com <strong className="text-texto">{c.email}</strong>. Use pelo menos 10
        caracteres: uma frase longa é mais segura e mais fácil de lembrar.
      </p>
      <form className="grid gap-4" onSubmit={(e) => void aoDefinirSenha(e)}>
        <Campo
          id="senha"
          name="senha"
          type="password"
          rotulo="Senha"
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
        <Button type="submit" disabled={enviando}>
          Aceitar o convite
        </Button>
      </form>
    </Moldura>
  );
}
