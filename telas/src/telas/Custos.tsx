/**
 * Agentes › Custos (M4-06): quanto os agentes internos gastaram no mês (com hoje em destaque), por agente, por conta
 * e por dia, os tetos editáveis (empresa e agentes), o limite em tokens das contas por assinatura e o preço dos
 * modelos sem preço. O mês segue o fuso da empresa.
 */
import type { AoChegarNoLimite, ResumoDeCustos } from "@mago-os/contratos";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

type Mensagem = { tipo: "erro" | "ok"; texto: string } | null;

/** Microdólares em dólares ("US$ 1,23"; abaixo de 1 dólar, com quatro casas). */
export function dolares(micros: number): string {
  const d = micros / 1_000_000;
  return `US$ ${d.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: d < 1 ? 4 : 2 })}`;
}
const tokens = (n: number) => n.toLocaleString("pt-BR");

function Barra({ usado, limite }: { usado: number; limite: number | null }) {
  if (limite === null || limite <= 0) return null;
  const p = Math.min(100, (usado / limite) * 100);
  return (
    <div className="h-1.5 w-full rounded-full bg-suave" aria-hidden="true">
      <div
        className={cn("h-1.5 rounded-full", p >= 100 ? "bg-perigo" : p >= 80 ? "bg-alerta" : "bg-ok")}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/** Teto em dólar (centavos), com salvar. Vazio = sem teto. */
function CampoDeTeto({
  rotulo,
  teto,
  podeEditar,
  aoSalvar,
}: {
  rotulo: string;
  teto: number | null;
  podeEditar: boolean;
  aoSalvar: (centavos: number | null) => Promise<void>;
}) {
  const [valor, setValor] = useState(teto === null ? "" : String(teto / 100));
  useEffect(() => setValor(teto === null ? "" : String(teto / 100)), [teto]);
  if (!podeEditar)
    return (
      <span className="text-xs text-texto-2">
        Teto: {teto === null ? "sem teto" : dolares(teto * 10_000)}
      </span>
    );
  return (
    <form
      className="flex items-center gap-1.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const n = valor.trim() === "" ? null : Math.round(Number(valor.replace(",", ".")) * 100);
        if (n !== null && (!Number.isFinite(n) || n < 0)) return;
        void aoSalvar(n);
      }}
    >
      <label className="flex items-center gap-1">
        Teto US$
        <input
          aria-label={rotulo}
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="sem teto"
          className="h-8 w-20 rounded-md border border-linha bg-cartao px-2 text-xs"
        />
      </label>
      <Button size="pequeno" variant="contorno" type="submit">
        Salvar
      </Button>
    </form>
  );
}

function LimiteDeTokens({
  conta,
  podeEditar,
  aoSalvar,
}: {
  conta: ResumoDeCustos["porConta"][number];
  podeEditar: boolean;
  aoSalvar: (tokens: number | null, aoChegar: AoChegarNoLimite) => Promise<void>;
}) {
  const [valor, setValor] = useState(conta.avisoDeTokens === null ? "" : String(conta.avisoDeTokens));
  const [aoChegar, setAoChegar] = useState<AoChegarNoLimite>(conta.aoChegar);
  if (!podeEditar)
    return (
      <span className="text-xs text-texto-2">
        Limite: {conta.avisoDeTokens === null ? "sem limite" : `${tokens(conta.avisoDeTokens)} tokens`} (
        {conta.aoChegar === "avisar" ? "só avisa" : "avisa e para"})
      </span>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const n = valor.trim() === "" ? null : Number(valor);
        if (n !== null && (!Number.isInteger(n) || n < 1000)) return;
        void aoSalvar(n, aoChegar);
      }}
    >
      <label className="flex items-center gap-1">
        Limite de tokens no mês
        <input
          aria-label={`Limite de tokens de ${conta.nome}`}
          type="number"
          min={1000}
          step={1000}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="sem limite"
          className="h-8 w-28 rounded-md border border-linha bg-cartao px-2 text-xs"
        />
      </label>
      <select
        aria-label={`Ao chegar no limite de ${conta.nome}`}
        value={aoChegar}
        onChange={(e) => setAoChegar(e.target.value as AoChegarNoLimite)}
        className="h-8 rounded-md border border-linha bg-cartao px-2 text-xs"
      >
        <option value="avisar">Só avisar</option>
        <option value="parar">Avisar e parar aos 100%</option>
      </select>
      <Button size="pequeno" variant="contorno" type="submit">
        Salvar
      </Button>
    </form>
  );
}

function PrecoDoModelo({
  contaId,
  modelo,
  aoSalvar,
}: {
  contaId: string;
  modelo: string;
  aoSalvar: (
    contaId: string,
    modelo: string,
    preco: { entrada: number; saida: number; cache: number },
  ) => Promise<void>;
}) {
  const [p, setP] = useState({ entrada: "", saida: "", cache: "" });
  const centavos = (x: string) => Math.round(Number(x.replace(",", ".")) * 100);
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        const preco = {
          entrada: centavos(p.entrada),
          saida: centavos(p.saida),
          cache: centavos(p.cache || "0"),
        };
        if (![preco.entrada, preco.saida, preco.cache].every((n) => Number.isFinite(n) && n >= 0)) return;
        void aoSalvar(contaId, modelo, preco);
      }}
    >
      <span className="font-medium">{modelo}</span>
      <span className="text-texto-2">US$ por milhão de tokens:</span>
      {(["entrada", "saida", "cache"] as const).map((k) => (
        <label key={k} className="flex items-center gap-1">
          {{ entrada: "entrada", saida: "saída", cache: "cache" }[k]}
          <input
            aria-label={`Preço de ${k} de ${modelo}`}
            inputMode="decimal"
            value={p[k]}
            onChange={(e) => setP({ ...p, [k]: e.target.value })}
            required={k !== "cache"}
            className="h-8 w-16 rounded-md border border-linha bg-cartao px-2 text-xs"
          />
        </label>
      ))}
      <Button size="pequeno" variant="contorno" type="submit">
        Dar o preço
      </Button>
    </form>
  );
}

export function Custos({ podeEditar }: { podeEditar: boolean }) {
  const [mes, setMes] = useState("");
  const [r, setR] = useState<ResumoDeCustos | null>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregar = useCallback(async () => {
    const resposta = await pedir<ResumoDeCustos>("GET", `/custos${mes ? `?mes=${mes}` : ""}`);
    if (resposta.ok && resposta.dados) setR(resposta.dados);
    else setMensagem({ tipo: "erro", texto: resposta.mensagem ?? "" });
  }, [mes]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvar = async (caminho: string, corpo: unknown, ok: string) => {
    const resposta = await pedir("POST", caminho, corpo);
    setMensagem(resposta.ok ? { tipo: "ok", texto: ok } : { tipo: "erro", texto: resposta.mensagem ?? "" });
    void carregar();
  };

  if (!r) return <main className="px-4 py-8 text-sm text-texto-2">Carregando...</main>;
  const maiorDia = Math.max(1, ...r.porDia.map((d) => d.custo));
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/agentes" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
        <ArrowLeft className="size-4" /> Agentes
      </a>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Custos</h1>
          <p className="text-sm text-texto-2">
            Quanto os agentes internos gastaram com IA. Plano de assinatura conta os tokens com custo zero.
          </p>
        </div>
        <label className="grid gap-1 text-xs text-texto-2">
          Mês
          <input
            type="month"
            value={mes || r.mes}
            onChange={(e) => setMes(e.target.value)}
            className="h-9 rounded-md border border-linha bg-cartao px-2 text-sm text-tinta"
          />
        </label>
      </div>
      {mensagem && <Aviso {...mensagem} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="gap-1">
          <CardDescricao>Hoje</CardDescricao>
          <p className="text-2xl font-bold">{dolares(r.hoje.custo)}</p>
          <p className="text-xs text-texto-2">{tokens(r.hoje.tokens)} tokens</p>
        </Card>
        <Card className="gap-2">
          <CardDescricao>No mês ({r.mes})</CardDescricao>
          <p className="text-2xl font-bold">{dolares(r.total.custo)}</p>
          <Barra usado={r.total.custo} limite={r.tetoDaEmpresa === null ? null : r.tetoDaEmpresa * 10_000} />
          <CampoDeTeto
            rotulo="Teto da empresa"
            teto={r.tetoDaEmpresa}
            podeEditar={podeEditar}
            aoSalvar={(teto) => salvar("/custos/tetos/empresa", { teto }, "Teto da empresa salvo.")}
          />
        </Card>
      </div>

      {r.semPreco.length > 0 && (
        <Card className="gap-2">
          <CardTitulo>Modelos sem preço</CardTitulo>
          <CardDescricao>
            O custo destes modelos foi contado pelo maior preço da tabela, para o teto continuar protegendo.
            Dê o preço certo para o painel acertar daqui em diante.
          </CardDescricao>
          {r.semPreco.map((m) =>
            podeEditar ? (
              <PrecoDoModelo
                key={`${m.contaId}:${m.modelo}`}
                contaId={m.contaId}
                modelo={m.modelo}
                aoSalvar={(contaId, modelo, preco) =>
                  salvar(`/ia/contas/${contaId}/precos`, { modelo, preco }, `Preço de ${modelo} salvo.`)
                }
              />
            ) : (
              <p key={`${m.contaId}:${m.modelo}`} className="text-sm">
                {m.modelo}
              </p>
            ),
          )}
        </Card>
      )}

      <Card className="gap-3">
        <CardTitulo>Por agente</CardTitulo>
        <ul className="grid gap-3">
          {r.porAgente.map((a) => (
            <li key={a.agenteId} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{a.nome}</span>
                <span className="text-texto-2">
                  hoje {dolares(a.hoje.custo)} · mês {dolares(a.mes.custo)} ({tokens(a.mes.tokens)} tokens)
                </span>
              </div>
              <Barra usado={a.mes.custo} limite={a.teto === null ? null : a.teto * 10_000} />
              <CampoDeTeto
                rotulo={`Teto de ${a.nome}`}
                teto={a.teto}
                podeEditar={podeEditar}
                aoSalvar={(teto) =>
                  salvar(`/custos/tetos/agente/${a.agenteId}`, { teto }, `Teto de ${a.nome} salvo.`)
                }
              />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="gap-3">
        <CardTitulo>Por conta de IA</CardTitulo>
        <CardDescricao>
          O teto em dólar das contas por chave de API fica em Agentes › Contas de IA. Nas contas por
          assinatura, o limite é em tokens: só avisar, ou avisar e parar aos 100%.
        </CardDescricao>
        <ul className="grid gap-3">
          {r.porConta.map((k) => (
            <li key={k.contaId} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{k.nome}</span>
                <span className="text-texto-2">
                  {dolares(k.mes.custo)} · {tokens(k.mes.tokens)} tokens
                </span>
              </div>
              {k.credencial === "assinatura" ? (
                <>
                  <Barra usado={k.mes.tokens} limite={k.avisoDeTokens} />
                  <LimiteDeTokens
                    key={`${k.avisoDeTokens}:${k.aoChegar}`}
                    conta={k}
                    podeEditar={podeEditar}
                    aoSalvar={(tokensNovos, aoChegar) =>
                      salvar(
                        `/ia/contas/${k.contaId}/limite-de-tokens`,
                        { tokens: tokensNovos, aoChegar },
                        `Limite de ${k.nome} salvo.`,
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <Barra usado={k.mes.custo} limite={k.teto === null ? null : k.teto * 10_000} />
                  <span className="text-xs text-texto-2">
                    Teto: {k.teto === null ? "sem teto" : dolares(k.teto * 10_000)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="gap-2">
        <CardTitulo>Por dia</CardTitulo>
        {r.porDia.length === 0 ? (
          <p className="text-sm text-texto-2">Nenhum gasto neste mês.</p>
        ) : (
          <ul className="grid gap-1">
            {r.porDia.map((d) => (
              <li key={d.dia} className="grid grid-cols-[5rem_1fr_6rem] items-center gap-2 text-xs">
                <span>
                  {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}
                </span>
                <span className="h-2 rounded-full bg-suave">
                  <span
                    className="block h-2 rounded-full bg-tinta"
                    style={{ width: `${(d.custo / maiorDia) * 100}%` }}
                  />
                </span>
                <span className="text-right">{dolares(d.custo)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
