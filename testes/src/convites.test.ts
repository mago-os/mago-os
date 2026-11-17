/**
 * Convites e desligamento (M1-07), de ponta a ponta: o administrador convida, o convidado abre o link e aceita,
 * e o desligamento corta o acesso na hora. O carteiro é falso: guarda os e-mails para o teste ler o link.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDaConta } from "@mago-os/nucleo/conta";
import { CONVITES_POR_HORA, registrarRotasDosConvites } from "@mago-os/nucleo/convites";
import { comPessoa } from "@mago-os/nucleo/empresa";
import {
  catalogoDeModulos,
  criarVerificador,
  registrarRotasDoAdministrador,
} from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const NOVA = "outra frase longa para a conta nova";

interface Enviado {
  para: string;
  nome: string;
  empresa: string;
  quemConvidou: string;
  link: string;
}

describe.skipIf(!bancoDisponivel)("convites e desligamento", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let outraId: string;
  const enviados: Enviado[] = [];
  let ip = 0;

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
    const v = await dono.query<{ id: string }>(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, 'ativo', now(), now()) returning id`,
      [empresa, id, perfil],
    );
    return v.rows[0]?.id as string;
  }

  const juntarCookies = (r: { headers: Record<string, unknown> }) =>
    ([] as string[])
      .concat((r.headers["set-cookie"] as string[] | string | undefined) ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");

  /** Entra com senha e marca o 2FA como confirmado (o 2FA tem testes próprios). */
  async function entrar(email: string, senha = SENHA): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.1.${ip}` },
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
    return juntarCookies(r);
  }

  function pedir(metodo: "GET" | "POST", url: string, cookie = "", corpo?: unknown) {
    ip += 1;
    return app.inject({
      method: metodo,
      url,
      headers: {
        cookie,
        origin: SITE,
        "x-forwarded-for": `198.18.2.${ip % 250}`,
        ...(corpo ? { "content-type": "application/json" } : {}),
      },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  const codigoDe = (e: Enviado | undefined) => new URL(e?.link ?? "").searchParams.get("codigo") ?? "";
  const ultimoPara = (email: string) => enviados.filter((e) => e.para === email).at(-1);

  let ana = "";

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>(
      "insert into empresas (nome) values ('Empresa Um') returning id",
    );
    empresaId = e.rows[0]?.id as string;
    const o = await dono.query<{ id: string }>(
      "insert into empresas (nome) values ('Empresa Dois') returning id",
    );
    outraId = o.rows[0]?.id as string;
    await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario");
    await criarPessoa("Bia Outra", "bia@teste.invalid", "administrador", outraId);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const carteiro = {
      async enviarLinkDeSenha() {},
      async enviarConvite(d: Enviado) {
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
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDoAdministrador(app, verificador, poolApp);
    registrarRotasDosConvites(app, {
      login,
      verificador,
      poolApp,
      poolAcesso,
      carteiro,
      urlPublica: SITE,
      conferirSenhasVazadas: false,
    });
    await app.ready();
    ana = await entrar("ana@teste.invalid");
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("convida quem ainda não tem conta; a pessoa define a senha pelo link e entra", async () => {
    const r = await pedir("POST", "/empresa/convites", ana, {
      email: " Nina@Teste.Invalid ",
      nome: "Nina Nova",
      perfil: "funcionario",
      area: "comercial",
    });
    expect(r.statusCode).toBe(200);
    const email = ultimoPara("nina@teste.invalid");
    expect(email).toMatchObject({ nome: "Nina Nova", empresa: "Empresa Um", quemConvidou: "Ana Admin" });
    expect(email?.link.startsWith(`${SITE}/convite?codigo=`)).toBe(true);
    // O banco guarda só a impressão digital do código.
    const guardado = await dono.query("select codigo from acesso.convites");
    expect(guardado.rows.some((l) => l.codigo === codigoDe(email))).toBe(false);

    const aberto = await pedir("GET", `/acesso/convite/${codigoDe(email)}`);
    expect(aberto.json()).toEqual({
      empresa: "Empresa Um",
      email: "nina@teste.invalid",
      nome: "Nina Nova",
      quemConvidou: "Ana Admin",
      temConta: false,
    });
    expect(
      (await pedir("POST", "/acesso/convite/aceitar", "", { codigo: codigoDe(email), senha: "curta" }))
        .statusCode,
    ).toBe(400);
    const aceito = await pedir("POST", "/acesso/convite/aceitar", "", {
      codigo: codigoDe(email),
      senha: NOVA,
    });
    expect(aceito.statusCode).toBe(200);
    expect(aceito.json()).toEqual({ ok: true, precisaEntrar: true });
    // O link funciona uma vez só.
    expect((await pedir("GET", `/acesso/convite/${codigoDe(email)}`)).statusCode).toBe(404);
    expect(
      (await pedir("POST", "/acesso/convite/aceitar", "", { codigo: codigoDe(email), senha: NOVA }))
        .statusCode,
    ).toBe(404);

    const nina = await entrar("nina@teste.invalid", NOVA);
    const empresas = (await pedir("GET", "/conta/empresas", nina)).json();
    expect(empresas.map((e: { nome: string }) => e.nome)).toEqual(["Empresa Um"]);
    const v = await dono.query(
      "select v.situacao, v.area, v.entrou_em from vinculos v join pessoas p on p.id = v.pessoa_id where p.email = 'nina@teste.invalid'",
    );
    expect(v.rows[0]).toMatchObject({ situacao: "ativo", area: "comercial" });
    const eventos = await dono.query(
      "select acao from auditoria.eventos where acao like 'vinculo.%' order by sequencia",
    );
    expect(eventos.rows.map((l) => l.acao)).toEqual(["vinculo.convidou", "vinculo.aceitou"]);
  });

  it("quem já tem conta precisa entrar antes; aceita logado e a empresa nova aparece", async () => {
    await pedir("POST", "/empresa/convites", ana, {
      email: "bia@teste.invalid",
      nome: "Bia",
      perfil: "funcionario",
    });
    const email = ultimoPara("bia@teste.invalid");
    expect(email?.nome).toBe("Bia Outra"); // o nome que já estava no sistema
    expect((await pedir("GET", `/acesso/convite/${codigoDe(email)}`)).json().temConta).toBe(true);
    const sem = await pedir("POST", "/acesso/convite/aceitar", "", { codigo: codigoDe(email), senha: NOVA });
    expect(sem.statusCode).toBe(401);
    expect(sem.json().code).toBe("ENTRE_ANTES");

    // Com a sessão de outra pessoa, recusa.
    const fabio = await entrar("fabio@teste.invalid");
    expect(
      (await pedir("POST", "/acesso/convite/aceitar", fabio, { codigo: codigoDe(email) })).statusCode,
    ).toBe(403);

    const bia = await entrar("bia@teste.invalid");
    const r = await pedir("POST", "/acesso/convite/aceitar", bia, { codigo: codigoDe(email) });
    expect(r.json()).toEqual({ ok: true, precisaEntrar: false });
    const empresas = (await pedir("GET", "/conta/empresas", bia)).json();
    expect(empresas.map((e: { nome: string }) => e.nome).sort()).toEqual(["Empresa Dois", "Empresa Um"]);
    expect(empresas.find((e: { ativa: boolean }) => e.ativa)?.nome).toBe("Empresa Um");
  });

  it("recusa convidar quem já está na empresa, e pedidos fora do formato", async () => {
    const r = await pedir("POST", "/empresa/convites", ana, {
      email: "fabio@teste.invalid",
      nome: "Fabio",
      perfil: "funcionario",
    });
    expect(r.statusCode).toBe(409);
    const ruim = await pedir("POST", "/empresa/convites", ana, {
      email: "x",
      nome: "",
      perfil: "gestor_area",
    });
    expect(ruim.statusCode).toBe(400);
  });

  it("reenviar troca o link (o anterior para de valer); cancelar desfaz o convite", async () => {
    const r = await pedir("POST", "/empresa/convites", ana, {
      email: "caio@teste.invalid",
      nome: "Caio",
      perfil: "funcionario",
    });
    const vinculoId = r.json().vinculoId as string;
    const primeiro = codigoDe(ultimoPara("caio@teste.invalid"));
    expect((await pedir("POST", `/empresa/convites/${vinculoId}/reenviar`, ana)).statusCode).toBe(200);
    const segundo = codigoDe(ultimoPara("caio@teste.invalid"));
    expect(segundo).not.toBe(primeiro);
    expect((await pedir("GET", `/acesso/convite/${primeiro}`)).statusCode).toBe(404);
    expect((await pedir("GET", `/acesso/convite/${segundo}`)).statusCode).toBe(200);

    expect((await pedir("POST", `/empresa/convites/${vinculoId}/cancelar`, ana)).statusCode).toBe(200);
    expect((await pedir("GET", `/acesso/convite/${segundo}`)).statusCode).toBe(404);
    expect((await pedir("POST", `/empresa/convites/${vinculoId}/reenviar`, ana)).statusCode).toBe(404);
    expect((await pedir("POST", `/empresa/convites/${vinculoId}/cancelar`, ana)).statusCode).toBe(404);
    // Pode ser convidado de novo depois.
    const de_novo = await pedir("POST", "/empresa/convites", ana, {
      email: "caio@teste.invalid",
      nome: "Caio",
      perfil: "funcionario",
    });
    expect(de_novo.statusCode).toBe(200);
  });

  it("funcionário não convida nem desliga", async () => {
    const fabio = await entrar("fabio@teste.invalid");
    expect(
      (
        await pedir("POST", "/empresa/convites", fabio, {
          email: "z@teste.invalid",
          nome: "Z",
          perfil: "funcionario",
        })
      ).statusCode,
    ).toBe(403);
    const anaVinculo = await dono.query(
      "select v.id from vinculos v join pessoas p on p.id = v.pessoa_id where p.email = 'ana@teste.invalid'",
    );
    expect(
      (await pedir("POST", `/empresa/pessoas/${anaVinculo.rows[0].id}/desligar`, fabio)).statusCode,
    ).toBe(403);
  });

  it("desligar corta o acesso na hora; ninguém desliga a si mesmo nem o último administrador", async () => {
    const vinculoDe = async (email: string) =>
      (
        await dono.query(
          "select v.id from vinculos v join pessoas p on p.id = v.pessoa_id where p.email = $1 and v.empresa_id = $2",
          [email, empresaId],
        )
      ).rows[0]?.id as string;

    const fabio = await entrar("fabio@teste.invalid");
    expect((await pedir("GET", "/conta/empresas", fabio)).json()).toHaveLength(1);
    expect(
      (await pedir("POST", `/empresa/pessoas/${await vinculoDe("fabio@teste.invalid")}/desligar`, ana))
        .statusCode,
    ).toBe(200);
    // Sem outra empresa, as sessões dele acabam.
    expect((await pedir("GET", "/conta/empresas", fabio)).statusCode).toBe(401);

    // Bia tem outra empresa: a sessão continua, mas sai desta.
    const bia = await entrar("bia@teste.invalid");
    await pedir("POST", "/conta/empresa-ativa", bia, { empresaId });
    expect(
      (await pedir("POST", `/empresa/pessoas/${await vinculoDe("bia@teste.invalid")}/desligar`, ana))
        .statusCode,
    ).toBe(200);
    const dela = await pedir("GET", "/conta/empresas", bia);
    expect(dela.statusCode).toBe(200);
    expect(dela.json().map((e: { nome: string }) => e.nome)).toEqual(["Empresa Dois"]);
    expect(dela.json().every((e: { ativa: boolean }) => !e.ativa)).toBe(true);

    const si = await pedir("POST", `/empresa/pessoas/${await vinculoDe("ana@teste.invalid")}/desligar`, ana);
    expect(si.statusCode).toBe(400);
    expect(si.json().message).toBe("Você não pode desligar a si mesmo.");

    const eventos = await dono.query(
      "select count(*)::int as n from auditoria.eventos where acao = 'vinculo.desligou'",
    );
    expect(eventos.rows[0].n).toBe(2);
  });

  it("não deixa a empresa ficar sem administrador (regra do banco)", async () => {
    // Pela tela isso não acontece (o único administrador só poderia desligar a si mesmo); o banco garante mesmo assim.
    const ana_ = await dono.query<{ v: string; p: string }>(
      "select v.id as v, p.id as p from vinculos v join pessoas p on p.id = v.pessoa_id where p.email = 'ana@teste.invalid'",
    );
    const { v, p } = ana_.rows[0] as { v: string; p: string };
    const outra = await criarPessoa("Gil Gerente", "gil@teste.invalid", "funcionario");
    expect(outra).toBeTruthy();
    const gil = await dono.query<{ id: string }>("select id from pessoas where email = 'gil@teste.invalid'");
    await expect(
      comPessoa(poolApp, gil.rows[0]?.id as string, empresaId, (c) =>
        c.query("select desligar_vinculo($1, $2)", [v, gil.rows[0]?.id]),
      ),
    ).rejects.toThrow(/sem administrador/);
    expect(p).toBeTruthy();
  });

  it(`limite de ${CONVITES_POR_HORA} convites por hora por pessoa`, async () => {
    const ja = await dono.query<{ n: number }>("select count(*)::int as n from acesso.convites");
    const faltam = CONVITES_POR_HORA - (ja.rows[0]?.n ?? 0);
    const quem = await dono.query("select id from pessoas where email = 'ana@teste.invalid'");
    await dono.query(
      `insert into acesso.convites (empresa_id, vinculo_id, pessoa_id, codigo, convidado_por, expira_em)
         select $1, v.id, v.pessoa_id, 'falso-' || g, $2, now() + interval '7 days'
           from generate_series(1, $3) g, (select id, pessoa_id from vinculos where empresa_id = $1 limit 1) v`,
      [empresaId, quem.rows[0].id, faltam],
    );
    const r = await pedir("POST", "/empresa/convites", ana, {
      email: "limite@teste.invalid",
      nome: "L",
      perfil: "funcionario",
    });
    expect(r.statusCode).toBe(429);
  });
});
