/**
 * A linha do tempo das conversas na ficha do contato (M8-01, decisão 0051, item 4): as conversas de todos os canais,
 * da mais nova para a mais antiga, que a pessoa pode ver. Tocar numa conversa mostra as mensagens ali mesmo; a caixa
 * única (M8-04) passa a abrir a conversa inteira. Quem não vê as conversas não vê a seção.
 */
import type {
  ConversaComContato,
  MensagemDaConversa,
  ResumoDaConversa,
  SituacaoDeConversa,
} from "@mago-os/contratos";
import { ChevronDown, ChevronRight, Globe, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";

const NOMES_DAS_SITUACOES: Record<SituacaoDeConversa, string> = {
  aberta: "Aberta",
  esperando_cliente: "Esperando o cliente",
  esperando_equipe: "Esperando a equipe",
  resolvida: "Resolvida",
};

const QUEM: Record<MensagemDaConversa["autor"], string> = {
  contato: "Contato",
  agente: "Agente",
  pessoa: "Equipe",
  sistema: "Sistema",
};

/** O que aparece no lugar do texto nas mensagens sem texto. */
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

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

function IconeDoCanal({ provedor }: { provedor: ConversaComContato["canal"]["provedor"] }) {
  return provedor === "site" ? (
    <Globe className="size-4 shrink-0 text-texto-2" aria-label="Chat no site" />
  ) : (
    <MessageCircle className="size-4 shrink-0 text-texto-2" aria-label="WhatsApp" />
  );
}

function Mensagens({ conversaId }: { conversaId: string }) {
  const [mensagens, setMensagens] = useState<MensagemDaConversa[] | null>(null);
  useEffect(() => {
    void pedir<{ mensagens: MensagemDaConversa[] }>("GET", `/conversas-com-contatos/${conversaId}`).then(
      (r) => setMensagens(r.ok ? (r.dados?.mensagens ?? []) : []),
    );
  }, [conversaId]);
  if (mensagens === null) return <p className="text-sm text-texto-2">Carregando...</p>;
  if (mensagens.length === 0) return <p className="text-sm text-texto-2">Nenhuma mensagem.</p>;
  return (
    <ol className="grid gap-2">
      {mensagens.map((m) => (
        <li
          key={m.id}
          className={cn(
            "grid gap-0.5 rounded-lg p-2 text-sm",
            m.direcao === "chegou" && "mr-8 bg-suave",
            m.direcao === "saiu" && "ml-8 border border-linha",
            m.direcao === "interna" &&
              "border border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/30",
          )}
        >
          <span className="text-xs text-texto-2">
            {m.direcao === "interna" ? "Nota interna" : QUEM[m.autor]}
            {m.peloCelular ? " pelo celular" : ""} · {quando(m.enviadaEm)}
          </span>
          {/* O texto do contato é só texto: nunca vira link nem marcação. */}
          <span className="whitespace-pre-wrap break-words">{m.texto ?? SEM_TEXTO[m.tipo]}</span>
        </li>
      ))}
    </ol>
  );
}

export function ConversasDoContato({ contatoId }: { contatoId: string }) {
  const [dados, setDados] = useState<{ identificado: boolean; conversas: ResumoDaConversa[] } | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  useEffect(() => {
    void pedir<{ identificado: boolean; conversas: ResumoDaConversa[] }>(
      "GET",
      `/contatos/${contatoId}/conversas`,
    ).then((r) => setDados(r.ok ? (r.dados ?? null) : null));
  }, [contatoId]);
  if (!dados) return null;
  return (
    <section className="grid gap-2" aria-label="Conversas do contato">
      <h2 className="text-lg font-semibold">Conversas</h2>
      {!dados.identificado && (
        <p className="text-sm text-texto-2">
          Contato criado por uma conversa e ainda não identificado. Edite o nome para confirmar quem é.
        </p>
      )}
      {dados.conversas.length === 0 && <p className="text-sm text-texto-2">Nenhuma conversa ainda.</p>}
      <ul className="grid gap-2">
        {dados.conversas.map(({ conversa: c, ultimaMensagem: u }) => {
          const expandida = aberta === c.id;
          return (
            <li key={c.id} className="rounded-lg border border-linha bg-cartao">
              <button
                type="button"
                className="flex w-full items-start gap-2 p-3 text-left text-sm hover:bg-suave"
                aria-expanded={expandida}
                onClick={() => setAberta(expandida ? null : c.id)}
              >
                <IconeDoCanal provedor={c.canal.provedor} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium">{c.canal.nome}</span>
                    <span className="text-xs text-texto-2">{quando(c.abertaEm)}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs",
                        c.situacao === "esperando_equipe"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-suave text-texto-2",
                      )}
                    >
                      {NOMES_DAS_SITUACOES[c.situacao]}
                    </span>
                  </span>
                  {u && (
                    <span className="truncate text-texto-2">
                      {QUEM[u.autor]}: {u.trecho ?? SEM_TEXTO[u.tipo]}
                    </span>
                  )}
                </span>
                {expandida ? (
                  <ChevronDown className="size-4 shrink-0 text-texto-2" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-texto-2" />
                )}
              </button>
              {expandida && (
                <div className="border-t border-linha p-3">
                  <Mensagens conversaId={c.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
