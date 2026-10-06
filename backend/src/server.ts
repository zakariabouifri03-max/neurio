/**
 * Backend entry point.
 * STORAGE=postgres requires DATABASE_URL; STORAGE=memory runs stateless.
 */
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresStore } from "./postgresStore.js";
import { MemoryStore } from "@etsy-signal/shared";
import { applySchema } from "./db/init.js";
import type { SignalStore } from "./store.js";

async function main() {
  const config = loadConfig();
  let store: SignalStore;

  if (config.storage === "postgres") {
    if (!config.databaseUrl) {
      console.error("STORAGE=postgres requires DATABASE_URL. Use STORAGE=memory for a dependency-free demo.");
      process.exit(1);
    }
    if (config.autoMigrate) {
      await applySchema(config.databaseUrl);
      console.log("Schema auto-migrated.");
    }
    store = new PostgresStore(config.databaseUrl);
  } else {
    console.warn("Running with STORAGE=memory — history is lost on restart. Use STORAGE=postgres in production.");
    store = new MemoryStore();
  }

  const app = await buildApp({ store, corsOrigins: config.corsOrigins });
  await app.listen({ port: config.port, host: config.host });
  console.log(`etsy-signal backend listening on ${config.host}:${config.port} (storage=${config.storage})`);

  const shutdown = async () => {
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
