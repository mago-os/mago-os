/**
 * Conversa com o coordenador pelo Telegram (M5-02, decisão 0033), com o Telegram falso e o modelo falso roteirizado:
 * o pedido pelo Telegram cria a tarefa e a resposta volta ao chat certo, com o link; a conversa aparece no app com o
 * canal; conversa nova depois de 6 horas e com /nova; continuar no app não manda nada ao Telegram; a menção ao
 * especialista segue a mesma regra do app; a entrega que falha fica para depois; /tarefas e o "só texto".
 */
import { randomBytes } from "node:crypto";
import type { AtualizacaoDoTelegram } from "@mago-os/contratos";
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
  type PedidoAoModelo,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
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
  async function mandar(conta: number, texto: string | null) {
    numero += 1;
    const a = {
      update_id: numero,
      message: {
        message_id: numero,
        date: Math.floor(Date.now() / 1000),
        chat: { id: conta, type: "private" },
        from: { id: conta, is_bot: false, first_name: `Conta ${conta}` },
        ...(texto === null ? {} : { text: texto }),
      },
    } as AtualizacaoDoTelegram;
    await tratarAtualizacao(opcoesDoBot, a);
  }
  const doChat = (chatId: number) => carteiro.enviadas.filter((m) => m.chatId === chatId).map((m) => m.texto);

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
      canais: {
        aoRodar: () => {},
        aoTerminar: (empresa) => terminadas.push(empresa),
      },
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

  beforeEach(() => {
    carteiro.enviadas.length = 0;
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

  it("foto e arquivo recebem o aviso de que, por enquanto, só texto", async () => {
    await mandar(ANA, null);
    expect(doChat(ANA)).toEqual([
      "Por enquanto entendo só texto por aqui. Arquivos e fotos chegam em breve.",
    ]);
  });
});
