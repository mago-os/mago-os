/** Comando de início da plataforma (M1-02): Dono da plataforma e as empresas dele, sem dado real no código. */
import { type BancoTemporario, criarBancoTemporario } from "@mago-os/nucleo/banco-temporario";
import { comPessoa } from "@mago-os/nucleo/empresa";
import { iniciarPlataforma } from "@mago-os/nucleo/plataforma";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel } from "./preparar-banco.ts";

describe.skipIf(!bancoDisponivel)("início da plataforma", () => {
  let banco: BancoTemporario;
  let dono: pg.Client;
  let app: pg.Pool;

  beforeAll(async () => {
    banco = await criarBancoTemporario();
    dono = new pg.Client({ connectionString: banco.urlDono });
    await dono.connect();
    app = new pg.Pool({ connectionString: banco.urlApp, max: 1 });
  });

  afterAll(async () => {
    await dono?.end();
    await app?.end();
    await banco?.apagar();
  });

  const dados = { nome: "Pessoa Dona", email: " Dona@Teste.invalid ", empresa: "Empresa Um" };

  it("cria a pessoa, o Dono da plataforma, a empresa e o vínculo de administrador", async () => {
    const r = await iniciarPlataforma(dono, dados);
    expect(r.criou).toEqual({ pessoa: true, dono: true, empresa: true, vinculo: true });
    const visto = await comPessoa(app, r.pessoaId, r.empresaId, async (c) => ({
      email: (await c.query("select email from pessoas")).rows,
      perfil: (await c.query("select perfil, situacao from vinculos")).rows,
      papel: (await c.query("select papel from papeis_plataforma")).rows,
    }));
    expect(visto).toEqual({
      email: [{ email: "dona@teste.invalid" }],
      perfil: [{ perfil: "administrador", situacao: "ativo" }],
      papel: [{ papel: "dono" }],
    });
  });

  it("rodar de novo não duplica nada", async () => {
    const r = await iniciarPlataforma(dono, { ...dados, empresa: "empresa um" });
    expect(r.criou).toEqual({ pessoa: false, dono: false, empresa: false, vinculo: false });
  });

  it("uma segunda empresa entra no mesmo login, separada da primeira", async () => {
    const um = await iniciarPlataforma(dono, dados);
    const dois = await iniciarPlataforma(dono, { ...dados, empresa: "Empresa Dois" });
    expect(dois.pessoaId).toBe(um.pessoaId);
    expect(dois.criou).toEqual({ pessoa: false, dono: false, empresa: true, vinculo: true });
    const empresas = await comPessoa(app, um.pessoaId, null, async (c) =>
      (await c.query("select nome from empresas order by nome")).rows.map((x) => x.nome),
    );
    expect(empresas).toEqual(["Empresa Dois", "Empresa Um"]);
  });

  it("não deixa outro e-mail virar Dono da plataforma", async () => {
    await expect(iniciarPlataforma(dono, { ...dados, email: "outra@teste.invalid" })).rejects.toThrow(
      /Já existe um Dono/,
    );
    const pessoas = await dono.query(
      "select count(*)::int as n from pessoas where email = 'outra@teste.invalid'",
    );
    expect(pessoas.rows[0].n).toBe(0);
  });

  it("recusa dados inválidos", async () => {
    await expect(iniciarPlataforma(dono, { ...dados, email: "sem-arroba" })).rejects.toThrow(
      /e-mail inválido/,
    );
    await expect(iniciarPlataforma(dono, { ...dados, empresa: "  " })).rejects.toThrow(/empresa/);
  });
});
