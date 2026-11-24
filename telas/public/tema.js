// Aplica o tema escolhido antes de desenhar a página, para não piscar. Fica num arquivo (e não dentro do
// index.html) porque a política de segurança da tela não aceita script escrito na página (M6-04).
try {
  const tema = localStorage.getItem("mago.tema");
  if (tema === "claro") document.documentElement.dataset.theme = "light";
  if (tema === "escuro") document.documentElement.dataset.theme = "dark";
} catch {}
