/**
 * "Perdi o celular e os códigos": desliga o 2FA de uma pessoa (M1-05). Só roda no servidor, com a configuração
 * da API, por quem tem acesso de dono à VPS. Apaga o app autenticador, as passkeys, os aparelhos confiáveis e
 * todas as sessões; a pessoa ativa de novo no próximo login (se for obrigatório para ela, o sistema exige).
 *   node src/acesso/desligar-dois-fatores.ts --email "pessoa@exemplo.com"
 */
import { parseArgs } from "node:util";
import { normalizarEmail } from "@mago-os/contratos";
import type pg from "pg";
import { lerConfig } from "../config.ts";
import { criarPoolDoLogin } from "./login.ts";

export async function desligarDoisFatores(pool: pg.Pool, email: string): Promise<{ pessoaId: string }> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    const pessoa = await cliente.query<{ id: string }>("select id from pessoas where email = $1", [
      normalizarEmail(email),
    ]);
    const pessoaId = pessoa.rows[0]?.id;
    if (!pessoaId) throw new Error("Não há pessoa com esse e-mail.");
    await cliente.query("delete from acesso.dois_fatores where pessoa_id = $1", [pessoaId]);
    await cliente.query("delete from acesso.passkeys where pessoa_id = $1", [pessoaId]);
    // Aparelhos confiáveis e links pendentes guardam o identificador da pessoa no valor.
    await cliente.query("delete from acesso.verificacoes where valor = $1", [pessoaId]);
    await cliente.query("delete from acesso.sessoes where pessoa_id = $1", [pessoaId]);
    await cliente.query(
      "update pessoas set dois_fatores_ativo = false, atualizada_em = now() where id = $1",
      [pessoaId],
    );
    await cliente.query("commit");
    return { pessoaId };
  } catch (erro) {
    await cliente.query("rollback").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  const config = lerConfig();
  if (!values.email || !config.acesso) {
    console.error(
      'Uso: node src/acesso/desligar-dois-fatores.ts --email "pessoa@exemplo.com" (com a configuração da API)',
    );
    process.exit(1);
  }
  const pool = criarPoolDoLogin(config.acesso.bancoUrl);
  try {
    await desligarDoisFatores(pool, values.email);
    console.log(
      "2FA desligado, aparelhos confiáveis e sessões apagados. A pessoa ativa de novo no próximo login.",
    );
    console.log(
      JSON.stringify({
        evento: "dois_fatores.desativou",
        email: normalizarEmail(values.email),
        por: "comando",
      }),
    );
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
