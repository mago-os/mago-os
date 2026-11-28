/*
 * O balão do Mago OS (M8-07). A linha de código no site:
 *   <script src="https://<Mago OS>/balao.js" data-canal="<chave>" async></script>
 * Este script só desenha o botão e abre o quadro da conversa, que é uma página do Mago OS: o site não lê o quadro e
 * o quadro não lê o site. Os dois só trocam o endereço e o título da página em que o visitante está.
 */
(() => {
  const script = document.currentScript;
  const chave = script?.getAttribute("data-canal") ?? "";
  if (!/^[A-Za-z0-9]{22}$/.test(chave) || window.__magoBalao) return;
  window.__magoBalao = true;
  const base = new URL(script.src).origin;

  fetch(`${base}/balao/${chave}/configuracao`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((config) => {
      if (config) montar(config);
    })
    .catch(() => {});

  function montar(config) {
    const lado = config.posicao === "esquerda" ? "left" : "right";
    const botao = document.createElement("button");
    botao.type = "button";
    botao.setAttribute("aria-label", `Abrir a conversa com ${config.nome}`);
    botao.style.cssText = `position:fixed;bottom:20px;${lado}:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;box-shadow:0 4px 14px rgba(0,0,0,.25);background:${config.cor};color:#fff;display:flex;align-items:center;justify-content:center;padding:0`;
    botao.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    document.body.appendChild(botao);

    let quadro = null;
    let aberto = false;
    const pagina = () => ({ url: location.href, titulo: document.title });
    const avisar = (mensagem) => quadro?.contentWindow?.postMessage(mensagem, base);
    const posicionar = () => {
      if (!quadro) return;
      const celular = window.innerWidth < 480;
      quadro.style.cssText = celular
        ? "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:#fff"
        : `position:fixed;bottom:88px;${lado}:20px;width:370px;height:560px;max-height:calc(100vh - 110px);border:0;border-radius:12px;z-index:2147483647;box-shadow:0 8px 30px rgba(0,0,0,.25);background:#fff`;
      quadro.style.display = aberto ? "block" : "none";
    };
    const abrir = (sim) => {
      aberto = sim;
      if (sim && !quadro) {
        quadro = document.createElement("iframe");
        quadro.src = `${base}/balao/${chave}`;
        quadro.title = `Conversa com ${config.nome}`;
        quadro.setAttribute("referrerpolicy", "no-referrer");
        quadro.addEventListener("load", () => {
          avisar({ tipo: "mago-pagina", ...pagina() });
          avisar({ tipo: "mago-aberto", aberto });
        });
        document.body.appendChild(quadro);
      }
      posicionar();
      avisar({ tipo: "mago-aberto", aberto });
      botao.setAttribute("aria-expanded", String(aberto));
    };
    botao.addEventListener("click", () => abrir(!aberto));
    window.addEventListener("resize", posicionar);
    window.addEventListener("message", (e) => {
      if (e.origin !== base || e.source !== quadro?.contentWindow) return;
      if (e.data?.tipo === "mago-fechar") abrir(false);
    });
    // Sites de uma página só (o endereço muda sem recarregar): o quadro fica sabendo.
    let ultimo = location.href;
    setInterval(() => {
      if (location.href !== ultimo) {
        ultimo = location.href;
        avisar({ tipo: "mago-pagina", ...pagina() });
      }
    }, 2000);
  }
})();
