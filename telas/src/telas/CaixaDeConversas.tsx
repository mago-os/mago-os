/**
 * Caixa única das conversas (M8-04, decisão 0054): a lista com filtros, busca e visões salvas; a conversa aberta com o
 * histórico, a ficha resumida do contato e as tarefas dele; responder (texto, foto, documento, emojis e respostas
 * prontas com "/"), nota interna com @, assumir, passar, devolver ao agente, resolver, reabrir e criar tarefa; tempo
 * real com "fulano está respondendo". No computador, a lista e a conversa lado a lado; no celular, uma de cada vez.
 */
import type {
  Canal,
  ConversaComContato,
  FiltroDeConversas,
  MensagemDaConversa,
  RespostaPronta,
  ResumoDaConversa,
  SituacaoDeConversa,
  Tarefa,
  VisaoDeConversas,
} from "@mago-os/contratos";
import {
  ArrowLeft,
  Globe,
  MessageCircle,
  Paperclip,
  Search,
  Send,
  Smile,
  StickyNote,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { usePessoas } from "./Tarefas";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;

const NOMES_DAS_SITUACOES: Record<SituacaoDeConversa, string> = {
  aberta: "Aberta",
  esperando_cliente: "Esperando o cliente",
  esperando_equipe: "Esperando a equipe",
  resolvida: "Resolvida",
};

const ENTREGAS: Record<NonNullable<MensagemDaConversa["entrega"]>, string> = {
  pendente: "Enviando...",
  enviada: "Enviada",
  entregue: "Entregue",
  lida: "Lida",
  falhou: "Não enviada",
};

const SEM_TEXTO: Record<MensagemDaConversa["tipo"], string> = {
  texto: "",
  foto: "Foto",
  documento: "Documento",
  audio: "Áudio",
  localizacao: "Localização",
  contato: "Contato compartilhado",
  outro: "Tipo de mensagem ainda não mostrado aqui",
  nota: "Nota interna",
};

const ARQUIVO: Record<string, string> = {
  bloqueado: "Arquivo bloqueado pelo antivírus",
  grande_demais: "Arquivo maior que 25 MB, não guardado",
  nao_baixado: "Arquivo não recebido",
  apagado: "Arquivo apagado pelo prazo de 180 dias",
};

/** Os emojis mais usados, para quem está no computador (no celular, o teclado já tem). */
const EMOJIS = ["😀", "😊", "👍", "🙏", "👏", "🎉", "❤️", "✅", "⏰", "📎"];

/** Os filtros rápidos da caixa. */
const ABAS: { id: string; nome: string; filtro: (eu: string) => FiltroDeConversas }[] = [
  { id: "esperando", nome: "Esperando a equipe", filtro: () => ({ situacoes: ["esperando_equipe"] }) },
  {
    id: "minhas",
    nome: "Minhas",
    filtro: (eu) => ({ donoId: eu, situacoes: ["aberta", "esperando_cliente", "esperando_equipe"] }),
  },
  {
    id: "sem-dono",
    nome: "Sem dono",
    filtro: () => ({
      donoId: "sem",
      comAgente: false,
      situacoes: ["aberta", "esperando_cliente", "esperando_equipe"],
    }),
  },
  {
    id: "agente",
    nome: "Com o agente",
    filtro: () => ({ comAgente: true, situacoes: ["aberta", "esperando_cliente", "esperando_equipe"] }),
  },
  { id: "resolvidas", nome: "Resolvidas", filtro: () => ({ situacoes: ["resolvida"] }) },
  { id: "todas", nome: "Todas", filtro: () => ({}) },
];

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** O filtro em query string para a rota da lista. */
function query(f: FiltroDeConversas): string {
  const q = new URLSearchParams();
  if (f.situacoes) q.set("situacoes", f.situacoes.join(","));
  if (f.canalId) q.set("canal", f.canalId);
  if (f.contatoId) q.set("contato", f.contatoId);
  if (f.donoId) q.set("dono", f.donoId);
  if (f.comAgente !== undefined) q.set("comAgente", f.comAgente ? "1" : "0");
  if (f.texto) q.set("texto", f.texto);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** O arquivo escolhido em base64, sem o prefixo data:. */
function emBase64(arquivo: File): Promise<string> {
  return new Promise((ok, erro) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).replace(/^data:[^,]*,/, ""));
    leitor.onerror = () => erro(leitor.error);
    leitor.readAsDataURL(arquivo);
  });
}

const IconeDoCanal = ({ provedor }: { provedor: ConversaComContato["canal"]["provedor"] }) =>
  provedor === "site" ? (
    <Globe className="size-4 shrink-0 text-texto-2" aria-label="Chat no site" />
  ) : (
    <MessageCircle className="size-4 shrink-0 text-texto-2" aria-label="WhatsApp" />
  );

// A lista ------------------------------------------------------------------------------------------------------------

function Lista({
  euId,
  aberta,
  aoAbrir,
  versao,
}: {
  euId: string;
  aberta: string | null;
  aoAbrir: (id: string) => void;
  versao: number;
}) {
  const [aba, setAba] = useState("esperando");
  const [canalId, setCanalId] = useState("");
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [canais, setCanais] = useState<Canal[]>([]);
  const [visoes, setVisoes] = useState<VisaoDeConversas[]>([]);
  const [visao, setVisao] = useState<VisaoDeConversas | null>(null);
  const [conversas, setConversas] = useState<ResumoDaConversa[] | null>(null);
  const nomes = Object.fromEntries(usePessoas().map((p) => [p.id, p.nome]));

  const filtro = useMemo<FiltroDeConversas>(() => {
    if (visao) return visao.filtro;
    const base = ABAS.find((a) => a.id === aba)?.filtro(euId) ?? {};
    return { ...base, ...(canalId ? { canalId } : {}), ...(busca.length >= 2 ? { texto: busca } : {}) };
  }, [aba, canalId, busca, euId, visao]);

  const carregar = useCallback(async () => {
    const r = await pedir<{ conversas: ResumoDaConversa[] }>(
      "GET",
      `/conversas-com-contatos${query(filtro)}`,
    );
    setConversas(r.ok ? (r.dados?.conversas ?? []) : []);
  }, [filtro]);
  useEffect(() => {
    void carregar();
  }, [carregar, versao]);
  useEffect(() => {
    void pedir<{ canais: Canal[] }>("GET", "/canais").then((r) =>
      setCanais(r.ok ? (r.dados?.canais ?? []) : []),
    );
    void pedir<{ visoes: VisaoDeConversas[] }>("GET", "/conversas-visoes").then((r) =>
      setVisoes(r.dados?.visoes ?? []),
    );
  }, []);

  async function salvarVisao() {
    const nome = prompt("Nome da visão (ex.: Comercial sem dono)");
    if (!nome?.trim()) return;
    const r = await pedir<VisaoDeConversas>("POST", "/conversas-visoes", { nome: nome.trim(), filtro });
    if (r.ok && r.dados)
      setVisoes((v) => [...v.filter((x) => x.id !== r.dados?.id), r.dados as VisaoDeConversas]);
  }
  async function apagarVisao(v: VisaoDeConversas) {
    if (!confirm(`Apagar a visão "${v.nome}"?`)) return;
    await pedir("DELETE", `/conversas-visoes/${v.id}`);
    setVisoes((l) => l.filter((x) => x.id !== v.id));
    if (visao?.id === v.id) setVisao(null);
  }

  return (
    <section className="grid content-start gap-3" aria-label="Lista de conversas">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setVisao(null);
          setBusca(texto.trim());
        }}
      >
        <label className="sr-only" htmlFor="busca-conversas">
          Buscar conversas
        </label>
        <input
          id="busca-conversas"
          className="h-10 min-w-0 flex-1 rounded-md border border-linha bg-cartao px-3 text-sm"
          placeholder="Nome, telefone ou texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button type="submit" variant="contorno" size="icone" aria-label="Buscar">
          <Search />
        </Button>
      </form>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtros">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={!visao && aba === a.id}
            onClick={() => {
              setVisao(null);
              setAba(a.id);
            }}
            className={cn(
              "shrink-0 rounded-full border border-linha px-3 py-1 text-sm",
              !visao && aba === a.id ? "bg-tinta text-sobre-tinta" : "text-texto-2",
            )}
          >
            {a.nome}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canais.length > 0 && (
          <select
            aria-label="Canal"
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value={canalId}
            onChange={(e) => {
              setVisao(null);
              setCanalId(e.target.value);
            }}
          >
            <option value="">Todos os canais</option>
            {canais.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
        <Button size="pequeno" variant="fantasma" onClick={() => void salvarVisao()}>
          Salvar visão
        </Button>
        {visoes.map((v) => (
          <span key={v.id} className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVisao(v)}
              className={cn(
                "rounded-full border border-linha px-3 py-1 text-sm",
                visao?.id === v.id && "bg-tinta text-sobre-tinta",
              )}
            >
              {v.nome}
            </button>
            <button
              type="button"
              className="text-xs text-texto-2"
              aria-label={`Apagar a visão ${v.nome}`}
              onClick={() => void apagarVisao(v)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {conversas === null && <p className="text-sm text-texto-2">Carregando...</p>}
      {conversas?.length === 0 && <p className="text-sm text-texto-2">Nenhuma conversa aqui.</p>}
      <ul className="grid gap-2">
        {conversas?.map(({ conversa: c, ultimaMensagem: u }) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => aoAbrir(c.id)}
              aria-current={aberta === c.id ? "true" : undefined}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg border border-linha bg-cartao p-3 text-left text-sm hover:bg-suave",
                aberta === c.id && "ring-2 ring-tinta",
                c.canal.situacao === "desconectado" && "border-perigo/50",
              )}
            >
              <IconeDoCanal provedor={c.canal.provedor} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.contatoNome}</span>
                  <span className="shrink-0 text-xs text-texto-2">
                    {quando(c.ultimaMensagemEm ?? c.abertaEm)}
                  </span>
                </span>
                <span className="truncate text-texto-2">
                  {u
                    ? `${u.autor === "contato" ? "" : "Você: "}${u.trecho ?? SEM_TEXTO[u.tipo]}`
                    : "Sem mensagens"}
                </span>
                <span className="flex flex-wrap gap-2 text-xs text-texto-2">
                  <span className={cn(c.situacao === "esperando_equipe" && "font-medium text-alerta")}>
                    {NOMES_DAS_SITUACOES[c.situacao]}
                  </span>
                  <span>
                    {c.comAgente ? "com o agente" : c.donoId ? (nomes[c.donoId] ?? "com alguém") : "sem dono"}
                  </span>
                  <span>{c.canal.nome}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A conversa aberta ---------------------------------------------------------------------------------------------------

interface ConversaCompleta {
  conversa: ConversaComContato;
  mensagens: MensagemDaConversa[];
  anterior: ConversaComContato | null;
  pode: { responder: boolean; editar: boolean };
  canalTemAgente: boolean;
}

function Bolha({
  m,
  conversaId,
  nomes,
  aoTentar,
}: {
  m: MensagemDaConversa;
  conversaId: string;
  nomes: Record<string, string>;
  aoTentar: (id: string) => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const disponivel = m.arquivo?.situacao === "disponivel";
  useEffect(() => {
    if (!disponivel || !m.arquivo) return;
    void pedir<{ url: string }>("GET", `/conversas-com-contatos/${conversaId}/arquivos/${m.arquivo.id}`).then(
      (r) => setLink(r.dados?.url ?? null),
    );
  }, [disponivel, m.arquivo, conversaId]);
  const quem =
    m.direcao === "interna"
      ? `Nota de ${m.autorPessoaId ? (nomes[m.autorPessoaId] ?? "alguém da equipe") : "alguém da equipe"}`
      : m.autor === "contato"
        ? "Contato"
        : m.autor === "agente"
          ? "Agente"
          : m.peloCelular
            ? "Pelo celular"
            : m.autorPessoaId
              ? (nomes[m.autorPessoaId] ?? "Equipe")
              : "Equipe";
  return (
    <li
      className={cn(
        "grid max-w-[85%] gap-1 rounded-lg p-2 text-sm",
        m.direcao === "chegou" && "justify-self-start bg-suave",
        m.direcao === "saiu" && "justify-self-end border border-linha bg-cartao",
        m.direcao === "interna" &&
          "justify-self-stretch max-w-full border border-dashed border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100",
      )}
    >
      <span className="text-xs opacity-75">
        {quem} · {quando(m.enviadaEm)}
        {m.direcao === "interna" ? " · Só a equipe vê" : ""}
      </span>
      {m.tipo === "foto" && link && <img src={link} alt="Foto da mensagem" className="max-h-64 rounded" />}
      {m.arquivo && m.tipo !== "foto" && disponivel && link && (
        <a className="underline" href={link} target="_blank" rel="noreferrer">
          {m.arquivo.nome}
        </a>
      )}
      {m.arquivo && !disponivel && (
        <span className="text-xs italic">{ARQUIVO[m.arquivo.situacao] ?? ""}</span>
      )}
      {/* O texto do contato é só texto: nunca vira HTML. */}
      {(m.texto || !m.arquivo) && (
        <span className="whitespace-pre-wrap break-words">{m.texto ?? SEM_TEXTO[m.tipo]}</span>
      )}
      {m.entrega && (
        <span
          className={cn(
            "text-xs opacity-75",
            m.entrega === "falhou" && "font-medium text-perigo opacity-100",
          )}
        >
          {ENTREGAS[m.entrega]}
          {m.motivoDaFalha ? `: ${m.motivoDaFalha}` : ""}
          {m.entrega === "falhou" && !m.peloCelular && (
            <button type="button" className="ml-2 underline" onClick={() => aoTentar(m.id)}>
              Tentar de novo
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** A ficha resumida do contato e as tarefas dele (quem não vê os contatos vê só o nome). */
function Ficha({ contatoId, nome }: { contatoId: string; nome: string }) {
  const [ficha, setFicha] = useState<{
    contato?: { identificadores: { tipo: string; valor: string }[]; observacoes: string | null };
    tarefas: Tarefa[];
  } | null>(null);
  useEffect(() => {
    void pedir<NonNullable<typeof ficha>>("GET", `/contatos/${contatoId}`).then((r) =>
      setFicha(r.ok ? (r.dados ?? null) : null),
    );
  }, [contatoId]);
  return (
    <Card className="gap-2">
      <CardTitulo className="text-base">
        <a className="underline" href={`/contatos/${contatoId}`}>
          {nome}
        </a>
      </CardTitulo>
      {ficha?.contato?.identificadores.slice(0, 4).map((i) => (
        <span key={`${i.tipo}-${i.valor}`} className="text-sm text-texto-2">
          {i.valor}
        </span>
      ))}
      {ficha?.contato?.observacoes && (
        <p className="whitespace-pre-wrap text-sm">{ficha.contato.observacoes.slice(0, 400)}</p>
      )}
      {ficha && ficha.tarefas.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-texto-2">Tarefas</span>
          {ficha.tarefas.slice(0, 5).map((t) => (
            <a key={t.id} href={`/tarefas/${t.id}`} className="truncate text-sm underline">
              {t.titulo}
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

function Escrever({
  dados,
  respostas,
  pessoas,
  aoMandar,
}: {
  dados: ConversaCompleta;
  respostas: RespostaPronta[];
  pessoas: { id: string; nome: string }[];
  aoMandar: (m?: Mensagem) => void;
}) {
  const id = dados.conversa.id;
  const [modo, setModo] = useState<"responder" | "nota">("responder");
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [mencoes, setMencoes] = useState<string[]>([]);
  const [emojis, setEmojis] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const ultimoAvisoDeDigitando = useRef(0);
  const resolvida = dados.conversa.situacao === "resolvida";
  const sugestoes =
    modo === "responder" && texto.startsWith("/")
      ? respostas.filter((r) => r.nome.startsWith(texto.slice(1).toLowerCase())).slice(0, 6)
      : [];

  function digitar(v: string) {
    setTexto(v);
    const agora = Date.now();
    if (modo === "responder" && agora - ultimoAvisoDeDigitando.current > 5000) {
      ultimoAvisoDeDigitando.current = agora;
      void pedir("POST", `/conversas-com-contatos/${id}/digitando`);
    }
  }

  async function mandar() {
    if (!texto.trim() && !arquivo) return;
    setEnviando(true);
    let r: { ok: boolean; mensagem?: string };
    if (modo === "nota") {
      r = await pedir("POST", `/conversas-com-contatos/${id}/notas`, { texto: texto.trim(), mencoes });
    } else {
      if (arquivo && arquivo.size > 25 * 1024 * 1024) {
        setEnviando(false);
        return aoMandar({ tipo: "erro", texto: "O arquivo precisa ter até 25 MB." });
      }
      const corpo = {
        ...(texto.trim() ? { texto: texto.trim() } : {}),
        ...(arquivo
          ? {
              arquivo: {
                nome: arquivo.name,
                tipo: arquivo.type || "application/octet-stream",
                base64: await emBase64(arquivo),
              },
            }
          : {}),
      };
      r = await pedir("POST", `/conversas-com-contatos/${id}/mensagens`, corpo);
    }
    setEnviando(false);
    if (!r.ok) return aoMandar({ tipo: "erro", texto: r.mensagem ?? "" });
    setTexto("");
    setArquivo(null);
    setMencoes([]);
    aoMandar();
  }

  if (resolvida) return <p className="text-sm text-texto-2">Conversa resolvida. Reabra para responder.</p>;
  return (
    <div className="grid gap-2 border-t border-linha pt-3">
      <div className="flex gap-2" role="tablist" aria-label="Responder ou nota">
        <button
          type="button"
          role="tab"
          aria-selected={modo === "responder"}
          className={cn(
            "rounded-full border border-linha px-3 py-1 text-sm",
            modo === "responder" && "bg-tinta text-sobre-tinta",
          )}
          onClick={() => setModo("responder")}
        >
          Responder
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={modo === "nota"}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 px-3 py-1 text-sm",
            modo === "nota" && "bg-amber-100 text-amber-950",
          )}
          onClick={() => setModo("nota")}
        >
          <StickyNote className="size-3.5" /> Nota interna
        </button>
      </div>
      {sugestoes.length > 0 && (
        <ul
          className="grid gap-1 rounded-md border border-linha bg-cartao p-1"
          aria-label="Respostas prontas"
        >
          {sugestoes.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-suave"
                onClick={() => setTexto(s.texto)}
              >
                <span className="font-medium">/{s.nome}</span>{" "}
                <span className="text-texto-2">{s.texto.slice(0, 60)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor={`texto-${id}`}>
        {modo === "nota" ? "Nota interna (só a equipe vê)" : "Mensagem para o contato"}
      </label>
      <textarea
        id={`texto-${id}`}
        rows={3}
        className={cn(
          "w-full rounded-md border bg-cartao p-2 text-sm",
          modo === "nota"
            ? "border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/30"
            : "border-linha",
        )}
        placeholder={
          modo === "nota" ? "Só a equipe vê esta nota" : 'Escreva a resposta ("/" para as respostas prontas)'
        }
        value={texto}
        onChange={(e) => digitar(e.target.value)}
        maxLength={4096}
      />
      {modo === "nota" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Chamar alguém na nota"
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value=""
            onChange={(e) => e.target.value && setMencoes((m) => [...new Set([...m, e.target.value])])}
          >
            <option value="">@ Chamar alguém</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          {mencoes.map((m) => (
            <button
              key={m}
              type="button"
              className="rounded-full bg-suave px-2 py-0.5 text-xs"
              onClick={() => setMencoes((l) => l.filter((x) => x !== m))}
            >
              @{pessoas.find((p) => p.id === m)?.nome ?? "pessoa"} ×
            </button>
          ))}
        </div>
      )}
      {modo === "responder" && emojis && (
        <div className="flex flex-wrap gap-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="rounded px-1 text-lg hover:bg-suave"
              onClick={() => setTexto((t) => `${t}${e}`)}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {modo === "responder" && (
          <>
            <Button
              type="button"
              variant="fantasma"
              size="icone"
              aria-label="Emojis"
              onClick={() => setEmojis(!emojis)}
            >
              <Smile />
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-texto-2">
              <Paperclip className="size-4" />
              <span>{arquivo ? arquivo.name : "Foto ou documento"}</span>
              <input
                type="file"
                className="sr-only"
                accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
          </>
        )}
        <Button
          className="ml-auto"
          disabled={enviando || (!texto.trim() && !arquivo)}
          onClick={() => void mandar()}
        >
          <Send /> {modo === "nota" ? "Salvar nota" : "Enviar"}
        </Button>
      </div>
    </div>
  );
}

function ConversaAberta({
  id,
  euId,
  versao,
  digitando,
  respostas,
  aoVoltar,
}: {
  id: string;
  euId: string;
  versao: number;
  digitando: Record<string, number>;
  respostas: RespostaPronta[];
  aoVoltar: () => void;
}) {
  const [dados, setDados] = useState<ConversaCompleta | null | undefined>(undefined);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [verFicha, setVerFicha] = useState(false);
  const [passarPara, setPassarPara] = useState("");
  const [tarefa, setTarefa] = useState<string | null>(null);
  const pessoas = usePessoas();
  const nomes = Object.fromEntries(pessoas.map((p) => [p.id, p.nome]));
  const fim = useRef<HTMLLIElement | null>(null);

  const carregar = useCallback(async () => {
    const r = await pedir<ConversaCompleta>("GET", `/conversas-com-contatos/${id}`);
    setDados(r.ok ? (r.dados ?? null) : null);
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar, versao]);
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [dados?.mensagens.length]);

  async function agir(caminho: string, corpo?: unknown, ok?: string) {
    const r = await pedir("POST", `/conversas-com-contatos/${id}/${caminho}`, corpo);
    setMensagem(r.ok ? (ok ? { tipo: "ok", texto: ok } : null) : { tipo: "erro", texto: r.mensagem ?? "" });
    void carregar();
  }
  async function criarTarefa() {
    if (!dados || !tarefa?.trim()) return;
    const c = dados.conversa;
    const r = await pedir<{ id: string }>("POST", "/tarefas", {
      titulo: tarefa.trim(),
      descricao: `Da conversa com ${c.contatoNome} (${c.canal.nome}): ${window.location.origin}/conversas/${c.id}`,
    });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    await pedir("POST", `/tarefas/${r.dados.id}/contatos`, { contatos: [c.contatoId] });
    setTarefa(null);
    setMensagem({ tipo: "ok", texto: "Tarefa criada e ligada ao contato." });
  }

  if (dados === undefined) return <p className="text-sm text-texto-2">Carregando...</p>;
  if (!dados) return <p className="text-sm text-texto-2">Conversa não encontrada.</p>;
  const c = dados.conversa;
  const quemDigita = Object.entries(digitando)
    .filter(([chave, ate]) => chave.startsWith(`${id}:`) && ate > Date.now())
    .map(([chave]) => nomes[chave.split(":")[1] ?? ""] ?? "Alguém");
  const resolvida = c.situacao === "resolvida";

  return (
    <section className="grid content-start gap-3" aria-label="Conversa aberta">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-texto-2 md:hidden"
            onClick={aoVoltar}
          >
            <ArrowLeft className="size-4" /> Conversas
          </button>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <IconeDoCanal provedor={c.canal.provedor} />
            {c.contatoNome}
          </h1>
          <p className="text-sm text-texto-2">
            {NOMES_DAS_SITUACOES[c.situacao]} · {c.canal.nome} ·{" "}
            {c.comAgente
              ? "com o agente"
              : c.donoId
                ? c.donoId === euId
                  ? "com você"
                  : (nomes[c.donoId] ?? "com alguém")
                : "sem dono"}
            {!c.contatoIdentificado ? " · contato não identificado" : ""}
          </p>
          {c.maisDeUmContato && (
            <p className="text-sm text-alerta">Este número está em mais de um contato.</p>
          )}
          {c.canal.situacao === "desconectado" && (
            <p className="text-sm text-perigo">O número deste canal está desconectado.</p>
          )}
        </div>
        <Button
          variant="contorno"
          size="pequeno"
          className="lg:hidden"
          onClick={() => setVerFicha(!verFicha)}
        >
          <UserRound /> Ficha
        </Button>
      </div>

      {dados.pode.editar && (
        <div className="flex flex-wrap gap-2">
          {!resolvida && c.donoId !== euId && (
            <Button size="pequeno" onClick={() => void agir("assumir", undefined, "Conversa com você.")}>
              Assumir
            </Button>
          )}
          {!resolvida && (
            <span className="inline-flex items-center gap-1">
              <select
                aria-label="Passar para"
                className="h-8 rounded-md border border-linha bg-cartao px-2 text-sm"
                value={passarPara}
                onChange={(e) => setPassarPara(e.target.value)}
              >
                <option value="">Passar para...</option>
                {pessoas
                  .filter((p) => p.id !== c.donoId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
              </select>
              {passarPara && (
                <Button
                  size="pequeno"
                  variant="contorno"
                  onClick={() =>
                    void agir("passar", { pessoaId: passarPara }, "Conversa passada.").then(() =>
                      setPassarPara(""),
                    )
                  }
                >
                  Passar
                </Button>
              )}
            </span>
          )}
          {!resolvida && dados.canalTemAgente && !c.comAgente && (
            <Button
              size="pequeno"
              variant="contorno"
              onClick={() => void agir("devolver", undefined, "Conversa com o agente.")}
            >
              Devolver ao agente
            </Button>
          )}
          {resolvida ? (
            <Button
              size="pequeno"
              variant="contorno"
              onClick={() => void agir("reabrir", undefined, "Conversa reaberta.")}
            >
              Reabrir
            </Button>
          ) : (
            <Button
              size="pequeno"
              variant="contorno"
              onClick={() => void agir("resolver", undefined, "Conversa resolvida.")}
            >
              Resolver
            </Button>
          )}
          <Button size="pequeno" variant="fantasma" onClick={() => setTarefa(tarefa === null ? "" : null)}>
            Criar tarefa
          </Button>
        </div>
      )}
      {tarefa !== null && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void criarTarefa();
          }}
        >
          <label className="sr-only" htmlFor={`tarefa-${id}`}>
            Título da tarefa
          </label>
          <input
            id={`tarefa-${id}`}
            className="h-9 min-w-0 flex-1 rounded-md border border-linha bg-cartao px-2 text-sm"
            placeholder="O que precisa ser feito"
            value={tarefa}
            onChange={(e) => setTarefa(e.target.value)}
            maxLength={200}
          />
          <Button size="pequeno" type="submit" disabled={!tarefa.trim()}>
            Criar
          </Button>
        </form>
      )}
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}

      <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
        <div className="grid content-start gap-3">
          {dados.anterior && (
            <a className="text-sm text-texto-2 underline" href={`/conversas/${dados.anterior.id}`}>
              Conversa anterior ({quando(dados.anterior.abertaEm)}, resolvida)
            </a>
          )}
          <ol className="grid gap-2" aria-label="Mensagens">
            {dados.mensagens.map((m) => (
              <Bolha
                key={m.id}
                m={m}
                conversaId={id}
                nomes={nomes}
                aoTentar={(mid) => void agir(`mensagens/${mid}/tentar`, undefined, "Mandando de novo.")}
              />
            ))}
            <li ref={fim} aria-hidden="true" />
          </ol>
          {quemDigita.length > 0 && (
            <p className="text-sm italic text-texto-2" role="status">
              {quemDigita.join(", ")} {quemDigita.length > 1 ? "estão" : "está"} respondendo...
            </p>
          )}
          {dados.pode.responder && (
            <Escrever
              dados={dados}
              respostas={respostas}
              pessoas={pessoas}
              aoMandar={(m) => {
                setMensagem(m ?? null);
                void carregar();
              }}
            />
          )}
        </div>
        <div className={cn("lg:block", verFicha ? "block" : "hidden")}>
          <Ficha contatoId={c.contatoId} nome={c.contatoNome} />
        </div>
      </div>
    </section>
  );
}

// Respostas prontas -----------------------------------------------------------------------------------------------

function CuidarDasRespostas({ respostas, aoMudar }: { respostas: RespostaPronta[]; aoMudar: () => void }) {
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  async function criar() {
    const r = await pedir("POST", "/respostas-prontas", {
      nome: nome.trim().toLowerCase(),
      texto: texto.trim(),
    });
    if (!r.ok) return setErro(r.mensagem ?? "");
    setNome("");
    setTexto("");
    setErro(null);
    aoMudar();
  }
  async function apagar(r: RespostaPronta) {
    if (!confirm(`Apagar a resposta /${r.nome}?`)) return;
    await pedir("DELETE", `/respostas-prontas/${r.id}`);
    aoMudar();
  }
  return (
    <details className="rounded-lg border border-linha bg-cartao p-3 text-sm">
      <summary className="cursor-pointer font-medium">Respostas prontas</summary>
      <ul className="mt-2 grid gap-1">
        {respostas.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-2">
            <span>
              <span className="font-medium">/{r.nome}</span>{" "}
              <span className="text-texto-2">{r.texto.slice(0, 80)}</span>
            </span>
            <button type="button" className="text-xs text-perigo" onClick={() => void apagar(r)}>
              Apagar
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
      >
        <label className="grid gap-1">
          <span className="text-xs text-texto-2">Atalho (sem a barra)</span>
          <input
            className="h-9 rounded-md border border-linha bg-cartao px-2"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={40}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-texto-2">Texto</span>
          <textarea
            className="rounded-md border border-linha bg-cartao p-2"
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={4096}
          />
        </label>
        {erro && <Aviso tipo="erro" texto={erro} />}
        <Button size="pequeno" type="submit" disabled={!nome.trim() || !texto.trim()}>
          Criar resposta pronta
        </Button>
      </form>
    </details>
  );
}

export function CaixaDeConversas({
  euId,
  conversaInicial,
}: {
  euId: string;
  conversaInicial: string | null;
}) {
  const [aberta, setAberta] = useState<string | null>(conversaInicial);
  const [versao, setVersao] = useState(0);
  const [digitando, setDigitando] = useState<Record<string, number>>({});
  const [respostas, setRespostas] = useState<RespostaPronta[]>([]);
  const [podeCuidar, setPodeCuidar] = useState(false);

  const carregarRespostas = useCallback(async () => {
    const r = await pedir<{ respostas: RespostaPronta[]; podeCuidar: boolean }>("GET", "/respostas-prontas");
    setRespostas(r.dados?.respostas ?? []);
    setPodeCuidar(r.dados?.podeCuidar ?? false);
  }, []);
  useEffect(() => {
    void carregarRespostas();
  }, [carregarRespostas]);

  // Tempo real: a conversa mudou (busca de novo pela rota, que confere a permissão) e "fulano está respondendo".
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  useTempoReal((aviso) => {
    if (aviso.tipo === "digitando") {
      const chave = `${aviso.id}:${aviso.pessoaId}`;
      setDigitando((d) => ({ ...d, [chave]: Date.now() + 8000 }));
      setTimeout(() => setDigitando((d) => ({ ...d })), 8100);
      return;
    }
    if (aviso.tipo === "conversa" || aviso.tipo === "reconectou") {
      if (espera.current) clearTimeout(espera.current);
      espera.current = setTimeout(() => setVersao((v) => v + 1), 300);
    }
  });

  function abrir(id: string | null) {
    setAberta(id);
    history.pushState(null, "", id ? `/conversas/${id}` : "/conversas");
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-5 md:grid-cols-[22rem_1fr] md:py-8">
      <div className={cn("grid content-start gap-3", aberta && "hidden md:grid")}>
        <h1 className="text-2xl font-bold tracking-tight">Conversas</h1>
        <Lista euId={euId} aberta={aberta} aoAbrir={(id) => abrir(id)} versao={versao} />
        {podeCuidar && <CuidarDasRespostas respostas={respostas} aoMudar={() => void carregarRespostas()} />}
      </div>
      <div className={cn(!aberta && "hidden md:block")}>
        {aberta ? (
          <ConversaAberta
            key={aberta}
            id={aberta}
            euId={euId}
            versao={versao}
            digitando={digitando}
            respostas={respostas}
            aoVoltar={() => abrir(null)}
          />
        ) : (
          <p className="text-sm text-texto-2">Escolha uma conversa na lista.</p>
        )}
      </div>
    </main>
  );
}

/** O número de conversas esperando a equipe, para o menu (atualiza com o tempo real). Não mostra nada. */
export function ContarConversas({ aoContar }: { aoContar: (n: number) => void }) {
  const contar = useCallback(async () => {
    const r = await pedir<{ esperandoEquipe: number }>("GET", "/conversas-com-contatos-contador");
    aoContar(r.dados?.esperandoEquipe ?? 0);
  }, [aoContar]);
  useEffect(() => {
    void contar();
  }, [contar]);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  useTempoReal((aviso) => {
    if (aviso.tipo !== "conversa" && aviso.tipo !== "reconectou") return;
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(() => void contar(), 1000);
  });
  return null;
}
