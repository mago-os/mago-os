import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// A tela chama a API sempre em /api. No Mac, o Vite repassa para o núcleo (porta 3000);
// em teste e produção, o Caddy faz o mesmo (M0-10).
const API = process.env.MAGO_API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  // No container local a pasta do código é só leitura, então o cache do Vite vai para outro lugar.
  cacheDir: process.env.VITE_CACHE_DIR ?? "node_modules/.vite",
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Mago OS",
        short_name: "Mago OS",
        description: "Pessoas e agentes de IA trabalhando juntos.",
        lang: "pt-BR",
        start_url: "/",
        display: "standalone",
        background_color: "#FAFAFA",
        theme_color: "#0A0A0B",
        icons: [
          { src: "icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "icone-512.png", sizes: "512x512", type: "image/png" },
          { src: "icone-512-mascara.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // A API nunca vem do cache: o estado precisa ser sempre o de agora.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: API, rewrite: (caminho) => caminho.replace(/^\/api/, "") } },
  },
});
