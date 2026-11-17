import { expect, test } from "@playwright/test";
import { criarPessoaDeTeste, entrar, type PessoaDeTeste } from "./ajuda.ts";

test.describe("tela inicial", () => {
  test.describe.configure({ mode: "serial" });
  let pessoa: PessoaDeTeste;

  test.beforeAll(async () => {
    pessoa = await criarPessoaDeTeste(`inicio-${test.info().project.name}`, { nome: "Ana Inicio" });
  });

  test.afterAll(async () => {
    await pessoa.limpar();
  });

  test("sem login, manda para a tela de entrar", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/entrar$/);
  });

  test("depois de entrar, abre com o mago e mostra que a API e o banco estão no ar", async ({ page }) => {
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(e.message));
    page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

    await entrar(page, pessoa.email);
    await expect(page).toHaveTitle("Mago OS");
    await expect(page.getByRole("heading", { name: /, Ana!$/ })).toBeVisible();
    await expect(page.getByRole("img", { name: "Rosto animado do mago" })).toBeVisible();
    await expect(page.getByText(/Tudo funcionando/)).toBeVisible();
    await expect(page.getByText("Número de rastreio:")).toBeVisible();
    expect(erros).toEqual([]);
  });

  test("não rola para os lados, e o menu aparece no lugar certo para o tamanho da tela", async ({
    page,
  }, info) => {
    await entrar(page, pessoa.email);
    await expect(page.getByText(/Tudo funcionando/)).toBeVisible();
    const rolaParaOLado = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(rolaParaOLado).toBe(false);
    const celular = info.project.name === "celular";
    await expect(page.getByRole("navigation", { name: "Menu do celular" })).toBeVisible({ visible: celular });
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeVisible({ visible: !celular });
  });

  test("troca entre os temas automático, claro e escuro, e lembra a escolha", async ({ page }) => {
    await page.goto("/entrar");
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
    await page.goto("/entrar");
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
    await entrar(page, pessoa.email);
    await page.route("**/api/saude", (rota) => rota.abort());
    await page.reload();
    await expect(page.getByText("Não foi possível falar com a API.")).toBeVisible();
    await expect(page.getByText("Fora do ar")).toBeVisible();
  });
});
