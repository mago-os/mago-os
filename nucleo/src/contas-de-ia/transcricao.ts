/**
 * Transcrição de áudio (M8-08, decisão 0058): o áudio da conversa vai para o endereço de transcrição de uma conta
 * "compatível com OpenAI" da empresa (/audio/transcriptions), com a chave dela. Só sai o arquivo: nada do contato nem
 * da conversa. O endereço passa pela mesma conferência das outras chamadas (nada de rede interna).
 */
import { enderecoSeguro, type Resolver } from "./provedores.ts";

export interface PedidoDeTranscrever {
  endereco: string;
  chave: string;
  modelo: string;
  dados: Buffer;
  nome: string;
  mime: string;
}

export interface Transcritor {
  transcrever(p: PedidoDeTranscrever): Promise<{ texto: string }>;
}

export class ErroDaTranscricao extends Error {}

/** Quanto esperar o provedor (um áudio de 10 minutos leva alguns segundos). */
const TEMPO_DA_TRANSCRICAO_MS = 120_000;

export function transcritorDeVerdade(
  ambiente: "local" | "teste" | "producao",
  resolver?: Resolver,
): Transcritor {
  return {
    async transcrever(p) {
      if (!(await enderecoSeguro(p.endereco, ambiente, resolver)))
        throw new ErroDaTranscricao("O endereço aponta para uma rede interna ou não existe.");
      const corpo = new FormData();
      corpo.append("model", p.modelo);
      corpo.append("response_format", "json");
      corpo.append("file", new Blob([new Uint8Array(p.dados)], { type: p.mime }), p.nome);
      let r: Response;
      try {
        r = await fetch(`${p.endereco.replace(/\/+$/, "")}/audio/transcriptions`, {
          method: "POST",
          headers: { authorization: `Bearer ${p.chave}` },
          body: corpo,
          signal: AbortSignal.timeout(TEMPO_DA_TRANSCRICAO_MS),
          redirect: "error",
        });
      } catch {
        throw new ErroDaTranscricao("O provedor de transcrição não respondeu.");
      }
      if (!r.ok) throw new ErroDaTranscricao(`O provedor de transcrição respondeu ${r.status}.`);
      const json = (await r.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof json?.text !== "string") throw new ErroDaTranscricao("O provedor não devolveu o texto.");
      return { texto: json.text.trim().slice(0, 20000) };
    },
  };
}

/** Transcritor falso para os testes (sem custo, sem rede): devolve o texto do roteiro, ou falha. */
export function transcritorFalso(
  roteiro: (p: PedidoDeTranscrever) => string | Error,
): Transcritor & { pedidos: PedidoDeTranscrever[] } {
  const pedidos: PedidoDeTranscrever[] = [];
  return {
    pedidos,
    async transcrever(p) {
      pedidos.push(p);
      const r = roteiro(p);
      if (r instanceof Error) throw new ErroDaTranscricao(r.message);
      return { texto: r };
    },
  };
}
