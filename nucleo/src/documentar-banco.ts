/**
 * Gera a documentação do banco (docs/banco/README.md) a partir das próprias migrações:
 * diagrama das tabelas em Mermaid e dicionário de dados com as marcas LGPD.
 *
 * Uso: pnpm banco:documentar (precisa do ambiente local no ar: pnpm local:subir).
 * Um teste confere que o arquivo do repositório está igual ao gerado, então ele nunca fica desatualizado.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { criarBancoTemporario } from "./banco-temporario.ts";

export const ARQUIVO_DOCUMENTACAO = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "banco",
  "README.md",
);

/** Marcas que toda coluna precisa ter no início da descrição. */
export const MARCAS = {
  empresa: "Dado da empresa",
  pessoal: "Dado pessoal (LGPD)",
  sensivel: "Dado pessoal sensível (LGPD, art. 5º, II)",
  sistema: "Controle técnico do sistema",
} as const;

export type Marca = keyof typeof MARCAS;

export interface Coluna {
  tabela: string;
  coluna: string;
  tipo: string;
  obrigatoria: boolean;
  padrao: string | null;
  descricao: string | null;
  chavePrimaria: boolean;
  referencia: string | null;
}

export interface Tabela {
  tabela: string;
  descricao: string | null;
  rls: boolean;
  rlsForcado: boolean;
}

/** Lê do catálogo do PostgreSQL as tabelas e colunas do esquema public. */
export async function lerEstrutura(
  cliente: pg.ClientBase,
): Promise<{ tabelas: Tabela[]; colunas: Coluna[] }> {
  const tabelas = await cliente.query<Tabela>(`
    select c.relname as tabela, obj_description(c.oid, 'pg_class') as descricao,
           c.relrowsecurity as rls, c.relforcerowsecurity as "rlsForcado"
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname`);
  const colunas = await cliente.query<Coluna>(`
    select c.relname as tabela, a.attname as coluna,
           format_type(a.atttypid, a.atttypmod) as tipo,
           a.attnotnull as obrigatoria,
           pg_get_expr(d.adbin, d.adrelid) as padrao,
           col_description(c.oid, a.attnum) as descricao,
           exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p'
                   and a.attnum = any (k.conkey)) as "chavePrimaria",
           (select r.relname || '.' || ra.attname
              from pg_constraint k
              join pg_class r on r.oid = k.confrelid
              join pg_attribute ra on ra.attrelid = k.confrelid and ra.attnum = k.confkey[1]
             where k.conrelid = c.oid and k.contype = 'f' and k.conkey[1] = a.attnum
             limit 1) as referencia
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname, a.attnum`);
  return { tabelas: tabelas.rows, colunas: colunas.rows };
}

/** Separa "[pessoal] E-mail de login." em marca e texto. */
export function separarMarca(descricao: string | null): { marca: Marca | null; texto: string } {
  const achou = /^\[(\w+)\]\s*(.*)$/s.exec(descricao ?? "");
  if (!achou || !Object.hasOwn(MARCAS, achou[1] ?? "")) {
    return { marca: null, texto: descricao ?? "" };
  }
  return { marca: achou[1] as Marca, texto: achou[2] ?? "" };
}

function celula(texto: string): string {
  return texto.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function gerarMarkdown(estrutura: { tabelas: Tabela[]; colunas: Coluna[] }): string {
  const { tabelas, colunas } = estrutura;
  const linhas: string[] = [
    "# Banco de dados",
    "",
    "> Gerado sozinho por `pnpm banco:documentar` a partir das migrações (`nucleo/migracoes`). Não edite à mão:",
    "> mude a migração e gere de novo. O porquê das escolhas está em [decisoes.md](decisoes.md).",
    "",
    "## Diagrama",
    "",
    "```mermaid",
    "erDiagram",
  ];
  for (const t of tabelas) {
    linhas.push(`  ${t.tabela} {`);
    for (const c of colunas.filter((x) => x.tabela === t.tabela)) {
      const chave = c.chavePrimaria ? " PK" : c.referencia ? " FK" : "";
      linhas.push(`    ${c.tipo.replaceAll(" ", "_").replace(/\(.*\)/, "")} ${c.coluna}${chave}`);
    }
    linhas.push("  }");
  }
  for (const c of colunas.filter((x) => x.referencia)) {
    const [destino] = (c.referencia ?? "").split(".");
    linhas.push(`  ${destino} ||--o{ ${c.tabela} : "${c.coluna}"`);
  }
  linhas.push("```", "", "## Marcas", "", "| Marca | Significa |", "| --- | --- |");
  for (const [marca, significado] of Object.entries(MARCAS)) linhas.push(`| \`${marca}\` | ${significado} |`);
  linhas.push("", "## Dicionário de dados");
  for (const t of tabelas) {
    const isolamento =
      t.rls && t.rlsForcado ? "ligado e forçado" : t.rls ? "ligado (não forçado)" : "DESLIGADO";
    linhas.push(
      "",
      `### ${t.tabela}`,
      "",
      celula(t.descricao ?? "(sem descrição)"),
      "",
      `Isolamento por empresa (Row Level Security): ${isolamento}.`,
      "",
      "| Coluna | Tipo | Obrigatória | Padrão | Marca | Descrição |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const c of colunas.filter((x) => x.tabela === t.tabela)) {
      const { marca, texto } = separarMarca(c.descricao);
      const extra = c.chavePrimaria
        ? " Chave primária."
        : c.referencia
          ? ` Aponta para ${c.referencia}.`
          : "";
      linhas.push(
        `| ${c.coluna} | ${c.tipo} | ${c.obrigatoria ? "sim" : "não"} | ${c.padrao ? `\`${celula(c.padrao)}\`` : ""} | ${marca ?? "**sem marca**"} | ${celula(texto)}${extra} |`,
      );
    }
  }
  return `${linhas.join("\n")}\n`;
}

/** Cria um banco temporário, roda as migrações e devolve o Markdown gerado. */
export async function documentacaoAtual(): Promise<string> {
  const banco = await criarBancoTemporario();
  const cliente = new pg.Client({ connectionString: banco.urlDono });
  try {
    await cliente.connect();
    return gerarMarkdown(await lerEstrutura(cliente));
  } finally {
    await cliente.end();
    await banco.apagar();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(ARQUIVO_DOCUMENTACAO, await documentacaoAtual());
  console.log(`Documentação do banco gerada em ${ARQUIVO_DOCUMENTACAO}`);
}
