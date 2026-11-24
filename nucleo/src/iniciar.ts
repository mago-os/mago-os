/**
 * Ponto de partida da API. Rodar com o rastreio carregado antes:
 *   node --import ./src/rastreio.ts src/iniciar.ts
 */
import { criarPoolDoLogin } from "./acesso/login.ts";
import { criarBanco } from "./banco.ts";
import { ErroDeConfig, lerConfig } from "./config.ts";
import { criarFila } from "./fila.ts";
import { montarApi } from "./montar.ts";

async function iniciar(): Promise<void> {
  const config = lerConfig();
  const banco = criarBanco(config.bancoUrl);
  const fila = criarFila(config.bancoUrl);
  const poolDoLogin = config.acesso ? criarPoolDoLogin(config.acesso.bancoUrl) : null;
  const { app, trabalhos } = await montarApi(config, { banco, fila, poolDoLogin });

  fila.on("error", (erro) => app.log.error({ erro }, "Erro na fila"));
  await fila.start();
  for (const ligar of trabalhos) await ligar();
  await app.listen({ port: config.porta, host: config.host });

  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    app.log.info({ sinal }, "Encerrando a API");
    await app.close();
    await fila.stop({ graceful: true });
    await banco.fechar();
    await poolDoLogin?.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void encerrar("SIGTERM"));
  process.once("SIGINT", () => void encerrar("SIGINT"));
}

iniciar().catch((erro: unknown) => {
  if (erro instanceof ErroDeConfig) {
    console.error(erro.message);
  } else {
    console.error("A API não conseguiu subir:", erro);
  }
  process.exit(1);
});
