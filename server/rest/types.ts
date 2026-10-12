/** Shared types for the REST layer. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database } from '../db';
import type { RuntimeConfig } from '../config';
import type { PresenceManager } from '../presence';
import type { Gateway } from '../gateway';
import type { RateLimiter } from '../http';
import type { UploadService } from '../uploads';
import type { SessionRow, UserRow } from '../store/users';

export interface RestDeps {
  db: Database;
  presence: PresenceManager;
  gateway: Gateway;
  config: RuntimeConfig;
  limiter: RateLimiter;
  uploads: UploadService;
  /** id of the server operator (first account created), if any */
  operatorId(): string | null;
  setOperatorId(id: string): void;
  /** mutable runtime switches persisted in the meta table */
  registrationOpen(): boolean;
  setRegistrationOpen(open: boolean): void;
  now(): number;
}

export interface RouteContext {
  db: Database;
  user: UserRow | null;
  session: SessionRow | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req: IncomingMessage;
  res: ServerResponse;
  deps: RestDeps;
}

export type Handler = (ctx: RouteContext) => Promise<unknown> | unknown;

export interface RouteOptions {
  auth?: boolean;
  limit?: { limit: number; windowMs: number; key?: (ctx: RouteContext) => string };
}
