/**
 * Chave do agente e agente vivo (M2-04), de ponta a ponta: só o resumo no banco, revogar vale no pedido seguinte,
 * validade, agente pausado, limite de pedidos e de leitura, e a verificação que devolve tarefas de agente sem sinal.
 */

import type { DadosDoAvisoDeAgente } from "@mago-os/nucleo/acesso";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import {
  type AgenteDoPedido,
  contarLeituras,
  registrarRotasDoAgente,
  registrarRotasDosAgentes,
  resumoDaChave,
  verificarAgentesVivos,
} from "@mago-os/nucleo/agentes";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000bb";

describe.skipIf(!bancoDisponivel)("chave do agente e agente vivo", () => {
  const avisos: DadosDoAvisoDeAgente[] = [];
  const LIMITES = { pedidosPorMinuto: 5, leiturasPorHora: 3 };
  let carteiro: {
    enviarLinkDeSenha(): Promise<void>;
    enviarAvisoDeAgente(d: DadosDoAvisoDeAgente): Promise<void>;
  };
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  const vinculos: Record<string, string> = {};
  let ip = 0;

  async function criarPessoa(
    nome: string,
    email: string,
    perfil: string,
    area: string | null,
    empresa = empresaId,
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
    const v = await dono.query<{ id: string }>(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now()) returning id`,
      [empresa, id, perfil, area],
    );
    vinculos[email] = v.rows[0]?.id as string;
  }

  /** Entra com senha e, para quem precisa, marca o 2FA como confirmado (o 2FA tem testes próprios). */
  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.0.${ip}` },
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
    return ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  function pedir(metodo: "GET" | "POST" | "DELETE", url: string, cookie: string, corpo?: unknown) {
    return app.inject({
      method: metodo,
      url,
      headers: { cookie, origin: SITE, ...(corpo ? { "content-type": "application/json" } : {}) },
      ...(corpo ? { payload: JSON.stringify(corpo) } : {}),
    });
  }

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    const e = await dono.query<{ id: string }>(
      "insert into empresas (nome) values ('Empresa Um') returning id",
    );
    empresaId = e.rows[0]?.id as string;
    await dono.query("insert into empresas (id, nome) values ($1, 'Outra Empresa')", [OUTRA]);
    await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador", null);
    await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "comercial");
    await criarPessoa("Fina Financeiro", "fina@teste.invalid", "funcionario", "financeiro");
    await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: { async enviarLinkDeSenha() {} },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasTarefas(app, verificador, poolApp);
    const opcoes = {
      verificador,
      poolApp,
      urlPublica: SITE,
      limites: LIMITES,
      carteiro: {
        async enviarLinkDeSenha() {},
        async enviarAvisoDeAgente(d: DadosDoAvisoDeAgente) {
          avisos.push(d);
        },
      },
    };
    carteiro = opcoes.carteiro;
    registrarRotasDosAgentes(app, opcoes);
    registrarRotasDoAgente(app, opcoes);
    registrarRotasDosAvisos(app, verificador, poolApp);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const cookies: Record<string, string> = {};
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const idDe = async (email: string) =>
    (await dono.query<{ id: string }>("select id from pessoas where email = $1", [email])).rows[0]
      ?.id as string;
  const vivo = (chave: string) =>
    app.inject({ method: "POST", url: "/agente/estou-vivo", headers: { authorization: `Bearer ${chave}` } });
  let agente = "";
  let segredo = "";
  let chaveId = "";

  async function novoAgente(nome: string) {
    const r = await pedir("POST", "/agentes", await como("ana@teste.invalid"), {
      nome,
      responsavelId: await idDe("ana@teste.invalid"),
    });
    return r.json().id as string;
  }
  async function novaChave(agenteId: string, corpo: Record<string, unknown> = { nome: "Teste" }) {
    const r = await pedir("POST", `/agentes/${agenteId}/chaves`, await como("ana@teste.invalid"), corpo);
    expect(r.statusCode).toBe(201);
    return r.json() as { chave: { id: string; prefixo: string }; segredo: string };
  }

  it("a administradora cria a chave: a chave inteira vem uma vez, e o banco guarda só o começo e o resumo", async () => {
    agente = await novoAgente("Claude no Mac");
    const criada = await novaChave(agente, { nome: "Mac do Sandro" });
    segredo = criada.segredo;
    chaveId = criada.chave.id;
    expect(segredo).toMatch(/^mago_ag_[0-9a-z]{10}_[A-Za-z0-9_-]{43}$/);
    expect(segredo.startsWith(criada.chave.prefixo)).toBe(true);
    const linha = await dono.query(
      "select row_to_json(k)::text as t, resumo from chaves_de_agente k where id = $1",
      [chaveId],
    );
    expect(linha.rows[0].t).not.toContain(segredo.slice(-43));
    expect(linha.rows[0].resumo).toBe(resumoDaChave(segredo));
    const lista = await pedir("GET", `/agentes/${agente}/chaves`, await como("ana@teste.invalid"));
    expect(JSON.stringify(lista.json())).not.toContain(segredo.slice(-43));
    expect(
      (await pedir("POST", `/agentes/${agente}/chaves`, await como("fabio@teste.invalid"), { nome: "x" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await pedir("GET", `/agentes/${agente}/chaves`, await como("otto@teste.invalid"))).statusCode,
    ).toBe(404);
  });

  it("a chave certa passa e registra o sinal de vida; formato errado e segredo errado são recusados", async () => {
    const r = await vivo(segredo);
    expect(r.statusCode).toBe(200);
    const sinal = await dono.query("select ultimo_sinal_em from agentes where id = $1", [agente]);
    expect(sinal.rows[0].ultimo_sinal_em).not.toBeNull();
    expect((await vivo("qualquer-coisa")).json().motivo).toBe("formato");
    const trocada = `${segredo.slice(0, -43)}${"A".repeat(43)}`;
    const errada = await vivo(trocada);
    expect(errada.statusCode).toBe(401);
    expect(errada.json().motivo).toBe("desconhecida");
  });

  it("revogar vale no pedido seguinte, e a recusa vai para a auditoria sem a chave", async () => {
    const r = await pedir(
      "POST",
      `/agentes/${agente}/chaves/${chaveId}/revogar`,
      await como("ana@teste.invalid"),
    );
    expect(r.json().revogadaEm).not.toBeNull();
    const depois = await vivo(segredo);
    expect(depois.statusCode).toBe(401);
    expect(depois.json().motivo).toBe("revogada");
    const ev = await dono.query<{ d: string }>(
      "select detalhes::text as d from auditoria.eventos where acao = 'chave.recusou' order by sequencia desc limit 1",
    );
    expect(ev.rows[0]?.d).toContain("revogada");
    expect(ev.rows[0]?.d).not.toContain(segredo.slice(-43));
    const acoes = await dono.query<{ acao: string }>(
      "select acao from auditoria.eventos where alvo->>'id' = $1",
      [chaveId],
    );
    expect(acoes.rows.map((l) => l.acao)).toEqual(["chave.criou", "chave.revogou", "chave.recusou"]);
  });

  it("chave vencida e agente pausado são recusados", async () => {
    const k = await novaChave(agente, {
      nome: "Com validade",
      validaAte: new Date(Date.now() + 60_000).toISOString(),
    });
    expect((await vivo(k.segredo)).statusCode).toBe(200);
    await dono.query(
      "update chaves_de_agente set criada_em = now() - interval '2 days', valida_ate = now() - interval '1 day' where id = $1",
      [k.chave.id],
    );
    expect((await vivo(k.segredo)).json().motivo).toBe("vencida");
    const outra = await novaChave(agente);
    await pedir("POST", `/agentes/${agente}/pausar`, await como("ana@teste.invalid"));
    const pausado = await vivo(outra.segredo);
    expect(pausado.statusCode).toBe(403);
    expect(pausado.json().motivo).toBe("agente_pausado");
    await pedir("POST", `/agentes/${agente}/retomar`, await como("ana@teste.invalid"));
    expect((await vivo(outra.segredo)).statusCode).toBe(200);
  });

  it("passou do limite de pedidos por minuto: recusa, pausa o agente e avisa a responsável no Mago OS e por e-mail", async () => {
    const outro = await novoAgente("Apressado");
    const k = await novaChave(outro);
    const status: number[] = [];
    for (let i = 0; i < LIMITES.pedidosPorMinuto + 1; i += 1) status.push((await vivo(k.segredo)).statusCode);
    expect(status.at(-1)).toBe(429);
    expect(status.slice(0, -1).every((s) => s === 200)).toBe(true);
    const sit = await dono.query("select situacao from agentes where id = $1", [outro]);
    expect(sit.rows[0].situacao).toBe("pausado");
    expect(avisos.at(-1)).toMatchObject({ agente: "Apressado" });
    const lista = await pedir("GET", "/avisos", await como("ana@teste.invalid"));
    const aviso = lista.json().find((a: { tipo: string }) => a.tipo === "agente_passou_do_limite");
    expect(aviso.link).toBe(`/agentes/${outro}`);
    expect(
      (await pedir("POST", `/avisos/${aviso.id}/lido`, await como("ana@teste.invalid"))).statusCode,
    ).toBe(200);
    expect(
      (await pedir("POST", `/avisos/${aviso.id}/lido`, await como("fabio@teste.invalid"))).statusCode,
    ).toBe(404);
  });

  it("passou do limite de leitura por hora: pausa o agente", async () => {
    const leitor = await novoAgente("Leitor");
    const k = await novaChave(leitor);
    const pedido: AgenteDoPedido = { empresaId, agenteId: leitor, chaveId: k.chave.id };
    const o = {
      poolApp,
      carteiro,
      urlPublica: SITE,
      log: console,
      origem: { canal: "mcp" as const, ip: null, aparelho: null },
      limites: LIMITES,
    };
    expect(await contarLeituras(pedido, 2, o)).toBe(true);
    expect(await contarLeituras(pedido, 2, o)).toBe(false);
    const sit = await dono.query("select situacao from agentes where id = $1", [leitor]);
    expect(sit.rows[0].situacao).toBe("pausado");
  });

  it("agente sem sinal há mais que o limite perde a tarefa pegada, com comentário e aviso; quem deu sinal não perde", async () => {
    const sumido = await novoAgente("Sumido");
    const ativo = await novoAgente("Ativo");
    const t1 = await dono.query<{ id: string }>(
      `insert into tarefas (empresa_id, titulo, status, travada_por_agente_id, travada_em, responsavel_agente_id)
       values ($1, 'Do sumido', 'em_andamento', $2, now() - interval '20 minutes', $2) returning id`,
      [empresaId, sumido],
    );
    const t2 = await dono.query<{ id: string }>(
      `insert into tarefas (empresa_id, titulo, status, travada_por_agente_id, travada_em, responsavel_agente_id)
       values ($1, 'Do ativo', 'em_andamento', $2, now() - interval '20 minutes', $2) returning id`,
      [empresaId, ativo],
    );
    await dono.query("update agentes set ultimo_sinal_em = now() - interval '1 minute' where id = $1", [
      ativo,
    ]);
    const antes = avisos.length;
    const devolvidas = await verificarAgentesVivos({ poolApp, carteiro, urlPublica: SITE, log: console });
    expect(devolvidas).toBe(1);
    const do1 = await dono.query("select status, travada_em from tarefas where id = $1", [t1.rows[0]?.id]);
    expect(do1.rows[0]).toMatchObject({ status: "a_fazer", travada_em: null });
    const do2 = await dono.query("select status from tarefas where id = $1", [t2.rows[0]?.id]);
    expect(do2.rows[0].status).toBe("em_andamento");
    const c = await dono.query("select texto from comentarios_de_tarefa where tarefa_id = $1", [
      t1.rows[0]?.id,
    ]);
    expect(c.rows[0].texto).toContain("sem sinal");
    expect(avisos.length).toBe(antes + 1);
    expect(avisos.at(-1)).toMatchObject({
      agente: "Sumido",
      oQueAconteceu: "ficou sem sinal",
      tarefas: ["Do sumido"],
    });
    const ev = await dono.query(
      "select 1 from auditoria.eventos where acao = 'agente.sem_sinal' and alvo->>'id' = $1",
      [sumido],
    );
    expect(ev.rowCount).toBe(1);
    // Rodar de novo não faz nada: a tarefa já voltou.
    expect(await verificarAgentesVivos({ poolApp, carteiro, urlPublica: SITE, log: console })).toBe(0);
  });

  it("desligar o agente também avisa no Mago OS", async () => {
    await pedir("POST", `/agentes/${agente}/desligar`, await como("ana@teste.invalid"));
    const lista = await pedir("GET", "/avisos", await como("ana@teste.invalid"));
    expect(lista.json().some((a: { tipo: string }) => a.tipo === "agente_desligado")).toBe(true);
  });
});
