/**
 * Anexos (M3-08), de ponta a ponta com o depósito em disco e o conferente de teste: envio pela quarentena, o EICAR
 * bloqueado e avisado, outra empresa não baixa nem com o caminho, link vencido não vale, e excluir apaga o arquivo.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarLogin, criarPoolDoLogin, embaralharSenha, registrarRotasDoLogin } from "@mago-os/nucleo/acesso";
import { registrarDepositoLocal, registrarRotasDosAnexos } from "@mago-os/nucleo/anexos";
import { antivirusDeTeste } from "@mago-os/nucleo/anexos/antivirus";
import { criarDepositoEmDisco, type DepositoEmDisco } from "@mago-os/nucleo/anexos/deposito";
import { cuidarDosAnexos, listarAnexos } from "@mago-os/nucleo/anexos/servico";
import { registrarRotasDosAvisos } from "@mago-os/nucleo/avisos";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { registrarRotaDaBusca } from "@mago-os/nucleo/busca";
import { comEmpresa, comPessoa as comPessoaNaEmpresa } from "@mago-os/nucleo/empresa";
import { catalogoDeModulos, criarVerificador } from "@mago-os/nucleo/permissoes";
import { registrarRotasDosProjetos } from "@mago-os/nucleo/projetos";
import { registrarRotasDasTarefas } from "@mago-os/nucleo/tarefas";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

const SITE = "https://teste.osmago.invalid";
const SENHA = "uma frase longa e boa para entrar";
const OUTRA = "00000000-0000-7000-8000-0000000000ae";

describe.skipIf(!bancoDisponivel)("anexos", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let poolAcesso: pg.Pool;
  let poolApp: pg.Pool;
  let app: FastifyInstance;
  let empresaId: string;
  let deposito: DepositoEmDisco;
  let relogio = new Date();
  let ip = 0;
  const emails: { para: string; link: string; aparelho: string }[] = [];

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
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, area, situacao, convidado_em, entrou_em)
         values ($1, $2, $3, $4, 'ativo', now(), now())`,
      [empresa, id, perfil, area],
    );
    return id;
  }

  async function entrar(email: string): Promise<string> {
    ip += 1;
    const r = await app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": `198.18.8.${ip}` },
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

  const cookies: Record<string, string> = {};
  const como = async (email: string) => {
    cookies[email] ??= await entrar(email);
    return cookies[email] as string;
  };
  const ids: Record<string, string> = {};

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
    ids.ana = await criarPessoa("Ana Admin", "ana@teste.invalid", "administrador", null);
    ids.gil = await criarPessoa("Gil Gestor", "gil@teste.invalid", "gestor_area", "comercial");
    ids.fabio = await criarPessoa("Fabio Func", "fabio@teste.invalid", "funcionario", "comercial");
    ids.flora = await criarPessoa("Flora Func", "flora@teste.invalid", "funcionario", "comercial");
    ids.otto = await criarPessoa("Otto Outra", "otto@teste.invalid", "administrador", null, OUTRA);

    poolAcesso = criarPoolDoLogin(banco.urlAcesso);
    poolApp = new pg.Pool({ connectionString: banco.urlApp });
    const login = criarLogin(
      {
        bancoUrl: banco.urlAcesso,
        segredo: "segredo-de-teste-com-mais-de-32-caracteres",
        urlPublica: SITE,
        ambiente: "local",
        conferirSenhasVazadas: false,
        carteiro: {
          async enviarLinkDeSenha() {},
          async enviarAparelhoNovo(d) {
            emails.push(d);
          },
        },
      },
      poolAcesso,
    );
    app = Fastify({ logger: { level: "error" } });
    registrarRotasDoLogin(app, login, poolAcesso);
    const verificador = criarVerificador(login, poolAcesso, poolApp, catalogoDeModulos());
    registrarRotasDasTarefas(app, verificador, poolApp);
    registrarRotasDosProjetos(app, verificador, poolApp);
    registrarRotaDaBusca(app, verificador, poolApp);
    registrarRotasDosAvisos(app, verificador, poolApp, "chave-publica-de-teste");
    deposito = criarDepositoEmDisco(SITE, await mkdtemp(join(tmpdir(), "anexos-")), () => relogio);
    registrarRotasDosAnexos(app, {
      verificador,
      poolApp,
      servicos: { deposito, antivirus: antivirusDeTeste },
      acordarFila: () => {},
    });
    await registrarDepositoLocal(app, deposito);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await poolAcesso?.end();
    await poolApp?.end();
    await dono?.end();
    await banco?.apagar();
  });

  const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  const log = { warn() {}, error() {} };
  const servicos = () => ({ deposito, antivirus: antivirusDeTeste });

  /** Pede o link, envia pelo depósito local e avisa que chegou. Devolve o anexo. */
  async function anexar(
    email: string,
    tarefaId: string,
    nome: string,
    tipo: string,
    conteudo: string,
    descricao?: string,
  ) {
    const cookie = await como(email);
    const dados = Buffer.from(conteudo);
    const pedido = await pedir("POST", `/tarefas/${tarefaId}/anexos`, cookie, {
      nome,
      tipo,
      tamanho: dados.length,
      ...(descricao ? { descricao } : {}),
    });
    expect(pedido.statusCode).toBe(201);
    const { anexo, url } = pedido.json() as { anexo: { id: string }; url: string };
    const envio = await app.inject({
      method: "PUT",
      url: url.replace(`${SITE}/api`, ""),
      headers: { "content-type": tipo },
      payload: dados,
    });
    expect(envio.statusCode).toBe(200);
    const chegou = await pedir("POST", `/tarefas/${tarefaId}/anexos/${anexo.id}/enviado`, cookie);
    expect(chegou.statusCode).toBe(200);
    return anexo.id;
  }

  it("o arquivo limpo passa pela quarentena e fica disponível; o EICAR é bloqueado, apagado e avisado", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Com anexos" })).json().id as string;
    const limpo = await anexar(
      "ana@teste.invalid",
      t,
      "relatório.pdf",
      "application/pdf",
      "%PDF-1.4 conteúdo",
    );
    const virus = await anexar("ana@teste.invalid", t, "eicar.txt", "text/plain", EICAR);
    let lista = (await pedir("GET", `/tarefas/${t}/anexos`, ana)).json().anexos as {
      id: string;
      situacao: string;
    }[];
    expect(lista.map((a) => a.situacao)).toEqual(["verificando", "verificando"]);
    // Antes do antivírus, não dá para baixar.
    expect((await pedir("GET", `/tarefas/${t}/anexos/${limpo}/link`, ana)).statusCode).toBe(404);
    expect(await cuidarDosAnexos(poolApp, servicos(), log)).toMatchObject({ liberados: 1, bloqueados: 1 });
    lista = (await pedir("GET", `/tarefas/${t}/anexos`, ana)).json().anexos;
    expect(lista.find((a) => a.id === limpo)?.situacao).toBe("disponivel");
    expect(lista.find((a) => a.id === virus)?.situacao).toBe("bloqueado");
    const caminhos = await dono.query<{ id: string; caminho: string }>(
      "select id, caminho from anexos where tarefa_id = $1",
      [t],
    );
    const doLimpo = caminhos.rows.find((r) => r.id === limpo)?.caminho as string;
    expect(doLimpo).toBe(`empresas/${empresaId}/anexos/${limpo}`);
    // O infectado sumiu do depósito; a quarentena do limpo também.
    expect(await deposito.info(caminhos.rows.find((r) => r.id === virus)?.caminho as string)).toBeNull();
    expect(await deposito.info(doLimpo)).not.toBeNull();
    const avisos = (await pedir("GET", "/avisos", ana)).json() as { tipo: string }[];
    expect(avisos.map((a) => a.tipo)).toContain("anexo_bloqueado");
    // Baixar: link de 5 minutos com o conteúdo certo; depois dele, não vale.
    const { url } = (await pedir("GET", `/tarefas/${t}/anexos/${limpo}/link`, ana)).json() as { url: string };
    const baixou = await app.inject({ method: "GET", url: url.replace(`${SITE}/api`, "") });
    expect(baixou.statusCode).toBe(200);
    expect(baixou.body).toBe("%PDF-1.4 conteúdo");
    expect(baixou.headers["content-disposition"]).toContain("inline");
    relogio = new Date(Date.now() + 6 * 60 * 1000);
    expect((await app.inject({ method: "GET", url: url.replace(`${SITE}/api`, "") })).statusCode).toBe(403);
    relogio = new Date();
  });

  it("descrição do anexo: quem enviou e quem edita a tarefa mudam; a lista traz quando, quem e o canal; a busca acha", async () => {
    const fabio = await como("fabio@teste.invalid");
    const t = (await pedir("POST", "/tarefas", fabio, { titulo: "Contratos do mês" })).json().id as string;
    const id = await anexar(
      "fabio@teste.invalid",
      t,
      "dfo.pdf",
      "application/pdf",
      "%PDF-1.4 dfo",
      "Contrato assinado da DFO",
    );
    const lista = (await pedir("GET", `/tarefas/${t}/anexos`, fabio)).json() as {
      anexos: { id: string; descricao: string | null; canal: string; enviadoEm: string }[];
      nomes: Record<string, string>;
    };
    expect(lista.anexos[0]).toMatchObject({ id, descricao: "Contrato assinado da DFO", canal: "app" });
    expect(lista.nomes[ids.fabio as string]).toBe("Fabio Func");
    // Quem enviou muda; o administrador (edita a tarefa) também; outra empresa não acha.
    const url = `/tarefas/${t}/anexos/${id}/descricao`;
    expect((await pedir("POST", url, fabio, { descricao: "Contrato da DFO, versão final" })).statusCode).toBe(
      200,
    );
    const ana = await como("ana@teste.invalid");
    const mudou = await pedir("POST", url, ana, { descricao: "Contrato DFO assinado em 22/11" });
    expect(mudou.json().anexo.descricao).toBe("Contrato DFO assinado em 22/11");
    // Quem escreveu fica guardado: para os agentes, a descrição da Ana é texto de outros para o Fabio (M4-04).
    const por = await dono.query("select descrito_por_pessoa_id from anexos where id = $1", [id]);
    expect(por.rows[0]?.descrito_por_pessoa_id).toBe(ids.ana);
    expect((await pedir("POST", url, await como("otto@teste.invalid"), { descricao: "x" })).statusCode).toBe(
      404,
    );
    expect((await pedir("POST", url, ana, { descricao: "x".repeat(501) })).statusCode).toBe(400);
    const ev = await dono.query(
      "select count(*)::int as n from auditoria.eventos where acao = 'anexo.descreveu'",
    );
    expect(ev.rows[0]?.n).toBe(2);
    // A busca acha pelo texto da descrição, depois do antivírus.
    await cuidarDosAnexos(poolApp, servicos(), log);
    const busca = (await pedir("GET", "/busca?texto=assinado&tipos=anexo", ana)).json() as {
      resultados: { tipo: string; id: string; titulo: string; trecho: string | null; link: string }[];
    };
    expect(busca.resultados).toEqual([
      {
        tipo: "anexo",
        id,
        titulo: "dfo.pdf",
        trecho: "Contrato DFO assinado em 22/11",
        link: `/tarefas/${t}`,
      },
    ]);
    // Tirar a descrição.
    expect((await pedir("POST", url, fabio, { descricao: null })).json().anexo.descricao).toBeNull();
  });

  it("recusa tipo que roda programa e arquivo maior que 25 MB; o envio parado some depois de uma hora", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Recusas" })).json().id as string;
    expect(
      (
        await pedir("POST", `/tarefas/${t}/anexos`, ana, {
          nome: "instalar.exe",
          tipo: "application/octet-stream",
          tamanho: 10,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await pedir("POST", `/tarefas/${t}/anexos`, ana, {
          nome: "grande.zip",
          tipo: "application/zip",
          tamanho: 26 * 1024 * 1024,
        })
      ).statusCode,
    ).toBe(400);
    const pedido = (
      await pedir("POST", `/tarefas/${t}/anexos`, ana, { nome: "a.txt", tipo: "text/plain", tamanho: 3 })
    ).json();
    // Avisar sem ter enviado não vale.
    expect((await pedir("POST", `/tarefas/${t}/anexos/${pedido.anexo.id}/enviado`, ana)).statusCode).toBe(
      409,
    );
    await dono.query("update anexos set enviado_em = now() - interval '2 hours' where id = $1", [
      pedido.anexo.id,
    ]);
    await cuidarDosAnexos(poolApp, servicos(), log);
    expect((await dono.query("select 1 from anexos where id = $1", [pedido.anexo.id])).rowCount).toBe(0);
  });

  it("quem não vê a tarefa não lista nem baixa; outra empresa não baixa nem com o caminho; excluir apaga o arquivo", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Só da Ana" })).json().id as string;
    const id = await anexar("ana@teste.invalid", t, "foto.png", "image/png", "png falso");
    await cuidarDosAnexos(poolApp, servicos(), log);
    const fabio = await como("fabio@teste.invalid");
    expect((await pedir("GET", `/tarefas/${t}/anexos`, fabio)).statusCode).toBe(404);
    expect((await pedir("GET", `/tarefas/${t}/anexos/${id}/link`, fabio)).statusCode).toBe(404);
    const otto = await como("otto@teste.invalid");
    expect((await pedir("GET", `/tarefas/${t}/anexos/${id}/link`, otto)).statusCode).toBe(404);
    // O Fabio não anexa numa tarefa que não pode editar.
    expect(
      (await pedir("POST", `/tarefas/${t}/anexos`, fabio, { nome: "x.txt", tipo: "text/plain", tamanho: 1 }))
        .statusCode,
    ).toBe(404);
    // Pelo banco, a outra empresa não enxerga o anexo.
    const outra = await comPessoaNaEmpresa(poolApp, ids.otto as string, OUTRA, (c) =>
      c.query("select 1 from anexos where id = $1", [id]),
    );
    expect(outra.rowCount).toBe(0);
    const caminho = (await dono.query<{ caminho: string }>("select caminho from anexos where id = $1", [id]))
      .rows[0]?.caminho as string;
    expect((await pedir("DELETE", `/tarefas/${t}/anexos/${id}`, ana)).statusCode).toBe(204);
    await cuidarDosAnexos(poolApp, servicos(), log);
    expect(await deposito.info(caminho)).toBeNull();
  });

  it("excluir a tarefa apaga os arquivos dos anexos dela", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Vai sumir" })).json().id as string;
    const id = await anexar("ana@teste.invalid", t, "nota.txt", "text/plain", "texto");
    await cuidarDosAnexos(poolApp, servicos(), log);
    const caminho = (await dono.query<{ caminho: string }>("select caminho from anexos where id = $1", [id]))
      .rows[0]?.caminho as string;
    expect(await deposito.info(caminho)).not.toBeNull();
    expect((await pedir("DELETE", `/tarefas/${t}`, ana)).statusCode).toBeLessThan(300);
    await cuidarDosAnexos(poolApp, servicos(), log);
    expect(await deposito.info(caminho)).toBeNull();
  });

  it("anexo de nota interna não vai para o agente; o de comentário vai, depois do antivírus", async () => {
    const ana = await como("ana@teste.invalid");
    const t = (await pedir("POST", "/tarefas", ana, { titulo: "Notas" })).json().id as string;
    const nota = (
      await pedir("POST", `/tarefas/${t}/comentarios`, ana, { texto: "Só nós", interna: true })
    ).json();
    const comentario = (
      await pedir("POST", `/tarefas/${t}/comentarios`, ana, { texto: "Para todos" })
    ).json();
    for (const [cm, nome] of [
      [nota.id, "segredo.txt"],
      [comentario.id, "aberto.txt"],
    ] as const) {
      const dados = Buffer.from(nome);
      const r = (
        await pedir("POST", `/tarefas/${t}/anexos`, ana, {
          nome,
          tipo: "text/plain",
          tamanho: dados.length,
          comentarioId: cm,
        })
      ).json();
      await app.inject({
        method: "PUT",
        url: r.url.replace(`${SITE}/api`, ""),
        headers: { "content-type": "text/plain" },
        payload: dados,
      });
      await pedir("POST", `/tarefas/${t}/anexos/${r.anexo.id}/enviado`, ana);
    }
    await cuidarDosAnexos(poolApp, servicos(), log);
    const doAgente = await comEmpresa(poolApp, empresaId, (c) => listarAnexos(c, t, true));
    expect(doAgente.map((a) => a.nome)).toEqual(["aberto.txt"]);
    // Na tela, a pessoa vê os dois.
    expect(((await pedir("GET", `/tarefas/${t}/anexos`, ana)).json().anexos as unknown[]).length).toBe(2);
  });
});
