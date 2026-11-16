/**
 * Decide se os testes com PostgreSQL real rodam.
 *
 * - Com o ambiente local no ar (pnpm local:subir) ou MAGO_TESTE_BANCO_URL informada: rodam.
 * - Sem banco acessível: são pulados com aviso, para não travar quem só mexe em outra parte.
 * - Com MAGO_EXIGIR_BANCO=1 (o GitHub Actions usa, a partir do M0-07): sem banco, falham.
 */
import { servidorDeTesteAcessivel, urlDoServidorDeTeste } from "@mago-os/nucleo/banco-temporario";

export const bancoDisponivel = await servidorDeTesteAcessivel();

if (!bancoDisponivel) {
  if (process.env.MAGO_EXIGIR_BANCO === "1") {
    throw new Error(
      `Os testes com banco são obrigatórios aqui, mas ${urlDoServidorDeTeste()} não respondeu.`,
    );
  }
  console.warn(
    "\n[testes] Banco de teste fora do ar: os testes com PostgreSQL real foram pulados. Rode pnpm local:subir.\n",
  );
}
