/**
 * Leitor de um markdown pequeno, para as páginas públicas (M6-05c): títulos (# e ##), parágrafos, listas com "- ",
 * tabelas simples, **negrito** e [links](https://...). Comentários <!-- --> somem. Sem biblioteca nova e sem HTML
 * vindo do texto: tudo vira elementos do React, então nada do arquivo é interpretado como código.
 */

export type Trecho =
  | { tipo: "texto"; texto: string }
  | { tipo: "negrito"; texto: string }
  | { tipo: "link"; texto: string; endereco: string };

export type Bloco =
  | { tipo: "titulo"; nivel: 1 | 2; texto: string }
  | { tipo: "paragrafo"; trechos: Trecho[] }
  | { tipo: "lista"; itens: Trecho[][] }
  | { tipo: "tabela"; cabecalho: Trecho[][]; linhas: Trecho[][][] };

const LINK_OU_NEGRITO = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

/** Quebra uma linha em texto, negrito e links (só https). */
export function lerTrechos(linha: string): Trecho[] {
  const trechos: Trecho[] = [];
  let inicio = 0;
  for (const achado of linha.matchAll(LINK_OU_NEGRITO)) {
    const posicao = achado.index ?? 0;
    if (posicao > inicio) trechos.push({ tipo: "texto", texto: linha.slice(inicio, posicao) });
    if (achado[1] !== undefined) trechos.push({ tipo: "negrito", texto: achado[1] });
    else trechos.push({ tipo: "link", texto: achado[2] ?? "", endereco: achado[3] ?? "" });
    inicio = posicao + achado[0].length;
  }
  if (inicio < linha.length) trechos.push({ tipo: "texto", texto: linha.slice(inicio) });
  return trechos;
}

function celulas(linha: string): string[] {
  return linha
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARADOR_DA_TABELA = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

/** Lê o texto inteiro em blocos, na ordem. */
export function lerTexto(fonte: string): Bloco[] {
  const linhas = fonte.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const blocos: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const linha = (linhas[i] ?? "").trimEnd();
    if (linha.trim() === "") {
      i++;
      continue;
    }
    const titulo = /^(#{1,2})\s+(.+)$/.exec(linha);
    if (titulo) {
      blocos.push({ tipo: "titulo", nivel: titulo[1] === "#" ? 1 : 2, texto: titulo[2] ?? "" });
      i++;
      continue;
    }
    if (linha.startsWith("|") && SEPARADOR_DA_TABELA.test((linhas[i + 1] ?? "").trim())) {
      const cabecalho = celulas(linha).map(lerTrechos);
      const corpo: Trecho[][][] = [];
      i += 2;
      while (i < linhas.length && (linhas[i] ?? "").trim().startsWith("|")) {
        corpo.push(celulas(linhas[i] ?? "").map(lerTrechos));
        i++;
      }
      blocos.push({ tipo: "tabela", cabecalho, linhas: corpo });
      continue;
    }
    if (linha.startsWith("- ")) {
      const itens: string[] = [];
      while (i < linhas.length) {
        const atual = (linhas[i] ?? "").trimEnd();
        if (atual.startsWith("- ")) itens.push(atual.slice(2));
        else if (atual.startsWith("  ") && atual.trim() !== "" && itens.length > 0)
          itens[itens.length - 1] += ` ${atual.trim()}`;
        else break;
        i++;
      }
      blocos.push({ tipo: "lista", itens: itens.map(lerTrechos) });
      continue;
    }
    const partes: string[] = [];
    while (i < linhas.length) {
      const atual = (linhas[i] ?? "").trim();
      if (atual === "" || /^#{1,2}\s/.test(atual) || atual.startsWith("- ") || atual.startsWith("|")) break;
      partes.push(atual);
      i++;
    }
    blocos.push({ tipo: "paragrafo", trechos: lerTrechos(partes.join(" ")) });
  }
  return blocos;
}
