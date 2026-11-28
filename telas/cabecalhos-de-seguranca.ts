/**
 * Cabeçalhos de segurança da tela (M6-04). Valem no Caddy (teste e produção, infra/vps02/caddy/mago-os.caddy.modelo)
 * e na prévia da versão construída (vite preview), onde rodam os testes de tela: assim, os testes provam que a tela
 * funciona com eles. Um teste confere que o Caddy tem exatamente a mesma política.
 *
 * - Script só dos arquivos do próprio site (nada escrito na página, nada de fora).
 * - Estilo inline permitido (os componentes usam o atributo style); nada de folha de estilo de fora.
 * - Imagens do site, de data:/blob: e de https (a foto do Google e a prévia dos anexos).
 * - Conexões com a própria API (inclusive o WebSocket) e com o Backblaze (o envio dos anexos vai direto para lá).
 *   Trocar o depósito dos anexos (MAGO_ANEXOS_ENDPOINT) para outro serviço exige pôr o endereço dele aqui também.
 * - O site não abre dentro de outro (contra clique enganado) e não usa câmera nem localização. O microfone vale só no
 *   próprio Mago OS, para gravar a mensagem de voz na caixa (M8-08, decisão 0058).
 */
export const POLITICA_DE_CONTEUDO = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.backblazeb2.com",
  "media-src 'self' blob: https://*.backblazeb2.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export const CABECALHOS_DE_SEGURANCA: Record<string, string> = {
  "Content-Security-Policy": POLITICA_DE_CONTEUDO,
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
};
