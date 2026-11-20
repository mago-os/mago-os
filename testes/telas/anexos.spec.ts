import { expect, test } from "@playwright/test";
import pg from "pg";
import { BANCO_DONO } from "../../playwright.config.ts";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

test.describe("anexos", () => {
  let adm: PessoaDeTeste;

  test.beforeAll(async () => {
    adm = await criarPessoaDeTeste(`anexos-${test.info().project.name}`, {
      nome: "Ana Anexo",
      perfil: "funcionario",
    });
  });

  test.afterAll(async () => {
    const c = new pg.Client({ connectionString: BANCO_DONO });
    await c.connect();
    await c.query("delete from tarefas where empresa_id = $1", [adm.empresaId]);
    await c.query("delete from avisos where empresa_id = $1", [adm.empresaId]);
    await c.end();
    await adm.limpar();
  });

  test("anexa um PDF que passa no antivírus e abre; o EICAR é bloqueado com o aviso", async ({ page }) => {
    await entrar(page, adm.email);
    const criou = await page.request.post("/api/tarefas", { data: { titulo: "Conferir a nota fiscal" } });
    const { id } = (await criou.json()) as { id: string };
    await page.goto(`/tarefas/${id}`);
    await expect(page.getByRole("heading", { name: "Anexos" })).toBeVisible();

    await page
      .getByLabel("Escolher arquivos")
      .first()
      .setInputFiles({
        name: "nota.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 nota fiscal de teste"),
      });
    const anexos = page.getByRole("list", { name: "Anexos" }).first();
    await expect(anexos.getByRole("button", { name: "nota.pdf", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // O link de 5 minutos abre o PDF numa aba nova, para ver na tela (inline).
    const respostaDoArquivo = page
      .context()
      .waitForEvent("response", (r) => r.url().includes("/api/deposito-local"));
    await anexos.getByRole("button", { name: "nota.pdf", exact: true }).click();
    const resposta = await respostaDoArquivo;
    expect(resposta.status()).toBe(200);
    expect(resposta.headers()["content-disposition"]).toContain("inline");

    await page
      .getByLabel("Escolher arquivos")
      .first()
      .setInputFiles({
        name: "eicar.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(EICAR),
      });
    await expect(page.getByText("Bloqueado pelo antivírus (o arquivo foi apagado)")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /Notificações: \d+ não lidas/ })).toBeVisible();

    // Programa é recusado antes de enviar.
    await page
      .getByLabel("Escolher arquivos")
      .first()
      .setInputFiles({
        name: "instalar.exe",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("MZ"),
      });
    await expect(page.getByText(/não pode ser anexado, porque pode rodar um programa/)).toBeVisible();
  });
});
