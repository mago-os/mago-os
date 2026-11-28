/**
 * O chat no site (M8-07, decisão 0057): o administrador cria o balão (com os domínios e a política de privacidade) e
 * troca a chave; a página do quadro só abre nos domínios do canal (frame-ancestors); a configuração só responde aos
 * domínios do canal; o visitante entra pela prova de trabalho (com o campo escondido e a prova de uso único), escreve
 * com a página (sem o "?" e o "#"), vê só a própria conversa (sem as notas internas) e recebe a resposta da equipe
 * (entregue e lida); os limites; "continuar no WhatsApp" pelo código de uso único; o contato repetido sem juntar; o
 * apagamento das conversas sem contato em 90 dias; e o isolamento entre empresas.
 */
import { createHash } from "node:crypto";
import type { Canal } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  completarCliente,
  criarCanal,
  criarDesafio,
  cuidarDosVisitantesVencidos,
  DIFICULDADE_DO_BALAO,
  partesDoAtendimento,
  receberMensagem,
  registrarRotasDaCaixa,
  registrarRotasDasConversas,
  registrarRotasDoBalao,
  registrarRotasDoEnvio,
  registrarRotasDosCanais,
  usarCodigoDoSite,
} from "@mago-os/nucleo/conversas";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const LOJA = "https://www.loja-do-teste.com.br";

/** Resolve a prova de trabalho como o navegador do visitante. */
function resolver(desafio: string): string {
  for (let n = 0; ; n++) {
    const h = createHash("sha256").update(`${desafio}:${n}`).digest();
    let bits = DIFICULDADE_DO_BALAO;
    let ok = true;
    for (let i = 0; bits > 0; i++) {
      const b = h[i] ?? 0;
      if (bits >= 8) {
        if (b !== 0) ok = false;
        bits -= 8;
      } else {
        if (b >> (8 - bits) !== 0) ok = false;
        bits = 0;
      }
      if (!ok) break;
    }
    if (ok) return String(n);
  }
}

describe.skipIf(!bancoDisponivel)("chat no site", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let ip = 0;
  let enderecoDoVisitante = 0;
  type Chave = "empresa" | "outra" | "ana" | "rita" | "olga" | "canal" | "zap";
  const ids = {} as Record<Chave, string>;
  const cookies: Record<string, string> = {};
  const enviadas: string[] = [];
  let chave = "";

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.54.${ip}` },
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

  /** Um pedido do quadro do balão (sem login), com o endereço de internet do visitante. */
  const balao = (
    metodo: "GET" | "POST",
    caminho: string,
    o: { visitante?: string; corpo?: unknown; origem?: string; endereco?: string } = {},
  ) =>
    app.inject({
      method: metodo,
      url: `/balao/${chave}${caminho}`,
      headers: {
        "x-forwarded-for": o.endereco ?? "203.0.113.10",
        ...(o.visitante ? { "x-visitante": o.visitante } : {}),
        ...(o.origem ? { origin: o.origem } : {}),
        ...(o.corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(o.corpo !== undefined ? { payload: JSON.stringify(o.corpo) } : {}),
    });

  /** Entra como visitante, com um desafio de 3 segundos atrás (o tempo mínimo é 2). */
  const entrar = async (endereco?: string) => {
    enderecoDoVisitante += 1;
    const desafio = criarDesafio(SEGREDO, ids.canal, Date.now() - 3000);
    const r = await balao("POST", "/visitante", {
      corpo: { desafio, resposta: resolver(desafio) },
      endereco: endereco ?? `203.0.113.${100 + enderecoDoVisitante}`,
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json().codigo as string;
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
    ids.rita = await criarPessoa(ids.empresa, "Rita Vendas", "rita@teste.invalid", "funcionario", null);
    ids.olga = await criarPessoa(ids.outra, "Olga Outra", "olga@teste.invalid", "administrador", null);
    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const carteiro = { async enviarLinkDeSenha() {}, async enviarAparelhoNovo() {} };
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: SEGREDO,
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
    registrarRotasDoBalao(app, {
      poolApp,
      segredo: SEGREDO,
      urlPublica: SITE,
      atendimento: { poolApp, acordar: () => {}, enviar: async () => {} },
      log: { warn: () => {}, error: () => {} },
    });
    ids.zap = (
      await comEmpresa(poolApp, ids.empresa, (c) =>
        criarCanal(c, ids.ana, {
          nome: "WhatsApp da loja",
          provedor: "evolution",
          identificador: "+5511944443333",
        }),
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

  it("o administrador cria o balão com os domínios e a política; o funcionário não", async () => {
    const sem = await pedir("POST", "/canais/site", "ana@teste.invalid", { nome: "Chat", dominios: [LOJA] });
    expect(sem.statusCode).toBe(400);
    const funcionario = await pedir("POST", "/canais/site", "rita@teste.invalid", {
      nome: "Chat",
      dominios: [LOJA],
      politicaUrl: `${LOJA}/privacidade`,
    });
    expect(funcionario.statusCode).toBe(403);
    const r = await pedir("POST", "/canais/site", "ana@teste.invalid", {
      nome: "Chat do site",
      dominios: [LOJA],
      politicaUrl: `${LOJA}/privacidade`,
    });
    expect(r.statusCode, r.body).toBe(201);
    const canal = r.json().canal as Canal;
    expect(canal).toMatchObject({
      provedor: "site",
      situacao: "conectado",
      dominios: [LOJA],
      posicao: "direita",
    });
    expect(canal.chavePublica).toMatch(/^[A-Za-z0-9]{22}$/);
    ids.canal = canal.id;
    chave = canal.chavePublica as string;
    // Campos do balão não valem no canal de WhatsApp.
    expect(
      (await pedir("POST", `/canais/${ids.zap}`, "ana@teste.invalid", { cor: "#000000" })).statusCode,
    ).toBe(400);
  });

  it("a página do quadro abre só nos domínios do canal; a configuração só responde a eles", async () => {
    const pagina = await app.inject({ method: "GET", url: `/balao/${chave}` });
    expect(pagina.statusCode).toBe(200);
    expect(pagina.headers["content-security-policy"]).toContain(`frame-ancestors ${LOJA}`);
    expect(pagina.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(pagina.headers["x-frame-options"]).toBeUndefined();
    expect(pagina.body).toContain('<script src="/balao/quadro.js"></script>');
    expect((await app.inject({ method: "GET", url: "/balao/AAAAAAAAAAAAAAAAAAAAAA" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/balao.js" })).headers["content-type"]).toMatch(
      /javascript/,
    );

    const daLoja = await balao("GET", "/configuracao", { origem: LOJA });
    expect(daLoja.statusCode).toBe(200);
    expect(daLoja.headers["access-control-allow-origin"]).toBe(LOJA);
    expect(daLoja.json()).toMatchObject({
      nome: "Chat do site",
      whatsapp: false,
      politicaUrl: `${LOJA}/privacidade`,
    });
    expect((await balao("GET", "/configuracao", { origem: "https://outro-site.com.br" })).statusCode).toBe(
      404,
    );
    // Pedido do quadro vindo de outro site: recusado.
    expect((await balao("GET", "/desafio", { origem: "https://outro-site.com.br" })).statusCode).toBe(404);
    expect((await balao("GET", "/desafio")).json()).toMatchObject({ dificuldade: DIFICULDADE_DO_BALAO });
  });

  it("entrar: a prova certa vale uma vez; o campo escondido, a prova errada e o desafio novo demais não entram", async () => {
    const novo = criarDesafio(SEGREDO, ids.canal);
    expect(
      (await balao("POST", "/visitante", { corpo: { desafio: novo, resposta: resolver(novo) } })).statusCode,
    ).toBe(400);
    const desafio = criarDesafio(SEGREDO, ids.canal, Date.now() - 3000);
    const resposta = resolver(desafio);
    expect(
      (await balao("POST", "/visitante", { corpo: { desafio, resposta, site: "http://spam.example" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await balao("POST", "/visitante", { corpo: { desafio, resposta: String(Number(resposta) + 1) } }))
        .statusCode,
    ).toBe(400);
    const ok = await balao("POST", "/visitante", { corpo: { desafio, resposta } });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().codigo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await balao("POST", "/visitante", { corpo: { desafio, resposta } })).statusCode).toBe(400);
    const guardado = await dono.query("select codigo_hash from visitantes_do_site");
    expect(JSON.stringify(guardado.rows)).not.toContain(ok.json().codigo);
  });

  it("o visitante escreve com a página (sem ? e #), vê só a conversa dele e recebe a resposta da equipe", async () => {
    const eu = await entrar();
    const r = await balao("POST", "/mensagens", {
      visitante: eu,
      corpo: {
        texto: "Oi, vocês entregam em Campinas?",
        pagina: { url: `${LOJA}/produtos/42?email=bia@teste.invalid#topo`, titulo: "Peça 42" },
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    const cv = await dono.query<{ id: string; contato_id: string; identificado: boolean; nome: string }>(
      `select cv.id, cv.contato_id, k.identificado, k.nome from conversas_com_contatos cv join contatos k on k.id = cv.contato_id
        where cv.canal_id = $1`,
      [ids.canal],
    );
    expect(cv.rows[0]).toMatchObject({ identificado: false, nome: "Visitante do site" });
    const conversaId = cv.rows[0]?.id as string;
    const m = await dono.query(
      "select pagina_url, pagina_titulo from mensagens_com_contatos where conversa_id = $1",
      [conversaId],
    );
    expect(m.rows[0]).toEqual({ pagina_url: `${LOJA}/produtos/42`, pagina_titulo: "Peça 42" });
    // O agente sabe a página.
    const partes = await comEmpresa(poolApp, ids.empresa, (c) => partesDoAtendimento(c, conversaId));
    expect(partes[0]?.texto).toContain(`${LOJA}/produtos/42`);

    // A equipe responde pela caixa; a nota interna nunca vai ao balão.
    const resposta = await pedir(
      "POST",
      `/conversas-com-contatos/${conversaId}/mensagens`,
      "ana@teste.invalid",
      {
        texto: "Entregamos sim!",
      },
    );
    expect(resposta.statusCode, resposta.body).toBe(201);
    await pedir("POST", `/conversas-com-contatos/${conversaId}/notas`, "ana@teste.invalid", {
      texto: "Cliente de Campinas, ver frete",
    });
    const lidas = await balao("GET", "/mensagens", { visitante: eu });
    expect(lidas.statusCode).toBe(200);
    expect(lidas.json().mensagens).toEqual([
      expect.objectContaining({ de: "visitante", texto: "Oi, vocês entregam em Campinas?", nome: null }),
      expect.objectContaining({ de: "empresa", texto: "Entregamos sim!", nome: "Ana" }),
    ]);
    const entrega = async () =>
      (
        await dono.query<{ entrega: string }>(
          "select entrega from mensagens_com_contatos where conversa_id = $1 and direcao = 'saiu'",
          [conversaId],
        )
      ).rows[0]?.entrega;
    expect(await entrega()).toBe("entregue");
    await balao("GET", "/mensagens?aberto=1", { visitante: eu });
    expect(await entrega()).toBe("lida");

    // Outro visitante não vê nada disso; o código errado não entra.
    const outro = await entrar();
    expect((await balao("GET", "/mensagens", { visitante: outro })).json().mensagens).toEqual([]);
    expect((await balao("GET", "/mensagens", { visitante: "x".repeat(43) })).statusCode).toBe(401);
    // Mensagem grande demais, e pedido do quadro vindo de outro site.
    expect(
      (await balao("POST", "/mensagens", { visitante: eu, corpo: { texto: "a".repeat(1001) } })).statusCode,
    ).toBe(400);
    expect(
      (
        await balao("POST", "/mensagens", {
          visitante: eu,
          corpo: { texto: "oi" },
          origem: "https://outro-site.com.br",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("limites: 20 mensagens do visitante em 10 minutos e 30 pedidos por minuto do endereço", async () => {
    const eu = await entrar("198.51.100.7");
    for (let i = 0; i < 20; i++) {
      const r = await balao("POST", "/mensagens", {
        visitante: eu,
        corpo: { texto: `mensagem ${i}` },
        endereco: `198.51.100.${(i % 5) + 10}`,
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    expect(
      (
        await balao("POST", "/mensagens", {
          visitante: eu,
          corpo: { texto: "mais uma" },
          endereco: "198.51.100.30",
        })
      ).statusCode,
    ).toBe(429);
    // O endereço de internet: 30 por minuto.
    const outro = await entrar("198.51.100.40");
    for (let i = 0; i < 29; i++)
      await dono.query("insert into pedidos_do_balao (empresa_id, canal_id, ip_hash) values ($1, $2, $3)", [
        ids.empresa,
        ids.canal,
        createHash("sha256").update(`${SEGREDO}:balao:198.51.100.40`).digest("hex"),
      ]);
    expect(
      (
        await balao("POST", "/mensagens", {
          visitante: outro,
          corpo: { texto: "oi" },
          endereco: "198.51.100.40",
        })
      ).statusCode,
    ).toBe(429);
  }, 30_000);

  it("contato repetido: o e-mail e o telefone que o visitante deixou não juntam, a conversa mostra quem pode ser", async () => {
    const eu = await entrar();
    await balao("POST", "/mensagens", { visitante: eu, corpo: { texto: "Quero um orçamento" } });
    const conversaId = (
      await dono.query<{ id: string }>(
        "select id from conversas_com_contatos where canal_id = $1 order by aberta_em desc limit 1",
        [ids.canal],
      )
    ).rows[0]?.id as string;
    const existente = (
      await dono.query<{ id: string }>(
        "insert into contatos (empresa_id, tipo, nome, criado_por) values ($1, 'pessoa', 'Carla Antiga', $2) returning id",
        [ids.empresa, ids.ana],
      )
    ).rows[0]?.id as string;
    await dono.query(
      "insert into identificadores_de_contato (empresa_id, contato_id, tipo, valor, principal, whatsapp) values ($1, $2, 'telefone', '+5511988880000', true, true)",
      [ids.empresa, existente],
    );
    const feito = await comEmpresa(poolApp, ids.empresa, (c) =>
      completarCliente(c, conversaId, { nome: "Carla", telefone: "(11) 98888-0000" }),
    );
    expect(feito.telefone).toMatch(/noutro cadastro/);
    const c = (await pedir("GET", `/conversas-com-contatos/${conversaId}`, "ana@teste.invalid")).json()
      .conversa;
    expect(c.podeSerContatoId).toBe(existente);
    expect(c.contatoId).not.toBe(existente);
    // Um telefone novo é guardado como WhatsApp.
    const outroConversa = conversaId;
    const novo = await comEmpresa(poolApp, ids.empresa, (k) =>
      completarCliente(k, outroConversa, { telefone: "11 97777-1234" }),
    );
    expect(novo.telefone).toBe("WhatsApp guardado.");
  });

  it("continuar no WhatsApp: o código de uso único liga o visitante ao contato do telefone, com o histórico", async () => {
    await pedir("POST", `/canais/${ids.canal}`, "ana@teste.invalid", { whatsappCanalId: ids.zap });
    expect((await balao("GET", "/configuracao")).json().whatsapp).toBe(true);
    const eu = await entrar();
    await balao("POST", "/mensagens", { visitante: eu, corpo: { texto: "Prefiro pelo WhatsApp" } });
    const z = await balao("POST", "/whatsapp", { visitante: eu, corpo: {} });
    expect(z.statusCode, z.body).toBe(201);
    const { link, codigo } = z.json() as { link: string; codigo: string };
    expect(link).toMatch(/^https:\/\/wa\.me\/5511944443333\?text=/);
    expect(decodeURIComponent(link)).toContain(`código ${codigo}`);
    const visitanteId = (
      await dono.query<{ id: string; contato_id: string }>(
        "select id, contato_id from visitantes_do_site where codigo_hash = $1",
        [createHash("sha256").update(eu).digest("hex")],
      )
    ).rows[0];
    // Sem código, e com código errado: nada muda.
    await comEmpresa(poolApp, ids.empresa, async (c) => {
      const r = await receberMensagem(c, {
        canalId: ids.zap,
        identificador: "5511955556666",
        idNoProvedor: "Z1",
        tipo: "texto",
        texto: "Oi! Vim do site (código ZZZZZZ).",
      });
      expect(await usarCodigoDoSite(c, ids.zap, r.contatoId, "Oi! Vim do site (código ZZZZZZ).")).toBeNull();
    });
    const ligado = await comEmpresa(poolApp, ids.empresa, async (c) => {
      const r = await receberMensagem(c, {
        canalId: ids.zap,
        identificador: "5511955556666",
        idNoProvedor: "Z2",
        tipo: "texto",
        texto: `Oi! Vim do site (código ${codigo}).`,
      });
      return {
        contatoId: r.contatoId,
        ok: await usarCodigoDoSite(c, ids.zap, r.contatoId, `código ${codigo}`),
      };
    });
    expect(ligado.ok).toEqual({ visitanteId: visitanteId?.id });
    const conversas = await dono.query<{ canal_id: string }>(
      "select canal_id from conversas_com_contatos where contato_id = $1 order by aberta_em",
      [ligado.contatoId],
    );
    expect(conversas.rows.map((r) => r.canal_id).sort()).toEqual([ids.canal, ids.zap].sort());
    // O contato "Visitante do site" que sobrou foi apagado; o código não vale de novo.
    expect(
      (await dono.query("select 1 from contatos where id = $1", [visitanteId?.contato_id])).rowCount,
    ).toBe(0);
    const repetido = await comEmpresa(poolApp, ids.empresa, (c) =>
      usarCodigoDoSite(c, ids.zap, ligado.contatoId, `código ${codigo}`),
    );
    expect(repetido).toBeNull();
  });

  it("trocar a chave: a linha antiga para de funcionar; outra empresa não troca nem vê", async () => {
    const antiga = chave;
    const r = await pedir("POST", `/canais/${ids.canal}/chave`, "ana@teste.invalid");
    expect(r.statusCode, r.body).toBe(200);
    chave = r.json().canal.chavePublica;
    expect(chave).not.toBe(antiga);
    expect((await app.inject({ method: "GET", url: `/balao/${antiga}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/balao/${chave}` })).statusCode).toBe(200);
    expect((await pedir("POST", `/canais/${ids.canal}/chave`, "olga@teste.invalid")).statusCode).toBe(404);
    expect((await pedir("GET", "/canais", "olga@teste.invalid")).json().canais).toEqual([]);
  });

  it("90 dias: a conversa do visitante que não deixou contato some, com o contato dele; o visitante vencido sai", async () => {
    const eu = await entrar();
    await balao("POST", "/mensagens", { visitante: eu, corpo: { texto: "Só olhando" } });
    const l = (
      await dono.query<{ id: string; contato_id: string }>(
        `select cv.id, cv.contato_id from conversas_com_contatos cv join mensagens_com_contatos m on m.conversa_id = cv.id
          where m.texto = 'Só olhando'`,
      )
    ).rows[0];
    await dono.query(
      "update conversas_com_contatos set ultima_mensagem_em = now() - interval '91 days', aberta_em = now() - interval '91 days' where id = $1",
      [l?.id],
    );
    await dono.query(
      "update visitantes_do_site set vence_em = now() - interval '1 day' where codigo_hash = $1",
      [createHash("sha256").update(eu).digest("hex")],
    );
    expect(await cuidarDosVisitantesVencidos(poolApp)).toBeGreaterThanOrEqual(1);
    expect((await dono.query("select 1 from conversas_com_contatos where id = $1", [l?.id])).rowCount).toBe(
      0,
    );
    expect((await dono.query("select 1 from contatos where id = $1", [l?.contato_id])).rowCount).toBe(0);
    expect((await balao("GET", "/mensagens", { visitante: eu })).statusCode).toBe(401);
    // A conversa de quem foi identificado fica.
    expect(
      (await dono.query("select 1 from conversas_com_contatos where canal_id = $1", [ids.canal])).rowCount,
    ).toBeGreaterThan(0);
  });
});
