/**
 * Agentes › Contas de IA (M4-01): conectar, testar, trocar a chave, liberar modelos e apagar. Só o administrador
 * (a API confere de novo). A chave só entra: a tela nunca recebe a chave de volta, só os 4 últimos caracteres.
 */
import type { ContaDeIa, ContaDeIaNaLista, ModeloDaConta, ProvedorDeIa } from "@mago-os/contratos";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Campo } from "@/componentes/ui/campo";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";
import { ConfirmarSegundoFator } from "./DoisFatores";

type Mensagem = { texto: string; tipo: "erro" | "ok" } | null;

type ContaNaLista = ContaDeIaNaLista;

const NOME_DO_PROVEDOR: Record<ProvedorDeIa, string> = {
  anthropic: "Anthropic",
  compativel_openai: "Compatível com OpenAI",
  chatgpt: "ChatGPT (assinatura)",
};

const dolares = (centavos: number) =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD" });

/** Teto em dólares digitado na tela (vazio: sem teto) para centavos. */
function tetoEmCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (limpo === "") return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : Number.NaN;
}

export function ContasDeIa({
  podeCriar,
  podeEditar,
  podeExcluir,
}: {
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [lista, setLista] = useState<{ ligado: boolean; contas: ContaNaLista[] } | null>(null);
  const [conectando, setConectando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<{ ligado: boolean; contas: ContaNaLista[] }>("GET", "/ia/contas");
    setLista(r.ok && r.dados ? r.dados : { ligado: false, contas: [] });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/agentes" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
        <ArrowLeft className="size-4" /> Agentes
      </a>
      <div className="flex items-center justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Contas de IA</h1>
          <p className="text-sm text-texto-2">
            As chaves dos provedores de IA que os agentes internos usam. A chave fica guardada cifrada e
            ninguém consegue ler de volta, nem o administrador.
          </p>
        </div>
        {podeCriar && lista?.ligado && !conectando && (
          <Button onClick={() => setConectando(true)}>
            <Plus /> Conectar
          </Button>
        )}
      </div>
      {lista && !lista.ligado && (
        <Aviso tipo="erro" texto="As contas de IA ainda não foram ligadas neste servidor." />
      )}
      {conectando && (
        <FormularioDeConexao
          aoCancelar={() => setConectando(false)}
          aoSalvar={(id) => {
            setConectando(false);
            setAberta(id);
            void carregar();
          }}
        />
      )}
      {lista && lista.contas.length === 0 && lista.ligado && (
        <p className="text-sm text-texto-2">Nenhuma conta de IA conectada.</p>
      )}
      <ul className="grid gap-2">
        {lista?.contas.map((c) => (
          <li key={c.id}>
            {aberta === c.id ? (
              <DetalheDaConta
                conta={c}
                podeEditar={podeEditar}
                podeExcluir={podeExcluir}
                aoFechar={() => setAberta(null)}
                aoMudar={() => void carregar()}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAberta(c.id)}
                className="grid w-full gap-1.5 rounded-lg border border-linha bg-cartao p-3 text-left transition-colors hover:bg-suave"
              >
                <span className="flex items-center gap-2 font-medium">
                  <KeyRound className="size-4 text-texto-2" /> {c.nome}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
                  <SituacaoDaConta conta={c} />
                  <span>{NOME_DO_PROVEDOR[c.provedor]}</span>
                  <span className="font-mono">…{c.finalDaChave}</span>
                  <span>
                    {c.liberados} de {c.modelos} modelos liberados
                  </span>
                  {c.tetoMensal !== null && <span>Teto {dolares(c.tetoMensal)} por mês</span>}
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

function SituacaoDaConta({ conta }: { conta: ContaDeIa }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-medium",
        conta.situacao === "ativa" ? "bg-ok/10 text-ok" : "bg-perigo/10 text-perigo",
      )}
    >
      {conta.situacao === "ativa" ? "Funcionando" : "Com erro"}
    </span>
  );
}

function FormularioDeConexao({
  aoCancelar,
  aoSalvar,
}: {
  aoCancelar: () => void;
  aoSalvar: (id: string) => void;
}) {
  const [provedor, setProvedor] = useState<ProvedorDeIa>("anthropic");
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmar, setConfirmar] = useState<Record<string, unknown> | null>(null);

  async function enviar(corpo: Record<string, unknown>) {
    setEnviando(true);
    setMensagem(null);
    const r = await pedir<ContaDeIa>("POST", "/ia/contas", corpo);
    setEnviando(false);
    if (r.ok && r.dados) return aoSalvar(r.dados.id);
    if (r.codigo === "CONFIRMACAO_NECESSARIA") return setConfirmar(corpo);
    setMensagem({ tipo: "erro", texto: r.mensagem ?? "Não foi possível conectar." });
  }

  function aoEnviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const f = new FormData(evento.currentTarget);
    const teto = tetoEmCentavos(String(f.get("teto") ?? ""));
    if (Number.isNaN(teto))
      return setMensagem({ tipo: "erro", texto: "Escreva o teto em dólares, ex.: 50." });
    void enviar({
      nome: String(f.get("nome")).trim(),
      provedor,
      ...(provedor === "compativel_openai" ? { endereco: String(f.get("endereco")).trim() } : {}),
      chave: String(f.get("chave")).trim(),
      tetoMensal: teto,
    });
  }

  if (confirmar)
    return (
      <ConfirmarSegundoFator
        aoConfirmar={() => {
          const corpo = confirmar;
          setConfirmar(null);
          void enviar(corpo);
        }}
      />
    );

  return (
    <Card className="gap-3">
      <CardTitulo>Conectar conta de IA</CardTitulo>
      <CardDescricao>
        O Mago OS testa a chave antes de guardar e lista os modelos. Os modelos chegam desligados: você
        escolhe quais os agentes podem usar.
      </CardDescricao>
      <form className="grid gap-3" onSubmit={aoEnviar} autoComplete="off">
        <Campo
          id="nome-da-conta"
          name="nome"
          rotulo="Nome"
          required
          maxLength={80}
          placeholder="Ex.: Anthropic da Nolask"
        />
        <div className="grid gap-1.5">
          <label htmlFor="provedor" className="text-sm font-medium">
            Provedor
          </label>
          <select
            id="provedor"
            value={provedor}
            onChange={(e) => setProvedor(e.target.value as ProvedorDeIa)}
            className="h-11 rounded-md border border-linha bg-cartao px-3 text-base"
          >
            <option value="anthropic">Anthropic</option>
            <option value="compativel_openai">
              Compatível com OpenAI (OpenAI, OpenRouter, DeepSeek, Groq...)
            </option>
          </select>
        </div>
        {provedor === "compativel_openai" && (
          <Campo
            id="endereco"
            name="endereco"
            rotulo="Endereço da API"
            required
            maxLength={300}
            placeholder="Ex.: https://openrouter.ai/api/v1"
          />
        )}
        <Campo
          id="chave"
          name="chave"
          type="password"
          rotulo="Chave"
          required
          minLength={8}
          maxLength={400}
          autoComplete="off"
          spellCheck={false}
        />
        <Campo
          id="teto"
          name="teto"
          inputMode="decimal"
          rotulo="Teto por mês em dólares (opcional)"
          placeholder="Ex.: 50"
        />
        {mensagem && <Aviso {...mensagem} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={enviando}>
            {enviando ? "Testando..." : "Testar e conectar"}
          </Button>
          <Button type="button" variant="fantasma" onClick={aoCancelar}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DetalheDaConta({
  conta,
  podeEditar,
  podeExcluir,
  aoFechar,
  aoMudar,
}: {
  conta: ContaNaLista;
  podeEditar: boolean;
  podeExcluir: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const [modelos, setModelos] = useState<ModeloDaConta[]>([]);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [trocando, setTrocando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const base = `/ia/contas/${encodeURIComponent(conta.id)}`;
  const carregar = useCallback(async () => {
    const r = await pedir<ModeloDaConta[]>("GET", `${base}/modelos`);
    if (r.ok && r.dados) setModelos(r.dados);
  }, [base]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function testar() {
    setOcupado(true);
    const r = await pedir<ContaDeIa & { modelosNovos: number }>("POST", `${base}/testar`, {});
    setOcupado(false);
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem(
      r.dados.situacao === "ativa"
        ? {
            tipo: "ok",
            texto:
              r.dados.modelosNovos > 0
                ? `Funcionando. ${r.dados.modelosNovos} modelo(s) novo(s), desligado(s).`
                : "Funcionando.",
          }
        : { tipo: "erro", texto: r.dados.ultimoErro ?? "A chave não funcionou." },
    );
    aoMudar();
    void carregar();
  }

  async function liberar(m: ModeloDaConta, liberado: boolean) {
    // Mostra a mudança na hora; se a API recusar, a lista volta ao que está gravado.
    setModelos((lista) => lista.map((x) => (x.modelo === m.modelo ? { ...x, liberado } : x)));
    const r = await pedir<ModeloDaConta[]>("POST", `${base}/modelos`, {
      modelos: [{ modelo: m.modelo, liberado }],
    });
    if (!r.ok || !r.dados) {
      void carregar();
      return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    }
    setModelos(r.dados);
    setMensagem(null);
    aoMudar();
  }

  async function trocar(chave: string) {
    setOcupado(true);
    const r = await pedir<ContaDeIa>("POST", base, { chave });
    setOcupado(false);
    if (r.codigo === "CONFIRMACAO_NECESSARIA") return setConfirmar(chave);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setTrocando(false);
    setMensagem({ tipo: "ok", texto: "Chave trocada." });
    aoMudar();
    void carregar();
  }

  async function apagar() {
    if (
      !window.confirm(
        `Apagar a conta "${conta.nome}"? A chave é apagada do cofre e os agentes que usam esta conta ficam sem modelo.`,
      )
    )
      return;
    const r = await pedir<null>("DELETE", base);
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    aoFechar();
    aoMudar();
  }

  if (confirmar)
    return (
      <ConfirmarSegundoFator
        aoConfirmar={() => {
          const chave = confirmar;
          setConfirmar(null);
          void trocar(chave);
        }}
      />
    );

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitulo>{conta.nome}</CardTitulo>
        <Button size="pequeno" variant="fantasma" onClick={aoFechar}>
          Fechar
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
        <SituacaoDaConta conta={conta} />
        <span>{NOME_DO_PROVEDOR[conta.provedor]}</span>
        {conta.endereco && <span className="break-all">{conta.endereco}</span>}
        <span className="font-mono">Chave …{conta.finalDaChave}</span>
        {conta.tetoMensal !== null && <span>Teto {dolares(conta.tetoMensal)} por mês</span>}
      </div>
      {conta.situacao === "com_erro" && conta.ultimoErro && <Aviso tipo="erro" texto={conta.ultimoErro} />}
      {mensagem && <Aviso {...mensagem} />}
      {(podeEditar || podeExcluir) && (
        <div className="flex flex-wrap gap-2">
          {podeEditar && (
            <Button size="pequeno" variant="contorno" disabled={ocupado} onClick={() => void testar()}>
              Testar de novo
            </Button>
          )}
          {podeEditar && !trocando && (
            <Button size="pequeno" variant="contorno" onClick={() => setTrocando(true)}>
              Trocar a chave
            </Button>
          )}
          {podeExcluir && (
            <Button size="pequeno" variant="fantasma" className="text-perigo" onClick={() => void apagar()}>
              Apagar
            </Button>
          )}
        </div>
      )}
      {trocando && (
        <form
          className="grid gap-3"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            void trocar(String(new FormData(e.currentTarget).get("chave")).trim());
          }}
        >
          <Campo
            id="chave-nova"
            name="chave"
            type="password"
            rotulo="Chave nova"
            required
            minLength={8}
            maxLength={400}
          />
          <div className="flex gap-2">
            <Button type="submit" size="pequeno" disabled={ocupado}>
              {ocupado ? "Testando..." : "Testar e trocar"}
            </Button>
            <Button type="button" size="pequeno" variant="fantasma" onClick={() => setTrocando(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">Modelos</p>
        {modelos.length === 0 && <p className="text-sm text-texto-2">O provedor não listou modelos.</p>}
        <ul className="grid gap-1.5">
          {modelos.map((m) => (
            <li key={m.modelo} className="flex items-center gap-2 rounded-md border border-linha p-2 text-sm">
              <span className="font-mono text-xs">{m.modelo}</span>
              {m.sumiu && (
                <span className="rounded-full bg-suave px-2 py-0.5 text-xs text-texto-2">
                  Saiu do provedor
                </span>
              )}
              {podeEditar ? (
                <label className="ml-auto flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={m.liberado}
                    disabled={m.sumiu && !m.liberado}
                    onChange={(e) => void liberar(m, e.target.checked)}
                    aria-label={`Liberar ${m.modelo}`}
                  />
                  Liberado
                </label>
              ) : (
                <span className="ml-auto text-xs text-texto-2">{m.liberado ? "Liberado" : "Desligado"}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
