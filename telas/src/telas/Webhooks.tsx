/**
 * Webhooks de saída (M7-03, decisão 0048): o administrador cadastra o endereço e os eventos, vê o segredo uma vez só,
 * manda um teste, liga e desliga, troca o segredo, apaga, e vê o histórico das entregas com "Tentar de novo".
 */
import {
  type EntregaDeWebhook,
  EVENTOS_DE_WEBHOOK,
  type EventoDeWebhook,
  NOMES_DOS_EVENTOS_DE_WEBHOOK,
  type Webhook,
  type WebhookCriado,
} from "@mago-os/contratos";
import { Check, Copy, Webhook as IconeDoWebhook, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const NOMES_DAS_SITUACOES: Record<EntregaDeWebhook["situacao"], string> = {
  esperando: "Na fila",
  entregue: "Entregue",
  falhou: "Falhou, vai tentar de novo",
  desistiu: "Não entregue",
};

function Segredo({ segredo, aoFechar }: { segredo: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(segredo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <Card className="gap-2 border-alerta/40">
      <CardTitulo>Copie o segredo agora</CardTitulo>
      <CardDescricao>
        Ele aparece só esta vez. Use no sistema que recebe os avisos para conferir a assinatura (veja a{" "}
        <a className="underline" href="/api/docs#webhooks" target="_blank" rel="noreferrer">
          documentação
        </a>
        ).
      </CardDescricao>
      <code
        className={cn(
          "break-all rounded p-2 text-sm transition-colors",
          copiado ? "bg-ok/10 ring-2 ring-ok/40" : "bg-suave",
        )}
      >
        {segredo}
      </code>
      <p role="status" className="min-h-5 text-sm text-ok">
        {copiado ? "Segredo copiado para a área de transferência." : ""}
      </p>
      <div className="flex gap-2">
        <Button size="pequeno" variant="contorno" onClick={() => void copiar()}>
          {copiado ? <Check /> : <Copy />}
          {copiado ? "Copiado!" : "Copiar"}
        </Button>
        <Button size="pequeno" variant="fantasma" onClick={aoFechar}>
          Já guardei
        </Button>
      </div>
    </Card>
  );
}

function Entregas({ webhookId }: { webhookId: string }) {
  const [entregas, setEntregas] = useState<EntregaDeWebhook[] | null>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<{ entregas: EntregaDeWebhook[] }>("GET", `/empresa/webhooks/${webhookId}/entregas`);
    setEntregas(r.dados?.entregas ?? []);
  }, [webhookId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  if (!entregas) return null;
  if (entregas.length === 0)
    return <p className="text-sm text-texto-2">Nenhuma entrega nos últimos 30 dias.</p>;
  return (
    <ul className="grid gap-1 text-sm">
      {entregas.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 border-t border-linha pt-1">
          <span className="font-medium">{e.evento}</span>
          <span
            className={
              e.situacao === "entregue" ? "text-ok" : e.situacao === "esperando" ? "" : "text-perigo"
            }
          >
            {NOMES_DAS_SITUACOES[e.situacao]}
          </span>
          <span className="text-texto-2">
            {quando(e.criadaEm)}
            {e.ultimoCodigo !== null ? ` · código ${e.ultimoCodigo}` : ""}
            {e.ultimoTempoMs !== null ? ` · ${e.ultimoTempoMs} ms` : ""}
            {e.tentativas > 1 ? ` · ${e.tentativas} tentativas` : ""}
          </span>
          {e.ultimoErro && e.situacao !== "entregue" && <span className="text-texto-2">{e.ultimoErro}</span>}
          {e.situacao !== "entregue" && e.situacao !== "esperando" && (
            <Button
              size="pequeno"
              variant="fantasma"
              onClick={async () => {
                await pedir("POST", `/empresa/webhooks/${webhookId}/entregas/${e.id}/reenviar`, {});
                setTimeout(() => void carregar(), 1500);
              }}
            >
              Tentar de novo
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function EscolherEventos({ escolhidos }: { escolhidos: EventoDeWebhook[] }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-sm font-medium">Quando avisar</legend>
      {EVENTOS_DE_WEBHOOK.map((ev) => (
        <label key={ev} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="eventos" value={ev} defaultChecked={escolhidos.includes(ev)} />
          {NOMES_DOS_EVENTOS_DE_WEBHOOK[ev]}
        </label>
      ))}
    </fieldset>
  );
}

const lerEventos = (f: FormData) => f.getAll("eventos").map(String) as EventoDeWebhook[];

export function Webhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  const carregar = useCallback(async () => {
    const r = await pedir<{ webhooks: Webhook[] }>("GET", "/empresa/webhooks");
    setWebhooks(r.dados?.webhooks ?? []);
    if (!r.ok) setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const eventos = lerEventos(f);
    if (eventos.length === 0) return setMensagem({ tipo: "erro", texto: "Escolha pelo menos um evento." });
    const r = await pedir<WebhookCriado>("POST", "/empresa/webhooks", {
      nome: String(f.get("nome")).trim(),
      url: String(f.get("url")).trim(),
      eventos,
    });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setSegredo(r.dados.segredo);
    setCriando(false);
    setMensagem(null);
    void carregar();
  }

  async function salvar(w: Webhook, evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const eventos = lerEventos(f);
    if (eventos.length === 0) return setMensagem({ tipo: "erro", texto: "Escolha pelo menos um evento." });
    const r = await pedir("POST", `/empresa/webhooks/${w.id}`, {
      nome: String(f.get("nome")).trim(),
      url: String(f.get("url")).trim(),
      eventos,
    });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setEditando(null);
    setMensagem({ tipo: "ok", texto: "Webhook salvo." });
    void carregar();
  }

  async function acao(w: Webhook, qual: "ligar" | "desligar" | "teste" | "segredo" | "apagar") {
    if (qual === "apagar" && !confirm(`Apagar o webhook "${w.nome}"? O histórico das entregas também sai.`))
      return;
    if (
      qual === "segredo" &&
      !confirm("Trocar o segredo? O sistema que recebe precisa do segredo novo na hora.")
    )
      return;
    const r =
      qual === "apagar"
        ? await pedir("DELETE", `/empresa/webhooks/${w.id}`)
        : qual === "teste"
          ? await pedir("POST", `/empresa/webhooks/${w.id}/teste`, {})
          : qual === "segredo"
            ? await pedir<WebhookCriado>("POST", `/empresa/webhooks/${w.id}/trocar-segredo`, {})
            : await pedir("POST", `/empresa/webhooks/${w.id}`, {
                situacao: qual === "ligar" ? "ligado" : "desligado",
              });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    if (qual === "segredo") setSegredo((r.dados as WebhookCriado).segredo);
    setMensagem({
      tipo: "ok",
      texto:
        qual === "teste"
          ? "Teste enviado. Veja o resultado no histórico em alguns segundos."
          : qual === "apagar"
            ? "Webhook apagado."
            : qual === "segredo"
              ? "Segredo trocado."
              : qual === "ligar"
                ? "Webhook ligado."
                : "Webhook desligado.",
    });
    if (qual === "teste") setAberto(w.id);
    void carregar();
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
          <p className="text-sm text-texto-2">
            O Mago OS avisa um sistema de fora (n8n, Make, o site da empresa) na hora em que algo acontece. O
            aviso leva só os ids: o resto se busca pela API, com uma chave de API.
          </p>
        </div>
        {!criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Novo webhook
          </Button>
        )}
      </div>

      {segredo && <Segredo segredo={segredo} aoFechar={() => setSegredo(null)} />}

      {criando && (
        <Card className="gap-4">
          <CardTitulo>Novo webhook</CardTitulo>
          <form className="grid gap-4" onSubmit={(e) => void criar(e)}>
            <Campo
              id="nome"
              name="nome"
              rotulo="Nome"
              placeholder="Ex.: n8n da 4xpert"
              required
              maxLength={80}
            />
            <Campo
              id="url"
              name="url"
              type="url"
              rotulo="Endereço (https)"
              placeholder="https://n8n.minhaempresa.com/webhook/mago"
              required
              maxLength={500}
            />
            <EscolherEventos escolhidos={["tarefa.concluida"]} />
            {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
            <div className="flex gap-2">
              <Button type="submit">Criar webhook</Button>
              <Button type="button" variant="fantasma" onClick={() => setCriando(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!criando && mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      {webhooks && webhooks.length === 0 && <p className="text-sm text-texto-2">Nenhum webhook ainda.</p>}
      <ul className="grid gap-2">
        {webhooks?.map((w) => (
          <li key={w.id} className="grid gap-2 rounded-lg border border-linha bg-cartao p-3">
            {editando === w.id ? (
              <form className="grid gap-3" onSubmit={(e) => void salvar(w, e)}>
                <Campo
                  id={`nome-${w.id}`}
                  name="nome"
                  rotulo="Nome"
                  defaultValue={w.nome}
                  required
                  maxLength={80}
                />
                <Campo
                  id={`url-${w.id}`}
                  name="url"
                  type="url"
                  rotulo="Endereço (https)"
                  defaultValue={w.url}
                  required
                />
                <EscolherEventos escolhidos={w.eventos} />
                <div className="flex gap-2">
                  <Button type="submit" size="pequeno">
                    Salvar
                  </Button>
                  <Button type="button" size="pequeno" variant="fantasma" onClick={() => setEditando(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <IconeDoWebhook className="size-4 text-texto-2" />
                  {w.nome}
                  <span
                    className={cn("text-xs font-normal", w.situacao === "ligado" ? "text-ok" : "text-perigo")}
                  >
                    {w.situacao === "ligado"
                      ? "Ligado"
                      : w.desligadoPorque === "falhas"
                        ? "Desligado: 3 dias sem conseguir entregar"
                        : "Desligado"}
                  </span>
                </span>
                <span className="break-all text-sm text-texto-2">{w.url}</span>
                <span className="text-xs text-texto-2">
                  {w.eventos.map((e) => NOMES_DOS_EVENTOS_DE_WEBHOOK[e].split(" (")[0]).join(" · ")}
                </span>
                <span className="text-xs text-texto-2">
                  Segredo terminado em {w.finalDoSegredo}
                  {w.ultimaEntregaEm ? ` · última entrega ${quando(w.ultimaEntregaEm)}` : ""}
                  {w.falhandoDesde ? ` · falhando desde ${quando(w.falhandoDesde)}` : ""}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="pequeno" variant="contorno" onClick={() => void acao(w, "teste")}>
                    Mandar teste
                  </Button>
                  <Button
                    size="pequeno"
                    variant="fantasma"
                    onClick={() => setAberto(aberto === w.id ? null : w.id)}
                  >
                    {aberto === w.id ? "Esconder histórico" : "Histórico"}
                  </Button>
                  <Button size="pequeno" variant="fantasma" onClick={() => setEditando(w.id)}>
                    Editar
                  </Button>
                  <Button
                    size="pequeno"
                    variant="fantasma"
                    onClick={() => void acao(w, w.situacao === "ligado" ? "desligar" : "ligar")}
                  >
                    {w.situacao === "ligado" ? "Desligar" : "Ligar"}
                  </Button>
                  <Button size="pequeno" variant="fantasma" onClick={() => void acao(w, "segredo")}>
                    Trocar segredo
                  </Button>
                  <Button
                    size="pequeno"
                    variant="fantasma"
                    className="text-perigo"
                    onClick={() => void acao(w, "apagar")}
                  >
                    Apagar
                  </Button>
                </div>
                {aberto === w.id && <Entregas webhookId={w.id} />}
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
