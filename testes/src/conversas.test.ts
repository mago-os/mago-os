/**
 * Conversas com contatos (M8-01, decisão 0051), com um provedor falso: a mensagem de um telefone cadastrado (com ou
 * sem o nono dígito) cai no contato certo; a de um telefone novo cria o contato "não identificado"; a repetida não
 * grava duas vezes; a atrasada fica no lugar certo; na folga de 1 hora depois de resolver cai na resolvida, depois
 * dela abre outra conversa; a linha do tempo mostra as duas; quem é de outra equipe não vê; o número é de uma empresa
 * só; trocar o contato e juntar dois contatos levam as conversas.
 */
import type { ResumoDaConversa } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotasDosContatos } from "@mago-os/nucleo/contatos";
import {
  criarCanal,
  type MensagemRecebida,
  RecusaDasConversas,
  receberMensagem,
  registrarRotasDasConversas,
  resolverConversa,
} from "@mago-os/nucleo/conversas";
import { comEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("conversas com contatos", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let outraEmpresaId: string;
  let ip = 0;
  type Chave =
    | "ana"
    | "rita"
    | "flora"
    | "gil"
    | "olga"
    | "comercial"
    | "geral"
    | "canalOutra"
    | "bia"
    | "conversa1"
    | "conversa2"
    | "carlos"
    | "recepcao"
    | "dono";
  const ids = {} as Record<Chave, string>;
  const cookies: Record<string, string> = {};

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
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.48.${ip}` },
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

  const chegou = (empresa: string, m: Parameters<typeof receberMensagem>[1]): Promise<MensagemRecebida> =>
    comEmpresa(poolApp, empresa, (c) => receberMensagem(c, m));

  const conversasDoContato = async (email: string, contatoId: string) => {
    const r = await pedir("GET", `/contatos/${contatoId}/conversas`, email);
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { identificado: boolean; conversas: ResumoDaConversa[] };
  };

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    empresaId = (
      await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id")
    ).rows[0]?.id as string;
    outraEmpresaId = (
      await dono.query<{ id: string }>("insert into empresas (nome) values ('Outra') returning id")
    ).rows[0]?.id as string;
    ids.ana = await criarPessoa(empresaId, "Ana Admin", "ana@teste.invalid", "administrador", null);
    ids.rita = await criarPessoa(empresaId, "Rita Vendas", "rita@teste.invalid", "funcionario", "comercial");
    ids.flora = await criarPessoa(
      empresaId,
      "Flora Suporte",
      "flora@teste.invalid",
      "funcionario",
      "suporte",
    );
    ids.gil = await criarPessoa(empresaId, "Gil Gestor", "gil@teste.invalid", "gestor_area", "suporte");
    ids.olga = await criarPessoa(outraEmpresaId, "Olga Outra", "olga@teste.invalid", "administrador", null);

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
    registrarRotasDosContatos(app, verificador, poolApp);
    registrarRotasDasConversas(app, verificador, poolApp);

    const canal = (empresa: string, autor: string, dados: Parameters<typeof criarCanal>[2]) =>
      comEmpresa(poolApp, empresa, (c) => criarCanal(c, autor, dados));
    ids.comercial = (
      await canal(empresaId, ids.ana, {
        nome: "WhatsApp comercial",
        provedor: "evolution",
        identificador: "+5511900001111",
        area: "comercial",
      })
    ).id;
    ids.geral = (await canal(empresaId, ids.ana, { nome: "Balão do site", provedor: "site" })).id;
    ids.canalOutra = (
      await canal(outraEmpresaId, ids.olga, {
        nome: "WhatsApp da outra",
        provedor: "evolution",
        identificador: "+5511900002222",
      })
    ).id;

    // O cliente cadastrado com o nono dígito.
    const r = await pedir("POST", "/contatos", "ana@teste.invalid", {
      tipo: "pessoa",
      nome: "Bia Cliente",
      identificadores: [{ tipo: "telefone", valor: "+5511988887777", principal: true, whatsapp: true }],
    });
    expect(r.statusCode, r.body).toBe(201);
    ids.bia = (r.json() as { contato: { id: string } }).contato.id;
  });

  afterAll(async () => {
    await app?.close();
    await poolApp?.end();
    await poolAcesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("um número fica preso a uma empresa só", async () => {
    await expect(
      comEmpresa(poolApp, outraEmpresaId, (c) =>
        criarCanal(c, ids.olga, { nome: "Copia", provedor: "evolution", identificador: "+5511900001111" }),
      ),
    ).rejects.toBeInstanceOf(RecusaDasConversas);
  });

  it("a mensagem do telefone cadastrado, chegando sem o nono dígito, cai no contato certo", async () => {
    const r = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "551188887777@s.whatsapp.net",
      nomeDoPerfil: "Bia",
      idNoProvedor: "M1",
      tipo: "texto",
      texto: "Oi, quero um orçamento",
      enviadaEm: "2026-11-27T10:00:00Z",
    });
    expect(r).toMatchObject({ contatoId: ids.bia, contatoNovo: false, conversaNova: true, naFolga: false });
    expect(r.mensagemId).not.toBeNull();
    ids.conversa1 = r.conversaId;
    const outra = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "5511988887777",
      idNoProvedor: "M2",
      tipo: "texto",
      texto: "Pode ser amanhã?",
      enviadaEm: "2026-11-27T10:05:00Z",
    });
    expect(outra).toMatchObject({ conversaId: ids.conversa1, conversaNova: false });
  });

  it("a mensagem repetida pelo provedor não grava duas vezes, e a atrasada fica no lugar certo", async () => {
    const repetida = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "5511988887777",
      idNoProvedor: "M1",
      tipo: "texto",
      texto: "Oi, quero um orçamento",
    });
    expect(repetida).toMatchObject({ conversaId: ids.conversa1, mensagemId: null });
    await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "5511988887777",
      idNoProvedor: "M0",
      tipo: "texto",
      texto: "Bom dia",
      enviadaEm: "2026-11-27T09:59:00Z",
    });
    const r = await pedir("GET", `/conversas-com-contatos/${ids.conversa1}`, "ana@teste.invalid");
    expect(r.statusCode, r.body).toBe(200);
    const corpo = r.json() as {
      conversa: { situacao: string; ultimaMensagemEm: string; ultimoAResponder: string };
      mensagens: { texto: string; autor: string }[];
    };
    expect(corpo.mensagens.map((m) => m.texto)).toEqual([
      "Bom dia",
      "Oi, quero um orçamento",
      "Pode ser amanhã?",
    ]);
    expect(corpo.conversa).toMatchObject({
      situacao: "esperando_equipe",
      ultimoAResponder: "contato",
      ultimaMensagemEm: "2026-11-27T10:05:00.000Z",
    });
  });

  it("o telefone novo cria o contato não identificado, com o nome do perfil e o canal de origem", async () => {
    const r = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "351912345678",
      nomeDoPerfil: "  Carlos   P. ",
      idNoProvedor: "N1",
      tipo: "audio",
    });
    expect(r).toMatchObject({ contatoNovo: true, conversaNova: true });
    ids.carlos = r.contatoId;
    const k = await dono.query(
      `select k.nome, k.identificado, k.origem_canal_id, k.responsavel_id, k.criado_por, i.valor, i.principal, i.whatsapp
         from contatos k join identificadores_de_contato i on i.contato_id = k.id where k.id = $1`,
      [ids.carlos],
    );
    expect(k.rows[0]).toMatchObject({
      nome: "Carlos P.",
      identificado: false,
      origem_canal_id: ids.comercial,
      responsavel_id: null,
      criado_por: ids.ana,
      valor: "+351912345678",
      principal: true,
      whatsapp: true,
    });
    expect((await conversasDoContato("ana@teste.invalid", ids.carlos)).identificado).toBe(false);
  });

  it("na folga de 1 hora depois de resolver, a mensagem cai na resolvida; depois dela, abre outra conversa", async () => {
    await comEmpresa(poolApp, empresaId, (c) => resolverConversa(c, ids.conversa1, ids.ana));
    const obrigado = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "5511988887777",
      idNoProvedor: "M3",
      tipo: "texto",
      texto: "Obrigada!",
    });
    expect(obrigado).toMatchObject({ conversaId: ids.conversa1, naFolga: true, conversaNova: false });
    const situacao = await dono.query("select situacao from conversas_com_contatos where id = $1", [
      ids.conversa1,
    ]);
    expect(situacao.rows[0]?.situacao).toBe("resolvida");

    await dono.query(
      "update conversas_com_contatos set resolvida_em = now() - interval '61 minutes' where id = $1",
      [ids.conversa1],
    );
    const nova = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "5511988887777",
      idNoProvedor: "M4",
      tipo: "texto",
      texto: "Voltei, tenho outra dúvida",
    });
    expect(nova).toMatchObject({ contatoId: ids.bia, conversaNova: true, naFolga: false });
    expect(nova.conversaId).not.toBe(ids.conversa1);
    ids.conversa2 = nova.conversaId;

    // A conversa nova mostra a anterior, e a linha do tempo do contato mostra as duas (a mais nova primeiro).
    const aberta = (
      await pedir("GET", `/conversas-com-contatos/${ids.conversa2}`, "ana@teste.invalid")
    ).json() as {
      anterior: { id: string } | null;
    };
    expect(aberta.anterior?.id).toBe(ids.conversa1);
    const linha = await conversasDoContato("ana@teste.invalid", ids.bia);
    expect(linha.conversas.map((x) => x.conversa.id)).toEqual([ids.conversa2, ids.conversa1]);
    expect(linha.conversas[0]?.ultimaMensagem).toMatchObject({
      autor: "contato",
      trecho: "Voltei, tenho outra dúvida",
    });
  });

  it("o funcionário vê os canais da equipe dele e os sem equipe; o gestor vê todos", async () => {
    const site = await chegou(empresaId, {
      canalId: ids.geral,
      identificador: "visitante:abcdefgh1234",
      tipo: "texto",
      texto: "Vocês atendem sábado?",
    });
    expect(site.contatoNovo).toBe(true);
    const doCanal = async (email: string) =>
      (
        (await pedir("GET", "/conversas-com-contatos", email)).json() as { conversas: ResumoDaConversa[] }
      ).conversas.map((x) => x.conversa.canal.id);
    expect(new Set(await doCanal("rita@teste.invalid"))).toEqual(new Set([ids.comercial, ids.geral]));
    expect(new Set(await doCanal("flora@teste.invalid"))).toEqual(new Set([ids.geral]));
    expect(new Set(await doCanal("gil@teste.invalid"))).toEqual(new Set([ids.comercial, ids.geral]));
    const naoVe = await pedir("GET", `/conversas-com-contatos/${ids.conversa2}`, "flora@teste.invalid");
    expect(naoVe.statusCode).toBe(404);
    // Passada para ela (dona), a Flora passa a ver.
    await dono.query("update conversas_com_contatos set dono_id = $2 where id = $1", [
      ids.conversa2,
      ids.flora,
    ]);
    expect(
      (await pedir("GET", `/conversas-com-contatos/${ids.conversa2}`, "flora@teste.invalid")).statusCode,
    ).toBe(200);
    await dono.query("update conversas_com_contatos set dono_id = null where id = $1", [ids.conversa2]);
  });

  it("os canais só o administrador vê por padrão", async () => {
    expect((await pedir("GET", "/canais", "ana@teste.invalid")).statusCode).toBe(200);
    expect((await pedir("GET", "/canais", "gil@teste.invalid")).statusCode).toBe(403);
    expect((await pedir("GET", "/canais", "rita@teste.invalid")).statusCode).toBe(403);
  });

  it("uma empresa nunca vê canal, conversa nem mensagem da outra", async () => {
    await expect(
      chegou(outraEmpresaId, {
        canalId: ids.comercial,
        identificador: "5511988887777",
        tipo: "texto",
        texto: "x",
      }),
    ).rejects.toBeInstanceOf(RecusaDasConversas);
    const r = await pedir("GET", `/conversas-com-contatos/${ids.conversa1}`, "olga@teste.invalid");
    expect(r.statusCode).toBe(404);
    const lista = (await pedir("GET", "/conversas-com-contatos", "olga@teste.invalid")).json() as {
      conversas: unknown[];
    };
    expect(lista.conversas).toEqual([]);
    const canais = (await pedir("GET", "/canais", "olga@teste.invalid")).json() as {
      canais: { id: string }[];
    };
    expect(canais.canais.map((x) => x.id)).toEqual([ids.canalOutra]);
  });

  it("o telefone em dois contatos avisa, liga ao principal e deixa trocar à mão, com auditoria", async () => {
    const criar = async (nome: string, principal: boolean) => {
      const r = await pedir("POST", "/contatos", "ana@teste.invalid", {
        tipo: "pessoa",
        nome,
        identificadores: [{ tipo: "telefone", valor: "+551133334444", principal, whatsapp: false }],
      });
      return (r.json() as { contato: { id: string } }).contato.id;
    };
    ids.recepcao = await criar("Recepção da Acme", false);
    ids.dono = await criar("Dono da Acme", true);
    const r = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "551133334444",
      tipo: "texto",
      texto: "Alô",
    });
    expect(r.contatoId).toBe(ids.dono);
    const aberta = (
      await pedir("GET", `/conversas-com-contatos/${r.conversaId}`, "ana@teste.invalid")
    ).json() as {
      conversa: { maisDeUmContato: boolean };
    };
    expect(aberta.conversa.maisDeUmContato).toBe(true);

    const troca = await pedir(
      "POST",
      `/conversas-com-contatos/${r.conversaId}/contato`,
      "ana@teste.invalid",
      {
        contatoId: ids.recepcao,
      },
    );
    expect(troca.statusCode, troca.body).toBe(200);
    expect(troca.json()).toMatchObject({ conversa: { contatoId: ids.recepcao, maisDeUmContato: false } });
    // A próxima mensagem continua na mesma conversa, com o contato escolhido.
    const proxima = await chegou(empresaId, {
      canalId: ids.comercial,
      identificador: "551133334444",
      tipo: "texto",
      texto: "Ainda aqui",
    });
    expect(proxima).toMatchObject({ conversaId: r.conversaId, contatoId: ids.recepcao });
    const evento = await dono.query(
      "select detalhes from auditoria.eventos where acao = 'conversa.trocou_contato' and alvo->>'id' = $1",
      [r.conversaId],
    );
    expect(evento.rows[0]?.detalhes).toMatchObject({ de: ids.dono, para: ids.recepcao });
    expect(JSON.stringify(evento.rows[0]?.detalhes)).not.toContain("Alô");
    // O funcionário de outra equipe não troca.
    const semAlcance = await pedir(
      "POST",
      `/conversas-com-contatos/${r.conversaId}/contato`,
      "flora@teste.invalid",
      {
        contatoId: ids.dono,
      },
    );
    expect(semAlcance.statusCode).toBe(404);
  });

  it("dar o nome identifica o contato; juntar leva as conversas para o que fica", async () => {
    const edita = await pedir("POST", `/contatos/${ids.carlos}`, "ana@teste.invalid", {
      nome: "Carlos Pereira",
    });
    expect(edita.statusCode, edita.body).toBe(200);
    expect((await conversasDoContato("ana@teste.invalid", ids.carlos)).identificado).toBe(true);

    const junta = await pedir("POST", "/contatos/juntar", "ana@teste.invalid", {
      ficaId: ids.bia,
      saiId: ids.carlos,
    });
    expect(junta.statusCode, junta.body).toBe(200);
    const linha = await conversasDoContato("ana@teste.invalid", ids.bia);
    const doCarlos = await dono.query(
      "select count(*)::int as n from conversas_com_contatos where contato_id = $1",
      [ids.carlos],
    );
    expect(doCarlos.rows[0]?.n).toBe(0);
    // Os dois tinham conversa aberta no mesmo canal: fica uma só aberta, e a outra é resolvida, na linha do tempo.
    const abertas = linha.conversas.filter((x) => x.conversa.situacao !== "resolvida");
    expect(abertas).toHaveLength(1);
    expect(linha.conversas).toHaveLength(3);
  });

  it("apagar o contato apaga as conversas e as mensagens dele (LGPD)", async () => {
    const antes = await dono.query("select count(*)::int as n from mensagens_com_contatos");
    const r = await dono.query("delete from contatos where id = $1", [ids.recepcao]);
    expect(r.rowCount).toBe(1);
    const conversas = await dono.query(
      "select count(*)::int as n from conversas_com_contatos where contato_id = $1",
      [ids.recepcao],
    );
    expect(conversas.rows[0]?.n).toBe(0);
    const depois = await dono.query("select count(*)::int as n from mensagens_com_contatos");
    expect(depois.rows[0]?.n).toBeLessThan(antes.rows[0]?.n);
  });
});
