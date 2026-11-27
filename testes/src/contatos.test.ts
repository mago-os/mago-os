/**
 * Contatos (M7-01, decisão 0045), pelas rotas: a organização e as pessoas ligadas a ela, o aviso de repetido (sem o
 * nome quando o outro contato é de quem a pessoa não vê), juntar sem perder nada, ligar a tarefas e projetos, quem vê
 * o quê (o funcionário só os seus e os dos projetos dele), apagar com o segundo fator, a busca e as visões salvas.
 */
import type { Contato, ResumoDoContato } from "@mago-os/contratos";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotaDaBusca } from "@mago-os/nucleo/busca";
import { registrarRotasDosContatos } from "@mago-os/nucleo/contatos";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("contatos", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let outraEmpresaId: string;
  let ip = 0;
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  async function criarPessoa(
    empresa: string,
    nome: string,
    email: string,
    perfil: string,
    area: string | null = null,
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

  async function como(email: string, confirmado = true): Promise<string> {
    const chave = `${email}:${confirmado}`;
    if (cookies[chave]) return cookies[chave];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.47.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode).toBe(200);
    cookies[chave] = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) select id, 'c', $1, 'multiDevice' from pessoas where email = $1 on conflict do nothing",
      [email],
    );
    await dono.query(
      confirmado
        ? "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = (select id from pessoas where email = $1)"
        : "update acesso.sessoes set dois_fatores_em = now() - interval '2 days', dois_fatores_metodo = 'passkey' where pessoa_id = (select id from pessoas where email = $1)",
      [email],
    );
    return cookies[chave];
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

  const criar = async (email: string, corpo: Record<string, unknown>) => {
    const r = await pedir("POST", "/contatos", await como(email), corpo);
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { contato: Contato; repetidos: { contatoId: string | null; nome: string | null }[] };
  };
  const lista = async (email: string, query = "") =>
    ((await pedir("GET", `/contatos${query}`, await como(email))).json() as { contatos: ResumoDoContato[] })
      .contatos;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>("insert into empresas (nome) values ('4xpert') returning id");
    empresaId = e.rows[0]?.id as string;
    const o = await dono.query<{ id: string }>("insert into empresas (nome) values ('Outra') returning id");
    outraEmpresaId = o.rows[0]?.id as string;
    ids.ana = await criarPessoa(empresaId, "Ana Admin", "ana@teste.invalid", "administrador");
    ids.rita = await criarPessoa(empresaId, "Rita Vendas", "rita@teste.invalid", "funcionario", "comercial");
    ids.flora = await criarPessoa(empresaId, "Flora Func", "flora@teste.invalid", "funcionario", "operacoes");
    ids.gil = await criarPessoa(empresaId, "Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    ids.olga = await criarPessoa(outraEmpresaId, "Olga Outra", "olga@teste.invalid", "administrador");

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
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
    registrarRotasDosContatos(app, verificador, poolApp);
    registrarRotaDaBusca(app, verificador, poolApp);
  });

  afterAll(async () => {
    await app?.close();
    await poolApp?.end();
    await poolAcesso?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("cadastra a organização e a pessoa ligada a ela, com e-mail, telefone e cargo", async () => {
    const acme = await criar("ana@teste.invalid", {
      tipo: "organizacao",
      nome: "Acme Ltda",
      papeis: ["cliente"],
      documento: "12345678000199",
    });
    ids.acme = acme.contato.id;
    const bia = await criar("ana@teste.invalid", {
      tipo: "pessoa",
      nome: "Beatriz Lima",
      papeis: ["cliente", "parceiro"],
      identificadores: [
        { tipo: "email", valor: "bia@acme.invalid", principal: true },
        { tipo: "telefone", valor: "+5511987654321", principal: true, whatsapp: true, rotulo: "celular" },
        { tipo: "rede", rede: "instagram", valor: "@bialima", principal: false },
      ],
      organizacoes: [{ organizacaoId: ids.acme, cargo: "Diretora" }],
      responsavelId: ids.rita,
    });
    ids.bia = bia.contato.id;
    expect(bia.contato).toMatchObject({ responsavelId: ids.rita, criadoPor: ids.ana, situacao: "ativo" });
    expect(bia.repetidos).toEqual([]);
    const ficha = (await pedir("GET", `/contatos/${ids.acme}`, await como("ana@teste.invalid"))).json() as {
      pessoasLigadas: ResumoDoContato[];
    };
    expect(ficha.pessoasLigadas.map((p) => p.id)).toEqual([ids.bia]);
    const resumo = (await lista("ana@teste.invalid", "?texto=98765")).map((k) => k.id);
    expect(resumo).toContain(ids.bia);
    expect((await lista("ana@teste.invalid", "?papeis=parceiro")).map((k) => k.id)).toEqual([ids.bia]);
    expect((await lista("ana@teste.invalid", `?organizacao=${ids.acme}`)).map((k) => k.id)).toEqual([
      ids.bia,
    ]);
  });

  it("recusa organização ligada a organização e telefone fora do formato", async () => {
    const r = await pedir("POST", "/contatos", await como("ana@teste.invalid"), {
      tipo: "organizacao",
      nome: "Filial",
      organizacoes: [{ organizacaoId: ids.acme }],
    });
    expect(r.statusCode).toBe(400);
    const t = await pedir("POST", "/contatos", await como("ana@teste.invalid"), {
      tipo: "pessoa",
      nome: "Sem DDI",
      identificadores: [{ tipo: "telefone", valor: "11987654321", principal: true, whatsapp: false }],
    });
    expect(t.statusCode).toBe(400);
  });

  it("o funcionário vê só os seus; o repetido de um contato que ele não vê vem sem nome", async () => {
    // A Rita é a responsável pela Bia: vê. A Flora não vê nada ainda.
    expect((await lista("rita@teste.invalid")).map((k) => k.id)).toEqual([ids.bia]);
    expect(await lista("flora@teste.invalid")).toEqual([]);
    expect((await pedir("GET", `/contatos/${ids.bia}`, await como("flora@teste.invalid"))).statusCode).toBe(
      404,
    );
    // A Flora cadastra alguém com o mesmo e-mail: passa, com o aviso sem o nome.
    const dela = await criar("flora@teste.invalid", {
      tipo: "pessoa",
      nome: "Bia (recepção)",
      identificadores: [{ tipo: "email", valor: "bia@acme.invalid", principal: true }],
    });
    ids.biaDuplicada = dela.contato.id;
    expect(dela.repetidos).toEqual([
      {
        identificador: { tipo: "email", valor: "bia@acme.invalid", principal: true },
        contatoId: null,
        nome: null,
      },
    ]);
    // Quem cadastrou continua vendo, mesmo pondo outra pessoa como responsável.
    expect(dela.contato.responsavelId).toBe(ids.flora);
    // O administrador vê os dois, com o nome no aviso.
    const r = await pedir("POST", `/contatos/${ids.biaDuplicada}`, await como("ana@teste.invalid"), {
      identificadores: [{ tipo: "email", valor: "bia@acme.invalid", principal: true }],
    });
    expect(r.json().repetidos).toMatchObject([{ contatoId: ids.bia, nome: "Beatriz Lima" }]);
    // O gestor vê todos (padrão), mas não apaga.
    expect((await lista("gil@teste.invalid")).length).toBeGreaterThanOrEqual(3);
    expect(
      (await pedir("DELETE", `/contatos/${ids.biaDuplicada}`, await como("gil@teste.invalid"))).statusCode,
    ).toBe(403);
  });

  it("o funcionário membro do projeto vê os contatos ligados a ele", async () => {
    const e = await dono.query<{ id: string }>(
      "insert into espacos (empresa_id, nome) values ($1, 'Operações') returning id",
      [empresaId],
    );
    const r = await pedir("POST", "/projetos", await como("ana@teste.invalid"), {
      espacoId: e.rows[0]?.id,
      nome: "Implantação Acme",
      membros: [{ tipo: "pessoa", pessoaId: ids.flora }],
    });
    expect(r.statusCode, r.body).toBe(201);
    ids.projeto = r.json().id ?? r.json().projeto?.id;
    const l = await pedir("POST", `/projetos/${ids.projeto}/contatos`, await como("ana@teste.invalid"), {
      contatos: [ids.acme],
    });
    expect(l.statusCode, l.body).toBe(200);
    expect((await lista("flora@teste.invalid")).map((k) => k.id)).toContain(ids.acme);
  });

  it("liga contatos à tarefa, a ficha mostra a tarefa e a lista de tarefas filtra por contato", async () => {
    const t = await pedir("POST", "/tarefas", await como("rita@teste.invalid"), {
      titulo: "Proposta para a Bia",
    });
    expect(t.statusCode, t.body).toBe(201);
    ids.tarefa = t.json().id;
    const l = await pedir("POST", `/tarefas/${ids.tarefa}/contatos`, await como("rita@teste.invalid"), {
      contatos: [ids.bia],
    });
    expect(l.statusCode, l.body).toBe(200);
    expect((l.json().contatos as ResumoDoContato[]).map((k) => k.id)).toEqual([ids.bia]);
    // Contato que a Rita não vê: recusa.
    const nao = await pedir("POST", `/tarefas/${ids.tarefa}/contatos`, await como("rita@teste.invalid"), {
      contatos: [ids.biaDuplicada],
    });
    expect(nao.statusCode).toBe(400);
    const ficha = (await pedir("GET", `/contatos/${ids.bia}`, await como("rita@teste.invalid"))).json() as {
      tarefas: { id: string }[];
    };
    expect(ficha.tarefas.map((x) => x.id)).toEqual([ids.tarefa]);
    const filtradas = (
      await pedir("GET", `/tarefas?contato=${ids.bia}`, await como("rita@teste.invalid"))
    ).json();
    expect((filtradas.tarefas as { id: string }[]).map((x) => x.id)).toEqual([ids.tarefa]);
  });

  it("junta os dois sem perder nada e o juntado leva ao que ficou", async () => {
    const tarefa2 = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, criada_por_pessoa_id) values ($1, 'Visita', $2) returning id",
      [empresaId, ids.flora],
    );
    await dono.query(
      "insert into contatos_de_tarefa (empresa_id, tarefa_id, contato_id) values ($1, $2, $3)",
      [empresaId, tarefa2.rows[0]?.id, ids.biaDuplicada],
    );
    await pedir("POST", `/contatos/${ids.biaDuplicada}`, await como("ana@teste.invalid"), {
      identificadores: [
        { tipo: "email", valor: "bia@acme.invalid", principal: true },
        { tipo: "email", valor: "recepcao@acme.invalid", principal: false },
      ],
      observacoes: "Prefere ligação à tarde.",
    });
    // A ficha mostra o aviso de repetido (também logo depois de cadastrar, sem precisar editar).
    const ficha = (
      await pedir("GET", `/contatos/${ids.biaDuplicada}`, await como("ana@teste.invalid"))
    ).json();
    expect(ficha.repetidos).toMatchObject([{ contatoId: ids.bia, nome: "Beatriz Lima" }]);
    // A lista marca os dois como possíveis repetidos, e o filtro mostra só eles.
    const comRepetidos = await lista("ana@teste.invalid", "?repetidos=1");
    expect(comRepetidos.map((k) => k.id).sort()).toEqual([ids.bia, ids.biaDuplicada].sort());
    expect(comRepetidos.every((k) => k.repetido)).toBe(true);
    // A Rita não vê a cópia da Flora: para ela, a Bia não aparece como repetida.
    expect((await lista("rita@teste.invalid")).find((k) => k.id === ids.bia)?.repetido).toBe(false);
    // O funcionário não junta.
    expect(
      (
        await pedir("POST", "/contatos/juntar", await como("flora@teste.invalid"), {
          ficaId: ids.bia,
          saiId: ids.biaDuplicada,
        })
      ).statusCode,
    ).toBe(403);
    const j = await pedir("POST", "/contatos/juntar", await como("gil@teste.invalid"), {
      ficaId: ids.bia,
      saiId: ids.biaDuplicada,
      nome: "Beatriz Lima Souza",
    });
    expect(j.statusCode, j.body).toBe(200);
    const ficou = j.json().contato as Contato;
    // O nome escolhido ao juntar fica.
    expect(ficou.nome).toBe("Beatriz Lima Souza");
    expect(ficou.identificadores.filter((i) => i.tipo === "email").map((i) => i.valor)).toEqual([
      "bia@acme.invalid",
      "recepcao@acme.invalid",
    ]);
    expect(ficou.observacoes).toBe("Prefere ligação à tarde.");
    expect(ficou.organizacoes.map((o) => o.organizacaoId)).toEqual([ids.acme]);
    const ligadas = await dono.query("select tarefa_id from contatos_de_tarefa where contato_id = $1", [
      ids.bia,
    ]);
    expect(ligadas.rowCount).toBe(2);
    const antigo = (
      await pedir("GET", `/contatos/${ids.biaDuplicada}`, await como("ana@teste.invalid"))
    ).json();
    expect(antigo).toEqual({ juntadoEmId: ids.bia });
    expect((await lista("ana@teste.invalid")).map((k) => k.id)).not.toContain(ids.biaDuplicada);
    const auditoria = await dono.query("select 1 from auditoria.eventos where acao = 'contato.juntou'");
    expect(auditoria.rowCount).toBe(1);
  });

  it("arquivar esconde da lista e volta ao desarquivar", async () => {
    const c = await como("ana@teste.invalid");
    expect((await pedir("POST", `/contatos/${ids.acme}`, c, { situacao: "arquivado" })).statusCode).toBe(200);
    expect((await lista("ana@teste.invalid")).map((k) => k.id)).not.toContain(ids.acme);
    expect((await lista("ana@teste.invalid", "?situacao=arquivado")).map((k) => k.id)).toEqual([ids.acme]);
    expect((await pedir("POST", `/contatos/${ids.acme}`, c, { situacao: "ativo" })).statusCode).toBe(200);
  });

  it("a busca acha o contato pelo nome e pelo e-mail, com a permissão da lista", async () => {
    const achou = (await pedir("GET", "/busca?texto=beatriz", await como("rita@teste.invalid"))).json();
    expect(
      (achou.resultados as { tipo: string; id: string }[])
        .filter((x) => x.tipo === "contato")
        .map((x) => x.id),
    ).toEqual([ids.bia]);
    const nada = (await pedir("GET", "/busca?texto=acme", await como("rita@teste.invalid"))).json();
    expect((nada.resultados as { tipo: string; id: string }[]).some((x) => x.id === ids.acme)).toBe(false);
  });

  it("visões salvas são de cada pessoa", async () => {
    const r = await pedir("POST", "/contatos-visoes", await como("rita@teste.invalid"), {
      nome: "Meus clientes",
      filtro: { papeis: ["cliente"] },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(
      ((await pedir("GET", "/contatos-visoes", await como("rita@teste.invalid"))).json().visoes as unknown[])
        .length,
    ).toBe(1);
    expect((await pedir("GET", "/contatos-visoes", await como("ana@teste.invalid"))).json().visoes).toEqual(
      [],
    );
  });

  it("apagar pede o segundo fator recente e tira das tarefas", async () => {
    const velho = await como("ana@teste.invalid", false);
    expect((await pedir("DELETE", `/contatos/${ids.bia}`, velho)).json().code).toBe("CONFIRMACAO_NECESSARIA");
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now() where pessoa_id = (select id from pessoas where email = 'ana@teste.invalid')",
    );
    const r = await pedir("DELETE", `/contatos/${ids.bia}`, await como("ana@teste.invalid"));
    expect(r.statusCode, r.body).toBe(200);
    expect((await dono.query("select 1 from contatos where id = $1", [ids.bia])).rowCount).toBe(0);
    expect(
      (await dono.query("select 1 from contatos_de_tarefa where contato_id = $1", [ids.bia])).rowCount,
    ).toBe(0);
  });

  it("uma empresa nunca vê nem liga contato da outra", async () => {
    const olga = await como("olga@teste.invalid");
    expect((await pedir("GET", `/contatos/${ids.acme}`, olga)).statusCode).toBe(404);
    expect(await lista("olga@teste.invalid")).toEqual([]);
    const dela = await pedir("POST", "/contatos", olga, {
      tipo: "pessoa",
      nome: "Pessoa da Outra",
      organizacoes: [{ organizacaoId: ids.acme }],
    });
    expect(dela.statusCode).toBe(400);
    const t = await pedir("POST", "/tarefas", olga, { titulo: "Da outra" });
    const l = await pedir("POST", `/tarefas/${t.json().id}/contatos`, olga, { contatos: [ids.acme] });
    expect(l.statusCode).toBe(400);
  });
});
