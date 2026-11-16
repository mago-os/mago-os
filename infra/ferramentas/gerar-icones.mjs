// Gera os ícones do app (PWA, favicon e iPhone) desenhando o mago em meio-tom sobre um quadrado cor de tinta.
// Uso: node infra/ferramentas/gerar-icones.mjs  (precisa do Chromium do Playwright: pnpm exec playwright install chromium)
import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..", "..");
const { chromium } = await import("@playwright/test");
const fonte = readFileSync(join(raiz, "telas/src/componentes/desenho-do-mago.ts"), "utf8");
const js = stripTypeScriptTypes(fonte).replaceAll(/^export /gm, "");

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
await pagina.setContent(
  `<html><body style="margin:0"><style>:root{--ink:#0A0A0B;--on-ink:#FFFFFF;--sec:#0E8C7E}</style></body></html>`,
);
await pagina.addScriptTag({ content: `${js}\nwindow.DesenhoDoMago = DesenhoDoMago;` });

// mascara: o mago fica menor, dentro da "zona segura" de 80% que o Android recorta em círculo
const icones = [
  { arquivo: "icone-192.png", lado: 192, mago: 0.86, canto: 0.18 },
  { arquivo: "icone-512.png", lado: 512, mago: 0.86, canto: 0.18 },
  { arquivo: "icone-512-mascara.png", lado: 512, mago: 0.62, canto: 0 },
  { arquivo: "apple-touch-icon.png", lado: 180, mago: 0.82, canto: 0 },
];
for (const { arquivo, lado, mago, canto } of icones) {
  const dados = await pagina.evaluate(
    ({ lado, mago, canto }) => {
      const fundo = document.createElement("canvas");
      fundo.width = fundo.height = lado;
      const ctx = fundo.getContext("2d");
      ctx.fillStyle = "#0A0A0B";
      ctx.beginPath();
      ctx.roundRect(0, 0, lado, lado, lado * canto);
      ctx.fill();
      const tam = Math.round(lado * mago);
      const c = document.createElement("canvas");
      document.body.appendChild(c);
      Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
      const d = new window.DesenhoDoMago(c, tam, "--on-ink");
      d.desenhar(0, "parado", true);
      ctx.drawImage(c, (lado - tam) / 2, (lado - tam) / 2);
      return fundo.toDataURL("image/png").split(",")[1];
    },
    { lado, mago, canto },
  );
  writeFileSync(join(raiz, "telas/public", arquivo), Buffer.from(dados, "base64"));
  console.log(`Ícone gerado: telas/public/${arquivo}`);
}
await navegador.close();
