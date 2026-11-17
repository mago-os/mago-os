/**
 * Convite para criar empresa (M1-11), de ponta a ponta: o Dono convida, o responsável cria a conta pelo link e vira
 * administrador, e o Dono não entra na conta. O carteiro é falso: guarda os e-mails para o teste ler o link.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDaConta } from "@mago-os/nucleo/conta";
import { registrarRotasDasContas } from "@mago-os/nucleo/contas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const NOVA = "a frase da conta nova do cliente";

interface Enviado {
  para: string;
  nome: string;
  quemConvidou: string;
  link: string;
}

const conta = (extra: Record<string, unknown> = {}) => ({
  tipo: "pj",
  documento: "11.222.333/0001-81",
  nomeLegal: "Cliente Um Ltda",
  nome: "Cliente Um",
  fusoHorario: "America/Sao_Paulo",
  idioma: "pt-BR",
  telefone: "",
  ...extra,
});

describe.skipIf(!bancoDisponivel)("convite para criar empresa", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  const enviados: Enviado[] = [];
  let ip = 0;
  let sandro = "";

  async function criarPessoa(nome: string, email: string) {
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [nome, email],
    );
    const id = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    return id;
  }

  async function entrar(email: string, senha = SENHA): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.3.${ip}` },
      payload: JSON.stringify({ email, password: senha }),
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

  function pedir(metodo: "GET" | "POST", url: string, cookie = "", corpo?: unknown) {
    ip += 1;
    return app.inject({
      method: metodo,
      url,
      headers: {
        cookie,
        origin: SITE,
        "x-forwarded-for": `198.18.4.${ip % 250}`,
        ...(corpo ? { "content-type": "application/json" } : {}),
      },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  const codigoDe = (e: Enviado | undefined) => new URL(e?.link ?? "").searchParams.get("codigo") ?? "";
  const ultimoPara = (email: string) => enviados.filter((e) => e.para === email).at(-1);

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const id = await criarPessoa("Sandro", "sandro@teste.invalid");
    await dono.query("insert into papeis_plataforma (pessoa_id, papel) values ($1, 'dono')", [id]);
    await criarPessoa("Fabio Func", "fabio@teste.invalid");
    await criarPessoa("Lia Existente", "lia@teste.invalid");

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    for (const pool of [poolAcesso, poolApp]) pool.on("error", () => {});
    const carteiro = {
      async enviarLinkDeSenha() {},
      async enviarConviteDeEmpresa(d: Enviado) {
        enviados.push(d);
      },
    };
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro,
      },
      poolAcesso,
    );
    app = Fastify();
    registrarRotasDoLogin(app, login, poolAcesso);
    registrarRotasDaConta(app, login, poolAcesso, poolApp);
    registrarRotasDasContas(app, {
      login,
      poolAcesso,
      carteiro,
      urlPublica: SITE,
      conferirSenhasVazadas: false,
    });
    await app.ready();
    sandro = await entrar("sandro@teste.invalid");
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("só o Dono convida e vê a lista", async () => {
    const fabio = await entrar("fabio@teste.invalid");
    expect((await pedir("GET", "/plataforma/empresas", fabio)).statusCode).toBe(403);
    expect(
      (await pedir("POST", "/plataforma/empresas/convites", fabio, { nome: "X", email: "x@teste.invalid" }))
        .statusCode,
    ).toBe(403);
    expect((await pedir("GET", "/plataforma/empresas")).statusCode).toBe(401);
    expect(
      (await pedir("POST", "/plataforma/empresas/convites", sandro, { nome: "", email: "x" })).statusCode,
    ).toBe(400);
  });

  it("quem é novo cria a senha e a conta pelo link, e vira administrador; o Dono não entra", async () => {
    const r = await pedir("POST", "/plataforma/empresas/convites", sandro, {
      nome: "Clara Cliente",
      email: " Clara@Teste.Invalid ",
    });
    expect(r.statusCode).toBe(200);
    const email = ultimoPara("clara@teste.invalid");
    expect(email).toMatchObject({ nome: "Clara Cliente", quemConvidou: "Sandro" });
    expect(email?.link.startsWith(`${SITE}/nova-conta?codigo=`)).toBe(true);
    const lista = (await pedir("GET", "/plataforma/empresas", sandro)).json();
    expect(lista.convites.map((c: { email: string }) => c.email)).toEqual(["clara@teste.invalid"]);

    const aberto = await pedir("GET", `/acesso/convite-de-empresa/${codigoDe(email)}`);
    expect(aberto.json()).toEqual({
      nome: "Clara Cliente",
      email: "clara@teste.invalid",
      quemConvidou: "Sandro",
      temConta: false,
    });

    // Documento errado e senha curta são recusados, e nada fica pela metade.
    const ruim = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo: codigoDe(email),
      senha: NOVA,
      conta: conta({ documento: "11222333000182" }),
    });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().message).toBe("Confira o documento: CNPJ inválido.");
    const curta = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo: codigoDe(email),
      senha: "curta",
      conta: conta(),
    });
    expect(curta.statusCode).toBe(400);
    expect((await dono.query("select 1 from pessoas where email = 'clara@teste.invalid'")).rowCount).toBe(0);

    const criada = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo: codigoDe(email),
      senha: NOVA,
      conta: conta(),
    });
    expect(criada.statusCode).toBe(200);
    expect(criada.json()).toMatchObject({ ok: true, precisaEntrar: true });
    // O link funciona uma vez só.
    expect((await pedir("GET", `/acesso/convite-de-empresa/${codigoDe(email)}`)).statusCode).toBe(404);

    const e = await dono.query(
      "select tipo, documento, nome_legal, nome, telefone from empresas where nome = 'Cliente Um'",
    );
    expect(e.rows[0]).toEqual({
      tipo: "pj",
      documento: "11222333000181",
      nome_legal: "Cliente Um Ltda",
      nome: "Cliente Um",
      telefone: null,
    });
    const clara = await entrar("clara@teste.invalid", NOVA);
    const empresas = (await pedir("GET", "/conta/empresas", clara)).json();
    expect(empresas).toMatchObject([{ nome: "Cliente Um", perfil: "administrador" }]);

    // O Dono vê a conta na lista, mas não está dentro dela.
    const depois = (await pedir("GET", "/plataforma/empresas", sandro)).json();
    expect(depois.empresas).toMatchObject([
      { nome: "Cliente Um", tipo: "pj", documento: "11222333000181", pessoas: 1 },
    ]);
    expect(depois.convites).toEqual([]);
    expect((await pedir("GET", "/conta/empresas", sandro)).json()).toEqual([]);

    const eventos = await dono.query(
      "select acao, empresa_id from auditoria.eventos where acao like 'empresa.%' order by ocorrido_em",
    );
    expect(eventos.rows.map((l) => l.acao)).toEqual(["empresa.convidou", "empresa.criou"]);
    expect(eventos.rows[0].empresa_id).toBeNull();
  });

  it("várias marcas podem ter o mesmo documento, cada uma numa conta separada", async () => {
    await pedir("POST", "/plataforma/empresas/convites", sandro, {
      nome: "Outro",
      email: "outro@teste.invalid",
    });
    const r = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo: codigoDe(ultimoPara("outro@teste.invalid")),
      senha: NOVA,
      conta: conta({ nome: "Cliente Um Marca Dois" }),
    });
    expect(r.statusCode).toBe(200);
    const e = await dono.query("select nome from empresas where documento = '11222333000181' order by nome");
    expect(e.rows.map((l) => l.nome)).toEqual(["Cliente Um", "Cliente Um Marca Dois"]);
  });

  it("quem já tem conta entra antes; pessoa física com CPF", async () => {
    await pedir("POST", "/plataforma/empresas/convites", sandro, { nome: "Lia", email: "lia@teste.invalid" });
    const codigo = codigoDe(ultimoPara("lia@teste.invalid"));
    expect((await pedir("GET", `/acesso/convite-de-empresa/${codigo}`)).json().temConta).toBe(true);
    const pf = conta({
      tipo: "pf",
      documento: "529.982.247-25",
      nomeLegal: "Lia Existente",
      nome: "Lia Consultoria",
    });
    const sem = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo,
      senha: NOVA,
      conta: pf,
    });
    expect(sem.statusCode).toBe(401);
    expect(sem.json().code).toBe("ENTRE_ANTES");
    const fabio = await entrar("fabio@teste.invalid");
    expect(
      (await pedir("POST", "/acesso/convite-de-empresa/criar", fabio, { codigo, conta: pf })).statusCode,
    ).toBe(403);

    const lia = await entrar("lia@teste.invalid");
    const r = await pedir("POST", "/acesso/convite-de-empresa/criar", lia, { codigo, conta: pf });
    expect(r.json()).toMatchObject({ ok: true, precisaEntrar: false });
    const empresas = (await pedir("GET", "/conta/empresas", lia)).json();
    expect(empresas).toMatchObject([{ nome: "Lia Consultoria", perfil: "administrador", ativa: true }]);
    const e = await dono.query("select tipo, documento from empresas where nome = 'Lia Consultoria'");
    expect(e.rows[0]).toEqual({ tipo: "pf", documento: "52998224725" });
  });

  it("reenviar troca o link; cancelar desfaz", async () => {
    const r = await pedir("POST", "/plataforma/empresas/convites", sandro, {
      nome: "Rui",
      email: "rui@teste.invalid",
    });
    const id = r.json().id as string;
    const primeiro = codigoDe(ultimoPara("rui@teste.invalid"));
    const de_novo = await pedir("POST", `/plataforma/empresas/convites/${id}/reenviar`, sandro);
    expect(de_novo.statusCode).toBe(200);
    const segundo = codigoDe(ultimoPara("rui@teste.invalid"));
    expect(segundo).not.toBe(primeiro);
    expect((await pedir("GET", `/acesso/convite-de-empresa/${primeiro}`)).statusCode).toBe(404);
    expect(
      (await pedir("POST", `/plataforma/empresas/convites/${de_novo.json().id}/cancelar`, sandro)).statusCode,
    ).toBe(200);
    expect((await pedir("GET", `/acesso/convite-de-empresa/${segundo}`)).statusCode).toBe(404);
    expect((await pedir("POST", `/plataforma/empresas/convites/${id}/cancelar`, sandro)).statusCode).toBe(
      404,
    );
  });

  it("antes de entrar com o Google, a pessoa do convite passa a existir com o e-mail confirmado", async () => {
    await pedir("POST", "/plataforma/empresas/convites", sandro, {
      nome: "Gabi Google",
      email: "gabi@teste.invalid",
    });
    const codigo = codigoDe(ultimoPara("gabi@teste.invalid"));
    expect(
      (await pedir("POST", "/acesso/convite-de-empresa/preparar-google", "", { codigo: "errado" }))
        .statusCode,
    ).toBe(404);
    expect((await dono.query("select 1 from pessoas where email = 'gabi@teste.invalid'")).rowCount).toBe(0);
    const r = await pedir("POST", "/acesso/convite-de-empresa/preparar-google", "", { codigo });
    expect(r.statusCode).toBe(200);
    const p = await dono.query(
      "select nome, email_verificado from pessoas where email = 'gabi@teste.invalid'",
    );
    expect(p.rows[0]).toEqual({ nome: "Gabi Google", email_verificado: true });
    // Ainda sem como entrar (o Google liga a conta depois) e o convite continua valendo.
    expect((await pedir("GET", `/acesso/convite-de-empresa/${codigo}`)).json().temConta).toBe(false);
  });

  it("conta nova só com o nome e o fuso; os dados de nota fiscal ficam para depois", async () => {
    await pedir("POST", "/plataforma/empresas/convites", sandro, {
      nome: "Mia Mínima",
      email: "mia@teste.invalid",
    });
    const codigo = codigoDe(ultimoPara("mia@teste.invalid"));
    const minimo = {
      tipo: "pj",
      documento: "",
      nomeLegal: " ",
      nome: "Mia Studio",
      fusoHorario: "America/Sao_Paulo",
      idioma: "pt-BR",
      telefone: "",
    };
    const r = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo,
      senha: NOVA,
      conta: minimo,
    });
    expect(r.statusCode).toBe(200);
    const e = await dono.query(
      "select tipo, documento, nome_legal, telefone from empresas where nome = 'Mia Studio'",
    );
    expect(e.rows[0]).toEqual({ tipo: null, documento: null, nome_legal: null, telefone: null });
  });

  it("sem o nome no Mago OS, recusa", async () => {
    await pedir("POST", "/plataforma/empresas/convites", sandro, {
      nome: "Sem Nome",
      email: "semnome@teste.invalid",
    });
    const codigo = codigoDe(ultimoPara("semnome@teste.invalid"));
    const r = await pedir("POST", "/acesso/convite-de-empresa/criar", "", {
      codigo,
      senha: NOVA,
      conta: conta({ nome: "  ", documento: "", nomeLegal: "" }),
    });
    expect(r.statusCode).toBe(400);
  });
});
