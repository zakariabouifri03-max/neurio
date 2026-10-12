/** HTTP helpers shared by the REST layer. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './ids';

export const MAX_JSON_BODY = 2 * 1024 * 1024; // 2 MiB of JSON is plenty
export const MAX_UPLOAD_BODY = 64 * 1024 * 1024; // 64 MiB per request

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload === undefined ? null : payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.code, message: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 500, { error: 'internal_error', message });
}

export async function readBody(req: IncomingMessage, limit = MAX_JSON_BODY): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'Request body too large', 'payload_too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, 'Request body too large', 'payload_too_large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  if (body.length === 0) return {} as T;
  try {
    return JSON.parse(body.toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'invalid_json');
  }
}

/**
 * Parse `multipart/form-data` using the WHATWG FormData implementation that
 * ships with Node — no `busboy`/`multer` dependency required.
 */
export async function readMultipart(req: IncomingMessage, limit = MAX_UPLOAD_BODY): Promise<FormData> {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(400, 'Expected multipart/form-data', 'invalid_content_type');
  }
  const body = await readBody(req, limit);
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': contentType, 'content-length': String(body.length) },
    body: new Uint8Array(body) as unknown as BodyInit,
  });
  try {
    return await request.formData();
  } catch (error) {
    throw new HttpError(400, `Could not parse upload: ${(error as Error).message}`, 'invalid_multipart');
  }
}

export function parseQuery(url: string): URLSearchParams {
  const index = url.indexOf('?');
  return new URLSearchParams(index === -1 ? '' : url.slice(index + 1));
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** Tiny sliding-window limiter used for auth + upload endpoints. */
export class RateLimiter {
  #hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, cost = 1): boolean {
    const now = Date.now();
    const hits = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (hits.length + cost > this.limit) {
      this.#hits.set(key, hits);
      return false;
    }
    for (let i = 0; i < cost; i += 1) hits.push(now);
    this.#hits.set(key, hits);
    return true;
  }

  reset(key: string): void {
    this.#hits.delete(key);
  }

  /** Drop old entries so the map cannot grow forever. */
  sweep(): void {
    const now = Date.now();
    for (const [key, hits] of this.#hits) {
      const fresh = hits.filter((t) => now - t < this.windowMs);
      if (fresh.length === 0) this.#hits.delete(key);
      else this.#hits.set(key, fresh);
    }
  }
}

export function assertObject(value: unknown, name = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `Expected ${name} to be an object`, 'invalid_body');
  }
  return value as Record<string, unknown>;
}

export function optionalString(value: unknown, field: string, maxLength = 4000): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`, 'invalid_field');
  return value.slice(0, maxLength);
}

export function requiredString(value: unknown, field: string, maxLength = 4000): string {
  const parsed = optionalString(value, field, maxLength);
  if (parsed === undefined || parsed.trim().length === 0) {
    throw new HttpError(400, `${field} is required`, 'missing_field');
  }
  return parsed;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new HttpError(400, `${field} must be a boolean`, 'invalid_field');
}

export function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${field} must be a number`, 'invalid_field');
  return parsed;
}
