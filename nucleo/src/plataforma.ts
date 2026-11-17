/**
 * Início da plataforma (M1-02): cria o Dono da plataforma e uma empresa onde ele é administrador.
 *
 * Roda com o papel dono do banco, uma vez por ambiente e de novo para cada empresa nova:
 *   DATABASE_URL_DONO=postgres://... node src/plataforma.ts iniciar --nome "..." --email "..." --empresa "..."
 *
 * Nome e e-mail reais nunca ficam no código: entram só pelo comando. Pode rodar de novo sem estragar nada.
 */
import { parseArgs } from "node:util";
import { conferir, Email, normalizarEmail, Texto } from "@mago-os/contratos";
import pg from "pg";

export interface DadosDoInicio {
  nome: string;
  email: string;
  empresa: string;
}

export interface ResultadoDoInicio {
  pessoaId: string;
  empresaId: string;
  criou: { pessoa: boolean; dono: boolean; empresa: boolean; vinculo: boolean };
}

const Nome = Texto(200, "Nome");

export async function iniciarPlataforma(
  cliente: pg.ClientBase,
  dados: DadosDoInicio,
): Promise<ResultadoDoInicio> {
  const email = normalizarEmail(dados.email);
  const nome = dados.nome.trim();
  const empresa = dados.empresa.trim();
  const problemas = [
    ...(conferir(Email, email).ok ? [] : ["e-mail inválido"]),
    ...(conferir(Nome, nome).ok ? [] : ["nome da pessoa vazio ou longo demais"]),
    ...(conferir(Nome, empresa).ok ? [] : ["nome da empresa vazio ou longo demais"]),
  ];
  if (problemas.length > 0) throw new Error(`Dados inválidos: ${problemas.join(", ")}`);

  await cliente.query("begin");
  try {
    const pessoa = await cliente.query<{ id: string; nova: boolean }>(
      // O Dono da plataforma digitou o próprio e-mail: ele vale como confirmado (o login com Google exige isso).
      `insert into pessoas (nome, email, email_verificado) values ($1, $2, true)
         on conflict (email) do update set email_verificado = true
       returning id, (xmax = 0) as nova`,
      [nome, email],
    );
    const pessoaId = pessoa.rows[0]?.id as string;

    const donos = await cliente.query<{ pessoa_id: string }>(
      "select pessoa_id from papeis_plataforma where papel = 'dono'",
    );
    if (donos.rows.some((d) => d.pessoa_id !== pessoaId)) {
      throw new Error("Já existe um Dono da plataforma com outro e-mail. Nada foi alterado.");
    }
    const dono = await cliente.query(
      "insert into papeis_plataforma (pessoa_id, papel) values ($1, 'dono') on conflict (pessoa_id) do nothing",
      [pessoaId],
    );

    const existente = await cliente.query<{ id: string }>(
      "select id from empresas where lower(nome) = lower($1) order by criada_em limit 1",
      [empresa],
    );
    let empresaId = existente.rows[0]?.id;
    const empresaNova = empresaId === undefined;
    if (empresaId === undefined) {
      const nova = await cliente.query<{ id: string }>(
        "insert into empresas (nome) values ($1) returning id",
        [empresa],
      );
      empresaId = nova.rows[0]?.id as string;
    }

    const vinculo = await cliente.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, 'administrador', 'ativo', now(), now())
         on conflict (empresa_id, pessoa_id) do nothing`,
      [empresaId, pessoaId],
    );

    await cliente.query("commit");
    return {
      pessoaId,
      empresaId,
      criou: {
        pessoa: pessoa.rows[0]?.nova === true,
        dono: dono.rowCount === 1,
        empresa: empresaNova,
        vinculo: vinculo.rowCount === 1,
      },
    };
  } catch (erro) {
    await cliente.query("rollback").catch(() => {});
    throw erro;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { nome: { type: "string" }, email: { type: "string" }, empresa: { type: "string" } },
  });
  const url = process.env.DATABASE_URL_DONO;
  if (!url || positionals[0] !== "iniciar" || !values.nome || !values.email || !values.empresa) {
    console.error(
      'Uso: DATABASE_URL_DONO=postgres://... node src/plataforma.ts iniciar --nome "Nome" --email "e-mail" --empresa "Empresa"',
    );
    process.exit(1);
  }
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    const r = await iniciarPlataforma(cliente, {
      nome: values.nome,
      email: values.email,
      empresa: values.empresa,
    });
    const sim = (feito: boolean, texto: string) => `${feito ? "criado" : "já existia"}: ${texto}`;
    console.log(
      [
        sim(r.criou.pessoa, "pessoa"),
        sim(r.criou.dono, "Dono da plataforma"),
        sim(r.criou.empresa, `empresa ${values.empresa.trim()}`),
        sim(r.criou.vinculo, "administrador da empresa"),
      ].join("\n"),
    );
  } finally {
    await cliente.end();
  }
}
