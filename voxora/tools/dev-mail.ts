/** Local development mailbox: stores messages as private files, never logs tokens. */
import { SMTPServer } from "smtp-server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const mail = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, _session, callback) {
    let data = "";
    stream.on("data", (chunk) => (data += chunk.toString()));
    stream.on("end", () => {
      mkdir("storage/dev-mail", { recursive: true })
        .then(() =>
          writeFile(`storage/dev-mail/${randomUUID()}.eml`, data, {
            mode: 0o600,
          }),
        )
        .then(() => callback())
        .catch(callback);
    });
  },
});
mail.listen(1025, "127.0.0.1", () =>
  console.log(
    "Development SMTP ready. Messages saved privately under storage/dev-mail (not committed).",
  ),
);
process.once("SIGTERM", () => mail.close());
process.once("SIGINT", () => mail.close());
