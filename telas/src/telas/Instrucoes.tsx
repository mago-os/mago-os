/**
 * Agentes › Instruções (M4-05): as camadas que a empresa escreve (empresa, projeto, agente), com o histórico de
 * versões (comparar e voltar) e o texto final que cada agente recebe. A camada da plataforma vem do sistema.
 */
import {
  CARACTERES_POR_CAMADA,
  CARACTERES_RECOMENDADOS,
  type CamadaDaEmpresa,
  type InstrucoesMontadas,
  type VersaoDeInstrucoes,
} from "@mago-os/contratos";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type AgenteNaLista, listarAgentes } from "@/agentes";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { cn } from "@/lib/utils";
import { listarProjetos } from "@/projetos";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

/** Diferença linha a linha (LCS), para comparar duas versões. */
export function diferencaPorLinha(
  antes: string,
  depois: string,
): { tipo: "igual" | "saiu" | "entrou"; linha: string }[] {
  const a = antes.split("\n");
  const b = depois.split("\n");
  const m = a.length;
  const n = b.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      (t[i] as number[])[j] =
        a[i] === b[j]
          ? ((t[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((t[i + 1] as number[])[j] as number, (t[i] as number[])[j + 1] as number);
  const r: { tipo: "igual" | "saiu" | "entrou"; linha: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      r.push({ tipo: "igual", linha: a[i] as string });
      i++;
      j++;
    } else if (((t[i + 1] as number[])[j] as number) >= ((t[i] as number[])[j + 1] as number))
      r.push({ tipo: "saiu", linha: a[i++] as string });
    else r.push({ tipo: "entrou", linha: b[j++] as string });
  }
  while (i < m) r.push({ tipo: "saiu", linha: a[i++] as string });
  while (j < n) r.push({ tipo: "entrou", linha: b[j++] as string });
  return r;
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function EditorDaCamada({ camada, alvoId }: { camada: CamadaDaEmpresa; alvoId: string | null }) {
  const caminho = `/instrucoes/${camada}${alvoId ? `/${encodeURIComponent(alvoId)}` : ""}`;
  const [dados, setDados] = useState<{
    atual: VersaoDeInstrucoes | null;
    versoes: VersaoDeInstrucoes[];
    podeEditar: boolean;
  } | null>(null);
  const [texto, setTexto] = useState("");
  const [comparando, setComparando] = useState<VersaoDeInstrucoes | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const carregar = useCallback(async () => {
    const r = await pedir<{
      atual: VersaoDeInstrucoes | null;
      versoes: VersaoDeInstrucoes[];
      podeEditar: boolean;
    }>("GET", caminho);
    if (r.ok && r.dados) {
      setDados(r.dados);
      setTexto(r.dados.atual?.texto ?? "");
    }
  }, [caminho]);
  useEffect(() => {
    setComparando(null);
    setMensagem(null);
    void carregar();
  }, [carregar]);

  async function salvar() {
    const r = await pedir<VersaoDeInstrucoes>("POST", caminho, { texto });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({ tipo: "ok", texto: `Salvo como versão ${r.dados?.versao}.` });
    void carregar();
  }
  async function voltar(versao: number) {
    const r = await pedir<VersaoDeInstrucoes>("POST", `${caminho}/voltar`, { versao });
    if (!r.ok) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setMensagem({
      tipo: "ok",
      texto: `Voltou para a versão ${versao} (salva como versão ${r.dados?.versao}).`,
    });
    setComparando(null);
    void carregar();
  }

  if (!dados) return <p className="text-sm text-texto-2">Carregando...</p>;
  const mudou = texto !== (dados.atual?.texto ?? "");
  return (
    <div className="grid gap-3">
      {mensagem && <Aviso {...mensagem} />}
      <textarea
        aria-label="Instruções desta camada"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        readOnly={!dados.podeEditar}
        maxLength={CARACTERES_POR_CAMADA}
        rows={12}
        placeholder={
          dados.podeEditar ? "Escreva o que os agentes devem seguir." : "Nada escrito nesta camada."
        }
        className="w-full min-w-0 rounded-md border border-linha bg-cartao px-3 py-2 font-mono text-sm"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-texto-2">
        <span>
          {texto.length.toLocaleString("pt-BR")} de {CARACTERES_POR_CAMADA.toLocaleString("pt-BR")} caracteres
        </span>
        {dados.atual && <span>Versão atual: {dados.atual.versao}</span>}
        {dados.podeEditar && (
          <Button size="pequeno" className="ml-auto" disabled={!mudou} onClick={() => void salvar()}>
            Salvar versão nova
          </Button>
        )}
      </div>
      {dados.versoes.length > 0 && (
        <details className="rounded-md border border-linha p-2 text-sm">
          <summary className="cursor-pointer">Histórico ({dados.versoes.length} versões)</summary>
          <ul className="mt-2 grid gap-1">
            {dados.versoes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Versão {v.versao}</span>
                <span className="text-xs text-texto-2">
                  {quando(v.criadaEm)}
                  {v.voltouDe ? ` (volta para a ${v.voltouDe})` : ""}
                </span>
                <span className="ml-auto flex gap-1">
                  <Button size="pequeno" variant="fantasma" onClick={() => setComparando(v)}>
                    Comparar com a atual
                  </Button>
                  {dados.podeEditar && v.versao !== dados.atual?.versao && (
                    <Button size="pequeno" variant="contorno" onClick={() => void voltar(v.versao)}>
                      Voltar para esta
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {comparando && (
            <div className="mt-3 grid gap-1">
              <p className="text-xs text-texto-2">
                Versão {comparando.versao} → versão atual ({dados.atual?.versao}). Em vermelho, o que saiu; em
                verde, o que entrou.
              </p>
              <pre
                data-comparacao
                className="overflow-x-auto rounded-md bg-suave p-2 text-xs whitespace-pre-wrap"
              >
                {diferencaPorLinha(comparando.texto, dados.atual?.texto ?? "").map((d, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: as linhas não têm id; a lista é refeita inteira.
                    key={i}
                    className={cn(
                      d.tipo === "saiu" && "bg-perigo/10 text-perigo",
                      d.tipo === "entrou" && "bg-ok/10 text-ok",
                    )}
                  >
                    {d.tipo === "saiu" ? "- " : d.tipo === "entrou" ? "+ " : "  "}
                    {d.linha}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

function TextoFinal({ agenteId }: { agenteId: string }) {
  const [m, setM] = useState<InstrucoesMontadas | null>(null);
  useEffect(() => {
    void pedir<InstrucoesMontadas>("GET", `/agentes/${encodeURIComponent(agenteId)}/instrucoes`).then((r) =>
      setM(r.ok && r.dados ? r.dados : null),
    );
  }, [agenteId]);
  if (!m) return null;
  return (
    <details className="rounded-md border border-linha p-2 text-sm">
      <summary className="cursor-pointer">
        Texto final que o agente recebe ({m.caracteres.toLocaleString("pt-BR")} caracteres)
      </summary>
      {m.passouDoRecomendado && (
        <p className="mt-2 text-sm text-alerta">
          Passou de {CARACTERES_RECOMENDADOS.toLocaleString("pt-BR")} caracteres: instrução longa pesa no
          custo e o agente perde atenção. Vale enxugar.
        </p>
      )}
      <p className="mt-2 text-xs text-texto-2">
        Camadas: {m.camadas.map((c) => `${c.nome}${c.versao ? ` (v${c.versao})` : ""}`).join(", ")}. A camada
        de um projeto entra quando o trabalho é numa tarefa dele.
      </p>
      <pre className="mt-2 overflow-x-auto rounded-md bg-suave p-2 text-xs whitespace-pre-wrap">
        {m.texto}
      </pre>
    </details>
  );
}

export function Instrucoes() {
  const [camada, setCamada] = useState<CamadaDaEmpresa>("empresa");
  const [agentes, setAgentes] = useState<AgenteNaLista[]>([]);
  const [projetos, setProjetos] = useState<{ id: string; nome: string }[]>([]);
  const [alvo, setAlvo] = useState("");
  useEffect(() => {
    void listarAgentes().then((r) => setAgentes((r.dados ?? []).filter((a) => a.situacao !== "desligado")));
    void listarProjetos().then((r) =>
      setProjetos((r.dados?.projetos ?? []).map((p) => ({ id: p.id, nome: p.nome }))),
    );
  }, []);
  const opcoes = camada === "agente" ? agentes : camada === "projeto" ? projetos : [];
  useEffect(() => setAlvo(opcoes[0]?.id ?? ""), [camada, opcoes.length]);

  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-5 md:py-8">
      <a href="/agentes" className="inline-flex items-center gap-1 text-sm text-texto-2 hover:text-tinta">
        <ArrowLeft className="size-4" /> Agentes
      </a>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Instruções</h1>
        <p className="text-sm text-texto-2">
          O que os agentes devem seguir, em camadas: plataforma (do sistema), empresa, projeto e agente. Em
          conflito, vale a da plataforma; entre as outras, a mais específica.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Camada">
        {(["empresa", "projeto", "agente"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={camada === c}
            onClick={() => setCamada(c)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              camada === c ? "bg-tinta text-sobre-tinta" : "text-texto-2 hover:bg-suave",
            )}
          >
            {{ empresa: "Empresa", projeto: "Projeto", agente: "Agente" }[c]}
          </button>
        ))}
      </div>
      <Card className="gap-3">
        <CardTitulo>
          {camada === "empresa"
            ? "Camada da empresa"
            : camada === "projeto"
              ? "Camada de um projeto"
              : "Camada de um agente"}
        </CardTitulo>
        <CardDescricao>
          {camada === "empresa"
            ? "Vale para todos os agentes da empresa. Edita o administrador."
            : camada === "projeto"
              ? "Vale quando o agente trabalha numa tarefa do projeto. Edita o diretor do projeto ou quem edita todos os projetos."
              : "Vale só para este agente. Edita o administrador."}
        </CardDescricao>
        {camada !== "empresa" && (
          <select
            aria-label={camada === "agente" ? "Agente" : "Projeto"}
            value={alvo}
            onChange={(e) => setAlvo(e.target.value)}
            className="h-9 w-full min-w-0 rounded-md border border-linha bg-cartao px-2 text-sm sm:w-72"
          >
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        )}
        {camada === "empresa" ? (
          <EditorDaCamada camada="empresa" alvoId={null} />
        ) : alvo ? (
          <EditorDaCamada key={`${camada}:${alvo}`} camada={camada} alvoId={alvo} />
        ) : (
          <p className="text-sm text-texto-2">{camada === "agente" ? "Nenhum agente." : "Nenhum projeto."}</p>
        )}
        {camada === "agente" && alvo && <TextoFinal key={alvo} agenteId={alvo} />}
      </Card>
    </main>
  );
}
