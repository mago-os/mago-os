import { createHmac, randomUUID } from "node:crypto";
import { embaralharSenha } from "@mago-os/nucleo/acesso";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";

const SENHA = "uma frase longa para os testes de tela";

/** Código de 6 dígitos do app autenticador (TOTP), como o app do celular calcula. */
function codigoDoApp(segredo: string, deslocamento = 0): string {
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letra of segredo.replace(/=+$/, "").toUpperCase())
    bits += alfabeto.indexOf(letra).toString(2).padStart(5, "0");
  const chave = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const passo = Buffer.alloc(8);
  passo.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + deslocamento));
  const hmac = createHmac("sha1", chave).update(passo).digest();
  const inicio = (hmac[hmac.length - 1] ?? 0) & 0xf;
  return String((hmac.readUInt32BE(inicio) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test.describe("2FA nas telas", () => {
  test.describe.configure({ mode: "serial" });
  let dono: pg.Client;
  let email: string;
  let empresaId: string;

  test.beforeAll(async () => {
    // Uma administradora falsa numa empresa falsa: para ela, o 2FA é obrigatório.
    email = `adm-${test.info().project.name}-${randomUUID().slice(0, 8)}@teste.invalid`;
    dono = new pg.Client({ connectionString: BANCO_DONO });
    await dono.connect();
    const empresa = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
      `Empresa ${email}`,
    ]);
    empresaId = empresa.rows[0]?.id ?? "";
    const pessoa = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Adm de Tela', $1, true) returning id",
      [email],
    );
    const id = pessoa.rows[0]?.id;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    await dono.query(
      "insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em) values ($1, $2, 'administrador', 'ativo', now(), now())",
      [empresaId, id],
    );
  });

  // Cada teste com um IP próprio, para o limite de tentativas por minuto de um não atrapalhar o outro.
  test.beforeEach(async ({ page }) => {
    const parte = () => Math.floor(Math.random() * 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${parte()}.${parte()}.${parte()}` });
  });

  test.afterAll(async () => {
    await dono.query("delete from pessoas where email = $1", [email]);
    await dono.query("delete from empresas where id = $1", [empresaId]);
    await dono.end();
  });

  test("administradora ativa o app autenticador, guarda os códigos e depois entra com o código", async ({
    page,
  }) => {
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page.getByText("Ative a autenticação em 2 fatores")).toBeVisible();
    await page.getByRole("button", { name: "Usar app autenticador" }).click();
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Continuar" }).click();

    await expect(page.getByRole("img", { name: "QR code para o app autenticador" })).toBeVisible();
    await page.getByText("Não consigo ler o QR code").click();
    const segredo = ((await page.locator("details p").textContent()) ?? "").trim();
    await page.getByLabel("Código que aparece no app").fill(codigoDoApp(segredo));
    await page.getByRole("button", { name: "Confirmar" }).click();

    await expect(page.getByText("Guarde os códigos de recuperação")).toBeVisible();
    await expect(page.locator("ul li")).toHaveCount(10);
    await page.getByRole("button", { name: "Já guardei os códigos" }).click();
    await expect(page.getByRole("heading", { name: /, Adm!$/ })).toBeVisible();

    // Sai e entra de novo: agora o código é pedido.
    await page.getByRole("button", { name: "Sair" }).click();
    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText("Confirme que é você")).toBeVisible();
    await page.getByLabel("Código do app").fill("000000");
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("alert")).toHaveText("Código incorreto. Confira o app e tente de novo.");
    await page.getByLabel("Código do app").fill(codigoDoApp(segredo, 1));
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("heading", { name: /, Adm!$/ })).toBeVisible();
  });
});

test.describe("passkey nas telas", () => {
  test.describe.configure({ mode: "serial" });
  let dono: pg.Client;
  let email: string;
  let empresaId: string;

  test.beforeAll(async () => {
    email = `passkey-${test.info().project.name}-${randomUUID().slice(0, 8)}@teste.invalid`;
    dono = new pg.Client({ connectionString: BANCO_DONO });
    await dono.connect();
    const empresa = await dono.query<{ id: string }>("insert into empresas (nome) values ($1) returning id", [
      `Empresa ${email}`,
    ]);
    empresaId = empresa.rows[0]?.id ?? "";
    const pessoa = await dono.query<{ id: string }>(
      "insert into pessoas (nome, email, email_verificado) values ('Pass Key', $1, true) returning id",
      [email],
    );
    const id = pessoa.rows[0]?.id;
    await dono.query(
      "insert into acesso.credenciais (pessoa_id, provedor, conta_no_provedor, senha) values ($1, 'credential', $2, $3)",
      [id, id, await embaralharSenha(SENHA)],
    );
    await dono.query(
      "insert into vinculos (empresa_id, pessoa_id, perfil, situacao, convidado_em, entrou_em) values ($1, $2, 'administrador', 'ativo', now(), now())",
      [empresaId, id],
    );
  });

  test.afterAll(async () => {
    await dono.query("delete from pessoas where email = $1", [email]);
    await dono.query("delete from empresas where id = $1", [empresaId]);
    await dono.end();
  });

  test("administradora cadastra a passkey, sai e entra só com ela", async ({ page }) => {
    // Autenticador virtual do Chromium, no lugar do Touch ID: confirma a biometria sozinho.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const parte = () => Math.floor(Math.random() * 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${parte()}.${parte()}.${parte()}` });

    await page.goto("/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText("Ative a autenticação em 2 fatores")).toBeVisible();
    await page.getByRole("button", { name: "Usar passkey (recomendado)" }).click();
    await expect(page.getByRole("heading", { name: /, Pass!$/ })).toBeVisible();

    await page.getByRole("button", { name: "Sair" }).click();
    await page.goto("/entrar");
    await page.getByRole("button", { name: "Entrar com passkey" }).click();
    await expect(page.getByRole("heading", { name: /, Pass!$/ })).toBeVisible();
  });
});
