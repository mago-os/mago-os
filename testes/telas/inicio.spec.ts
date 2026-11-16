import { expect, test } from "@playwright/test";

test.describe("tela inicial", () => {
  test("abre com o mago e mostra que a API e o banco estão no ar", async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(e.message));
    page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

    await page.goto("/");
    await expect(page).toHaveTitle("Mago OS");
    await expect(page.getByRole("img", { name: "Rosto animado do mago" })).toBeVisible();
    await expect(page.getByText(/Tudo funcionando/)).toBeVisible();
    await expect(page.getByText("Número de rastreio:")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("não rola para os lados", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Tudo funcionando/)).toBeVisible();
    const rolaParaOLado = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(rolaParaOLado).toBe(false);
  });

  test("troca entre os temas automático, claro e escuro, e lembra a escolha", async ({ page }) => {
    await page.goto("/");
    const raiz = page.locator("html");
    const botao = page.getByRole("button", { name: /^Tema:/ });

    await expect(raiz).not.toHaveAttribute("data-theme");
    await botao.click();
    await expect(raiz).toHaveAttribute("data-theme", "light");
    await botao.click();
    await expect(raiz).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(raiz).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: /^Tema:/ }).click();
    await expect(raiz).not.toHaveAttribute("data-theme");
  });

  test("pode ser instalada como app", async ({ page, request }) => {
    await page.goto("/");
    const endereco = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(endereco).toBeTruthy();
    const manifesto = await (await request.get(endereco ?? "")).json();
    expect(manifesto).toMatchObject({ name: "Mago OS", display: "standalone", lang: "pt-BR" });
    for (const icone of manifesto.icons as { src: string }[]) {
      expect((await request.get(`/${icone.src}`)).ok()).toBe(true);
    }
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)))
      .toBe(1);
  });

  test("avisa quando a API não responde", async ({ page }) => {
    await page.route("**/api/saude", (rota) => rota.abort());
    await page.goto("/");
    await expect(page.getByText("Não foi possível falar com a API.")).toBeVisible();
    await expect(page.getByText("Fora do ar")).toBeVisible();
  });
});
