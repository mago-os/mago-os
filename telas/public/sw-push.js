/*
 * Push do Mago OS (M3-06), carregado pelo service worker do app instalável. Mostra a notificação com o texto genérico
 * que o servidor manda (nunca dado da tarefa) e, ao tocar, abre a tela do aviso.
 */
self.addEventListener("push", (evento) => {
  let dados = { titulo: "Mago OS", corpo: "Você tem uma notificação nova", link: "/" };
  try {
    dados = { ...dados, ...evento.data.json() };
  } catch {
    // Sem dados legíveis: fica a mensagem padrão.
  }
  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      data: { link: typeof dados.link === "string" && dados.link.startsWith("/") ? dados.link : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const link = evento.notification.data?.link ?? "/";
  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ("focus" in janela) {
          janela.navigate(link);
          return janela.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
