import { createApp } from "./app";
import { db, log, production } from "./core";
const { http, io } = createApp();
async function start() {
  if (
    production &&
    (!process.env.APP_ORIGIN?.startsWith("https://") || !process.env.SMTP_HOST)
  )
    throw new Error("Production requires HTTPS APP_ORIGIN and SMTP_HOST");
  await db.$connect();
  http.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
    log.info("Voxora API is ready"),
  );
}
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  io.close();
  http.close();
  await db.$disconnect();
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
start().catch((e) => {
  log.error({ type: e.name }, "Startup failed; check environment and database");
  process.exitCode = 1;
  void stop();
});
