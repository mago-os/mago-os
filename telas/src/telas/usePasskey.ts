import { useEffect, useState } from "react";
import { prepararPasskey, type Resultado, type TipoDePasskey } from "@/acesso";

/** As opções do servidor valem alguns minutos: busca de novo antes de vencerem. */
const RENOVAR_MS = 4 * 60_000;

/**
 * Deixa as opções da passkey prontas antes do clique, para o navegador abrir a janela da passkey na hora.
 * Devolve undefined enquanto carrega, as opções quando prontas, ou um Resultado com o erro.
 */
export function usePasskeyPronta(tipo: TipoDePasskey, ligado = true) {
  const [opcoes, setOpcoes] = useState<unknown>(undefined);
  useEffect(() => {
    if (!ligado) return;
    let ativo = true;
    const buscar = async () => {
      const r = await prepararPasskey(tipo);
      if (ativo) setOpcoes(r);
    };
    void buscar();
    const intervalo = setInterval(() => void buscar(), RENOVAR_MS);
    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [tipo, ligado]);
  const erro = (opcoes as Resultado | undefined)?.ok === false ? (opcoes as Resultado) : null;
  return { opcoes: erro ? undefined : opcoes, erro, pronta: opcoes !== undefined && !erro };
}
