/**
 * Central de agentes (M2-03), de ponta a ponta: cadastro, pausa, desligamento (as tarefas voltam e o responsável é
 * avisado), agente como responsável de tarefa e isolamento entre empresas.
 */

import type { DadosDoAvisoDeAgente } from "@mago-os/nucleo/acesso";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000bb";

describe.skipIf(!bancoDisponivel)("central de agentes", () => {
  const avisos: DadosDoAvisoDeAgente[] = [];
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
    registrarRotasDosAgentes(app, {
      verificador,
      poolApp,
      urlPublica: SITE,
      carteiro: {
        async enviarLinkDeSenha() {},
        async enviarAvisoDeAgente(d) {
          avisos.push(d);
        },
      },
    });
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
  let claude = "";
  let pegada = "";
  let atribuida = "";

  it("a administradora cadastra o agente; o funcionário vê, mas não cadastra", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/agentes", ana, {
      nome: "Claude no Mac",
      ondeRoda: "Mac da Ana",
      responsavelId: await idDe("ana@teste.invalid"),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ situacao: "ativo", tipo: "externo", minutosSemSinal: 15 });
    claude = r.json().id;
    const fabio = await como("fabio@teste.invalid");
    const lista = await pedir("GET", "/agentes", fabio);
    // Além do Claude, a empresa tem os dois agentes internos de nascença (M4-02).
    const externos = lista.json().filter((a: { tipo: string }) => a.tipo === "externo");
    expect(externos.map((a: { nome: string }) => a.nome)).toEqual(["Claude no Mac"]);
    expect(externos[0].responsavelNome).toBe("Ana Admin");
    const negado = await pedir("POST", "/agentes", fabio, {
      nome: "Outro",
      responsavelId: await idDe("fabio@teste.invalid"),
    });
    expect(negado.statusCode).toBe(403);
  });

  it("recusa nome repetido e responsável de outra empresa", async () => {
    const ana = await como("ana@teste.invalid");
    const repetido = await pedir("POST", "/agentes", ana, {
      nome: "claude no mac",
      responsavelId: await idDe("ana@teste.invalid"),
    });
    expect(repetido.statusCode).toBe(409);
    const deFora = await pedir("POST", "/agentes", ana, {
      nome: "Agente X",
      responsavelId: await idDe("otto@teste.invalid"),
    });
    expect(deFora.statusCode).toBe(400);
  });

  it("o agente vira responsável de tarefa e aparece pelo nome", async () => {
    const ana = await como("ana@teste.invalid");
    const a = await pedir("POST", "/tarefas", ana, {
      titulo: "Organizar arquivos",
      responsavel: { tipo: "agente", agenteId: claude },
    });
    expect(a.statusCode).toBe(201);
    atribuida = a.json().id;
    const b = await pedir("POST", "/tarefas", ana, {
      titulo: "Verificar backup",
      responsavel: { tipo: "agente", agenteId: claude },
    });
    pegada = b.json().id;
    // O agente pega a tarefa pelo MCP (M2-02 e M2-05); aqui o banco faz o papel dele.
    await dono.query(
      "update tarefas set status = 'em_andamento', travada_por_agente_id = $1, travada_em = now() where id = $2",
      [claude, pegada],
    );
    const v = await pedir("GET", `/tarefas/${pegada}`, ana);
    expect(v.json().nomes[claude]).toBe("Claude no Mac");
    const lista = await pedir("GET", "/agentes", ana);
    expect(lista.json()[0].tarefasAbertas).toBe(2);
  });

  it("pausado não recebe tarefa nova; retomado volta a receber", async () => {
    const ana = await como("ana@teste.invalid");
    expect((await pedir("POST", `/agentes/${claude}/pausar`, ana)).json().situacao).toBe("pausado");
    expect((await pedir("POST", `/agentes/${claude}/pausar`, ana)).statusCode).toBe(409);
    const nova = await pedir("POST", "/tarefas", ana, {
      titulo: "Para o pausado",
      responsavel: { tipo: "agente", agenteId: claude },
    });
    expect(nova.statusCode).toBe(400);
    expect((await pedir("POST", `/agentes/${claude}/retomar`, ana)).json().situacao).toBe("ativo");
  });

  it("o funcionário não desliga; a administradora desliga e as tarefas voltam, com aviso ao responsável", async () => {
    expect(
      (await pedir("POST", `/agentes/${claude}/desligar`, await como("fabio@teste.invalid"))).statusCode,
    ).toBe(403);
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", `/agentes/${claude}/desligar`, ana);
    expect(r.json()).toMatchObject({ situacao: "desligado" });
    expect(r.json().desligadoEm).not.toBeNull();

    const p = await pedir("GET", `/tarefas/${pegada}`, ana);
    expect(p.json().tarefa).toMatchObject({ status: "a_fazer", trava: null });
    expect(p.json().comentarios.at(-1)).toMatchObject({ autor: { tipo: "sistema" } });
    const a = await pedir("GET", `/tarefas/${atribuida}`, ana);
    expect(a.json().tarefa.responsavel).toEqual({
      tipo: "pessoa",
      pessoaId: await idDe("ana@teste.invalid"),
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      para: "ana@teste.invalid",
      agente: "Claude no Mac",
      oQueAconteceu: "foi desligado",
    });
    expect(avisos[0]?.tarefas.sort()).toEqual(["Organizar arquivos", "Verificar backup"]);

    expect((await pedir("POST", `/agentes/${claude}/retomar`, ana)).statusCode).toBe(409);
    const acoes = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [claude],
    );
    expect(acoes.rows.map((l) => l.acao)).toEqual([
      "agente.cadastrou",
      "agente.pausou",
      "agente.retomou",
      "agente.desligou",
    ]);
  });

  it("outra empresa não vê o agente nem consegue usá-lo", async () => {
    const otto = await como("otto@teste.invalid");
    // Otto vê só os agentes internos da empresa dele.
    const deOtto = (await pedir("GET", "/agentes", otto)).json() as { id: string; tipo: string }[];
    expect(deOtto.filter((a) => a.tipo === "externo")).toEqual([]);
    expect(deOtto.map((a) => a.id)).not.toContain(claude);
    expect((await pedir("GET", `/agentes/${claude}`, otto)).statusCode).toBe(404);
    expect((await pedir("POST", `/agentes/${claude}/pausar`, otto)).statusCode).toBe(404);
    const t = await pedir("POST", "/tarefas", otto, {
      titulo: "Usar agente alheio",
      responsavel: { tipo: "agente", agenteId: claude },
    });
    expect(t.statusCode).toBe(400);
    await expect(
      dono.query("insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'x', $2)", [
        OUTRA,
        claude,
      ]),
    ).rejects.toThrow();
  });

  it("com alcance 'meus', a pessoa só mexe nos agentes de que é responsável", async () => {
    const ana = await como("ana@teste.invalid");
    const daAna = await pedir("POST", "/agentes", ana, {
      nome: "Da Ana",
      responsavelId: await idDe("ana@teste.invalid"),
    });
    const doFabio = await pedir("POST", "/agentes", ana, {
      nome: "Do Fabio",
      responsavelId: await idDe("fabio@teste.invalid"),
    });
    await dono.query(
      `insert into ajustes_de_permissao (empresa_id, vinculo_id, modulo, acao, alcance, feito_por)
       values ($1, $2, 'agentes', 'editar', 'meus', $3)`,
      [empresaId, vinculos["fabio@teste.invalid"], await idDe("ana@teste.invalid")],
    );
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("POST", `/agentes/${daAna.json().id}/pausar`, fabio)).statusCode).toBe(404);
    expect((await pedir("POST", `/agentes/${doFabio.json().id}/pausar`, fabio)).statusCode).toBe(200);
  });

  it("a API não apaga agentes", async () => {
    const app = new pg.Client({ connectionString: banco.urlApp });
    await app.connect();
    try {
      await expect(app.query("delete from agentes")).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});
