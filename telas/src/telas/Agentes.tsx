/**
 * Central de agentes (M2-03): a lista com situação, responsável, último sinal de vida e tarefas abertas, e a página
 * do agente. Todo mundo vê; só o administrador cadastra, edita, pausa, retoma e desliga (a API confere de novo).
 */
import { type ChaveDeAgente, MINUTOS_SEM_SINAL_PADRAO, type SituacaoAgente } from "@mago-os/contratos";
import { ArrowLeft, Bot, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listarPessoas, type PessoaDaEmpresa } from "@/acesso";
import {
  type AgenteNaLista,
  acaoNoAgente,
  cadastrarAgente,
  criarChave,
  editarAgente,
  listarAgentes,
  listarChaves,
  revogarChave,
  verAgente,
} from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { useTempoReal } from "@/tempo-real";
import { Aviso } from "./Acesso";
import { useAoVoltar } from "./Administrador";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

const NOME_DA_SITUACAO: Record<SituacaoAgente, string> = {
  ativo: "Ativo",
  pausado: "Pausado",
  desligado: "Desligado",
};

const COR_DA_SITUACAO: Record<SituacaoAgente, string> = {
  ativo: "bg-ok/10 text-ok",
  pausado: "bg-alerta/10 text-alerta",
  desligado: "bg-suave text-texto-2",
};

function Situacao({ situacao }: { situacao: SituacaoAgente }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", COR_DA_SITUACAO[situacao])}>
      {NOME_DA_SITUACAO[situacao]}
    </span>
  );
}

export function ultimoSinal(iso: string | null): string {
  if (!iso) return "Nunca deu sinal";
  const minutos = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutos < 1) return "Sinal agora há pouco";
  if (minutos < 60) return `Sinal há ${minutos} min`;
  return `Último sinal em ${new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function usePessoasAtivas() {
  const [pessoas, setPessoas] = useState<PessoaDaEmpresa[]>([]);
  useEffect(() => {
    void listarPessoas().then((l) => setPessoas((l ?? []).filter((p) => p.situacao === "ativo")));
  }, []);
  return pessoas;
}

export function Agentes({ podeCadastrar, euId }: { podeCadastrar: boolean; euId: string }) {
  const [agentes, setAgentes] = useState<AgenteNaLista[] | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  const carregar = useCallback(async () => {
    const r = await listarAgentes();
    setAgentes(r.dados ?? []);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);
  // A lista mostra situação e tarefas abertas: qualquer mudança de agente ou tarefa pode alterá-la.
  useTempoReal(() => void carregar());

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Agentes</h1>
          <p className="text-sm text-texto-2">Os agentes de IA que trabalham nesta empresa.</p>
        </div>
        {podeCadastrar && !cadastrando && (
          <Button onClick={() => setCadastrando(true)}>
            <Plus /> Cadastrar
          </Button>
        )}
      </div>
      {cadastrando && (
        <FormularioDoAgente
          euId={euId}
          aoCancelar={() => setCadastrando(false)}
          aoSalvar={(id) => window.location.assign(`/agentes/${id}`)}
        />
      )}
      {agentes && agentes.length === 0 && <p className="text-sm text-texto-2">Nenhum agente cadastrado.</p>}
      <ul className="grid gap-2">
        {agentes?.map((a) => (
          <li key={a.id}>
            <a
              href={`/agentes/${a.id}`}
              className="grid gap-1.5 rounded-lg border border-linha bg-cartao p-3 transition-colors hover:bg-suave"
            >
              <span className="flex items-center gap-2 font-medium">
                <Bot className="size-4 text-texto-2" /> {a.nome}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <Situacao situacao={a.situacao} />
                <span>Responsável: {a.responsavelNome}</span>
                <span>
                  {a.tarefasAbertas === 1 ? "1 tarefa aberta" : `${a.tarefasAbertas} tarefas abertas`}
                </span>
                <span className="ml-auto">{ultimoSinal(a.ultimoSinalEm)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

function FormularioDoAgente({
  euId,
  atual,
  aoCancelar,
  aoSalvar,
}: {
  euId: string;
  atual?: AgenteNaLista;
  aoCancelar: () => void;
  aoSalvar: (id: string) => void;
}) {
  const pessoas = usePessoasAtivas();
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  async function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const dados = {
      nome: String(f.get("nome")).trim(),
      descricao: String(f.get("descricao")).trim() || null,
      ondeRoda: String(f.get("ondeRoda")).trim() || null,
      responsavelId: String(f.get("responsavelId")),
      minutosSemSinal: Number(f.get("minutosSemSinal")),
    };
    const r = atual ? await editarAgente(atual.id, dados) : await cadastrarAgente(dados);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoSalvar(r.dados.id);
  }

  return (
    <Card className="gap-4">
      <div className="grid gap-1">
        <CardTitulo>{atual ? "Editar agente" : "Cadastrar agente"}</CardTitulo>
        {!atual && (
          <CardDescricao>
            O agente roda fora do Mago OS e entra pelo MCP com uma chave própria (a chave vem na próxima
            etapa).
          </CardDescricao>
        )}
      </div>
      <form className="grid gap-3" onSubmit={(e) => void aoEnviar(e)}>
        <Campo id="nome" name="nome" rotulo="Nome" required maxLength={80} defaultValue={atual?.nome} />
        <Campo
          id="ondeRoda"
          name="ondeRoda"
          rotulo="Onde roda (opcional)"
          maxLength={100}
          placeholder="Ex.: Mac do Sandro, VPS01"
          defaultValue={atual?.ondeRoda ?? ""}
        />
        <div className="grid gap-1.5">
          <label htmlFor="descricao" className="text-sm font-medium">
            Para que serve (opcional)
          </label>
          <textarea
            id="descricao"
            name="descricao"
            rows={2}
            maxLength={1000}
            defaultValue={atual?.descricao ?? ""}
            className="rounded-md border border-linha bg-cartao px-3 py-2 text-base"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="responsavelId" className="text-sm font-medium">
            Pessoa responsável
          </label>
          <select
            id="responsavelId"
            name="responsavelId"
            required
            defaultValue={atual?.responsavelId ?? euId}
            key={pessoas.length}
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
          >
            {/* Quem é responsável hoje aparece mesmo que já não esteja ativo: salvar não troca sem querer. */}
            {atual && !pessoas.some((p) => p.id === atual.responsavelId) && (
              <option value={atual.responsavelId}>{atual.responsavelNome}</option>
            )}
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
        <Campo
          id="minutosSemSinal"
          name="minutosSemSinal"
          type="number"
          min={2}
          max={1440}
          required
          rotulo="Minutos sem sinal até a tarefa voltar para a fila"
          defaultValue={atual?.minutosSemSinal ?? MINUTOS_SEM_SINAL_PADRAO}
        />
        {mensagem && <Aviso {...mensagem} />}
        <div className="flex gap-2">
          <Button type="submit">{atual ? "Salvar" : "Cadastrar agente"}</Button>
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function PaginaDoAgente({
  id,
  podeEditar,
  podeDesligar,
  euId,
}: {
  id: string;
  podeEditar: boolean;
  podeDesligar: boolean;
  euId: string;
}) {
  const [agente, setAgente] = useState<AgenteNaLista | null | undefined>(undefined);
  const [editando, setEditando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await verAgente(id);
    setAgente(r.ok && r.dados ? r.dados : null);
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  useAoVoltar(carregar);
  useTempoReal((aviso) => {
    if (aviso.tipo === "reconectou" || aviso.id === id || aviso.tipo === "tarefa") void carregar();
  });

  if (agente === undefined) return <main className="min-h-dvh" aria-busy="true" />;
  if (agente === null) {
    return (
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
        <Voltar />
        <p className="text-texto-2">Agente não encontrado.</p>
      </main>
    );
  }

  async function acao(qual: "pausar" | "retomar" | "desligar") {
    if (
      qual === "desligar" &&
      !window.confirm(
        "Desligar este agente? Ele para na hora, as chaves deixam de valer e as tarefas dele voltam para a fila. Não tem volta.",
      )
    )
      return;
    const r = await acaoNoAgente(id, qual);
    setMensagem(
      r.ok
        ? {
            tipo: "ok",
            texto: { pausar: "Agente pausado.", retomar: "Agente retomado.", desligar: "Agente desligado." }[
              qual
            ],
          }
        : { tipo: "erro", texto: r.mensagem ?? "" },
    );
    void carregar();
  }

  const desligado = agente.situacao === "desligado";
  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <Voltar />
      <div className="grid gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Bot className="size-6 text-texto-2" /> {agente.nome}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
          <Situacao situacao={agente.situacao} />
          <span>{ultimoSinal(agente.ultimoSinalEm)}</span>
        </div>
      </div>
      {agente.descricao && <p className="whitespace-pre-wrap text-pretty">{agente.descricao}</p>}
      {mensagem && <Aviso {...mensagem} />}
      {editando ? (
        <FormularioDoAgente
          euId={euId}
          atual={agente}
          aoCancelar={() => setEditando(false)}
          aoSalvar={() => {
            setEditando(false);
            setMensagem({ tipo: "ok", texto: "Agente atualizado." });
            void carregar();
          }}
        />
      ) : (
        <Card className="gap-2 text-sm">
          <Linha rotulo="Responsável" valor={agente.responsavelNome} />
          <Linha rotulo="Onde roda" valor={agente.ondeRoda ?? "Não informado"} />
          <Linha rotulo="Tipo" valor="Externo (entra pelo MCP)" />
          <Linha
            rotulo="Tarefas abertas"
            valor={agente.tarefasAbertas === 1 ? "1" : String(agente.tarefasAbertas)}
          />
          <Linha rotulo="Sem sinal por" valor={`${agente.minutosSemSinal} min, a tarefa volta para a fila`} />
          {agente.desligadoEm && (
            <Linha rotulo="Desligado em" valor={new Date(agente.desligadoEm).toLocaleString("pt-BR")} />
          )}
        </Card>
      )}
      {podeEditar && <ChavesDoAgente agenteId={agente.id} desligado={desligado} />}
      {!desligado && !editando && (podeEditar || podeDesligar) && (
        <div className="flex flex-wrap gap-2">
          {podeEditar && (
            <Button variant="contorno" onClick={() => setEditando(true)}>
              Editar
            </Button>
          )}
          {podeEditar && agente.situacao === "ativo" && (
            <Button variant="contorno" onClick={() => void acao("pausar")}>
              Pausar
            </Button>
          )}
          {podeEditar && agente.situacao === "pausado" && (
            <Button variant="contorno" onClick={() => void acao("retomar")}>
              Retomar
            </Button>
          )}
          {podeDesligar && (
            <Button variant="perigo" onClick={() => void acao("desligar")}>
              Desligar
            </Button>
          )}
        </div>
      )}
    </main>
  );
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Chaves do agente (M2-04): a lista (só o começo de cada uma), criar (a chave inteira aparece uma vez, para copiar)
 * e revogar. Revogar vale no pedido seguinte do agente.
 */
function ChavesDoAgente({ agenteId, desligado }: { agenteId: string; desligado: boolean }) {
  const [chaves, setChaves] = useState<ChaveDeAgente[]>([]);
  const [criando, setCriando] = useState(false);
  const [nova, setNova] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const r = await listarChaves(agenteId);
    if (r.ok && r.dados) setChaves(r.dados);
  }, [agenteId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function aoCriar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const validade = String(f.get("validaAte") ?? "");
    const r = await criarChave(agenteId, {
      nome: String(f.get("nome")).trim(),
      validaAte: validade ? new Date(`${validade}T23:59:59`).toISOString() : null,
    });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setCriando(false);
    setCopiada(false);
    setNova(r.dados.segredo);
    setMensagem(null);
    void carregar();
  }

  async function aoRevogar(chave: ChaveDeAgente) {
    if (
      !window.confirm(
        `Revogar a chave "${chave.nome}"? O agente que usa esta chave para de entrar no próximo pedido.`,
      )
    )
      return;
    const r = await revogarChave(agenteId, chave.id);
    setMensagem(r.ok ? { tipo: "ok", texto: "Chave revogada." } : { tipo: "erro", texto: r.mensagem ?? "" });
    void carregar();
  }

  async function copiar() {
    if (!nova) return;
    try {
      await navigator.clipboard.writeText(nova);
      setCopiada(true);
    } catch {
      setMensagem({ tipo: "erro", texto: "Não deu para copiar sozinho. Selecione a chave e copie." });
    }
  }

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitulo>Chaves</CardTitulo>
        {!desligado && !criando && !nova && (
          <Button size="pequeno" variant="contorno" onClick={() => setCriando(true)}>
            <Plus /> Criar chave
          </Button>
        )}
      </div>
      <CardDescricao>
        O agente entra no Mago OS com uma destas chaves. Para trocar sem parar: crie a nova, troque no agente
        e revogue a antiga.
      </CardDescricao>
      {nova && (
        <div className="grid gap-2 rounded-md border border-alerta/40 bg-suave p-3" role="status">
          <p className="text-sm font-medium">
            Copie a chave agora. Ela não aparece de novo: o Mago OS guarda só um resumo dela.
          </p>
          <code className="break-all rounded bg-cartao px-2 py-1.5 font-mono text-xs" data-chave-nova>
            {nova}
          </code>
          <div className="flex gap-2">
            <Button size="pequeno" onClick={() => void copiar()}>
              {copiada ? "Copiada" : "Copiar"}
            </Button>
            <Button size="pequeno" variant="fantasma" onClick={() => setNova(null)}>
              Já guardei
            </Button>
          </div>
        </div>
      )}
      {criando && (
        <form className="grid gap-3" onSubmit={(e) => void aoCriar(e)}>
          <Campo
            id="nome-da-chave"
            name="nome"
            rotulo="Nome da chave"
            required
            maxLength={80}
            placeholder="Ex.: Mac do Sandro"
          />
          <Campo id="validade-da-chave" name="validaAte" type="date" rotulo="Válida até (opcional)" />
          <div className="flex gap-2">
            <Button type="submit" size="pequeno">
              Criar
            </Button>
            <Button type="button" size="pequeno" variant="fantasma" onClick={() => setCriando(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {mensagem && <Aviso {...mensagem} />}
      {chaves.length === 0 && <p className="text-sm text-texto-2">Nenhuma chave ainda.</p>}
      <ul className="grid gap-2">
        {chaves.map((k) => (
          <li key={k.id} className="grid gap-1 rounded-md border border-linha p-2.5 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{k.nome}</span>
              <code className="font-mono text-xs text-texto-2">{k.prefixo}_…</code>
              {k.revogadaEm && (
                <span className="rounded-full bg-suave px-2 py-0.5 text-xs text-texto-2">Revogada</span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 text-xs text-texto-2">
              <span>Criada em {dataCurta(k.criadaEm)}</span>
              <span>{k.ultimoUsoEm ? `Último uso ${dataCurta(k.ultimoUsoEm)}` : "Nunca usada"}</span>
              {k.validaAte && <span>Vale até {dataCurta(k.validaAte)}</span>}
              {!k.revogadaEm && (
                <Button
                  size="pequeno"
                  variant="fantasma"
                  className="ml-auto text-perigo"
                  onClick={() => void aoRevogar(k)}
                >
                  Revogar
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex flex-wrap justify-between gap-2">
      <span className="text-texto-2">{rotulo}</span>
      <span className="text-right">{valor}</span>
    </p>
  );
}

function Voltar() {
  return (
    <a href="/agentes" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
      <ArrowLeft className="size-4" /> Agentes
    </a>
  );
}
