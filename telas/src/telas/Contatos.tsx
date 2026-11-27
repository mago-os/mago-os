/**
 * Contatos (M7-01, decisão 0045): a lista (busca, filtros por tipo, papel, etiqueta e responsável, visões salvas), a
 * ficha (identificadores, organizações, pessoas ligadas, tarefas), cadastrar e editar com o aviso de repetido, juntar,
 * arquivar e apagar (com o segundo fator), e os contatos ligados a uma tarefa ou a um projeto.
 */
import {
  type Contato,
  type Etiqueta,
  type FiltroDeContatos,
  type Identificador,
  NOMES_DOS_PAPEIS,
  PAPEIS_DE_CONTATO,
  type PapelDeContato,
  REDES,
  type Rede,
  type ResumoDoContato,
  type Tarefa,
  type TipoDeContato,
  type VisaoDeContatos,
} from "@mago-os/contratos";
import { ArrowLeft, Building2, Plus, Trash2, TriangleAlert, User, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { listarEtiquetas, pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { ConfirmarSegundoFator } from "./DoisFatores";
import { Etiqueta as EtiquetaDeStatus, Filtro, usePessoas } from "./Tarefas";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;
interface AvisoDeRepetido {
  identificador: Identificador;
  contatoId: string | null;
  nome: string | null;
}

const NOMES_DAS_REDES: Record<Rede, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
  site: "Site",
  outra: "Outra rede",
};

/** O telefone no formato internacional: com +, fica; sem, um número brasileiro (10 ou 11 dígitos) ganha o +55. */
export function telefoneInternacional(texto: string): string {
  const t = texto.trim();
  const digitos = t.replace(/\D/g, "");
  if (t.startsWith("+")) return `+${digitos}`;
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) return `+${digitos}`;
  return `+${digitos}`;
}

/** +5511987654321 → +55 11 98765-4321 (os de fora do Brasil ficam como estão). */
export function telefoneParaLer(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : e164;
}

function textoDoIdentificador(i: Identificador): string {
  if (i.tipo === "telefone") return telefoneParaLer(i.valor);
  if (i.tipo === "rede") return `${NOMES_DAS_REDES[i.rede]}: ${i.valor}`;
  return i.valor;
}

function Papeis({ papeis }: { papeis: PapelDeContato[] }) {
  return (
    <>
      {papeis.map((p) => (
        <span key={p} className="rounded-full bg-suave px-2 py-0.5 text-xs text-texto-2">
          {NOMES_DOS_PAPEIS[p]}
        </span>
      ))}
    </>
  );
}

function IconeDoTipo({ tipo }: { tipo: TipoDeContato }) {
  return tipo === "organizacao" ? (
    <Building2 className="size-4 shrink-0 text-texto-2" aria-label="Organização" />
  ) : (
    <User className="size-4 shrink-0 text-texto-2" aria-label="Pessoa" />
  );
}

function queryDoFiltro(f: FiltroDeContatos): string {
  const q = new URLSearchParams();
  if (f.tipo) q.set("tipo", f.tipo);
  if (f.papeis?.length) q.set("papeis", f.papeis.join(","));
  if (f.etiquetas?.length) q.set("etiquetas", f.etiquetas.join(","));
  if (f.responsaveis?.length) q.set("responsaveis", f.responsaveis.join(","));
  if (f.organizacaoId) q.set("organizacao", f.organizacaoId);
  if (f.situacao) q.set("situacao", f.situacao);
  if (f.texto && f.texto.trim().length >= 2) q.set("texto", f.texto.trim());
  if (f.repetidos) q.set("repetidos", "1");
  const s = q.toString();
  return s ? `?${s}` : "";
}

const buscarContatos = (f: FiltroDeContatos) =>
  pedir<{ contatos: ResumoDoContato[] }>("GET", `/contatos${queryDoFiltro(f)}`);

function useEtiquetas() {
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  useEffect(() => {
    void listarEtiquetas().then((r) => setEtiquetas(r.dados?.etiquetas ?? []));
  }, []);
  return etiquetas;
}

function ItemDaLista({ k, nomes }: { k: ResumoDoContato; nomes: Record<string, string> }) {
  return (
    <a
      href={`/contatos/${k.id}`}
      className={cn(
        "grid gap-1 rounded-lg border bg-cartao p-3 hover:bg-suave",
        k.repetido ? "border-alerta/60" : "border-linha",
      )}
    >
      <span className="flex flex-wrap items-center gap-2 font-medium">
        <IconeDoTipo tipo={k.tipo} />
        {k.nome}
        {k.repetido && (
          <span className="flex items-center gap-1 rounded-full bg-alerta/15 px-2 py-0.5 text-xs font-medium text-alerta">
            <TriangleAlert className="size-3.5" aria-hidden="true" /> Possível repetido
          </span>
        )}
        {k.organizacao && <span className="text-sm font-normal text-texto-2">· {k.organizacao}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
        <Papeis papeis={k.papeis} />
        {k.emailPrincipal && <span>{k.emailPrincipal}</span>}
        {k.telefonePrincipal && <span>{telefoneParaLer(k.telefonePrincipal)}</span>}
        {k.responsavelId && nomes[k.responsavelId] && <span>Com {nomes[k.responsavelId]}</span>}
      </span>
    </a>
  );
}

export function ListaDeContatos({ podeCriar }: { podeCriar: boolean }) {
  const [filtro, setFiltro] = useState<FiltroDeContatos>({});
  const [contatos, setContatos] = useState<ResumoDoContato[] | null>(null);
  const [visoes, setVisoes] = useState<VisaoDeContatos[]>([]);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const pessoas = usePessoas();
  const etiquetas = useEtiquetas();
  const nomes = Object.fromEntries(pessoas.map((p) => [p.id, p.nome]));

  const carregarVisoes = useCallback(async () => {
    const r = await pedir<{ visoes: VisaoDeContatos[] }>("GET", "/contatos-visoes");
    setVisoes(r.dados?.visoes ?? []);
  }, []);
  useEffect(() => {
    void carregarVisoes();
  }, [carregarVisoes]);
  useEffect(() => {
    const espera = setTimeout(() => {
      void buscarContatos(filtro).then((r) => setContatos(r.dados?.contatos ?? []));
    }, 250);
    return () => clearTimeout(espera);
  }, [filtro]);

  /** Muda um filtro; sem valor, o filtro sai. */
  function mudar<K extends keyof FiltroDeContatos>(chave: K, valor: FiltroDeContatos[K] | undefined) {
    const novo = { ...filtro };
    if (valor === undefined) delete novo[chave];
    else novo[chave] = valor;
    setFiltro(novo);
  }

  const alternar = <T,>(lista: T[] | undefined, x: T) => {
    const atual = lista ?? [];
    const nova = atual.includes(x) ? atual.filter((y) => y !== x) : [...atual, x];
    return nova.length > 0 ? nova : undefined;
  };

  async function salvarVisao() {
    const nome = prompt("Nome da visão (ex.: Leads da Ana)")?.trim();
    if (!nome) return;
    const { texto: _, ...semTexto } = filtro;
    const r = await pedir("POST", "/contatos-visoes", { nome, filtro: semTexto });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: "Visão salva." });
    void carregarVisoes();
  }

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Contatos</h1>
          <p className="text-sm text-texto-2">
            Pessoas e organizações de fora da empresa: clientes, leads, fornecedores e parceiros.
          </p>
        </div>
        {podeCriar && !criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Novo contato
          </Button>
        )}
      </div>
      {criando && (
        <FormularioDoContato
          aoCancelar={() => setCriando(false)}
          aoSalvar={(c) => {
            location.href = `/contatos/${c.id}`;
          }}
        />
      )}

      {visoes.length > 0 && (
        <section className="flex flex-wrap items-center gap-2" aria-label="Visões salvas">
          {visoes.map((v) => (
            <span key={v.id} className="flex items-center gap-1">
              <Filtro ativo={false} aoClicar={() => setFiltro(v.filtro)}>
                {v.nome}
              </Filtro>
              <button
                type="button"
                aria-label={`Apagar a visão ${v.nome}`}
                className="text-texto-2 hover:text-perigo"
                onClick={async () => {
                  await pedir("DELETE", `/contatos-visoes/${v.id}`);
                  void carregarVisoes();
                }}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </section>
      )}

      <div className="grid gap-3">
        <Campo
          id="busca-contatos"
          rotulo="Buscar"
          placeholder="Nome, e-mail, telefone ou rede"
          value={filtro.texto ?? ""}
          onChange={(e) => mudar("texto", e.target.value || undefined)}
        />
        <div className="flex flex-wrap gap-2">
          <Filtro
            ativo={filtro.tipo === "pessoa"}
            aoClicar={() => mudar("tipo", filtro.tipo === "pessoa" ? undefined : "pessoa")}
          >
            Pessoas
          </Filtro>
          <Filtro
            ativo={filtro.tipo === "organizacao"}
            aoClicar={() => mudar("tipo", filtro.tipo === "organizacao" ? undefined : "organizacao")}
          >
            Organizações
          </Filtro>
          {PAPEIS_DE_CONTATO.map((p) => (
            <Filtro
              key={p}
              ativo={filtro.papeis?.includes(p) ?? false}
              aoClicar={() => mudar("papeis", alternar(filtro.papeis, p))}
            >
              {NOMES_DOS_PAPEIS[p]}
            </Filtro>
          ))}
          <Filtro
            ativo={filtro.repetidos ?? false}
            aoClicar={() => mudar("repetidos", filtro.repetidos ? undefined : true)}
          >
            Possíveis repetidos
          </Filtro>
          <Filtro
            ativo={filtro.situacao === "arquivado"}
            aoClicar={() => mudar("situacao", filtro.situacao === "arquivado" ? undefined : "arquivado")}
          >
            Arquivados
          </Filtro>
        </div>
        <div className="flex flex-wrap gap-2">
          {etiquetas.length > 0 && (
            <select
              aria-label="Etiqueta"
              className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
              value={filtro.etiquetas?.[0] ?? ""}
              onChange={(e) => mudar("etiquetas", e.target.value ? [e.target.value] : undefined)}
            >
              <option value="">Todas as etiquetas</option>
              {etiquetas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Responsável"
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm"
            value={filtro.responsaveis?.[0] ?? ""}
            onChange={(e) => mudar("responsaveis", e.target.value ? [e.target.value] : undefined)}
          >
            <option value="">Qualquer responsável</option>
            <option value="sem">Sem responsável</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <Button variant="contorno" size="pequeno" onClick={() => void salvarVisao()}>
            Salvar visão
          </Button>
        </div>
        {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      </div>

      {contatos && contatos.length === 0 && (
        <p className="text-sm text-texto-2">Nenhum contato encontrado.</p>
      )}
      <ul className="grid gap-2">
        {contatos?.map((k) => (
          <li key={k.id}>
            <ItemDaLista k={k} nomes={nomes} />
          </li>
        ))}
      </ul>
    </main>
  );
}

/** Escolher um contato pela busca (para a organização, juntar e ligar a tarefas). */
function EscolherContato({
  rotulo,
  tipo,
  semIds = [],
  aoEscolher,
}: {
  rotulo: string;
  tipo?: TipoDeContato;
  semIds?: string[];
  aoEscolher: (k: ResumoDoContato) => void;
}) {
  const [texto, setTexto] = useState("");
  const [achados, setAchados] = useState<ResumoDoContato[]>([]);
  useEffect(() => {
    if (texto.trim().length < 2) return setAchados([]);
    const espera = setTimeout(() => {
      void buscarContatos({ texto, ...(tipo ? { tipo } : {}) }).then((r) =>
        setAchados((r.dados?.contatos ?? []).filter((k) => !semIds.includes(k.id)).slice(0, 8)),
      );
    }, 250);
    return () => clearTimeout(espera);
  }, [texto, tipo, semIds]);
  return (
    <div className="grid gap-1.5">
      <Campo
        id={`escolher-${rotulo}`}
        rotulo={rotulo}
        placeholder="Digite o nome, e-mail ou telefone"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      {achados.length > 0 && (
        <ul className="grid gap-1 rounded-md border border-linha bg-cartao p-1">
          {achados.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-suave"
                onClick={() => {
                  aoEscolher(k);
                  setTexto("");
                  setAchados([]);
                }}
              >
                <IconeDoTipo tipo={k.tipo} />
                {k.nome}
                {k.organizacao && <span className="text-texto-2">· {k.organizacao}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AvisosDeRepetidos({ avisos, contatoId }: { avisos: AvisoDeRepetido[]; contatoId: string | null }) {
  if (avisos.length === 0) return null;
  return (
    <div role="status" className="grid gap-1 rounded-md border border-alerta/40 bg-alerta/10 p-3 text-sm">
      {avisos.map((a) => (
        <p key={`${textoDoIdentificador(a.identificador)}-${a.contatoId ?? "oculto"}`}>
          {textoDoIdentificador(a.identificador)} já existe em outro contato
          {a.nome ? (
            <>
              {": "}
              <a className="underline" href={`/contatos/${a.contatoId}`}>
                {a.nome}
              </a>
              {contatoId && a.contatoId && (
                <>
                  {" · "}
                  <a className="font-medium underline" href={`/contatos/${contatoId}?juntar=${a.contatoId}`}>
                    Juntar
                  </a>
                </>
              )}
            </>
          ) : (
            " (de outra pessoa da equipe)."
          )}
        </p>
      ))}
    </div>
  );
}

interface Rascunho {
  tipo: TipoDeContato;
  nome: string;
  papeis: PapelDeContato[];
  identificadores: Identificador[];
  organizacoes: { organizacaoId: string; nome: string; cargo: string }[];
  documento: string;
  responsavelId: string;
  observacoes: string;
  etiquetas: string[];
}

function rascunhoDe(c: Contato | null, nomesDasOrgs: Record<string, string>): Rascunho {
  return {
    tipo: c?.tipo ?? "pessoa",
    nome: c?.nome ?? "",
    papeis: c?.papeis.filter((p) => p !== "outro") ?? [],
    identificadores: c?.identificadores ?? [],
    organizacoes:
      c?.organizacoes.map((o) => ({
        organizacaoId: o.organizacaoId,
        nome: nomesDasOrgs[o.organizacaoId] ?? "",
        cargo: o.cargo ?? "",
      })) ?? [],
    documento: c?.documento ?? "",
    responsavelId: c?.responsavelId ?? "",
    observacoes: c?.observacoes ?? "",
    etiquetas: c?.etiquetas ?? [],
  };
}

export function FormularioDoContato({
  contato = null,
  nomesDasOrgs = {},
  aoCancelar,
  aoSalvar,
}: {
  contato?: Contato | null;
  nomesDasOrgs?: Record<string, string>;
  aoCancelar: () => void;
  aoSalvar: (c: Contato, repetidos: AvisoDeRepetido[]) => void;
}) {
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(contato, nomesDasOrgs));
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [novo, setNovo] = useState<{ tipo: Identificador["tipo"]; valor: string; rede: Rede }>({
    tipo: "email",
    valor: "",
    rede: "instagram",
  });
  const pessoas = usePessoas();
  const etiquetas = useEtiquetas();

  function acrescentar() {
    const valor = novo.valor.trim();
    if (!valor) return;
    const temPrincipal = (t: string) => r.identificadores.some((i) => i.tipo === t && i.principal);
    let i: Identificador;
    if (novo.tipo === "email")
      i = { tipo: "email", valor: valor.toLowerCase(), principal: !temPrincipal("email") };
    else if (novo.tipo === "telefone")
      i = {
        tipo: "telefone",
        valor: telefoneInternacional(valor),
        principal: !temPrincipal("telefone"),
        whatsapp: true,
        rotulo: null,
      };
    else i = { tipo: "rede", rede: novo.rede, valor, principal: false };
    setR({ ...r, identificadores: [...r.identificadores, i] });
    setNovo({ ...novo, valor: "" });
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    const doc = r.documento.replace(/\D/g, "");
    const corpo = {
      nome: r.nome.trim(),
      papeis: r.papeis,
      identificadores: r.identificadores,
      ...(r.tipo === "pessoa"
        ? {
            organizacoes: r.organizacoes.map((o) => ({
              organizacaoId: o.organizacaoId,
              cargo: o.cargo.trim() || null,
            })),
          }
        : {}),
      documento: doc || null,
      etiquetas: r.etiquetas,
      observacoes: r.observacoes.trim() || null,
      ...(r.responsavelId ? { responsavelId: r.responsavelId } : contato ? { responsavelId: null } : {}),
    };
    const resposta = contato
      ? await pedir<{ contato: Contato; repetidos: AvisoDeRepetido[] }>(
          "POST",
          `/contatos/${contato.id}`,
          corpo,
        )
      : await pedir<{ contato: Contato; repetidos: AvisoDeRepetido[] }>("POST", "/contatos", {
          tipo: r.tipo,
          ...corpo,
        });
    if (!resposta.ok || !resposta.dados)
      return setMensagem({ tipo: "erro", texto: resposta.mensagem ?? "Confira os campos e tente de novo." });
    aoSalvar(resposta.dados.contato, resposta.dados.repetidos);
  }

  return (
    <Card className="gap-4">
      <CardTitulo>{contato ? "Editar contato" : "Novo contato"}</CardTitulo>
      <form className="grid gap-4" onSubmit={(e) => void salvar(e)}>
        {!contato && (
          <div className="flex gap-2">
            <Filtro ativo={r.tipo === "pessoa"} aoClicar={() => setR({ ...r, tipo: "pessoa" })}>
              Pessoa
            </Filtro>
            <Filtro
              ativo={r.tipo === "organizacao"}
              aoClicar={() => setR({ ...r, tipo: "organizacao", organizacoes: [] })}
            >
              Organização
            </Filtro>
          </div>
        )}
        <Campo
          id="contato-nome"
          rotulo="Nome"
          required
          maxLength={200}
          value={r.nome}
          onChange={(e) => setR({ ...r, nome: e.target.value })}
        />
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Papel</legend>
          <div className="flex flex-wrap gap-2">
            {PAPEIS_DE_CONTATO.filter((p) => p !== "outro").map((p) => (
              <Filtro
                key={p}
                ativo={r.papeis.includes(p)}
                aoClicar={() =>
                  setR({
                    ...r,
                    papeis: r.papeis.includes(p) ? r.papeis.filter((x) => x !== p) : [...r.papeis, p],
                  })
                }
              >
                {NOMES_DOS_PAPEIS[p]}
              </Filtro>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">E-mails, telefones e redes</legend>
          <ul className="grid gap-1.5">
            {r.identificadores.map((i, n) => (
              <li key={`${i.tipo}-${i.valor}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1">{textoDoIdentificador(i)}</span>
                {i.tipo !== "rede" && (
                  <label className="flex items-center gap-1 text-texto-2">
                    <input
                      type="checkbox"
                      checked={i.principal}
                      onChange={() =>
                        setR({
                          ...r,
                          identificadores: r.identificadores.map((x, m) =>
                            x.tipo === i.tipo ? { ...x, principal: m === n } : x,
                          ),
                        })
                      }
                    />
                    Principal
                  </label>
                )}
                {i.tipo === "telefone" && (
                  <label className="flex items-center gap-1 text-texto-2">
                    <input
                      type="checkbox"
                      checked={i.whatsapp}
                      onChange={() =>
                        setR({
                          ...r,
                          identificadores: r.identificadores.map((x, m) =>
                            m === n && x.tipo === "telefone" ? { ...x, whatsapp: !x.whatsapp } : x,
                          ),
                        })
                      }
                    />
                    WhatsApp
                  </label>
                )}
                <button
                  type="button"
                  aria-label={`Tirar ${textoDoIdentificador(i)}`}
                  className="text-texto-2 hover:text-perigo"
                  onClick={() => setR({ ...r, identificadores: r.identificadores.filter((_, m) => m !== n) })}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <select
              aria-label="Tipo"
              className="h-11 rounded-md border border-linha bg-cartao px-2"
              value={novo.tipo}
              onChange={(e) => setNovo({ ...novo, tipo: e.target.value as Identificador["tipo"] })}
            >
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="rede">Rede ou site</option>
            </select>
            {novo.tipo === "rede" && (
              <select
                aria-label="Rede"
                className="h-11 rounded-md border border-linha bg-cartao px-2"
                value={novo.rede}
                onChange={(e) => setNovo({ ...novo, rede: e.target.value as Rede })}
              >
                {REDES.map((x) => (
                  <option key={x} value={x}>
                    {NOMES_DAS_REDES[x]}
                  </option>
                ))}
              </select>
            )}
            <input
              aria-label="E-mail, telefone ou endereço"
              className="h-11 min-w-0 flex-1 rounded-md border border-linha bg-cartao px-3"
              placeholder={novo.tipo === "telefone" ? "(11) 98765-4321 ou +351..." : ""}
              value={novo.valor}
              onChange={(e) => setNovo({ ...novo, valor: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  acrescentar();
                }
              }}
            />
            <Button type="button" variant="contorno" onClick={acrescentar}>
              Acrescentar
            </Button>
          </div>
        </fieldset>

        {r.tipo === "pessoa" && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Organizações</legend>
            <ul className="grid gap-1.5">
              {r.organizacoes.map((o, n) => (
                <li key={o.organizacaoId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Building2 className="size-4 text-texto-2" />
                  <span>{o.nome || "Organização"}</span>
                  <input
                    aria-label={`Cargo em ${o.nome}`}
                    placeholder="Cargo"
                    className="h-9 min-w-0 flex-1 rounded-md border border-linha bg-cartao px-2"
                    value={o.cargo}
                    onChange={(e) =>
                      setR({
                        ...r,
                        organizacoes: r.organizacoes.map((x, m) =>
                          m === n ? { ...x, cargo: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Tirar ${o.nome}`}
                    className="text-texto-2 hover:text-perigo"
                    onClick={() => setR({ ...r, organizacoes: r.organizacoes.filter((_, m) => m !== n) })}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <EscolherContato
              rotulo="Ligar a uma organização"
              tipo="organizacao"
              semIds={r.organizacoes.map((o) => o.organizacaoId)}
              aoEscolher={(k) =>
                setR({
                  ...r,
                  organizacoes: [...r.organizacoes, { organizacaoId: k.id, nome: k.nome, cargo: "" }],
                })
              }
            />
          </fieldset>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor="contato-responsavel" className="text-sm font-medium">
              Responsável
            </label>
            <select
              id="contato-responsavel"
              className="h-11 rounded-md border border-linha bg-cartao px-2"
              value={r.responsavelId}
              onChange={(e) => setR({ ...r, responsavelId: e.target.value })}
            >
              <option value="">{contato ? "Sem responsável" : "Eu"}</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
          <Campo
            id="contato-documento"
            rotulo={r.tipo === "organizacao" ? "CNPJ" : "CPF"}
            inputMode="numeric"
            value={r.documento}
            onChange={(e) => setR({ ...r, documento: e.target.value })}
          />
        </div>

        {etiquetas.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Etiquetas</legend>
            <div className="flex flex-wrap gap-2">
              {etiquetas.map((e) => (
                <Filtro
                  key={e.id}
                  ativo={r.etiquetas.includes(e.id)}
                  aoClicar={() =>
                    setR({
                      ...r,
                      etiquetas: r.etiquetas.includes(e.id)
                        ? r.etiquetas.filter((x) => x !== e.id)
                        : [...r.etiquetas, e.id],
                    })
                  }
                >
                  {e.nome}
                </Filtro>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-1.5">
          <label htmlFor="contato-observacoes" className="text-sm font-medium">
            Observações
          </label>
          <textarea
            id="contato-observacoes"
            rows={3}
            maxLength={10000}
            className="rounded-md border border-linha bg-cartao p-3"
            value={r.observacoes}
            onChange={(e) => setR({ ...r, observacoes: e.target.value })}
          />
        </div>

        {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
        <div className="flex gap-2">
          <Button type="submit">Salvar</Button>
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface Ficha {
  contato?: Contato;
  juntadoEmId?: string | null;
  organizacoes: ResumoDoContato[];
  pessoasLigadas: ResumoDoContato[];
  tarefas: Tarefa[];
  /** Outros contatos com o mesmo e-mail, telefone ou rede (o aviso com Juntar). */
  repetidos?: AvisoDeRepetido[];
  pode: { editar: boolean; juntar: boolean; apagar: boolean };
}

export function PaginaDoContato({ id }: { id: string }) {
  const [ficha, setFicha] = useState<Ficha | null | undefined>(undefined);
  const [editando, setEditando] = useState(false);
  const [repetidos, setRepetidos] = useState<AvisoDeRepetido[]>([]);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [juntarCom, setJuntarCom] = useState<ResumoDoContato | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const pessoas = usePessoas();
  const nomes = Object.fromEntries(pessoas.map((p) => [p.id, p.nome]));

  const carregar = useCallback(async () => {
    const r = await pedir<Ficha>("GET", `/contatos/${id}`);
    if (r.ok && r.dados?.juntadoEmId) {
      location.replace(`/contatos/${r.dados.juntadoEmId}`);
      return;
    }
    setFicha(r.ok ? (r.dados ?? null) : null);
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  // Vindo do aviso de repetido ("Juntar"): já abre a escolha com o outro contato.
  useEffect(() => {
    const outro = new URLSearchParams(location.search).get("juntar");
    if (!outro) return;
    void pedir<Ficha>("GET", `/contatos/${outro}`).then((r) => {
      const k = r.dados?.contato;
      if (k)
        setJuntarCom({
          id: k.id,
          tipo: k.tipo,
          nome: k.nome,
          papeis: k.papeis,
          emailPrincipal: null,
          telefonePrincipal: null,
          organizacao: null,
          etiquetas: k.etiquetas,
          responsavelId: k.responsavelId,
          situacao: k.situacao,
          repetido: true,
        });
    });
  }, []);

  async function mudarSituacao(situacao: "ativo" | "arquivado") {
    const r = await pedir("POST", `/contatos/${id}`, { situacao });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: situacao === "arquivado" ? "Contato arquivado." : "Contato de volta." });
    void carregar();
  }

  async function juntar(outro: ResumoDoContato, nome: string) {
    const r = await pedir("POST", "/contatos/juntar", { ficaId: id, saiId: outro.id, nome });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setJuntarCom(null);
    history.replaceState(null, "", `/contatos/${id}`);
    setMensagem({ tipo: "ok", texto: "Contatos juntados." });
    void carregar();
  }

  async function apagar() {
    if (!confirm("Apagar este contato para sempre? Ele sai das tarefas e projetos, e não dá para desfazer."))
      return;
    const r = await pedir("DELETE", `/contatos/${id}`);
    if (!r.ok) {
      if (r.codigo === "CONFIRMACAO_NECESSARIA") return setConfirmar(true);
      return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    }
    location.href = "/contatos";
  }

  if (confirmar)
    return (
      <ConfirmarSegundoFator
        aoConfirmar={() => {
          setConfirmar(false);
          void apagar();
        }}
      />
    );
  if (ficha === undefined) return null;
  const contato = ficha?.contato;
  if (!ficha || !contato)
    return (
      <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
        <p className="text-sm text-texto-2">Contato não encontrado.</p>
      </main>
    );

  const nomesDasOrgs = Object.fromEntries(ficha.organizacoes.map((o) => [o.id, o.nome]));
  const abertas = ficha.tarefas.filter((t) => t.status !== "concluida" && t.status !== "cancelada");
  const fechadas = ficha.tarefas.filter((t) => t.status === "concluida" || t.status === "cancelada");

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/contatos" className="flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
        <ArrowLeft className="size-4" /> Contatos
      </a>
      {editando ? (
        <FormularioDoContato
          contato={contato}
          nomesDasOrgs={nomesDasOrgs}
          aoCancelar={() => setEditando(false)}
          aoSalvar={(_, avisos) => {
            setEditando(false);
            setRepetidos(avisos);
            setMensagem({ tipo: "ok", texto: "Contato salvo." });
            void carregar();
          }}
        />
      ) : (
        <Card className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-1">
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <IconeDoTipo tipo={contato.tipo} />
                {contato.nome}
              </h1>
              <div className="flex flex-wrap gap-2">
                <Papeis papeis={contato.papeis} />
                {contato.situacao === "arquivado" && (
                  <span className="rounded-full bg-suave px-2 py-0.5 text-xs text-texto-2">Arquivado</span>
                )}
              </div>
            </div>
            {ficha.pode.editar && (
              <div className="flex flex-wrap gap-2">
                <Button variant="contorno" size="pequeno" onClick={() => setEditando(true)}>
                  Editar
                </Button>
                <Button
                  variant="fantasma"
                  size="pequeno"
                  onClick={() => void mudarSituacao(contato.situacao === "arquivado" ? "ativo" : "arquivado")}
                >
                  {contato.situacao === "arquivado" ? "Desarquivar" : "Arquivar"}
                </Button>
              </div>
            )}
          </div>
          {contato.identificadores.length > 0 && (
            <ul className="grid gap-1 text-sm">
              {contato.identificadores.map((i) => (
                <li key={`${i.tipo}-${i.valor}`} className="flex flex-wrap items-center gap-2">
                  {i.tipo === "email" ? (
                    <a className="underline" href={`mailto:${i.valor}`}>
                      {i.valor}
                    </a>
                  ) : i.tipo === "telefone" ? (
                    <a className="underline" href={`tel:${i.valor}`}>
                      {telefoneParaLer(i.valor)}
                    </a>
                  ) : (
                    <span>{textoDoIdentificador(i)}</span>
                  )}
                  {i.principal && <span className="text-xs text-texto-2">principal</span>}
                  {i.tipo === "telefone" && i.whatsapp && (
                    <span className="text-xs text-texto-2">WhatsApp</span>
                  )}
                  {i.tipo === "telefone" && i.rotulo && (
                    <span className="text-xs text-texto-2">{i.rotulo}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <dl className="grid gap-1 text-sm">
            {contato.responsavelId && (
              <div className="flex gap-2">
                <dt className="text-texto-2">Responsável:</dt>
                <dd>{nomes[contato.responsavelId] ?? "Pessoa da equipe"}</dd>
              </div>
            )}
            {contato.documento && (
              <div className="flex gap-2">
                <dt className="text-texto-2">{contato.documento.length === 14 ? "CNPJ:" : "CPF:"}</dt>
                <dd>{contato.documento}</dd>
              </div>
            )}
          </dl>
          {contato.observacoes && (
            <p className="whitespace-pre-wrap text-pretty text-sm">{contato.observacoes}</p>
          )}
          {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
          <AvisosDeRepetidos
            avisos={ficha.repetidos ?? repetidos}
            contatoId={ficha.pode.juntar ? contato.id : null}
          />
        </Card>
      )}

      {ficha.organizacoes.length > 0 && (
        <section className="grid gap-2" aria-label="Organizações">
          <h2 className="text-lg font-semibold">Organizações</h2>
          <ul className="grid gap-2">
            {ficha.organizacoes.map((o) => (
              <li key={o.id}>
                <a href={`/contatos/${o.id}`} className="flex items-center gap-2 text-sm underline">
                  <Building2 className="size-4 text-texto-2" />
                  {o.nome}
                  {contato.organizacoes.find((x) => x.organizacaoId === o.id)?.cargo && (
                    <span className="text-texto-2 no-underline">
                      · {contato.organizacoes.find((x) => x.organizacaoId === o.id)?.cargo}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {contato.tipo === "organizacao" && (
        <section className="grid gap-2" aria-label="Pessoas ligadas">
          <h2 className="text-lg font-semibold">Pessoas</h2>
          {ficha.pessoasLigadas.length === 0 && (
            <p className="text-sm text-texto-2">Nenhuma pessoa ligada a esta organização.</p>
          )}
          <ul className="grid gap-2">
            {ficha.pessoasLigadas.map((k) => (
              <li key={k.id}>
                <ItemDaLista k={k} nomes={nomes} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-2" aria-label="Tarefas do contato">
        <h2 className="text-lg font-semibold">Tarefas</h2>
        {ficha.tarefas.length === 0 && <p className="text-sm text-texto-2">Nenhuma tarefa ligada.</p>}
        {[...abertas, ...fechadas].map((t) => (
          <a
            key={t.id}
            href={`/tarefas/${t.id}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-linha bg-cartao p-3 text-sm hover:bg-suave"
          >
            <span className={cn(fechadas.includes(t) && "text-texto-2")}>{t.titulo}</span>
            <EtiquetaDeStatus status={t.status} />
          </a>
        ))}
      </section>

      {(ficha.pode.juntar || ficha.pode.apagar) && (
        <Card className="gap-3">
          <CardTitulo>Mais</CardTitulo>
          {ficha.pode.juntar && contato.situacao !== "juntado" && (
            <div className="grid gap-2">
              <CardDescricao>
                Juntar outro cadastro da mesma {contato.tipo === "organizacao" ? "organização" : "pessoa"}{" "}
                neste: tudo passa para cá e o outro some das listas.
              </CardDescricao>
              {juntarCom ? (
                <ConfirmarJuntar
                  este={contato.nome}
                  outro={juntarCom.nome}
                  aoJuntar={(nome) => void juntar(juntarCom, nome)}
                  aoCancelar={() => setJuntarCom(null)}
                />
              ) : (
                <EscolherContato
                  rotulo="Contato para juntar"
                  tipo={contato.tipo}
                  semIds={[contato.id]}
                  aoEscolher={setJuntarCom}
                />
              )}
            </div>
          )}
          {ficha.pode.apagar && (
            <div>
              <Button variant="perigo" size="pequeno" onClick={() => void apagar()}>
                <Trash2 /> Apagar contato
              </Button>
            </div>
          )}
        </Card>
      )}
    </main>
  );
}

/**
 * Confirmar o juntar escolhendo o nome que fica (pedido do Sandro em 27/11/2026). O resto (e-mails, telefones, tarefas,
 * observações) passa todo para este contato.
 */
function ConfirmarJuntar({
  este,
  outro,
  aoJuntar,
  aoCancelar,
}: {
  este: string;
  outro: string;
  aoJuntar: (nome: string) => void;
  aoCancelar: () => void;
}) {
  const opcoes = este === outro ? [este] : [este, outro];
  const [nome, setNome] = useState(este);
  const [outroNome, setOutroNome] = useState("");
  const escolhido = nome === "__outro" ? outroNome.trim() : nome;
  return (
    <div className="grid gap-2 rounded-md border border-linha p-3 text-sm">
      <p>
        Juntar <strong>{outro}</strong> neste contato? Os e-mails, telefones, tarefas e observações passam
        para cá, e <strong>{outro}</strong> deixa de aparecer nas listas.
      </p>
      <fieldset className="grid gap-1.5">
        <legend className="font-medium">Qual nome fica?</legend>
        {opcoes.map((n) => (
          <label key={n} className="flex items-center gap-2">
            <input type="radio" name="nome-que-fica" checked={nome === n} onChange={() => setNome(n)} />
            {n}
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="nome-que-fica"
            checked={nome === "__outro"}
            onChange={() => setNome("__outro")}
          />
          Outro nome:
          <input
            aria-label="Outro nome"
            className="h-8 min-w-0 flex-1 rounded-md border border-linha bg-cartao px-2"
            value={outroNome}
            maxLength={200}
            onFocus={() => setNome("__outro")}
            onChange={(e) => setOutroNome(e.target.value)}
          />
        </label>
      </fieldset>
      <div className="flex gap-2">
        <Button size="pequeno" disabled={!escolhido} onClick={() => aoJuntar(escolhido)}>
          Juntar
        </Button>
        <Button size="pequeno" variant="fantasma" onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** Os contatos citados numa tarefa ou num projeto, com a busca para ligar mais (até 20). */
export function ContatosLigados({
  alvo,
  podeMudar,
}: {
  alvo: { tipo: "tarefas" | "projetos"; id: string };
  podeMudar: boolean;
}) {
  const [contatos, setContatos] = useState<ResumoDoContato[] | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const caminho = `/${alvo.tipo}/${alvo.id}/contatos`;
  const carregar = useCallback(async () => {
    const r = await pedir<{ contatos: ResumoDoContato[]; podeVer: boolean }>("GET", caminho);
    setContatos(r.ok && r.dados?.podeVer ? r.dados.contatos : null);
  }, [caminho]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function trocar(ids: string[]) {
    const r = await pedir<{ contatos: ResumoDoContato[] }>("POST", caminho, { contatos: ids });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem(null);
    setContatos(r.dados?.contatos ?? []);
  }

  // Sem permissão para ver contatos, a parte não aparece.
  if (contatos === null) return null;
  if (contatos.length === 0 && !podeMudar) return null;
  return (
    <section className="grid gap-2" aria-label="Contatos">
      <h2 className="text-lg font-semibold">Contatos</h2>
      {contatos.length === 0 && <p className="text-sm text-texto-2">Nenhum contato ligado.</p>}
      <ul className="flex flex-wrap gap-2">
        {contatos.map((k) => (
          <li
            key={k.id}
            className="flex items-center gap-1.5 rounded-full border border-linha bg-cartao px-3 py-1 text-sm"
          >
            <IconeDoTipo tipo={k.tipo} />
            <a className="hover:underline" href={`/contatos/${k.id}`}>
              {k.nome}
            </a>
            {podeMudar && (
              <button
                type="button"
                aria-label={`Tirar ${k.nome}`}
                className="text-texto-2 hover:text-perigo"
                onClick={() => void trocar(contatos.filter((x) => x.id !== k.id).map((x) => x.id))}
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {podeMudar && contatos.length < 20 && (
        <EscolherContato
          rotulo="Ligar um contato"
          semIds={contatos.map((k) => k.id)}
          aoEscolher={(k) => void trocar([...contatos.map((x) => x.id), k.id])}
        />
      )}
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
    </section>
  );
}
