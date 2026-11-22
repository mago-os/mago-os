/**
 * O código do app autenticador conferido fora do login (M5-04, decisão 0035): para aprovar um pedido pelo Telegram.
 *
 * O segredo é o mesmo do 2FA do login (acesso.dois_fatores), guardado cifrado pelo Better Auth com o segredo do login.
 * A conta do código é a de sempre (RFC 6238: passos de 30 segundos, 6 dígitos, HMAC-SHA1), aceitando o passo anterior e
 * o seguinte, como o login. O passo usado fica gravado: o mesmo código não vale duas vezes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";

const PASSO_EM_SEGUNDOS = 30;
const DIGITOS = 6;
const PREFIXO_BASE32 = "base32:";
const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** O código de um passo (HOTP, RFC 4226), a partir do segredo em bytes. */
export function codigoDoPasso(segredo: Buffer, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = createHmac("sha1", segredo).update(contador).digest();
  const deslocamento = (h[h.length - 1] as number) & 15;
  const numero =
    (((h[deslocamento] as number) & 127) << 24) |
    ((h[deslocamento + 1] as number) << 16) |
    ((h[deslocamento + 2] as number) << 8) |
    (h[deslocamento + 3] as number);
  return String(numero % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

function decodificarBase32(texto: string): Buffer {
  let bits = "";
  for (const c of texto.toUpperCase().replace(/=+$/, "")) {
    const v = ALFABETO_BASE32.indexOf(c);
    if (v < 0) throw new Error("base32 inválido");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** O passo do código entre o anterior, o atual e o seguinte, ou nulo. Comparação em tempo constante. */
export function passoDoCodigo(segredo: Buffer, codigo: string, agora = Date.now()): number | null {
  if (!/^\d{6}$/.test(codigo)) return null;
  const atual = Math.floor(agora / 1000 / PASSO_EM_SEGUNDOS);
  let achado: number | null = null;
  for (const passo of [atual - 1, atual, atual + 1]) {
    const certo = Buffer.from(codigoDoPasso(segredo, passo));
    if (timingSafeEqual(certo, Buffer.from(codigo)) && achado === null) achado = passo;
  }
  return achado;
}

export type ResultadoDoCodigo = "certo" | "errado" | "repetido" | "sem_autenticador";

export interface Autenticador {
  /** A pessoa tem app autenticador confirmado (quem só tem passkey não aprova pelo Telegram). */
  tem(pessoaId: string): Promise<boolean>;
  conferir(pessoaId: string, codigo: string): Promise<ResultadoDoCodigo>;
}

/**
 * O autenticador de verdade: lê o segredo pelo papel do login (poolAcesso), abre com a função do Better Auth e grava o
 * passo usado pelo papel da API (poolApp).
 */
export function criarAutenticador(o: {
  poolAcesso: pg.Pool;
  poolApp: pg.Pool;
  /** Abre o segredo cifrado (symmetricDecrypt do Better Auth, com o segredo do login). */
  abrir(cifrado: string): Promise<string>;
}): Autenticador {
  const segredoDe = async (pessoaId: string): Promise<Buffer | null> => {
    const r = await o.poolAcesso.query<{ segredo: string }>(
      "select segredo from acesso.dois_fatores where pessoa_id = $1 and verificado",
      [pessoaId],
    );
    const cifrado = r.rows[0]?.segredo;
    if (!cifrado) return null;
    const aberto = await o.abrir(cifrado);
    // Segredo importado de outro app fica como "base32:<segredo>"; o gerado pelo Mago OS é usado como texto.
    return aberto.startsWith(PREFIXO_BASE32)
      ? decodificarBase32(aberto.slice(PREFIXO_BASE32.length))
      : Buffer.from(aberto, "utf8");
  };
  return {
    async tem(pessoaId) {
      const r = await o.poolAcesso.query(
        "select 1 from acesso.dois_fatores where pessoa_id = $1 and verificado",
        [pessoaId],
      );
      return (r.rowCount ?? 0) > 0;
    },
    async conferir(pessoaId, codigo) {
      const segredo = await segredoDe(pessoaId);
      if (!segredo) return "sem_autenticador";
      const passo = passoDoCodigo(segredo, codigo);
      if (passo === null) return "errado";
      const r = await o.poolApp.query<{ ok: boolean }>("select usar_passo_do_autenticador($1, $2) as ok", [
        pessoaId,
        passo,
      ]);
      return r.rows[0]?.ok ? "certo" : "repetido";
    },
  };
}
