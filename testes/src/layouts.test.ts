/**
 * Layouts de painéis (M3-10): salvar, trocar e apagar; só a dona vê os dela; a estrutura só cita painéis declarados;
 * limite de nome repetido.
 */
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDosLayouts } from "@mago-os/nucleo/layouts";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000b1";

describe.skipIf(!bancoDisponivel)("layouts de painéis", () => {
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.10.${ip}` },
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
    registrarRotasDosLayouts(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const MEU_DIA = {
    nome: "Meu dia",
    aparelho: "computador",
    estrutura: {
      paineis: [
        { id: "t1", tipo: "tarefas" },
        { id: "p1", tipo: "prioridades" },
      ],
      divisao: {
        grid: {},
        panels: {
          t1: { id: "t1", contentComponent: "tarefas", params: { painel: { id: "t1", tipo: "tarefas" } } },
          p1: {
            id: "p1",
            contentComponent: "prioridades",
            params: { painel: { id: "p1", tipo: "prioridades" } },
          },
        },
      },
    },
  };

  it("salva, lista o último usado primeiro, troca e apaga; só a dona vê", async () => {
    const flora = await como("flora@teste.invalid");
    const criou = await pedir("POST", "/layouts", flora, MEU_DIA);
    expect(criou.statusCode).toBe(201);
    const outro = (await pedir("POST", "/layouts", flora, { ...MEU_DIA, nome: "Projetos" })).json();
    let lista = (await pedir("GET", "/layouts?aparelho=computador", flora)).json().layouts as {
      id: string;
      nome: string;
    }[];
    expect(lista.map((l) => l.nome)).toEqual(["Projetos", "Meu dia"]);
    await pedir("POST", `/layouts/${criou.json().id}/usar`, flora);
    lista = (await pedir("GET", "/layouts?aparelho=computador", flora)).json().layouts;
    expect(lista[0]?.nome).toBe("Meu dia");
    // O celular tem os seus.
    expect((await pedir("GET", "/layouts?aparelho=celular", flora)).json().layouts).toEqual([]);
    // Ninguém mais vê nem mexe.
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("GET", "/layouts", fabio)).json().layouts).toEqual([]);
    expect((await pedir("POST", `/layouts/${outro.id}/usar`, fabio)).statusCode).toBe(404);
    expect((await pedir("DELETE", `/layouts/${outro.id}`, fabio)).statusCode).toBe(404);
    expect((await pedir("DELETE", `/layouts/${outro.id}`, flora)).statusCode).toBe(204);
  });

  it("recusa nome repetido, painel desconhecido na divisão e favorito fora do layout", async () => {
    const flora = await como("flora@teste.invalid");
    expect((await pedir("POST", "/layouts", flora, MEU_DIA)).statusCode).toBe(400);
    const divisaoErrada = {
      ...MEU_DIA,
      nome: "Errado",
      estrutura: {
        ...MEU_DIA.estrutura,
        divisao: { panels: { x: { id: "x", contentComponent: "financeiro" } } },
      },
    };
    expect((await pedir("POST", "/layouts", flora, divisaoErrada)).statusCode).toBe(400);
    // A divisão não pode abrir um painel diferente do declarado (outros parâmetros).
    const trocado = structuredClone(MEU_DIA);
    trocado.nome = "Trocado";
    (trocado.estrutura.divisao.panels.t1.params.painel as Record<string, unknown>).tipo = "projeto";
    expect((await pedir("POST", "/layouts", flora, trocado)).statusCode).toBe(400);
    const favorito = {
      ...MEU_DIA,
      nome: "Fav",
      aparelho: "celular",
      estrutura: { paineis: MEU_DIA.estrutura.paineis, favoritos: ["zz"] },
    };
    expect((await pedir("POST", "/layouts", flora, favorito)).statusCode).toBe(400);
  });
});
