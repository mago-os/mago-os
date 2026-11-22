/**
 * Empresas (M1-11), só para o Dono da plataforma: a lista de contas (só o cadastro, nada de dentro), os convites
 * pendentes e o convite para criar uma conta nova. O Dono não entra nas contas: quem cria vira o administrador.
 */
import { formatarDocumento } from "@mago-os/contratos";
import { useCallback, useEffect, useState } from "react";
import {
  type ContaDaPlataforma,
  type ConviteDeConta,
  cancelarConviteDeConta,
  convidarConta,
  listarContasDaPlataforma,
  reenviarConviteDeConta,
} from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { Aviso } from "./Acesso";
import { useAoVoltar } from "./Administrador";
import { ParadaDaPlataforma } from "./Parada";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

export function Empresas() {
  const [dados, setDados] = useState<{ empresas: ContaDaPlataforma[]; convites: ConviteDeConta[] } | null>(
    null,
  );
  const [convidando, setConvidando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => setDados(await listarContasDaPlataforma()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);

  async function aoConvidar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const email = String(f.get("email")).trim();
    const r = await convidarConta({ nome: String(f.get("nome")).trim(), email });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setConvidando(false);
    setMensagem({ tipo: "ok", texto: `Convite enviado para ${email}. O link vale 7 dias.` });
    void carregar();
  }

  async function acao(c: ConviteDeConta, qual: "reenviar" | "cancelar") {
    const r = qual === "reenviar" ? await reenviarConviteDeConta(c.id) : await cancelarConviteDeConta(c.id);
    setMensagem(
      r.ok
        ? {
            tipo: "ok",
            texto:
              qual === "reenviar"
                ? `Convite reenviado para ${c.email}. O link anterior parou de valer.`
                : `Convite de ${c.email} cancelado.`,
          }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  return (
    <main className="mx-auto grid max-w-4xl gap-4 px-4 py-5 md:py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Empresas</h1>
        <p className="text-sm text-texto-2">
          As contas do Mago OS. Você vê só o cadastro: o que acontece dentro de cada conta é dela.
        </p>
      </div>
      <ParadaDaPlataforma />
      {!convidando && (
        <Button className="justify-self-start" onClick={() => setConvidando(true)}>
          Convidar nova conta
        </Button>
      )}
      {convidando && (
        <Card className="gap-4">
          <div className="grid gap-1">
            <CardTitulo>Convidar nova conta</CardTitulo>
            <CardDescricao>
              O responsável recebe um e-mail, cria o acesso e cadastra a empresa (CNPJ) ou a conta de pessoa
              física (CPF). Ele vira o administrador da conta.
            </CardDescricao>
          </div>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void aoConvidar(e)}>
            <Campo
              id="conta-nome"
              name="nome"
              rotulo="Nome do responsável"
              autoComplete="off"
              required
              maxLength={200}
            />
            <Campo
              id="conta-email"
              name="email"
              type="email"
              rotulo="E-mail do responsável"
              autoComplete="off"
              required
            />
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit">Enviar convite</Button>
              <Button type="button" variant="fantasma" onClick={() => setConvidando(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}
      {mensagem && <Aviso {...mensagem} />}

      {dados && dados.convites.length > 0 && (
        <Card className="gap-0 p-0">
          <p className="px-5 pt-4 pb-2 text-sm font-semibold">Convites pendentes</p>
          <ul>
            {dados.convites.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-linha px-5 py-3">
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{c.nome}</span>
                  <span className="truncate text-xs text-texto-2">
                    {c.email} · vale até {data(c.expiraEm)}
                  </span>
                </span>
                <Button size="pequeno" variant="contorno" onClick={() => void acao(c, "reenviar")}>
                  Reenviar
                </Button>
                <Button size="pequeno" variant="fantasma" onClick={() => void acao(c, "cancelar")}>
                  Cancelar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="gap-0 p-0">
        {dados === null && <p className="p-5 text-sm text-texto-2">Carregando...</p>}
        <ul>
          {dados?.empresas.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 border-t border-linha px-5 py-3 first:border-t-0"
            >
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium">{e.nome}</span>
                <span className="truncate text-xs text-texto-2">
                  {e.documento
                    ? `${e.tipo === "pf" ? "CPF" : "CNPJ"} ${formatarDocumento(e.documento)}`
                    : "Sem documento (criada antes do cadastro novo)"}
                </span>
              </span>
              <span className="grid text-right text-xs">
                <span className={e.situacao === "ativa" ? "text-ok" : "text-texto-2"}>
                  {e.situacao === "ativa" ? "Ativa" : "Suspensa"}
                </span>
                <span className="text-texto-2">
                  {e.pessoas} {e.pessoas === 1 ? "pessoa" : "pessoas"} · desde {data(e.criadaEm)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
