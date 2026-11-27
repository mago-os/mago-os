/**
 * Canais de WhatsApp pela Evolution API (M8-02, decisão 0052), com a Evolution falsa: o administrador conecta um
 * número (a instância nasce na Evolution, o QR aparece, o aviso "conectou" grava o número), o número cai (os
 * administradores e a equipe do canal são avisados), o QR que expira não avisa ninguém, o número já usado noutra
 * empresa é recusado, desconectar, mudar, apagar, a Evolution fora do ar, o segredo dos avisos e o isolamento.
 */
import type { Canal, QrDoCanal } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  CABECALHO_DO_SEGREDO,
  criarCanal,
  type EvolutionFalsa,
  evolutionFalsa,
  nomeDaInstancia,
  receberMensagem,
  registrarRotasDosCanais,
  tratarAvisoDaEvolution,
} from "@mago-os/nucleo/conversas";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-dos-avisos-da-evolution-no-teste-32";
const SILENCIO = { info() {}, warn() {}, error() {} };

describe.skipIf(!bancoDisponivel)("canais de WhatsApp pela Evolution", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let semEvolution: FastifyInstance;
  let falsa: EvolutionFalsa;
  let ip = 0;
  type Chave = "empresa" | "outra" | "ana" | "rita" | "flora" | "gil" | "olga" | "canal" | "canalDaOutra";
  const ids = {} as Record<Chave, string>;
  const cookies: Record<string, string> = {};

  async function criarPessoa(
    empresa: string,
    nome: string,
    email: string,
    perfil: string,
    area: string | null,
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

  async function como(email: string): Promise<string> {
    if (cookies[email]) return cookies[email];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.49.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode).toBe(200);
    cookies[email] = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) select id, 'c', $1, 'multiDevice' from pessoas where email = $1 on conflict do nothing",
      [email],
    );
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = (select id from pessoas where email = $1)",
      [email],
    );
    return cookies[email];
  }

  async function pedir(
    metodo: "GET" | "POST" | "DELETE",
    url: string,
    email: string,
    corpo?: unknown,
    alvo = app,
  ) {
    return alvo.inject({
      method: metodo,
      url,
      headers: {
        cookie: await como(email),
        origin: SITE,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  const avisar = (corpo: unknown, segredo = SEGREDO) =>
    app.inject({
      method: "POST",
      url: "/interno/evolution/avisos",
      headers: { "content-type": "application/json", [CABECALHO_DO_SEGREDO]: segredo },
      payload: JSON.stringify(corpo),
    });

  const canal = async (id: string) =>
    (
      await dono.query<{ situacao: string; identificador: string | null }>(
        "select situacao, identificador from canais_de_contato where id = $1",
        [id],
      )
    ).rows[0];

  const avisosDe = async (pessoaId: string) =>
    (
      await dono.query<{ tipo: string; texto: string; link: string }>(
        "select tipo, texto, link from avisos where pessoa_id = $1 and tipo = 'canal_desconectado' order by criado_em",
        [pessoaId],
      )
    ).rows;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    ids.empresa = (
      await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id")
    ).rows[0]?.id as string;
    ids.outra = (
      await dono.query<{ id: string }>("insert into empresas (nome) values ('Outra') returning id")
    ).rows[0]?.id as string;
    ids.ana = await criarPessoa(ids.empresa, "Ana Admin", "ana@teste.invalid", "administrador", null);
    ids.rita = await criarPessoa(
      ids.empresa,
      "Rita Vendas",
      "rita@teste.invalid",
      "funcionario",
      "comercial",
    );
    ids.flora = await criarPessoa(
      ids.empresa,
      "Flora Suporte",
      "flora@teste.invalid",
      "funcionario",
      "suporte",
    );
    ids.gil = await criarPessoa(ids.empresa, "Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    ids.olga = await criarPessoa(ids.outra, "Olga Outra", "olga@teste.invalid", "administrador", null);

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
    falsa = evolutionFalsa();
    const montar = (comEvolution: boolean) => {
      const a = Fastify({ logger: { level: "error" } });
      registrarRotasDoLogin(a, login, poolAcesso);
      const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
      registrarRotasDosCanais(a, {
        verificador,
        poolApp,
        evolution: comEvolution ? { cliente: falsa, segredo: SEGREDO } : null,
        // Nos testes, o aviso é tratado na hora (na API, vai para a fila).
        receber: (aviso) => tratarAvisoDaEvolution({ poolApp, evolution: falsa, log: SILENCIO }, aviso),
      });
      return a;
    };
    app = montar(true);
    semEvolution = montar(false);
  });

  afterAll(async () => {
    await app?.close();
    await semEvolution?.close();
    await poolApp?.end();
    await poolAcesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("sem a Evolution configurada, a tela sabe que o WhatsApp está desligado", async () => {
    const r = await pedir("GET", "/canais", "ana@teste.invalid", undefined, semEvolution);
    expect(r.json()).toMatchObject({ canais: [], whatsappLigado: false });
    const criar = await pedir("POST", "/canais", "ana@teste.invalid", { nome: "WhatsApp" }, semEvolution);
    expect(criar.statusCode).toBe(503);
  });

  it("só o administrador conecta um número", async () => {
    for (const email of ["gil@teste.invalid", "rita@teste.invalid"]) {
      expect((await pedir("POST", "/canais", email, { nome: "WhatsApp" })).statusCode).toBe(403);
      expect((await pedir("GET", "/canais", email)).statusCode).toBe(403);
    }
  });

  it("com a Evolution fora do ar, o canal não fica pela metade", async () => {
    falsa.foraDoAr = true;
    const r = await pedir("POST", "/canais", "ana@teste.invalid", { nome: "WhatsApp comercial" });
    falsa.foraDoAr = false;
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toMatch(/não respondeu/);
    expect((await dono.query("select 1 from canais_de_contato")).rowCount).toBe(0);
  });

  it("cria o canal e a instância, mostra o QR, e o aviso de conectado grava o número", async () => {
    const r = await pedir("POST", "/canais", "ana@teste.invalid", {
      nome: "WhatsApp comercial",
      area: "comercial",
    });
    expect(r.statusCode, r.body).toBe(201);
    const criado = (r.json() as { canal: Canal }).canal;
    ids.canal = criado.id;
    expect(criado).toMatchObject({ provedor: "evolution", situacao: "esperando_conexao", area: "comercial" });
    const instancia = nomeDaInstancia(ids.empresa, ids.canal);
    expect(falsa.instancias.has(instancia)).toBe(true);

    const qr = (await pedir("GET", `/canais/${ids.canal}/qr`, "ana@teste.invalid")).json() as QrDoCanal;
    expect(qr.situacao).toBe("esperando_conexao");
    expect(qr.qr).toMatch(/^data:image\/png;base64,/);

    // Sem o segredo, o aviso não entra.
    falsa.conectar(instancia, "+5511912340000");
    const semSegredo = await avisar(
      { event: "connection.update", instance: instancia, data: { state: "open" } },
      "x".repeat(40),
    );
    expect(semSegredo.statusCode).toBe(401);
    expect((await canal(ids.canal))?.situacao).toBe("esperando_conexao");

    const ok = await avisar({
      event: "connection.update",
      instance: instancia,
      data: { state: "open", wuid: "5511912340000:12@s.whatsapp.net" },
    });
    expect(ok.statusCode).toBe(200);
    expect(await canal(ids.canal)).toMatchObject({ situacao: "conectado", identificador: "+5511912340000" });
    const depois = (await pedir("GET", `/canais/${ids.canal}/qr`, "ana@teste.invalid")).json() as QrDoCanal;
    expect(depois).toEqual({ situacao: "conectado", qr: null, identificador: "+5511912340000" });
    const eventos = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [ids.canal],
    );
    expect(eventos.rows.map((e) => e.acao)).toEqual(["canal.criou", "canal.conectou"]);
  });

  it("o número cai: canal desconectado e aviso aos administradores e à equipe do canal", async () => {
    const instancia = nomeDaInstancia(ids.empresa, ids.canal);
    falsa.cair(instancia);
    await avisar({
      event: "connection.update",
      instance: instancia,
      data: { state: "close", statusReason: 401 },
    });
    expect((await canal(ids.canal))?.situacao).toBe("desconectado");
    expect(await avisosDe(ids.ana)).toEqual([
      expect.objectContaining({
        tipo: "canal_desconectado",
        link: "/canais",
        texto: expect.stringMatching(/WhatsApp comercial/),
      }),
    ]);
    expect(await avisosDe(ids.rita)).toHaveLength(1);
    expect(await avisosDe(ids.gil)).toHaveLength(1);
    expect(await avisosDe(ids.flora)).toHaveLength(0);
    // O mesmo aviso de novo não avisa duas vezes.
    await avisar({ event: "connection.update", instance: instancia, data: { state: "close" } });
    expect(await avisosDe(ids.ana)).toHaveLength(1);
    // Ler o QR de novo: volta a esperar e conecta.
    const qr = (await pedir("GET", `/canais/${ids.canal}/qr`, "ana@teste.invalid")).json() as QrDoCanal;
    expect(qr.situacao).toBe("esperando_conexao");
    expect(qr.qr).not.toBeNull();
  });

  it("o QR que expira antes de alguém ler não avisa ninguém, e a conexão perdida no aviso é achada pela tela", async () => {
    const instancia = nomeDaInstancia(ids.empresa, ids.canal);
    await avisar({ event: "connection.update", instance: instancia, data: { state: "close" } });
    expect(await avisosDe(ids.ana)).toHaveLength(1);
    // O aviso de conectado se perdeu: a tela confere na Evolution e o canal fica conectado.
    falsa.conectar(instancia, "+5511912340000");
    const qr = (await pedir("GET", `/canais/${ids.canal}/qr`, "ana@teste.invalid")).json() as QrDoCanal;
    expect(qr).toMatchObject({ situacao: "conectado", identificador: "+5511912340000" });
  });

  it("o número que já está noutra empresa é recusado", async () => {
    ids.canalDaOutra = (
      await comEmpresa(poolApp, ids.outra, (c) =>
        criarCanal(c, ids.olga, { nome: "Da outra", provedor: "evolution" }),
      )
    ).id;
    const instancia = nomeDaInstancia(ids.outra, ids.canalDaOutra);
    await falsa.criarInstancia(instancia);
    await avisar({
      event: "connection.update",
      instance: instancia,
      data: { state: "open", wuid: "5511912340000@s.whatsapp.net" },
    });
    expect(await canal(ids.canalDaOutra)).toMatchObject({ situacao: "desconectado", identificador: null });
    expect(await avisosDe(ids.olga)).toEqual([
      expect.objectContaining({ texto: expect.stringMatching(/já está conectado em outro canal/) }),
    ]);
    expect(falsa.instancias.get(instancia)?.estado).toBe("close");
  });

  it("uma empresa nunca vê nem mexe no canal da outra", async () => {
    for (const [metodo, url] of [
      ["GET", `/canais/${ids.canal}/qr`],
      ["POST", `/canais/${ids.canal}/desconectar`],
      ["DELETE", `/canais/${ids.canal}`],
    ] as const)
      expect((await pedir(metodo, url, "olga@teste.invalid")).statusCode).toBe(404);
    expect(
      (await pedir("POST", `/canais/${ids.canal}`, "olga@teste.invalid", { nome: "Meu" })).statusCode,
    ).toBe(404);
    const lista = (await pedir("GET", "/canais", "olga@teste.invalid")).json() as { canais: Canal[] };
    expect(lista.canais.map((x) => x.id)).toEqual([ids.canalDaOutra]);
    // Um aviso com a empresa trocada no nome da instância não acha o canal.
    await avisar({
      event: "connection.update",
      instance: nomeDaInstancia(ids.outra, ids.canal),
      data: { state: "close" },
    });
    expect((await canal(ids.canal))?.situacao).toBe("conectado");
  });

  it("muda o nome e a equipe, desconecta e só apaga o canal sem conversas", async () => {
    const muda = await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", {
      nome: "Vendas",
      area: null,
    });
    expect(muda.json()).toMatchObject({ canal: { nome: "Vendas", area: null } });
    const sai = await pedir("POST", `/canais/${ids.canal}/desconectar`, "ana@teste.invalid");
    expect(sai.json()).toMatchObject({ canal: { situacao: "desconectado" } });
    expect(falsa.instancias.get(nomeDaInstancia(ids.empresa, ids.canal))?.estado).toBe("close");

    await comEmpresa(poolApp, ids.empresa, (c) =>
      receberMensagem(c, { canalId: ids.canal, identificador: "5511988887777", tipo: "texto", texto: "Oi" }),
    );
    const recusa = await pedir("DELETE", `/canais/${ids.canal}`, "ana@teste.invalid");
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().message).toMatch(/já tem conversas/);

    const vazio = (await pedir("POST", "/canais", "ana@teste.invalid", { nome: "Teste" })).json() as {
      canal: Canal;
    };
    const apaga = await pedir("DELETE", `/canais/${vazio.canal.id}`, "ana@teste.invalid");
    expect(apaga.statusCode).toBe(200);
    expect(falsa.instancias.has(nomeDaInstancia(ids.empresa, vazio.canal.id))).toBe(false);
    const acoes = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [ids.canal],
    );
    expect(acoes.rows.map((e) => e.acao)).toEqual([
      "canal.criou",
      "canal.conectou",
      "canal.desconectou",
      "canal.conectou",
      "canal.editou",
      "canal.desconectou",
    ]);
  });

  it("aviso de instância que não é nossa ou em formato desconhecido é ignorado sem erro", async () => {
    expect(
      (await avisar({ event: "connection.update", instance: "qualquer", data: { state: "open" } }))
        .statusCode,
    ).toBe(200);
    expect((await avisar({ sem: "formato" })).statusCode).toBe(200);
  });
});
