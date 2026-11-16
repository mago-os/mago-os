import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type EstadoDaApi, lerSaude, nomeDoAmbiente } from "@/saude";
import { Button } from "./ui/button";
import { Card, CardDescricao, CardTitulo } from "./ui/card";

type Situacao = "ok" | "problema" | "espera";

function Linha({ rotulo, valor, situacao }: { rotulo: string; valor: string; situacao: Situacao }) {
  const cor = situacao === "ok" ? "bg-ok" : situacao === "problema" ? "bg-perigo" : "bg-texto-3";
  return (
    <div className="flex items-center justify-between gap-3 border-t border-linha py-3 first:border-t-0">
      <span className="text-sm text-texto-2">{rotulo}</span>
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className={`size-2 rounded-full ${cor}`} aria-hidden="true" />
        {valor}
      </span>
    </div>
  );
}

const A_CADA_MS = 30_000;

/** Cartão com o estado da API e do banco, conferido ao abrir e a cada 30 segundos. */
export function EstadoDoSistema() {
  const [estado, setEstado] = useState<EstadoDaApi>({ tipo: "carregando" });
  const [conferindo, setConferindo] = useState(false);

  const conferir = useCallback(async (sinal?: AbortSignal) => {
    setConferindo(true);
    try {
      setEstado(await lerSaude(sinal));
    } catch {
      // pedido cancelado ao sair da tela
    } finally {
      setConferindo(false);
    }
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    void conferir(controle.signal);
    const intervalo = setInterval(() => void conferir(controle.signal), A_CADA_MS);
    return () => {
      controle.abort();
      clearInterval(intervalo);
    };
  }, [conferir]);

  const api: [string, Situacao] =
    estado.tipo === "carregando"
      ? ["Conferindo…", "espera"]
      : estado.tipo === "api_fora"
        ? ["Fora do ar", "problema"]
        : ["No ar", "ok"];
  const banco: [string, Situacao] =
    estado.tipo === "ok"
      ? ["No ar", "ok"]
      : estado.tipo === "banco_fora"
        ? ["Fora do ar", "problema"]
        : ["Sem resposta", "espera"];
  const resumo =
    estado.tipo === "ok"
      ? `Tudo funcionando. A API respondeu em ${estado.ms} ms.`
      : estado.tipo === "banco_fora"
        ? "A API está no ar, mas não conseguiu falar com o banco."
        : estado.tipo === "api_fora"
          ? estado.motivo
          : "Conferindo a API e o banco.";

  return (
    <Card aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitulo>Estado do sistema</CardTitulo>
          <CardDescricao>{resumo}</CardDescricao>
        </div>
        <Button
          variant="contorno"
          size="icone"
          onClick={() => void conferir()}
          disabled={conferindo}
          aria-label="Conferir de novo"
          title="Conferir de novo"
        >
          <RefreshCw className={conferindo ? "animate-spin" : undefined} />
        </Button>
      </div>
      <div>
        <Linha rotulo="API" valor={api[0]} situacao={api[1]} />
        <Linha rotulo="Banco de dados" valor={banco[0]} situacao={banco[1]} />
        {"ambiente" in estado && (
          <Linha rotulo="Ambiente" valor={nomeDoAmbiente(estado.ambiente)} situacao="ok" />
        )}
      </div>
      {"rastreio" in estado && estado.rastreio && (
        <p className="text-xs text-texto-3">
          Número de rastreio: <span className="font-mono break-all">{estado.rastreio}</span>
        </p>
      )}
    </Card>
  );
}
