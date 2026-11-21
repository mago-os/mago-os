/**
 * Notificações em Meu perfil (M3-06): ligar o push neste aparelho, o que chega por onde e o horário de silêncio.
 * No iPhone, o push só funciona com o app instalado na tela de início (limite da Apple).
 */
import { type PreferenciasDeNotificacao, TIPOS_DE_AVISO, type TipoDeAviso } from "@mago-os/contratos";
import { useCallback, useEffect, useState } from "react";
import { desligarPush, lerNotificacoes, ligarPush, salvarPreferenciasDeNotificacao } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { Aviso } from "./Acesso";

const NOMES: Record<TipoDeAviso, string> = {
  tarefa_atribuida: "Tarefa passada para mim",
  mencao: "Menção com @",
  comentario: "Comentário em tarefa que sigo",
  resultado_entregue: "Resultado entregue em tarefa que criei",
  precisa_de_ajuda: "Tarefa precisa de ajuda",
  prazo_hoje: "Prazo vencendo hoje",
  prazo_vencido: "Prazo vencido",
  agente_sem_sinal: "Agente sem sinal",
  agente_passou_do_limite: "Agente passou do limite",
  agente_desligado: "Agente desligado",
  anexo_bloqueado: "Anexo bloqueado pelo antivírus",
  aprovacao_pedida: "Agente pediu a minha aprovação",
  aprovacao_decidida: "Pedido de aprovação decidido",
};

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

/** A chave pública VAPID (base64 url) no formato que o navegador pede. */
function chaveEmBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const bin = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const ehIphoneSemApp = () =>
  /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;

export function Notificacoes() {
  const [chave, setChave] = useState<string | null>(null);
  const [ligado, setLigado] = useState(false);
  const [prefs, setPrefs] = useState<PreferenciasDeNotificacao>({ porTipo: {}, silencio: null });
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const suporta = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;

  const carregar = useCallback(async () => {
    const r = await lerNotificacoes();
    if (!r.ok || !r.dados) return;
    setChave(r.dados.chavePublica);
    setLigado(r.dados.pushNesteAparelho);
    setPrefs(r.dados.preferencias);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function aoLigar() {
    if (!chave) return;
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setMensagem({
          tipo: "erro",
          texto: "O navegador não deixou mostrar notificações. Libere nas configurações.",
        });
        return;
      }
      const registro = await navigator.serviceWorker.ready;
      const assinatura =
        (await registro.pushManager.getSubscription()) ??
        (await registro.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: chaveEmBytes(chave),
        }));
      const json = assinatura.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await ligarPush({ endpoint: json.endpoint, chaves: json.keys });
      setMensagem(
        r.ok
          ? { tipo: "ok", texto: "Push ligado neste aparelho." }
          : { tipo: "erro", texto: r.mensagem ?? "" },
      );
      void carregar();
    } catch {
      setMensagem({ tipo: "erro", texto: "Não foi possível ligar o push neste aparelho." });
    }
  }

  async function aoDesligar() {
    await desligarPush();
    try {
      const registro = await navigator.serviceWorker.ready;
      await (await registro.pushManager.getSubscription())?.unsubscribe();
    } catch {
      // Sem service worker: já está desligado no servidor.
    }
    setMensagem({ tipo: "ok", texto: "Push desligado neste aparelho." });
    void carregar();
  }

  async function salvar(novas: PreferenciasDeNotificacao) {
    setPrefs(novas);
    const r = await salvarPreferenciasDeNotificacao(novas);
    setMensagem(r.ok ? null : { tipo: "erro", texto: r.mensagem ?? "" });
  }

  const canais = (t: TipoDeAviso) => prefs.porTipo[t] ?? { tela: true, push: true };
  const mudar = (t: TipoDeAviso, canal: "tela" | "push", valor: boolean) =>
    void salvar({ ...prefs, porTipo: { ...prefs.porTipo, [t]: { ...canais(t), [canal]: valor } } });

  return (
    <Card className="gap-3">
      <CardTitulo>Notificações</CardTitulo>
      <CardDescricao>
        O sino mostra os avisos com o Mago OS aberto; o push avisa no celular ou no computador mesmo fechado.
      </CardDescricao>
      <div className="flex flex-wrap items-center gap-2">
        {!chave ? (
          <p className="text-sm text-texto-2">O push ainda não está ligado neste ambiente.</p>
        ) : !suporta ? (
          <p className="text-sm text-texto-2">Este navegador não aceita push.</p>
        ) : ligado ? (
          <Button variant="contorno" size="pequeno" onClick={() => void aoDesligar()}>
            Desligar o push neste aparelho
          </Button>
        ) : (
          <Button size="pequeno" onClick={() => void aoLigar()}>
            Ligar o push neste aparelho
          </Button>
        )}
      </div>
      {ehIphoneSemApp() && (
        <p className="text-sm text-texto-2">
          No iPhone, o push só funciona com o Mago OS instalado na tela de início: toque em Compartilhar e em
          Adicionar à Tela de Início.
        </p>
      )}
      {mensagem && <Aviso {...mensagem} />}
      <table className="text-sm">
        <thead>
          <tr className="text-left text-texto-2">
            <th className="py-1 font-medium">Aviso</th>
            <th className="w-16 py-1 text-center font-medium">Sino</th>
            <th className="w-16 py-1 text-center font-medium">Push</th>
          </tr>
        </thead>
        <tbody>
          {TIPOS_DE_AVISO.map((t) => (
            <tr key={t} className="border-t border-linha">
              <td className="py-1.5">{NOMES[t]}</td>
              <td className="text-center">
                <input
                  type="checkbox"
                  aria-label={`${NOMES[t]} no sino`}
                  checked={canais(t).tela}
                  onChange={(e) => mudar(t, "tela", e.target.checked)}
                />
              </td>
              <td className="text-center">
                <input
                  type="checkbox"
                  aria-label={`${NOMES[t]} no push`}
                  checked={canais(t).push}
                  onChange={(e) => mudar(t, "push", e.target.checked)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={prefs.silencio !== null}
            onChange={(e) =>
              void salvar({ ...prefs, silencio: e.target.checked ? { de: "22:00", ate: "07:00" } : null })
            }
          />
          Horário de silêncio (o push espera; o sino recebe na hora)
        </label>
        {prefs.silencio && (
          <>
            <input
              type="time"
              aria-label="Silêncio de"
              className="h-9 rounded-md border border-linha bg-cartao px-2"
              value={prefs.silencio.de}
              onChange={(e) =>
                prefs.silencio &&
                void salvar({ ...prefs, silencio: { ...prefs.silencio, de: e.target.value } })
              }
            />
            até
            <input
              type="time"
              aria-label="Silêncio até"
              className="h-9 rounded-md border border-linha bg-cartao px-2"
              value={prefs.silencio.ate}
              onChange={(e) =>
                prefs.silencio &&
                void salvar({ ...prefs, silencio: { ...prefs.silencio, ate: e.target.value } })
              }
            />
          </>
        )}
      </fieldset>
    </Card>
  );
}
