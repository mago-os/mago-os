/**
 * Instruções em camadas e skills (M4-05), de ponta a ponta pelas rotas: versões, voltar, o texto final com as camadas
 * na ordem, quem edita cada camada, o ciclo da skill (rascunho, publicar, atribuir) e o isolamento entre empresas.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDasInstrucoes } from "@mago-os/nucleo/instrucoes";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000ff";

describe.skipIf(!bancoDisponivel)("instruções e skills", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let ip = 0;

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.4.${ip}` },
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
    ids.fabio = await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Robo', $2) returning id",
      [empresaId, ids.ana],
    );
    ids.robo = a.rows[0]?.id as string;

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: { async enviarLinkDeSenha() {} },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
    registrarRotasDasInstrucoes(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("camadas: versões, voltar, quem edita e o texto final na ordem", async () => {
    const ana = await como("ana@teste.invalid");
    const fabio = await como("fabio@teste.invalid");
    // A empresa: duas versões e a volta para a primeira (que vira a terceira).
    const v1 = await pedir("POST", "/instrucoes/empresa", ana, {
      texto: "Responda sempre em português do Brasil.",
    });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ camada: "empresa", versao: 1, alvoId: null });
    await pedir("POST", "/instrucoes/empresa", ana, { texto: "Texto errado." });
    const volta = await pedir("POST", "/instrucoes/empresa/voltar", ana, { versao: 1 });
    expect(volta.json()).toMatchObject({
      versao: 3,
      voltouDe: 1,
      texto: "Responda sempre em português do Brasil.",
    });
    const empresa = (await pedir("GET", "/instrucoes/empresa", fabio)).json();
    expect(empresa.atual.versao).toBe(3);
    expect(empresa.versoes).toHaveLength(3);
    expect(empresa.podeEditar).toBe(false);
    // O funcionário vê, mas não edita.
    expect((await pedir("POST", "/instrucoes/empresa", fabio, { texto: "x" })).statusCode).toBe(403);
    // Projeto: o diretor (o Fabio) edita a camada do projeto dele.
    const espaco = (await pedir("POST", "/espacos", ana, { nome: "Ops" })).json().id;
    const projeto = (
      await pedir("POST", "/projetos", ana, { espacoId: espaco, nome: "Blog", diretorId: ids.fabio })
    ).json().id;
    ids.projeto = projeto;
    expect(
      (await pedir("POST", `/instrucoes/projeto/${projeto}`, fabio, { texto: "Posts com até 800 palavras." }))
        .statusCode,
    ).toBe(200);
    await pedir("POST", `/instrucoes/agente/${ids.robo}`, ana, { texto: "Assine como Robo." });
    // O texto final: plataforma, empresa, projeto (da tarefa) e agente.
    const tarefa = (await pedir("POST", "/tarefas", ana, { titulo: "Post novo", projetoId: projeto })).json()
      .id;
    const montado = (await pedir("GET", `/agentes/${ids.robo}/instrucoes?tarefa=${tarefa}`, ana)).json();
    expect(montado.camadas.map((c: { camada: string }) => c.camada)).toEqual([
      "plataforma",
      "empresa",
      "projeto",
      "agente",
    ]);
    const t = montado.texto as string;
    expect(t.indexOf("plataforma")).toBeLessThan(t.indexOf("português do Brasil"));
    expect(t.indexOf("português do Brasil")).toBeLessThan(t.indexOf("800 palavras"));
    expect(t.indexOf("800 palavras")).toBeLessThan(t.indexOf("Assine como Robo"));
    // Sem tarefa, a camada do projeto não entra.
    const semTarefa = (await pedir("GET", `/agentes/${ids.robo}/instrucoes`, ana)).json();
    expect(semTarefa.texto).not.toContain("800 palavras");
    // Outra empresa não vê nada desta.
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", "/instrucoes/empresa", otto)).json().atual).toBeNull();
    expect((await pedir("GET", `/instrucoes/agente/${ids.robo}`, otto)).statusCode).toBe(404);
    expect((await dono.query("select 1 from versoes_de_instrucoes")).rowCount).toBe(5);
    expect(
      (await dono.query("select 1 from auditoria.eventos where acao = 'instrucoes.voltou_versao'")).rowCount,
    ).toBe(1);
  });

  it("skills: rascunho, publicar, atribuir; o agente recebe só a publicada", async () => {
    const ana = await como("ana@teste.invalid");
    const fabio = await como("fabio@teste.invalid");
    const lista = (await pedir("GET", "/skills", fabio)).json() as { id: string; origem: string }[];
    expect(lista.some((s) => s.id === "plataforma:planejar-tarefas" && s.origem === "plataforma")).toBe(true);
    expect(
      (await pedir("POST", "/skills", fabio, { nome: "x-y", descricao: "d", texto: "t" })).statusCode,
    ).toBe(403);
    const criada = await pedir("POST", "/skills", ana, {
      nome: "responder-clientes",
      descricao: "Use ao responder um cliente.",
      texto: "Seja cordial.",
    });
    expect(criada.statusCode).toBe(201);
    const id = criada.json().id as string;
    expect(
      (await pedir("POST", "/skills", ana, { nome: "responder-clientes", descricao: "d", texto: "t" }))
        .statusCode,
    ).toBe(409);
    expect(
      (await pedir("POST", "/skills", ana, { nome: "planejar-tarefas", descricao: "d", texto: "t" }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await pedir("POST", `/agentes/${ids.robo}/skills`, ana, {
          skills: [id, "plataforma:planejar-tarefas"],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await pedir("POST", `/agentes/${ids.robo}/skills`, ana, { skills: ["plataforma:nao-existe"] }))
        .statusCode,
    ).toBe(400);
    // Antes de publicar, o agente não recebe a skill da empresa.
    const { skillsDoAgente } = await import("@mago-os/nucleo/instrucoes");
    const { comEmpresa } = await import("@mago-os/nucleo/empresa");
    const doRobo = () => comEmpresa(poolApp, empresaId, (c) => skillsDoAgente(c, ids.robo as string));
    expect((await doRobo()).map((s) => s.nome)).toEqual(["planejar-tarefas"]);
    expect((await pedir("POST", `/skills/${id}/publicar`, ana, {})).json()).toEqual({ versao: 1 });
    expect((await pedir("POST", `/skills/${id}/publicar`, ana, {})).statusCode).toBe(409);
    expect((await pedir("POST", "/skills/plataforma:planejar-tarefas/publicar", ana, {})).statusCode).toBe(
      404,
    );
    expect((await pedir("GET", `/agentes/${ids.robo}/skills`, ana)).json()).toEqual(
      [id, "plataforma:planejar-tarefas"].sort(),
    );
    expect((await doRobo()).find((s) => s.id === id)?.texto).toBe("Seja cordial.");
    // Editar cria o rascunho da versão 2; o agente continua com a 1 até publicar.
    expect(
      (
        await pedir("POST", `/skills/${id}/rascunho`, ana, {
          nome: "responder-clientes",
          descricao: "Use ao responder um cliente.",
          texto: "Seja cordial e breve.",
        })
      ).statusCode,
    ).toBe(200);
    expect((await doRobo()).find((s) => s.id === id)?.texto).toBe("Seja cordial.");
    const detalhe = (await pedir("GET", `/skills/${id}`, ana)).json();
    expect(detalhe.skill).toMatchObject({ versaoPublicada: 1, temRascunho: true });
    expect(detalhe.versoes.map((v: { versao: number; situacao: string }) => [v.versao, v.situacao])).toEqual([
      [2, "rascunho"],
      [1, "publicada"],
    ]);
    await pedir("POST", `/skills/${id}/publicar`, ana, {});
    expect((await doRobo()).find((s) => s.id === id)).toMatchObject({
      versao: 2,
      texto: "Seja cordial e breve.",
    });
    // Outra empresa não vê a skill.
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", `/skills/${id}`, otto)).statusCode).toBe(404);
  });
});
