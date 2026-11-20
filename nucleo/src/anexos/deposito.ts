/**
 * Depósito dos anexos (M3-08): onde os arquivos ficam. Em teste e produção, um bucket compatível com S3 (Backblaze B2,
 * decisão do Sandro em 19/11/2026); no Mac e nos testes, uma pasta do computador servida pela própria API.
 *
 * O navegador envia e baixa direto por links temporários assinados. O link de envio assina também o tipo e o tamanho:
 * o depósito recusa um arquivo diferente do que o núcleo autorizou.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";

export interface LinkAssinado {
  url: string;
  expiraEm: Date;
}

export interface Deposito {
  /** Link para o navegador mandar o arquivo (PUT), com o tipo e o tamanho exatos. */
  linkDeEnvio(caminho: string, tipo: string, tamanho: number, segundos: number): LinkAssinado;
  /** Link para baixar (GET). "Ver na tela" só para imagem e PDF; o resto sempre baixa como arquivo. */
  linkDeDownload(caminho: string, nome: string, tipo: string, segundos: number): LinkAssinado;
  /** Tamanho e tipo do arquivo que chegou, ou null se não chegou. */
  info(caminho: string): Promise<{ tamanho: number; tipo: string | null } | null>;
  ler(caminho: string): Promise<Buffer>;
  copiar(de: string, para: string): Promise<void>;
  /** Apaga (apagar o que não existe não é erro). */
  apagar(caminho: string): Promise<void>;
}

/** Tipos que o navegador pode mostrar na tela pelo link (o resto vai como download). */
export function podeVerNaTela(tipo: string): boolean {
  return /^image\/(png|jpeg|gif|webp)$/.test(tipo) || tipo === "application/pdf";
}

/** Content-Disposition com o nome em UTF-8 (RFC 6266), sem aspas nem quebras que escapem do cabeçalho. */
export function disposicao(nome: string, tipo: string): string {
  const seguro = nome.replace(/[\r\n"\\]/g, "_");
  const ascii = seguro.replace(/[^\x20-\x7e]/g, "_");
  const modo = podeVerNaTela(tipo) ? "inline" : "attachment";
  return `${modo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(seguro)}`;
}

// --- S3 (assinatura AWS v4, sem biblioteca) -------------------------------------------------------------------

export interface ConfigDoS3 {
  endpoint: string;
  regiao: string;
  bucket: string;
  chaveId: string;
  chaveSegredo: string;
}

const sha256 = (dado: string | Buffer) => createHash("sha256").update(dado).digest("hex");
const hmac = (chave: Buffer | string, texto: string) => createHmac("sha256", chave).update(texto).digest();
/** Codificação do S3: tudo menos letras, números e -_.~ (a barra do caminho fica). */
const codificar = (texto: string, manterBarra = false) =>
  encodeURIComponent(texto)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(manterBarra ? /%2F/g : /$^/, "/");

export function criarDepositoS3(c: ConfigDoS3, agora: () => Date = () => new Date()): Deposito {
  const base = new URL(c.endpoint);
  const host = base.host;
  const caminhoDe = (chave: string) => `/${c.bucket}/${codificar(chave, true)}`;

  function chaveDeAssinatura(dia: string): Buffer {
    return hmac(hmac(hmac(hmac(`AWS4${c.chaveSegredo}`, dia), c.regiao), "s3"), "aws4_request");
  }

  /** Link pré-assinado (a assinatura vai na query). */
  function preAssinar(
    metodo: "GET" | "PUT",
    chave: string,
    segundos: number,
    cabecalhos: Record<string, string>,
    extras: Record<string, string> = {},
  ): LinkAssinado {
    const t = agora();
    const amz = t
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const dia = amz.slice(0, 8);
    const escopo = `${dia}/${c.regiao}/s3/aws4_request`;
    const todos: Record<string, string> = { host, ...cabecalhos };
    const nomes = Object.keys(todos)
      .map((n) => n.toLowerCase())
      .sort();
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${c.chaveId}/${escopo}`,
      "X-Amz-Date": amz,
      "X-Amz-Expires": String(segundos),
      "X-Amz-SignedHeaders": nomes.join(";"),
      ...extras,
    };
    const canonQuery = Object.keys(query)
      .sort()
      .map((k) => `${codificar(k)}=${codificar(query[k] as string)}`)
      .join("&");
    const canonCab = nomes.map((n) => `${n}:${String(todos[n] ?? "").trim()}\n`).join("");
    const canon = [metodo, caminhoDe(chave), canonQuery, canonCab, nomes.join(";"), "UNSIGNED-PAYLOAD"].join(
      "\n",
    );
    const paraAssinar = ["AWS4-HMAC-SHA256", amz, escopo, sha256(canon)].join("\n");
    const assinatura = createHmac("sha256", chaveDeAssinatura(dia)).update(paraAssinar).digest("hex");
    return {
      url: `${base.origin}${caminhoDe(chave)}?${canonQuery}&X-Amz-Signature=${assinatura}`,
      expiraEm: new Date(t.getTime() + segundos * 1000),
    };
  }

  /** Pedido assinado pelo servidor (cabeçalho Authorization). */
  async function pedir(
    metodo: "GET" | "HEAD" | "PUT" | "DELETE",
    chave: string,
    extras: Record<string, string> = {},
  ): Promise<Response> {
    const t = agora();
    const amz = t
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const dia = amz.slice(0, 8);
    const escopo = `${dia}/${c.regiao}/s3/aws4_request`;
    const vazio = sha256("");
    const cab: Record<string, string> = { host, "x-amz-content-sha256": vazio, "x-amz-date": amz, ...extras };
    const nomes = Object.keys(cab).sort();
    const canon = [
      metodo,
      caminhoDe(chave),
      "",
      nomes.map((n) => `${n}:${cab[n]}\n`).join(""),
      nomes.join(";"),
      vazio,
    ].join("\n");
    const paraAssinar = ["AWS4-HMAC-SHA256", amz, escopo, sha256(canon)].join("\n");
    const assinatura = createHmac("sha256", chaveDeAssinatura(dia)).update(paraAssinar).digest("hex");
    const { host: _h, ...semHost } = cab;
    return fetch(`${base.origin}${caminhoDe(chave)}`, {
      method: metodo,
      headers: {
        ...semHost,
        authorization: `AWS4-HMAC-SHA256 Credential=${c.chaveId}/${escopo}, SignedHeaders=${nomes.join(";")}, Signature=${assinatura}`,
      },
    });
  }

  return {
    linkDeEnvio: (caminho, tipo, tamanho, segundos) =>
      preAssinar("PUT", caminho, segundos, { "content-type": tipo, "content-length": String(tamanho) }),
    linkDeDownload: (caminho, nome, tipo, segundos) =>
      preAssinar(
        "GET",
        caminho,
        segundos,
        {},
        {
          "response-content-disposition": disposicao(nome, tipo),
          "response-content-type": podeVerNaTela(tipo) ? tipo : "application/octet-stream",
        },
      ),
    async info(caminho) {
      const r = await pedir("HEAD", caminho);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Depósito respondeu ${r.status} ao conferir o arquivo`);
      return { tamanho: Number(r.headers.get("content-length") ?? "0"), tipo: r.headers.get("content-type") };
    },
    async ler(caminho) {
      const r = await pedir("GET", caminho);
      if (!r.ok) throw new Error(`Depósito respondeu ${r.status} ao ler o arquivo`);
      return Buffer.from(await r.arrayBuffer());
    },
    async copiar(de, para) {
      const r = await pedir("PUT", para, { "x-amz-copy-source": `/${c.bucket}/${codificar(de, true)}` });
      if (!r.ok) throw new Error(`Depósito respondeu ${r.status} ao mover o arquivo`);
      await r.arrayBuffer();
    },
    async apagar(caminho) {
      const r = await pedir("DELETE", caminho);
      if (!r.ok && r.status !== 404) throw new Error(`Depósito respondeu ${r.status} ao apagar o arquivo`);
    },
  };
}

/** A região do endpoint do Backblaze (s3.<região>.backblazeb2.com); outro serviço usa us-east-1. */
export function regiaoDoEndpoint(endpoint: string): string {
  return /^s3\.([a-z0-9-]+)\.backblazeb2\.com$/.exec(new URL(endpoint).host)?.[1] ?? "us-east-1";
}

// --- Disco (só no Mac e nos testes) ----------------------------------------------------------------------------

export interface DepositoEmDisco extends Deposito {
  /** Confere o link e devolve o que ele autoriza (a API serve em /deposito-local). */
  conferirLink(
    token: string,
  ): { metodo: "GET" | "PUT"; caminho: string; tipo: string; tamanho: number | null; nome: string } | null;
  gravar(caminho: string, dados: Buffer): Promise<void>;
}

/**
 * Pasta do computador como depósito. Os links apontam para a própria API (/api/deposito-local?t=<token>), assinados com
 * um segredo sorteado ao ligar: valem só enquanto a API estiver no ar, o que basta no Mac e nos testes.
 */
export function criarDepositoEmDisco(
  urlPublica: string,
  pasta = join(tmpdir(), "mago-os-anexos"),
  agora: () => Date = () => new Date(),
): DepositoEmDisco {
  const segredo = randomBytes(32);
  const arquivo = (caminho: string) => {
    const final = normalize(join(pasta, caminho));
    if (!final.startsWith(normalize(pasta))) throw new Error("Caminho fora do depósito");
    return final;
  };
  function assinar(dados: Record<string, unknown>, segundos: number): LinkAssinado {
    const expiraEm = new Date(agora().getTime() + segundos * 1000);
    const corpo = Buffer.from(JSON.stringify({ ...dados, ate: expiraEm.getTime() })).toString("base64url");
    const marca = createHmac("sha256", segredo).update(corpo).digest("base64url");
    return { url: `${urlPublica}/api/deposito-local?t=${corpo}.${marca}`, expiraEm };
  }
  return {
    linkDeEnvio: (caminho, tipo, tamanho, segundos) =>
      assinar({ m: "PUT", c: caminho, t: tipo, z: tamanho }, segundos),
    linkDeDownload: (caminho, nome, tipo, segundos) =>
      assinar({ m: "GET", c: caminho, t: tipo, n: nome }, segundos),
    conferirLink(token) {
      const [corpo, marca] = token.split(".");
      if (!corpo || !marca) return null;
      const certa = createHmac("sha256", segredo).update(corpo).digest();
      const veio = Buffer.from(marca, "base64url");
      if (veio.length !== certa.length || !timingSafeEqual(veio, certa)) return null;
      const d = JSON.parse(Buffer.from(corpo, "base64url").toString()) as {
        m: "GET" | "PUT";
        c: string;
        t: string;
        z?: number;
        n?: string;
        ate: number;
      };
      if (d.ate < agora().getTime()) return null;
      return { metodo: d.m, caminho: d.c, tipo: d.t, tamanho: d.z ?? null, nome: d.n ?? "" };
    },
    async gravar(caminho, dados) {
      await mkdir(dirname(arquivo(caminho)), { recursive: true });
      await writeFile(arquivo(caminho), dados);
    },
    async info(caminho) {
      try {
        const s = await stat(arquivo(caminho));
        return { tamanho: s.size, tipo: null };
      } catch {
        return null;
      }
    },
    ler: (caminho) => readFile(arquivo(caminho)),
    async copiar(de, para) {
      await mkdir(dirname(arquivo(para)), { recursive: true });
      await copyFile(arquivo(de), arquivo(para));
    },
    apagar: (caminho) => rm(arquivo(caminho), { force: true }),
  };
}
