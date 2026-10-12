/**
 * Composition root: wires database, presence, gateway, REST router and the
 * HTTP server together. Used by three entry points:
 *   • `npm run server`      — standalone self-hosted server (LAN or public)
 *   • Electron main process — starts a private localhost server for the desktop app
 *   • tests                 — `createApp({ dataDir: ':memory:' })`
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Database } from './db';
import { buildConfig, type ConfigOverrides, type RuntimeConfig } from './config';
import { logger, setLogLevel } from './logger';
import { PresenceManager } from './presence';
import { Gateway } from './gateway';
import { UploadService } from './uploads';
import { createRouter, type RestDeps } from './rest';
import { bearerToken, parseQuery, RateLimiter, readJson, sendError, sendJson } from './http';
import { HttpError } from './ids';
import { createStaticHandler } from './static';
import { listDmChannels, guildIdsForUser } from './store/guilds';
import { getVoiceState } from './store/voice';
import { sessionFromToken, getUserById } from './store/users';
import type { RouteContext } from './rest/types';

const log = logger('app');

export interface AppOptions extends ConfigOverrides {
  verbose?: boolean;
  /** automatically pick the next free port when the preferred one is taken */
  autoPort?: boolean;
}

export interface StartedApp {
  url: string;
  port: number;
  host: string;
}

export interface NeurioApp {
  config: RuntimeConfig;
  db: Database;
  presence: PresenceManager;
  gateway: Gateway;
  uploads: UploadService;
  server: Server;
  started?: StartedApp;
  start(): Promise<StartedApp>;
  stop(): Promise<void>;
}

/** Channel types that may hold voice states (voice channels + DM calls). */
export const VOICE_CHANNEL_TYPES = ['voice'] as const;

export async function createApp(options: AppOptions = {}): Promise<NeurioApp> {
  const config = buildConfig(options);
  setLogLevel(config.logLevel);

  const memory = options.dataDir === ':memory:';
  const db = openDatabase({ file: memory ? ':memory:' : config.dbFile, verbose: options.verbose !== false });

  const presence = new PresenceManager(db);
  presence.setVoiceLookup((userId) => getVoiceState(db, userId)?.channel_id ?? null);

  const uploadsRoot = memory ? mkdtempSync(join(tmpdir(), 'neurio-test-')) : config.uploadsDir;
  const uploads = new UploadService(uploadsRoot, config.maxUploadBytes);
  const limiter = new RateLimiter(240, 10_000);

  const gateway = new Gateway({
    db,
    presence,
    serverName: config.serverName,
    serverVersion: config.version,
    buildReady: (userId) => ({
      guilds: guildIdsForUser(db, userId),
      dmChannelIds: listDmChannels(db, userId).map((channel) => channel.id),
    }),
  });

  /* ------------------------------- runtime meta --------------------------- */

  const deps: RestDeps = {
    db,
    presence,
    gateway,
    config,
    limiter,
    uploads,
    operatorId: () => db.getMeta('operator_id'),
    setOperatorId: (id) => db.setMeta('operator_id', id),
    registrationOpen: () => {
      const stored = db.getMeta('registration_open');
      if (stored === null || stored === undefined) return config.registrationOpen;
      return stored === '1';
    },
    setRegistrationOpen: (open) => db.setMeta('registration_open', open ? '1' : '0'),
    now: () => Date.now(),
  };
  if (!db.getMeta('operator_id')) log.debug('no operator yet; the first account will own this server');

  const router = createRouter(deps);
  if (options.verbose !== false) {
    log.debug(`registered ${router.routes().length} REST routes`);
  }

  const staticHandler = config.staticDir ? createStaticHandler({ dir: config.staticDir }) : null;

  /* ------------------------------ auth bridging --------------------------- */

  function authenticateRequest(req: IncomingMessage, urlPath: string): { user: RouteContext['user']; session: RouteContext['session'] } {
    let token = bearerToken(req);
    // Browsers cannot set headers on <img>/<video> tags, so file URLs may carry
    // the session token as ?t=… (never allowed for mutations).
    if (!token && urlPath.startsWith('/api/files/')) {
      token = parseQuery(req.url ?? '').get('t');
    }
    if (!token) return { user: null, session: null };
    const session = sessionFromToken(db, token);
    if (!session) return { user: null, session: null };
    const user = getUserById(db, session.user_id);
    if (!user) return { user: null, session: null };
    return { user, session };
  }

  /* -------------------------------- HTTP ---------------------------------- */

  const requestHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? '/';
    const urlPath = url.split('?')[0];

    // Same-origin in every real deployment; permissive CORS keeps the Vite dev
    // server (5173) able to talk to this API while developing.
    if (config.allowWeb) {
      res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.setHeader('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (urlPath === '/api' || urlPath.startsWith('/api/')) {
        const segments = urlPath.split('/').filter((segment) => segment.length > 0);
        const method = (req.method ?? 'GET').toUpperCase();
        const found = router.match(method, segments);
        if (!found) {
          sendError(res, new HttpError(404, `No route for ${method} ${urlPath}`, 'not_found'));
          return;
        }
        const { user, session } = authenticateRequest(req, urlPath);
        const requiresAuth = found.route.options.auth !== false;
        if (requiresAuth && !user) {
          sendError(res, new HttpError(401, 'You must sign in first', 'unauthorized'));
          return;
        }
        const ctx: RouteContext = {
          db,
          user,
          session,
          params: found.params,
          query: parseQuery(url),
          body: {},
          req,
          res,
          deps,
        };
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
          const contentType = String(req.headers['content-type'] ?? '');
          if (contentType.includes('application/json')) {
            ctx.body = (await readJson(req)) as Record<string, unknown>;
          } else if (contentType.includes('multipart/form-data')) {
            ctx.body = {}; // handlers read the raw multipart stream themselves
          }
        }
        try {
          if (found.route.options.limit && user) {
            const key = found.route.options.limit.key
              ? found.route.options.limit.key(ctx)
              : `${user.id}:${method} ${urlPath}`;
            if (key && !limiter.check(key, found.route.options.limit.limit)) {
              throw new HttpError(429, 'You are doing that too fast — please wait a moment', 'rate_limited');
            }
          }
          const result = await found.route.handler(ctx);
          if (!res.headersSent) {
            if (result === undefined) {
              res.writeHead(204);
              res.end();
            } else {
              sendJson(res, 200, result);
            }
          }
          // When a handler has already written headers (file streaming) it owns
          // the response — never end it early or the stream gets truncated.
        } catch (error) {
          if (!res.headersSent) sendError(res, error);
          else log.warn(`late error on ${urlPath}: ${(error as Error).message}`);
        }
        return;
      }

      if (staticHandler && staticHandler(url, res)) return;

      sendJson(res, 404, {
        error: 'not_found',
        message: staticHandler
          ? `No such path: ${urlPath}`
          : 'Neurio API server is running. Build the renderer (npm run build) or start it in dev mode.',
      });
    } catch (error) {
      log.error(`request failed: ${(error as Error).message}`);
      if (!res.headersSent) sendError(res, error);
    }
  };

  const server = createServer((req, res) => {
    void requestHandler(req, res);
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 120_000;

  gateway.attach(server);

  /* ------------------------------- lifecycle ------------------------------ */

  const sweeper = setInterval(() => {
    limiter.sweep();
    try {
      uploads.sweepOrphans(db, 24 * 60 * 60 * 1000);
    } catch (error) {
      log.warn(`upload sweep failed: ${(error as Error).message}`);
    }
  }, 6 * 60 * 60 * 1000);
  sweeper.unref?.();

  const app: NeurioApp = {
    config,
    db,
    presence,
    gateway,
    uploads,
    server,
    async start() {
      const started = await listen(server, config.host, config.port, options.autoPort !== false);
      app.started = started;
      log.info(`${config.serverName} ${config.version} listening on ${started.url}`);
      log.info(`data directory: ${config.dataDir}`);
      if (config.staticDir) log.info(`serving app from ${config.staticDir}`);
      return started;
    },
    async stop() {
      clearInterval(sweeper);
      gateway.shutdown();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Nothing should keep the loop alive for long.
        setTimeout(resolve, 1500).unref?.();
      });
      // Give any in-flight socket teardown a beat before the handle goes away.
      await new Promise((resolve) => setTimeout(resolve, 25));
      db.close();
    },
  };

  return app;
}

function listen(server: Server, host: string, port: number, autoPort: boolean): Promise<StartedApp> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const tryListen = (candidate: number): void => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (error.code === 'EADDRINUSE' && autoPort && attempts < 10) {
          attempts += 1;
          log.warn(`port ${candidate} in use, trying ${candidate + 1}`);
          tryListen(candidate + 1);
          return;
        }
        reject(error);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        const address = server.address() as AddressInfo;
        const actualPort = address.port;
        const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
        resolve({ url: `http://${displayHost}:${actualPort}`, port: actualPort, host });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(candidate, host);
    };
    tryListen(port);
  });
}

/** Helper for tests: a throwaway app backed by an in-memory database. */
export async function createTestApp(options: AppOptions = {}): Promise<NeurioApp> {
  return createApp({
    dataDir: ':memory:',
    port: 0,
    host: '127.0.0.1',
    logLevel: 'error',
    verbose: false,
    registrationOpen: true,
    ...options,
  });
}
