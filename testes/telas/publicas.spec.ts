import { expect, test } from "@playwright/test";

// M6-05c (cartão #190): as páginas que o Google pede para publicar o login abrem sem login.
test.describe("páginas públicas", () => {
  test("Sobre abre sem login e leva a entrar e à política", async ({ page }) => {
    await page.goto("/sobre");
    await expect(page).toHaveURL(/\/sobre$/);
    await expect(page).toHaveTitle(/Mago OS/);
    await expect(page.getByRole("heading", { name: "Mago OS", level: 1 })).toBeVisible();
    await expect(page.getByText("Nolask Tecnologia Digital, CNPJ 36.142.232/0001-21")).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Política de Privacidade" }).click();
    await expect(page).toHaveURL(/\/privacidade$/);
    await page.goto("/sobre");
    await page.getByRole("link", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("Política de Privacidade abre sem login, com as seções e o contato", async ({ page }) => {
    await page.goto("/privacidade");
    await expect(page).toHaveURL(/\/privacidade$/);
    await expect(page).toHaveTitle("Política de Privacidade do Mago OS");
    await expect(
      page.getByRole("heading", { name: "Política de Privacidade do Mago OS", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(14);
    await expect(page.getByRole("heading", { name: "5. Login com Google" })).toBeVisible();
    await expect(page.getByRole("table").first()).toBeVisible();
    const texto = await page.getByRole("main").textContent();
    expect(texto ?? "").toContain("privacidade@osmago.com");
    expect(texto).not.toContain("—");
  });

  test("a tela de entrar leva às páginas públicas", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByRole("link", { name: "Política de Privacidade" }).click();
    await expect(page).toHaveURL(/\/privacidade$/);
    await page.getByRole("link", { name: "Sobre o Mago OS" }).click();
    await expect(page).toHaveURL(/\/sobre$/);
  });
});
