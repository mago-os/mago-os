/**
 * Notificações (M3-06), de ponta a ponta: quem recebe cada aviso de tarefa (só quem vê), seguidores, preferências,
 * push com silêncio e aparelho, verificação de prazos, e-mail de aparelho novo e o isolamento.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { enviarPushPendentes, verificarPrazos } from "@mago-os/nucleo/avisos/notificacoes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000ac";

describe.skipIf(!bancoDisponivel)("notificações", () => {
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.6.${ip}` },
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
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const avisosDe = async (email: string) =>
    (await pedir("GET", "/avisos", await como(email))).json() as {
      tipo: string;
      texto: string;
      link: string;
    }[];

  it("atribuir, mencionar e comentar geram avisos só para quem vê a tarefa, e quem fez não se avisa", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Revisar o contrato",
        responsavel: { tipo: "pessoa", pessoaId: ids.flora },
      })
    ).json().id;
    expect((await avisosDe("flora@teste.invalid")).map((a) => a.tipo)).toEqual(["tarefa_atribuida"]);
    expect(await avisosDe("ana@teste.invalid")).toEqual([]);
    // Fabio não vê a tarefa: a menção não chega para ele.
    await pedir("POST", `/tarefas/${t}/comentarios`, ana, {
      texto: "@Flora @Fabio vejam",
      mencoes: [
        { tipo: "pessoa", pessoaId: ids.flora },
        { tipo: "pessoa", pessoaId: ids.fabio },
      ],
    });
    expect((await avisosDe("flora@teste.invalid")).map((a) => a.tipo)).toEqual([
      "mencao",
      "tarefa_atribuida",
    ]);
    expect(await avisosDe("fabio@teste.invalid")).toEqual([]);
    // A Flora comenta: a Ana (que criou e segue) recebe; a Flora não.
    await pedir("POST", `/tarefas/${t}/comentarios`, await como("flora@teste.invalid"), { texto: "Vi" });
    expect((await avisosDe("ana@teste.invalid")).map((a) => a.tipo)).toEqual(["comentario"]);
    expect((await avisosDe("ana@teste.invalid"))[0]?.link).toBe(`/tarefas/${t}`);
    // A Ana deixa de seguir e não recebe o próximo.
    await pedir("DELETE", `/tarefas/${t}/seguir`, ana);
    await pedir("POST", "/avisos/lidos", ana);
    await pedir("POST", `/tarefas/${t}/comentarios`, await como("flora@teste.invalid"), { texto: "De novo" });
    expect(await avisosDe("ana@teste.invalid")).toEqual([]);
  });

  it("precisa de ajuda avisa quem segue; resultado entregue avisa quem criou", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    await pedir("POST", "/avisos/lidos", ana);
    const t = (
      await pedir("POST", "/tarefas", ana, {
        titulo: "Com ajuda",
        responsavel: { tipo: "pessoa", pessoaId: ids.flora },
      })
    ).json().id;
    await pedir("POST", `/tarefas/${t}/status`, flora, { status: "precisa_de_ajuda" });
    expect((await avisosDe("ana@teste.invalid")).map((a) => a.tipo)).toEqual(["precisa_de_ajuda"]);
    await pedir("POST", `/tarefas/${t}/status`, flora, { status: "concluida", resultado: "Feito." });
    expect((await avisosDe("ana@teste.invalid")).map((a) => a.tipo)).toEqual([
      "resultado_entregue",
      "precisa_de_ajuda",
    ]);
  });

  it("preferências: sem sino e sem push, o aviso não nasce; o push respeita o silêncio e o aparelho", async () => {
    const flora = await como("flora@teste.invalid");
    await pedir("POST", "/avisos/lidos", flora);
    const prefs = await pedir("POST", "/notificacoes/preferencias", flora, {
      porTipo: { tarefa_atribuida: { tela: false, push: false } },
      silencio: null,
    });
    expect(prefs.statusCode).toBe(200);
    const ana = await como("ana@teste.invalid");
    await pedir("POST", "/tarefas", ana, {
      titulo: "Silenciosa",
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    expect(await avisosDe("flora@teste.invalid")).toEqual([]);

    // Os avisos dos testes anteriores já teriam saído.
    await dono.query("update avisos set push_pendente = false");
    // Push: liga neste aparelho e recebe o texto genérico (sem o título da tarefa).
    const ligou = await pedir("POST", "/notificacoes/push", flora, {
      endpoint: "https://push.exemplo.invalid/flora",
      chaves: { p256dh: "chave", auth: "segredo" },
    });
    expect(ligou.statusCode).toBe(201);
    expect((await pedir("GET", "/notificacoes", flora)).json()).toMatchObject({ pushNesteAparelho: true });
    await pedir("POST", "/notificacoes/preferencias", flora, { porTipo: {}, silencio: null });
    await pedir("POST", "/tarefas", ana, {
      titulo: "Segredo no título",
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    const enviados: string[] = [];
    const enviar = async (_a: unknown, conteudo: string) => {
      enviados.push(conteudo);
      return { statusCode: 201 };
    };
    const log = { warn() {} };
    expect(await enviarPushPendentes(poolApp, enviar, log)).toBe(1);
    expect(enviados[0]).toContain("Uma tarefa foi passada para você");
    expect(enviados[0]).not.toContain("Segredo no título");
    // No silêncio, o push espera (e sai depois).
    await pedir("POST", "/notificacoes/preferencias", flora, {
      porTipo: {},
      silencio: { de: "00:00", ate: "23:59" },
    });
    await pedir("POST", "/tarefas", ana, {
      titulo: "Outra",
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    expect(await enviarPushPendentes(poolApp, enviar, log)).toBe(0);
    await pedir("POST", "/notificacoes/preferencias", flora, { porTipo: {}, silencio: null });
    expect(await enviarPushPendentes(poolApp, enviar, log)).toBe(1);
    // Assinatura que o serviço diz não existir mais é apagada.
    await pedir("POST", "/tarefas", ana, {
      titulo: "Mais uma",
      responsavel: { tipo: "pessoa", pessoaId: ids.flora },
    });
    await enviarPushPendentes(poolApp, async () => Promise.reject({ statusCode: 410 }), log);
    expect(
      (await dono.query("select 1 from assinaturas_de_push where pessoa_id = $1", [ids.flora])).rowCount,
    ).toBe(0);
  });

  it("verificação de prazos: avisa uma vez o que venceu, e mudar o prazo vale de novo", async () => {
    const ana = await como("ana@teste.invalid");
    await pedir("POST", "/avisos/lidos", ana);
    const t = (
      await pedir("POST", "/tarefas", ana, { titulo: "Atrasada", prazo: { dia: "2020-01-01" } })
    ).json().id;
    expect(await verificarPrazos(poolApp)).toBeGreaterThanOrEqual(1);
    expect((await avisosDe("ana@teste.invalid")).map((a) => a.tipo)).toContain("prazo_vencido");
    await pedir("POST", "/avisos/lidos", ana);
    await verificarPrazos(poolApp);
    expect(await avisosDe("ana@teste.invalid")).toEqual([]);
    await pedir("POST", `/tarefas/${t}/planejamento`, ana, { prazo: { dia: "2020-02-01" } });
    await verificarPrazos(poolApp);
    expect((await avisosDe("ana@teste.invalid")).map((a) => a.tipo)).toEqual(["prazo_vencido"]);
  });

  it("entrar num aparelho novo manda o e-mail, sem link que faça login; outra empresa não vê avisos", async () => {
    emails.length = 0;
    // Cada entrada sem o cookie do aparelho é um aparelho novo (a pessoa já tem outro).
    await entrar("gil@teste.invalid");
    await entrar("gil@teste.invalid");
    const email = emails.find((e) => e.para === "gil@teste.invalid");
    expect(email?.link).toBe(`${SITE}/aparelhos`);
    expect(email?.aparelho).toBeTruthy();
    expect(await avisosDe("otto@teste.invalid")).toEqual([]);
  });
});
