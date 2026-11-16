/**
 * Testes de tela (Playwright), no tamanho de celular e de computador.
 * Sobe a API e a versão construída da tela sozinho. Precisa do banco com as migrações:
 * no Mac, pnpm local:subir; no GitHub Actions, o serviço PostgreSQL do fluxo de verificação.
 */
import { defineConfig, devices } from "@playwright/test";

const PORTA_API = 3999;
const PORTA_TELA = 4173;
const bancoDaApi = process.env.MAGO_E2E_BANCO_URL ?? "postgres://mago_app@127.0.0.1:54318/mago";

export default defineConfig({
  testDir: "testes/telas",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORTA_TELA}`, trace: "retain-on-failure" },
  projects: [
    { name: "celular", use: { ...devices["Pixel 7"] } },
    { name: "computador", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: "node --import ./src/rastreio.ts src/iniciar.ts",
      cwd: "nucleo",
      url: `http://127.0.0.1:${PORTA_API}/saude`,
      env: { DATABASE_URL: bancoDaApi, PORTA: String(PORTA_API), HOST: "127.0.0.1", NIVEL_REGISTRO: "warn" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm construir && pnpm previa --strictPort",
      cwd: "telas",
      url: `http://127.0.0.1:${PORTA_TELA}`,
      env: { MAGO_API_URL: `http://127.0.0.1:${PORTA_API}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
