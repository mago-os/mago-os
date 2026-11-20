/**
 * Cofre interno (M4-01, decisão 0021): envelope com AES-256-GCM.
 *
 * - A chave mestra (32 bytes) fica fora do banco, no Infisical, e chega pela variável MAGO_COFRE_CHAVE_MESTRA.
 * - Cada empresa tem a própria chave de dados (32 bytes aleatórios), guardada em chaves_de_dados cifrada pela mestra.
 * - Cada segredo (a chave de um provedor de IA) é cifrado com a chave de dados da empresa.
 *
 * Formato de cada texto cifrado: 12 bytes do número aleatório (nonce) + texto cifrado + 16 bytes da etiqueta. O
 * "dado autenticado" amarra o texto à empresa e ao uso: copiado para outra empresa ou outra conta, não decifra.
 * O segredo decifrado só existe na memória, durante a chamada ao provedor.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type pg from "pg";

const TAMANHO_DA_CHAVE = 32;
const TAMANHO_DO_NONCE = 12;
const TAMANHO_DA_ETIQUETA = 16;

export interface ChaveMestra {
  versao: number;
  chave: Buffer;
}

/** A mestra em uso e as anteriores (só para decifrar durante a troca; ver docs/operacao/cofre.md). */
export interface ChavesMestras {
  atual: ChaveMestra;
  anteriores: ChaveMestra[];
}

/** Erro de cofre: o texto não decifra (chave errada, dado copiado de outro lugar ou adulterado). */
export class ErroDoCofre extends Error {
  override name = "ErroDoCofre";
}

export function cifrar(chave: Buffer, texto: Buffer, contexto: string): Buffer {
  if (chave.length !== TAMANHO_DA_CHAVE) throw new ErroDoCofre("chave de cifra com tamanho errado");
  const nonce = randomBytes(TAMANHO_DO_NONCE);
  const cifra = createCipheriv("aes-256-gcm", chave, nonce);
  cifra.setAAD(Buffer.from(contexto, "utf8"));
  const corpo = Buffer.concat([cifra.update(texto), cifra.final()]);
  return Buffer.concat([nonce, corpo, cifra.getAuthTag()]);
}

export function decifrar(chave: Buffer, cifrado: Buffer, contexto: string): Buffer {
  if (chave.length !== TAMANHO_DA_CHAVE) throw new ErroDoCofre("chave de cifra com tamanho errado");
  if (cifrado.length < TAMANHO_DO_NONCE + TAMANHO_DA_ETIQUETA + 1)
    throw new ErroDoCofre("texto cifrado curto");
  const nonce = cifrado.subarray(0, TAMANHO_DO_NONCE);
  const etiqueta = cifrado.subarray(cifrado.length - TAMANHO_DA_ETIQUETA);
  const corpo = cifrado.subarray(TAMANHO_DO_NONCE, cifrado.length - TAMANHO_DA_ETIQUETA);
  try {
    const decifra = createDecipheriv("aes-256-gcm", chave, nonce);
    decifra.setAAD(Buffer.from(contexto, "utf8"));
    decifra.setAuthTag(etiqueta);
    return Buffer.concat([decifra.update(corpo), decifra.final()]);
  } catch {
    throw new ErroDoCofre("o texto cifrado não confere");
  }
}

/** Lê a chave mestra do formato da variável: 32 bytes em base64 (openssl rand -base64 32). */
export function lerChaveMestra(texto: string, versao: number): ChaveMestra | null {
  const chave = Buffer.from(texto.trim(), "base64");
  if (chave.length !== TAMANHO_DA_CHAVE || !Number.isInteger(versao) || versao < 1) return null;
  return { versao, chave };
}

const contextoDaChaveDeDados = (empresaId: string) => `mago-os:chave-de-dados:${empresaId}`;
const contextoDaContaDeIa = (empresaId: string, contaId: string) =>
  `mago-os:conta-de-ia:${empresaId}:${contaId}`;

export interface Cofre {
  /** Cifra a chave de um provedor para guardar em contas_de_ia (cria a chave de dados da empresa se faltar). */
  guardarChaveDeIa(c: pg.PoolClient, empresaId: string, contaId: string, chave: string): Promise<Buffer>;
  /** Decifra a chave de uma conta, só para a chamada ao provedor. */
  abrirChaveDeIa(c: pg.PoolClient, empresaId: string, contaId: string, cifrada: Buffer): Promise<string>;
}

export function criarCofre(mestras: ChavesMestras): Cofre {
  const porVersao = new Map<number, Buffer>([
    ...mestras.anteriores.map((m) => [m.versao, m.chave] as const),
    [mestras.atual.versao, mestras.atual.chave],
  ]);

  /**
   * A chave de dados da empresa, dentro da transação de quem chamou (o RLS só mostra a da empresa ativa). Se ela
   * foi cifrada por uma mestra anterior, é cifrada de novo pela atual: a troca da mestra se completa com o uso.
   */
  async function chaveDeDados(c: pg.PoolClient, empresaId: string, criarSeFaltar: boolean): Promise<Buffer> {
    const contexto = contextoDaChaveDeDados(empresaId);
    const r = await c.query<{ versao_da_mestra: number; chave_cifrada: Buffer }>(
      "select versao_da_mestra, chave_cifrada from chaves_de_dados where empresa_id = $1 for update",
      [empresaId],
    );
    const linha = r.rows[0];
    if (!linha) {
      if (!criarSeFaltar) throw new ErroDoCofre("a empresa ainda não tem chave de dados");
      const nova = randomBytes(TAMANHO_DA_CHAVE);
      await c.query(
        `insert into chaves_de_dados (empresa_id, versao_da_mestra, chave_cifrada) values ($1, $2, $3)
         on conflict (empresa_id) do nothing`,
        [empresaId, mestras.atual.versao, cifrar(mestras.atual.chave, nova, contexto)],
      );
      // Outra transação pode ter criado ao mesmo tempo: vale a que ficou no banco.
      return chaveDeDados(c, empresaId, false);
    }
    const mestra = porVersao.get(linha.versao_da_mestra);
    if (!mestra) throw new ErroDoCofre(`falta a chave mestra da versão ${linha.versao_da_mestra}`);
    const chave = decifrar(mestra, linha.chave_cifrada, contexto);
    if (linha.versao_da_mestra !== mestras.atual.versao) {
      await c.query(
        `update chaves_de_dados set versao_da_mestra = $2, chave_cifrada = $3, atualizada_em = now()
          where empresa_id = $1`,
        [empresaId, mestras.atual.versao, cifrar(mestras.atual.chave, chave, contexto)],
      );
    }
    return chave;
  }

  return {
    async guardarChaveDeIa(c, empresaId, contaId, chave) {
      const dados = await chaveDeDados(c, empresaId, true);
      return cifrar(dados, Buffer.from(chave, "utf8"), contextoDaContaDeIa(empresaId, contaId));
    },
    async abrirChaveDeIa(c, empresaId, contaId, cifrada) {
      const dados = await chaveDeDados(c, empresaId, false);
      return decifrar(dados, cifrada, contextoDaContaDeIa(empresaId, contaId)).toString("utf8");
    },
  };
}
