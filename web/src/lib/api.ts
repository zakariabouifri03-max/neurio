import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { AuthError, getCurrentUser } from './auth';
import type { SessionUser } from './auth';

/** Consistent JSON envelope for every API route. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; details?: unknown };

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data } satisfies ApiResult<T>, init);
}

export function fail(error: string, status = 400, code?: string, details?: unknown): NextResponse {
  return NextResponse.json({ ok: false, error, code, details } satisfies ApiResult<never>, { status });
}

export function notFound(what = 'Not found'): NextResponse {
  return fail(what, 404, 'NOT_FOUND');
}

export function unauthorized(): NextResponse {
  return fail('Sign in to continue', 401, 'UNAUTHORIZED');
}

export function forbidden(what = 'You do not have access to this resource'): NextResponse {
  return fail(what, 403, 'FORBIDDEN');
}

export function tooMany(what = 'Too many requests, slow down'): NextResponse {
  return fail(what, 429, 'RATE_LIMITED');
}

/** Wraps a route handler with uniform error handling. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AuthError) return fail(err.code, err.status, err.code);
      if (err instanceof ZodError) {
        return fail('Validation failed', 422, 'VALIDATION', err.flatten?.() ?? err.errors);
      }
      const message = err instanceof Error ? err.message : 'Unexpected error';
      if (process.env.NODE_ENV !== 'production') console.error('[api]', err);
      return fail(message, 500, 'INTERNAL');
    }
  };
}

/** Parses + validates a JSON body, returning a 422 response on failure. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'Body must be valid JSON' },
    ]);
  }
  return schema.parse(raw);
}

export async function userOr401(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('UNAUTHORIZED', 401);
  return user;
}

/* ------------------------------------------------------------- rate limiting */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * In-process token bucket. Suitable for single-node deployments; behind more
 * than one instance, swap the Map for Redis with the same call signature.
 */
export function rateLimit(key: string, limit = 60, windowMs = 60_000): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 20_000) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  bucket.count += 1;
  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count <= limit,
    remaining,
    retryAfter: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function clientKey(req: Request, scope: string): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local';
  return `${scope}:${ip}`;
}
