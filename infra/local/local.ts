/**
 * Comandos do ambiente local (M0-03): subir, zerar e parar.
 * Subir: liga o banco, roda as migrações, carrega os dados falsos e liga a API.
 *
 * Uso: node infra/local/local.ts <subir|zerar|parar>
 * Roda direto no Node 26, sem compilar. Só usa o Docker; não precisa de psql instalado no Mac.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pasta = dirname(fileURLToPath(import.meta.url));
const compose = ["compose", "-f", join(pasta, "compose.yaml")];

function docker(args: string[], entrada?: string): void {
  execFileSync("docker", [...compose, ...args], {
    stdio: entrada === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    ...(entrada === undefined ? {} : { input: entrada }),
  });
}

/** Aplica os arquivos de dados-falsos/ em ordem de nome. Cada arquivo roda numa transação só. */
function carregarDadosFalsos(): void {
  const arquivos = readdirSync(join(pasta, "dados-falsos"))
    .filter((nome) => nome.endsWith(".sql"))
    .sort();
  for (const nome of arquivos) {
    const sql = readFileSync(join(pasta, "dados-falsos", nome), "utf8");
    console.log(`Dados falsos: ${nome}`);
    docker(
      ["exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-1", "-U", "mago", "-d", "mago"],
      sql,
    );
  }
}

/** Roda as migrações do núcleo no banco local, com o papel dono das tabelas. */
function migrar(): void {
  const porta = process.env.MAGO_DB_PORTA ?? "54318";
  execFileSync("node", ["src/migrar.ts", "subir"], {
    cwd: join(pasta, "..", "..", "nucleo"),
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL_DONO: `postgres://mago@127.0.0.1:${porta}/mago` },
  });
}

function subir(): void {
  docker(["up", "-d", "--wait", "db"]);
  migrar();
  carregarDadosFalsos();
  docker(["up", "-d", "--wait"]);
  const portaBanco = process.env.MAGO_DB_PORTA ?? "54318";
  const portaApi = process.env.MAGO_API_PORTA ?? "3000";
  console.log("\nMago OS local no ar.");
  console.log(`  API:   http://127.0.0.1:${portaApi}/saude`);
  console.log(`  Banco: postgres://mago@127.0.0.1:${portaBanco}/mago`);
}

const comando = process.argv[2];
if (comando === "subir") {
  subir();
} else if (comando === "zerar") {
  docker(["down", "--volumes", "--remove-orphans"]);
  subir();
} else if (comando === "parar") {
  docker(["down"]);
} else {
  console.error("Uso: node infra/local/local.ts <subir|zerar|parar>");
  process.exit(1);
}
