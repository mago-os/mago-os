/**
 * Regras por ação de um agente (M4-03): o que ele faz sozinho, o que pede aprovação e o que fica bloqueado. O
 * administrador muda tudo; o responsável pelo agente só deixa mais restrito; os outros só veem.
 */
import {
  APROVACOES_PARA_SUGERIR_LIBERAR,
  MODOS_DE_ACAO,
  type ModoDeAcao,
  type RegraDeAgente,
} from "@mago-os/contratos";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { Card, CardDescricao, CardTitulo } from "@/componentes/ui/card";
import { pedir } from "@/tarefas";
import { Aviso } from "./Acesso";

const NOME_DO_MODO: Record<ModoDeAcao, string> = {
  executa: "Executa sozinho",
  executa_nas_dele: "Sozinho só nas tarefas dele",
  pede_aprovacao: "Pede aprovação",
  bloqueado: "Bloqueado",
};

export function RegrasDoAgente({ agenteId }: { agenteId: string }) {
  const [dados, setDados] = useState<{
    regras: RegraDeAgente[];
    podeMudar: "tudo" | "restringir" | "nada";
  } | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null);
  const base = `/agentes/${encodeURIComponent(agenteId)}/regras`;
  const carregar = useCallback(async () => {
    const r = await pedir<{ regras: RegraDeAgente[]; podeMudar: "tudo" | "restringir" | "nada" }>(
      "GET",
      base,
    );
    if (r.ok && r.dados) setDados(r.dados);
  }, [base]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function mudar(acao: string, modo: ModoDeAcao | null) {
    const r = await pedir<RegraDeAgente[]>("POST", base, { regras: [{ acao, modo }] });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setDados((d) => (d ? { ...d, regras: r.dados as RegraDeAgente[] } : d));
    setMensagem({ tipo: "ok", texto: "Regra salva." });
  }

  const [paraTodas, setParaTodas] = useState<ModoDeAcao>("pede_aprovacao");

  /**
   * Muda todas de uma vez para o mesmo modo, onde ele cabe: as que só leem ficam em executa ou bloqueado, e o
   * responsável só deixa mais restrito. As que não cabem continuam como estão.
   */
  async function mudarTodas() {
    if (!dados) return;
    const ix = (m: ModoDeAcao) => MODOS_DE_ACAO.indexOf(m);
    const cabe = (r: RegraDeAgente) =>
      r.modo !== paraTodas &&
      (r.mudaDados || paraTodas === "executa" || paraTodas === "bloqueado") &&
      (dados.podeMudar === "tudo" || ix(paraTodas) >= ix(r.modo));
    const mudancas = dados.regras
      .filter(cabe)
      .map((r) => ({ acao: r.acao, modo: paraTodas === r.padrao ? null : paraTodas }));
    if (mudancas.length === 0) return setMensagem({ tipo: "ok", texto: "Nada a mudar." });
    const r = await pedir<RegraDeAgente[]>("POST", base, { regras: mudancas });
    if (!r.ok || !r.dados) return setMensagem({ tipo: "erro", texto: r.mensagem ?? "" });
    setDados((d) => (d ? { ...d, regras: r.dados as RegraDeAgente[] } : d));
    const ficaram = dados.regras.length - mudancas.length;
    setMensagem({
      tipo: "ok",
      texto: `${mudancas.length} ${mudancas.length === 1 ? "regra mudou" : "regras mudaram"}.${
        ficaram > 0 ? ` ${ficaram} ficaram como estavam (já estavam assim ou não aceitam esse modo).` : ""
      }`,
    });
  }

  if (!dados) return null;
  const indice = (m: ModoDeAcao) => MODOS_DE_ACAO.indexOf(m);
  return (
    <Card className="gap-3">
      <CardTitulo>Regras</CardTitulo>
      <CardDescricao>
        O que o agente faz sozinho e o que pede aprovação. Os pedidos de aprovação em aberto aparecem na
        central de prioridades e no sino, e vencem em 24 horas sem resposta. Todos os pedidos também aparecem
        na tela{" "}
        <a href="/aprovacoes" className="underline">
          Aprovações
        </a>
        .
      </CardDescricao>
      {mensagem && <Aviso {...mensagem} />}
      {dados.podeMudar !== "nada" && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-suave p-2 text-sm">
          <span>Mudar todas para</span>
          <select
            aria-label="Modo para todas as regras"
            value={paraTodas}
            onChange={(e) => setParaTodas(e.target.value as ModoDeAcao)}
            className="h-9 min-w-0 rounded-md border border-linha bg-cartao px-2 text-sm"
          >
            {MODOS_DE_ACAO.map((m) => (
              <option key={m} value={m}>
                {NOME_DO_MODO[m]}
              </option>
            ))}
          </select>
          <Button size="pequeno" variant="contorno" onClick={() => void mudarTodas()}>
            Aplicar a todas
          </Button>
        </div>
      )}
      <ul className="grid gap-1.5">
        {dados.regras.map((r) => {
          // O que só lê fica em executa ou bloqueado; o responsável só vai para os modos mais restritos.
          const modos = MODOS_DE_ACAO.filter(
            (m) =>
              (r.mudaDados || m === "executa" || m === "bloqueado") &&
              (dados.podeMudar === "tudo" || indice(m) >= indice(r.modo)),
          );
          const sugerir =
            r.modo === "pede_aprovacao" && r.aprovadasSemEdicao >= APROVACOES_PARA_SUGERIR_LIBERAR;
          return (
            <li
              key={r.acao}
              className="grid gap-1 rounded-md border border-linha p-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <span className="min-w-0">
                {r.nome}
                {r.ajustada && (
                  <span className="ml-2 text-xs text-texto-2">
                    (ajustada; padrão: {NOME_DO_MODO[r.padrao]})
                  </span>
                )}
                {sugerir && (
                  <span className="mt-1 block text-xs text-ok">
                    {r.aprovadasSemEdicao} aprovações seguidas sem edição: que tal deixar executar sozinho?
                  </span>
                )}
              </span>
              {dados.podeMudar === "nada" ? (
                <span className="text-xs text-texto-2">{NOME_DO_MODO[r.modo]}</span>
              ) : (
                <select
                  aria-label={`Regra de ${r.nome}`}
                  value={r.modo}
                  onChange={(e) => {
                    const m = e.target.value as ModoDeAcao;
                    void mudar(r.acao, m === r.padrao ? null : m);
                  }}
                  className="h-9 w-full min-w-0 rounded-md border border-linha bg-cartao px-2 text-sm sm:w-56"
                >
                  {modos.map((m) => (
                    <option key={m} value={m}>
                      {NOME_DO_MODO[m]}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
