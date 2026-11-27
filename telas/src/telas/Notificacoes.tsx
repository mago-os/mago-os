/**
 * Notificações em Meu perfil (M3-06): ligar o push neste aparelho, o que chega por onde e o horário de silêncio.
 * No iPhone, o push só funciona com o app instalado na tela de início (limite da Apple).
 */
import {
  AVISOS_FORA_DO_TELEGRAM,
  canaisDoTipo,
  HORA_PADRAO_DO_RESUMO,
  horaDoResumo,
  type PreferenciasDeNotificacao,
  TIPOS_DE_AVISO,
  type TipoDeAviso,
} from "@mago-os/contratos";
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
  teto_de_gasto: "Teto de gasto com IA",
  agentes_parados: "Agentes parados",
  agentes_retomados: "Agentes retomados",
  telegram_desvinculado: "Meu Telegram passou para outra pessoa",
  telegram_aprovacoes_travadas: "Aprovações pelo Telegram travadas por código errado",
  aviso_de_rotina: "Aviso de uma rotina",
  rotina_falhou: "Rotina minha que falhou",
  rotina_desligada: "Rotinas desligadas porque o dono saiu",
  rotina_rodou: "Rotina minha que rodou (quando peço o aviso)",
  convite_de_evento: "Convite para um evento",
  evento_mudou: "Evento mudou ou foi cancelado",
  alerta_de_evento: "Alerta antes de um evento",
  chave_de_api_vencendo: "Chave de API perto de vencer",
  webhook_desligado: "Webhook desligado por falhas",
  canal_desconectado: "Número de WhatsApp desconectado",
  canal_segurando_mensagens: "Número de WhatsApp segurando mensagens pelo ritmo de envio",
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

  // Os padrões vêm do contrato (no Telegram, por padrão, só o urgente; M5-08).
  const canais = (t: TipoDeAviso) => canaisDoTipo(prefs, t);
  // Grava só o que a pessoa mudou: o Telegram sem escolha continua seguindo o padrão do tipo.
  const mudar = (t: TipoDeAviso, canal: "tela" | "push" | "telegram", valor: boolean) => {
    const atual = prefs.porTipo[t];
    const base = {
      tela: atual?.tela ?? true,
      push: atual?.push ?? true,
      ...(atual?.telegram !== undefined ? { telegram: atual.telegram } : {}),
    };
    void salvar({ ...prefs, porTipo: { ...prefs.porTipo, [t]: { ...base, [canal]: valor } } });
  };
  const resumo = horaDoResumo(prefs);

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
            <th className="w-16 py-1 text-center font-medium">Telegram</th>
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
              <td className="text-center">
                {(AVISOS_FORA_DO_TELEGRAM as readonly string[]).includes(t) ? (
                  <span className="text-xs text-texto-2" title="Não vai como aviso pelo Telegram">
                    -
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    aria-label={`${NOMES[t]} no Telegram`}
                    checked={canais(t).telegram}
                    onChange={(e) => mudar(t, "telegram", e.target.checked)}
                  />
                )}
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
          Horário de silêncio (o push e o Telegram esperam; o sino recebe na hora)
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
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={resumo !== null}
            onChange={(e) =>
              void salvar({
                ...prefs,
                resumoDoDia: e.target.checked ? { hora: HORA_PADRAO_DO_RESUMO } : null,
              })
            }
          />
          Resumo do dia pelo Telegram (as prioridades de hoje)
        </label>
        {resumo !== null && (
          <>
            às
            <input
              type="time"
              aria-label="Hora do resumo do dia"
              className="h-9 rounded-md border border-linha bg-cartao px-2"
              value={resumo}
              onChange={(e) =>
                e.target.value && void salvar({ ...prefs, resumoDoDia: { hora: e.target.value } })
              }
            />
          </>
        )}
      </fieldset>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Alertas da agenda, em minutos antes do evento
        <input
          aria-label="Alertas da agenda em minutos"
          className="h-9 w-40 rounded-md border border-linha bg-cartao px-2"
          defaultValue={(prefs.alertasDaAgenda ?? [10]).join(", ")}
          key={(prefs.alertasDaAgenda ?? [10]).join(",")}
          onBlur={(e) => {
            const lista = [
              ...new Set(
                e.target.value
                  .split(/[,\s]+/)
                  .filter(Boolean)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n >= 0 && n <= 10080),
              ),
            ].slice(0, 5);
            void salvar({ ...prefs, alertasDaAgenda: lista });
          }}
        />
        <span className="text-xs text-texto-2">
          (vale para os eventos sem alertas próprios; vazio: sem alerta)
        </span>
      </label>
      <p className="text-xs text-texto-2">
        O Telegram vale quando ele está vinculado nesta empresa (cartão Telegram, acima). O pedido de
        aprovação já chega lá com os botões.
      </p>
    </Card>
  );
}
