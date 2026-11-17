/**
 * Ponto de partida da API. Rodar com o rastreio carregado antes:
 *   node --import ./src/rastreio.ts src/iniciar.ts
 */
import { carteiroDoLog } from "./acesso/carteiro.ts";
import { criarLogin, criarPoolDoLogin } from "./acesso/login.ts";
import { registrarRotasDoLogin } from "./acesso/rotas.ts";
import { criarBanco } from "./banco.ts";
import { ErroDeConfig, lerConfig } from "./config.ts";
import { criarFila } from "./fila.ts";
import { catalogoDeModulos } from "./permissoes/modulos.ts";
import { registrarRotaDaAuditoria, registrarRotasDePermissoes } from "./permissoes/rotas.ts";
import { criarVerificador } from "./permissoes/verificar.ts";
import { criarServidor } from "./servidor.ts";

async function iniciar(): Promise<void> {
  const config = lerConfig();
  const banco = criarBanco(config.bancoUrl);
  const fila = criarFila(config.bancoUrl);
  const app = criarServidor(config, banco);
  const poolDoLogin = config.acesso ? criarPoolDoLogin(config.acesso.bancoUrl) : null;
  if (config.acesso && poolDoLogin) {
    const login = criarLogin(
      { ...config.acesso, ambiente: config.ambiente, carteiro: carteiroDoLog(app.log, config.ambiente) },
      poolDoLogin,
    );
    registrarRotasDoLogin(app, login, poolDoLogin);
    const verificador = criarVerificador(login, poolDoLogin, banco.pool, catalogoDeModulos());
    registrarRotasDePermissoes(app, verificador, banco.pool);
    registrarRotaDaAuditoria(app, verificador, banco.pool);
  } else {
    app.log.warn("Login desligado: DATABASE_URL_ACESSO não foi informada (só permitido no Mac)");
  }

  fila.on("error", (erro) => app.log.error({ erro }, "Erro na fila"));
  await fila.start();
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
