/**
 * Password + token cryptography.
 *
 * - Passwords: scrypt (memory-hard, shipped with Node — no native module).
 * - Session tokens: 32 random bytes, stored as a SHA-256 hash in SQLite so a
 *   stolen database file does not hand out live sessions.
 * - Nothing here talks to the network, and there are no compiled secrets.
 */
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
} as const;

/** scrypt needs ~128*N*r bytes; allow headroom so the default 32 MB cap is fine. */
export interface PasswordHash {
  hash: string;
  salt: string;
  algo: string;
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });
  return {
    hash: derived.toString('base64'),
    salt: salt.toString('base64'),
    algo: `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}`,
  };
}

export function verifyPassword(password: string, stored: PasswordHash): boolean {
  const [name, n, r, p] = stored.algo.split('$');
  if (name !== 'scrypt') return false;
  const expected = Buffer.from(stored.hash, 'base64');
  const derived = scryptSync(password.normalize('NFKC'), Buffer.from(stored.salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Non-reversible lookup key for a session token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function randomCode(length = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newSessionId(): string {
  // Session ids are not secret, but keeping them random avoids enumeration.
  return `s_${randomUUID().replace(/-/g, '')}`;
}

export function sha256Hex(buffer: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
