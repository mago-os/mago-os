/**
 * Mensagens pela Evolution (M8-03, decisão 0053), com a Evolution falsa: cada tipo chega certo; a foto passa pelo
 * antivírus (a infectada fica bloqueada); o que o próprio número manda entra "pelo celular" sem repetir o que a caixa
 * acabou de mandar; grupo é ignorado; o LID sem telefone vira contato não identificado; a mensagem enviada fica "lida"
 * pelos avisos; a que falha mostra o motivo e sai de novo; o ritmo segura e avisa; o prazo apaga o arquivo; e nada
 * passa de uma empresa para a outra.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MensagemDaConversa } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { antivirusDeTeste } from "@mago-os/nucleo/anexos/antivirus";
import { criarDepositoEmDisco } from "@mago-os/nucleo/anexos/deposito";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  CABECALHO_DO_SEGREDO,
  cuidarDoPrazoDosArquivos,
  type EvolutionFalsa,
  enviarPendente,
  evolutionFalsa,
  nomeDaInstancia,
  registrarRotasDasConversas,
  registrarRotasDoEnvio,
  registrarRotasDosCanais,
  tratarAvisoDaEvolution,
} from "@mago-os/nucleo/conversas";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-dos-avisos-das-mensagens-no-teste-32";
const SILENCIO = { info() {}, warn() {}, error() {} };
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe.skipIf(!bancoDisponivel)("mensagens pela Evolution", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let falsa: EvolutionFalsa;
  let arquivos: { deposito: ReturnType<typeof criarDepositoEmDisco>; antivirus: typeof antivirusDeTeste };
  const filaDeEnvio: { empresaId: string; mensagemId: string }[] = [];
  let ip = 0;
  type Chave = "empresa" | "outra" | "ana" | "olga" | "canal" | "canalDaOutra" | "conversa";
  const ids = {} as Record<Chave, string>;
  const cookies: Record<string, string> = {};
  let n = 0;

  async function criarPessoa(empresa: string, nome: string, email: string, perfil: string) {
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

  async function como(email: string): Promise<string> {
    if (cookies[email]) return cookies[email];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.50.${ip}` },
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

  async function pedir(metodo: "GET" | "POST", url: string, email: string, corpo?: unknown) {
    return app.inject({
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

  const avisar = (empresa: string, canal: string, event: string, data: unknown) =>
    app.inject({
      method: "POST",
      url: "/interno/evolution/avisos",
      headers: { "content-type": "application/json", [CABECALHO_DO_SEGREDO]: SEGREDO },
      payload: JSON.stringify({ event, instance: nomeDaInstancia(empresa, canal), data }),
    });

  /** Uma mensagem do contato (ou do próprio número) no canal da 4xpert. */
  const chegou = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    n += 1;
    const { key, ...resto } = extra;
    return avisar(ids.empresa, ids.canal, "messages.upsert", {
      key: {
        remoteJid: "5511988887777@s.whatsapp.net",
        fromMe: false,
        id: `C${n}`,
        ...((key as object) ?? {}),
      },
      pushName: "Bia",
      message,
      messageTimestamp: Math.floor(Date.now() / 1000) - 200 + n,
      ...resto,
    });
  };

  const mensagens = async () =>
    (
      (await pedir("GET", `/conversas-com-contatos/${ids.conversa}`, "ana@teste.invalid")).json() as {
        mensagens: MensagemDaConversa[];
      }
    ).mensagens;

  const opcoes = () => ({ poolApp, evolution: falsa, arquivos, log: SILENCIO });

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
    ids.ana = await criarPessoa(ids.empresa, "Ana Admin", "ana@teste.invalid", "administrador");
    ids.olga = await criarPessoa(ids.outra, "Olga Outra", "olga@teste.invalid", "administrador");

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
    arquivos = {
      deposito: criarDepositoEmDisco(SITE, await mkdtemp(join(tmpdir(), "conversas-"))),
      antivirus: antivirusDeTeste,
    };
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasConversas(app, verificador, poolApp);
    registrarRotasDosCanais(app, {
      verificador,
      poolApp,
      evolution: { cliente: falsa, segredo: SEGREDO },
      receber: (aviso) => tratarAvisoDaEvolution(opcoes(), aviso),
    });
    registrarRotasDoEnvio(app, {
      verificador,
      poolApp,
      arquivos,
      enfileirar: async (empresaId, mensagemId) => {
        filaDeEnvio.push({ empresaId, mensagemId });
      },
    });

    // Um canal conectado em cada empresa.
    for (const [empresa, email, numero] of [
      [ids.empresa, "ana@teste.invalid", "+5511900001111"],
      [ids.outra, "olga@teste.invalid", "+5511900002222"],
    ] as const) {
      const r = await pedir("POST", "/canais", email, { nome: "WhatsApp" });
      const canal = (r.json() as { canal: { id: string } }).canal.id;
      falsa.conectar(nomeDaInstancia(empresa, canal), numero);
      await avisar(empresa, canal, "connection.update", {
        state: "open",
        wuid: `${numero.slice(1)}@s.whatsapp.net`,
      });
      if (empresa === ids.empresa) ids.canal = canal;
      else ids.canalDaOutra = canal;
    }
  });

  afterAll(async () => {
    await app?.close();
    await poolApp?.end();
    await poolAcesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("texto, localização e contato compartilhado chegam na conversa do contato", async () => {
    expect((await chegou({ conversation: "Oi, quero um orçamento" })).statusCode).toBe(200);
    const conversa = await dono.query<{ id: string }>(
      "select id from conversas_com_contatos where canal_id = $1",
      [ids.canal],
    );
    ids.conversa = conversa.rows[0]?.id as string;
    await chegou({ locationMessage: { degreesLatitude: -23.55, degreesLongitude: -46.63, name: "Loja" } });
    await chegou({
      contactMessage: { displayName: "Carlos", vcard: "BEGIN:VCARD\nTEL:+5511912345678\nEND:VCARD" },
    });
    await chegou({ stickerMessage: {} });
    const m = await mensagens();
    expect(m.map((x) => [x.tipo, x.texto])).toEqual([
      ["texto", "Oi, quero um orçamento"],
      ["localizacao", expect.stringMatching(/^Localização: Loja/)],
      ["contato", "Contato compartilhado: Carlos, +5511912345678"],
      ["outro", null],
    ]);
  });

  it("a foto passa pelo antivírus; a infectada fica bloqueada e nunca vai para o depósito", async () => {
    falsa.arquivos.set(`C${n + 1}`, { base64: PNG, mime: "image/png" });
    await chegou({ imageMessage: { caption: "Olha a peça", mimetype: "image/png" } });
    falsa.arquivos.set(`C${n + 1}`, {
      base64: Buffer.from(EICAR).toString("base64"),
      mime: "application/pdf",
    });
    await chegou({ documentMessage: { fileName: "../virus.pdf", mimetype: "application/pdf" } });
    await chegou({ audioMessage: { mimetype: "audio/ogg" } });
    const m = (await mensagens()).slice(-3);
    expect(m[0]).toMatchObject({
      tipo: "foto",
      texto: "Olha a peça",
      arquivo: { situacao: "disponivel", tipo: "image/png" },
    });
    expect(m[1]).toMatchObject({ tipo: "documento", arquivo: { situacao: "bloqueado", nome: "virus.pdf" } });
    expect(m[2]).toMatchObject({ tipo: "audio", arquivo: { situacao: "nao_baixado" } });
    const link = await pedir(
      "GET",
      `/conversas-com-contatos/${ids.conversa}/arquivos/${m[0]?.arquivo?.id}`,
      "ana@teste.invalid",
    );
    expect(link.json()).toMatchObject({ url: expect.stringContaining("/api/deposito-local?t=") });
    const bloqueado = await pedir(
      "GET",
      `/conversas-com-contatos/${ids.conversa}/arquivos/${m[1]?.arquivo?.id}`,
      "ana@teste.invalid",
    );
    expect(bloqueado.statusCode).toBe(410);
  });

  it("grupo é ignorado, e o LID sem telefone vira um contato não identificado", async () => {
    const antes = (await dono.query("select count(*)::int as n from mensagens_com_contatos")).rows[0]?.n;
    await chegou({ conversation: "No grupo" }, { key: { remoteJid: "120363-1@g.us" } });
    expect((await dono.query("select count(*)::int as n from mensagens_com_contatos")).rows[0]?.n).toBe(
      antes,
    );
    await chegou(
      { conversation: "Escondido" },
      { key: { remoteJid: "987654321098@lid" }, pushName: "Sem Número" },
    );
    const k = await dono.query<{ nome: string; identificado: boolean; identificador: string }>(
      `select k.nome, k.identificado, cv.identificador from conversas_com_contatos cv
         join contatos k on k.id = cv.contato_id where cv.identificador like 'lid:%'`,
    );
    expect(k.rows[0]).toMatchObject({
      nome: "Sem Número",
      identificado: false,
      identificador: "lid:987654321098",
    });
  });

  it("manda texto pela fila: enviada, entregue e lida pelos avisos, com a auditoria sem o texto", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      texto: "Claro! Mando já.",
    });
    expect(r.statusCode, r.body).toBe(201);
    const { mensagemId } = r.json() as { mensagemId: string };
    expect(filaDeEnvio.at(-1)).toEqual({ empresaId: ids.empresa, mensagemId });
    expect(await enviarPendente(opcoes(), ids.empresa, mensagemId)).toBeNull();
    const enviada = falsa.enviadas.at(-1);
    expect(enviada).toMatchObject({ para: "5511988887777", texto: "Claro! Mando já." });
    await avisar(ids.empresa, ids.canal, "messages.update", { keyId: enviada?.id, status: "DELIVERY_ACK" });
    await avisar(ids.empresa, ids.canal, "messages.update", { keyId: enviada?.id, status: "READ" });
    // A entrega não volta para trás.
    await avisar(ids.empresa, ids.canal, "messages.update", { keyId: enviada?.id, status: "DELIVERY_ACK" });
    expect((await mensagens()).find((x) => x.id === mensagemId)).toMatchObject({
      direcao: "saiu",
      entrega: "lida",
    });
    const conversa = await dono.query(
      "select situacao, ultimo_a_responder from conversas_com_contatos where id = $1",
      [ids.conversa],
    );
    expect(conversa.rows[0]).toEqual({ situacao: "esperando_cliente", ultimo_a_responder: "pessoa" });
    const evento = await dono.query("select detalhes from auditoria.eventos where acao = 'conversa.enviou'");
    expect(JSON.stringify(evento.rows)).not.toContain("Mando já");
  });

  it("o que o número manda pelo celular entra marcado, e não repete o que a caixa acabou de mandar", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      texto: "Segue o PDF",
    });
    const { mensagemId } = r.json() as { mensagemId: string };
    // O aviso do próprio número chega antes da resposta da Evolution: junta-se à pendente.
    const doEnvio = await chegou(
      { conversation: "Segue o PDF" },
      { key: { fromMe: true, id: "DO-ENVIO-1" } },
    );
    expect(doEnvio.statusCode, doEnvio.body).toBe(200);
    await chegou({ conversation: "Respondi pelo celular" }, { key: { fromMe: true, id: "CEL-1" } });
    const m = await mensagens();
    expect(m.filter((x) => x.texto === "Segue o PDF")).toEqual([
      expect.objectContaining({ id: mensagemId, peloCelular: false, entrega: "enviada" }),
    ]);
    expect(m.find((x) => x.texto === "Respondi pelo celular")).toMatchObject({
      direcao: "saiu",
      peloCelular: true,
      autor: "pessoa",
    });
  });

  it("manda foto do arquivo conferido; recusa o infectado sem criar a mensagem", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      texto: "A foto",
      arquivo: { nome: "foto.png", tipo: "image/png", base64: PNG },
    });
    expect(r.statusCode, r.body).toBe(201);
    await new Promise((ok) => setTimeout(ok, 3100));
    expect(
      await enviarPendente(opcoes(), ids.empresa, (r.json() as { mensagemId: string }).mensagemId),
    ).toBeNull();
    expect(falsa.enviadas.at(-1)).toMatchObject({
      texto: "A foto",
      arquivo: { mime: "image/png", nomeDoArquivo: "foto.png" },
    });
    const virus = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/mensagens`,
      "ana@teste.invalid",
      {
        arquivo: { nome: "x.pdf", tipo: "application/pdf", base64: Buffer.from(EICAR).toString("base64") },
      },
    );
    expect(virus.statusCode).toBe(400);
    expect(virus.json().message).toMatch(/antivírus/);
  });

  it("falha na Evolution: tenta de novo e, depois de três vezes, mostra o motivo; tentar de novo manda", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      texto: "Vai falhar",
    });
    const { mensagemId } = r.json() as { mensagemId: string };
    falsa.foraDoAr = true;
    await new Promise((ok) => setTimeout(ok, 3100));
    expect(await enviarPendente(opcoes(), ids.empresa, mensagemId)).toBe(30);
    expect(await enviarPendente(opcoes(), ids.empresa, mensagemId)).toBe(60);
    expect(await enviarPendente(opcoes(), ids.empresa, mensagemId)).toBeNull();
    falsa.foraDoAr = false;
    expect((await mensagens()).find((x) => x.id === mensagemId)).toMatchObject({
      entrega: "falhou",
      motivoDaFalha: expect.stringMatching(/não aceitou/),
    });
    const de_novo = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/mensagens/${mensagemId}/tentar`,
      "ana@teste.invalid",
    );
    expect(de_novo.statusCode).toBe(200);
    expect(await enviarPendente(opcoes(), ids.empresa, mensagemId)).toBeNull();
    expect((await mensagens()).find((x) => x.id === mensagemId)).toMatchObject({
      entrega: "enviada",
      motivoDaFalha: null,
    });
  });

  it("o ritmo do número segura o que passa do limite e avisa o administrador uma vez", async () => {
    await dono.query("update canais_de_contato set limite_por_minuto = 1 where id = $1", [ids.canal]);
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      texto: "Segurada",
    });
    const { mensagemId } = r.json() as { mensagemId: string };
    const esperar = await enviarPendente(opcoes(), ids.empresa, mensagemId);
    expect(esperar).toBeGreaterThan(0);
    expect(esperar).toBeLessThanOrEqual(60);
    await enviarPendente(opcoes(), ids.empresa, mensagemId);
    const avisos = await dono.query(
      "select 1 from avisos where pessoa_id = $1 and tipo = 'canal_segurando_mensagens'",
      [ids.ana],
    );
    expect(avisos.rowCount).toBe(1);
    expect((await mensagens()).find((x) => x.id === mensagemId)).toMatchObject({ entrega: "pendente" });
    await dono.query("update canais_de_contato set limite_por_minuto = 20 where id = $1", [ids.canal]);
  });

  it("número desconectado: a mensagem falha com o motivo", async () => {
    await dono.query("update canais_de_contato set situacao = 'desconectado' where id = $1", [ids.canal]);
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      texto: "Sem número",
    });
    const { mensagemId } = r.json() as { mensagemId: string };
    expect(await enviarPendente(opcoes(), ids.empresa, mensagemId)).toBeNull();
    expect((await mensagens()).find((x) => x.id === mensagemId)).toMatchObject({
      entrega: "falhou",
      motivoDaFalha: "O número do canal não está conectado.",
    });
    await dono.query("update canais_de_contato set situacao = 'conectado' where id = $1", [ids.canal]);
  });

  it("uma empresa nunca manda, vê ou recebe na conversa da outra", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "olga@teste.invalid", {
      texto: "Invasão",
    });
    expect(r.statusCode).toBe(404);
    const foto = (await mensagens()).find((x) => x.tipo === "foto");
    const link = await pedir(
      "GET",
      `/conversas-com-contatos/${ids.conversa}/arquivos/${foto?.arquivo?.id}`,
      "olga@teste.invalid",
    );
    expect(link.statusCode).toBe(404);
    // O aviso de entrega com o canal da outra empresa não mexe nas mensagens da 4xpert.
    const enviada = falsa.enviadas.find((x) => x.instancia === nomeDaInstancia(ids.empresa, ids.canal));
    await avisar(ids.outra, ids.canalDaOutra, "messages.update", { keyId: enviada?.id, status: "ERROR" });
    expect(
      (await mensagens()).find((x) => x.entrega === "falhou" && x.texto !== "Sem número"),
    ).toBeUndefined();
    const daOutra = await dono.query(
      "select count(*)::int as n from mensagens_com_contatos where empresa_id = $1",
      [ids.outra],
    );
    expect(daOutra.rows[0]?.n).toBe(0);
  });

  it("o prazo apaga o arquivo do depósito e deixa o texto da mensagem", async () => {
    await dono.query(
      "update arquivos_de_conversa set apagar_em = now() - interval '1 day' where situacao = 'disponivel'",
    );
    expect(await cuidarDoPrazoDosArquivos(poolApp, arquivos, SILENCIO)).toBe(2);
    const foto = (await mensagens()).find((x) => x.texto === "Olha a peça");
    expect(foto).toMatchObject({ arquivo: { situacao: "apagado" } });
    expect(
      (await dono.query("select count(*)::int as n from arquivos_de_conversa where caminho is not null"))
        .rows[0]?.n,
    ).toBe(0);
  });
});
