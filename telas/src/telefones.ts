/** Telefones dos contatos (M7-01): o formato internacional, a leitura e se provavelmente tem WhatsApp. */

/**
 * Se o número provavelmente tem WhatsApp, para a marca já vir certa (pedido do Sandro em 27/11/2026): no Brasil, só o
 * celular (9 dígitos depois do DDD, começando com 9); de fora do Brasil, não dá para saber, então vem marcado.
 */
export function provavelWhatsapp(e164: string): boolean {
  if (!e164.startsWith("+55")) return true;
  return /^\+55\d{2}9\d{8}$/.test(e164);
}

export function telefoneInternacional(texto: string): string {
  const t = texto.trim();
  const digitos = t.replace(/\D/g, "");
  if (t.startsWith("+")) return `+${digitos}`;
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) return `+${digitos}`;
  return `+${digitos}`;
}

/** +5511987654321 → +55 11 98765-4321 (os de fora do Brasil ficam como estão). */
export function telefoneParaLer(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : e164;
}
