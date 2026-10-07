import 'server-only';
import { cookies, headers } from 'next/headers';
import crypto from 'node:crypto';
import { cache } from 'react';
import { all, get, run, now } from './db';
import { newId } from './ids';
import { users as userRepo, run as sqlRun } from './repo';
import { seedUserDefaults } from './seed';

/**
 * Session management.
 *
 * Opaque, high-entropy session tokens are stored **hashed** in the database, so
 * a database leak cannot be replayed as a login. Sessions are revocable,
 * expire, and record the creating IP/user-agent for account settings.
 */

const COOKIE_NAME = 'prism_session';
export const GUEST_COOKIE = 'prism_guest';
export const GUEST_HEADER = 'x-prism-guest';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;

/* ------------------------------------------------------------------ passwords */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const derived = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), KEY_LEN, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(hashB64, 'base64');
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function passwordStrength(password: string): { score: number; label: string; hints: string[] } {
  const hints: string[] = [];
  let score = 0;
  if (password.length >= 8) score += 1;
  else hints.push('Use at least 8 characters');
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  else hints.push('Mix upper and lower case');
  if (/\d/.test(password)) score += 1;
  else hints.push('Add a number');
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const label = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][Math.min(score, 4)];
  return { score: Math.min(score, 4), label, hints };
}

/* -------------------------------------------------------------------- tokens */

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/* ------------------------------------------------------------------ sessions */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  plan: string;
  locale: string;
  aiCredits: number;
  storageUsed: number;
  storageQuota: number;
  onboarded: boolean;
  createdAt: number;
  /** True for the anonymous account auto-created for visitors who never signed up. */
  guest: boolean;
};

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<string> {
  const token = randomToken(32);
  const expiresAt = now() + SESSION_TTL_MS;
  run('INSERT INTO sessions (id, user_id, token, user_agent, ip, expires_at, created_at) VALUES (?,?,?,?,?,?,?)', [
    newId('ses'),
    userId,
    sha256(token),
    meta.userAgent ?? null,
    meta.ip ?? null,
    expiresAt,
    now(),
  ]);
  run('UPDATE users SET last_seen_at = ? WHERE id = ?', [now(), userId]);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) run('DELETE FROM sessions WHERE token = ?', [sha256(token)]);
  jar.delete(COOKIE_NAME);
}

function toSessionUser(row: any): SessionUser {
  return {
    id: row.id,
    // Guests have no real address; the placeholder stays server-side only.
    email: row.is_guest ? '' : row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    plan: row.plan,
    locale: row.locale,
    aiCredits: Number(row.ai_credits),
    storageUsed: Number(row.storage_used),
    storageQuota: Number(row.storage_quota),
    onboarded: !!row.onboarded,
    createdAt: Number(row.created_at),
    guest: !!row.is_guest,
  };
}

/* --------------------------------------------------------------------- guests */

/** Deterministic, collision-free placeholder address for a guest identity. */
export function guestEmail(guestId: string): string {
  return `guest_${guestId.replace(/[^a-zA-Z0-9]/g, '')}@prism.local`;
}

/**
 * Resolves the browser's guest id to a real user row, creating it on first use.
 *
 * Guests are ordinary rows in `users` — every project, upload and comment has a
 * valid owner, so no storage or permission code needs a special case.
 */
export function ensureGuestUser(guestId: string, locale = 'en'): SessionUser {
  const email = guestEmail(guestId);
  const existing = get<any>('SELECT * FROM users WHERE email = ?', [email]);
  if (existing) return toSessionUser(existing);
  const created = userRepo.create({
    email,
    name: 'Guest',
    locale,
    role: 'USER',
    guest: true,
  });
  // A starter brand kit keeps the brand panel useful from the first minute.
  try {
    seedUserDefaults(created.id);
  } catch {
    /* seeding is best-effort; the catalogue seeds lazily anyway */
  }
  // Occasional housekeeping: guest rows are cheap, but not free forever.
  if (Math.random() < 0.05) {
    try {
      pruneGuestUsers();
    } catch {
      /* ignore — cleanup runs again on the next guest */
    }
  }
  return toSessionUser(get<any>('SELECT * FROM users WHERE id = ?', [created.id])!);
}

async function guestIdFromRequest(): Promise<string | null> {
  const headerList = await headers();
  const fromHeader = headerList.get(GUEST_HEADER);
  if (fromHeader) return fromHeader;
  const jar = await cookies();
  const fromCookie = jar.get(GUEST_COOKIE)?.value;
  return fromCookie ?? null;
}

/**
 * Moves everything a guest created onto a real account, so signing up never
 * loses work. Runs inside the login/signup handlers.
 */
export function adoptGuestWork(guestId: string | null, userId: string): number {
  if (!guestId) return 0;
  const guest = userRepo.byEmail(guestEmail(guestId));
  if (!guest || !guest.isGuest || guest.id === userId) return 0;

  const owned = all<{ id: string }>('SELECT id FROM projects WHERE owner_id = ?', [guest.id]);
  let moved = 0;
  for (const project of owned) {
    sqlRun('UPDATE projects SET owner_id = ? WHERE id = ?', [userId, project.id]);
    sqlRun('INSERT OR IGNORE INTO shares (id, project_id, user_id, role, created_at) VALUES (?,?,?,?,?)', [
      newId('shr'),
      project.id,
      userId,
      'OWNER',
      now(),
    ]);
    moved += 1;
  }
  // Media, brand kits and favourites follow their owner.
  sqlRun('UPDATE assets SET owner_id = ? WHERE owner_id = ?', [userId, guest.id]);
  sqlRun('UPDATE brand_kits SET owner_id = ? WHERE owner_id = ?', [userId, guest.id]);
  sqlRun('UPDATE folders SET owner_id = ? WHERE owner_id = ?', [userId, guest.id]);
  sqlRun('UPDATE comments SET author_id = ? WHERE author_id = ?', [userId, guest.id]);
  sqlRun('UPDATE favorites SET user_id = ? WHERE user_id = ?', [userId, guest.id]);
  sqlRun('UPDATE media_folders SET owner_id = ? WHERE owner_id = ?', [userId, guest.id]);
  return moved;
}

/** Drops guest accounts that have been idle for longer than `maxAgeMs`. */
export function pruneGuestUsers(maxAgeMs = 30 * 24 * 60 * 60 * 1000): number {
  const cutoff = now() - maxAgeMs;
  const stale = all<{ id: string }>(
    "SELECT id FROM users WHERE is_guest = 1 AND COALESCE(last_seen_at, created_at) < ?",
    [cutoff],
  );
  if (!stale.length) return 0;
  for (const row of stale) sqlRun('DELETE FROM users WHERE id = ?', [row.id]);
  return stale.length;
}

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    const row = get<any>(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
      [sha256(token), now()],
    );
    if (row && !row.disabled) return toSessionUser(row);
  }

  // No account? The studio still works: resolve the anonymous guest identity.
  const guestId = await guestIdFromRequest();
  if (!guestId) return null;
  try {
    return ensureGuestUser(guestId, await preferredLocale());
  } catch (error) {
    console.error('[auth] guest resolution failed', error);
    return null;
  }
});

/** Reads the browser's preferred language so the account starts in the right locale. */
async function preferredLocale(): Promise<string> {
  const acceptLanguage = (await headers()).get('accept-language') ?? '';
  return /^ar/i.test(acceptLanguage.trim()) ? 'ar' : 'en';
}

/** The signed-in user, or the anonymous guest account for this browser. */
export async function currentOrGuest(): Promise<SessionUser | null> {
  return getCurrentUser();
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('UNAUTHORIZED', 401);
  return user;
}

/* -------------------------------------------------------- verification tokens */

export async function createVerificationToken(opts: {
  type: 'PASSWORD_RESET' | 'EMAIL_VERIFY' | 'INVITE';
  userId?: string;
  email?: string;
  meta?: unknown;
  ttlMinutes?: number;
}): Promise<string> {
  const token = randomToken(24);
  run(
    'INSERT INTO verification_tokens (id, token, type, user_id, email, meta, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [
      newId('tok'),
      token,
      opts.type,
      opts.userId ?? null,
      opts.email ?? null,
      opts.meta ? JSON.stringify(opts.meta) : null,
      now() + (opts.ttlMinutes ?? 60) * 60_000,
      now(),
    ],
  );
  return token;
}

export async function consumeVerificationToken(token: string, type: string) {
  const row = get<any>('SELECT * FROM verification_tokens WHERE token = ? AND type = ?', [token, type]);
  if (!row || row.used_at || Number(row.expires_at) < now()) return null;
  run('UPDATE verification_tokens SET used_at = ? WHERE id = ?', [now(), row.id]);
  return row;
}

/** Cheap housekeeping, safe to call on auth writes. */
export function pruneAuthTables(): void {
  const t = now();
  run('DELETE FROM sessions WHERE expires_at < ?', [t]);
  run('DELETE FROM verification_tokens WHERE expires_at < ?', [t]);
}

/** Google identity linking (real OAuth flow; disabled until configured). */
export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
