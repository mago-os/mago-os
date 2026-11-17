/**
 * Telas do 2FA (M1-05): confirmar o segundo fator e ativar (passkey ou app autenticador, com os códigos).
 * Versão simples, no estilo das telas de acesso; a M1-10 completa no design aprovado.
 */
import { Fingerprint, KeyRound, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import {
  cadastrarPasskey,
  comecarAppAutenticador,
  confirmarCodigo,
  confirmarCodigoDeRecuperacao,
  entrarComPasskey,
} from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Aviso, Moldura } from "./Acesso";

/** Pede o código do app, um código de recuperação ou a passkey. Serve no login e numa sessão aberta. */
export function ConfirmarSegundoFator({ aoConfirmar }: { aoConfirmar: () => void }) {
  const [recuperacao, setRecuperacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const codigo = String(dados.get("codigo"));
    const confiar = dados.get("confiar") === "on";
    setEnviando(true);
    setErro(null);
    const r = recuperacao
      ? await confirmarCodigoDeRecuperacao(codigo, confiar)
      : await confirmarCodigo(codigo, confiar);
    setEnviando(false);
    if (r.ok) aoConfirmar();
    else setErro(r.mensagem ?? null);
  }

  async function comPasskey() {
    setErro(null);
    const r = await entrarComPasskey();
    if (r.ok) aoConfirmar();
    else setErro(r.mensagem ?? null);
  }

  return (
    <Moldura
      titulo="Confirme que é você"
      descricao={
        recuperacao
          ? "Digite um dos seus códigos de recuperação. Cada um vale uma vez só."
          : "Digite o código de 6 dígitos do seu app autenticador, ou use a passkey."
      }
    >
      <Button variant="contorno" onClick={() => void comPasskey()}>
        <Fingerprint />
        Usar a passkey
      </Button>
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo
          key={recuperacao ? "recuperacao" : "app"}
          id="codigo"
          name="codigo"
          rotulo={recuperacao ? "Código de recuperação" : "Código do app"}
          inputMode={recuperacao ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
        />
        <label className="flex items-center gap-2 text-sm text-texto-2">
          <input type="checkbox" name="confiar" className="size-4 accent-tinta" />
          Confiar neste aparelho por 30 dias
        </label>
        {erro && <Aviso texto={erro} tipo="erro" />}
        <Button type="submit" disabled={enviando}>
          Confirmar
        </Button>
      </form>
      <button
        type="button"
        onClick={() => setRecuperacao(!recuperacao)}
        className="cursor-pointer text-center text-sm text-texto-2 underline-offset-4 hover:underline"
      >
        {recuperacao ? "Usar o código do app" : "Perdi o celular: usar um código de recuperação"}
      </button>
    </Moldura>
  );
}

function nomeDoAparelho(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Aparelho";
}

type Etapa =
  | { tipo: "escolher" }
  | { tipo: "senha" }
  | { tipo: "qr"; totpURI: string; codigos: string[]; imagem: string }
  | { tipo: "codigos"; codigos: string[] };

/** Ativar o 2FA: passkey (recomendada) ou app autenticador, que mostra os 10 códigos de recuperação no fim. */
export function AtivarDoisFatores({
  obrigatorio,
  aoConcluir,
}: {
  obrigatorio: boolean;
  aoConcluir: () => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "escolher" });
  const [erro, setErro] = useState<string | null>(null);

  async function comPasskey() {
    setErro(null);
    const r = await cadastrarPasskey(nomeDoAparelho());
    if (r.ok) aoConcluir();
    else setErro(r.mensagem ?? null);
  }

  async function comApp(senha?: string) {
    setErro(null);
    const r = await comecarAppAutenticador(senha);
    if (r.ok && r.totpURI) {
      const imagem = await QRCode.toDataURL(r.totpURI, { margin: 1, width: 220 });
      setEtapa({ tipo: "qr", totpURI: r.totpURI, codigos: r.codigos ?? [], imagem });
    } else if (r.codigo === "INVALID_PASSWORD" && !senha) {
      setEtapa({ tipo: "senha" });
    } else {
      setErro(r.mensagem ?? null);
    }
  }

  const descricao = obrigatorio
    ? "Para o seu perfil, a autenticação em 2 fatores é obrigatória. Escolha como quer confirmar que é você."
    : "Uma segunda prova, além da senha, de que é você mesmo.";

  if (etapa.tipo === "senha") {
    return (
      <Moldura
        titulo="Confirme a sua senha"
        descricao="Antes de ativar o app autenticador, digite a sua senha."
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void comApp(String(new FormData(e.currentTarget).get("senha")));
          }}
        >
          <Campo
            id="senha"
            name="senha"
            type="password"
            rotulo="Senha"
            autoComplete="current-password"
            required
          />
          {erro && <Aviso texto={erro} tipo="erro" />}
          <Button type="submit">Continuar</Button>
        </form>
      </Moldura>
    );
  }

  if (etapa.tipo === "qr")
    return <EtapaQr etapa={etapa} aoConfirmar={(codigos) => setEtapa({ tipo: "codigos", codigos })} />;

  if (etapa.tipo === "codigos") {
    return (
      <Moldura
        titulo="Guarde os códigos de recuperação"
        descricao="Se perder o celular, cada código entra uma vez só. Guarde num gerenciador de senhas ou imprima. Eles não aparecem de novo."
      >
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-linha bg-suave p-3 font-mono text-sm">
          {etapa.codigos.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          variant="contorno"
          onClick={() => void navigator.clipboard?.writeText(etapa.codigos.join("\n"))}
        >
          Copiar os códigos
        </Button>
        <Button onClick={aoConcluir}>Já guardei os códigos</Button>
      </Moldura>
    );
  }

  return (
    <Moldura titulo="Ative a autenticação em 2 fatores" descricao={descricao}>
      <Button onClick={() => void comPasskey()}>
        <Fingerprint />
        Usar passkey (recomendado)
      </Button>
      <p className="-mt-2 text-xs text-texto-3">Face ID, Touch ID, digital, Windows Hello ou chave física.</p>
      <Button variant="contorno" onClick={() => void comApp()}>
        <Smartphone />
        Usar app autenticador
      </Button>
      <p className="-mt-2 text-xs text-texto-3">
        Google Authenticator, Microsoft Authenticator, 1Password ou Authy.
      </p>
      {erro && <Aviso texto={erro} tipo="erro" />}
    </Moldura>
  );
}

function EtapaQr({
  etapa,
  aoConfirmar,
}: {
  etapa: { totpURI: string; codigos: string[]; imagem: string };
  aoConfirmar: (codigos: string[]) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [segredo, setSegredo] = useState("");
  useEffect(() => setSegredo(new URL(etapa.totpURI).searchParams.get("secret") ?? ""), [etapa.totpURI]);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    const r = await confirmarCodigo(String(new FormData(evento.currentTarget).get("codigo")), false);
    if (r.ok) aoConfirmar(etapa.codigos);
    else setErro(r.mensagem ?? null);
  }

  return (
    <Moldura
      titulo="Aponte o app para o QR code"
      descricao="Abra o app autenticador, toque em adicionar e aponte a câmera."
    >
      <img
        src={etapa.imagem}
        alt="QR code para o app autenticador"
        className="mx-auto rounded-md bg-white p-2"
        width={220}
      />
      <details className="text-sm text-texto-2">
        <summary className="cursor-pointer">Não consigo ler o QR code</summary>
        <p className="mt-2 flex items-center gap-2 break-all font-mono text-xs">
          <KeyRound className="size-4 shrink-0" />
          {segredo}
        </p>
      </details>
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo
          id="codigo"
          name="codigo"
          rotulo="Código que aparece no app"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        {erro && <Aviso texto={erro} tipo="erro" />}
        <Button type="submit">Confirmar</Button>
      </form>
    </Moldura>
  );
}
