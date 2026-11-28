/**
 * O WhatsApp oficial da plataforma para a equipe (M8-09, decisão 0059), com a Meta falsa e o modelo falso: o webhook
 * (o desafio e a assinatura), o vínculo por código com as travas, a conversa com o coordenador (a resposta volta ao
 * WhatsApp), as palavras nova, tarefas, empresa, ajuda e sair, os pedidos de aprovação com os botões e o código do
 * autenticador (com as travas do Telegram), os avisos dentro e fora da janela de 24 horas (por modelo, até 10 por dia),
 * o resumo do dia, as preferências, a mensagem repetida, o aviso de outro número e o isolamento.
 */
import { randomBytes } from "node:crypto";
import type { AvisoDaMeta } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import {
  type OpcoesDoMotor,
  registrarRotasDaConversa,
  rodarExecucao,
} from "@mago-os/nucleo/agentes-internos";
import { criarAviso } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCofre,
  modelosFalsos,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { codigoDoPasso, criarAutenticador } from "@mago-os/nucleo/telegram";
import {
  assinaturaDaMeta,
  avisarNoWhatsapp,
  type CarteiroFalsoDaMeta,
  carteiroFalsoDaMeta,
  cuidarDasAprovacoesNoWhatsapp,
  entregarNoWhatsapp,
  modeloDoAviso,
  type OpcoesDoWhatsapp,
  registrarRotasDoWhatsapp,
  resumoDoDiaNoWhatsapp,
  tratarAvisoDaMeta,
} from "@mago-os/nucleo/whatsapp";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const CHAVE = "sk-ant-api03-chave-dos-agentes-Wa01";
const SEGREDO_DO_APP = "0123456789abcdef0123456789abcdef";
const VERIFICACAO = "verificacao-do-webhook-de-teste";
const NUMERO_ID = "1587526754433555";
const SILENCIO = { info() {}, warn() {}, error() {} };
const ANA = "5511911110001";
const FLORA = "5511911110002";
const SEGREDO_DO_AUTENTICADOR = "segredo-do-app-da-ana";

describe.skipIf(!bancoDisponivel)("WhatsApp da plataforma", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let carteiro: CarteiroFalsoDaMeta;
  let opcoes: OpcoesDoWhatsapp;
  let motor: OpcoesDoMotor;
  let empresaId: string;
  let outraId: string;
  let ip = 0;
  let n = 0;
  const fila: { empresaId: string; execucaoId: string }[] = [];
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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.57.${ip}` },
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

  /** Um aviso da Meta com uma mensagem de texto (ou de botão), tratado na hora (na API, pela fila). */
  function aviso(de: string, mensagem: Record<string, unknown>, numeroId = NUMERO_ID): AvisoDaMeta {
    n += 1;
    return {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "28973061455709377",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: numeroId },
                contacts: [{ wa_id: de, profile: { name: `Perfil ${de.slice(-4)}` } }],
                messages: [
                  {
                    id: `wamid.T${n}`,
                    from: de,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    ...mensagem,
                  },
                ],
              },
            },
          ],
        },
      ],
    } as AvisoDaMeta;
  }
  const mandar = (de: string, texto: string) =>
    tratarAvisoDaMeta(opcoes, aviso(de, { type: "text", text: { body: texto } }));
  const tocar = (de: string, id: string, titulo = "Aprovar") =>
    tratarAvisoDaMeta(
      opcoes,
      aviso(de, {
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id, title: titulo } },
      }),
    );
  const doNumero = (numero: string) =>
    carteiro.enviados
      .filter((e) => e.para === numero && !(e.texto ?? "").startsWith("Resumo do dia"))
      .map((e) => e.texto);

  async function rodarEEntregar() {
    while (fila.length > 0) {
      const t = fila.shift() as { empresaId: string; execucaoId: string };
      await rodarExecucao(motor, t.empresaId, t.execucaoId);
    }
    await entregarNoWhatsapp(opcoes, empresaId);
  }

  async function vincular(email: string, numero: string) {
    const r = await pedir("POST", "/conta/whatsapp/codigo", await como(email));
    expect(r.statusCode, r.body).toBe(200);
    const corpo = r.json() as { codigo: string; link: string };
    expect(corpo.link).toBe(`https://wa.me/15551536171?text=${corpo.codigo}`);
    await mandar(numero, corpo.codigo);
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    empresaId = (
      await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id")
    ).rows[0]?.id as string;
    outraId = (await dono.query<{ id: string }>("insert into empresas (nome) values ('Outra') returning id"))
      .rows[0]?.id as string;
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
    carteiro = carteiroFalsoDaMeta();
    opcoes = {
      poolApp,
      carteiro,
      numeroId: NUMERO_ID,
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
    registrarRotasDoWhatsapp(app, {
      login,
      poolAcesso,
      poolApp,
      meta: { carteiro, segredoDoApp: SEGREDO_DO_APP, verificacao: VERIFICACAO },
      receber: (a) => tratarAvisoDaMeta(opcoes, a),
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
    };
    if (opcoes.conversa)
      opcoes.conversa.aprovacoes = {
        decidir: { poolApp, catalogo: catalogoDeModulos(), opcoesMcp: motor.opcoesMcp, acordar },
        autenticador: criarAutenticador({ poolAcesso, poolApp, abrir: async () => SEGREDO_DO_AUTENTICADOR }),
      };
    await app.ready();
    const ana = await como("ana@teste.invalid");
    const respostaDosAgentes = await pedir("GET", "/agentes", ana);
    const agentes = respostaDosAgentes.json() as { id: string; papel: string }[];
    if (!Array.isArray(agentes)) throw new Error(respostaDosAgentes.body);
    ids.coordenador = agentes.find((a) => a.papel === "coordenador")?.id as string;
    ids.conta = (
      await pedir("POST", "/ia/contas", ana, { nome: "Principal", provedor: "anthropic", chave: CHAVE })
    ).json().id;
    await pedir("POST", `/ia/contas/${ids.conta}/modelos`, ana, {
      modelos: [{ modelo: "modelo-bom", liberado: true }],
    });
    await pedir("POST", `/agentes/${ids.coordenador}/modelos`, ana, {
      modelos: { principal: { contaId: ids.conta, modelo: "modelo-bom" }, reserva: null },
    });
    expect((await pedir("POST", `/agentes/${ids.coordenador}/retomar`, ana, {})).statusCode).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  beforeEach(async () => {
    carteiro.enviados.length = 0;
    carteiro.janelaFechada.clear();
    await dono.query("delete from whatsapp.mensagens_por_minuto");
  });

  it("o webhook: o desafio só com a verificação certa, e o aviso só com a assinatura certa", async () => {
    const certo = await app.inject({
      method: "GET",
      url: `/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFICACAO}&hub.challenge=12345`,
    });
    expect(certo.statusCode).toBe(200);
    expect(certo.body).toBe("12345");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1",
        })
      ).statusCode,
    ).toBe(403);
    const corpo = Buffer.from(JSON.stringify(aviso(FLORA, { type: "text", text: { body: "oi" } })));
    const sem = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=errada" },
      payload: corpo,
    });
    expect(sem.statusCode).toBe(401);
    const com = await app.inject({
      method: "POST",
      url: "/whatsapp/webhook",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": assinaturaDaMeta(corpo, SEGREDO_DO_APP),
      },
      payload: corpo,
    });
    expect(com.statusCode).toBe(200);
    // Número sem vínculo recebe só a resposta fixa.
    expect(doNumero(FLORA)).toEqual([
      "Para usar o Mago OS pelo WhatsApp, vincule o número em Meu perfil, no app.",
    ]);
  });

  it("vincular pelo código, com o código errado contado e a trava depois de 5", async () => {
    await vincular("ana@teste.invalid", ANA);
    expect(doNumero(ANA).at(-1)).toMatch(/^Pronto, Ana\. Você está na 4xpert\./);
    const v = await dono.query("select numero, nome from vinculos_do_whatsapp where pessoa_id = $1", [
      ids.ana,
    ]);
    expect(v.rows[0]).toEqual({ numero: ANA, nome: "Perfil 0001" });
    for (let i = 0; i < 5; i++) await mandar(FLORA, "ABCDEFGH");
    expect(doNumero(FLORA).at(-1)).toMatch(/^Muitos códigos errados/);
    await dono.query("delete from whatsapp.codigos_errados");
    await vincular("flora@teste.invalid", FLORA);
    expect(doNumero(FLORA).at(-1)).toMatch(/^Pronto, Flora/);
    const s = await pedir("GET", "/conta/whatsapp", await como("ana@teste.invalid"));
    expect(s.json()).toMatchObject({
      ligado: true,
      vinculo: { finalDoNumero: "0001", empresa: { nome: "4xpert" } },
    });
  });

  it("a conversa com o coordenador: a resposta volta ao WhatsApp; mensagem repetida não roda duas vezes", async () => {
    roteiro = [
      () => ({
        chamadas: [{ id: "r1", nome: "responder", entrada: { texto: "Oi, Ana! Como posso ajudar?" } }],
      }),
    ];
    const a = aviso(ANA, { type: "text", text: { body: "bom dia" } });
    await tratarAvisoDaMeta(opcoes, a);
    await tratarAvisoDaMeta(opcoes, a);
    expect(fila).toHaveLength(1);
    await rodarEEntregar();
    expect(doNumero(ANA)).toEqual(["Oi, Ana! Como posso ajudar?"]);
    const c = await dono.query(
      "select canal from conversas where pessoa_id = $1 order by criada_em desc limit 1",
      [ids.ana],
    );
    expect(c.rows[0]?.canal).toBe("whatsapp");
    // Foto não é aceita por enquanto; "ajuda" lista as palavras.
    await tratarAvisoDaMeta(opcoes, aviso(ANA, { type: "image" }));
    expect(doNumero(ANA).at(-1)).toMatch(/^Por aqui, por enquanto, só texto/);
    await mandar(ANA, "ajuda");
    expect(doNumero(ANA).at(-1)).toMatch(/nova: começar uma conversa nova/);
    await mandar(ANA, "nova");
    expect(doNumero(ANA).at(-1)).toBe("Pronto, conversa nova. Pode mandar o pedido.");
  });

  it("empresa: lista com botões e troca pelo botão; o aviso de outro número da Meta é ignorado", async () => {
    // A Ana passa a estar também na Outra.
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, 'administrador', 'ativo', now(), now())`,
      [outraId, ids.ana],
    );
    await mandar(ANA, "empresa");
    const lista = carteiro.enviados.at(-1);
    expect(lista?.botoes?.map((b) => b.titulo).sort()).toEqual(["4xpert", "Outra"]);
    await tocar(ANA, `em:${outraId}`, "Outra");
    expect(doNumero(ANA).at(-1)).toBe("Pronto. Agora você está na Outra.");
    await mandar(ANA, "empresa 1");
    expect(doNumero(ANA).at(-1)).toMatch(/Agora você está na 4xpert|Você já está na 4xpert/);
    const antes = carteiro.enviados.length;
    await tratarAvisoDaMeta(opcoes, aviso(ANA, { type: "text", text: { body: "oi" } }, "999999"));
    expect(carteiro.enviados.length).toBe(antes);
  });

  it("aprovação: os botões dentro da janela, o código do autenticador aprova; fora da janela, o modelo", async () => {
    // Uma tarefa e um pedido de aprovação do coordenador (a regra pede aprovação para mudar a prioridade).
    roteiro = [
      () => ({ chamadas: [{ id: "c1", nome: "criar_tarefa", entrada: { titulo: "Revisar o contrato" } }] }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Criei." } }] }),
    ];
    await mandar(ANA, "nova cria a tarefa revisar o contrato");
    await rodarEEntregar();
    ids.tarefa = (await dono.query<{ id: string }>("select id from tarefas order by criada_em desc limit 1"))
      .rows[0]?.id as string;
    roteiro = [
      () => ({
        chamadas: [{ id: "m1", nome: "mudar_prazo", entrada: { tarefaId: ids.tarefa, prioridade: "alta" } }],
      }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Pedi a aprovação." } }] }),
    ];
    await mandar(ANA, "nova põe prioridade alta");
    await rodarEEntregar();
    await cuidarDasAprovacoesNoWhatsapp(opcoes, empresaId);
    ids.aprovacao = (
      await dono.query<{ id: string }>(
        "select id from aprovacoes where situacao = 'pendente' order by criada_em desc limit 1",
      )
    ).rows[0]?.id as string;
    const pedido = carteiro.enviados.find((e) => e.botoes?.length);
    expect(pedido?.para).toBe(ANA);
    expect(pedido?.botoes).toEqual([
      { id: `ap:a:${ids.aprovacao}`, titulo: "Aprovar" },
      { id: `ap:r:${ids.aprovacao}`, titulo: "Recusar" },
    ]);
    // Sem autenticador, aprovar não vale.
    await tocar(ANA, `ap:a:${ids.aprovacao}`);
    expect(doNumero(ANA).at(-1)).toMatch(/^Você não usa app autenticador/);
    await dono.query(
      "insert into acesso.dois_fatores (pessoa_id, segredo, codigos_recuperacao, verificado) values ($1, 'cifrado', 'x', true)",
      [ids.ana],
    );
    await tocar(ANA, `ap:a:${ids.aprovacao}`);
    expect(doNumero(ANA).at(-1)).toMatch(/^Para aprovar ".*", mande agora o código de 6 dígitos/);
    const agora = codigoDoPasso(Buffer.from(SEGREDO_DO_AUTENTICADOR), Math.floor(Date.now() / 30_000));
    await mandar(ANA, agora === "000000" ? "111111" : "000000");
    expect(doNumero(ANA).at(-1)).toMatch(/^Código errado\. Restam 2/);
    await mandar(ANA, codigoDoPasso(Buffer.from(SEGREDO_DO_AUTENTICADOR), Math.floor(Date.now() / 30_000)));
    expect(doNumero(ANA).at(-1)).toMatch(/^Aprovado: /);
    const a = await dono.query("select situacao from aprovacoes where id = $1", [ids.aprovacao]);
    expect(a.rows[0]?.situacao).toBe("aprovada");
    const ev = await dono.query(
      "select detalhes->>'canal' as canal from auditoria.eventos where acao = 'aprovacao.aprovou' order by sequencia desc limit 1",
    );
    expect(ev.rows[0]?.canal).toBe("whatsapp");

    // Fora da janela: um pedido novo vai pelo modelo aviso_do_mago_os, sem os botões.
    await dono.query(
      "update vinculos_do_whatsapp set ultima_mensagem_em = now() - interval '25 hours' where pessoa_id = $1",
      [ids.ana],
    );
    roteiro = [
      () => ({
        chamadas: [{ id: "m2", nome: "mudar_prazo", entrada: { tarefaId: ids.tarefa, prioridade: "baixa" } }],
      }),
      () => ({ chamadas: [{ id: "r", nome: "responder", entrada: { texto: "Pedi." } }] }),
    ];
    await mandar(ANA, "nova põe prioridade baixa");
    await dono.query(
      "update vinculos_do_whatsapp set ultima_mensagem_em = now() - interval '25 hours' where pessoa_id = $1",
      [ids.ana],
    );
    await rodarEEntregar();
    carteiro.enviados.length = 0;
    await cuidarDasAprovacoesNoWhatsapp(opcoes, empresaId);
    expect(carteiro.enviados).toEqual([
      expect.objectContaining({
        para: ANA,
        modelo: { nome: "aviso_do_mago_os", valores: ["Ana", expect.stringMatching(/pede a sua aprovação/)] },
      }),
    ]);
  });

  it("avisos: dentro da janela como texto; fora, pelo modelo, no máximo 10 por dia; o tipo desligado não vai", async () => {
    const criar = (texto: string, tipo: "mencao" | "comentario" = "mencao") =>
      comEmpresa(poolApp, empresaId, (c) =>
        criarAviso(c, { pessoaId: ids.flora as string, tipo, texto, link: "/tarefas" }),
      );
    await criar("Ana chamou você na tarefa X");
    await avisarNoWhatsapp(opcoes, empresaId);
    expect(carteiro.enviados.at(-1)).toMatchObject({
      para: FLORA,
      texto: `Ana chamou você na tarefa X\n\n${SITE}/tarefas`,
    });
    // O comentário não é urgente: por padrão não vai.
    await criar("Um comentário", "comentario");
    const antes = carteiro.enviados.length;
    await avisarNoWhatsapp(opcoes, empresaId);
    expect(carteiro.enviados.length).toBe(antes);
    // Fora da janela: modelo, até 10 por dia.
    await dono.query(
      "update vinculos_do_whatsapp set ultima_mensagem_em = now() - interval '25 hours' where pessoa_id = $1",
      [ids.flora],
    );
    for (let i = 0; i < 12; i++) await criar(`Menção ${i}`);
    await avisarNoWhatsapp(opcoes, empresaId);
    const modelos = carteiro.enviados.filter((e) => e.modelo && e.para === FLORA);
    expect(modelos).toHaveLength(10);
    expect(modelos[0]?.modelo).toEqual({
      nome: "aviso_do_mago_os",
      valores: ["Flora", expect.stringMatching(/^Menção \d+$/)],
    });
  });

  it("fora da janela, a tarefa nova e o prazo vão pelos modelos próprios, com o nome e o título", () => {
    expect(
      modeloDoAviso({ tipo: "tarefa_atribuida", texto: "x", titulo: "Revisar o contrato" }, "Bruno"),
    ).toEqual({
      nome: "tarefa_atribuida",
      valores: ["Bruno", "Revisar o contrato"],
    });
    expect(modeloDoAviso({ tipo: "prazo_vencido", texto: "x", titulo: "Enviar a proposta" }, "Ana")).toEqual({
      nome: "lembrete_de_tarefa",
      valores: ["Ana", "Enviar a proposta"],
    });
    expect(modeloDoAviso({ tipo: "mencao", texto: "Chamaram você", titulo: null }, "Ana")).toEqual({
      nome: "aviso_do_mago_os",
      valores: ["Ana", "Chamaram você"],
    });
  });

  it("o resumo do dia vai só dentro da janela", async () => {
    await dono.query(
      "update vinculos_do_whatsapp set ultima_mensagem_em = now(), resumo_do_dia_em = null where pessoa_id = $1",
      [ids.ana],
    );
    await dono.query("update vinculos_do_whatsapp set resumo_do_dia_em = null where pessoa_id = $1", [
      ids.flora,
    ]);
    const tarde = new Date();
    tarde.setUTCHours(11, 30, 0, 0);
    await resumoDoDiaNoWhatsapp(opcoes, empresaId, tarde);
    const resumos = carteiro.enviados.filter((e) => (e.texto ?? "").startsWith("Resumo do dia"));
    expect(resumos.map((r) => r.para)).toEqual([ANA]);
  });

  it("sair desvincula; e outra pessoa não vê o vínculo", async () => {
    await mandar(FLORA, "sair");
    expect(doNumero(FLORA).at(-1)).toBe("Pronto, este WhatsApp não está mais ligado ao Mago OS.");
    expect(
      (await dono.query("select 1 from vinculos_do_whatsapp where pessoa_id = $1", [ids.flora])).rowCount,
    ).toBe(0);
    const f = await pedir("GET", "/conta/whatsapp", await como("flora@teste.invalid"));
    expect(f.json().vinculo).toBeNull();
  });
});
