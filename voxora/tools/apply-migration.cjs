// Restricted-network fallback for a NEW empty local database only.
// Production MUST use prisma migrate deploy, which records migration history.
require("dotenv").config();
const { Client } = require("pg");
const fs = require("node:fs");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      fs.readFileSync(
        "prisma/migrations/20261011000000_initial/migration.sql",
        "utf8",
      ),
    );
    await c.query("COMMIT");
    console.log("Initial schema applied to empty development database");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
