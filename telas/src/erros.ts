/**
 * Erro do sistema com o número de rastreio (M6-02): quando a API falha do lado dela (5xx), a tela mostra o número
 * que voltou no cabeçalho x-rastreio, com um botão de copiar, para a pessoa mandar ao suporte. Os erros do pedido
 * (4xx, como uma senha errada) continuam só com a mensagem da própria tela.
 */

type Ouvinte = (rastreio: string | null) => void;
const ouvintes = new Set<Ouvinte>();

export function ouvirErrosDoSistema(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** Confere a resposta da API: se o erro foi do sistema, avisa com o número de rastreio. */
export function conferirErroDoSistema(resposta: Response): void {
  if (resposta.status < 500) return;
  const rastreio = resposta.headers.get("x-rastreio");
  for (const ouvir of ouvintes) ouvir(rastreio && /^[0-9a-f]{32}$/.test(rastreio) ? rastreio : null);
}
