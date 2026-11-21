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
  registrarRotasDasAprovacoes,
  rodarExecucao,
  verificarAprovacoesVencidas,
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
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000d4";
const CHAVE = "sk-ant-api03-chave-dos-agentes-Ag01";
const CHAVE_RESERVA = "sk-ant-api03-chave-do-reserva-Rs01";
const TOKEN_DO_PLANO = "sk-ant-oat01-token-do-plano-Pl01";

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
  const errosDoMotor: string[] = [];
  const pedidosAoClaudeCode: { token: string; modelo: string; prompt: string; ferramentas: string[] }[] = [];
  let roteiroDoClaudeCode: NonNullable<OpcoesDoMotor["claudeCode"]> = async () => ({
    texto: "Pronto.",
    tokens: { entrada: 0, saida: 0, cache: 0 },
  });

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
      provedores: provedoresFalsos({
        [CHAVE]: ["modelo-bom"],
        [CHAVE_RESERVA]: ["modelo-reserva"],
        [TOKEN_DO_PLANO]: ["modelo-do-plano"],
      }),
      ambiente: "teste",
    });
    const acordar = (empresa: string, execucaoId: string) => fila.push({ empresaId: empresa, execucaoId });
    registrarRotasDaConversa(app, { verificador, poolApp, acordar });
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
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
      log: {
        error: (o: unknown) => errosDoMotor.push(String((o as { erro?: Error }).erro?.message ?? o)),
        warn: () => {},
      },
      acordar,
      // Claude Code falso: segue o roteiro do teste (chama as ferramentas do Mago OS como o de verdade).
      claudeCode: async (p) => {
        pedidosAoClaudeCode.push({
          token: p.token,
          modelo: p.modelo,
          prompt: p.prompt,
          ferramentas: p.ferramentas.map((f) => f.nome),
        });
        return roteiroDoClaudeCode(p);
      },
    };
    registrarRotasDasAprovacoes(app, {
      verificador,
      poolApp,
      catalogo: catalogoDeModulos(),
      opcoesMcp: motor.opcoesMcp,
      acordar,
    });
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
    // Atribuir a outra pessoa pede aprovação (M4-03): ainda não foi atribuída.
    expect(subs.rows.find((s) => s.titulo === "Exportar os posts")?.responsavel_pessoa_id).toBeNull();
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

    // O pedido de aprovação: aparece para a Ana (quem pediu) na lista e na central de prioridades.
    const pendentes = (await pedir("GET", "/aprovacoes?situacao=pendente", ana)).json() as {
      id: string;
      acao: string;
      resumo: string;
      motivo: string | null;
      conferencia: string;
    }[];
    expect(pendentes).toHaveLength(1);
    const pedido = pendentes[0] as (typeof pendentes)[number];
    expect(pedido).toMatchObject({ acao: "atribuir", resumo: "Atribuir “Exportar os posts” a Flora Func" });
    expect(pedido.motivo).toBe("Planeje em subtarefas e checklist.");
    const prioridades = (
      (await pedir("GET", "/prioridades", ana)).json() as { itens: { tipo: string; link: string }[] }
    ).itens;
    expect(prioridades.find((p) => p.tipo === "aprovacao")?.link).toBe(`/aprovacoes/${pedido.id}`);
    // A Flora (funcionária, não pediu nem é responsável) não vê nem decide.
    const flora = await como("flora@teste.invalid");
    expect((await pedir("GET", `/aprovacoes/${pedido.id}`, flora)).statusCode).toBe(404);
    // Conferência errada: recusa (o pedido mudou desde que abriu).
    const errada = await pedir("POST", `/aprovacoes/${pedido.id}/decidir`, ana, {
      decisao: "aprovar",
      conferencia: "0".repeat(64),
    });
    expect(errada.statusCode).toBe(409);
    const aprovada = await pedir("POST", `/aprovacoes/${pedido.id}/decidir`, ana, {
      decisao: "aprovar",
      conferencia: pedido.conferencia,
    });
    expect(aprovada.statusCode).toBe(200);
    expect(aprovada.json()).toMatchObject({ situacao: "aprovada", decididaPor: ids.ana, editada: false });
    const depois = await dono.query<{ responsavel_pessoa_id: string }>(
      "select responsavel_pessoa_id from tarefas where tarefa_mae_id = $1 and titulo = 'Exportar os posts'",
      [ids.tarefa],
    );
    expect(depois.rows[0]?.responsavel_pessoa_id).toBe(ids.flora);
    const noticia = (await pedir("GET", `/conversas/${ids.conversa}`, ana)).json() as {
      mensagens: { texto: string }[];
    };
    expect(noticia.mensagens.at(-1)?.texto).toContain("Ana Admin aprovou: Atribuir");
    // Decidido não decide de novo.
    expect(
      (
        await pedir("POST", `/aprovacoes/${pedido.id}/decidir`, ana, {
          decisao: "aprovar",
          conferencia: pedido.conferencia,
        })
      ).statusCode,
    ).toBe(409);

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

  it("procurar projeto: acha pelo nome sem acento e a tarefa nasce no projeto", async () => {
    const ana = await como("ana@teste.invalid");
    // Pelas rotas de sempre: o projeto nasce com a lista e os status padrão.
    const espaco = await pedir("POST", "/espacos", ana, { nome: "Marketing" });
    const projeto = await pedir("POST", "/projetos", ana, {
      espacoId: espaco.json().id,
      nome: "Blog Institucional",
    });
    expect(projeto.statusCode).toBe(201);
    ids.projeto = projeto.json().id;
    roteiro = [
      () => ({ chamadas: [{ id: "p1", nome: "procurar_projeto", entrada: { nome: "blog institucionál" } }] }),
      (p) => {
        const achados = ultimoResultado(p).projetos as { id: string; nome: string }[];
        expect(achados).toEqual([{ id: ids.projeto, nome: "Blog Institucional" }]);
        return {
          chamadas: [
            {
              id: "p2",
              nome: "criar_tarefa",
              entrada: { titulo: "Post de lançamento", projetoId: ids.projeto },
            },
          ],
        };
      },
      () => ({
        chamadas: [
          { id: "p3", nome: "responder", entrada: { texto: "Criei no projeto Blog Institucional." } },
        ],
      }),
    ];
    const r = await pedir("POST", "/conversas/mensagens", ana, {
      texto: "cria um post de lançamento no projeto blog",
    });
    expect(r.statusCode).toBe(201);
    await rodarFila();
    expect(errosDoMotor).toEqual([]);
    const t = await dono.query<{ projeto_id: string }>(
      "select projeto_id from tarefas where titulo = 'Post de lançamento'",
    );
    expect(t.rows[0]?.projeto_id).toBe(ids.projeto);
  });

  it("listar tarefas: o agente vê as tarefas que quem pediu vê, com filtro de texto", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    let vistas: { titulo: string; projeto: string | null; responsavel: string | null }[] = [];
    roteiro = [
      () => ({ chamadas: [{ id: "l1", nome: "listar_tarefas", entrada: { texto: "migrar" } }] }),
      (p) => {
        vistas = ultimoResultado(p).tarefas as typeof vistas;
        return { chamadas: [{ id: "l2", nome: "responder", entrada: { texto: "Achei." } }] };
      },
    ];
    await pedir("POST", "/conversas/mensagens", ana, { texto: "quais tarefas falam de migrar?" });
    await rodarFila();
    expect(vistas.map((t) => t.titulo)).toEqual(["Migrar o blog para o WordPress novo"]);
    expect(vistas[0]?.responsavel).toBe("Gerente de projetos");
    // A funcionária não vê a tarefa da Ana: a lista dela vem sem ela.
    roteiro = [
      () => ({ chamadas: [{ id: "l3", nome: "listar_tarefas", entrada: {} }] }),
      (p) => {
        vistas = ultimoResultado(p).tarefas as typeof vistas;
        return { chamadas: [{ id: "l4", nome: "responder", entrada: { texto: "Ok." } }] };
      },
    ];
    await pedir("POST", "/conversas/mensagens", flora, { texto: "liste todas as tarefas" });
    await rodarFila();
    expect(vistas.map((t) => t.titulo)).not.toContain("Migrar o blog para o WordPress novo");
  });

  it("ferramentas de consulta e de ajuste: pessoa, tarefa, comentário, prazo, projeto, checklist, prioridades e busca", async () => {
    const ana = await como("ana@teste.invalid");
    // A tarefa é do Gerente: para o Coordenador mexer nela, a Ana libera as duas ações (executa_nas_dele por padrão).
    const regras = await pedir("POST", `/agentes/${ids.coordenador}/regras`, ana, {
      regras: [
        { acao: "mudar_projeto", modo: "executa" },
        { acao: "acrescentar_checklist", modo: "executa" },
      ],
    });
    expect(regras.statusCode).toBe(200);
    const resultados: Record<string, Record<string, unknown>> = {};
    const chamar = (id: string, nome: string, entrada: unknown) => () => ({
      chamadas: [{ id, nome, entrada }],
    });
    const guardar =
      (
        chave: string,
        proximo: () => Partial<{ chamadas: { id: string; nome: string; entrada: unknown }[] }>,
      ) =>
      (p: PedidoAoModelo) => {
        const r = [...p.partes].reverse().find((x) => x.papel === "resultado");
        if (r?.papel !== "resultado") throw new Error("sem resultado");
        resultados[chave] = r.erro ? { erro: r.conteudo } : ultimoResultado(p);
        return proximo();
      };
    roteiro = [
      chamar("a", "procurar_pessoa", { nome: "flóra" }),
      guardar("pessoa", chamar("b", "ver_tarefa", { tarefaId: ids.tarefa })),
      guardar(
        "tarefa",
        chamar("c", "comentar", { tarefaId: ids.tarefa, texto: "Comentário do coordenador." }),
      ),
      guardar("comentario", chamar("d", "mudar_prazo", { tarefaId: ids.tarefa, prioridade: "urgente" })),
      guardar("prazo", chamar("e", "mudar_projeto", { tarefaId: ids.tarefa, projetoId: ids.projeto })),
      guardar(
        "projeto",
        chamar("f", "acrescentar_checklist", { tarefaId: ids.tarefa, itens: ["Revisar links"] }),
      ),
      guardar("checklist", chamar("g", "minhas_prioridades", {})),
      guardar("prioridades", chamar("h", "buscar", { texto: "wordpres" })),
      guardar("busca", chamar("i", "responder", { texto: "Feito." })),
    ];
    await pedir("POST", "/conversas/mensagens", ana, { texto: "faz uma porção de coisas" });
    await rodarFila();
    expect(resultados.pessoa?.encontrados).toEqual([
      { tipo: "pessoa", id: ids.flora, nome: "Flora Func", area: null },
    ]);
    expect((resultados.tarefa?.tarefa as { titulo: string } | undefined)?.titulo).toBe(
      "Migrar o blog para o WordPress novo",
    );
    expect(resultados.tarefa?.subtarefas).toHaveLength(2);
    expect(resultados.comentario?.comentarioId).toBeTruthy();
    // Mudar prazo e prioridade pede aprovação (decisão 6): vira pedido, e nada muda ainda.
    expect(resultados.prazo?.pedidoDeAprovacao).toBeTruthy();
    expect(resultados.projeto).toEqual({ ok: true, projetoId: ids.projeto });
    expect(resultados.checklist).toEqual({ acrescentados: 1 });
    expect(Array.isArray(resultados.prioridades?.itens)).toBe(true);
    expect(JSON.stringify(resultados.busca)).toContain("Migrar o blog");
    // A funcionária só se acha a si mesma (o alcance de pessoas dela é "meus").
    const flora = await como("flora@teste.invalid");
    roteiro = [
      chamar("j", "procurar_pessoa", { nome: "ana" }),
      guardar("daFlora", chamar("k", "responder", { texto: "Ok." })),
    ];
    await pedir("POST", "/conversas/mensagens", flora, { texto: "quem é a Ana?" });
    await rodarFila();
    expect(resultados.daFlora?.encontrados).toEqual([]);
  });

  it("regras: bloquear, só o responsável restringe, recusar com motivo, editar antes de aprovar e vencer em 24 horas", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    // A Flora não é responsável pelo agente: não muda regra nenhuma.
    expect(
      (
        await pedir("POST", `/agentes/${ids.coordenador}/regras`, flora, {
          regras: [{ acao: "comentar", modo: "bloqueado" }],
        })
      ).statusCode,
    ).toBe(403);
    // Ação que só lê não pede aprovação.
    expect(
      (
        await pedir("POST", `/agentes/${ids.coordenador}/regras`, ana, {
          regras: [{ acao: "buscar", modo: "pede_aprovacao" }],
        })
      ).statusCode,
    ).toBe(400);
    // Bloquear comentar: a ferramenta recusa, e fica na auditoria.
    await pedir("POST", `/agentes/${ids.coordenador}/regras`, ana, {
      regras: [{ acao: "comentar", modo: "bloqueado" }],
    });
    const lista = (await pedir("GET", `/agentes/${ids.coordenador}/regras`, ana)).json() as {
      regras: { acao: string; modo: string; ajustada: boolean }[];
      podeMudar: string;
    };
    expect(lista.podeMudar).toBe("tudo");
    expect(lista.regras.find((r) => r.acao === "comentar")).toMatchObject({
      modo: "bloqueado",
      ajustada: true,
    });
    let recusa = "";
    roteiro = [
      () => ({ chamadas: [{ id: "r1", nome: "comentar", entrada: { tarefaId: ids.tarefa, texto: "oi" } }] }),
      (p) => {
        const r = [...p.partes].reverse().find((x) => x.papel === "resultado");
        recusa = r?.papel === "resultado" && r.erro ? r.conteudo : "";
        return { chamadas: [{ id: "r2", nome: "responder", entrada: { texto: "Não posso comentar." } }] };
      },
    ];
    await pedir("POST", "/conversas/mensagens", ana, { texto: "comenta na tarefa" });
    await rodarFila();
    expect(recusa).toContain("bloqueada pela regra");
    const bloqueio = await dono.query(
      "select 1 from auditoria.eventos where acao = 'agente.bloqueado' and empresa_id = $1",
      [empresaId],
    );
    expect(bloqueio.rowCount).toBeGreaterThan(0);
    // Volta ao padrão (null).
    await pedir("POST", `/agentes/${ids.coordenador}/regras`, ana, {
      regras: [{ acao: "comentar", modo: null }],
    });

    // Três pedidos de mudar a prioridade: um recusado, um aprovado com edição, um vence.
    roteiro = [0, 1, 2].flatMap((i) => [
      () => ({
        chamadas: [
          { id: `m${i}`, nome: "mudar_prazo", entrada: { tarefaId: ids.tarefa, prioridade: "baixa" } },
        ],
      }),
      () => ({ chamadas: [{ id: `n${i}`, nome: "responder", entrada: { texto: "Pedi aprovação." } }] }),
    ]);
    for (let i = 0; i < 3; i++) {
      await pedir("POST", "/conversas/mensagens", ana, { texto: `muda a prioridade ${i}` });
      await rodarFila();
    }
    const pedidos = (
      (await pedir("GET", "/aprovacoes?situacao=pendente", ana)).json() as {
        id: string;
        conferencia: string;
        acao: string;
      }[]
    )
      .filter((p) => p.acao === "mudar_prazo")
      .slice(0, 3);
    expect(pedidos).toHaveLength(3);
    const [p1, p2, p3] = pedidos as [
      (typeof pedidos)[number],
      (typeof pedidos)[number],
      (typeof pedidos)[number],
    ];
    expect(
      (
        await pedir("POST", `/aprovacoes/${p1.id}/decidir`, ana, {
          decisao: "recusar",
          conferencia: p1.conferencia,
        })
      ).statusCode,
    ).toBe(400);
    const recusada = await pedir("POST", `/aprovacoes/${p1.id}/decidir`, ana, {
      decisao: "recusar",
      conferencia: p1.conferencia,
      motivo: "A prioridade continua alta.",
    });
    expect(recusada.json()).toMatchObject({
      situacao: "recusada",
      observacao: "A prioridade continua alta.",
    });
    // Parâmetros fora do formato: recusa; dentro: aprova com edição e a ação usa os editados.
    expect(
      (
        await pedir("POST", `/aprovacoes/${p2.id}/decidir`, ana, {
          decisao: "aprovar",
          conferencia: p2.conferencia,
          parametros: { tarefaId: ids.tarefa, prioridade: "altíssima" },
        })
      ).statusCode,
    ).toBe(400);
    const editada = await pedir("POST", `/aprovacoes/${p2.id}/decidir`, ana, {
      decisao: "aprovar",
      conferencia: p2.conferencia,
      parametros: { tarefaId: ids.tarefa, prioridade: "alta" },
    });
    expect(editada.json()).toMatchObject({ situacao: "aprovada", editada: true });
    const prioridade = await dono.query<{ prioridade: string }>(
      "select prioridade from tarefas where id = $1",
      [ids.tarefa],
    );
    expect(prioridade.rows[0]?.prioridade).toBe("alta");
    // Edição e recusa zeram o contador da sugestão de liberar.
    const regra = (
      (await pedir("GET", `/agentes/${ids.coordenador}/regras`, ana)).json() as {
        regras: { acao: string; aprovadasSemEdicao: number }[];
      }
    ).regras.find((r) => r.acao === "mudar_prazo");
    expect(regra?.aprovadasSemEdicao).toBe(0);
    // O terceiro vence: a ação não acontece e o pedido fica "vencida".
    await dono.query(
      "update aprovacoes set vence_em = now() - interval '1 minute', criada_em = now() - interval '25 hours' where id = $1",
      [p3.id],
    );
    expect(await verificarAprovacoesVencidas(poolApp, { error: () => {} })).toBe(1);
    const vencida = (await pedir("GET", `/aprovacoes/${p3.id}`, ana)).json() as { situacao: string };
    expect(vencida.situacao).toBe("vencida");
    expect(
      (
        await pedir("POST", `/aprovacoes/${p3.id}/decidir`, ana, {
          decisao: "aprovar",
          conferencia: p3.conferencia,
        })
      ).statusCode,
    ).toBe(409);
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

  it("plano de assinatura da Anthropic: a execução roda pelo Claude Code, com as ferramentas do Mago OS", async () => {
    const ana = await como("ana@teste.invalid");
    const conta = await pedir("POST", "/ia/contas", ana, {
      nome: "Claude Max",
      provedor: "anthropic",
      credencial: "assinatura",
      chave: TOKEN_DO_PLANO,
      aceitoOsTermos: true,
    });
    expect(conta.statusCode).toBe(201);
    ids.plano = conta.json().id;
    await pedir("POST", `/ia/contas/${ids.plano}/modelos`, ana, {
      modelos: [{ modelo: "modelo-do-plano", liberado: true }],
    });
    await pedir("POST", `/agentes/${ids.coordenador}/modelos`, ana, {
      modelos: { principal: { contaId: ids.plano, modelo: "modelo-do-plano" }, reserva: null },
    });
    roteiroDoClaudeCode = async (p) => {
      const criada = await p.executar("criar_tarefa", { titulo: "Revisar o contrato" });
      expect(criada.erro).toBe(false);
      await p.executar("responder", { texto: "Criei a tarefa pelo Claude Code." });
      // Depois do fim, mais nenhuma ferramenta roda.
      expect((await p.executar("criar_tarefa", { titulo: "Outra" })).erro).toBe(true);
      return { texto: null, tokens: { entrada: 5, saida: 3, cache: 0 } };
    };
    const antes = modelos.pedidos.length;
    const r = await pedir("POST", "/conversas/mensagens", ana, {
      texto: "cria uma tarefa para revisar o contrato",
    });
    expect(r.statusCode).toBe(201);
    await rodarFila();
    expect(modelos.pedidos.length).toBe(antes);
    expect(pedidosAoClaudeCode.at(-1)).toMatchObject({ token: TOKEN_DO_PLANO, modelo: "modelo-do-plano" });
    expect(pedidosAoClaudeCode.at(-1)?.ferramentas).toContain("criar_tarefa");
    const e = await dono.query<{ situacao: string; modelo: string }>(
      "select situacao, modelo from execucoes_de_agente where id = $1",
      [r.json().execucaoId],
    );
    expect(e.rows[0]).toEqual({ situacao: "concluida", modelo: "modelo-do-plano" });
    const t = await dono.query("select 1 from tarefas where titulo = 'Revisar o contrato'");
    expect(t.rowCount).toBe(1);
    expect((await dono.query("select 1 from tarefas where titulo = 'Outra'")).rowCount).toBe(0);
    const conversa = (await pedir("GET", `/conversas/${r.json().conversa.id}`, ana)).json() as {
      mensagens: { texto: string }[];
    };
    expect(conversa.mensagens.at(-1)?.texto).toBe("Criei a tarefa pelo Claude Code.");
  });

  it("principal pela API e reserva pelo plano: a API falha e o reserva roda pelo Claude Code", async () => {
    const ana = await como("ana@teste.invalid");
    await pedir("POST", `/agentes/${ids.coordenador}/modelos`, ana, {
      modelos: {
        principal: { contaId: ids.Principal, modelo: "modelo-bom" },
        reserva: { contaId: ids.plano, modelo: "modelo-do-plano" },
      },
    });
    roteiro = [
      () => {
        throw new ErroDoModelo("O provedor está com problema (erro 529).");
      },
    ];
    roteiroDoClaudeCode = async (p) => {
      await p.executar("responder", { texto: "Respondi pelo plano." });
      return { texto: null, tokens: { entrada: 1, saida: 1, cache: 0 } };
    };
    const r = await pedir("POST", "/conversas/mensagens", ana, { texto: "oi de novo" });
    await rodarFila();
    const e = await dono.query<{ situacao: string; modelo: string; passou_ao_reserva_porque: string }>(
      "select situacao, modelo, passou_ao_reserva_porque from execucoes_de_agente where id = $1",
      [r.json().execucaoId],
    );
    expect(e.rows[0]).toEqual({
      situacao: "concluida",
      modelo: "modelo-do-plano",
      passou_ao_reserva_porque: "O provedor está com problema (erro 529).",
    });
  });

  it("falar direto com o Gerente: o administrador pode, a funcionária não; o Gerente cria e planeja a tarefa", async () => {
    const ana = await como("ana@teste.invalid");
    const flora = await como("flora@teste.invalid");
    const daAna = (await pedir("GET", "/conversas", ana)).json() as { especialistas: { id: string }[] };
    expect(daAna.especialistas.map((e) => e.id)).toContain(ids.gerente);
    const daFlora = (await pedir("GET", "/conversas", flora)).json() as { especialistas: unknown[] };
    expect(daFlora.especialistas).toEqual([]);
    const negado = await pedir("POST", "/conversas/mensagens", flora, { agenteId: ids.gerente, texto: "oi" });
    expect(negado.statusCode).toBe(403);

    roteiro = [
      () => ({ chamadas: [{ id: "d1", nome: "criar_tarefa", entrada: { titulo: "Campanha de Natal" } }] }),
      (p) => {
        const tarefa = ultimoResultado(p).tarefa as {
          id: string;
          responsavel: { tipo: string; agenteId?: string };
        };
        expect(tarefa.responsavel).toEqual({ tipo: "agente", agenteId: ids.gerente });
        return {
          chamadas: [
            {
              id: "d2",
              nome: "planejar",
              entrada: {
                tarefaId: tarefa.id,
                subtarefas: [{ titulo: "Criar as artes" }],
                checklist: ["Aprovar texto"],
              },
            },
          ],
        };
      },
      () => ({
        chamadas: [{ id: "d3", nome: "responder", entrada: { texto: "Plano da campanha pronto." } }],
      }),
    ];
    const r = await pedir("POST", "/conversas/mensagens", ana, {
      agenteId: ids.gerente,
      texto: "planeja a campanha de Natal",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().conversa.agenteId).toBe(ids.gerente);
    await rodarFila();
    const sub = await dono.query(
      "select 1 from tarefas s join tarefas m on m.id = s.tarefa_mae_id where m.titulo = 'Campanha de Natal'",
    );
    expect(sub.rowCount).toBe(1);
    const ultima = (await pedir("GET", `/conversas/${r.json().conversa.id}`, ana)).json() as {
      mensagens: { texto: string }[];
    };
    expect(ultima.mensagens.at(-1)?.texto).toBe("Plano da campanha pronto.");
  });

  it("coordenador desligado por engano: nasce um novo, pausado, e o Gerente passa a responder a ele", async () => {
    const ana = await como("ana@teste.invalid");
    expect((await pedir("POST", `/agentes/${ids.coordenador}/desligar`, ana, {})).statusCode).toBe(200);
    const agentes = (await pedir("GET", "/agentes", ana)).json() as {
      id: string;
      papel: string | null;
      situacao: string;
      respondeAId: string | null;
    }[];
    const novo = agentes.find((a) => a.papel === "coordenador" && a.situacao !== "desligado");
    expect(novo).toMatchObject({ situacao: "pausado" });
    expect(novo?.id).not.toBe(ids.coordenador);
    expect(agentes.find((a) => a.id === ids.gerente)?.respondeAId).toBe(novo?.id);
  });
});
