export interface BackendConfig {
  port: number;
  host: string;
  /** "postgres" | "memory" — memory is for tests/demo only. */
  storage: "postgres" | "memory";
  databaseUrl?: string;
  autoMigrate: boolean;
  corsOrigins: string[];
  rateLimitPerMinute: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "0.0.0.0",
    storage: env.STORAGE === "postgres" ? "postgres" : env.STORAGE === "memory" ? "memory" : env.DATABASE_URL ? "postgres" : "memory",
    databaseUrl: env.DATABASE_URL,
    autoMigrate: env.DATABASE_AUTO_MIGRATE === "1",
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:5173,chrome-extension://*,https://www.etsy.com").split(",").map((s) => s.trim()),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 240),
  };
}
