/** Tema da tela: automático (segue o aparelho), claro ou escuro. A escolha fica só neste navegador. */
export type Tema = "automatico" | "claro" | "escuro";

const CHAVE = "mago.tema";

export function lerTema(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === "claro" || salvo === "escuro") return salvo;
  } catch {}
  return "automatico";
}

export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === "automatico") delete raiz.dataset.theme;
  else raiz.dataset.theme = tema === "claro" ? "light" : "dark";
  try {
    if (tema === "automatico") localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, tema);
  } catch {}
}

export const PROXIMO_TEMA: Record<Tema, Tema> = {
  automatico: "claro",
  claro: "escuro",
  escuro: "automatico",
};
export const NOME_DO_TEMA: Record<Tema, string> = {
  automatico: "Automático",
  claro: "Claro",
  escuro: "Escuro",
};
