/**
 * O telefone que chega do WhatsApp (decisão 0051, item 2). O WhatsApp entrega o número sem o + e, em celulares
 * brasileiros antigos, às vezes sem o nono dígito (551188887777 para quem está cadastrado como +5511988887777).
 * Para achar o contato, procuramos as duas formas.
 */

/** O telefone no formato internacional (+ e os dígitos), ou nulo se não parece telefone. */
export function telefoneInternacional(bruto: string): string | null {
  const digitos = bruto
    .replace(/@.*$/, "")
    .replace(/[\s().-]/g, "")
    .replace(/^\+/, "");
  return /^[1-9][0-9]{7,14}$/.test(digitos) ? `+${digitos}` : null;
}

/**
 * As formas do mesmo telefone para procurar: ele mesmo e, no celular do Brasil (DDD e o número começando por 6 a 9),
 * a forma com e sem o nono dígito.
 */
export function formasDoTelefone(telefone: string): string[] {
  const com9 = /^\+55([1-9][0-9])9([6-9][0-9]{7})$/.exec(telefone);
  if (com9) return [telefone, `+55${com9[1]}${com9[2]}`];
  const sem9 = /^\+55([1-9][0-9])([6-9][0-9]{7})$/.exec(telefone);
  if (sem9) return [telefone, `+55${sem9[1]}9${sem9[2]}`];
  return [telefone];
}
