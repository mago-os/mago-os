/** Estado da API, lido da rota de saúde do núcleo (GET /api/saude). */

export interface RespostaSaude {
  situacao: "ok" | "com_problema";
  api: "ok";
  banco: "ok" | "fora_do_ar";
  sistema: string;
  ambiente: "local" | "teste" | "producao";
  versao?: string;
}

export type EstadoDaApi =
  | { tipo: "carregando" }
  | { tipo: "ok"; ambiente: string; versao: string; rastreio: string | null; ms: number }
  | { tipo: "banco_fora"; ambiente: string; rastreio: string | null }
  | { tipo: "api_fora"; motivo: string };

const NOMES_DOS_AMBIENTES: Record<string, string> = { local: "Local", teste: "Teste", producao: "Produção" };

export function nomeDoAmbiente(ambiente: string): string {
  return NOMES_DOS_AMBIENTES[ambiente] ?? ambiente;
}

/** Transforma a resposta da rota de saúde num estado que a tela sabe mostrar. */
export function interpretarSaude(
  status: number,
  corpo: unknown,
  rastreio: string | null,
  ms: number,
): EstadoDaApi {
  const r = corpo as Partial<RespostaSaude> | null;
  if (!r || typeof r !== "object" || r.api !== "ok") {
    return { tipo: "api_fora", motivo: `A API respondeu de um jeito inesperado (código ${status}).` };
  }
  const ambiente = r.ambiente ?? "desconhecido";
  if (status === 200 && r.banco === "ok")
    return { tipo: "ok", ambiente, versao: r.versao ?? "local", rastreio, ms };
  return { tipo: "banco_fora", ambiente, rastreio };
}

export async function lerSaude(sinal?: AbortSignal): Promise<EstadoDaApi> {
  const inicio = performance.now();
  try {
    const resposta = await fetch("/api/saude", { signal: sinal ?? null, cache: "no-store" });
    const corpo: unknown = await resposta.json().catch(() => null);
    return interpretarSaude(
      resposta.status,
      corpo,
      resposta.headers.get("x-rastreio"),
      Math.round(performance.now() - inicio),
    );
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") throw erro;
    return { tipo: "api_fora", motivo: "Não foi possível falar com a API." };
  }
}
