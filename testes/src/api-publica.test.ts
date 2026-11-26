/**
 * API pública (M7-02, decisão 0047), com a API inteira montada: a chave de API em nome de uma pessoa, o escopo, a
 * troca, a revogação, o IP, o limite por minuto, a chave de agente pelo canal "api" (e o canal fechado), a auditoria
 * com o canal "api", a documentação pública e que a chave de uma empresa não vê nada da outra.
 */

import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { gerarChave } from "@mago-os/nucleo/agentes";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { modelosFalsos } from "@mago-os/nucleo/contas-de-ia";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";
import { type ApiDeTeste, montarApiDeTeste, SITE } from "./vazamento/montar-api.ts";

const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("API pública", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let api: ApiDeTeste;
  let ip = 0;
  const E: Record<string, string> = {};
  const P: Record<string, { id: string; cookie: string }> = {};
  const K: Record<string, string> = {};

  async function criarPessoa(empresaId: string, rotulo: string, perfil: string) {
    const email = `${rotulo}@teste.invalid`;
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ($1, $2, true) returning id",
      [`Pessoa ${rotulo}`, email],
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
    ip += 1;
    const r = await api.app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.72.${ip}` },
      payload: JSON.stringify({ email, password: SENHA }),
    });
    expect(r.statusCode, r.body).toBe(200);
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey' where pessoa_id = $1",
      [id],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) values ($1, 'c', $2, 'multiDevice')",
      [id, email],
    );
    const cookie = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
    return { id, cookie };
  }

  const naTela = (metodo: "GET" | "POST", url: string, cookie: string, corpo?: unknown) =>
    api.app.inject({
      method: metodo,
      url,
      headers: {
        cookie,
        origin: SITE,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });

  const pelaApi = (
    metodo: "GET" | "POST",
    url: string,
    chave: string,
    corpo?: unknown,
    de = "203.0.113.10",
  ) =>
    api.app.inject({
      method: metodo,
      url,
      headers: {
        authorization: `Bearer ${chave}`,
        "x-forwarded-for": de,
        ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}),
    });

  async function criarChave(empresa: "A" | "B", corpo: Record<string, unknown>) {
    const r = await naTela("POST", "/empresa/chaves-de-api", P[`admin${empresa}`]?.cookie ?? "", corpo);
    expect(r.statusCode, r.body).toBe(201);
    return r.json() as { chave: { id: string }; segredo: string };
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    api = await montarApiDeTeste(banco, { modelos: modelosFalsos([]) });
    for (const sigla of ["A", "B"]) {
      const e = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
        `Empresa ${sigla}`,
      ]);
      E[sigla] = e.rows[0]?.id as string;
      P[`admin${sigla}`] = await criarPessoa(
        E[sigla] as string,
        `admin-${sigla.toLowerCase()}`,
        "administrador",
      );
    }
    P.func = await criarPessoa(E.A as string, "func-a", "funcionario");
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
    await dono?.end();
    await banco?.apagar();
  });

  it("a chave age em nome da pessoa, dentro do escopo, e a auditoria leva o canal api", async () => {
    const k = await criarChave("A", { nome: "n8n", escopo: { tarefas: "escrever", contatos: "ler" } });
    K.admin = k.segredo;
    const criada = await pelaApi("POST", "/v1/tarefas", K.admin, { titulo: "Pela API" });
    expect(criada.statusCode, criada.body).toBe(201);
    K.tarefa = criada.json().id;
    expect(criada.json().criadaPor).toEqual({ tipo: "pessoa", pessoaId: P.adminA?.id });
    const lista = await pelaApi("GET", "/v1/tarefas?status=a_fazer", K.admin);
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json().tarefas as { id: string }[]).map((t) => t.id)).toContain(K.tarefa);
    const ver = await pelaApi("GET", `/v1/tarefas/${K.tarefa}`, K.admin);
    expect(ver.json().titulo).toBe("Pela API");
    const comentou = await pelaApi("POST", `/v1/tarefas/${K.tarefa}/comentarios`, K.admin, { texto: "Oi" });
    expect(comentou.statusCode, comentou.body).toBeLessThan(300);
    expect(
      (await pelaApi("GET", `/v1/tarefas/${K.tarefa}/comentarios`, K.admin)).json().comentarios,
    ).toHaveLength(1);
    // Fora do escopo: contatos só lê; projetos não alcança.
    const contato = await pelaApi("POST", "/v1/contatos", K.admin, { tipo: "pessoa", nome: "Ana" });
    expect(contato.statusCode).toBe(403);
    expect(contato.json().code).toBe("FORA_DO_ESCOPO");
    expect((await pelaApi("GET", "/v1/projetos", K.admin)).statusCode).toBe(403);
    expect((await pelaApi("GET", "/v1/contatos", K.admin)).statusCode).toBe(200);
    const canal = await dono.query<{ canal: string }>(
      "select origem->>'canal' as canal from auditoria.eventos where acao = 'tarefa.criou' order by ocorrido_em desc limit 1",
    );
    expect(canal.rows[0]?.canal).toBe("api");
    const recusa = await dono.query("select 1 from auditoria.eventos where acao = 'chave_api.recusou'");
    expect(recusa.rowCount).toBeGreaterThanOrEqual(2);
  });

  it("a chave em nome do funcionário vê só o que ele vê", async () => {
    const k = await criarChave("A", { nome: "do func", escopo: { tarefas: "ler" }, pessoaId: P.func?.id });
    expect((await pelaApi("GET", `/v1/tarefas/${K.tarefa}`, k.segredo)).statusCode).toBe(404);
    expect((await pelaApi("POST", "/v1/tarefas", k.segredo, { titulo: "x" })).json().code).toBe(
      "FORA_DO_ESCOPO",
    );
    // O funcionário não cuida das chaves.
    expect((await naTela("GET", "/empresa/chaves-de-api", P.func?.cookie ?? "")).statusCode).toBe(403);
  });

  it("a chave de uma empresa não vê nada da outra", async () => {
    const b = await criarChave("B", { nome: "da B", escopo: { tarefas: "escrever", contatos: "escrever" } });
    expect((await pelaApi("GET", `/v1/tarefas/${K.tarefa}`, b.segredo)).statusCode).toBe(404);
    expect((await pelaApi("GET", "/v1/tarefas", b.segredo)).json().tarefas).toEqual([]);
  });

  it("trocar deixa a antiga valer mais um pouco; revogar corta na hora", async () => {
    const k = await criarChave("A", { nome: "troca", escopo: { tarefas: "ler" } });
    const t = await naTela("POST", `/empresa/chaves-de-api/${k.chave.id}/trocar`, P.adminA?.cookie ?? "", {});
    expect(t.statusCode, t.body).toBe(201);
    const nova = t.json().segredo as string;
    expect((await pelaApi("GET", "/v1/tarefas", k.segredo)).statusCode).toBe(200);
    expect((await pelaApi("GET", "/v1/tarefas", nova)).statusCode).toBe(200);
    const antiga = await dono.query<{ horas: number }>(
      "select extract(epoch from valida_ate - now()) / 3600 as horas from chaves_de_api where id = $1",
      [k.chave.id],
    );
    expect(Number(antiga.rows[0]?.horas)).toBeLessThanOrEqual(24);
    const novaId = t.json().chave.id as string;
    expect(
      (await naTela("POST", `/empresa/chaves-de-api/${novaId}/revogar`, P.adminA?.cookie ?? "", {}))
        .statusCode,
    ).toBe(200);
    expect((await pelaApi("GET", "/v1/tarefas", nova)).statusCode).toBe(401);
    // A chave parada sai da lista (a linha fica, para a auditoria); a ativa não sai.
    const lista = async () =>
      (
        (await naTela("GET", "/empresa/chaves-de-api", P.adminA?.cookie ?? "")).json().chaves as {
          id: string;
        }[]
      ).map((x) => x.id);
    const ativa = await criarChave("A", { nome: "ativa", escopo: { tarefas: "ler" } });
    expect(
      (await naTela("POST", `/empresa/chaves-de-api/${ativa.chave.id}/remover`, P.adminA?.cookie ?? "", {}))
        .statusCode,
    ).toBe(409);
    expect(
      (await naTela("POST", `/empresa/chaves-de-api/${novaId}/remover`, P.adminA?.cookie ?? "", {}))
        .statusCode,
    ).toBe(200);
    expect(await lista()).not.toContain(novaId);
    expect((await dono.query("select 1 from chaves_de_api where id = $1", [novaId])).rowCount).toBe(1);
  });

  it("IP fora da lista é recusado", async () => {
    const k = await criarChave("A", { nome: "com IP", escopo: { tarefas: "ler" }, ips: ["203.0.113.0/24"] });
    expect((await pelaApi("GET", "/v1/tarefas", k.segredo, undefined, "203.0.113.77")).statusCode).toBe(200);
    const fora = await pelaApi("GET", "/v1/tarefas", k.segredo, undefined, "198.51.100.1");
    expect(fora.statusCode).toBe(403);
    expect(fora.json().code).toBe("IP_NAO_PERMITIDO");
  });

  it("passou do limite por minuto: 429 com o Retry-After", async () => {
    const k = await criarChave("A", { nome: "limite", escopo: { tarefas: "ler" } });
    await dono.query(
      "insert into contadores_da_api (empresa_id, chave_id, inicio, valor) values ($1, $2, date_trunc('minute', now()), 120)",
      [E.A, k.chave.id],
    );
    const r = await pelaApi("GET", "/v1/tarefas", k.segredo);
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBe("60");
  });

  it("a validade passa de 1 ano: recusa", async () => {
    const r = await naTela("POST", "/empresa/chaves-de-api", P.adminA?.cookie ?? "", {
      nome: "eterna",
      escopo: { tarefas: "ler" },
      validaAte: "2099-01-01T00:00:00Z",
    });
    expect(r.statusCode).toBe(400);
  });

  it("a chave do agente usa o mesmo alcance do MCP, e o canal fechado recusa", async () => {
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Robô', $2) returning id",
      [E.A, P.adminA?.id],
    );
    const agenteId = a.rows[0]?.id as string;
    const nova = gerarChave();
    await dono.query(
      `insert into chaves_de_agente (empresa_id, agente_id, nome, prefixo, resumo, criada_por)
       values ($1, $2, 'teste', $3, $4, $5)`,
      [E.A, agenteId, nova.prefixo, nova.resumo, P.adminA?.id],
    );
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo, responsavel_agente_id) values ($1, 'Do robô', $2) returning id",
      [E.A, agenteId],
    );
    const lista = await pelaApi("GET", "/v1/tarefas", nova.chave);
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json().tarefas as { id: string }[]).map((x) => x.id)).toEqual([t.rows[0]?.id]);
    expect((await pelaApi("GET", `/v1/tarefas/${K.tarefa}`, nova.chave)).statusCode).toBe(400);
    expect((await pelaApi("GET", "/v1/projetos", nova.chave)).json().code).toBe("NAO_PARA_AGENTES");
    await dono.query("update agentes set canais = 'mcp' where id = $1", [agenteId]);
    const fechado = await pelaApi("GET", "/v1/tarefas", nova.chave);
    expect(fechado.statusCode).toBe(403);
    expect(fechado.json().code).toBe("CANAL_FECHADO");
    await dono.query("update agentes set canais = 'api' where id = $1", [agenteId]);
    const peloMcp = await api.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${nova.chave}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(peloMcp.statusCode).toBe(403);
  });

  it("um bilhete da ponte inventado não vale nada", async () => {
    const r = await api.app.inject({
      method: "GET",
      url: "/tarefas",
      headers: { "x-mago-ponte-da-api": "A".repeat(43) },
    });
    expect(r.statusCode).toBe(401);
  });

  it("a documentação é pública e mostra todos os endereços", async () => {
    const o = await api.app.inject({ method: "GET", url: "/openapi.json" });
    expect(o.statusCode).toBe(200);
    const doc = o.json() as { paths: Record<string, Record<string, unknown>> };
    const operacoes = Object.values(doc.paths).flatMap((p) => Object.keys(p));
    expect(operacoes).toHaveLength(14);
    const pagina = await api.app.inject({ method: "GET", url: "/docs" });
    expect(pagina.statusCode).toBe(200);
    expect(pagina.body).toContain("POST /v1/contatos");
  });
});
