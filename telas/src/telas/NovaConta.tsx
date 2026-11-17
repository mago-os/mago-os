/**
 * Criar a conta pelo convite do Dono (M1-11), aberta pelo link do e-mail: /nova-conta?codigo=...
 *
 * Quem ainda não tem acesso cria a senha (ou entra com o Google do e-mail convidado) e os dados da conta na mesma
 * tela. Quem já tem entra antes e volta para cá.
 * Quem cria vira o administrador da conta.
 */
import { documentoValido, normalizarDocumento } from "@mago-os/contratos";
import { useEffect, useState } from "react";
import {
  abrirConviteDeConta,
  type ConviteDeContaAberto,
  criarContaPeloConvite,
  entrarComGoogle,
  lerSessao,
  mensagemDoErro,
  prepararConviteDeContaParaGoogle,
  type Sessao,
  sair,
} from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Aviso, BotaoDoGoogle, Moldura, Separador } from "./Acesso";

const fusoDoNavegador = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
};
const idiomaDoNavegador = () =>
  /^[a-z]{2,3}(-[A-Z]{2})?$/.test(navigator.language) ? navigator.language : "pt-BR";

export function NovaConta() {
  const busca = new URLSearchParams(window.location.search);
  const codigo = busca.get("codigo") ?? "";
  const erroDoGoogle = busca.get("error");
  const [convite, setConvite] = useState<ConviteDeContaAberto | null | undefined>(undefined);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [tipo, setTipo] = useState<"pj" | "pf">("pj");
  const [nomeLegal, setNomeLegal] = useState("");
  const [nome, setNome] = useState("");
  const [aviso, setAviso] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(
    erroDoGoogle ? { tipo: "erro", texto: mensagemDoErro(erroDoGoogle) } : null,
  );
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    void (async () => {
      setSessao(await lerSessao());
      setConvite(codigo ? await abrirConviteDeConta(codigo) : null);
    })();
  }, [codigo]);

  const volta = `/entrar?volta=${encodeURIComponent(`/nova-conta?codigo=${codigo}`)}`;

  if (convite === undefined) return <div className="min-h-dvh" aria-busy="true" />;
  if (pronto)
    return (
      <Moldura
        titulo="Conta criada"
        descricao="Tudo pronto. Agora é só entrar com o seu e-mail e a senha que você criou."
      >
        <Button asChild>
          <a href="/entrar">Entrar</a>
        </Button>
      </Moldura>
    );
  if (convite === null)
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

  const precisaEntrar = convite.temConta && !sessao;
  const outraPessoa = sessao && sessao.pessoa.email !== convite.email;

  // Google: a pessoa do convite passa a existir (e-mail confirmado), o Google liga a conta dele a ela e volta aqui.
  async function comGoogle() {
    setAviso(null);
    const aqui = `/nova-conta?codigo=${encodeURIComponent(codigo)}`;
    const p = await prepararConviteDeContaParaGoogle(codigo);
    if (!p.ok) return setAviso({ tipo: "erro", texto: p.mensagem ?? "" });
    const r = await entrarComGoogle(aqui, aqui);
    if (!r.ok) setAviso({ tipo: "erro", texto: r.mensagem ?? "" });
  }

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const documento = normalizarDocumento(String(f.get("documento") ?? ""));
    if (documento && !documentoValido(tipo, documento))
      return setAviso({
        tipo: "erro",
        texto: tipo === "pf" ? "Confira o CPF: ele não é válido." : "Confira o CNPJ: ele não é válido.",
      });
    const senha = sessao ? undefined : String(f.get("senha"));
    if (senha !== undefined && senha !== String(f.get("confirmacao")))
      return setAviso({ tipo: "erro", texto: "As duas senhas não são iguais." });
    setEnviando(true);
    setAviso(null);
    const r = await criarContaPeloConvite(
      codigo,
      {
        tipo: documento ? tipo : null,
        documento: documento || null,
        nomeLegal: nomeLegal.trim() || null,
        nome: nome.trim(),
        fusoHorario: String(f.get("fuso")).trim(),
        idioma: idiomaDoNavegador(),
        telefone: String(f.get("telefone") ?? "").trim(),
      },
      senha,
    );
    setEnviando(false);
    if (!r.ok) return setAviso({ tipo: "erro", texto: r.mensagem ?? "" });
    if (sessao) window.location.assign("/");
    else setPronto(true);
  }

  const descricao = `${convite.quemConvidou} convidou você para criar a sua conta no Mago OS. Você será o administrador dela.`;

  if (precisaEntrar || outraPessoa)
    return (
      <Moldura titulo="Criar a sua conta" descricao={descricao}>
        <p className="text-sm text-texto-2">
          Convite para <strong className="text-texto">{convite.email}</strong>, que já tem acesso ao Mago OS.
        </p>
        {outraPessoa ? (
          <>
            <p className="text-sm">
              Você está conectado como {sessao?.pessoa.email}. Saia e entre com a conta do e-mail convidado.
            </p>
            <Button variant="contorno" onClick={() => void sair().then(() => window.location.assign(volta))}>
              Sair e entrar com outra conta
            </Button>
          </>
        ) : (
          <Button asChild>
            <a href={volta}>Entrar para continuar</a>
          </Button>
        )}
      </Moldura>
    );

  return (
    <Moldura titulo={`Bem-vindo, ${convite.nome.split(" ")[0]}`} descricao={descricao}>
      {!sessao && (
        <>
          <BotaoDoGoogle rotulo="Continuar com Google" aoClicar={() => void comGoogle()} />
          <p className="-mt-2 text-center text-xs text-texto-2">Use a conta Google de {convite.email}.</p>
          <Separador />
        </>
      )}
      <form className="grid gap-4" onSubmit={(e) => void aoEnviar(e)}>
        <Campo
          id="nome-exibicao"
          name="nome"
          rotulo="Nome no Mago OS"
          placeholder="Como a conta aparece no sistema"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={200}
          required
        />
        <Campo id="fuso" name="fuso" rotulo="Fuso horário" defaultValue={fusoDoNavegador()} required />
        <fieldset className="grid gap-3 rounded-md border border-linha p-3">
          <legend className="px-1 text-sm font-medium">Dados para nota fiscal (pode preencher depois)</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["pj", "Empresa (CNPJ)"],
                ["pf", "Pessoa física (CPF)"],
              ] as const
            ).map(([valor, rotulo]) => (
              <label
                key={valor}
                className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm ${
                  tipo === valor ? "border-tinta font-medium" : "border-linha text-texto-2"
                }`}
              >
                <input
                  type="radio"
                  name="tipo"
                  value={valor}
                  checked={tipo === valor}
                  onChange={() => setTipo(valor)}
                  className="sr-only"
                />
                {rotulo}
              </label>
            ))}
          </div>
          <Campo
            id="documento"
            name="documento"
            rotulo={tipo === "pf" ? "CPF" : "CNPJ"}
            inputMode={tipo === "pf" ? "numeric" : "text"}
            placeholder={tipo === "pf" ? "000.000.000-00" : "00.000.000/0000-00"}
            autoComplete="off"
          />
          <Campo
            id="nome-legal"
            name="nomeLegal"
            rotulo={tipo === "pf" ? "Nome completo" : "Razão social"}
            value={nomeLegal}
            onChange={(e) => setNomeLegal(e.target.value)}
            maxLength={200}
          />
          <Campo id="telefone" name="telefone" type="tel" rotulo="Telefone" autoComplete="tel" />
        </fieldset>
        {!sessao && (
          <>
            <p className="text-sm text-texto-2">
              Crie a sua senha para entrar com <strong className="text-texto">{convite.email}</strong>. Use
              pelo menos 10 caracteres: uma frase longa é mais segura e mais fácil de lembrar.
            </p>
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
          </>
        )}
        {aviso && <Aviso {...aviso} />}
        <Button type="submit" disabled={enviando}>
          {enviando ? "Criando..." : "Criar a conta"}
        </Button>
      </form>
    </Moldura>
  );
}
