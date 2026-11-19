/**
 * Antivírus dos anexos (M3-08): o ClamAV num container próprio, pelo protocolo do clamd (INSTREAM, porta 3310 só na
 * rede interna). No Mac e nos testes, sem ClamAV, um conferente de teste que só reconhece o arquivo EICAR (o arquivo
 * de teste padrão dos antivírus): ele nunca vale em teste nem em produção.
 */
import { connect } from "node:net";

export type ResultadoDoAntivirus = { limpo: true } | { limpo: false; achado: string };

export interface Antivirus {
  conferir(dados: Buffer): Promise<ResultadoDoAntivirus>;
}

/** O ClamAV no endereço "host:porta". O tempo máximo cobre 25 MB com folga. */
export function criarClamav(endereco: string, tempoMaximoMs = 120_000): Antivirus {
  const [host, porta] = endereco.split(":");
  return {
    conferir: (dados) =>
      new Promise((resolver, rejeitar) => {
        const conexao = connect({ host: host ?? "127.0.0.1", port: Number(porta ?? "3310") });
        const partes: Buffer[] = [];
        conexao.setTimeout(tempoMaximoMs, () =>
          conexao.destroy(new Error("O antivírus não respondeu a tempo")),
        );
        conexao.on("error", rejeitar);
        conexao.on("data", (p: Buffer) => partes.push(p));
        conexao.on("end", () => {
          const resposta = Buffer.concat(partes).toString().replace(/\0/g, "").trim();
          // "stream: OK" ou "stream: <ameaça> FOUND"; qualquer outra coisa é erro (e o arquivo não é liberado).
          if (/^stream: OK$/.test(resposta)) return resolver({ limpo: true });
          const achou = /^stream: (.+) FOUND$/.exec(resposta);
          if (achou) return resolver({ limpo: false, achado: (achou[1] ?? "").slice(0, 200) });
          rejeitar(new Error(`Resposta inesperada do antivírus: ${resposta.slice(0, 120)}`));
        });
        conexao.on("connect", () => {
          conexao.write("zINSTREAM\0");
          for (let i = 0; i < dados.length; i += 64 * 1024) {
            const pedaco = dados.subarray(i, i + 64 * 1024);
            const tamanho = Buffer.alloc(4);
            tamanho.writeUInt32BE(pedaco.length);
            conexao.write(tamanho);
            conexao.write(pedaco);
          }
          conexao.end(Buffer.alloc(4));
        });
      }),
  };
}

/** Assinatura do arquivo de teste EICAR (pública, inofensiva). */
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** Só no Mac e nos testes: reconhece o EICAR e libera o resto. */
export const antivirusDeTeste: Antivirus = {
  async conferir(dados) {
    return dados.includes(EICAR) ? { limpo: false, achado: "Eicar-Test-Signature" } : { limpo: true };
  },
};
