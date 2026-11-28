/**
 * Passagem da conversa para uma pessoa (M8-06, decisão 0056), com o modelo falso: os sinais do sistema (pediu uma
 * pessoa, assunto do canal, pergunta repetida, 15 respostas seguidas) e o do agente (passar_para_uma_pessoa); a
 * mensagem de passagem ao contato, o motivo e o resumo na conversa, o aviso ao responsável pelo contato ou à equipe
 * (sem o texto do cliente) e na central de prioridades; o prazo e o escalonamento ao gestor (uma vez, e só no
 * horário); o silêncio do agente (só sugestões, que saem pela pessoa); devolver ao agente; reabrir fica com quem
 * reabriu; e o isolamento entre empresas.
 */
import { randomBytes } from "node:crypto";
import type { ConversaComContato, SugestaoDeResposta } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import { type OpcoesDoMotor, rodarExecucao } from "@mago-os/nucleo/agentes-internos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCofre,
  modelosFalsos,
  type PedidoAoModelo,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import {
  criarCanal,
  cuidarDasPassagensVencidas,
  pedirAoAtendente,
  receberMensagem,
  registrarRotasDaCaixa,
  registrarRotasDasConversas,
  registrarRotasDoEnvio,
  registrarRotasDosCanais,
} from "@mago-os/nucleo/conversas";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { listarPrioridades } from "@mago-os/nucleo/tarefas/prioridades";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const CHAVE = "sk-ant-api03-chave-da-passagem-Pa01";
const SEMPRE = { dias: [1, 2, 3, 4, 5, 6, 7], inicio: "00:00", fim: "23:59" };

describe.skipIf(!bancoDisponivel)("passagem da conversa para uma pessoa", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let motor: OpcoesDoMotor;
  let ip = 0;
  let n = 0;
  type Chave = "empresa" | "outra" | "ana" | "rita" | "gil" | "olga" | "canal" | "agente" | "conta";
  const ids = {} as Record<Chave, string>;
  const conversas: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  const filaDoAgente: { empresaId: string; execucaoId: string; segundos?: number }[] = [];
  const enviadas: string[] = [];
  let roteiro: Parameters<typeof modelosFalsos>[0] = [];
  const pedidos: PedidoAoModelo[] = [];

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.53.${ip}` },
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

  const atendimento = () => ({
    poolApp,
    acordar: (empresaId: string, execucaoId: string, segundos?: number) =>
      filaDoAgente.push({ empresaId, execucaoId, ...(segundos ? { segundos } : {}) }),
    enviar: async (_e: string, mensagemId: string) => {
      enviadas.push(mensagemId);
    },
  });

  /** O cliente escreve e o agente é chamado (como faz a fila dos avisos da Evolution). */
  const clienteEscreve = async (texto: string, telefone = "5511988887777", nome = "Bia") => {
    n += 1;
    const r = await comEmpresa(poolApp, ids.empresa, (c) =>
      receberMensagem(c, {
        canalId: ids.canal,
        identificador: telefone,
        nomeDoPerfil: nome,
        idNoProvedor: `A${n}`,
        tipo: "texto",
        texto,
      }),
    );
    const pedido = await pedirAoAtendente(atendimento(), ids.empresa, r.conversaId);
    return { ...r, pedido };
  };

  /** Roda a próxima execução da fila (como a fila dos agentes internos). */
  const rodarFila = async () => {
    const e = filaDoAgente.shift();
    if (!e) throw new Error("fila vazia");
    await rodarExecucao(motor, e.empresaId, e.execucaoId);
    return e.execucaoId;
  };

  const responde =
    (texto: string, extra: Record<string, unknown> = {}) =>
    () => ({
      chamadas: [{ id: `r${Math.random()}`, nome: "responder_ao_cliente", entrada: { texto, ...extra } }],
    });

  const conversa = async (id: string) =>
    (await pedir("GET", `/conversas-com-contatos/${id}`, "ana@teste.invalid")).json() as {
      sugestoes: SugestaoDeResposta[];
      mensagens: { autor: string; texto: string | null; direcao: string; autorAgenteId: string | null }[];
      conversa: ConversaComContato;
    };

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
    ids.gil = await criarPessoa(ids.empresa, "Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    ids.olga = await criarPessoa(ids.outra, "Olga Outra", "olga@teste.invalid", "administrador", null);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const carteiro = { async enviarLinkDeSenha() {}, async enviarAparelhoNovo() {} };
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
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    const cofre = criarCofre({ atual: { versao: 1, chave: randomBytes(32) }, anteriores: [] });
    registrarRotasDosAgentes(app, {
      verificador,
      poolApp,
      carteiro,
      urlPublica: SITE,
      acordar: () => {},
    } as Parameters<typeof registrarRotasDosAgentes>[1]);
    registrarRotasDasContasDeIa(app, {
      verificador,
      poolApp,
      cofre,
      provedores: provedoresFalsos({ [CHAVE]: ["modelo-bom"] }),
      ambiente: "teste",
    });
    registrarRotasDasConversas(app, verificador, poolApp);
    registrarRotasDaCaixa(app, { verificador, poolApp });
    registrarRotasDosCanais(app, { verificador, poolApp, evolution: null, receber: async () => {} });
    registrarRotasDoEnvio(app, {
      verificador,
      poolApp,
      arquivos: null,
      enfileirar: async (_e, mensagemId) => {
        enviadas.push(mensagemId);
      },
    });
    motor = {
      poolApp,
      cofre,
      modelos: {
        conversar: async (a, p) => {
          pedidos.push(structuredClone(p));
          const passo = roteiro.shift();
          return modelosFalsos(passo ? [passo] : []).conversar(a, p);
        },
      },
      catalogo: catalogoDeModulos(),
      opcoesMcp: {
        poolApp,
        carteiro,
        urlPublica: SITE,
        log: app.log,
        origem: { canal: "sistema", ip: null, aparelho: null },
      },
      log: { error: () => {}, warn: () => {} },
      acordar: () => {},
      enviarAoContato: async (_e, mensagemId) => {
        enviadas.push(mensagemId);
      },
    };

    ids.canal = (
      await comEmpresa(poolApp, ids.empresa, (c) =>
        criarCanal(c, ids.ana, { nome: "WhatsApp comercial", provedor: "evolution", area: "comercial" }),
      )
    ).id;
  });

  afterAll(async () => {
    await app?.close();
    await poolApp?.end();
    await poolAcesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const passa = (motivo: string, resumo: string, sugestao?: string) => () => ({
    chamadas: [
      {
        id: `p${Math.random()}`,
        nome: "passar_para_uma_pessoa",
        entrada: { motivo, resumo, ...(sugestao ? { sugestao } : {}) },
      },
    ],
  });

  const saidas = async (conversaId: string) =>
    (await conversa(conversaId)).mensagens.filter((m) => m.direcao === "saiu").map((m) => m.texto);

  const avisosDe = async (tipo: string, conversaId: string) =>
    (
      await dono.query<{ pessoa_id: string; texto: string }>(
        "select pessoa_id, texto from avisos where tipo = $1 and link = $2 order by pessoa_id",
        [tipo, `/conversas/${conversaId}`],
      )
    ).rows;

  it("prepara o canal com o agente, no modo sozinho, com o assunto desconto", async () => {
    ids.agente = (await pedir("POST", `/canais/${ids.canal}/atendente`, "ana@teste.invalid")).json().agenteId;
    ids.conta = (
      await pedir("POST", "/ia/contas", "ana@teste.invalid", {
        nome: "Principal",
        provedor: "anthropic",
        chave: CHAVE,
      })
    ).json().id;
    await pedir("POST", `/ia/contas/${ids.conta}/modelos`, "ana@teste.invalid", {
      modelos: [{ modelo: "modelo-bom", liberado: true }],
    });
    await pedir("POST", `/agentes/${ids.agente}/modelos`, "ana@teste.invalid", {
      modelos: { principal: { contaId: ids.conta, modelo: "modelo-bom" }, reserva: null },
    });
    expect((await pedir("POST", `/agentes/${ids.agente}/retomar`, "ana@teste.invalid", {})).statusCode).toBe(
      200,
    );
    const r = await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", {
      horario: SEMPRE,
      modo: "sozinho",
      assuntosParaPessoas: ["Desconto", " desconto ", "jurídico"],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().canal).toMatchObject({
      assuntosParaPessoas: ["Desconto", "desconto", "jurídico"],
      prazoParaAssumir: 10,
      sugerirComPessoa: true,
      mensagemDePassagem: expect.stringMatching(/pessoa da nossa equipe/),
    });
    // O funcionário não muda o canal.
    expect(
      (await pedir("POST", `/canais/${ids.canal}`, "rita@teste.invalid", { prazoParaAssumir: 5 })).statusCode,
    ).toBe(403);
  });

  it("o contato pede um atendente: passa sem chamar a IA, avisa o contato e a equipe, e o agente só escreve o resumo", async () => {
    const pedidosAntes = pedidos.length;
    const r = await clienteEscreve("Quero falar com um atendente, por favor", "5511900000001", "Ana Cliente");
    expect(r.pedido).toBe("passou");
    expect(pedidos.length).toBe(pedidosAntes);
    expect(await saidas(r.conversaId)).toEqual([expect.stringMatching(/pessoa da nossa equipe/)]);
    const c = (await conversa(r.conversaId)).conversa;
    expect(c).toMatchObject({
      comAgente: false,
      donoId: null,
      situacao: "esperando_equipe",
      passagem: { motivo: "pediu_pessoa", resumo: null, escaladaEm: null },
    });
    // A equipe do canal (a área comercial) é avisada, sem o texto do cliente.
    const avisos = await avisosDe("conversa_precisa_de_pessoa", r.conversaId);
    expect(avisos.map((a) => a.pessoa_id).sort()).toEqual([ids.rita, ids.gil].sort());
    expect(avisos[0]?.texto).toMatch(/pediu para falar com uma pessoa/);
    expect(avisos[0]?.texto).not.toMatch(/por favor/);
    // Na central de prioridades da Rita.
    const central = await comEmpresa(poolApp, ids.empresa, (k) =>
      listarPrioridades(k, {
        tipo: "pessoa",
        pessoaId: ids.rita,
        filtro: { tipo: "meus", pessoaId: ids.rita },
      }),
    );
    expect(central.some((i) => i.link === `/conversas/${r.conversaId}`)).toBe(true);

    // O agente roda uma vez só para o resumo e a sugestão (sem responder ao cliente).
    expect(filaDoAgente.at(-1)?.segundos).toBeUndefined();
    roteiro = [
      () => ({ chamadas: [{ id: "x", nome: "responder_ao_cliente", entrada: { texto: "Não pode sair" } }] }),
      passa(
        "irritado",
        "A cliente quer falar com uma pessoa sobre um pedido.",
        "Olá! Aqui é da equipe, como posso ajudar?",
      ),
    ];
    const execucaoId = await rodarFila();
    expect(
      pedidos
        .at(-1)
        ?.ferramentas.map((f) => f.nome)
        .sort(),
    ).toEqual(["passar_para_uma_pessoa", "ver_ficha_do_cliente"].sort());
    const recusada = await dono.query<{ erro: boolean }>(
      "select erro from passos_de_execucao where execucao_id = $1 and tipo = 'ferramenta' and ferramenta = 'responder_ao_cliente'",
      [execucaoId],
    );
    expect(recusada.rows).toEqual([{ erro: true }]);
    const depois = await conversa(r.conversaId);
    expect(depois.conversa.passagem).toMatchObject({
      motivo: "pediu_pessoa",
      resumo: "A cliente quer falar com uma pessoa sobre um pedido.",
    });
    expect(depois.sugestoes).toEqual([
      expect.objectContaining({ texto: "Olá! Aqui é da equipe, como posso ajudar?" }),
    ]);
    expect(await saidas(r.conversaId)).toHaveLength(1);
    conversas.pediu = r.conversaId;
  });

  it("silêncio: com uma pessoa na conversa, o agente só sugere, e a sugestão sai pela pessoa sem contar autonomia", async () => {
    const id = conversas.pediu as string;
    const r = await clienteEscreve("Alguém pode me responder?", "5511900000001", "Ana Cliente");
    expect(r.conversaId).toBe(id);
    expect(r.pedido).toBe("sugestao");
    roteiro = [
      () => ({
        chamadas: [{ id: "t", nome: "criar_tarefa_para_a_equipe", entrada: { titulo: "Não pode" } }],
      }),
      responde("Já vou ver o seu pedido!"),
    ];
    const execucaoId = await rodarFila();
    expect(
      pedidos
        .at(-1)
        ?.ferramentas.map((f) => f.nome)
        .sort(),
    ).toEqual(["responder_ao_cliente", "ver_ficha_do_cliente"].sort());
    expect(pedidos.at(-1)?.sistema).toMatch(/Uma pessoa da equipe está atendendo/);
    const tarefa = await dono.query<{ erro: boolean }>(
      "select erro from passos_de_execucao where execucao_id = $1 and tipo = 'ferramenta' and ferramenta = 'criar_tarefa_para_a_equipe'",
      [execucaoId],
    );
    expect(tarefa.rows).toEqual([{ erro: true }]);
    expect(await saidas(id)).not.toContain("Já vou ver o seu pedido!");
    const s = (await conversa(id)).sugestoes;
    expect(s).toEqual([expect.objectContaining({ texto: "Já vou ver o seu pedido!" })]);
    const antes = (await dono.query("select sugestoes_sem_edicao from canais_de_contato")).rows[0];
    const envio = await pedir(
      "POST",
      `/conversas-com-contatos/${id}/sugestoes/${s[0]?.id}/enviar`,
      "rita@teste.invalid",
      {},
    );
    expect(envio.statusCode, envio.body).toBe(201);
    expect((await conversa(id)).mensagens.at(-1)).toMatchObject({
      autor: "pessoa",
      texto: "Já vou ver o seu pedido!",
    });
    expect((await dono.query("select sugestoes_sem_edicao from canais_de_contato")).rows[0]).toEqual(antes);

    // O canal desliga as sugestões com uma pessoa: o agente não roda.
    await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", { sugerirComPessoa: false });
    expect((await clienteEscreve("Oi?", "5511900000001", "Ana Cliente")).pedido).toBeNull();
    await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", { sugerirComPessoa: true });
  });

  it("prazo: ninguém assumiu em 10 minutos no horário, o gestor da área é avisado uma vez; fora do horário, espera", async () => {
    const r = await clienteEscreve("Preciso de um humano", "5511900000002", "Beto");
    expect(r.pedido).toBe("passou");
    filaDoAgente.length = 0;
    expect(await cuidarDasPassagensVencidas(poolApp)).toBe(0);
    await dono.query(
      "update conversas_com_contatos set passada_em = now() - interval '11 minutes' where id = $1",
      [r.conversaId],
    );
    // Fora do horário: espera a abertura.
    await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", {
      horario: { dias: [], inicio: "09:00", fim: "18:00" },
    });
    expect(await cuidarDasPassagensVencidas(poolApp)).toBe(0);
    await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", { horario: SEMPRE });
    expect(await cuidarDasPassagensVencidas(poolApp)).toBe(1);
    const avisos = await avisosDe("conversa_passou_do_prazo", r.conversaId);
    expect(avisos.map((a) => a.pessoa_id)).toEqual([ids.gil]);
    expect(avisos[0]?.texto).toMatch(/10 minutos/);
    expect((await conversa(r.conversaId)).conversa.passagem?.escaladaEm).not.toBeNull();
    expect(await cuidarDasPassagensVencidas(poolApp)).toBe(0);

    // Quem assume (ou responde) a tempo não deixa escalar.
    const s = await clienteEscreve("Quero falar com alguém", "5511900000003", "Caio");
    expect(s.pedido).toBe("passou");
    filaDoAgente.length = 0;
    await pedir("POST", `/conversas-com-contatos/${s.conversaId}/assumir`, "rita@teste.invalid");
    await dono.query(
      "update conversas_com_contatos set passada_em = now() - interval '11 minutes' where id = $1",
      [s.conversaId],
    );
    expect(await cuidarDasPassagensVencidas(poolApp)).toBe(0);
    conversas.prazo = r.conversaId;
  });

  it("devolver ao agente: a passagem acaba e o agente volta a responder, lendo o que a equipe disse", async () => {
    const id = conversas.pediu as string;
    const d = await pedir("POST", `/conversas-com-contatos/${id}/devolver`, "rita@teste.invalid");
    expect(d.statusCode, d.body).toBe(200);
    const c = await conversa(id);
    expect(c.conversa).toMatchObject({ comAgente: true, passagem: null });
    expect(c.sugestoes).toEqual([]);
    const r = await clienteEscreve("Certo, e o pedido 99?", "5511900000001", "Ana Cliente");
    expect(r.pedido).toBe("na_fila");
    roteiro = [responde("O pedido 99 sai amanhã.")];
    await rodarFila();
    const parte = pedidos.at(-1)?.partes[0];
    expect(parte?.papel === "usuario" && parte.texto).toMatch(/Já vou ver o seu pedido!/);
    expect(await saidas(id)).toContain("O pedido 99 sai amanhã.");
  });

  it("assunto do canal e pergunta repetida passam sem chamar a IA", async () => {
    const a = await clienteEscreve("Vocês dão DESCONTO no pix?", "5511900000004", "Duda");
    expect(a.pedido).toBe("passou");
    expect((await conversa(a.conversaId)).conversa.passagem?.motivo).toBe("assunto_do_canal");
    filaDoAgente.length = 0;

    const b = await clienteEscreve("Qual o prazo de entrega?", "5511900000005", "Edu");
    expect(b.pedido).toBe("na_fila");
    roteiro = [responde("Depende da cidade.")];
    await rodarFila();
    const de_novo = await clienteEscreve("qual o prazo de entrega", "5511900000005", "Edu");
    expect(de_novo.pedido).toBe("passou");
    expect((await conversa(b.conversaId)).conversa.passagem?.motivo).toBe("repetiu");
    filaDoAgente.length = 0;
  });

  it("15 respostas seguidas do agente: a conversa anda em círculos e passa", async () => {
    let id = "";
    for (let i = 1; i <= 15; i++) {
      const r = await clienteEscreve(`Pergunta número ${i} sobre as peças`, "5511900000006", "Fábio");
      id = r.conversaId;
      expect(r.pedido).toBe("na_fila");
      roteiro = [responde(`Resposta ${i}`)];
      await rodarFila();
    }
    const r = await clienteEscreve("E mais uma pergunta sobre peças", "5511900000006", "Fábio");
    expect(r.pedido).toBe("passou");
    expect((await conversa(id)).conversa.passagem?.motivo).toBe("em_circulos");
    filaDoAgente.length = 0;
  });

  it("o agente passa pela ferramenta: o responsável pelo contato é avisado, não a equipe", async () => {
    const r1 = await clienteEscreve("Oi, boa tarde", "5511900000007", "Gabi");
    roteiro = [responde("Boa tarde! Como posso ajudar?")];
    await rodarFila();
    await dono.query("update contatos set responsavel_id = $2 where id = $1", [r1.contatoId, ids.rita]);
    const r = await clienteEscreve("Isso é um absurdo, já pedi três vezes!", "5511900000007", "Gabi");
    expect(r.pedido).toBe("na_fila");
    roteiro = [passa("irritado", "A Gabi está irritada com a demora.", "Gabi, peço desculpas pela demora.")];
    await rodarFila();
    const c = await conversa(r.conversaId);
    expect(c.conversa).toMatchObject({
      comAgente: false,
      passagem: { motivo: "irritado", resumo: "A Gabi está irritada com a demora." },
    });
    expect(c.sugestoes).toEqual([expect.objectContaining({ texto: "Gabi, peço desculpas pela demora." })]);
    expect((await saidas(r.conversaId)).at(-1)).toMatch(/pessoa da nossa equipe/);
    expect((await avisosDe("conversa_precisa_de_pessoa", r.conversaId)).map((a) => a.pessoa_id)).toEqual([
      ids.rita,
    ]);
  });

  it("reabrir fica com quem reabriu; e outra empresa não vê nem devolve", async () => {
    const id = conversas.prazo as string;
    await pedir("POST", `/conversas-com-contatos/${id}/resolver`, "ana@teste.invalid");
    const re = await pedir("POST", `/conversas-com-contatos/${id}/reabrir`, "ana@teste.invalid");
    expect(re.statusCode, re.body).toBe(200);
    expect((await conversa(id)).conversa).toMatchObject({ donoId: ids.ana, comAgente: false });
    expect((await pedir("GET", `/conversas-com-contatos/${id}`, "olga@teste.invalid")).statusCode).toBe(404);
    expect(
      (await pedir("POST", `/conversas-com-contatos/${id}/devolver`, "olga@teste.invalid")).statusCode,
    ).toBe(404);
  });
});
