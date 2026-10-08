export type LogLevel = "info" | "warn" | "error";

const buffer: string[] = [];
const MAX = 500;

function stamp(level: LogLevel, message: string, extra?: unknown): string {
  const extraText = extra === undefined ? "" : ` ${safe(extra)}`;
  return `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${extraText}`;
}

function safe(extra: unknown): string {
  try {
    return typeof extra === "string" ? extra : JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}

async function persist(line: string): Promise<void> {
  buffer.push(line);
  if (buffer.length > MAX) buffer.shift();
  try {
    const existing = localStorage.getItem("animai.log") || "";
    const next = (existing + line + "\n").split("\n").slice(-MAX).join("\n");
    localStorage.setItem("animai.log", next);
  } catch {
    /* quota */
  }
  try {
    await window.animaiDesktop?.appendLog(line);
  } catch {
    /* web */
  }
}

export const log = {
  info(message: string, extra?: unknown) {
    const line = stamp("info", message, extra);
    console.log(line);
    void persist(line);
  },
  warn(message: string, extra?: unknown) {
    const line = stamp("warn", message, extra);
    console.warn(line);
    void persist(line);
  },
  error(message: string, extra?: unknown) {
    const line = stamp("error", message, extra);
    console.error(line);
    void persist(line);
  },
  dump(): string {
    return buffer.join("\n");
  },
};

window.addEventListener("error", (e) => {
  log.error("Unhandled error", e.message || String(e.error));
});

window.addEventListener("unhandledrejection", (e) => {
  log.error("Unhandled rejection", String(e.reason));
});
