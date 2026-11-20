/**
 * Busca Ctrl+K (M3-09), de ponta a ponta: sem acento e com erro de digitação, sempre com a permissão de quem busca
 * (o funcionário só acha o que vê), sem e-mail das pessoas, e uma empresa não acha nada da outra, nem pelo título exato.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotaDaBusca } from "@mago-os/nucleo/busca";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000af";

describe.skipIf(!bancoDisponivel)("busca", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let ip = 0;
  const emails: { para: string; link: string; aparelho: string }[] = [];

  async function criarPessoa(
    nome: string,
    email: string,
    perfil: string,
    area: string | null,
    empresa = empresaId,
  ) {
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [nome, email],
    );
    const id = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now())`,
      [empresa, id, perfil, area],
    );
    return id;
  }

  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.9.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode).toBe(200);
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = (select id from pessoas where email = $1)",
      [email],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) select id, 'c', $1, 'multiDevice' from pessoas where email = $1 on conflict do nothing",
      [email],
    );
    return ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  const cookies: Record<string, string> = {};
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const ids: Record<string, string> = {};

  function pedir(metodo: "GET" | "POST" | "DELETE", url: string, cookie: string, corpo?: unknown) {
    return app.inject({
      method: metodo,
      url,
      headers: { cookie, origin: SITE, ...(corpo ? { "content-type": "application/json" } : {}) },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>(
      "insert into empresas (nome) values ('Empresa Um') returning id",
    );
    empresaId = e.rows[0]?.id as string;
    await dono.query("insert into empresas (id, nome) values ($1, 'Outra Empresa')", [OUTRA]);
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador", null);
    ids.gil = await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    ids.fabio = await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "comercial");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: {
          async enviarLinkDeSenha() {},
          async enviarAparelhoNovo(d) {
            emails.push(d);
          },
        },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
    registrarRotasDosAvisos(app, verificador, poolApp, "chave-publica-de-teste");
    registrarRotaDaBusca(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  type Resultado = { tipo: string; titulo: string; trecho: string | null; link: string };
  const buscar = async (email: string, texto: string) =>
    (
      (await pedir("GET", `/busca?texto=${encodeURIComponent(texto)}`, await como(email))).json() as {
        resultados: Resultado[];
      }
    ).resultados;

  it("acha com erro de digitação e sem acento, agrupado por tipo", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Conferir o backup" })).json().id as string;
    await pedir("POST", "/tarefas", ana, {
      titulo: "Revisão da ação de marketing",
      descricao: "Ver o orçamento do trimestre",
    });
    await pedir("POST", `/tarefas/${t}/comentarios`, ana, { texto: "O backup de ontem falhou às 3h" });
    const r = await buscar("ana@teste.invalid", "bakup");
    expect(r.map((x) => [x.tipo, x.titulo])).toEqual([
      ["tarefa", "Conferir o backup"],
      ["comentario", "Conferir o backup"],
    ]);
    expect(r[1]?.trecho).toContain("backup de ontem");
    expect((await buscar("ana@teste.invalid", "acao")).map((x) => x.titulo)).toEqual([
      "Revisão da ação de marketing",
    ]);
    // Achou pela descrição: o trecho mostra onde.
    const peloTexto = await buscar("ana@teste.invalid", "orcamento");
    expect(peloTexto[0]?.trecho).toContain("orçamento");
    expect((await pedir("GET", "/busca?texto=a", ana)).statusCode).toBe(400);
    // % e _ são texto, não curinga.
    expect(await buscar("ana@teste.invalid", "%_")).toEqual([]);
    expect((await pedir("GET", "/busca?texto=backup&tipos=tarefa&tipos=projeto", ana)).statusCode).toBe(200);
  });

  it("o funcionário só acha o que vê; pessoa vem sem e-mail; outra empresa não acha nada", async () => {
    const ana = await como("ana@teste.invalid");
    await pedir("POST", "/tarefas", ana, { titulo: "Segredo da diretoria" });
    expect((await buscar("ana@teste.invalid", "Segredo da diretoria")).length).toBe(1);
    expect(await buscar("fabio@teste.invalid", "Segredo da diretoria")).toEqual([]);
    expect(await buscar("otto@teste.invalid", "Segredo da diretoria")).toEqual([]);
    const pessoas = (await buscar("ana@teste.invalid", "Flora")).filter((x) => x.tipo === "pessoa");
    expect(pessoas.map((p) => p.titulo)).toEqual(["Flora Func"]);
    expect(JSON.stringify(pessoas)).not.toContain("@");
    // A tarefa da própria Flora ela acha.
    await pedir("POST", "/tarefas", ana, {
      titulo: "Relatório da Flora",
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    expect((await buscar("flora@teste.invalid", "relatorio")).map((x) => x.titulo)).toContain(
      "Relatório da Flora",
    );
    expect((await buscar("fabio@teste.invalid", "relatorio")).map((x) => x.titulo)).not.toContain(
      "Relatório da Flora",
    );
  });
});
