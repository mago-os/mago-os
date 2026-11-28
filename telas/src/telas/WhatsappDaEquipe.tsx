/**
 * WhatsApp em Meu perfil (M8-09, decisão 0059): gerar o código de vínculo (vale 10 minutos, uma vez só), abrir o
 * WhatsApp pelo link que já leva o código para o número do Mago OS, ver o número vinculado e desvincular.
 */
import type { CodigoDoWhatsapp, SituacaoDoWhatsapp } from "@mago-os/contratos";
import { MessageCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

export function WhatsappDaEquipe() {
  const [situacao, setSituacao] = useState<SituacaoDoWhatsapp | null>(null);
  const [codigo, setCodigo] = useState<CodigoDoWhatsapp | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await pedir<SituacaoDoWhatsapp>("GET", "/conta/whatsapp");
    if (r.ok && r.dados) setSituacao(r.dados);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Enquanto o código está na tela, confere de tempos em tempos se a mensagem já chegou.
  useEffect(() => {
    if (!codigo) return;
    const relogio = setInterval(async () => {
      const r = await pedir<SituacaoDoWhatsapp>("GET", "/conta/whatsapp");
      if (r.ok && r.dados?.vinculo) {
        setSituacao(r.dados);
        setCodigo(null);
        setMensagem({ tipo: "ok", texto: "WhatsApp vinculado." });
      }
      if (new Date(codigo.venceEm).getTime() < Date.now()) setCodigo(null);
    }, 3000);
    return () => clearInterval(relogio);
  }, [codigo]);

  async function gerar() {
    setOcupado(true);
    setMensagem(null);
    const r = await pedir<CodigoDoWhatsapp>("POST", "/conta/whatsapp/codigo");
    setOcupado(false);
    if (r.ok && r.dados) setCodigo(r.dados);
    else setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }

  async function desvincular() {
    setOcupado(true);
    const r = await pedir<{ ok: true }>("DELETE", "/conta/whatsapp");
    setOcupado(false);
    setMensagem(
      r.ok ? { tipo: "ok", texto: "WhatsApp desvinculado." } : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  if (!situacao) return null;
  const v = situacao.vinculo;
  return (
    <Card className="gap-3">
      <CardTitulo className="flex items-center gap-2">
        <MessageCircle className="size-4" aria-hidden /> WhatsApp
      </CardTitulo>
      <CardDescricao>
        Converse com o Mago OS pelo WhatsApp: fale com o coordenador, aprove pedidos e receba os avisos
        urgentes. O número fica ligado só a você, e o Mago OS nunca pede senha por lá.
      </CardDescricao>
      {!situacao.ligado ? (
        <p className="text-sm text-texto-2">O WhatsApp do Mago OS ainda não está ligado neste ambiente.</p>
      ) : v ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>
            Vinculado ao número terminado em <strong>{v.finalDoNumero}</strong>, conversando na{" "}
            <strong>{v.empresa.nome}</strong>.
          </p>
          <Button variant="contorno" size="pequeno" disabled={ocupado} onClick={() => void desvincular()}>
            Desvincular
          </Button>
        </div>
      ) : codigo ? (
        <div className="grid gap-2 text-sm">
          <p>Abra o WhatsApp pelo botão abaixo e mande a mensagem que já vai escrita com o código:</p>
          <p className="font-mono text-2xl tracking-widest">{codigo.codigo}</p>
          <p className="text-texto-2">
            Vale até{" "}
            {new Date(codigo.venceEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} e
            funciona uma vez só.
          </p>
          <div>
            <Button asChild size="pequeno">
              <a href={codigo.link} target="_blank" rel="noreferrer">
                Abrir o WhatsApp
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="pequeno" disabled={ocupado} onClick={() => void gerar()}>
            Vincular o WhatsApp
          </Button>
        </div>
      )}
      {mensagem && <Aviso {...mensagem} />}
    </Card>
  );
}
