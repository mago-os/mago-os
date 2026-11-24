import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/componentes/ui/button";
import { ouvirErrosDoSistema } from "@/erros";

/** O aviso do erro do sistema, com o número de rastreio e o botão de copiar (M6-02). Fica no canto da tela. */
export function AvisoDeErroDoSistema() {
  const [erro, setErro] = useState<{ rastreio: string | null; vez: number } | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(
    () =>
      ouvirErrosDoSistema((rastreio) => {
        setCopiado(false);
        setErro((atual) => ({ rastreio, vez: (atual?.vez ?? 0) + 1 }));
      }),
    [],
  );

  // Some sozinho depois de 30 segundos (a mensagem da própria tela continua).
  useEffect(() => {
    if (!erro) return;
    const t = setTimeout(() => setErro(null), 30_000);
    return () => clearTimeout(t);
  }, [erro]);

  if (!erro) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-50 mx-auto grid max-w-md gap-2 rounded-lg border border-perigo/40 bg-cartao p-3 text-sm shadow-lg md:bottom-4"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">Algo deu errado do nosso lado.</p>
        <Button
          variant="fantasma"
          size="icone"
          className="-m-2 size-8"
          aria-label="Fechar"
          onClick={() => setErro(null)}
        >
          <X />
        </Button>
      </div>
      {erro.rastreio ? (
        <>
          <p className="text-texto-2">Se continuar, mande este número de rastreio ao suporte:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-suave px-2 py-1 font-mono text-xs">
              {erro.rastreio}
            </code>
            <Button
              variant="contorno"
              size="pequeno"
              onClick={() => {
                void navigator.clipboard?.writeText(erro.rastreio ?? "").then(() => setCopiado(true));
              }}
            >
              {copiado ? <Check /> : <Copy />}
              {copiado ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-texto-2">Tente de novo em instantes.</p>
      )}
    </div>
  );
}
