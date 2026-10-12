/** Sandbox/dev convenience only. Docker Compose is the supported local stack. */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: ".test-pg",
    user: "voxora",
    password: "local-development-only",
    port: 5432,
    persistent: true,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: console.error,
  });
  if (!existsSync(".test-pg/PG_VERSION")) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("voxora");
  } catch {}
  console.log("Development PostgreSQL listening on 127.0.0.1:5432");
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await pg.stop();
    process.exit(0);
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}
void main();
