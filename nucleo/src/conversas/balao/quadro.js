/*
 * O quadro do balão do Mago OS (M8-07): a conversa do visitante, dentro do iframe aberto pelo balao.js. O código do
 * visitante fica no armazenamento do navegador por 30 dias (o Mago OS guarda só o resumo). Antes de entrar, o
 * navegador resolve uma prova de trabalho leve (sem a pessoa ver nada). O endereço e o título da página vêm do site,
 * por mensagem entre janelas, só da janela que abriu o quadro.
 */
(() => {
  const chave = location.pathname.split("/")[2] ?? "";
  const raiz = document.getElementById("balao");
  if (!/^[A-Za-z0-9]{22}$/.test(chave) || !raiz) return;
  const api = `/balao/${chave}`;
  const guardado = `mago-visitante-${chave}`;
  let pagina = null;
  let aberto = true;
  let config = null;
  let desafio = null;
  let prova = null;
  let desafioEm = 0;
  const vistas = new Set();

  const ler = () => {
    try {
      const v = JSON.parse(localStorage.getItem(guardado) ?? "null");
      return v && new Date(v.venceEm) > new Date() ? v.codigo : null;
    } catch {
      return null;
    }
  };
  const guardar = (v) => {
    try {
      localStorage.setItem(guardado, JSON.stringify(v));
    } catch {
      // Sem armazenamento: o visitante vale até fechar a página.
    }
  };
  let codigo = ler();

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    if (e.data?.tipo === "mago-pagina" && typeof e.data.url === "string")
      pagina = { url: e.data.url.slice(0, 2000), titulo: String(e.data.titulo ?? "").slice(0, 200) || null };
    if (e.data?.tipo === "mago-aberto") aberto = !!e.data.aberto;
  });

  const el = (tag, atributos = {}, filhos = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(atributos)) {
      if (k === "texto") n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const f of filhos) n.appendChild(f);
    return n;
  };

  const lista = el("ol", { class: "mensagens", "aria-label": "Mensagens" });
  const aviso = el("p", { class: "aviso", role: "status" });
  const campo = el("textarea", {
    rows: "2",
    maxlength: "1000",
    "aria-label": "Sua mensagem",
    placeholder: "Escreva aqui",
  });
  // O campo escondido: pessoas não veem nem preenchem; robôs costumam preencher.
  const isca = el("input", {
    class: "isca",
    tabindex: "-1",
    autocomplete: "off",
    "aria-hidden": "true",
    name: "site",
  });
  const enviar = el("button", { type: "submit", texto: "Enviar" });

  async function pedir(metodo, caminho, corpo) {
    const r = await fetch(`${api}${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo ? { "content-type": "application/json" } : {}),
        ...(codigo ? { "x-visitante": codigo } : {}),
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      credentials: "omit",
    });
    const dados = await r.json().catch(() => ({}));
    if (r.status === 401) {
      codigo = null;
      try {
        localStorage.removeItem(guardado);
      } catch {
        // nada
      }
    }
    return { ok: r.ok, status: r.status, dados };
  }

  /** A prova de trabalho: o primeiro número cujo SHA-256 com o desafio começa com os bits zerados. */
  async function resolver(d) {
    const alvo = d.dificuldade;
    const cod = new TextEncoder();
    for (let n = 0; n < 50_000_000; n++) {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", cod.encode(`${d.desafio}:${n}`)));
      let bits = alvo;
      let ok = true;
      for (let i = 0; bits > 0; i++) {
        const b = h[i] ?? 0;
        if (bits >= 8) {
          if (b !== 0) ok = false;
          bits -= 8;
        } else {
          if (b >> (8 - bits) !== 0) ok = false;
          bits = 0;
        }
        if (!ok) break;
      }
      if (ok) return String(n);
    }
    return null;
  }

  async function prepararEntrada() {
    if (codigo || prova) return;
    const d = await pedir("GET", "/desafio");
    if (!d.ok) return;
    desafio = d.dados;
    desafioEm = Date.now();
    prova = resolver(desafio);
  }

  async function entrar() {
    if (codigo) return true;
    await prepararEntrada();
    const resposta = await prova;
    if (!desafio || !resposta) return false;
    // O tempo mínimo entre abrir e entrar (o servidor também confere).
    const falta = 2500 - (Date.now() - desafioEm);
    if (falta > 0) await new Promise((pronto) => setTimeout(pronto, falta));
    const r = await pedir("POST", "/visitante", { desafio: desafio.desafio, resposta, site: isca.value });
    prova = null;
    if (!r.ok) {
      mostrarAviso(r.dados.message ?? "Não deu para abrir a conversa agora.");
      return false;
    }
    codigo = r.dados.codigo;
    guardar(r.dados);
    return true;
  }

  function mostrarAviso(texto) {
    aviso.textContent = texto ?? "";
  }

  function desenhar(mensagens) {
    for (const m of mensagens) {
      if (vistas.has(m.id)) continue;
      vistas.add(m.id);
      const item = el("li", { class: m.de === "visitante" ? "minha" : "deles" }, [
        ...(m.de === "empresa" && m.nome ? [el("span", { class: "nome", texto: m.nome })] : []),
        el("p", { texto: m.texto }),
      ]);
      lista.appendChild(item);
    }
    lista.lastElementChild?.scrollIntoView({ block: "end" });
  }

  async function buscar() {
    if (!codigo) return;
    const r = await pedir("GET", `/mensagens${aberto ? "?aberto=1" : ""}`);
    if (r.ok) desenhar(r.dados.mensagens ?? []);
  }

  let espera = null;
  const repetir = () => {
    clearTimeout(espera);
    espera = setTimeout(
      async () => {
        await buscar().catch(() => {});
        repetir();
      },
      aberto ? 3000 : 20000,
    );
  };

  async function mandar(texto) {
    enviar.disabled = true;
    try {
      if (!(await entrar())) return;
      const r = await pedir("POST", "/mensagens", { texto, ...(pagina ? { pagina } : {}) });
      if (!r.ok) {
        mostrarAviso(r.dados.message ?? "A mensagem não foi. Tente de novo.");
        return;
      }
      campo.value = "";
      mostrarAviso("");
      await buscar();
    } finally {
      enviar.disabled = false;
    }
  }

  async function continuarNoWhatsapp() {
    if (!(await entrar())) return;
    const r = await pedir("POST", "/whatsapp", {});
    if (r.ok && typeof r.dados.link === "string" && r.dados.link.startsWith("https://wa.me/"))
      window.open(r.dados.link, "_blank", "noopener");
    else mostrarAviso(r.dados.message ?? "O WhatsApp não está disponível agora.");
  }

  async function iniciar() {
    const r = await pedir("GET", "/configuracao");
    if (!r.ok) {
      raiz.textContent = "Conversa indisponível.";
      return;
    }
    config = r.dados;
    document.documentElement.style.setProperty("--cor", config.cor);
    const fechar = el("button", {
      type: "button",
      class: "fechar",
      "aria-label": "Fechar a conversa",
      texto: "×",
    });
    fechar.addEventListener("click", () => window.parent.postMessage({ tipo: "mago-fechar" }, "*"));
    const politica = el("a", {
      href: config.politicaUrl,
      target: "_blank",
      rel: "noopener noreferrer",
      texto: "política de privacidade",
    });
    const privacidade = el("p", { class: "privacidade" }, [
      document.createTextNode("Ao conversar, você concorda com a "),
      politica,
      document.createTextNode("."),
    ]);
    const form = el("form", { class: "escrever" }, [isca, campo, enviar]);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const texto = campo.value.trim();
      if (texto) void mandar(texto);
    });
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    const rodape = [privacidade];
    if (config.whatsapp) {
      const zap = el("button", { type: "button", class: "whatsapp", texto: "Continuar no WhatsApp" });
      zap.addEventListener("click", () => void continuarNoWhatsapp());
      rodape.push(zap);
    }
    raiz.append(
      el("header", {}, [el("h1", { texto: config.nome }), fechar]),
      el("p", { class: "boas-vindas", texto: config.boasVindas }),
      lista,
      aviso,
      form,
      el("footer", {}, rodape),
    );
    void prepararEntrada();
    await buscar();
    repetir();
  }

  void iniciar();
})();
