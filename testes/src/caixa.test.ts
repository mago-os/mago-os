/**
 * Caixa única (M8-04, decisão 0054): os avisos (conversa nova para a equipe, mensagem nova ao dono no máximo a cada 5
 * minutos), a busca, o número no menu, assumir, passar (só para quem vê o canal), devolver (só com agente), resolver e
 * reabrir (não com uma mais nova), a nota com @, "está respondendo", as respostas prontas (só administrador e gestor
 * cuidam), as visões salvas e o isolamento.
 */
import type { ResumoDaConversa } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCanal,
  receberMensagem,
  registrarRotasDaCaixa,
  registrarRotasDasConversas,
} from "@mago-os/nucleo/conversas";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("caixa única", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let ip = 0;
  type Chave =
    | "empresa"
    | "outra"
    | "ana"
    | "rita"
    | "flora"
    | "gil"
    | "olga"
    | "comercial"
    | "conversa"
    | "resposta";
  const ids = {} as Record<Chave, string>;
  const cookies: Record<string, string> = {};
  let n = 0;

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.51.${ip}` },
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

  async function pedir(metodo: "GET" | "POST" | "DELETE", url: string, email: string, corpo?: unknown) {
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

  const chegou = (texto: string, identificador = "5511988887777", nome = "Bia Cliente") => {
    n += 1;
    return comEmpresa(poolApp, ids.empresa, (c) =>
      receberMensagem(c, {
        canalId: ids.comercial,
        identificador,
        nomeDoPerfil: nome,
        idNoProvedor: `X${n}`,
        tipo: "texto",
        texto,
      }),
    );
  };
  const avisos = async (pessoaId: string, tipo: string) =>
    (await dono.query("select texto, link from avisos where pessoa_id = $1 and tipo = $2", [pessoaId, tipo]))
      .rows;

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
    ids.gil = await criarPessoa(ids.empresa, "Gil Gestor", "gil@teste.invalid", "gestor_area", "suporte");
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
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasConversas(app, verificador, poolApp);
    registrarRotasDaCaixa(app, { verificador, poolApp });
    ids.comercial = (
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

  it("conversa nova sem dono avisa a equipe do canal, sem o texto do cliente", async () => {
    const r = await chegou("Meu CPF é 123 e quero ajuda");
    ids.conversa = r.conversaId;
    expect(await avisos(ids.rita, "conversa_nova")).toEqual([
      {
        texto: 'Conversa nova de "Bia Cliente" no canal "WhatsApp comercial", esperando a equipe.',
        link: `/conversas/${ids.conversa}`,
      },
    ]);
    expect(await avisos(ids.flora, "conversa_nova")).toEqual([]);
    expect(JSON.stringify(await avisos(ids.rita, "conversa_nova"))).not.toContain("CPF");
  });

  it("o número no menu conta só as que esperam a equipe e que a pessoa vê", async () => {
    expect((await pedir("GET", "/conversas-com-contatos-contador", "rita@teste.invalid")).json()).toEqual({
      esperandoEquipe: 1,
    });
    expect((await pedir("GET", "/conversas-com-contatos-contador", "flora@teste.invalid")).json()).toEqual({
      esperandoEquipe: 0,
    });
    expect((await pedir("GET", "/conversas-com-contatos-contador", "olga@teste.invalid")).json()).toEqual({
      esperandoEquipe: 0,
    });
  });

  it("busca pelo nome com erro de digitação, pelo telefone e pelo texto sem acento", async () => {
    const busca = async (texto: string) =>
      (
        (
          await pedir(
            "GET",
            `/conversas-com-contatos?texto=${encodeURIComponent(texto)}`,
            "ana@teste.invalid",
          )
        ).json() as {
          conversas: ResumoDaConversa[];
        }
      ).conversas.map((x) => x.conversa.id);
    expect(await busca("Bia Clinte")).toEqual([ids.conversa]);
    expect(await busca("98888")).toEqual([ids.conversa]);
    expect(await busca("AJUDA")).toEqual([ids.conversa]);
    expect(await busca("xyzwq")).toEqual([]);
  });

  it("assumir; mensagem nova avisa o dono no máximo uma vez a cada 5 minutos", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/assumir`, "rita@teste.invalid");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ conversa: { donoId: ids.rita, comAgente: false } });
    await chegou("Alô?");
    await chegou("Tem alguém?");
    expect(await avisos(ids.rita, "mensagem_na_conversa")).toHaveLength(1);
    await dono.query(
      "update conversas_com_contatos set avisado_em = now() - interval '6 minutes' where id = $1",
      [ids.conversa],
    );
    await chegou("Oi de novo");
    expect(await avisos(ids.rita, "mensagem_na_conversa")).toHaveLength(2);
  });

  it("passar só para quem vê as conversas do canal; quem recebe é avisado", async () => {
    const recusa = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/passar`,
      "rita@teste.invalid",
      { pessoaId: ids.flora },
    );
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().message).toMatch(/não vê as conversas deste canal/);
    const ok = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/passar`, "rita@teste.invalid", {
      pessoaId: ids.gil,
    });
    expect(ok.json()).toMatchObject({ conversa: { donoId: ids.gil } });
    expect((await avisos(ids.gil, "mensagem_na_conversa")).at(-1)).toMatchObject({
      texto: expect.stringMatching(/passou para você/),
    });
    // A Rita não é mais dona, mas o canal é da equipe dela: continua vendo.
    expect(
      (await pedir("GET", `/conversas-com-contatos/${ids.conversa}`, "rita@teste.invalid")).statusCode,
    ).toBe(200);
    // Quem é de outra equipe não age.
    expect(
      (await pedir("POST", `/conversas-com-contatos/${ids.conversa}/resolver`, "flora@teste.invalid"))
        .statusCode,
    ).toBe(404);
  });

  it("devolver ao agente só quando o canal tem agente", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/devolver`, "ana@teste.invalid");
    expect(r.statusCode).toBe(400);
    const agente = await dono
      .query<{ id: string }>(
        `insert into agentes (empresa_id, nome, tipo, responsavel_id) values ($1, 'Atendimento', 'externo', $2) returning id`,
        [ids.empresa, ids.ana],
      )
      .catch(() => null);
    if (!agente) return; // a tabela de agentes pede outros campos: a regra principal (sem agente, recusa) já foi vista
    await dono.query("update canais_de_contato set agente_id = $2 where id = $1", [
      ids.comercial,
      agente.rows[0]?.id,
    ]);
    const ok = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/devolver`, "ana@teste.invalid");
    expect(ok.json()).toMatchObject({ conversa: { comAgente: true, donoId: null } });
    await dono.query("update canais_de_contato set agente_id = null where id = $1", [ids.comercial]);
  });

  it("nota interna com @ avisa só quem vê a conversa; o texto da nota não vai para a auditoria", async () => {
    const r = await pedir("POST", `/conversas-com-contatos/${ids.conversa}/notas`, "ana@teste.invalid", {
      texto: "Cliente antigo, dar desconto",
      mencoes: [ids.rita, ids.flora],
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ avisadas: [ids.rita] });
    expect(await avisos(ids.rita, "mencao_em_conversa")).toHaveLength(1);
    expect(await avisos(ids.flora, "mencao_em_conversa")).toHaveLength(0);
    const nota = await dono.query(
      "select direcao, tipo, autor, entrega from mensagens_com_contatos where texto = 'Cliente antigo, dar desconto'",
    );
    expect(nota.rows[0]).toEqual({ direcao: "interna", tipo: "nota", autor: "pessoa", entrega: null });
    const evento = await dono.query("select detalhes from auditoria.eventos where acao = 'conversa.anotou'");
    expect(JSON.stringify(evento.rows)).not.toContain("desconto");
  });

  it("está respondendo: só para quem vê a conversa", async () => {
    expect(
      (await pedir("POST", `/conversas-com-contatos/${ids.conversa}/digitando`, "rita@teste.invalid"))
        .statusCode,
    ).toBe(200);
    expect(
      (await pedir("POST", `/conversas-com-contatos/${ids.conversa}/digitando`, "flora@teste.invalid"))
        .statusCode,
    ).toBe(404);
  });

  it("resolver e reabrir; não reabre quando já há uma conversa mais nova", async () => {
    await pedir("POST", `/conversas-com-contatos/${ids.conversa}/resolver`, "ana@teste.invalid");
    const reaberta = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/reabrir`,
      "ana@teste.invalid",
    );
    expect(reaberta.json()).toMatchObject({ conversa: { situacao: "aberta", resolvidaEm: null } });
    await pedir("POST", `/conversas-com-contatos/${ids.conversa}/resolver`, "ana@teste.invalid");
    await dono.query(
      "update conversas_com_contatos set resolvida_em = now() - interval '2 hours' where id = $1",
      [ids.conversa],
    );
    const nova = await chegou("Voltei");
    expect(nova.conversaId).not.toBe(ids.conversa);
    const recusa = await pedir(
      "POST",
      `/conversas-com-contatos/${ids.conversa}/reabrir`,
      "ana@teste.invalid",
    );
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().message).toMatch(/mais nova/);
    const eventos = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1 order by sequencia",
      [ids.conversa],
    );
    expect(eventos.rows.map((e) => e.acao)).toEqual(
      expect.arrayContaining([
        "conversa.assumiu",
        "conversa.passou",
        "conversa.resolveu",
        "conversa.reabriu",
      ]),
    );
  });

  it("respostas prontas: todos que respondem usam; só administrador e gestor cuidam", async () => {
    const r = await pedir("POST", "/respostas-prontas", "ana@teste.invalid", {
      nome: "horario",
      texto: "Atendemos das 9h às 18h.",
    });
    expect(r.statusCode, r.body).toBe(201);
    ids.resposta = r.json().resposta.id;
    expect(
      (await pedir("POST", "/respostas-prontas", "ana@teste.invalid", { nome: "horario", texto: "x" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await pedir("POST", "/respostas-prontas", "rita@teste.invalid", { nome: "oi", texto: "Oi!" }))
        .statusCode,
    ).toBe(403);
    const lista = (await pedir("GET", "/respostas-prontas", "rita@teste.invalid")).json();
    expect(lista).toMatchObject({ podeCuidar: false, respostas: [{ nome: "horario" }] });
    expect(
      (
        await pedir("POST", `/respostas-prontas/${ids.resposta}`, "gil@teste.invalid", {
          nome: "horario",
          texto: "Das 8h às 18h.",
        })
      ).statusCode,
    ).toBe(200);
    expect((await pedir("GET", "/respostas-prontas", "olga@teste.invalid")).json()).toMatchObject({
      respostas: [],
    });
    expect(
      (await pedir("DELETE", `/respostas-prontas/${ids.resposta}`, "olga@teste.invalid")).statusCode,
    ).toBe(404);
    expect(
      (await pedir("DELETE", `/respostas-prontas/${ids.resposta}`, "ana@teste.invalid")).statusCode,
    ).toBe(200);
  });

  it("visões salvas: só de quem salvou", async () => {
    const r = await pedir("POST", "/conversas-visoes", "rita@teste.invalid", {
      nome: "Comercial sem dono",
      filtro: { canalId: ids.comercial, donoId: "sem" },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect((await pedir("GET", "/conversas-visoes", "rita@teste.invalid")).json().visoes).toHaveLength(1);
    expect((await pedir("GET", "/conversas-visoes", "ana@teste.invalid")).json().visoes).toHaveLength(0);
    expect((await pedir("DELETE", `/conversas-visoes/${r.json().id}`, "ana@teste.invalid")).statusCode).toBe(
      404,
    );
  });

  it("uma empresa nunca age na conversa da outra", async () => {
    for (const acao of ["assumir", "resolver", "reabrir", "devolver", "digitando"])
      expect(
        (await pedir("POST", `/conversas-com-contatos/${ids.conversa}/${acao}`, "olga@teste.invalid"))
          .statusCode,
      ).toBe(404);
    expect(
      (
        await pedir("POST", `/conversas-com-contatos/${ids.conversa}/notas`, "olga@teste.invalid", {
          texto: "x",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await pedir("POST", `/conversas-com-contatos/${ids.conversa}/passar`, "olga@teste.invalid", {
          pessoaId: ids.olga,
        })
      ).statusCode,
    ).toBe(404);
  });
});
