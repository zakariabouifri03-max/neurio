import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import path from "node:path";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { db, auth, origins, production, HttpError, log } from "./core";
import { accounts } from "./accounts";
import { social } from "./social";
import { communities } from "./communities";
import { chat } from "./chat";
import { realtime } from "./realtime";
import { media, mediaClient } from "./media";
export function createApp() {
  const app = express();
  const http = createServer(app);
  const io = realtime(http);
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY_HOPS)
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
  app.set("io", io);
  app.set("media", mediaClient());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "blob:", "data:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: [
            "'self'",
            ...(process.env.LIVEKIT_URL ? [process.env.LIVEKIT_URL] : []),
          ],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "32kb" }), cookieParser());
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      !origins.includes(req.headers.origin)
    ) {
      res.status(403).json({ error: "Untrusted origin" });
      return;
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.cookies.voxora &&
      !req.headers.origin &&
      !req.headers.authorization
    ) {
      res.status(403).json({ error: "Origin required" });
      return;
    }
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/auth",
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    accounts,
  );
  app.use("/api", auth, social, communities, chat, media);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(express.static(path.resolve("dist/client")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/client/index.html")),
  );
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError) {
        res
          .status(400)
          .json({ error: "Invalid input", fields: err.flatten().fieldErrors });
        return;
      }
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        res
          .status(409)
          .json({ error: "This username, email, or record already exists" });
        return;
      }
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File is too large" });
        return;
      }
      if (err.type === "entity.parse.failed") {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }
      log.error({ type: err.name, code: err.code }, "Request failed");
      res
        .status(500)
        .json({ error: "The service could not complete this request" });
    },
  );
  return { app, http, io };
}
