/**
 * Link para definir a senha (primeiro acesso, ou quando o e-mail ainda não existe no sistema).
 * Roda no servidor, com a mesma configuração da API, e mostra o link só no terminal de quem rodou:
 *   node src/acesso/link-de-senha.ts --email "pessoa@exemplo.com"
 * O link vale 1 hora e só pode ser usado uma vez, igual ao link de recuperação.
 */
import { parseArgs } from "node:util";
import { normalizarEmail } from "@mago-os/contratos";
import { lerConfig } from "../config.ts";
import { criarLogin, criarPoolDoLogin } from "./login.ts";

export async function gerarLinkDeSenha(
  login: ReturnType<typeof criarLogin>,
  links: string[],
  email: string,
): Promise<string> {
  links.length = 0;
  await login.api.requestPasswordReset({ body: { email: normalizarEmail(email) } });
  const link = links[0];
  if (!link) throw new Error("Não há pessoa com esse e-mail. Crie antes com pnpm plataforma:iniciar.");
  return link;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  const config = lerConfig();
  if (!values.email || !config.acesso) {
    console.error(
      'Uso: node src/acesso/link-de-senha.ts --email "pessoa@exemplo.com" (com a configuração da API)',
    );
    process.exit(1);
  }
  const pool = criarPoolDoLogin(config.acesso.bancoUrl);
  const links: string[] = [];
  const login = criarLogin(
    {
      ...config.acesso,
      ambiente: config.ambiente,
      carteiro: {
        async enviarLinkDeSenha({ link }) {
          links.push(link);
        },
      },
    },
    pool,
  );
  try {
    const link = await gerarLinkDeSenha(login, links, values.email);
    console.log(`Link para definir a senha (vale 1 hora, uso único):\n${link}`);
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
