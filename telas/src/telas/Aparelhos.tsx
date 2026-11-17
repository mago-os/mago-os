/**
 * Meus aparelhos (M1-08): cada aparelho conectado, com desconectar um ou todos os outros.
 * Versão simples; a M1-10 completa no design aprovado.
 */
import { Laptop, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type AparelhoConectado,
  type AvisoDeAcesso,
  desconectarAparelho,
  desconectarOutros,
  listarAparelhos,
  responderAviso,
} from "@/acesso";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { Aviso } from "./Acesso";

function quando(data: string): string {
  return new Date(data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const celular = (nome: string) => /iPhone|iPad|Android/.test(nome);

export function MeusAparelhos() {
  const [aparelhos, setAparelhos] = useState<AparelhoConectado[] | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: "erro" | "ok" } | null>(null);

  const carregar = useCallback(async () => setAparelhos(await listarAparelhos()), []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function desconectar(sessaoId: string, esteAparelho: boolean) {
    const r = await desconectarAparelho(sessaoId);
    if (esteAparelho && r.ok) return window.location.assign("/entrar");
    setAviso(
      r.ok ? { tipo: "ok", texto: "Aparelho desconectado." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  async function todosOsOutros() {
    const r = await desconectarOutros();
    setAviso(
      r.ok
        ? { tipo: "ok", texto: "Os outros aparelhos foram desconectados." }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-4 px-4 py-5 md:py-8">
      <Card className="gap-3">
        <div className="grid gap-1">
          <CardTitulo className="text-xl">Meus aparelhos</CardTitulo>
          <CardDescricao>
            Onde a sua conta está conectada. Desconecte o que não reconhecer. Uma sessão parada por 3 dias cai
            sozinha.
          </CardDescricao>
        </div>
        {aviso && <Aviso {...aviso} />}
        {aparelhos === null && <p className="text-sm text-texto-2">Carregando...</p>}
        <ul className="grid">
          {aparelhos?.map((a) => {
            const Icone = celular(a.aparelho) ? Smartphone : Laptop;
            return (
              <li
                key={a.sessaoId}
                className="flex items-center gap-3 border-t border-linha py-3 first:border-t-0"
              >
                <Icone className="size-5 shrink-0 text-texto-2" aria-hidden="true" />
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {a.aparelho}
                    {a.esteAparelho && <span className="ml-2 text-xs text-ok">este aparelho</span>}
                  </span>
                  <span className="truncate text-xs text-texto-2">
                    Último uso {quando(a.ultimoUsoEm)}
                    {a.ip ? ` · IP ${a.ip}` : ""}
                  </span>
                </div>
                <Button
                  variant="contorno"
                  size="pequeno"
                  onClick={() => void desconectar(a.sessaoId, a.esteAparelho)}
                >
                  {a.esteAparelho ? "Sair" : "Desconectar"}
                </Button>
              </li>
            );
          })}
        </ul>
        {aparelhos && aparelhos.length > 1 && (
          <Button variant="contorno" onClick={() => void todosOsOutros()}>
            Desconectar todos os outros
          </Button>
        )}
      </Card>
    </main>
  );
}

/** Faixa com os acessos por aparelho novo: "Foi você?". */
export function AvisosDeAcesso({
  avisos,
  aoResponder,
}: {
  avisos: AvisoDeAcesso[];
  aoResponder: () => void;
}) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  if (avisos.length === 0 && !mensagem) return null;

  async function responder(avisoId: string, resposta: "foi_eu" | "nao_fui_eu") {
    const r = await responderAviso(avisoId, resposta);
    if (r.mensagem) setMensagem(r.mensagem);
    aoResponder();
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-2 px-4 pt-4">
      {mensagem && <Aviso texto={mensagem} tipo="erro" />}
      {avisos.map((a) => (
        <div
          key={a.avisoId}
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-cartao border border-alerta/40 bg-cartao p-3 text-sm"
        >
          <span className="flex-1">
            <strong>Novo acesso:</strong> {a.aparelho}, {quando(a.em)}
            {a.ip ? ` (IP ${a.ip})` : ""}. Foi você?
          </span>
          <Button size="pequeno" variant="contorno" onClick={() => void responder(a.avisoId, "foi_eu")}>
            Fui eu
          </Button>
          <Button size="pequeno" onClick={() => void responder(a.avisoId, "nao_fui_eu")}>
            Não fui eu
          </Button>
        </div>
      ))}
    </div>
  );
}
