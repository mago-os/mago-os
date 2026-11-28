/**
 * Áudio nas conversas (M8-08, decisão 0058), com a Evolution falsa e o transcritor falso: o áudio que chega vai para a
 * transcrição pela conta de IA que a empresa escolheu (só compatível com OpenAI, por chave de API); a transcrição fica
 * na mensagem, entra no gasto do mês por minuto e o agente do canal atende lendo a transcrição; sem conta, longa
 * demais, no teto ou com falha, a conversa vai para as pessoas; "transcrever de novo"; a voz gravada na caixa sai
 * como mensagem de voz do WhatsApp; o cabeçalho deixa o microfone só no próprio Mago OS; e o isolamento.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MensagemDaConversa } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { antivirusDeTeste } from "@mago-os/nucleo/anexos/antivirus";
import { criarDepositoEmDisco } from "@mago-os/nucleo/anexos/deposito";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { criarCofre, transcritorFalso } from "@mago-os/nucleo/contas-de-ia";
import {
  CABECALHO_DO_SEGREDO,
  type EvolutionFalsa,
  enviarPendente,
  evolutionFalsa,
  nomeDaInstancia,
  partesDoAtendimento,
  registrarRotasDasConversas,
  registrarRotasDoEnvio,
  registrarRotasDosCanais,
  transcreverMensagem,
  tratarAvisoDaEvolution,
} from "@mago-os/nucleo/conversas";
import { registrarRotasDosCustos } from "@mago-os/nucleo/custos";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CABECALHOS_DE_SEGURANCA } from "../../telas/cabecalhos-de-seguranca.ts";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-dos-avisos-do-audio-no-teste-32chars";
const SILENCIO = { info() {}, warn() {}, error() {} };
const AUDIO = Buffer.from("OggS áudio de teste do cliente").toString("base64");

describe.skipIf(!bancoDisponivel)("áudio nas conversas", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let falsa: EvolutionFalsa;
  let arquivos: { deposito: ReturnType<typeof criarDepositoEmDisco>; antivirus: typeof antivirusDeTeste };
  const filaDeEnvio: { empresaId: string; mensagemId: string }[] = [];
  const filaDaTranscricao: { empresaId: string; mensagemId: string }[] = [];
  const filaDoAgente: string[] = [];
  let ip = 0;
  type Chave =
    | "empresa"
    | "outra"
    | "ana"
    | "olga"
    | "canal"
    | "canalDaOutra"
    | "conversa"
    | "conta"
    | "agente";
  const ids = {} as Record<Chave, string>;
  const cookies: Record<string, string> = {};
  let n = 0;
  const cofre = criarCofre({ atual: { versao: 1, chave: randomBytes(32) }, anteriores: [] });
  let respostaDoTranscritor: string | Error = "Oi, vocês têm a peça 42?";
  const transcritor = transcritorFalso(() => respostaDoTranscritor);

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.56.${ip}` },
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

  /** Um áudio do contato no canal da 4xpert, com a duração que o WhatsApp informa. */
  const chegouAudio = async (segundos = 12) => {
    const id = `C${n + 1}`;
    falsa.arquivos.set(id, { base64: AUDIO, mime: "audio/ogg; codecs=opus" });
    await chegou({ audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: segundos } });
    const m = await dono.query<{ id: string; conversa_id: string }>(
      "select id, conversa_id from mensagens_com_contatos where id_no_provedor = $1",
      [id],
    );
    return m.rows[0] as { id: string; conversa_id: string };
  };

  /** Roda a próxima transcrição da fila (como a fila conversas-transcricao). */
  const transcreverDaFila = async (automatica = true) => {
    const t = filaDaTranscricao.shift();
    if (!t) throw new Error("fila de transcrição vazia");
    return transcreverMensagem(
      {
        poolApp,
        arquivos,
        cofre,
        transcritor,
        atendimento: {
          poolApp,
          acordar: (_e, execucaoId) => filaDoAgente.push(execucaoId),
          enviar: async () => {},
        },
        log: SILENCIO,
      },
      t.empresaId,
      t.mensagemId,
      automatica,
    );
  };

  const mensagens = async () =>
    (await pedir("GET", `/conversas-com-contatos/${ids.conversa}`, "ana@teste.invalid")).json() as {
      mensagens: MensagemDaConversa[];
      conversa: { comAgente: boolean };
    };

  const opcoes = () => ({
    poolApp,
    evolution: falsa,
    arquivos,
    log: SILENCIO,
    transcrever: async (empresaId: string, mensagemId: string) => {
      filaDaTranscricao.push({ empresaId, mensagemId });
    },
  });

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
      deposito: criarDepositoEmDisco(SITE, await mkdtemp(join(tmpdir(), "audio-"))),
      antivirus: antivirusDeTeste,
    };
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasConversas(app, verificador, poolApp);
    registrarRotasDosCustos(app, verificador, poolApp);
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
      transcreverDeNovo: async (empresaId, mensagemId) => {
        filaDaTranscricao.push({ empresaId, mensagemId });
      },
    });
    for (const [empresa, email, numero] of [
      [ids.empresa, "ana@teste.invalid", "+5511900003333"],
      [ids.outra, "olga@teste.invalid", "+5511900004444"],
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
    // A conta compatível com OpenAI (gravada com a chave cifrada, como a tela faria depois do teste do provedor).
    ids.conta = await comEmpresa(poolApp, ids.empresa, async (c) => {
      const id = crypto.randomUUID();
      const cifrada = await cofre.guardarChaveDeIa(c, ids.empresa, id, "sk-chave-da-transcricao-0001");
      await c.query(
        `insert into contas_de_ia (id, empresa_id, nome, provedor, credencial, endereco, chave_cifrada, final_da_chave,
                                   criada_por)
         values ($1, empresa_ativa(), 'OpenAI', 'compativel_openai', 'chave_de_api', 'https://api.openai.invalid/v1',
                 $2, '0001', $3)`,
        [id, cifrada, ids.ana],
      );
      return id;
    });
    ids.agente = (
      await dono.query<{ id: string }>(
        `insert into agentes (empresa_id, nome, tipo, papel, responsavel_id, situacao)
         values ($1, 'Atendimento', 'interno', 'atendimento', $2, 'ativo') returning id`,
        [ids.empresa, ids.ana],
      )
    ).rows[0]?.id as string;
    await dono.query(
      'update canais_de_contato set agente_id = $2, modo = \'sugere\', horario = \'{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"23:59"}\' where id = $1',
      [ids.canal, ids.agente],
    );
  });

  afterAll(async () => {
    await app?.close();
    await poolApp?.end();
    await poolAcesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("sem conta de transcrição, o áudio fica sem transcrição e a conversa vai para as pessoas", async () => {
    const m = await chegouAudio();
    ids.conversa = m.conversa_id;
    expect(filaDaTranscricao).toHaveLength(1);
    expect(filaDoAgente).toHaveLength(0);
    expect(await transcreverDaFila()).toBe("sem_conta");
    const c = await mensagens();
    expect(c.mensagens.at(-1)).toMatchObject({
      tipo: "audio",
      transcricao: { situacao: "sem_conta", texto: null },
    });
    expect(c.conversa.comAgente).toBe(false);
    const aviso = await dono.query(
      "select texto from avisos where tipo = 'conversa_nova' and texto like '%áudio%'",
    );
    expect(aviso.rowCount).toBeGreaterThan(0);
    expect(transcritor.pedidos).toHaveLength(0);
  });

  it("só a conta compatível com OpenAI por chave transcreve; uma por empresa", async () => {
    const r = await pedir("POST", `/ia/contas/${ids.conta}/transcricao`, "ana@teste.invalid", {
      modelo: "gpt-4o-mini-transcribe",
    });
    expect(r.statusCode, r.body).toBe(200);
    const anthropic = await comEmpresa(poolApp, ids.empresa, async (c) => {
      const id = crypto.randomUUID();
      const cifrada = await cofre.guardarChaveDeIa(c, ids.empresa, id, "sk-ant-api03-outra");
      await c.query(
        `insert into contas_de_ia (id, empresa_id, nome, provedor, credencial, chave_cifrada, final_da_chave, criada_por)
         values ($1, empresa_ativa(), 'Anthropic', 'anthropic', 'chave_de_api', $2, 'utra', $3)`,
        [id, cifrada, ids.ana],
      );
      return id;
    });
    const recusada = await pedir("POST", `/ia/contas/${anthropic}/transcricao`, "ana@teste.invalid", {
      modelo: "whisper-1",
    });
    expect(recusada.statusCode).toBe(400);
    expect(recusada.json().code).toBe("NAO_TRANSCREVE");
    expect(
      (await pedir("POST", `/ia/contas/${ids.conta}/transcricao`, "olga@teste.invalid", { modelo: "x" }))
        .statusCode,
    ).toBe(404);
  });

  it("com a conta: transcreve, guarda na mensagem, entra no gasto do mês e o agente atende lendo a transcrição", async () => {
    // O canal volta para o agente (a conversa anterior foi para as pessoas).
    await dono.query("update conversas_com_contatos set com_agente = true where id = $1", [ids.conversa]);
    const m = await chegouAudio(30);
    expect(await transcreverDaFila()).toBe("pronta");
    const pedido = transcritor.pedidos.at(-1);
    expect(pedido).toMatchObject({
      endereco: "https://api.openai.invalid/v1",
      chave: "sk-chave-da-transcricao-0001",
      modelo: "gpt-4o-mini-transcribe",
    });
    expect(pedido?.dados.toString("base64")).toBe(AUDIO);
    const c = await mensagens();
    expect(c.mensagens.find((x) => x.id === m.id)?.transcricao).toEqual({
      situacao: "pronta",
      texto: "Oi, vocês têm a peça 42?",
    });
    // O custo: 30 segundos a US$ 0,003 por minuto = 1.500 microdólares, sem agente nenhum na conta das chamadas.
    const consumo = await dono.query<{
      custo_micros: string;
      segundos: number;
      tipo: string;
      agente_id: string;
    }>("select custo_micros, segundos, tipo, agente_id from consumo_de_ia where tipo = 'transcricao'");
    expect(consumo.rows[0]).toMatchObject({ custo_micros: "1500", segundos: 30, agente_id: ids.agente });
    const custos = await pedir("GET", "/custos", "ana@teste.invalid");
    expect(custos.json().transcricao).toEqual({ custo: 1500, tokens: 0 });
    // O agente foi chamado e lê a transcrição como dado de fora.
    expect(filaDoAgente).toHaveLength(1);
    const partes = await comEmpresa(poolApp, ids.empresa, (k) => partesDoAtendimento(k, ids.conversa));
    expect(partes[0]?.texto).toMatch(
      /<conteudo_externo>[\s\S]*\(áudio do cliente, transcrito\) Oi, vocês têm a peça 42\?/,
    );
  });

  it("longa demais, no teto e com falha: sem transcrição; transcrever de novo pela caixa", async () => {
    const longa = await chegouAudio(601);
    expect(await transcreverDaFila()).toBe("longa_demais");
    expect((await mensagens()).mensagens.find((x) => x.id === longa.id)?.transcricao?.situacao).toBe(
      "longa_demais",
    );

    respostaDoTranscritor = new Error("o provedor caiu");
    const falhou = await chegouAudio(5);
    expect(await transcreverDaFila()).toBe("falhou");
    // De novo, pela caixa: agora o provedor responde; só a transcrição muda (o agente não é chamado de novo).
    respostaDoTranscritor = "Agora deu";
    const agentesAntes = filaDoAgente.length;
    const r = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/mensagens/${falhou.id}/transcrever`,
      "ana@teste.invalid",
    );
    expect(r.statusCode, r.body).toBe(202);
    expect(await transcreverDaFila(false)).toBe("pronta");
    expect((await mensagens()).mensagens.find((x) => x.id === falhou.id)?.transcricao).toEqual({
      situacao: "pronta",
      texto: "Agora deu",
    });
    expect(filaDoAgente.length).toBe(agentesAntes);
    // A outra empresa não pede.
    expect(
      (
        await pedir(
          "POST",
          `/conversas-com-contatos/${ids.conversa}/mensagens/${falhou.id}/transcrever`,
          "olga@teste.invalid",
        )
      ).statusCode,
    ).toBe(404);

    // No teto: a empresa com teto zero não transcreve.
    await pedir("POST", "/custos/tetos/empresa", "ana@teste.invalid", { teto: 0 });
    const noTeto = await chegouAudio(5);
    expect(await transcreverDaFila()).toBe("no_teto");
    expect((await mensagens()).mensagens.find((x) => x.id === noTeto.id)?.transcricao?.situacao).toBe(
      "no_teto",
    );
    await pedir("POST", "/custos/tetos/empresa", "ana@teste.invalid", { teto: null });
  });

  it("a voz gravada na caixa sai como mensagem de voz do WhatsApp", async () => {
    await pedir("POST", `/conversas-com-contatos/${ids.conversa}/assumir`, "ana@teste.invalid");
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/mensagens`, "ana@teste.invalid", {
      voz: true,
      arquivo: { nome: "voz.webm", tipo: "audio/webm", base64: AUDIO },
    });
    expect(r.statusCode, r.body).toBe(201);
    const mensagemId = r.json().mensagemId as string;
    const envio = filaDeEnvio.find((f) => f.mensagemId === mensagemId);
    expect(envio).toBeTruthy();
    await enviarPendente({ poolApp, evolution: falsa, arquivos, log: SILENCIO }, ids.empresa, mensagemId);
    expect(falsa.enviadas.at(-1)).toMatchObject({ voz: true, para: "5511988887777" });
    const m = (await mensagens()).mensagens.find((x) => x.id === mensagemId);
    expect(m).toMatchObject({ tipo: "audio", direcao: "saiu", entrega: "enviada", transcricao: null });
    // Voz que não é áudio, ou grande demais, não sai.
    const errada = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/mensagens`,
      "ana@teste.invalid",
      {
        voz: true,
        arquivo: { nome: "x.pdf", tipo: "application/pdf", base64: AUDIO },
      },
    );
    expect(errada.statusCode).toBe(400);
  });

  it("o microfone fica liberado só no próprio Mago OS; a câmera e a localização, nunca", () => {
    const p = CABECALHOS_DE_SEGURANCA["Permissions-Policy"];
    expect(p).toContain("microphone=(self)");
    expect(p).toContain("camera=()");
    expect(p).toContain("geolocation=()");
  });
});
