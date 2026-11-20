/**
 * Agentes internos (M4-02) com um modelo falso roteirizado (sem custo): a pessoa pede ao coordenador no app, ele cria
 * a tarefa e passa ao Gerente de projetos, que planeja subtarefas e checklist e atribui; o resultado aparece na
 * tarefa e na conversa. Os testes provam também: o agente age com a permissão de quem pediu, o reserva entra quando
 * o principal falha, o conteúdo de fora vai marcado como dado, e uma empresa não vê a conversa da outra.
 */
import { randomBytes } from "node:crypto";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarRotasDosAgentes } from "@mago-os/nucleo/agentes";
import {
  type OpcoesDoMotor,
  registrarRotasDaConversa,
  rodarExecucao,
  verificarExecucoesEsquecidas,
} from "@mago-os/nucleo/agentes-internos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import {
  criarCofre,
  ErroDoModelo,
  modelosFalsos,
  type PedidoAoModelo,
  provedoresFalsos,
  registrarRotasDasContasDeIa,
} from "@mago-os/nucleo/contas-de-ia";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000d4";
const CHAVE = "sk-ant-api03-chave-dos-agentes-Ag01";
const CHAVE_RESERVA = "sk-ant-api03-chave-do-reserva-Rs01";

/** O id da tarefa no último resultado de ferramenta que o modelo recebeu. */
function ultimoResultado(p: PedidoAoModelo): Record<string, unknown> {
  const r = [...p.partes].reverse().find((x) => x.papel === "resultado");
  if (r?.papel !== "resultado") throw new Error("sem resultado");
  // Todo resultado chega ao modelo marcado como conteúdo externo.
  const dentro = /^<conteudo_externo>\n([\s\S]*)\n<\/conteudo_externo>$/.exec(r.conteudo)?.[1];
  if (!dentro) throw new Error("resultado sem a marcação de conteúdo externo");
  return JSON.parse(dentro) as Record<string, unknown>;
}

describe.skipIf(!bancoDisponivel)("agentes internos", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let ip = 0;
  const fila: { empresaId: string; execucaoId: string }[] = [];
  const ids: Record<string, string> = {};
  let roteiro: Parameters<typeof modelosFalsos>[0] = [];
  const modelos = modelosFalsos([]);
  let motor: OpcoesDoMotor;

  async function criarPessoa(nome: string, email: string, perfil: string, empresa = empresaId) {
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
         values ($1, $2, $3, null, 'ativo', now(), now() + ($4 || ' seconds')::interval)`,
      [empresa, id, perfil, String(Object.keys(ids).length)],
    );
    return id;
  }

  const cookies: Record<string, string> = {};
  async function como(email: string): Promise<string> {
    if (cookies[email]) return cookies[email];
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.13.${ip}` },
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

  /** Roda tudo o que está na fila (e o que a fila ganhar no caminho), como a fila de verdade faria. */
  async function rodarFila() {
    while (fila.length > 0) {
      const t = fila.shift() as { empresaId: string; execucaoId: string };
      await rodarExecucao(motor, t.empresaId, t.execucaoId);
    }
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
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", OUTRA);

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
    registrarRotasDosAgentes(app, { verificador, poolApp, carteiro, urlPublica: SITE } as Parameters<
      typeof registrarRotasDosAgentes
    >[1]);
    const cofre = criarCofre({ atual: { versao: 1, chave: randomBytes(32) }, anteriores: [] });
    registrarRotasDasContasDeIa(app, {
      verificador,
      poolApp,
      cofre,
      provedores: provedoresFalsos({ [CHAVE]: ["modelo-bom"], [CHAVE_RESERVA]: ["modelo-reserva"] }),
      ambiente: "teste",
    });
    const acordar = (empresa: string, execucaoId: string) => fila.push({ empresaId: empresa, execucaoId });
    registrarRotasDaConversa(app, { verificador, poolApp, acordar });
    motor = {
      poolApp,
      cofre,
      modelos: {
        conversar: (a, p) => {
          // O roteiro de cada teste é trocado sem recriar o motor.
          const passo = roteiro.shift();
          return modelosFalsos(passo ? [passo] : [])
            .conversar(a, p)
            .then((r) => {
              modelos.pedidos.push(p);
              modelos.acessos.push(a);
              return r;
            });
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
      acordar,
    };
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  it("a empresa nasce com o Coordenador e o Gerente de projetos, pausados, e só liga com modelo", async () => {
    const ana = await como("ana@teste.invalid");
    const agentes = (await pedir("GET", "/agentes", ana)).json() as {
      id: string;
      nome: string;
      tipo: string;
      papel: string;
      situacao: string;
      respondeAId: string | null;
      responsavelId: string;
    }[];
    const coordenador = agentes.find((a) => a.papel === "coordenador");
    const gerente = agentes.find((a) => a.papel === "especialista");
    expect(coordenador).toMatchObject({
      nome: "Coordenador",
      tipo: "interno",
      situacao: "pausado",
      responsavelId: ids.ana,
    });
    expect(gerente).toMatchObject({ nome: "Gerente de projetos", respondeAId: coordenador?.id });
    ids.coordenador = coordenador?.id as string;
    ids.gerente = gerente?.id as string;
    // Chamar de novo não cria outros.
    expect(((await pedir("GET", "/agentes", ana)).json() as unknown[]).length).toBe(agentes.length);

    const sem = await pedir("POST", `/agentes/${ids.coordenador}/retomar`, ana, {});
    expect(sem.statusCode).toBe(409);
    expect(sem.json().code).toBe("SEM_MODELO");

    // Pausado: a mensagem é recusada com a explicação.
    const flora = await como("flora@teste.invalid");
    const recusada = await pedir("POST", "/conversas/mensagens", flora, { texto: "oi" });
    expect(recusada.json().code).toBe("AGENTE_PAUSADO");

    for (const [nome, chave, modelo] of [
      ["Principal", CHAVE, "modelo-bom"],
      ["Reserva", CHAVE_RESERVA, "modelo-reserva"],
    ] as const) {
      const conta = await pedir("POST", "/ia/contas", ana, { nome, provedor: "anthropic", chave });
      ids[nome] = conta.json().id;
      await pedir("POST", `/ia/contas/${ids[nome]}/modelos`, ana, { modelos: [{ modelo, liberado: true }] });
    }
    const liberados = (await pedir("GET", "/ia/modelos", ana)).json() as { modelo: string }[];
    expect(liberados.map((m) => m.modelo)).toEqual(["modelo-bom", "modelo-reserva"]);
    for (const agente of [ids.coordenador, ids.gerente]) {
      const escolha = await pedir("POST", `/agentes/${agente}/modelos`, ana, {
        modelos: {
          principal: { contaId: ids.Principal, modelo: "modelo-bom" },
          reserva: { contaId: ids.Reserva, modelo: "modelo-reserva" },
        },
      });
      expect(escolha.statusCode).toBe(200);
      expect((await pedir("POST", `/agentes/${agente}/retomar`, ana, {})).statusCode).toBe(200);
    }
  });

  it("pedido no app: o coordenador cria e delega, o Gerente planeja e atribui, e tudo aparece", async () => {
    const ana = await como("ana@teste.invalid");
    roteiro = [
      // Coordenador: cria a tarefa com o prazo.
      () => ({
        chamadas: [
          {
            id: "c1",
            nome: "criar_tarefa",
            entrada: { titulo: "Migrar o blog para o WordPress novo", prazo: { dia: "2030-11-22" } },
          },
        ],
      }),
      // Passa ao Gerente de projetos.
      (p) => {
        ids.tarefa = (ultimoResultado(p).tarefa as { id: string }).id;
        return {
          chamadas: [
            {
              id: "c2",
              nome: "delegar",
              entrada: {
                tarefaId: ids.tarefa,
                agenteId: ids.gerente,
                instrucoes: "Planeje em subtarefas e checklist.",
              },
            },
          ],
        };
      },
      () => ({
        chamadas: [
          {
            id: "c3",
            nome: "responder",
            entrada: { texto: "Criei a tarefa e passei ao Gerente de projetos.", tarefas: [ids.tarefa] },
          },
        ],
      }),
      // Gerente: planeja.
      () => ({
        chamadas: [
          {
            id: "g1",
            nome: "planejar",
            entrada: {
              tarefaId: ids.tarefa,
              subtarefas: [
                { titulo: "Exportar os posts" },
                { titulo: "Configurar o tema", prioridade: "alta" },
              ],
              checklist: ["Fazer backup", "Avisar a equipe"],
            },
          },
        ],
      }),
      // Atribui a primeira subtarefa à Flora.
      (p) => {
        const subs = ultimoResultado(p).subtarefas as { id: string }[];
        ids.sub = subs[0]?.id as string;
        return {
          chamadas: [
            {
              id: "g2",
              nome: "atribuir",
              entrada: { tarefaId: ids.sub, responsavel: { tipo: "pessoa", pessoaId: ids.flora } },
            },
          ],
        };
      },
      () => ({
        chamadas: [
          { id: "g3", nome: "responder", entrada: { texto: "Plano pronto: 2 subtarefas e checklist." } },
        ],
      }),
    ];
    const r = await pedir("POST", "/conversas/mensagens", ana, {
      texto: "planeja a migração do blog para o WordPress novo, com prazo sexta",
    });
    expect(r.statusCode).toBe(201);
    ids.conversa = r.json().conversa.id;
    await rodarFila();

    const tarefa = await dono.query<{
      criada_por_agente_id: string;
      responsavel_agente_id: string;
      travada_por_agente_id: string | null;
    }>(
      "select criada_por_agente_id, responsavel_agente_id, travada_por_agente_id from tarefas where id = $1",
      [ids.tarefa],
    );
    expect(tarefa.rows[0]).toMatchObject({
      criada_por_agente_id: ids.coordenador,
      responsavel_agente_id: ids.gerente,
      // O Gerente pegou a tarefa para trabalhar e soltou no fim.
      travada_por_agente_id: null,
    });
    const subs = await dono.query<{
      titulo: string;
      responsavel_pessoa_id: string | null;
      prioridade: string | null;
    }>(
      "select titulo, responsavel_pessoa_id, prioridade from tarefas where tarefa_mae_id = $1 order by titulo",
      [ids.tarefa],
    );
    expect(subs.rows.map((s) => s.titulo)).toEqual(["Configurar o tema", "Exportar os posts"]);
    expect(subs.rows.find((s) => s.titulo === "Exportar os posts")?.responsavel_pessoa_id).toBe(ids.flora);
    expect(subs.rows.find((s) => s.titulo === "Configurar o tema")?.prioridade).toBe("alta");
    const itens = await dono.query("select 1 from itens_de_checklist where tarefa_id = $1", [ids.tarefa]);
    expect(itens.rowCount).toBe(2);
    const comentario = await dono.query<{ texto: string }>(
      "select texto from comentarios_de_tarefa where tarefa_id = $1 and autor_agente_id = $2",
      [ids.tarefa, ids.gerente],
    );
    expect(comentario.rows[0]?.texto).toContain("Plano pronto");

    const conversa = (await pedir("GET", `/conversas/${ids.conversa}`, ana)).json() as {
      mensagens: { autor: { tipo: string; agenteId?: string }; texto: string; tarefas: string[] }[];
      emAndamento: number;
    };
    expect(conversa.emAndamento).toBe(0);
    expect(conversa.mensagens.map((m) => m.autor.tipo)).toEqual(["pessoa", "agente", "agente"]);
    expect(conversa.mensagens[1]).toMatchObject({ texto: "Criei a tarefa e passei ao Gerente de projetos." });
    expect(conversa.mensagens[2]?.texto).toContain("Gerente de projetos: Plano pronto");
    expect(conversa.mensagens[1]?.tarefas).toContain(ids.tarefa);

    const execucoes = await dono.query<{
      situacao: string;
      origem: string;
      pedido_por: string;
      modelo: string;
    }>(
      "select situacao, origem, pedido_por, modelo from execucoes_de_agente where empresa_id = $1 order by criada_em",
      [empresaId],
    );
    expect(execucoes.rows).toEqual([
      { situacao: "concluida", origem: "conversa", pedido_por: ids.ana, modelo: "modelo-bom" },
      { situacao: "concluida", origem: "delegacao", pedido_por: ids.ana, modelo: "modelo-bom" },
    ]);
    // O conteúdo da tarefa chegou ao Gerente marcado como dado, e as ferramentas certas para cada papel.
    const doGerente = modelos.pedidos.find((p) => p.sistema.includes("Gerente de projetos desta empresa"));
    const primeira = doGerente?.partes[0];
    expect(primeira?.papel === "usuario" && primeira.texto).toContain("<conteudo_externo>");
    expect(doGerente?.ferramentas.map((f) => f.nome)).toContain("planejar");
    const doCoordenador = modelos.pedidos.find((p) => p.sistema.includes("coordenador dos agentes"));
    expect(doCoordenador?.ferramentas.map((f) => f.nome)).not.toContain("planejar");
    expect(doCoordenador?.sistema).toContain(ids.gerente);
  });

  it("o agente age com a permissão de quem pediu: a funcionária não alcança a tarefa da Ana", async () => {
    const flora = await como("flora@teste.invalid");
    roteiro = [
      () => ({
        chamadas: [
          {
            id: "f1",
            nome: "delegar",
            entrada: { tarefaId: ids.tarefa, agenteId: ids.gerente, instrucoes: "Mude tudo." },
          },
        ],
      }),
      (p) => {
        const r = [...p.partes].reverse().find((x) => x.papel === "resultado");
        ids.recusa = r?.papel === "resultado" && r.erro ? r.conteudo : "";
        return {
          chamadas: [
            { id: "f2", nome: "responder", entrada: { texto: "Você não tem acesso a essa tarefa." } },
          ],
        };
      },
    ];
    const r = await pedir("POST", "/conversas/mensagens", flora, {
      texto: `passa a tarefa ${ids.tarefa} adiante`,
    });
    expect(r.statusCode).toBe(201);
    await rodarFila();
    expect(ids.recusa).toContain("não encontrada");
    const delegacoes = await dono.query("select 1 from execucoes_de_agente where origem = 'delegacao'");
    expect(delegacoes.rowCount).toBe(1);
    // A conversa da Ana continua só dela.
    expect((await pedir("GET", `/conversas/${ids.conversa}`, flora)).statusCode).toBe(404);
  });

  it("o reserva entra quando o principal falha, e isso fica registrado", async () => {
    const ana = await como("ana@teste.invalid");
    roteiro = [
      () => {
        throw new ErroDoModelo("O provedor está com problema (erro 529).");
      },
      () => ({ texto: "Respondi pelo reserva." }),
    ];
    const r = await pedir("POST", "/conversas/mensagens", ana, {
      conversaId: ids.conversa,
      texto: "e o status?",
    });
    expect(r.statusCode).toBe(201);
    await rodarFila();
    const e = await dono.query<{ modelo: string; passou_ao_reserva_porque: string }>(
      "select modelo, passou_ao_reserva_porque from execucoes_de_agente where id = $1",
      [r.json().execucaoId],
    );
    expect(e.rows[0]).toEqual({
      modelo: "modelo-reserva",
      passou_ao_reserva_porque: "O provedor está com problema (erro 529).",
    });
    expect(modelos.acessos.at(-1)?.chave).toBe(CHAVE_RESERVA);
  });

  it("execução esquecida: a da fila volta para a fila; a que rodava há tempo demais é encerrada e avisada", async () => {
    const velha = await dono.query<{ id: string }>(
      `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, conversa_id, criada_em)
       values ($1, $2, $3, 'conversa', $4, now() - interval '5 minutes') returning id`,
      [empresaId, ids.coordenador, ids.ana, ids.conversa],
    );
    const presa = await dono.query<{ id: string }>(
      `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, conversa_id, situacao, criada_em,
         iniciada_em)
       values ($1, $2, $3, 'conversa', $4, 'rodando', now() - interval '1 hour', now() - interval '1 hour')
       returning id`,
      [empresaId, ids.coordenador, ids.ana, ids.conversa],
    );
    fila.length = 0;
    expect(await verificarExecucoesEsquecidas(motor)).toBe(2);
    expect(fila.map((f) => f.execucaoId)).toEqual([velha.rows[0]?.id]);
    const e = await dono.query<{ situacao: string }>(
      "select situacao from execucoes_de_agente where id = $1",
      [presa.rows[0]?.id],
    );
    expect(e.rows[0]?.situacao).toBe("falhou");
    // A da fila roda agora (o roteiro vazio responde "Pronto.") e a conversa recebe o aviso da presa.
    roteiro = [];
    await rodarFila();
    const ana = await como("ana@teste.invalid");
    const conversa = (await pedir("GET", `/conversas/${ids.conversa}`, ana)).json() as {
      mensagens: { texto: string }[];
      emAndamento: number;
    };
    expect(conversa.emAndamento).toBe(0);
    expect(conversa.mensagens.some((m) => m.texto.includes("parou no meio"))).toBe(true);
  });

  it("delegação com a tarefa pegada por outra pessoa não roda (e não gasta modelo)", async () => {
    await dono.query(
      "update tarefas set status = 'em_andamento', travada_por_pessoa_id = $2, travada_em = now(), responsavel_agente_id = $3 where id = $1",
      [ids.tarefa, ids.ana, ids.gerente],
    );
    const e = await dono.query<{ id: string }>(
      `insert into execucoes_de_agente (empresa_id, agente_id, pedido_por, origem, tarefa_id, execucao_mae_id)
       select $1, $2, $3, 'delegacao', $4, id from execucoes_de_agente where conversa_id = $5 limit 1 returning id`,
      [empresaId, ids.gerente, ids.ana, ids.tarefa, ids.conversa],
    );
    const antes = modelos.pedidos.length;
    await rodarExecucao(motor, empresaId, e.rows[0]?.id as string);
    expect(modelos.pedidos.length).toBe(antes);
    const r = await dono.query<{ situacao: string }>(
      "select situacao from execucoes_de_agente where id = $1",
      [e.rows[0]?.id],
    );
    expect(r.rows[0]?.situacao).toBe("parada");
    await dono.query(
      "update tarefas set status = 'a_fazer', travada_por_pessoa_id = null, travada_em = null where id = $1",
      [ids.tarefa],
    );
  });

  it("uma empresa não vê a conversa nem as execuções da outra", async () => {
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", `/conversas/${ids.conversa}`, otto)).statusCode).toBe(404);
    const lista = (await pedir("GET", "/conversas", otto)).json() as { conversas: unknown[] };
    expect(lista.conversas).toEqual([]);
    const c = await poolApp.connect();
    try {
      await c.query("begin");
      await c.query(
        "select set_config('mago.empresa_id', $1, true), set_config('mago.pessoa_id', $2, true)",
        [OUTRA, ids.otto],
      );
      expect((await c.query("select 1 from execucoes_de_agente")).rowCount).toBe(0);
      expect((await c.query("select 1 from mensagens_de_conversa")).rowCount).toBe(0);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});
