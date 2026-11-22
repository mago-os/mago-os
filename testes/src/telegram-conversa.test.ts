/**
 * Conversa com o coordenador pelo Telegram (M5-02, decisão 0033), com o Telegram falso e o modelo falso roteirizado:
 * o pedido pelo Telegram cria a tarefa e a resposta volta ao chat certo, com o link; a conversa aparece no app com o
 * canal; conversa nova depois de 6 horas e com /nova; continuar no app não manda nada ao Telegram; a menção ao
 * especialista segue a mesma regra do app; a entrega que falha fica para depois; /tarefas e o "só texto".
 */
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AtualizacaoDoTelegram } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import {
  type OpcoesDoMotor,
  registrarRotasDaConversa,
  rodarExecucao,
} from "@mago-os/nucleo/agentes-internos";
import { antivirusDeTeste } from "@mago-os/nucleo/anexos/antivirus";
import { criarDepositoEmDisco, type DepositoEmDisco } from "@mago-os/nucleo/anexos/deposito";
import { cuidarDosAnexos } from "@mago-os/nucleo/anexos/servico";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCofre,
  modelosFalsos,
  type PedidoAoModelo,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import {
  avisarNoTelegram,
  type CarteiroFalsoDoTelegram,
  carteiroFalsoDoTelegram,
  codigoDoPasso,
  criarAutenticador,
  cuidarDasAprovacoesNoTelegram,
  entregarNoTelegram,
  entregarPendentesNoTelegram,
  type OpcoesDoTelegram,
  registrarRotasDoTelegram,
  resumoDoDiaNoTelegram,
  tratarAtualizacao,
} from "@mago-os/nucleo/telegram";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-do-webhook-de-teste-com-32-ou-mais";
const CHAVE = "sk-ant-api03-chave-dos-agentes-Tg01";
const SILENCIO = { info() {}, warn() {}, error() {} };
const ANA = 9001;
const FLORA = 9002;

/** O id da tarefa no último resultado de ferramenta que o modelo recebeu. */
function ultimoResultado(p: PedidoAoModelo): Record<string, unknown> {
  const r = [...p.partes].reverse().find((x) => x.papel === "resultado");
  if (r?.papel !== "resultado") throw new Error("sem resultado");
  const dentro = /^<conteudo_externo>\n([\s\S]*)\n<\/conteudo_externo>$/.exec(r.conteudo)?.[1];
  return JSON.parse(dentro ?? "{}") as Record<string, unknown>;
}

describe.skipIf(!bancoDisponivel)("conversa pelo Telegram", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let carteiro: CarteiroFalsoDoTelegram;
  let opcoesDoBot: OpcoesDoTelegram;
  let motor: OpcoesDoMotor;
  let deposito: DepositoEmDisco;
  let empresaId: string;
  let ip = 0;
  let numero = 5000;
  const fila: { empresaId: string; execucaoId: string }[] = [];
  const terminadas: string[] = [];
  let roteiro: Parameters<typeof modelosFalsos>[0] = [];
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  async function criarPessoa(nome: string, email: string, perfil: string) {
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
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, 'ativo', now(), now())`,
      [empresaId, id, perfil],
    );
    return id;
  }

  async function como(email: string): Promise<string> {
    if (cookies[email]) return cookies[email];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.21.${ip}` },
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

  /** Uma mensagem individual de uma conta do Telegram, tratada na hora (na API, pela fila). */
  async function mandar(conta: number, texto: string | null, extra: Record<string, unknown> = {}) {
    numero += 1;
    const a = {
      update_id: numero,
      message: {
        message_id: numero,
        date: Math.floor(Date.now() / 1000),
        chat: { id: conta, type: "private" },
        from: { id: conta, is_bot: false, first_name: `Conta ${conta}` },
        ...(texto === null ? {} : { text: texto }),
        ...extra,
      },
    } as AtualizacaoDoTelegram;
    await tratarAtualizacao(opcoesDoBot, a);
  }
  // O resumo do dia (M5-08) vai sozinho na verificação a cada minuto; os testes de cada assunto não contam com ele.
  const doChat = (chatId: number) =>
    carteiro.enviadas
      .filter((m) => m.chatId === chatId && !m.texto.startsWith("Resumo do dia"))
      .map((m) => m.texto);
  const resumosDe = (chatId: number) =>
    carteiro.enviadas
      .filter((m) => m.chatId === chatId && m.texto.startsWith("Resumo do dia"))
      .map((m) => m.texto);

  /** Roda a fila dos agentes e entrega as respostas, como a API faz ao fim de cada execução. */
  async function rodarEEntregar() {
    while (fila.length > 0) {
      const t = fila.shift() as { empresaId: string; execucaoId: string };
      await rodarExecucao(motor, t.empresaId, t.execucaoId);
    }
    await entregarNoTelegram(opcoesDoBot, empresaId);
  }

  async function vincular(email: string, conta: number) {
    const r = await pedir("POST", "/conta/telegram/codigo", await como(email));
    await mandar(conta, (r.json() as { codigo: string }).codigo);
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id");
    empresaId = e.rows[0]?.id as string;
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario");

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
    registrarRotasDaConversa(app, { verificador, poolApp, acordar });
    registrarRotasDoTelegram(app, {
      login,
      poolAcesso,
      poolApp,
      bot: { carteiro, segredo: SEGREDO, usuario: () => "OsMagoTesteBot" },
      receber: (a) => tratarAtualizacao(opcoesDoBot, a),
    });
    deposito = criarDepositoEmDisco(SITE, await mkdtemp(join(tmpdir(), "anexos-telegram-")));
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
        anexos: { deposito, antivirus: antivirusDeTeste },
        telegram: { baixar: (id) => carteiro.baixarArquivo(id), acordarAnexos: () => {} },
      },
      log: SILENCIO,
      acordar,
      canais: {
        aoRodar: () => {},
        aoTerminar: (empresa) => terminadas.push(empresa),
      },
    };
    // Aprovar pelo Telegram (M5-04): o serviço de decidir do app e o autenticador com o segredo de teste.
    if (opcoesDoBot.conversa)
      opcoesDoBot.conversa.aprovacoes = {
        decidir: { poolApp, catalogo: catalogoDeModulos(), opcoesMcp: motor.opcoesMcp, acordar },
        autenticador: criarAutenticador({ poolAcesso, poolApp, abrir: async () => "segredo-do-app-da-ana" }),
      };
    await app.ready();

    // Liga o coordenador e o Gerente de projetos com o modelo falso.
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
    await vincular("ana@teste.invalid", ANA);
    await vincular("flora@teste.invalid", FLORA);
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  beforeEach(async () => {
    carteiro.enviadas.length = 0;
    // O limite de 30 mensagens por minuto por conta é da M5-01; aqui os testes mandam muitas em seguida.
    await dono.query("delete from telegram.mensagens_por_minuto");
  });

  it("o pedido pelo Telegram cria a tarefa e a resposta volta ao chat, com o link", async () => {
    roteiro = [
      () => ({
        chamadas: [
          {
            id: "c1",
            nome: "criar_tarefa",
            entrada: { titulo: "Revisar o contrato da DFO", prazo: { dia: "2030-11-29" } },
          },
        ],
      }),
      (p) => {
        ids.tarefa = (ultimoResultado(p).tarefa as { id: string }).id;
        return {
          chamadas: [
            {
              id: "c2",
              nome: "responder",
              entrada: { texto: "Criei a tarefa com prazo na sexta.", tarefas: [ids.tarefa] },
            },
          ],
        };
      },
    ];
    await mandar(ANA, "cria uma tarefa para revisar o contrato da DFO até sexta");
    expect(carteiro.digitandoEm).toContain(ANA);
    await rodarEEntregar();
    expect(terminadas).toContain(empresaId);
    expect(doChat(ANA)).toEqual([`Criei a tarefa com prazo na sexta.\n\n${SITE}/tarefas/${ids.tarefa}`]);
    const t = await dono.query("select titulo, prazo_dia::text as dia from tarefas where id = $1", [
      ids.tarefa,
    ]);
    expect(t.rows[0]).toMatchObject({ titulo: "Revisar o contrato da DFO", dia: "2030-11-29" });

    // A conversa está no app, com o canal do Telegram, e as mensagens também.
    const lista = (await pedir("GET", "/conversas", await como("ana@teste.invalid"))).json() as {
      conversas: { id: string; canal: string }[];
    };
    expect(lista.conversas[0]?.canal).toBe("telegram");
    ids.conversa = lista.conversas[0]?.id as string;
    const aberta = (
      await pedir("GET", `/conversas/${ids.conversa}`, await como("ana@teste.invalid"))
    ).json() as {
      mensagens: { canal: string; autor: { tipo: string } }[];
    };
    expect(aberta.mensagens.map((m) => [m.autor.tipo, m.canal])).toEqual([
      ["pessoa", "telegram"],
      ["agente", "telegram"],
    ]);
    // A resposta ficou registrada como enviada.
    const m = await dono.query(
      "select count(*)::int as n from mensagens_de_conversa where telegram_enviada_em is not null and conversa_id = $1",
      [ids.conversa],
    );
    expect(m.rows[0]?.n).toBe(1);
  });

  it("a próxima mensagem continua a conversa; depois de 6 horas, começa outra", async () => {
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Feito." } }] })];
    await mandar(ANA, "e põe prioridade alta");
    await rodarEEntregar();
    const v = await dono.query("select conversa_id from vinculos_do_telegram where pessoa_id = $1", [
      ids.ana,
    ]);
    expect(v.rows[0]?.conversa_id).toBe(ids.conversa);

    await dono.query("update conversas set atualizada_em = now() - interval '7 hours' where id = $1", [
      ids.conversa,
    ]);
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Oi de novo." } }] })];
    await mandar(ANA, "outro assunto");
    await rodarEEntregar();
    const depois = await dono.query("select conversa_id from vinculos_do_telegram where pessoa_id = $1", [
      ids.ana,
    ]);
    expect(depois.rows[0]?.conversa_id).not.toBe(ids.conversa);
    expect(doChat(ANA)).toEqual(["Feito.", "Oi de novo."]);
  });

  it("/nova começa uma conversa nova", async () => {
    const antes = await dono.query("select conversa_id from vinculos_do_telegram where pessoa_id = $1", [
      ids.ana,
    ]);
    await mandar(ANA, "/nova");
    expect(doChat(ANA)).toEqual(["Pronto, conversa nova. Pode mandar o pedido."]);
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Começando." } }] })];
    await mandar(ANA, "vamos começar");
    await rodarEEntregar();
    const depois = await dono.query("select conversa_id from vinculos_do_telegram where pessoa_id = $1", [
      ids.ana,
    ]);
    expect(depois.rows[0]?.conversa_id).not.toBe(antes.rows[0]?.conversa_id);
  });

  it("uma resposta de cada vez: o segundo pedido espera", async () => {
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Um." } }] })];
    await mandar(ANA, "primeiro");
    await mandar(ANA, "segundo");
    expect(doChat(ANA)).toEqual([
      "Ainda estou respondendo a mensagem anterior. Espere a resposta e mande de novo.",
    ]);
    await rodarEEntregar();
    expect(doChat(ANA).at(-1)).toBe("Um.");
  });

  it("continuar no app uma conversa do Telegram: a resposta fica só no app", async () => {
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Só no app." } }] })];
    const r = await pedir("POST", "/conversas/mensagens", await como("ana@teste.invalid"), {
      conversaId: ids.conversa,
      texto: "continuando pelo app",
    });
    expect(r.statusCode).toBe(201);
    await rodarEEntregar();
    expect(doChat(ANA)).toEqual([]);
    const ultima = await dono.query(
      "select canal, telegram_pendente from mensagens_de_conversa where conversa_id = $1 order by criada_em desc limit 1",
      [ids.conversa],
    );
    expect(ultima.rows[0]).toEqual({ canal: "app", telegram_pendente: false });
  });

  it("a menção ao especialista segue a regra do app", async () => {
    await mandar(FLORA, "@gerente planeja o lançamento");
    expect(doChat(FLORA)).toEqual([
      "Só o administrador e o gestor falam direto com um especialista. Mande o pedido sem a menção, para o coordenador.",
    ]);
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Vou planejar." } }] })];
    await mandar(ANA, "@gerente planeja o lançamento");
    await rodarEEntregar();
    const c = await dono.query<{ agente_id: string }>(
      "select v.agente_id from vinculos_do_telegram t join conversas v on v.id = t.conversa_id where t.pessoa_id = $1",
      [ids.ana],
    );
    expect(c.rows[0]?.agente_id).toBe(ids.gerente);
    expect(doChat(ANA)).toEqual(["Vou planejar."]);
  });

  it("um @ que não é de agente vai inteiro ao coordenador", async () => {
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Certo, Flora." } }] })];
    await mandar(FLORA, "@Ana, cria uma tarefa para revisar o contrato");
    await rodarEEntregar();
    expect(doChat(FLORA)).toEqual(["Certo, Flora."]);
    const c = await dono.query<{ agente_id: string }>(
      "select v.agente_id from vinculos_do_telegram t join conversas v on v.id = t.conversa_id where t.pessoa_id = $1",
      [ids.flora],
    );
    expect(c.rows[0]?.agente_id).toBe(ids.coordenador);
  });

  it("a resposta que não chegou ao Telegram vai na próxima entrega", async () => {
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Depois." } }] })];
    await mandar(ANA, "/nova teste da entrega");
    carteiro.falharProximo = true;
    await rodarEEntregar();
    expect(doChat(ANA)).toEqual(["Pronto, conversa nova. Pode mandar o pedido."]);
    await entregarNoTelegram(opcoesDoBot, empresaId);
    expect(doChat(ANA).at(-1)).toBe("Depois.");
  });

  it("/tarefas mostra as prioridades com o link", async () => {
    await dono.query(
      "update tarefas set prazo_dia = current_date - 1, responsavel_pessoa_id = $2 where id = $1",
      [ids.tarefa, ids.ana],
    );
    await mandar(ANA, "/tarefas");
    const texto = doChat(ANA).at(-1) ?? "";
    expect(texto).toMatch(/^Prioridades de hoje:/);
    expect(texto).toContain("Revisar o contrato da DFO");
    expect(texto).toContain(`${SITE}/tarefas/${ids.tarefa}`);
  });

  it("resposta longa que parou no meio continua da parte que faltava", async () => {
    const longo = `${"palavra ".repeat(600)}fim`;
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: longo } }] })];
    await mandar(ANA, "/nova resposta longa");
    carteiro.enviadas.length = 0;
    // A primeira parte vai; a segunda falha.
    const enviar = carteiro.enviar.bind(carteiro);
    let n = 0;
    carteiro.enviar = async (chatId, texto, op) => {
      n += 1;
      if (n === 2) throw new Error("caiu no meio");
      return enviar(chatId, texto, op);
    };
    await rodarEEntregar();
    carteiro.enviar = enviar;
    expect(doChat(ANA)).toHaveLength(1);
    await entregarNoTelegram(opcoesDoBot, empresaId);
    const partes = doChat(ANA);
    expect(partes).toHaveLength(2);
    expect(partes.join(" ").replace(/\s+/g, " ")).toBe(longo.replace(/\s+/g, " "));
  });

  it("mensagem sem texto nem arquivo recebe o aviso de que só entende texto", async () => {
    await mandar(ANA, null);
    expect(doChat(ANA)).toEqual([
      "Por aqui entendo texto, fotos, documentos, áudios e vídeos. Esse tipo de mensagem ainda não.",
    ]);
  });

  // Arquivos (M5-03): o id do arquivo vem na mensagem que o agente recebe.
  const idDoArquivo = (p: PedidoAoModelo) =>
    /id ([0-9a-f-]{36})\]/.exec(JSON.stringify(p.partes.filter((x) => x.papel === "usuario").at(-1)))?.[1] ??
    "";

  it("a foto com legenda vira anexo da tarefa, passa pelo antivírus, e o agente não vê o conteúdo", async () => {
    carteiro.arquivos.set("foto-grande", Buffer.from("conteudo da foto"));
    let vistoPeloAgente = "";
    roteiro = [
      (p) => {
        vistoPeloAgente = JSON.stringify(p.partes.at(-1));
        ids.arquivo = idDoArquivo(p);
        return {
          chamadas: [
            {
              id: "a1",
              nome: "anexar_arquivo",
              entrada: {
                arquivoId: ids.arquivo,
                tarefaId: ids.tarefa,
                descricao: "Foto do contrato assinado",
              },
            },
          ],
        };
      },
      () => ({
        chamadas: [
          { id: "r", nome: "responder", entrada: { texto: "Anexei a foto.", tarefas: [ids.tarefa] } },
        ],
      }),
    ];
    await mandar(ANA, null, {
      caption: "/nova anexa na tarefa do contrato",
      photo: [
        { file_id: "foto-pequena", file_unique_id: "p", file_size: 10 },
        { file_id: "foto-grande", file_unique_id: "g", file_size: 16 },
      ],
    });
    await rodarEEntregar();
    expect(vistoPeloAgente).toContain("anexa na tarefa do contrato");
    expect(vistoPeloAgente).toMatch(
      /Arquivo recebido pelo Telegram, esperando uma tarefa: foto-[0-9-]+\.jpg \(image\/jpeg/,
    );
    expect(vistoPeloAgente).not.toContain("conteudo da foto");
    expect(doChat(ANA).at(-1)).toBe(`Anexei a foto.\n\n${SITE}/tarefas/${ids.tarefa}`);
    expect(await cuidarDosAnexos(poolApp, { deposito, antivirus: antivirusDeTeste }, SILENCIO)).toMatchObject(
      {
        liberados: 1,
      },
    );
    const anexo = await dono.query(
      "select situacao, tamanho::int as tamanho, enviado_por_pessoa_id, enviado_por_agente_id, descricao, canal from anexos where tarefa_id = $1",
      [ids.tarefa],
    );
    expect(anexo.rows).toEqual([
      {
        situacao: "disponivel",
        tamanho: 16,
        enviado_por_pessoa_id: ids.ana,
        enviado_por_agente_id: null,
        descricao: "Foto do contrato assinado",
        canal: "telegram",
      },
    ]);
    const arq = await dono.query("select situacao from arquivos_do_telegram where id = $1", [ids.arquivo]);
    expect(arq.rows[0]?.situacao).toBe("anexado");
    // O antivírus liberou: o arquivo fica conferido, sem aviso no Telegram.
    carteiro.enviadas.length = 0;
    await entregarPendentesNoTelegram(opcoesDoBot);
    expect(doChat(ANA)).toEqual([]);
    const conferido = await dono.query(
      "select antivirus_conferido_em is not null as ok from arquivos_do_telegram where id = $1",
      [ids.arquivo],
    );
    expect(conferido.rows[0]?.ok).toBe(true);
  });

  it("o arquivo bloqueado pelo antivírus é avisado no Telegram, uma vez", async () => {
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    carteiro.arquivos.set("doc-eicar", Buffer.from(eicar));
    roteiro = [
      (p) => ({
        chamadas: [
          { id: "a1", nome: "anexar_arquivo", entrada: { arquivoId: idDoArquivo(p), tarefaId: ids.tarefa } },
        ],
      }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Anexei." } }] }),
    ];
    await mandar(ANA, null, {
      caption: "/nova anexa no contrato",
      document: {
        file_id: "doc-eicar",
        file_unique_id: "e",
        file_size: eicar.length,
        file_name: "teste.txt",
        mime_type: "text/plain",
      },
    });
    await rodarEEntregar();
    expect(await cuidarDosAnexos(poolApp, { deposito, antivirus: antivirusDeTeste }, SILENCIO)).toMatchObject(
      {
        bloqueados: 1,
      },
    );
    carteiro.enviadas.length = 0;
    await entregarPendentesNoTelegram(opcoesDoBot);
    await entregarPendentesNoTelegram(opcoesDoBot);
    expect(doChat(ANA)).toEqual([
      "O antivírus bloqueou teste.txt, e o arquivo foi apagado. Ele não entrou na tarefa.",
    ]);
  });

  it("arquivo grande, tipo que roda programa e figurinha são recusados na hora", async () => {
    await mandar(ANA, null, {
      document: { file_id: "x", file_unique_id: "x", file_size: 21 * 1024 * 1024, file_name: "grande.pdf" },
    });
    await mandar(ANA, null, {
      document: { file_id: "y", file_unique_id: "y", file_size: 10, file_name: "instalar.exe" },
    });
    // Documento sem nome, com tipo de programa: recusado pelo tipo.
    await mandar(ANA, null, {
      document: { file_id: "w", file_unique_id: "w", file_size: 10, mime_type: "application/x-msdownload" },
    });
    await mandar(ANA, null, { sticker: { file_id: "z" } });
    expect(doChat(ANA)).toEqual([
      "Esse arquivo passa de 20 MB, o limite do Telegram para o Mago OS receber. Mande pelo app, na tarefa.",
      "Esse tipo de arquivo não é aceito (pode rodar um programa). Mande outro formato, como PDF ou imagem.",
      "Esse tipo de arquivo não é aceito (pode rodar um programa). Mande outro formato, como PDF ou imagem.",
      "Figurinhas e GIFs não viram anexo. Mande foto, documento, áudio ou vídeo.",
    ]);
    const n = await dono.query(
      "select count(*)::int as n from arquivos_do_telegram where nome in ('grande.pdf', 'instalar.exe')",
    );
    expect(n.rows[0]?.n).toBe(0);
  });

  it("com o agente ocupado, o arquivo espera; e ninguém anexa o arquivo de outra pessoa", async () => {
    roteiro = [() => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Ok." } }] })];
    await mandar(ANA, "/nova primeiro pedido");
    await mandar(ANA, null, {
      voice: { file_id: "voz", file_unique_id: "v", file_size: 100, mime_type: "audio/ogg" },
    });
    expect(doChat(ANA).at(-1)).toMatch(/^Recebi audio-[0-9-]+\.ogg\. Ele fica esperando por 24 horas/);
    await rodarEEntregar();
    const esperando = await dono.query<{ id: string }>(
      "select id from arquivos_do_telegram where pessoa_id = $1 and situacao = 'esperando' and tipo = 'audio/ogg'",
      [ids.ana],
    );
    expect(esperando.rowCount).toBe(1);
    ids.voz = esperando.rows[0]?.id as string;
    // A Flora pede ao coordenador para anexar o áudio da Ana: a ferramenta recusa.
    let resultado = "";
    roteiro = [
      () => ({
        chamadas: [
          { id: "a1", nome: "anexar_arquivo", entrada: { arquivoId: ids.voz, tarefaId: ids.tarefa } },
        ],
      }),
      (p) => {
        resultado = JSON.stringify(p.partes.at(-1));
        return { chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Não deu." } }] };
      },
    ];
    await mandar(FLORA, "/nova anexa o áudio");
    await rodarEEntregar();
    expect(resultado).toContain("Arquivo não encontrado entre os que quem pediu mandou pelo Telegram");
    const ainda = await dono.query("select situacao from arquivos_do_telegram where id = $1", [ids.voz]);
    expect(ainda.rows[0]?.situacao).toBe("esperando");
  });

  it("arquivos_recebidos mostra os que esperam, e o que passou de 24 horas vence", async () => {
    let lista = "";
    roteiro = [
      () => ({ chamadas: [{ id: "l", nome: "arquivos_recebidos", entrada: {} }] }),
      (p) => {
        lista = JSON.stringify(p.partes.at(-1));
        return { chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Tem um áudio." } }] };
      },
    ];
    await mandar(ANA, "/nova quais arquivos eu mandei?");
    await rodarEEntregar();
    expect(lista).toContain(ids.voz);
    await dono.query(
      "update arquivos_do_telegram set recebido_em = now() - interval '25 hours', vence_em = now() - interval '1 hour' where id = $1",
      [ids.voz],
    );
    await entregarPendentesNoTelegram(opcoesDoBot);
    const v = await dono.query("select situacao from arquivos_do_telegram where id = $1", [ids.voz]);
    expect(v.rows[0]?.situacao).toBe("vencido");
  });

  // Aprovar pelo Telegram (M5-04). O autenticador é o de verdade, com um segredo de teste "aberto" pela função falsa.
  const SEGREDO_DO_APP = "segredo-do-app-da-ana";
  const codigoDeAgora = (desloca = 0) =>
    codigoDoPasso(Buffer.from(SEGREDO_DO_APP), Math.floor(Date.now() / 30_000) + desloca);
  async function tocar(conta: number, dados: string) {
    numero += 1;
    await tratarAtualizacao(opcoesDoBot, {
      update_id: numero,
      callback_query: {
        id: `q${numero}`,
        from: { id: conta, is_bot: false, first_name: `Conta ${conta}` },
        message: { message_id: 1, chat: { id: conta, type: "private" } },
        data: dados,
      },
    } as AtualizacaoDoTelegram);
  }
  /** O agente pede para mudar a prioridade (a regra pede aprovação) e o pedido vai ao Telegram. */
  async function pedirAprovacao(prioridade: string): Promise<string> {
    roteiro = [
      () => ({
        chamadas: [{ id: "m1", nome: "mudar_prazo", entrada: { tarefaId: ids.tarefa, prioridade } }],
      }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Pedi a aprovação." } }] }),
    ];
    await mandar(ANA, `/nova põe prioridade ${prioridade}`);
    await rodarEEntregar();
    await cuidarDasAprovacoesNoTelegram(opcoesDoBot, empresaId);
    const a = await dono.query<{ id: string }>(
      "select id from aprovacoes where acao = 'mudar_prazo' and situacao = 'pendente' order by criada_em desc limit 1",
    );
    return a.rows[0]?.id as string;
  }

  it("o pedido de aprovação chega no Telegram com os botões, e sem app autenticador só dá para recusar", async () => {
    ids.aprovacao = await pedirAprovacao("alta");
    const msg = carteiro.enviadas.find((m) => m.texto.includes("pede a sua aprovação"));
    expect(msg?.chatId).toBe(ANA);
    expect(msg?.texto).toContain("prioridade alta");
    expect(msg?.opcoes?.botoes?.[0]).toEqual([
      { texto: "Aprovar", dados: `ap:a:${ids.aprovacao}` },
      { texto: "Recusar", dados: `ap:r:${ids.aprovacao}` },
    ]);
    expect(msg?.opcoes?.botoes?.[1]?.[0]).toEqual({
      texto: "Abrir no app",
      url: `${SITE}/aprovacoes/${ids.aprovacao}`,
    });
    // Mandar de novo não repete.
    carteiro.enviadas.length = 0;
    await cuidarDasAprovacoesNoTelegram(opcoesDoBot, empresaId);
    expect(doChat(ANA)).toEqual([]);
    await tocar(ANA, `ap:a:${ids.aprovacao}`);
    expect(doChat(ANA).at(-1)).toMatch(/^Você não usa app autenticador/);
  });

  it("aprovar pede o código; o errado conta, o certo aprova, apaga o código e atualiza o pedido", async () => {
    await dono.query(
      "insert into acesso.dois_fatores (pessoa_id, segredo, codigos_recuperacao, verificado) values ($1, 'cifrado', 'x', true)",
      [ids.ana],
    );
    await tocar(ANA, `ap:a:${ids.aprovacao}`);
    expect(doChat(ANA).at(-1)).toMatch(/^Para aprovar ".*", mande agora o código de 6 dígitos/);
    await mandar(ANA, "000000" === codigoDeAgora() ? "111111" : "000000");
    expect(doChat(ANA).at(-1)).toBe(
      "Código errado. Restam 2 tentativas antes de travar as aprovações por 15 minutos.",
    );
    const apagadasAntes = carteiro.apagadas.length;
    await mandar(ANA, codigoDeAgora());
    expect(carteiro.apagadas.length).toBe(apagadasAntes + 1);
    expect(doChat(ANA).at(-1)).toMatch(/^Aprovado: /);
    const t = await dono.query("select prioridade from tarefas where id = $1", [ids.tarefa]);
    expect(t.rows[0]?.prioridade).toBe("alta");
    const a = await dono.query("select situacao, decidida_por from aprovacoes where id = $1", [
      ids.aprovacao,
    ]);
    expect(a.rows[0]).toEqual({ situacao: "aprovada", decidida_por: ids.ana });
    expect(carteiro.editadas.at(-1)?.texto).toMatch(/Ana Admin decidiu: aprovado\.$/);
    const ev = await dono.query(
      "select detalhes->>'canal' as canal from auditoria.eventos where acao = 'aprovacao.aprovou' order by sequencia desc limit 1",
    );
    expect(ev.rows[0]?.canal).toBe("telegram");
    const aviso = await dono.query(
      "select 1 from avisos where pessoa_id = $1 and tipo = 'aprovacao_decidida' and texto like '%pelo Telegram%'",
      [ids.ana],
    );
    expect(aviso.rowCount).toBeGreaterThan(0);
    // O botão de um pedido já decidido só diz o que aconteceu.
    await tocar(ANA, `ap:a:${ids.aprovacao}`);
    expect(doChat(ANA).at(-1)).toBe("Esse pedido já foi aprovado.");
  });

  it("o mesmo código não vale duas vezes, e três erros travam as aprovações pelo Telegram", async () => {
    const usado = codigoDeAgora();
    ids.aprovacao2 = await pedirAprovacao("baixa");
    await tocar(ANA, `ap:a:${ids.aprovacao2}`);
    await mandar(ANA, usado);
    expect(doChat(ANA).at(-1)).toMatch(/^Código errado/);
    await mandar(ANA, "999999" === codigoDeAgora() ? "888888" : "999999");
    await mandar(ANA, "777777" === codigoDeAgora() ? "666666" : "777777");
    expect(doChat(ANA).at(-1)).toMatch(/^Muitos códigos errados/);
    const aviso = await dono.query(
      "select 1 from avisos where pessoa_id = $1 and tipo = 'telegram_aprovacoes_travadas'",
      [ids.ana],
    );
    expect(aviso.rowCount).toBe(1);
    await tocar(ANA, `ap:a:${ids.aprovacao2}`);
    expect(doChat(ANA).at(-1)).toMatch(/^Muitos códigos errados/);
    const a = await dono.query("select situacao from aprovacoes where id = $1", [ids.aprovacao2]);
    expect(a.rows[0]?.situacao).toBe("pendente");
  });

  it("recusar pede o motivo e recusa; outra conversa no meio cancela o pedido de código", async () => {
    await tocar(ANA, `ap:r:${ids.aprovacao2}`);
    expect(doChat(ANA).at(-1)).toBe("Mande numa mensagem o motivo da recusa (ou escreva: sem motivo).");
    await mandar(ANA, "Baixa não, deixa alta.");
    expect(doChat(ANA).at(-1)).toMatch(/^Recusado: /);
    const a = await dono.query("select situacao, observacao from aprovacoes where id = $1", [ids.aprovacao2]);
    expect(a.rows[0]).toEqual({ situacao: "recusada", observacao: "Baixa não, deixa alta." });
    const t = await dono.query("select prioridade from tarefas where id = $1", [ids.tarefa]);
    expect(t.rows[0]?.prioridade).toBe("alta");
  });

  it("quem não pode decidir não decide pelo botão", async () => {
    await tocar(FLORA, `ap:a:${ids.aprovacao}`);
    expect(doChat(FLORA).at(-1)).toBe("Não encontrei esse pedido entre os que você pode decidir.");
  });

  // Avisos e resumo do dia pelo Telegram (M5-08).
  async function aviso(pessoaId: string, tipo: string, texto: string, criadoHa = "0 minutes") {
    await dono.query(
      `insert into avisos (empresa_id, pessoa_id, tipo, texto, link, push_pendente, criado_em)
       values ($1, $2, $3, $4, '/tarefas', false, now() - $5::interval)`,
      [empresaId, pessoaId, tipo, texto, criadoHa],
    );
  }
  async function preferencias(pessoaId: string, p: Record<string, unknown>) {
    await dono.query(
      `insert into preferencias_de_notificacao (empresa_id, pessoa_id, preferencias) values ($1, $2, $3::jsonb)
       on conflict (empresa_id, pessoa_id) do update set preferencias = excluded.preferencias`,
      [empresaId, pessoaId, JSON.stringify(p)],
    );
  }

  it("pelo Telegram vai na hora só o urgente; o pedido de aprovação não se repete; o resto fica no sino", async () => {
    await dono.query("update avisos set telegram_pendente = false");
    await aviso(ids.ana as string, "mencao", "Flora mencionou você em Revisar o contrato da DFO.");
    await aviso(ids.ana as string, "comentario", "Comentário novo numa tarefa que você segue.");
    await aviso(ids.ana as string, "aprovacao_pedida", "Gerente de projetos pede aprovação.");
    expect(await avisarNoTelegram(opcoesDoBot, empresaId)).toBe(1);
    expect(doChat(ANA)).toEqual([`Flora mencionou você em Revisar o contrato da DFO.\n\n${SITE}/tarefas`]);
    const pendentes = await dono.query("select count(*)::int as n from avisos where telegram_pendente");
    expect(pendentes.rows[0]?.n).toBe(0);
  });

  it("o silêncio segura o aviso; ligado na preferência, o tipo vai; depois de 12 horas, desiste", async () => {
    await preferencias(ids.ana as string, { porTipo: {}, silencio: { de: "00:00", ate: "23:59" } });
    await aviso(ids.ana as string, "precisa_de_ajuda", "Uma tarefa precisa de ajuda.");
    expect(await avisarNoTelegram(opcoesDoBot, empresaId)).toBe(0);
    await preferencias(ids.ana as string, {
      porTipo: { comentario: { tela: true, push: true, telegram: true } },
      silencio: null,
    });
    await aviso(ids.ana as string, "comentario", "Comentário novo, agora pelo Telegram.");
    await aviso(ids.ana as string, "mencao", "Menção antiga demais.", "13 hours");
    expect(await avisarNoTelegram(opcoesDoBot, empresaId)).toBe(2);
    expect(
      doChat(ANA)
        .map((t) => t.split("\n")[0])
        .sort(),
    ).toEqual(["Comentário novo, agora pelo Telegram.", "Uma tarefa precisa de ajuda."]);
  });

  it("o resumo do dia vai uma vez, na hora; desligado, não vai; tarde demais, o dia é pulado", async () => {
    // 11:30 em UTC são 08:30 em São Paulo (o fuso padrão das pessoas de teste).
    const asOitoEMeia = new Date("2030-01-15T11:30:00Z");
    await preferencias(ids.ana as string, { porTipo: {}, silencio: null, resumoDoDia: { hora: "08:00" } });
    await dono.query("update vinculos_do_telegram set resumo_do_dia_em = null");
    await preferencias(ids.flora as string, { porTipo: {}, silencio: null, resumoDoDia: null });
    expect(await resumoDoDiaNoTelegram(opcoesDoBot, empresaId, asOitoEMeia)).toBe(1);
    expect(resumosDe(ANA)).toHaveLength(1);
    expect(resumosDe(FLORA)).toEqual([]);
    // Na mesma data, não repete.
    expect(await resumoDoDiaNoTelegram(opcoesDoBot, empresaId, asOitoEMeia)).toBe(0);
    const marcados = await dono.query(
      "select count(*)::int as n from vinculos_do_telegram where resumo_do_dia_em = '2030-01-15'",
    );
    expect(marcados.rows[0]?.n).toBe(2);
    // No dia seguinte às 20h (vinculou à noite, o servidor ficou fora): nada de resumo à noite, o dia é pulado.
    expect(await resumoDoDiaNoTelegram(opcoesDoBot, empresaId, new Date("2030-01-16T23:00:00Z"))).toBe(0);
    expect(resumosDe(ANA)).toHaveLength(1);
  });
});
