/**
 * Applies database/schema.sql to DATABASE_URL.
 * Usage: DATABASE_URL=postgres://... npm run db:init -w backend
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));

export async function applySchema(connectionString: string): Promise<void> {
  const sql = readFileSync(resolve(here, "../../../database/schema.sql"), "utf8");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  applySchema(url)
    .then(() => console.log("Schema applied."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
