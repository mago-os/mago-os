/**
 * Telegram em Meu perfil (M5-01, decisão 0032): gerar o código de vínculo (vale 10 minutos, uma vez só), abrir o bot
 * pelo link que já leva o código, ver a conta vinculada e desvincular.
 */
import type { CodigoDoTelegram, SituacaoDoTelegram } from "@mago-os/contratos";
import { Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

export function Telegram() {
  const [situacao, setSituacao] = useState<SituacaoDoTelegram | null>(null);
  const [codigo, setCodigo] = useState<CodigoDoTelegram | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await pedir<SituacaoDoTelegram>("GET", "/conta/telegram");
    if (r.ok && r.dados) setSituacao(r.dados);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Enquanto o código está na tela, confere de tempos em tempos se o bot já recebeu.
  useEffect(() => {
    if (!codigo) return;
    const relogio = setInterval(async () => {
      const r = await pedir<SituacaoDoTelegram>("GET", "/conta/telegram");
      if (r.ok && r.dados?.vinculo) {
        setSituacao(r.dados);
        setCodigo(null);
        setMensagem({ tipo: "ok", texto: "Telegram vinculado." });
      }
      if (new Date(codigo.venceEm).getTime() < Date.now()) setCodigo(null);
    }, 3000);
    return () => clearInterval(relogio);
  }, [codigo]);

  async function gerar() {
    setOcupado(true);
    setMensagem(null);
    const r = await pedir<CodigoDoTelegram>("POST", "/conta/telegram/codigo");
    setOcupado(false);
    if (r.ok && r.dados) setCodigo(r.dados);
    else setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }

  async function desvincular() {
    setOcupado(true);
    const r = await pedir<{ ok: true }>("DELETE", "/conta/telegram");
    setOcupado(false);
    setMensagem(
      r.ok ? { tipo: "ok", texto: "Telegram desvinculado." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  if (!situacao) return null;
  const v = situacao.vinculo;
  return (
    <Card className="gap-3">
      <CardTitulo className="flex items-center gap-2">
        <Send className="size-4" aria-hidden /> Telegram
      </CardTitulo>
      <CardDescricao>
        Converse com o Mago OS pelo Telegram. A conta fica ligada só a você, e o bot nunca pede senha.
      </CardDescricao>
      {!situacao.botLigado ? (
        <p className="text-sm text-texto-2">O Telegram ainda não está ligado neste ambiente.</p>
      ) : v ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>
            Vinculado a <strong>{v.usuario ? `@${v.usuario}` : v.nome}</strong>, conversando na{" "}
            <strong>{v.empresa.nome}</strong>.
          </p>
          <Button variant="contorno" size="pequeno" disabled={ocupado} onClick={() => void desvincular()}>
            Desvincular
          </Button>
        </div>
      ) : codigo ? (
        <div className="grid gap-2 text-sm">
          <p>
            Abra o bot pelo botão abaixo e toque em Iniciar. Se preferir, mande este código para{" "}
            <strong>@{situacao.bot}</strong>:
          </p>
          <p className="font-mono text-2xl tracking-widest">{codigo.codigo}</p>
          <p className="text-texto-2">
            Vale até{" "}
            {new Date(codigo.venceEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} e
            funciona uma vez só.
          </p>
          <div>
            <Button asChild size="pequeno">
              <a href={codigo.link} target="_blank" rel="noreferrer">
                Abrir o Telegram
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="pequeno" disabled={ocupado} onClick={() => void gerar()}>
            Vincular o Telegram
          </Button>
        </div>
      )}
      {mensagem && <Aviso {...mensagem} />}
    </Card>
  );
}
