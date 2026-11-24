/**
 * Agenda simples (M5-07, decisão 0041), de ponta a ponta, com o relógio, o modelo e o Telegram falsos: o coordenador
 * marca a reunião (com aprovação), o evento aparece na agenda dos dois e o alerta chega 10 minutos antes no app e no
 * Telegram, uma vez só; o convite pelo Telegram com os botões; quem vê o quê ("ocupado" para o funcionário, a equipe
 * para o gestor); a série com "só este", "este e os seguintes" e cancelar uma vez; "Não vou" sem alerta.
 */
import { randomBytes } from "node:crypto";
import type { AtualizacaoDoTelegram, EventoDaAgenda, OcorrenciaNaAgenda } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { alertasDaEmpresa, registrarRotasDaAgenda } from "@mago-os/nucleo/agenda";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import {
  type OpcoesDoMotor,
  registrarRotasDaConversa,
  registrarRotasDasAprovacoes,
  rodarExecucao,
} from "@mago-os/nucleo/agentes-internos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCofre,
  modelosFalsos,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import {
  avisarNoTelegram,
  type CarteiroFalsoDoTelegram,
  carteiroFalsoDoTelegram,
  type OpcoesDoTelegram,
  registrarRotasDoTelegram,
  tratarAtualizacao,
} from "@mago-os/nucleo/telegram";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-do-webhook-de-teste-com-32-ou-mais";
const CHAVE = "sk-ant-api03-chave-dos-agentes-Ag01";
const SILENCIO = { info() {}, warn() {}, error() {} };
const ANA = 9201;

describe.skipIf(!bancoDisponivel)("agenda simples", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let carteiro: CarteiroFalsoDoTelegram;
  let opcoesDoBot: OpcoesDoTelegram;
  let motor: OpcoesDoMotor;
  let empresaId: string;
  let ip = 0;
  let numero = 8000;
  const fila: { empresaId: string; execucaoId: string }[] = [];
  let roteiro: Parameters<typeof modelosFalsos>[0] = [];
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  async function criarPessoa(nome: string, email: string, perfil: string, area: string | null = null) {
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
      [empresaId, id, perfil, area],
    );
    return id;
  }

  async function como(email: string): Promise<string> {
    if (cookies[email]) return cookies[email];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.41.${ip}` },
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

  async function rodarFila() {
    while (fila.length > 0) {
      const t = fila.shift() as { empresaId: string; execucaoId: string };
      await rodarExecucao(motor, t.empresaId, t.execucaoId);
    }
  }

  const agendaDe = async (email: string, de: string, ate: string, pessoas?: string[]) =>
    (
      (
        await pedir(
          "GET",
          `/agenda?de=${de}&ate=${ate}${pessoas ? `&pessoas=${pessoas.join(",")}` : ""}`,
          await como(email),
        )
      ).json() as {
        ocorrencias: OcorrenciaNaAgenda[];
      }
    ).ocorrencias;

  const alertas = (agora: Date) => comEmpresa(poolApp, empresaId, (c) => alertasDaEmpresa(c, agora));
  const avisosDe = async (pessoaId: string | undefined, tipo: string) =>
    (
      await dono.query<{ texto: string; link: string }>(
        "select texto, link from avisos where pessoa_id = $1 and tipo = $2 order by criado_em",
        [pessoaId, tipo],
      )
    ).rows;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id");
    empresaId = e.rows[0]?.id as string;
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    ids.rita = await criarPessoa("Rita Vendas", "rita@teste.invalid", "funcionario", "comercial");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "operacoes");
    ids.gil = await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const carteiroDeEmail = { async enviarLinkDeSenha() {}, async enviarAparelhoNovo() {} };
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: carteiroDeEmail,
      },
      poolAcesso,
    );
    const acordar = (empresa: string, execucaoId: string) => fila.push({ empresaId: empresa, execucaoId });
    carteiro = carteiroFalsoDoTelegram();
    opcoesDoBot = {
      poolApp,
      carteiro,
      log: SILENCIO,
      conversa: { catalogo: catalogoDeModulos(), acordar, urlPublica: SITE },
    };
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDosAgentes(app, {
      verificador,
      poolApp,
      carteiro: carteiroDeEmail,
      urlPublica: SITE,
      acordar,
    } as Parameters<typeof registrarRotasDosAgentes>[1]);
    const cofre = criarCofre({ atual: { versao: 1, chave: randomBytes(32) }, anteriores: [] });
    registrarRotasDasContasDeIa(app, {
      verificador,
      poolApp,
      cofre,
      provedores: provedoresFalsos({ [CHAVE]: ["modelo-bom"] }),
      ambiente: "teste",
    });
    registrarRotasDoTelegram(app, {
      login,
      poolAcesso,
      poolApp,
      bot: { carteiro, segredo: SEGREDO, usuario: () => "OsMagoTesteBot" },
      receber: (a) => tratarAtualizacao(opcoesDoBot, a),
    });
    registrarRotasDaConversa(app, { verificador, poolApp, acordar });
    registrarRotasDaAgenda(app, verificador, poolApp);
    motor = {
      poolApp,
      cofre,
      modelos: {
        conversar: async (a, p) => {
          const passo = roteiro.shift();
          return modelosFalsos(passo ? [passo] : []).conversar(a, p);
        },
      },
      catalogo: catalogoDeModulos(),
      opcoesMcp: {
        poolApp,
        carteiro: carteiroDeEmail,
        urlPublica: SITE,
        log: app.log,
        origem: { canal: "sistema", ip: null, aparelho: null },
      },
      log: SILENCIO,
      acordar,
    } as OpcoesDoMotor;
    registrarRotasDasAprovacoes(app, {
      verificador,
      poolApp,
      catalogo: catalogoDeModulos(),
      opcoesMcp: motor.opcoesMcp,
      acordar,
    });
    await app.ready();

    const ana = await como("ana@teste.invalid");
    const agentes = (await pedir("GET", "/agentes", ana)).json() as { id: string; papel: string }[];
    ids.coordenador = agentes.find((a) => a.papel === "coordenador")?.id as string;
    const conta = await pedir("POST", "/ia/contas", ana, {
      nome: "Principal",
      provedor: "anthropic",
      chave: CHAVE,
    });
    ids.conta = conta.json().id;
    await pedir("POST", `/ia/contas/${ids.conta}/modelos`, ana, {
      modelos: [{ modelo: "modelo-bom", liberado: true }],
    });
    await pedir("POST", `/agentes/${ids.coordenador}/modelos`, ana, {
      modelos: { principal: { contaId: ids.conta, modelo: "modelo-bom" }, reserva: null },
    });
    expect((await pedir("POST", `/agentes/${ids.coordenador}/retomar`, ana, {})).statusCode).toBe(200);
    const codigo = (await pedir("POST", "/conta/telegram/codigo", ana)).json() as { codigo: string };
    numero += 1;
    await tratarAtualizacao(opcoesDoBot, {
      update_id: numero,
      message: {
        message_id: numero,
        date: Math.floor(Date.now() / 1000),
        chat: { id: ANA, type: "private" },
        from: { id: ANA, is_bot: false, first_name: "Ana" },
        text: codigo.codigo,
      },
    } as AtualizacaoDoTelegram);
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("o coordenador marca a reunião com aprovação; ela aparece na agenda dos dois e o alerta chega 10 minutos antes", async () => {
    const ana = await como("ana@teste.invalid");
    roteiro = [
      () => ({
        chamadas: [
          {
            id: "c1",
            nome: "criar_evento",
            entrada: {
              titulo: "Reunião com a Rita",
              inicio: { dia: "2030-01-10", hora: "15:00" },
              fim: { dia: "2030-01-10", hora: "16:00" },
              fuso: "America/Sao_Paulo",
              participantes: [ids.rita],
            },
          },
        ],
      }),
      () => ({
        chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Pedi a sua aprovação para marcar." } }],
      }),
    ];
    expect(
      (
        await pedir("POST", "/conversas/mensagens", ana, {
          texto: "marca uma reunião com a Rita quinta às 15h",
        })
      ).statusCode,
    ).toBe(201);
    await rodarFila();
    const pedido = await dono.query<{ id: string; conferencia: string; resumo: string }>(
      "select id, conferencia, resumo from aprovacoes where acao = 'criar_evento'",
    );
    expect(pedido.rows[0]?.resumo).toBe(
      "Marcar “Reunião com a Rita” em 2030-01-10 às 15:00, com 1 convidado(s)",
    );
    const decidiu = await pedir("POST", `/aprovacoes/${pedido.rows[0]?.id}/decidir`, ana, {
      decisao: "aprovar",
      conferencia: pedido.rows[0]?.conferencia,
    });
    expect(decidiu.statusCode).toBe(200);
    const evento = await dono.query<{ id: string; criado_por: string; criado_por_agente_id: string }>(
      "select id, criado_por, criado_por_agente_id from eventos where titulo = 'Reunião com a Rita'",
    );
    expect(evento.rows[0]).toMatchObject({ criado_por: ids.ana, criado_por_agente_id: ids.coordenador });
    ids.reuniao = evento.rows[0]?.id as string;
    expect((await avisosDe(ids.rita, "convite_de_evento")).map((a) => a.link)).toEqual([
      `/agenda/${ids.reuniao}`,
    ]);
    for (const email of ["ana@teste.invalid", "rita@teste.invalid"]) {
      const agenda = await agendaDe(email, "2030-01-07", "2030-01-13");
      expect(agenda.map((o) => [o.titulo, o.inicioEm])).toEqual([
        ["Reunião com a Rita", "2030-01-10T18:00:00.000Z"],
      ]);
    }
    // 15h em São Paulo = 18h UTC: o alerta sai às 17h50, uma vez só.
    expect(await alertas(new Date("2030-01-10T17:49:00Z"))).toBe(0);
    expect(await alertas(new Date("2030-01-10T17:50:00Z"))).toBe(2);
    expect(await alertas(new Date("2030-01-10T17:51:00Z"))).toBe(0);
    expect((await avisosDe(ids.ana, "alerta_de_evento")).map((a) => a.texto)).toEqual([
      "Em 10 minutos: Reunião com a Rita, às 15:00.",
    ]);
    carteiro.enviadas.length = 0;
    await avisarNoTelegram(opcoesDoBot, empresaId);
    expect(carteiro.enviadas.filter((m) => m.chatId === ANA).map((m) => m.texto)).toEqual([
      `Em 10 minutos: Reunião com a Rita, às 15:00.\n\n${SITE}/agenda/${ids.reuniao}`,
    ]);
  });

  it("o convite chega no Telegram com os botões, e o toque responde", async () => {
    const flora = await como("flora@teste.invalid");
    const r = await pedir("POST", "/agenda/eventos", flora, {
      titulo: "Café da equipe",
      inicio: { dia: "2030-02-01", hora: "10:00" },
      fim: { dia: "2030-02-01", hora: "10:30" },
      participantes: [ids.ana],
    });
    expect(r.statusCode).toBe(201);
    const evento = r.json() as EventoDaAgenda;
    carteiro.enviadas.length = 0;
    await avisarNoTelegram(opcoesDoBot, empresaId);
    const convite = carteiro.enviadas.find((m) => m.chatId === ANA);
    expect(convite?.texto.startsWith("Convite: Café da equipe")).toBe(true);
    expect(convite?.opcoes?.botoes?.[0]?.map((b) => b.texto)).toEqual(["Vou", "Não vou", "Talvez"]);
    numero += 1;
    await tratarAtualizacao(opcoesDoBot, {
      update_id: numero,
      callback_query: {
        id: "b1",
        from: { id: ANA, is_bot: false, first_name: "Ana" },
        message: { message_id: 1, date: 0, chat: { id: ANA, type: "private" } },
        data: `ev:talvez:${evento.id}`,
      },
    } as AtualizacaoDoTelegram);
    const resposta = await dono.query(
      "select resposta from participantes_de_evento where evento_id = $1 and pessoa_id = $2",
      [evento.id, ids.ana],
    );
    expect(resposta.rows[0]?.resposta).toBe("talvez");
    expect(carteiro.botoesRespondidos.at(-1)?.texto).toBe("Resposta registrada: Talvez.");
  });

  it("quem vê o quê: o funcionário vê só ocupado; o gestor vê os da equipe; o administrador, tudo", async () => {
    const naAgendaDaRita = (email: string) =>
      agendaDe(email, "2030-01-07", "2030-01-13", [ids.rita as string]);
    expect((await naAgendaDaRita("flora@teste.invalid")).map((o) => [o.ocupado, o.titulo])).toEqual([
      [true, null],
    ]);
    expect(
      (await pedir("GET", `/agenda/eventos/${ids.reuniao}`, await como("flora@teste.invalid"))).statusCode,
    ).toBe(404);
    // A Rita é da área comercial, a mesma do Gil.
    expect((await naAgendaDaRita("gil@teste.invalid")).map((o) => o.titulo)).toEqual(["Reunião com a Rita"]);
    expect(
      (await pedir("GET", `/agenda/eventos/${ids.reuniao}`, await como("gil@teste.invalid"))).statusCode,
    ).toBe(200);
    // Só quem criou (ou o administrador) muda.
    const rita = await como("rita@teste.invalid");
    expect(
      (await pedir("POST", `/agenda/eventos/${ids.reuniao}`, rita, { titulo: "Outra" })).statusCode,
    ).toBe(403);
  });

  it("série: só esta vez, esta e as seguintes, cancelar uma vez; quem disse Não vou fica sem alerta", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/agenda/eventos", ana, {
      titulo: "Daily",
      inicio: { dia: "2030-01-07", hora: "09:00" },
      fim: { dia: "2030-01-07", hora: "09:15" },
      fuso: "America/Sao_Paulo",
      participantes: [ids.rita],
      regra: { frequencia: "semanal", intervalo: 1, diasDaSemana: [1] },
    });
    const daily = r.json() as EventoDaAgenda;
    const titulosEHoras = async () =>
      (await agendaDe("ana@teste.invalid", "2030-01-07", "2030-02-10"))
        .filter((o) => o.titulo?.startsWith("Daily"))
        .map((o) => `${o.ocorrencia} ${o.inicioEm.slice(11, 16)} ${o.titulo}`);
    expect(await titulosEHoras()).toEqual([
      "2030-01-07 12:00 Daily",
      "2030-01-14 12:00 Daily",
      "2030-01-21 12:00 Daily",
      "2030-01-28 12:00 Daily",
      "2030-02-04 12:00 Daily",
    ]);
    // Só esta vez: o título muda só no dia 14.
    expect(
      (
        await pedir("POST", `/agenda/eventos/${daily.id}`, ana, {
          titulo: "Daily com o cliente",
          alcance: "so_este",
          ocorrencia: "2030-01-14",
        })
      ).statusCode,
    ).toBe(200);
    // Esta e as seguintes: a partir do dia 28, às 10h.
    expect(
      (
        await pedir("POST", `/agenda/eventos/${daily.id}`, ana, {
          inicio: { dia: "2030-01-28", hora: "10:00" },
          fim: { dia: "2030-01-28", hora: "10:15" },
          alcance: "este_e_seguintes",
          ocorrencia: "2030-01-28",
        })
      ).statusCode,
    ).toBe(200);
    // Cancelar só o dia 21.
    expect(
      (
        await pedir("POST", `/agenda/eventos/${daily.id}/cancelar`, ana, {
          alcance: "so_este",
          ocorrencia: "2030-01-21",
        })
      ).statusCode,
    ).toBe(200);
    expect(await titulosEHoras()).toEqual([
      "2030-01-07 12:00 Daily",
      "2030-01-14 12:00 Daily com o cliente",
      "2030-01-28 13:00 Daily",
      "2030-02-04 13:00 Daily",
    ]);
    // A mudança de horário pede resposta de novo: a Rita recebeu o convite novo.
    expect(
      (await avisosDe(ids.rita, "convite_de_evento")).some((a) => a.texto.startsWith("Daily mudou para")),
    ).toBe(true);
    // A Rita não vai na série nova: sem alerta para ela; a Ana recebe.
    const novaSerie = await dono.query<{ id: string }>(
      "select id from eventos where titulo = 'Daily' and inicio_dia = '2030-01-28'",
    );
    const rita = await como("rita@teste.invalid");
    expect(
      (
        await pedir("POST", `/agenda/eventos/${novaSerie.rows[0]?.id}/resposta`, rita, {
          resposta: "nao_vou",
        })
      ).statusCode,
    ).toBe(200);
    const antes = (await avisosDe(ids.rita, "alerta_de_evento")).length;
    expect(await alertas(new Date("2030-02-04T12:50:00Z"))).toBe(1);
    expect((await avisosDe(ids.rita, "alerta_de_evento")).length).toBe(antes);
    // O dia 21, cancelado, não alerta.
    expect(await alertas(new Date("2030-01-21T11:50:00Z"))).toBe(0);
  });

  it("o alerta na hora (0 minutos) sai; esta e as seguintes na primeira vez muda a série inteira", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/agenda/eventos", ana, {
      titulo: "Ligação",
      inicio: { dia: "2030-03-04", hora: "09:00" },
      fim: { dia: "2030-03-04", hora: "09:30" },
      fuso: "UTC",
      participantes: [],
      regra: { frequencia: "semanal", intervalo: 1, vezes: 3 },
      alertas: [0],
    });
    const ligacao = r.json() as EventoDaAgenda;
    expect(await alertas(new Date("2030-03-04T08:59:00Z"))).toBe(0);
    expect(await alertas(new Date("2030-03-04T09:00:30Z"))).toBe(1);
    expect(
      (
        await pedir("POST", `/agenda/eventos/${ligacao.id}`, ana, {
          inicio: { dia: "2030-03-04", hora: "10:00" },
          fim: { dia: "2030-03-04", hora: "10:30" },
          alcance: "este_e_seguintes",
          ocorrencia: "2030-03-04",
        })
      ).statusCode,
    ).toBe(200);
    const vezes = (await agendaDe("ana@teste.invalid", "2030-03-01", "2030-03-31"))
      .filter((o) => o.titulo === "Ligação")
      .map((o) => o.inicioEm.slice(0, 16));
    expect(vezes).toEqual(["2030-03-04T10:00", "2030-03-11T10:00", "2030-03-18T10:00"]);
  });
});
