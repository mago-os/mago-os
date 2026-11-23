/**
 * Rotinas (M5-05, decisão 0039): a lista, criar e editar ("quando" e "o que fazer"), ligar e desligar, "Rodar agora" e
 * o histórico. A rotina nasce desligada e age em nome de quem criou: só o dono edita, liga e roda; o administrador
 * desliga e apaga qualquer uma.
 */
import type {
  AcaoDaRotina,
  ExecucaoDeRotina,
  GatilhoPorHorario,
  PedidoDeRotina,
  Prioridade,
  Rotina,
  SituacaoDaExecucaoDeRotina,
} from "@mago-os/contratos";
import { ArrowLeft, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import {
  responsavelDoValor,
  SeletorDeResponsavel,
  useAgentesAtivos,
  usePessoas,
  useProjetosAtivos,
  valorDoResponsavel,
} from "./Tarefas";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;
interface Permissoes {
  souDono: boolean;
  podeMudar: boolean;
  podeDesligar: boolean;
  podeApagar: boolean;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const NOME_DA_ACAO: Record<AcaoDaRotina["tipo"], string> = {
  criar_tarefa: "Criar tarefa",
  pedir_ao_agente: "Pedir a um agente",
  mandar_aviso: "Mandar aviso",
};
const NOME_DA_EXECUCAO: Record<SituacaoDaExecucaoDeRotina, string> = {
  na_fila: "Na fila",
  rodando: "Rodando",
  esperando: "Esperando",
  feita: "Feita",
  falhou: "Falhou",
  pulada: "Pulada",
};
const COR_DA_EXECUCAO: Record<SituacaoDaExecucaoDeRotina, string> = {
  na_fila: "bg-suave text-texto-2",
  rodando: "bg-alerta/10 text-alerta",
  esperando: "bg-alerta/10 text-alerta",
  feita: "bg-ok/10 text-ok",
  falhou: "bg-perigo/10 text-perigo",
  pulada: "bg-suave text-texto-2",
};

const quando = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** "Toda segunda às 08:00", "A cada 2 dias às 09:00 e 18:00"... */
export function textoDoQuando(g: GatilhoPorHorario): string {
  const r = g.regra;
  const horas = [...g.horas].sort();
  const as = `às ${horas.length > 1 ? `${horas.slice(0, -1).join(", ")} e ${horas.at(-1)}` : horas[0]}`;
  const cada = (um: string, varios: string) => (r.intervalo === 1 ? um : `A cada ${r.intervalo} ${varios}`);
  let base: string;
  if (r.frequencia === "diaria") base = cada("Todo dia", "dias");
  else if (r.frequencia === "semanal") {
    const dias = (r.diasDaSemana ?? []).map((d) => DIAS[d]).join(", ");
    base = `${cada("Toda semana", "semanas")}${dias ? ` (${dias})` : ""}`;
  } else if (r.frequencia === "mensal")
    base = `${cada("Todo mês", "meses")}${r.diaDoMes ? `, no dia ${r.diaDoMes}` : ""}`;
  else base = cada("Todo ano", "anos");
  return `${base} ${as} (${g.fuso})`;
}

function SituacaoDaRotina({ rotina }: { rotina: Rotina }) {
  const ligada = rotina.situacao === "ligada";
  const porque =
    rotina.desligadaPorque === "terminou"
      ? " (terminou)"
      : rotina.desligadaPorque === "dono_desligado"
        ? " (o dono saiu)"
        : rotina.desligadaPorque === "agente"
          ? " (por um agente)"
          : "";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium",
        ligada ? "bg-ok/10 text-ok" : "bg-suave text-texto-2",
      )}
    >
      {ligada ? "Ligada" : `Desligada${porque}`}
    </span>
  );
}

export function ListaDeRotinas() {
  const [dados, setDados] = useState<{
    rotinas: Rotina[];
    nomes: Record<string, string>;
    podeCriar: boolean;
    permissoes: Record<string, Permissoes>;
  } | null>(null);
  const [criando, setCriando] = useState(false);
  const carregar = useCallback(async () => {
    const r = await pedir<NonNullable<typeof dados>>("GET", "/rotinas");
    setDados(r.ok && r.dados ? r.dados : { rotinas: [], nomes: {}, podeCriar: false, permissoes: {} });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Rotinas</h1>
          <p className="text-sm text-texto-2">
            O que roda sozinho no horário, em nome de quem criou: criar uma tarefa, pedir a um agente ou
            mandar um aviso.
          </p>
        </div>
        {dados?.podeCriar && !criando && (
          <Button onClick={() => setCriando(true)}>
            <Plus /> Nova rotina
          </Button>
        )}
      </div>
      {criando && (
        <FormularioDaRotina
          aoCancelar={() => setCriando(false)}
          aoSalvar={(r) => {
            location.href = `/rotinas/${r.id}`;
          }}
        />
      )}
      {dados && dados.rotinas.length === 0 && !criando && (
        <p className="text-sm text-texto-2">Nenhuma rotina ainda.</p>
      )}
      <ul className="grid gap-2">
        {dados?.rotinas.map((r) => (
          <li key={r.id}>
            <a
              href={`/rotinas/${r.id}`}
              className="grid gap-1.5 rounded-lg border border-linha bg-cartao p-3 hover:bg-suave"
            >
              <span className="font-medium">{r.nome}</span>
              <span className="text-sm text-texto-2">
                {NOME_DA_ACAO[r.acao.tipo]}. {textoDoQuando(r.gatilho)}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                <SituacaoDaRotina rotina={r} />
                {r.proximaEm && <span>Próxima: {quando(r.proximaEm)}</span>}
                {!dados.permissoes[r.id]?.souDono && (
                  <span>De {dados.nomes[r.donoPessoaId] ?? "outra pessoa"}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function PaginaDaRotina({ id }: { id: string }) {
  const [d, setD] = useState<
    | ({ rotina: Rotina; execucoes: ExecucaoDeRotina[]; nomes: Record<string, string> } & Permissoes)
    | null
    | undefined
  >(undefined);
  const [editando, setEditando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => {
    const r = await pedir<NonNullable<typeof d>>("GET", `/rotinas/${encodeURIComponent(id)}`);
    setD(r.ok && r.dados ? r.dados : null);
  }, [id]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  // Com uma execução andando, confere de novo a cada 5 segundos.
  const andando = d?.execucoes.some((e) => ["na_fila", "rodando"].includes(e.situacao)) ?? false;
  useEffect(() => {
    if (!andando) return;
    const t = setInterval(() => void carregar(), 5000);
    return () => clearInterval(t);
  }, [andando, carregar]);

  if (d === undefined) return null;
  if (d === null)
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <p className="text-sm text-texto-2">Rotina não encontrada.</p>
      </main>
    );
  const { rotina } = d;
  async function acao(caminho: string, metodo: "POST" | "DELETE" = "POST", ok?: string) {
    setOcupado(true);
    const r = await pedir(
      "POST" === metodo ? "POST" : "DELETE",
      `/rotinas/${rotina.id}${caminho}`,
      metodo === "POST" ? {} : undefined,
    );
    setOcupado(false);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    if (metodo === "DELETE") {
      location.href = "/rotinas";
      return;
    }
    setMensagem(ok ? { tipo: "ok", texto: ok } : null);
    void carregar();
  }
  const a = rotina.acao;
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/rotinas" className="flex items-center gap-1 text-sm text-texto-2 hover:text-texto">
        <ArrowLeft className="size-4" /> Rotinas
      </a>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{rotina.nome}</h1>
          <span className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
            <SituacaoDaRotina rotina={rotina} />
            {rotina.proximaEm && <span>Próxima: {quando(rotina.proximaEm)}</span>}
            {!d.souDono && <span>De {d.nomes[rotina.donoPessoaId] ?? "outra pessoa"}</span>}
            {rotina.criadaPorAgenteId && (
              <span>Criada por {d.nomes[rotina.criadaPorAgenteId] ?? "um agente"}</span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.podeMudar && rotina.situacao === "desligada" && (
            <Button disabled={ocupado} onClick={() => void acao("/ligar", "POST", "Rotina ligada.")}>
              Ligar
            </Button>
          )}
          {d.podeDesligar && rotina.situacao === "ligada" && (
            <Button
              variant="contorno"
              disabled={ocupado}
              onClick={() => void acao("/desligar", "POST", "Rotina desligada.")}
            >
              Desligar
            </Button>
          )}
          {d.podeMudar && (
            <Button
              variant="contorno"
              disabled={ocupado}
              onClick={() =>
                void acao("/rodar", "POST", "Rodando agora. O resultado aparece no histórico abaixo.")
              }
            >
              <Play /> Rodar agora
            </Button>
          )}
        </div>
      </div>
      {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
      {editando ? (
        <FormularioDaRotina
          inicial={rotina}
          aoCancelar={() => setEditando(false)}
          aoSalvar={() => {
            setEditando(false);
            setMensagem({ tipo: "ok", texto: "Rotina salva." });
            void carregar();
          }}
        />
      ) : (
        <Card>
          <CardTitulo>Quando</CardTitulo>
          <CardDescricao>{textoDoQuando(rotina.gatilho)}</CardDescricao>
          <CardTitulo className="mt-3">O que faz</CardTitulo>
          <div className="grid gap-1 text-sm">
            <span className="font-medium">{NOME_DA_ACAO[a.tipo]}</span>
            {a.tipo === "criar_tarefa" && (
              <span>
                “{a.titulo}”
                {a.responsavel
                  ? `, para ${d.nomes[a.responsavel.tipo === "pessoa" ? a.responsavel.pessoaId : a.responsavel.agenteId] ?? "alguém"}`
                  : ""}
                {a.prazo ? `, prazo em ${a.prazo.emDias} dia(s)` : ""}
              </span>
            )}
            {a.tipo === "pedir_ao_agente" && (
              <>
                <span>
                  Para {d.nomes[a.agenteId] ?? "o agente"}, resultado{" "}
                  {a.resultado === "mensagem" ? "numa conversa (app e Telegram)" : "numa tarefa"}
                </span>
                <span className="whitespace-pre-wrap rounded-md bg-suave p-2">{a.pedido}</span>
              </>
            )}
            {a.tipo === "mandar_aviso" && (
              <>
                <span>Para {a.para.map((p) => d.nomes[p] ?? "alguém").join(", ")}</span>
                <span className="whitespace-pre-wrap rounded-md bg-suave p-2">{a.texto}</span>
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.podeMudar && (
              <Button variant="contorno" onClick={() => setEditando(true)}>
                Editar
              </Button>
            )}
            {d.podeApagar && (
              <Button
                variant="perigo"
                disabled={ocupado}
                onClick={() => {
                  if (confirm("Apagar a rotina? O histórico dela também some.")) void acao("", "DELETE");
                }}
              >
                Apagar
              </Button>
            )}
          </div>
        </Card>
      )}
      <Card>
        <CardTitulo>Histórico</CardTitulo>
        <CardDescricao>As vezes que a rotina rodou nos últimos 90 dias.</CardDescricao>
        {d.execucoes.length === 0 && <p className="text-sm text-texto-2">Ainda não rodou.</p>}
        <ul className="grid gap-2">
          {d.execucoes.map((e) => (
            <li key={e.id} className="grid gap-1 rounded-md border border-linha p-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn("rounded-full px-2 py-0.5 text-xs font-medium", COR_DA_EXECUCAO[e.situacao])}
                >
                  {NOME_DA_EXECUCAO[e.situacao]}
                </span>
                <span className="text-texto-2">
                  {quando(e.iniciadaEm ?? e.previstaPara ?? e.criadaEm)}
                  {e.origem === "rodar_agora" ? ", pelo Rodar agora" : ""}
                  {e.tentativa > 1 ? `, tentativa ${e.tentativa}` : ""}
                </span>
                {e.custo > 0 && <span className="text-texto-2">US$ {(e.custo / 100).toFixed(4)}</span>}
              </span>
              {e.motivo && <span className="text-texto-2">{e.motivo}</span>}
              <span className="flex flex-wrap gap-3">
                {e.tarefaId && (
                  <a className="text-tinta underline" href={`/tarefas/${e.tarefaId}`}>
                    Ver a tarefa
                  </a>
                )}
                {e.conversaId && (
                  <a className="text-tinta underline" href={`/conversa?c=${e.conversaId}`}>
                    Ver a conversa
                  </a>
                )}
                {e.execucaoDeAgenteId && (
                  <a className="text-tinta underline" href={`/execucoes/${e.execucaoDeAgenteId}`}>
                    Ver o passo a passo
                  </a>
                )}
                {e.avisados > 0 && <span className="text-texto-2">{e.avisados} pessoa(s) avisada(s)</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}

const FUSO_DAQUI = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
const hoje = () => new Date().toLocaleDateString("en-CA");
const caixa = "h-11 rounded-md border border-linha bg-cartao px-3 text-base";

/** O formulário: "quando" (repetição, horários, fuso, início e fim) e "o que fazer" (uma das três ações). */
export function FormularioDaRotina({
  inicial,
  aoCancelar,
  aoSalvar,
}: {
  inicial?: Rotina;
  aoCancelar: () => void;
  aoSalvar: (r: Rotina) => void;
}) {
  const pessoas = usePessoas();
  const agentes = useAgentesAtivos();
  const projetos = useProjetosAtivos();
  const internos = agentes.filter((x) => x.tipo === "interno");
  const g = inicial?.gatilho;
  const a = inicial?.acao;
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [frequencia, setFrequencia] = useState(g?.regra.frequencia ?? "semanal");
  const [intervalo, setIntervalo] = useState(String(g?.regra.intervalo ?? 1));
  const [dias, setDias] = useState<number[]>(g?.regra.diasDaSemana ?? [1]);
  const [diaDoMes, setDiaDoMes] = useState(String(g?.regra.diaDoMes ?? 1));
  const [horas, setHoras] = useState((g?.horas ?? ["08:00"]).join(", "));
  const [fuso, setFuso] = useState(g?.fuso ?? FUSO_DAQUI);
  const [inicio, setInicio] = useState(g?.inicio ?? hoje());
  const [ate, setAte] = useState(g?.regra.ate ?? "");
  const [vezes, setVezes] = useState(g?.regra.vezes ? String(g.regra.vezes) : "");
  const [tipo, setTipo] = useState<AcaoDaRotina["tipo"]>(a?.tipo ?? "pedir_ao_agente");
  const [titulo, setTitulo] = useState(a?.tipo === "criar_tarefa" ? a.titulo : "");
  const [descricao, setDescricao] = useState(a?.tipo === "criar_tarefa" ? (a.descricao ?? "") : "");
  const [responsavel, setResponsavel] = useState(
    a?.tipo === "criar_tarefa" ? valorDoResponsavel(a.responsavel ?? null) : "",
  );
  const [projetoId, setProjetoId] = useState(a?.tipo === "criar_tarefa" ? (a.projetoId ?? "") : "");
  const [prioridade, setPrioridade] = useState(a?.tipo === "criar_tarefa" ? (a.prioridade ?? "") : "");
  const [emDias, setEmDias] = useState(a?.tipo === "criar_tarefa" && a.prazo ? String(a.prazo.emDias) : "");
  const [agenteId, setAgenteId] = useState(a?.tipo === "pedir_ao_agente" ? a.agenteId : "");
  const [pedido, setPedido] = useState(a?.tipo === "pedir_ao_agente" ? a.pedido : "");
  const [skill, setSkill] = useState(a?.tipo === "pedir_ao_agente" ? (a.skill ?? "") : "");
  const [resultado, setResultado] = useState(a?.tipo === "pedir_ao_agente" ? a.resultado : "mensagem");
  const [para, setPara] = useState<string[]>(a?.tipo === "mandar_aviso" ? a.para : []);
  const [texto, setTexto] = useState(a?.tipo === "mandar_aviso" ? a.texto : "");
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!agenteId && internos[0]) setAgenteId(internos[0].id);
  }, [agenteId, internos]);

  function montar(): PedidoDeRotina | string {
    const listaDeHoras = [...new Set(horas.split(/[,\s]+/).filter(Boolean))];
    if (listaDeHoras.length === 0 || listaDeHoras.some((h) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)))
      return "Escreva os horários no formato 08:00, separados por vírgula.";
    const gatilho: GatilhoPorHorario = {
      tipo: "horario",
      regra: {
        frequencia,
        intervalo: Math.max(1, Number(intervalo) || 1),
        ...(frequencia === "semanal" && dias.length > 0 ? { diasDaSemana: [...dias].sort() } : {}),
        ...(frequencia === "mensal" ? { diaDoMes: Math.min(31, Math.max(1, Number(diaDoMes) || 1)) } : {}),
        ate: ate || null,
        vezes: vezes ? Number(vezes) : null,
      },
      horas: listaDeHoras.sort(),
      fuso,
      inicio,
    };
    let acao: AcaoDaRotina;
    if (tipo === "criar_tarefa") {
      if (!titulo.trim()) return "Escreva o título da tarefa.";
      acao = {
        tipo,
        titulo: titulo.trim(),
        descricao: descricao.trim() || null,
        responsavel: responsavelDoValor(responsavel),
        projetoId: projetoId || null,
        prioridade: (prioridade || null) as Prioridade | null,
        prazo: emDias ? { emDias: Number(emDias), hora: null } : null,
      };
    } else if (tipo === "pedir_ao_agente") {
      if (!agenteId) return "Escolha o agente.";
      if (!pedido.trim()) return "Escreva o que pedir ao agente.";
      acao = {
        tipo,
        agenteId,
        pedido: pedido.trim(),
        skill: skill.trim() || null,
        resultado: resultado as "mensagem" | "tarefa",
      };
    } else {
      if (para.length === 0) return "Escolha quem recebe o aviso.";
      if (!texto.trim()) return "Escreva o aviso.";
      acao = { tipo, para, texto: texto.trim(), link: null };
    }
    if (!nome.trim()) return "Dê um nome à rotina.";
    return { nome: nome.trim(), gatilho, acao };
  }

  async function salvar() {
    const corpo = montar();
    if (typeof corpo === "string") return setMensagem({ tipo: "erro", texto: corpo });
    setOcupado(true);
    const r = inicial
      ? await pedir<Rotina>("POST", `/rotinas/${inicial.id}`, corpo)
      : await pedir<Rotina>("POST", "/rotinas", corpo);
    setOcupado(false);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoSalvar(r.dados);
  }

  return (
    <Card>
      <CardTitulo>{inicial ? "Editar rotina" : "Nova rotina"}</CardTitulo>
      {!inicial && (
        <CardDescricao>Ela nasce desligada. Use "Rodar agora" para testar e depois ligue.</CardDescricao>
      )}
      <div className="grid gap-4">
        <Campo
          id="rotina-nome"
          rotulo="Nome"
          value={nome}
          maxLength={120}
          onChange={(e) => setNome(e.target.value)}
        />
        <fieldset className="grid gap-3 rounded-md border border-linha p-3">
          <legend className="px-1 text-sm font-medium">Quando</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              Repetir
              <select
                className={caixa}
                value={frequencia}
                onChange={(e) => setFrequencia(e.target.value as typeof frequencia)}
              >
                <option value="diaria">Todo dia (ou a cada N dias)</option>
                <option value="semanal">Dias da semana</option>
                <option value="mensal">Todo mês</option>
                <option value="anual">Todo ano</option>
              </select>
            </label>
            <Campo
              id="rotina-intervalo"
              rotulo="A cada (1 = sempre)"
              type="number"
              min={1}
              max={365}
              value={intervalo}
              onChange={(e) => setIntervalo(e.target.value)}
            />
          </div>
          {frequencia === "semanal" && (
            <fieldset className="flex flex-wrap gap-2" aria-label="Dias da semana">
              {DIAS.map((nomeDoDia, i) => (
                <label key={nomeDoDia} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={dias.includes(i)}
                    onChange={(e) => setDias(e.target.checked ? [...dias, i] : dias.filter((x) => x !== i))}
                  />
                  {nomeDoDia}
                </label>
              ))}
            </fieldset>
          )}
          {frequencia === "mensal" && (
            <Campo
              id="rotina-dia-do-mes"
              rotulo="Dia do mês (31 vira o último dia dos meses curtos)"
              type="number"
              min={1}
              max={31}
              value={diaDoMes}
              onChange={(e) => setDiaDoMes(e.target.value)}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              id="rotina-horas"
              rotulo="Horários (até 24, ex.: 08:00, 18:00)"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
            />
            <Campo
              id="rotina-fuso"
              rotulo="Fuso horário"
              value={fuso}
              onChange={(e) => setFuso(e.target.value)}
            />
            <Campo
              id="rotina-inicio"
              rotulo="Começa em"
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
            <Campo
              id="rotina-ate"
              rotulo="Termina em (opcional)"
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
            />
            <Campo
              id="rotina-vezes"
              rotulo="Ou depois de quantas vezes (opcional)"
              type="number"
              min={1}
              value={vezes}
              onChange={(e) => setVezes(e.target.value)}
            />
          </div>
        </fieldset>
        <fieldset className="grid gap-3 rounded-md border border-linha p-3">
          <legend className="px-1 text-sm font-medium">O que fazer</legend>
          <label className="grid gap-1.5 text-sm font-medium">
            Ação
            <select
              className={caixa}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as AcaoDaRotina["tipo"])}
            >
              <option value="pedir_ao_agente">Pedir a um agente</option>
              <option value="criar_tarefa">Criar uma tarefa</option>
              <option value="mandar_aviso">Mandar um aviso</option>
            </select>
          </label>
          {tipo === "pedir_ao_agente" && (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                Agente
                <select className={caixa} value={agenteId} onChange={(e) => setAgenteId(e.target.value)}>
                  {internos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                O pedido
                <textarea
                  className="min-h-28 rounded-md border border-linha bg-cartao p-3 text-base"
                  maxLength={4000}
                  value={pedido}
                  onChange={(e) => setPedido(e.target.value)}
                />
              </label>
              <Campo
                id="rotina-skill"
                rotulo="Skill do agente (opcional, ex.: plataforma:planejar-tarefas)"
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
              />
              <label className="grid gap-1.5 text-sm font-medium">
                Onde chega o resultado
                <select
                  className={caixa}
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value as "mensagem" | "tarefa")}
                >
                  <option value="mensagem">Numa conversa comigo (no app e no Telegram)</option>
                  <option value="tarefa">Numa tarefa nova do agente</option>
                </select>
              </label>
            </>
          )}
          {tipo === "criar_tarefa" && (
            <>
              <Campo
                id="rotina-titulo"
                rotulo="Título da tarefa"
                maxLength={200}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
              />
              <label className="grid gap-1.5 text-sm font-medium">
                Descrição (opcional)
                <textarea
                  className="min-h-20 rounded-md border border-linha bg-cartao p-3 text-base"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 text-sm font-medium">
                  <label htmlFor="rotina-responsavel">Responsável</label>
                  <SeletorDeResponsavel
                    id="rotina-responsavel"
                    valor={responsavel}
                    aoMudar={setResponsavel}
                    pessoas={pessoas}
                    agentes={agentes}
                    extras={[{ valor: "", nome: "Eu (dono da rotina)" }]}
                  />
                </div>
                <label className="grid gap-1.5 text-sm font-medium">
                  Projeto
                  <select className={caixa} value={projetoId} onChange={(e) => setProjetoId(e.target.value)}>
                    <option value="">Sem projeto</option>
                    {projetos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Prioridade
                  <select
                    className={caixa}
                    value={prioridade}
                    onChange={(e) => setPrioridade(e.target.value)}
                  >
                    <option value="">Sem prioridade</option>
                    <option value="urgente">Urgente</option>
                    <option value="alta">Alta</option>
                    <option value="normal">Normal</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </label>
                <Campo
                  id="rotina-prazo"
                  rotulo="Prazo em quantos dias (opcional)"
                  type="number"
                  min={0}
                  max={365}
                  value={emDias}
                  onChange={(e) => setEmDias(e.target.value)}
                />
              </div>
            </>
          )}
          {tipo === "mandar_aviso" && (
            <>
              <div className="grid gap-1.5 text-sm">
                <span className="font-medium">Quem recebe</span>
                <div className="flex flex-wrap gap-3">
                  {pessoas.map((p) => (
                    <label key={p.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={para.includes(p.id)}
                        onChange={(e) =>
                          setPara(e.target.checked ? [...para, p.id] : para.filter((x) => x !== p.id))
                        }
                      />
                      {p.nome}
                    </label>
                  ))}
                </div>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                O aviso
                <textarea
                  className="min-h-20 rounded-md border border-linha bg-cartao p-3 text-base"
                  maxLength={300}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
              </label>
            </>
          )}
        </fieldset>
        {mensagem && <Aviso tipo={mensagem.tipo} texto={mensagem.texto} />}
        <div className="flex flex-wrap gap-2">
          <Button disabled={ocupado} onClick={() => void salvar()}>
            Salvar
          </Button>
          <Button variant="contorno" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </div>
    </Card>
  );
}
