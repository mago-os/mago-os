/**
 * Contas de IA (M4-01): a chave nunca sai pela API nem para a auditoria, a chave errada é recusada no teste, uma
 * empresa não usa a conta da outra, os modelos chegam desligados e só o liberado vai para um agente.
 */
import { randomBytes } from "node:crypto";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { criarCofre, provedoresFalsos, registrarRotasDasContasDeIa } from "@mago-os/nucleo/contas-de-ia";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000c3";
const CHAVE_BOA = "sk-ant-api03-chave-boa-de-teste-Xy9Q";
const CHAVE_NOVA = "sk-ant-api03-chave-nova-de-teste-Zw2R";
const TOKEN_DO_PLANO = "sk-ant-oat01-token-do-plano-de-teste-Pl4n";
const LOGIN_DO_CODEX = JSON.stringify(
  { tokens: { access_token: "acesso-velho", refresh_token: "renovacao-velha", account_id: "conta-Cdx1" } },
  null,
  2,
);
const LOGIN_RENOVADO = JSON.stringify({
  tokens: { access_token: "acesso-novo", refresh_token: "renovacao-nova", account_id: "conta-Cdx1" },
});

describe.skipIf(!bancoDisponivel)("contas de IA", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let ip = 0;
  const noLimite = new Set<string>();
  const provedores = provedoresFalsos(
    {
      [CHAVE_BOA]: ["claude-sonnet-5-5", "claude-haiku-5-5"],
      [CHAVE_NOVA]: ["claude-sonnet-5-5", "claude-opus-5-5"],
      [TOKEN_DO_PLANO]: ["claude-opus-5-5", "claude-sonnet-5-5"],
      [LOGIN_DO_CODEX]: ["gpt-5.1"],
      [LOGIN_RENOVADO]: ["gpt-5.1"],
    },
    { noLimite, renovar: (chave) => (chave === LOGIN_DO_CODEX ? LOGIN_RENOVADO : undefined) },
  );

  async function criarPessoa(nome: string, email: string, perfil: string, empresa = empresaId) {
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
         values ($1, $2, $3, null, 'ativo', now(), now())`,
      [empresa, id, perfil],
    );
    return id;
  }

  const cookies: Record<string, string> = {};
  async function como(email: string): Promise<string> {
    if (cookies[email]) return cookies[email];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.12.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode).toBe(200);
    // Segundo fator confirmado agora (o administrador precisa dele, e conectar a chave pede a confirmação recente).
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = (select id from pessoas where email = $1)",
      [email],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) select id, 'c', $1, 'multiDevice' from pessoas where email = $1 on conflict do nothing",
      [email],
    );
    cookies[email] = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return cookies[email];
  }

  function pedir(metodo: "GET" | "POST" | "DELETE", url: string, cookie: string, corpo?: unknown) {
    return app.inject({
      method: metodo,
      url,
      headers: {
        cookie,
        origin: SITE,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>(
      "insert into empresas (nome) values ('Empresa Um') returning id",
    );
    empresaId = e.rows[0]?.id as string;
    await dono.query("insert into empresas (id, nome) values ($1, 'Outra Empresa')", [OUTRA]);
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", OUTRA);
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Coordenador', $2) returning id",
      [empresaId, ids.ana],
    );
    ids.agente = a.rows[0]?.id as string;

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: { async enviarLinkDeSenha() {}, async enviarAparelhoNovo() {} },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDosAgentes(app, {
      verificador,
      poolApp,
      carteiro: { async enviarLinkDeSenha() {}, async enviarAparelhoNovo() {} },
      urlPublica: SITE,
    } as Parameters<typeof registrarRotasDosAgentes>[1]);
    registrarRotasDasContasDeIa(app, {
      verificador,
      poolApp,
      cofre: criarCofre({ atual: { versao: 1, chave: randomBytes(32) }, anteriores: [] }),
      provedores,
      ambiente: "teste",
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

  it("recusa a chave errada sem gravar nada, e quem não administra não vê nem conecta", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    const ruim = await pedir("POST", "/ia/contas", ana, {
      nome: "Anthropic",
      provedor: "anthropic",
      chave: "sk-ant-api03-chave-errada",
    });
    expect(ruim.statusCode).toBe(422);
    expect(ruim.json().code).toBe("CHAVE_RECUSADA");
    expect((await dono.query("select 1 from contas_de_ia")).rowCount).toBe(0);
    expect((await pedir("GET", "/ia/contas", flora)).statusCode).toBe(403);
    expect(
      (await pedir("POST", "/ia/contas", flora, { nome: "X", provedor: "anthropic", chave: CHAVE_BOA }))
        .statusCode,
    ).toBe(403);
  });

  it("recusa endereço da rede interna num provedor compatível", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/ia/contas", ana, {
      nome: "Interno",
      provedor: "compativel_openai",
      endereco: "https://169.254.169.254/latest",
      chave: CHAVE_BOA,
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("ENDERECO_INVALIDO");
  });

  it("conecta, guarda só cifrado e a chave nunca sai pela API nem pela auditoria", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/ia/contas", ana, {
      nome: "Anthropic da Nolask",
      provedor: "anthropic",
      chave: CHAVE_BOA,
      tetoMensal: 5000,
    });
    expect(r.statusCode).toBe(201);
    ids.conta = r.json().id;
    expect(r.json()).toMatchObject({ finalDaChave: "Xy9Q", situacao: "ativa", tetoMensal: 5000 });
    expect(r.body).not.toContain("chave-boa");

    const lista = await pedir("GET", "/ia/contas", ana);
    expect(lista.json().contas[0]).toMatchObject({ modelos: 2, liberados: 0 });
    expect(lista.body).not.toContain("chave-boa");

    const guardada = await dono.query<{ chave_cifrada: Buffer }>("select chave_cifrada from contas_de_ia");
    expect(guardada.rows[0]?.chave_cifrada.includes(Buffer.from("chave-boa"))).toBe(false);
    const chaveDaEmpresa = await dono.query("select 1 from chaves_de_dados where empresa_id = $1", [
      empresaId,
    ]);
    expect(chaveDaEmpresa.rowCount).toBe(1);

    const eventos = await dono.query<{ acao: string; detalhes: unknown }>(
      "select acao, detalhes from auditoria.eventos where empresa_id = $1 and acao like 'ia.%'",
      [empresaId],
    );
    expect(eventos.rows.map((e) => e.acao)).toContain("ia.conectou");
    expect(JSON.stringify(eventos.rows)).not.toContain("chave-boa");
  });

  it("testa de novo abrindo a chave do cofre", async () => {
    const ana = await como("ana@teste.invalid");
    const antes = provedores.chamadas;
    const r = await pedir("POST", `/ia/contas/${ids.conta}/testar`, ana, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ situacao: "ativa", modelosNovos: 0 });
    expect(provedores.chamadas).toBe(antes + 1);
    expect(r.body).not.toContain("chave-boa");
  });

  it("modelo desligado não vai para o agente; liberado vai, com reserva diferente", async () => {
    const ana = await como("ana@teste.invalid");
    const principal = { contaId: ids.conta, modelo: "claude-sonnet-5-5" };
    const reserva = { contaId: ids.conta, modelo: "claude-haiku-5-5" };
    const cedo = await pedir("POST", `/agentes/${ids.agente}/modelos`, ana, {
      modelos: { principal, reserva: null },
    });
    expect(cedo.statusCode).toBe(400);
    expect(cedo.json().code).toBe("MODELO_INDISPONIVEL");

    const lib = await pedir("POST", `/ia/contas/${ids.conta}/modelos`, ana, {
      modelos: [
        { modelo: "claude-sonnet-5-5", liberado: true },
        { modelo: "claude-haiku-5-5", liberado: true },
      ],
    });
    expect(lib.statusCode).toBe(200);
    expect(lib.json().filter((m: { liberado: boolean }) => m.liberado)).toHaveLength(2);

    const igual = await pedir("POST", `/agentes/${ids.agente}/modelos`, ana, {
      modelos: { principal, reserva: principal },
    });
    expect(igual.statusCode).toBe(400);
    const ok = await pedir("POST", `/agentes/${ids.agente}/modelos`, ana, {
      modelos: { principal, reserva },
    });
    expect(ok.statusCode).toBe(200);
    expect((await pedir("GET", `/agentes/${ids.agente}/modelos`, ana)).json()).toEqual({
      modelos: { principal, reserva },
    });

    // Não desliga um modelo em uso.
    const emUso = await pedir("POST", `/ia/contas/${ids.conta}/modelos`, ana, {
      modelos: [{ modelo: "claude-haiku-5-5", liberado: false }],
    });
    expect(emUso.statusCode).toBe(409);
    expect(emUso.json().code).toBe("MODELO_EM_USO");
  });

  it("trocar a chave testa a nova, marca o modelo que sumiu e traz o novo desligado", async () => {
    const ana = await como("ana@teste.invalid");
    expect(
      (await pedir("POST", `/ia/contas/${ids.conta}`, ana, { chave: "sk-ant-api03-errada-de-novo" }))
        .statusCode,
    ).toBe(422);
    const r = await pedir("POST", `/ia/contas/${ids.conta}`, ana, { chave: CHAVE_NOVA });
    expect(r.statusCode).toBe(200);
    expect(r.json().finalDaChave).toBe("Zw2R");
    const modelos = (await pedir("GET", `/ia/contas/${ids.conta}/modelos`, ana)).json() as {
      modelo: string;
      liberado: boolean;
      sumiu: boolean;
    }[];
    expect(modelos.find((m) => m.modelo === "claude-haiku-5-5")?.sumiu).toBe(true);
    expect(modelos.find((m) => m.modelo === "claude-opus-5-5")).toMatchObject({
      liberado: false,
      sumiu: false,
    });
  });

  it("nome repetido é recusado sem chamar o provedor, e renomear vira ia.editou", async () => {
    const ana = await como("ana@teste.invalid");
    const antes = provedores.chamadas;
    const r = await pedir("POST", "/ia/contas", ana, {
      nome: "anthropic da nolask",
      provedor: "anthropic",
      chave: CHAVE_BOA,
    });
    expect(r.statusCode).toBe(409);
    expect(provedores.chamadas).toBe(antes);
    const renomeada = await pedir("POST", `/ia/contas/${ids.conta}`, ana, { nome: "Anthropic principal" });
    expect(renomeada.json().nome).toBe("Anthropic principal");
    const ev = await dono.query<{ detalhes: { mudou: string[] } }>(
      "select detalhes from auditoria.eventos where acao = 'ia.editou' and empresa_id = $1",
      [empresaId],
    );
    expect(ev.rows.at(-1)?.detalhes.mudou).toEqual(["nome"]);
  });

  it("chave que o cofre não abre deixa a conta com erro, sem derrubar", async () => {
    const ana = await como("ana@teste.invalid");
    const copia = await dono.query<{ chave_cifrada: Buffer }>(
      "select chave_cifrada from contas_de_ia where id = $1",
      [ids.conta],
    );
    const adulterada = Buffer.from(copia.rows[0]?.chave_cifrada as Buffer);
    adulterada[13] = (adulterada[13] ?? 0) ^ 1;
    await dono.query("update contas_de_ia set chave_cifrada = $2 where id = $1", [ids.conta, adulterada]);
    const r = await pedir("POST", `/ia/contas/${ids.conta}/testar`, ana, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ situacao: "com_erro" });
    expect(r.json().ultimoErro).toContain("Troque a chave");
    // Trocar a chave conserta.
    expect((await pedir("POST", `/ia/contas/${ids.conta}`, ana, { chave: CHAVE_NOVA })).json().situacao).toBe(
      "ativa",
    );
  });

  it("uma empresa não vê nem usa a conta da outra", async () => {
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", "/ia/contas", otto)).json().contas).toEqual([]);
    expect((await pedir("POST", `/ia/contas/${ids.conta}/testar`, otto, {})).statusCode).toBe(404);
    expect((await pedir("GET", `/ia/contas/${ids.conta}/modelos`, otto)).statusCode).toBe(404);
    expect((await pedir("DELETE", `/ia/contas/${ids.conta}`, otto)).statusCode).toBe(404);
    // Nem pelo banco, com a empresa dele ativa: o RLS esconde a conta e a chave de dados.
    const c = await poolApp.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('mago.empresa_id', $1, true)", [OUTRA]);
      await c.query("select set_config('mago.pessoa_id', $1, true)", [ids.otto]);
      expect((await c.query("select 1 from contas_de_ia")).rowCount).toBe(0);
      expect((await c.query("select 1 from chaves_de_dados")).rowCount).toBe(0);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("assinatura: sem o aceite dos termos não conecta; com ele, o aceite fica na conta e na auditoria", async () => {
    const ana = await como("ana@teste.invalid");
    const pedido = {
      nome: "Claude Max",
      provedor: "anthropic",
      credencial: "assinatura",
      chave: TOKEN_DO_PLANO,
    };
    expect((await pedir("POST", "/ia/contas", ana, pedido)).statusCode).toBe(400);
    expect(
      (await pedir("POST", "/ia/contas", ana, { ...pedido, aceitoOsTermos: true, tetoMensal: 2000 }))
        .statusCode,
    ).toBe(400);
    const r = await pedir("POST", "/ia/contas", ana, { ...pedido, aceitoOsTermos: true });
    expect(r.statusCode).toBe(201);
    ids.plano = r.json().id;
    expect(r.json()).toMatchObject({
      credencial: "assinatura",
      termosAceitosPor: ids.ana,
      tetoMensal: null,
      finalDaChave: "Pl4n",
    });
    expect(provedores.ultimoAcesso?.credencial).toBe("assinatura");
    expect(r.body).not.toContain("token-do-plano");
    const ev = await dono.query<{ detalhes: { versaoDoAviso: number; provedor: string } }>(
      "select detalhes from auditoria.eventos where acao = 'ia.aceitou_termos' and empresa_id = $1",
      [empresaId],
    );
    expect(ev.rows[0]?.detalhes).toMatchObject({ provedor: "anthropic", versaoDoAviso: 1 });
    // A assinatura não tem teto em dólar.
    const teto = await pedir("POST", `/ia/contas/${ids.plano}`, ana, { tetoMensal: 1000 });
    expect(teto.statusCode).toBe(400);
  });

  it("limite do plano: a conta continua ativa, o modelo fica indisponível e volta no teste seguinte", async () => {
    const ana = await como("ana@teste.invalid");
    await pedir("POST", `/ia/contas/${ids.plano}/modelos`, ana, {
      modelos: [{ modelo: "claude-opus-5-5", liberado: true }],
    });
    noLimite.add(TOKEN_DO_PLANO);
    const r = await pedir("POST", `/ia/contas/${ids.plano}/testar`, ana, {});
    expect(r.json().situacao).toBe("ativa");
    expect(Date.parse(r.json().limiteDoPlanoAte)).toBeGreaterThan(Date.now());
    const escolha = await pedir("POST", `/agentes/${ids.agente}/modelos`, ana, {
      modelos: { principal: { contaId: ids.plano, modelo: "claude-opus-5-5" }, reserva: null },
    });
    // Escolher o modelo não é barrado pelo limite (é passageiro); quem respeita o limite é o motor, na hora de rodar.
    expect(escolha.statusCode).toBe(200);
    await pedir("POST", `/agentes/${ids.agente}/modelos`, ana, { modelos: null });
    noLimite.delete(TOKEN_DO_PLANO);
    const de_novo = await pedir("POST", `/ia/contas/${ids.plano}/testar`, ana, {});
    expect(de_novo.json().limiteDoPlanoAte).toBeNull();
    const ev = await dono.query(
      "select 1 from auditoria.eventos where acao = 'ia.chegou_no_limite_do_plano' and empresa_id = $1",
      [empresaId],
    );
    expect(ev.rowCount).toBe(1);
  });

  it("ChatGPT: só por assinatura, e o login renovado volta para o cofre", async () => {
    const ana = await como("ana@teste.invalid");
    expect(
      (
        await pedir("POST", "/ia/contas", ana, {
          nome: "ChatGPT por chave",
          provedor: "chatgpt",
          chave: "sk-proj-chave-de-api",
        })
      ).statusCode,
    ).toBe(400);
    const r = await pedir("POST", "/ia/contas", ana, {
      nome: "ChatGPT Plus",
      provedor: "chatgpt",
      credencial: "assinatura",
      chave: LOGIN_DO_CODEX,
      aceitoOsTermos: true,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().finalDaChave).toBe("Cdx1");
    expect(r.body).not.toContain("renovacao");
    // O próximo teste abre o login renovado (o velho já não vale no provedor).
    await pedir("POST", `/ia/contas/${r.json().id}/testar`, ana, {});
    expect(provedores.ultimoAcesso?.chave).toBe(LOGIN_RENOVADO);
    await pedir("DELETE", `/ia/contas/${r.json().id}`, ana);
    await pedir("DELETE", `/ia/contas/${ids.plano}`, ana);
  });

  it("apagar a conta limpa a escolha do agente e vira ia.apagou", async () => {
    const ana = await como("ana@teste.invalid");
    expect((await pedir("DELETE", `/ia/contas/${ids.conta}`, ana)).statusCode).toBe(204);
    expect((await pedir("GET", `/agentes/${ids.agente}/modelos`, ana)).json()).toEqual({ modelos: null });
    const ev = await dono.query(
      "select 1 from auditoria.eventos where acao = 'ia.apagou' and empresa_id = $1 and detalhes->>'nome' = 'Anthropic principal'",
      [empresaId],
    );
    expect(ev.rowCount).toBe(1);
  });
});
