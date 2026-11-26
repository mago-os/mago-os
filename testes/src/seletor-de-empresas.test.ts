/**
 * Seletor completo de empresas (M7-05, decisão 0050): o número de cada empresa (avisos não lidos que a pessoa ainda vê
 * e aprovações que ela pode decidir), os avisos de todas as empresas com o nome de cada uma, e que nada aparece de uma
 * empresa onde ela não está (ou de onde saiu), nem um aviso de tarefa que ela não vê.
 */
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { modelosFalsos } from "@mago-os/nucleo/contas-de-ia";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";
import { type ApiDeTeste, montarApiDeTeste, SITE } from "./vazamento/montar-api.ts";

const SENHA = "uma frase longa e boa para entrar";

describe.skipIf(!bancoDisponivel)("seletor completo de empresas", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let api: ApiDeTeste;
  let cookie = "";
  let pessoaId = "";
  const E: Record<string, string> = {};

  const naTela = (url: string) => api.app.inject({ method: "GET", url, headers: { cookie, origin: SITE } });

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    api = await montarApiDeTeste(banco, { modelos: modelosFalsos([]) });
    for (const nome of ["Nolask", "4xpert", "Outra"]) {
      const e = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
        nome,
      ]);
      E[nome] = e.rows[0]?.id as string;
    }
    const p = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Sandro', 'sandro@teste.invalid', true) returning id",
    );
    pessoaId = p.rows[0]?.id as string;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [pessoaId, pessoaId, await embaralharSenha(SENHA)],
    );
    // Administrador na Nolask, funcionário na 4xpert; não está na Outra.
    for (const [empresa, perfil] of [
      ["Nolask", "administrador"],
      ["4xpert", "funcionario"],
    ] as const)
      await dono.query(
        `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
           values ($1, $2, $3, 'ativo', now(), now())`,
        [E[empresa], pessoaId, perfil],
      );
    const r = await api.app.inject({
      method: "POST",
      url: "/acesso/sign-in/email",
      headers: { origin: SITE, "content-type": "application/json", "x-forwarded-for": "198.18.74.1" },
      payload: JSON.stringify({ email: "sandro@teste.invalid", password: SENHA }),
    });
    expect(r.statusCode, r.body).toBe(200);
    await dono.query(
      "update acesso.sessoes set dois_fatores_em = now(), dois_fatores_metodo = 'passkey', empresa_id = $2 where pessoa_id = $1",
      [pessoaId, E.Nolask],
    );
    await dono.query(
      "insert into acesso.passkeys (pessoa_id, chave_publica, credencial_id, tipo_aparelho) values ($1, 'c', 'x', 'multiDevice')",
      [pessoaId],
    );
    cookie = ([] as string[])
      .concat(r.headers["set-cookie"] ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");

    const aviso = (empresa: string, texto: string, tarefa: string | null = null) =>
      dono.query(
        "insert into avisos (empresa_id, pessoa_id, tipo, texto, link, tarefa_id) values ($1, $2, 'mencao', $3, '/', $4)",
        [E[empresa], pessoaId, texto, tarefa],
      );
    // Nolask: 2 avisos e 1 aprovação pendente (ele é administrador).
    await aviso("Nolask", "Aviso 1 da Nolask");
    await aviso("Nolask", "Aviso 2 da Nolask");
    const a = await dono.query<{ id: string }>(
      "insert into agentes (empresa_id, nome, responsavel_id) values ($1, 'Robô', $2) returning id",
      [E.Nolask, pessoaId],
    );
    await dono.query(
      `insert into aprovacoes (empresa_id, agente_id, pedido_por, acao, parametros, resumo, conferencia)
       values ($1, $2, $3, 'comentar', '{}', 'Comentar', $4)`,
      [E.Nolask, a.rows[0]?.id, pessoaId, "a".repeat(64)],
    );
    // 4xpert: 1 aviso que ele vê e 1 de uma tarefa que ele não vê (é funcionário e a tarefa não é dele).
    await aviso("4xpert", "Aviso da 4xpert");
    const t = await dono.query<{ id: string }>(
      "insert into tarefas (empresa_id, titulo) values ($1, 'Tarefa de outra pessoa') returning id",
      [E["4xpert"]],
    );
    await aviso("4xpert", "Aviso de tarefa escondida", t.rows[0]?.id ?? null);
    // A Outra empresa: ele não está nela.
    const outra = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Alguém', 'alguem@teste.invalid', true) returning id",
    );
    await dono.query(
      `insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em)
         values ($1, $2, 'administrador', 'ativo', now(), now())`,
      [E.Outra, outra.rows[0]?.id],
    );
    await dono.query(
      "insert into avisos (empresa_id, pessoa_id, tipo, texto, link) values ($1, $2, 'mencao', 'Aviso da Outra', '/')",
      [E.Outra, outra.rows[0]?.id],
    );
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
    await dono?.end();
    await banco?.apagar();
  });

  it("o seletor mostra o que está esperando em cada empresa, só com o que ele vê", async () => {
    const r = await naTela("/conta/empresas");
    expect(r.statusCode, r.body).toBe(200);
    const empresas = r.json() as { nome: string; ativa: boolean; avisos: number; aprovacoes: number }[];
    expect(empresas.map((e) => e.nome).sort()).toEqual(["4xpert", "Nolask"]);
    expect(empresas.find((e) => e.nome === "Nolask")).toMatchObject({
      ativa: true,
      avisos: 2,
      aprovacoes: 1,
    });
    expect(empresas.find((e) => e.nome === "4xpert")).toMatchObject({
      ativa: false,
      avisos: 1,
      aprovacoes: 0,
    });
  });

  it("Todas as empresas: os avisos de cada uma, com o nome, sem os escondidos nem os da Outra", async () => {
    const r = await naTela("/conta/avisos");
    expect(r.statusCode, r.body).toBe(200);
    const avisos = r.json().avisos as { aviso: { texto: string; empresaId: string }; empresaNome: string }[];
    expect(avisos.map((a) => `${a.empresaNome}: ${a.aviso.texto}`).sort()).toEqual([
      "4xpert: Aviso da 4xpert",
      "Nolask: Aviso 1 da Nolask",
      "Nolask: Aviso 2 da Nolask",
    ]);
    expect(JSON.stringify(avisos)).not.toContain("Outra");
    expect(JSON.stringify(avisos)).not.toContain("escondida");
  });

  it("desligado da 4xpert, ela some do seletor e dos avisos", async () => {
    await dono.query(
      "update vinculos set situacao = 'desligado', desligado_em = now() where empresa_id = $1 and pessoa_id = $2",
      [E["4xpert"], pessoaId],
    );
    const empresas = (await naTela("/conta/empresas")).json() as { nome: string }[];
    expect(empresas.map((e) => e.nome)).toEqual(["Nolask"]);
    const avisos = (await naTela("/conta/avisos")).json().avisos as { empresaNome: string }[];
    expect(avisos.every((a) => a.empresaNome === "Nolask")).toBe(true);
  });
});
