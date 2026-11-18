/**
 * Tarefa travada para quem a pegou (M2-02): só um consegue pegar (garantido no banco), só quem pegou muda o status,
 * os outros ainda comentam, e o administrador destrava com motivo.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { pegarTarefa, registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000bb";

describe.skipIf(!bancoDisponivel)("tarefa travada", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  const vinculos: Record<string, string> = {};
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
    const v = await dono.query<{ id: string }>(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now()) returning id`,
      [empresa, id, perfil, area],
    );
    vinculos[email] = v.rows[0]?.id as string;
  }

  /** Entra com senha e, para quem precisa, marca o 2FA como confirmado (o 2FA tem testes próprios). */
  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.0.${ip}` },
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
    await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador", null);
    await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "comercial");
    await criarPessoa("Fina Financeiro", "fina@teste.invalid", "funcionario", "financeiro");
    await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);

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
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const cookies: Record<string, string> = {};
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const idDe = async (email: string) =>
    (await dono.query<{ id: string }>("select id from pessoas where email = $1", [email])).rows[0]
      ?.id as string;
  let tarefa = "";

  it("duas pessoas tentam pegar ao mesmo tempo e só uma consegue", async () => {
    const ana = await como("ana@teste.invalid");
    const gil = await como("gil@teste.invalid");
    // Criada pelo Gil: quem perder a corrida continua vendo a tarefa (Ana vê tudo; o Gil a criou).
    const t = await pedir("POST", "/tarefas", gil, {
      titulo: "Ligar para o fornecedor",
      responsavel: { tipo: "pessoa", pessoaId: await idDe("flora@teste.invalid") },
    });
    tarefa = t.json().id;
    const [a, g] = await Promise.all([
      pedir("POST", `/tarefas/${tarefa}/pegar`, ana),
      pedir("POST", `/tarefas/${tarefa}/pegar`, gil),
    ]);
    expect([a.statusCode, g.statusCode].sort()).toEqual([200, 409]);
    // Para o resto do teste, quem fica com a tarefa é o Gil.
    if (a.statusCode === 200) {
      await pedir("POST", `/tarefas/${tarefa}/soltar`, ana);
      expect((await pedir("POST", `/tarefas/${tarefa}/pegar`, gil)).statusCode).toBe(200);
    }
    const v = await pedir("GET", `/tarefas/${tarefa}`, ana);
    expect(v.json().tarefa).toMatchObject({
      status: "em_andamento",
      trava: { por: { tipo: "pessoa", pessoaId: await idDe("gil@teste.invalid") } },
      responsavel: { tipo: "pessoa", pessoaId: await idDe("gil@teste.invalid") },
    });
  });

  it("no banco: dois agentes pegando a mesma tarefa ao mesmo tempo, vinte vezes, sempre só um consegue", async () => {
    const ana = await idDe("ana@teste.invalid");
    const agentes = await dono.query<{ id: string }>(
      `insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Agente A', $2), ($1, 'Agente B', $2)
       returning id`,
      [empresaId, ana],
    );
    const [a, b] = agentes.rows.map((l) => l.id) as [string, string];
    for (let i = 0; i < 20; i += 1) {
      const t = await dono.query<{ id: string }>(
        "insert into tarefas (empresa_id, titulo) values ($1, $2) returning id",
        [empresaId, `Corrida ${i}`],
      );
      const id = t.rows[0]?.id as string;
      const resultados = await Promise.all(
        [a, b].map((agenteId) =>
          comEmpresa(poolApp, empresaId, (c) => pegarTarefa(c, { tipo: "agente", agenteId }, id)),
        ),
      );
      expect(resultados.filter((r) => r !== null)).toHaveLength(1);
    }
  });

  it("travada: os outros não mudam o status nem o responsável, mas comentam", async () => {
    const ana = await como("ana@teste.invalid");
    const s = await pedir("POST", `/tarefas/${tarefa}/status`, ana, { status: "concluida", resultado: "x" });
    expect(s.statusCode).toBe(409);
    expect(s.json().code).toBe("TAREFA_TRAVADA");
    const r = await pedir("POST", `/tarefas/${tarefa}/responsavel`, ana, { responsavel: null });
    expect(r.statusCode).toBe(409);
    expect(
      (await pedir("POST", `/tarefas/${tarefa}/comentarios`, ana, { texto: "Como vai?" })).statusCode,
    ).toBe(201);
    expect((await pedir("POST", `/tarefas/${tarefa}/soltar`, ana)).statusCode).toBe(409);
  });

  it("quem pegou muda o status e solta", async () => {
    const gil = await como("gil@teste.invalid");
    const s = await pedir("POST", `/tarefas/${tarefa}/status`, gil, { status: "precisa_de_ajuda" });
    expect(s.json()).toMatchObject({ status: "precisa_de_ajuda" });
    expect(s.json().trava).not.toBeNull();
    const solta = await pedir("POST", `/tarefas/${tarefa}/soltar`, gil);
    expect(solta.json()).toMatchObject({ status: "a_fazer", trava: null });
  });

  it("só o administrador destrava, com motivo, e vai para a auditoria", async () => {
    const gil = await como("gil@teste.invalid");
    const ana = await como("ana@teste.invalid");
    await pedir("POST", `/tarefas/${tarefa}/pegar`, gil);
    expect((await pedir("POST", `/tarefas/${tarefa}/destravar`, gil, { motivo: "x" })).statusCode).toBe(403);
    expect((await pedir("POST", `/tarefas/${tarefa}/destravar`, ana, {})).statusCode).toBe(400);
    const d = await pedir("POST", `/tarefas/${tarefa}/destravar`, ana, { motivo: "O Gil saiu de férias." });
    expect(d.json()).toMatchObject({ status: "a_fazer", trava: null });
    expect((await pedir("POST", `/tarefas/${tarefa}/destravar`, ana, { motivo: "de novo" })).statusCode).toBe(
      409,
    );
    const v = await pedir("GET", `/tarefas/${tarefa}`, ana);
    expect(v.json().comentarios.at(-1).texto).toBe("Destravou: O Gil saiu de férias.");
    const acoes = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [tarefa],
    );
    expect(acoes.rows.map((l) => l.acao)).toEqual(
      expect.arrayContaining(["tarefa.pegou", "tarefa.soltou", "tarefa.destravou"]),
    );
  });

  it("pôr em andamento é pegar, passar a outro solta, e não se exclui a tarefa de quem está com ela", async () => {
    const ana = await como("ana@teste.invalid");
    const gil = await como("gil@teste.invalid");
    const s = await pedir("POST", `/tarefas/${tarefa}/status`, gil, { status: "em_andamento" });
    expect(s.json().trava).toMatchObject({
      por: { tipo: "pessoa", pessoaId: await idDe("gil@teste.invalid") },
    });
    expect((await pedir("POST", `/tarefas/${tarefa}/pegar`, gil)).statusCode).toBe(200);
    const mine = await pedir("GET", "/tarefas?minhas=1", gil);
    expect(mine.json().tarefas.map((t: { id: string }) => t.id)).toContain(tarefa);
    expect((await pedir("DELETE", `/tarefas/${tarefa}`, ana)).statusCode).toBe(409);
    const passa = await pedir("POST", `/tarefas/${tarefa}/responsavel`, gil, {
      responsavel: { tipo: "pessoa", pessoaId: await idDe("flora@teste.invalid") },
    });
    expect(passa.json()).toMatchObject({ trava: null });
    expect(
      (await pedir("POST", `/tarefas/${tarefa}/pegar`, await como("flora@teste.invalid"))).statusCode,
    ).toBe(200);
  });

  it("tarefa encerrada não se pega", async () => {
    const ana = await como("ana@teste.invalid");
    await pedir("POST", `/tarefas/${tarefa}/status`, ana, { status: "cancelada" });
    expect((await pedir("POST", `/tarefas/${tarefa}/pegar`, ana)).statusCode).toBe(409);
  });
});
