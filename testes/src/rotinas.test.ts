/**
 * Rotinas por horário (M5-05, decisão 0039), de ponta a ponta, com o relógio e o modelo falsos: a rotina nasce
 * desligada; "Rodar agora" pede ao Gerente de projetos e a resposta chega numa conversa da rotina, no app e no
 * Telegram; ligada, roda no horário certo e, depois de o servidor ficar fora, só uma vez; criar tarefa com prazo
 * relativo; quem pode o quê (só o dono faz agir, o administrador desliga e apaga); o aviso só para quem o dono vê; o
 * limite do dia; a falha que não tenta de novo vai para a central do dono; o dono que sai desliga as rotinas.
 */
import { randomBytes } from "node:crypto";
import type { AtualizacaoDoTelegram, Rotina } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import {
  type OpcoesDoMotor,
  registrarRotasDaConversa,
  rodarExecucao,
} from "@mago-os/nucleo/agentes-internos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCofre,
  modelosFalsos,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import { comPessoa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import {
  cuidarDaEmpresa,
  cuidarDaExecucao,
  cuidarDasRotinas,
  type OpcoesDoMotorDasRotinas,
  registrarRotasDasRotinas,
} from "@mago-os/nucleo/rotinas";
import { listarPrioridades } from "@mago-os/nucleo/tarefas/prioridades";
import {
  type CarteiroFalsoDoTelegram,
  carteiroFalsoDoTelegram,
  entregarNoTelegram,
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
const CHAVE = "sk-ant-api03-chave-dos-agentes-Rt01";
const SILENCIO = { info() {}, warn() {}, error() {} };
const ANA = 9101;

const segundaAs8 = {
  tipo: "horario" as const,
  regra: { frequencia: "semanal" as const, intervalo: 1, diasDaSemana: [1] },
  horas: ["08:00"],
  fuso: "America/Sao_Paulo",
  inicio: "2030-01-01",
};

describe.skipIf(!bancoDisponivel)("rotinas por horário", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let carteiro: CarteiroFalsoDoTelegram;
  let opcoesDoBot: OpcoesDoTelegram;
  let motor: OpcoesDoMotor;
  let rotinas: OpcoesDoMotorDasRotinas;
  let empresaId: string;
  let ip = 0;
  let numero = 7000;
  const fila: { empresaId: string; execucaoId: string }[] = [];
  const rodarAgora: string[] = [];
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.31.${ip}` },
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

  /** Roda o "Rodar agora" pedido pela rota, a fila dos agentes e a conferência da rotina. */
  async function rodarTudo(agora = new Date()) {
    while (rodarAgora.length > 0)
      await cuidarDaExecucao(rotinas, empresaId, rodarAgora.shift() as string, agora);
    // A verificação da empresa pode pôr um agente na fila; roda e confere de novo.
    for (let i = 0; i < 3; i++) {
      while (fila.length > 0) {
        const t = fila.shift() as { empresaId: string; execucaoId: string };
        await rodarExecucao(motor, t.empresaId, t.execucaoId);
      }
      await cuidarDaEmpresa(rotinas, empresaId, agora);
    }
  }

  const execucoes = async (rotinaId: string | undefined) =>
    (
      await dono.query<{ situacao: string; origem: string; motivo: string | null; tarefa_id: string | null }>(
        "select situacao, origem, motivo, tarefa_id from execucoes_de_rotina where rotina_id = $1 order by criada_em",
        [rotinaId],
      )
    ).rows;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id");
    empresaId = e.rows[0]?.id as string;
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario");
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
    rotinas = {
      poolApp,
      catalogo: catalogoDeModulos(),
      log: SILENCIO,
      acordar,
    };
    registrarRotasDaConversa(app, { verificador, poolApp, acordar });
    registrarRotasDosProjetos(app, verificador, poolApp);
    registrarRotasDasRotinas(app, { verificador, poolApp, rodarAgora: (_e, id) => rodarAgora.push(id) });
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
    await app.ready();

    // Liga o coordenador e o Gerente de projetos com o modelo falso, e vincula o Telegram da Ana.
    const ana = await como("ana@teste.invalid");
    const agentes = (await pedir("GET", "/agentes", ana)).json() as { id: string; papel: string }[];
    ids.coordenador = agentes.find((a) => a.papel === "coordenador")?.id as string;
    ids.gerente = agentes.find((a) => a.papel === "especialista")?.id as string;
    const conta = await pedir("POST", "/ia/contas", ana, {
      nome: "Principal",
      provedor: "anthropic",
      chave: CHAVE,
    });
    ids.conta = conta.json().id;
    await pedir("POST", `/ia/contas/${ids.conta}/modelos`, ana, {
      modelos: [{ modelo: "modelo-bom", liberado: true }],
    });
    for (const agente of [ids.coordenador, ids.gerente]) {
      await pedir("POST", `/agentes/${agente}/modelos`, ana, {
        modelos: { principal: { contaId: ids.conta, modelo: "modelo-bom" }, reserva: null },
      });
      expect((await pedir("POST", `/agentes/${agente}/retomar`, ana, {})).statusCode).toBe(200);
    }
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

  it("nasce desligada; Rodar agora pede ao Gerente e a resposta chega na conversa da rotina e no Telegram", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/rotinas", ana, {
      nome: "Resumo das atrasadas",
      gatilho: segundaAs8,
      acao: {
        tipo: "pedir_ao_agente",
        agenteId: ids.gerente,
        pedido: "Resuma as tarefas atrasadas e me mande.",
        resultado: "mensagem",
      },
    });
    expect(r.statusCode).toBe(201);
    const rotina = r.json() as Rotina;
    ids.resumo = rotina.id;
    expect(rotina).toMatchObject({ situacao: "desligada", desligadaPorque: "pessoa", proximaEm: null });

    carteiro.enviadas.length = 0;
    roteiro = [
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Nenhuma tarefa atrasada." } }] }),
    ];
    expect((await pedir("POST", `/rotinas/${rotina.id}/rodar`, ana, {})).statusCode).toBe(202);
    await rodarTudo();
    const [execucao] = await execucoes(rotina.id);
    expect(execucao).toMatchObject({ situacao: "feita", origem: "rodar_agora" });
    const conversa = await dono.query<{ canal: string; titulo: string; pessoa_id: string }>(
      "select c.canal, c.titulo, c.pessoa_id from conversas c join execucoes_de_rotina e on e.conversa_id = c.id where e.rotina_id = $1",
      [rotina.id],
    );
    expect(conversa.rows[0]).toEqual({
      canal: "rotina",
      titulo: "Rotina: Resumo das atrasadas",
      pessoa_id: ids.ana,
    });
    // O pedido conta como mensagem da própria Ana (não é texto de outros).
    const marca = await dono.query<{ leu: boolean }>(
      "select x.leu_texto_de_outros as leu from execucoes_de_agente x join execucoes_de_rotina e on e.execucao_de_agente_id = x.id where e.rotina_id = $1",
      [rotina.id],
    );
    expect(marca.rows[0]?.leu).toBe(false);
    await entregarNoTelegram(opcoesDoBot, empresaId);
    expect(carteiro.enviadas.filter((m) => m.chatId === ANA).map((m) => m.texto)).toEqual([
      "Rotina: Resumo das atrasadas\n\nNenhuma tarefa atrasada.",
    ]);
    const auditoria = await dono.query(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by id",
      [rotina.id],
    );
    expect(auditoria.rows.map((x) => x.acao).sort()).toEqual(["rotina.criou", "rotina.rodou_agora"]);
  });

  it("ligada, roda no horário do fuso e, depois de o servidor ficar fora, só uma vez", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", `/rotinas/${ids.resumo}/ligar`, ana, {});
    expect(r.statusCode).toBe(200);
    const ligada = r.json() as Rotina;
    // A próxima segunda às 8h em São Paulo (UTC-3) é às 11h UTC.
    expect(ligada.situacao).toBe("ligada");
    expect(new Date(ligada.proximaEm as string).getUTCDay()).toBe(1);
    expect(new Date(ligada.proximaEm as string).getUTCHours()).toBe(11);

    // O servidor ficou fora três semanas: roda uma vez só, a última segunda perdida, e marca a próxima.
    await dono.query("update rotinas set proxima_em = '2030-01-07T11:00:00Z' where id = $1", [ids.resumo]);
    roteiro = [
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Resumo da semana." } }] }),
    ];
    const agora = new Date("2030-01-28T15:00:00Z");
    await cuidarDasRotinas(rotinas, agora);
    await rodarTudo(agora);
    const lista = await execucoes(ids.resumo);
    expect(lista.filter((x) => x.origem === "horario")).toEqual([
      { situacao: "feita", origem: "horario", motivo: null, tarefa_id: null },
    ]);
    const prevista = await dono.query<{ prevista_para: Date }>(
      "select prevista_para from execucoes_de_rotina where rotina_id = $1 and origem = 'horario'",
      [ids.resumo],
    );
    expect(prevista.rows[0]?.prevista_para.toISOString()).toBe("2030-01-28T11:00:00.000Z");
    const depois = await dono.query<{ proxima_em: Date; vezes: number }>(
      "select proxima_em, vezes from rotinas where id = $1",
      [ids.resumo],
    );
    expect(depois.rows[0]?.proxima_em.toISOString()).toBe("2030-02-04T11:00:00.000Z");
    expect(depois.rows[0]?.vezes).toBe(1);
    // Antes da hora, nada roda.
    await cuidarDasRotinas(rotinas, new Date("2030-02-04T10:59:00Z"));
    expect((await execucoes(ids.resumo)).length).toBe(lista.length);
  });

  it("os agentes: criar rotina pede aprovação; desligar executa e fica marcado como do agente", async () => {
    const ana = await como("ana@teste.invalid");
    roteiro = [
      () => ({
        chamadas: [
          {
            id: "c1",
            nome: "criar_rotina",
            entrada: {
              nome: "Lembrete da reunião",
              gatilho: segundaAs8,
              acao: { tipo: "mandar_aviso", para: [ids.ana], texto: "Reunião às 10h." },
            },
          },
          { id: "c2", nome: "parar_rotina", entrada: { rotinaId: ids.resumo } },
        ],
      }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Feito." } }] }),
    ];
    const r = await pedir("POST", "/conversas/mensagens", ana, {
      texto: "Crie um lembrete toda segunda às 8h e desligue o resumo das atrasadas.",
    });
    expect(r.statusCode).toBeLessThan(300);
    await rodarTudo();
    const pedido = await dono.query<{ situacao: string; resumo: string }>(
      "select situacao, resumo from aprovacoes where acao = 'criar_rotina'",
    );
    expect(pedido.rows).toEqual([
      {
        situacao: "pendente",
        resumo: "Criar a rotina “Lembrete da reunião” (às 08:00), que nasce desligada",
      },
    ]);
    expect((await dono.query("select 1 from rotinas where nome = 'Lembrete da reunião'")).rowCount).toBe(0);
    const resumo = await dono.query("select situacao, desligada_porque from rotinas where id = $1", [
      ids.resumo,
    ]);
    expect(resumo.rows[0]).toEqual({ situacao: "desligada", desligada_porque: "agente" });
  });

  it("a última vez de uma série com fim ainda roda, e aí a rotina se desliga sozinha", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/rotinas", ana, {
      nome: "Uma vez só",
      gatilho: { ...segundaAs8, regra: { frequencia: "diaria", intervalo: 1, vezes: 1 } },
      acao: { tipo: "mandar_aviso", para: [ids.ana], texto: "Lembrete único." },
    });
    const rotina = r.json() as Rotina;
    expect((await pedir("POST", `/rotinas/${rotina.id}/ligar`, ana, {})).statusCode).toBe(200);
    await dono.query("update rotinas set proxima_em = '2030-01-02T11:00:00Z' where id = $1", [rotina.id]);
    await rodarTudo(new Date("2030-01-02T11:00:30Z"));
    expect(await execucoes(rotina.id)).toEqual([
      { situacao: "feita", origem: "horario", motivo: null, tarefa_id: null },
    ]);
    const depois = await dono.query("select situacao, desligada_porque, vezes from rotinas where id = $1", [
      rotina.id,
    ]);
    expect(depois.rows[0]).toEqual({ situacao: "desligada", desligada_porque: "terminou", vezes: 1 });
  });

  it("criar tarefa com prazo relativo, como o dono criaria", async () => {
    const flora = await como("flora@teste.invalid");
    const r = await pedir("POST", "/rotinas", flora, {
      nome: "Relatório da sexta",
      gatilho: { ...segundaAs8, regra: { frequencia: "semanal", intervalo: 1, diasDaSemana: [5] } },
      acao: {
        tipo: "criar_tarefa",
        titulo: "Enviar o relatório",
        prioridade: "alta",
        prazo: { emDias: 2, hora: "18:00" },
      },
    });
    expect(r.statusCode).toBe(201);
    ids.relatorio = (r.json() as Rotina).id;
    expect((await pedir("POST", `/rotinas/${ids.relatorio}/rodar`, flora, {})).statusCode).toBe(202);
    await rodarTudo(new Date("2030-01-04T12:00:00Z"));
    const [e] = await execucoes(ids.relatorio);
    expect(e?.situacao).toBe("feita");
    const t = await dono.query(
      "select titulo, responsavel_pessoa_id, criada_por_pessoa_id, prioridade, prazo_dia::text, prazo_hora::text from tarefas where id = $1",
      [e?.tarefa_id],
    );
    expect(t.rows[0]).toEqual({
      titulo: "Enviar o relatório",
      responsavel_pessoa_id: ids.flora,
      criada_por_pessoa_id: ids.flora,
      prioridade: "alta",
      prazo_dia: "2030-01-06",
      prazo_hora: "18:00:00",
    });
  });

  it("quem pode o quê: só o dono faz agir; o administrador vê, desliga e apaga; o aviso só para quem o dono vê", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    // A funcionária não pede direto ao especialista nem avisa outra pessoa.
    const especialista = await pedir("POST", "/rotinas", flora, {
      nome: "Direto ao Gerente",
      gatilho: segundaAs8,
      acao: { tipo: "pedir_ao_agente", agenteId: ids.gerente, pedido: "Oi", resultado: "mensagem" },
    });
    expect(especialista.statusCode).toBe(400);
    const avisoParaAna = await pedir("POST", "/rotinas", flora, {
      nome: "Aviso",
      gatilho: segundaAs8,
      acao: { tipo: "mandar_aviso", para: [ids.ana], texto: "Oi" },
    });
    expect(avisoParaAna.statusCode).toBe(400);
    const avisoParaSi = await pedir("POST", "/rotinas", flora, {
      nome: "Lembrete",
      gatilho: segundaAs8,
      acao: { tipo: "mandar_aviso", para: [ids.flora], texto: "Hoje tem reunião às 10h." },
    });
    expect(avisoParaSi.statusCode).toBe(201);
    ids.lembrete = (avisoParaSi.json() as Rotina).id;
    expect((await pedir("POST", `/rotinas/${ids.lembrete}/rodar`, flora, {})).statusCode).toBe(202);
    await rodarTudo();
    const aviso = await dono.query(
      "select tipo, texto, telegram_pendente from avisos where pessoa_id = $1 and tipo = 'aviso_de_rotina'",
      [ids.flora],
    );
    expect(aviso.rows[0]).toEqual({
      tipo: "aviso_de_rotina",
      texto: 'Hoje tem reunião às 10h. (rotina "Lembrete", de Flora Func)',
      telegram_pendente: true,
    });

    // A Flora não vê a rotina da Ana; a Ana vê a da Flora, mas não edita, não liga nem roda.
    expect((await pedir("GET", `/rotinas/${ids.resumo}`, flora)).statusCode).toBe(404);
    expect(
      (await pedir("GET", "/rotinas", flora))
        .json()
        .rotinas.map((x: Rotina) => x.id)
        .sort(),
    ).toEqual([ids.relatorio, ids.lembrete].sort());
    expect((await pedir("GET", `/rotinas/${ids.lembrete}`, ana)).json()).toMatchObject({
      souDono: false,
      podeMudar: false,
      podeDesligar: true,
      podeApagar: true,
    });
    expect((await pedir("POST", `/rotinas/${ids.lembrete}`, ana, { nome: "Outro" })).statusCode).toBe(403);
    expect((await pedir("POST", `/rotinas/${ids.lembrete}/ligar`, ana, {})).statusCode).toBe(403);
    expect((await pedir("POST", `/rotinas/${ids.lembrete}/rodar`, ana, {})).statusCode).toBe(403);
    expect((await pedir("POST", `/rotinas/${ids.lembrete}/ligar`, flora, {})).statusCode).toBe(200);
    const desligou = await pedir("POST", `/rotinas/${ids.lembrete}/desligar`, ana, {});
    expect(desligou.json()).toMatchObject({ situacao: "desligada", desligadaPorque: "pessoa" });
    // O gestor de área sem a Flora na equipe não vê; ninguém fora da empresa vê.
    expect((await pedir("GET", `/rotinas/${ids.lembrete}`, await como("gil@teste.invalid"))).statusCode).toBe(
      404,
    );
  });

  it("limite do dia: passou de 24, a execução fica pulada", async () => {
    const flora = await como("flora@teste.invalid");
    for (let i = 0; i < 24; i++)
      await dono.query(
        `insert into execucoes_de_rotina (empresa_id, rotina_id, origem, situacao, iniciada_em, terminada_em)
         values ($1, $2, 'rodar_agora', 'feita', now(), now())`,
        [empresaId, ids.lembrete],
      );
    expect((await pedir("POST", `/rotinas/${ids.lembrete}/rodar`, flora, {})).statusCode).toBe(202);
    await rodarTudo();
    const ultima = (await execucoes(ids.lembrete)).at(-1);
    expect(ultima).toMatchObject({ situacao: "pulada", motivo: "Passou do limite de 24 vezes por dia." });
  });

  it("por evento: concluir uma tarefa do Blog cria a revisão para a Rita, e o que a rotina fez não dispara outra", async () => {
    const ana = await como("ana@teste.invalid");
    ids.rita = await criarPessoa("Rita Revisora", "rita@teste.invalid", "funcionario");
    const espaco = await pedir("POST", "/espacos", ana, { nome: "Marketing" });
    const blog = await pedir("POST", "/projetos", ana, { espacoId: espaco.json().id, nome: "Blog" });
    expect(blog.statusCode).toBe(201);
    ids.blog = blog.json().id as string;
    const revisao = await pedir("POST", "/rotinas", ana, {
      nome: "Revisão do Blog",
      gatilho: { tipo: "evento", evento: "tarefa_concluida", filtros: { projetoId: ids.blog } },
      acao: {
        tipo: "criar_tarefa",
        titulo: "Revisar: {tarefa}",
        responsavel: { tipo: "pessoa", pessoaId: ids.rita },
        comoSubtarefa: true,
      },
    });
    expect(revisao.statusCode).toBe(201);
    ids.revisao = (revisao.json() as Rotina).id;
    const qualquer = await pedir("POST", "/rotinas", ana, {
      nome: "Toda tarefa nova",
      gatilho: { tipo: "evento", evento: "tarefa_criada", filtros: {} },
      acao: { tipo: "mandar_aviso", para: [ids.ana], texto: "Nova tarefa: {tarefa}" },
    });
    ids.qualquer = (qualquer.json() as Rotina).id;
    for (const id of [ids.revisao, ids.qualquer]) {
      const r = await pedir("POST", `/rotinas/${id}/ligar`, ana, {});
      expect(r.json()).toMatchObject({ situacao: "ligada", proximaEm: null });
    }
    // Duas tarefas da Ana: uma do Blog, outra fora dele. As duas são concluídas.
    const criar = async (titulo: string, projeto: string | null) =>
      (
        await dono.query<{ id: string }>(
          `insert into tarefas (empresa_id, titulo, responsavel_pessoa_id, criada_por_pessoa_id, projeto_id)
           values ($1, $2, $3, $3, $4) returning id`,
          [empresaId, titulo, ids.ana, projeto],
        )
      ).rows[0]?.id as string;
    ids.post = await criar("Post de lançamento", ids.blog);
    ids.fora = await criar("Pagar a gráfica", null);
    await dono.query(
      "update tarefas set status = 'concluida', encerrada_em = now() where id = any($1::uuid[])",
      [[ids.post, ids.fora]],
    );
    await rodarTudo();
    const daRevisao = await dono.query<{
      situacao: string;
      evento: string;
      tarefa_do_evento_id: string;
      tarefa_id: string;
    }>(
      "select situacao, evento, tarefa_do_evento_id, tarefa_id from execucoes_de_rotina where rotina_id = $1",
      [ids.revisao],
    );
    expect(daRevisao.rows).toHaveLength(1);
    expect(daRevisao.rows[0]).toMatchObject({
      situacao: "feita",
      evento: "tarefa_concluida",
      tarefa_do_evento_id: ids.post,
    });
    const nova = await dono.query(
      "select titulo, responsavel_pessoa_id, tarefa_mae_id, projeto_id from tarefas where id = $1",
      [daRevisao.rows[0]?.tarefa_id],
    );
    expect(nova.rows[0]).toEqual({
      titulo: "Revisar: Post de lançamento",
      responsavel_pessoa_id: ids.rita,
      // A mãe já estava concluída: a tarefa nasce solta, no projeto dela (mãe fechada não ganha subtarefa).
      tarefa_mae_id: null,
      projeto_id: ids.blog,
    });
    // "Toda tarefa nova" rodou para as duas tarefas da Ana, mas não para a revisão, que a rotina criou.
    const daQualquer = await dono.query<{ tarefa_do_evento_id: string }>(
      "select tarefa_do_evento_id from execucoes_de_rotina where rotina_id = $1 and situacao = 'feita'",
      [ids.qualquer],
    );
    expect(daQualquer.rows.map((x) => x.tarefa_do_evento_id).sort()).toEqual([ids.post, ids.fora].sort());
    const aviso = await dono.query(
      "select texto, link from avisos where tipo = 'aviso_de_rotina' and link = $1",
      [`/tarefas/${ids.post}`],
    );
    expect(aviso.rows[0]?.texto).toBe(
      'Nova tarefa: Post de lançamento (rotina "Toda tarefa nova", de Ana Admin)',
    );
  });

  it("por evento: só o que o dono vê; Rodar agora testa com a tarefa mais recente que passa nos filtros", async () => {
    const rita = await como("rita@teste.invalid");
    const r = await pedir("POST", "/rotinas", rita, {
      nome: "Minhas tarefas novas",
      gatilho: { tipo: "evento", evento: "tarefa_criada", filtros: {} },
      acao: { tipo: "mandar_aviso", para: [ids.rita], texto: "Chegou: {tarefa}" },
    });
    const rotina = r.json() as Rotina;
    expect((await pedir("POST", `/rotinas/${rotina.id}/ligar`, rita, {})).statusCode).toBe(200);
    // Uma tarefa da Ana que a Rita não vê não dispara nada; uma passada para a Rita dispara.
    await dono.query(
      "insert into tarefas (empresa_id, titulo, responsavel_pessoa_id, criada_por_pessoa_id) values ($1, 'Só da Ana', $2, $2)",
      [empresaId, ids.ana],
    );
    await dono.query(
      "insert into tarefas (empresa_id, titulo, responsavel_pessoa_id, criada_por_pessoa_id) values ($1, 'Para a Rita', $2, $3)",
      [empresaId, ids.rita, ids.ana],
    );
    await rodarTudo();
    const titulos = await dono.query<{ titulo: string }>(
      `select t.titulo from execucoes_de_rotina e join tarefas t on t.id = e.tarefa_do_evento_id where e.rotina_id = $1`,
      [rotina.id],
    );
    expect(titulos.rows.map((x) => x.titulo)).toEqual(["Para a Rita"]);
    // Rodar agora: a mais recente que a Rita vê e que passa nos filtros.
    expect((await pedir("POST", `/rotinas/${rotina.id}/rodar`, rita, {})).statusCode).toBe(202);
    await rodarTudo();
    const ultima = await dono.query<{ origem: string; situacao: string; titulo: string }>(
      `select e.origem, e.situacao, t.titulo from execucoes_de_rotina e join tarefas t on t.id = e.tarefa_do_evento_id
        where e.rotina_id = $1 order by e.criada_em desc limit 1`,
      [rotina.id],
    );
    expect(ultima.rows[0]).toEqual({ origem: "rodar_agora", situacao: "feita", titulo: "Para a Rita" });
  });

  it("por evento: a tarefa atrasada dispara uma vez por prazo", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/rotinas", ana, {
      nome: "Atrasou",
      gatilho: { tipo: "evento", evento: "tarefa_atrasada", filtros: {} },
      acao: { tipo: "mandar_aviso", para: [ids.ana], texto: "Atrasou: {tarefa}" },
    });
    const rotina = r.json() as Rotina;
    await pedir("POST", `/rotinas/${rotina.id}/ligar`, ana, {});
    await dono.query(
      `insert into tarefas (empresa_id, titulo, responsavel_pessoa_id, criada_por_pessoa_id, prazo_dia, prazo_hora, prazo_fuso)
       values ($1, 'Entregar o balanço', $2, $2, '2031-03-10', '09:00', 'UTC')`,
      [empresaId, ids.ana],
    );
    await rodarTudo(new Date("2031-03-10T08:59:00Z"));
    expect(await execucoes(rotina.id)).toEqual([]);
    await rodarTudo(new Date("2031-03-10T09:01:00Z"));
    await rodarTudo(new Date("2031-03-10T09:05:00Z"));
    expect(await execucoes(rotina.id)).toEqual([
      { situacao: "feita", origem: "evento", motivo: null, tarefa_id: null },
    ]);
    await pedir("POST", `/rotinas/${rotina.id}/desligar`, ana, {});
  });

  it("falha sem volta: vai direto para a central do dono e para a auditoria", async () => {
    const ana = await como("ana@teste.invalid");
    const r = await pedir("POST", "/rotinas", ana, {
      nome: "Tarefa para o Gil",
      gatilho: segundaAs8,
      acao: {
        tipo: "criar_tarefa",
        titulo: "Conferir o caixa",
        responsavel: { tipo: "pessoa", pessoaId: ids.gil },
      },
    });
    const rotina = r.json() as Rotina;
    // O Gil sai da empresa: a rotina não tem mais para quem criar a tarefa.
    await dono.query(
      "update vinculos set situacao = 'desligado', desligado_em = now() where pessoa_id = $1",
      [ids.gil],
    );
    expect((await pedir("POST", `/rotinas/${rotina.id}/rodar`, ana, {})).statusCode).toBe(202);
    await rodarTudo();
    expect((await execucoes(rotina.id)).at(-1)).toMatchObject({
      situacao: "falhou",
      motivo: "A pessoa responsável não está ativa nesta empresa.",
    });
    const prioridades = await comPessoa(poolApp, ids.ana as string, empresaId, (c) =>
      listarPrioridades(c, {
        tipo: "pessoa",
        pessoaId: ids.ana as string,
        filtro: { tipo: "tudo" },
        projetos: "todos",
      }),
    );
    expect(prioridades.map((i) => i.titulo)).toContain(
      'A rotina "Tarefa para o Gil" não conseguiu rodar: A pessoa responsável não está ativa nesta empresa.',
    );
    const falhou = await dono.query(
      "select 1 from auditoria.eventos where acao = 'rotina.falhou' and alvo->>'id' = $1",
      [rotina.id],
    );
    expect(falhou.rowCount).toBe(1);
  });

  it("o dono que sai da empresa tem as rotinas desligadas, e os administradores são avisados", async () => {
    const flora = await como("flora@teste.invalid");
    expect((await pedir("POST", `/rotinas/${ids.relatorio}/ligar`, flora, {})).statusCode).toBe(200);
    await dono.query(
      "update vinculos set situacao = 'desligado', desligado_em = now() where pessoa_id = $1",
      [ids.flora],
    );
    const r = await dono.query("select situacao, desligada_porque, proxima_em from rotinas where id = $1", [
      ids.relatorio,
    ]);
    expect(r.rows[0]).toEqual({
      situacao: "desligada",
      desligada_porque: "dono_desligado",
      proxima_em: null,
    });
    const aviso = await dono.query(
      "select texto from avisos where pessoa_id = $1 and tipo = 'rotina_desligada'",
      [ids.ana],
    );
    expect(aviso.rows[0]?.texto).toBe(
      "1 rotina(s) de Flora Func foram desligadas porque a pessoa saiu da empresa.",
    );
  });
});
