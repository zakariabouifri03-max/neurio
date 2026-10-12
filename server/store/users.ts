/** Users, sessions, friendships and blocks. */
import type { Database } from '../db';
import { HttpError, newId } from '../ids';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../crypto';
import { toPublicUser, type UserRow } from '../serialize';
import type { PublicUser, RelationshipEntry, SessionInfo, UserStatus } from '../../shared/types';

export type { UserRow };

export const USERNAME_RE = /^[a-z0-9_.]{2,32}$/;
export const PASSWORD_MIN = 8;

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  device_label: string;
  kind: string;
  revoked_at: number | null;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): void {
  if (!USERNAME_RE.test(normalizeUsername(username))) {
    throw new HttpError(
      400,
      'Usernames must be 2–32 characters: letters, numbers, dot or underscore',
      'invalid_username',
    );
  }
}

export function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    throw new HttpError(400, `Passwords must be at least ${PASSWORD_MIN} characters`, 'weak_password');
  }
  if (password.length > 200) {
    throw new HttpError(400, 'Passwords must be at most 200 characters', 'weak_password');
  }
}

export interface CreateUserInput {
  username: string;
  password: string;
  display_name?: string;
  is_bot?: boolean;
}

export function createUser(db: Database, input: CreateUserInput, now = Date.now()): UserRow {
  validateUsername(input.username);
  validatePassword(input.password);
  const normalized = normalizeUsername(input.username);
  const existing = db.get<{ id: string }>('SELECT id FROM users WHERE username_lower = ?', [normalized]);
  if (existing) throw new HttpError(409, 'That username is already taken', 'username_taken');

  const { hash, salt, algo } = hashPassword(input.password);
  const id = newId(now);
  db.run(
    `INSERT INTO users (id, username, username_lower, display_name, password_hash, password_salt,
                        password_algo, bio, status, is_bot, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', 'offline', ?, ?, ?)`,
    [id, input.username.trim(), normalized, (input.display_name ?? input.username).trim(), hash, salt, algo, input.is_bot ? 1 : 0, now, now],
  );
  return getUserById(db, id)!;
}

export function getUserById(db: Database, id: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
}

export function getUserByUsername(db: Database, username: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE username_lower = ?', [normalizeUsername(username)]);
}

export function requireUser(db: Database, id: string): UserRow {
  const user = getUserById(db, id);
  if (!user) throw new HttpError(404, 'User not found', 'unknown_user');
  return user;
}

export function updateUser(
  db: Database,
  id: string,
  patch: { display_name?: string; bio?: string; custom_status?: string | null; avatar_id?: string | null; status?: UserStatus },
  now = Date.now(),
): UserRow {
  const user = requireUser(db, id);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.display_name !== undefined) {
    const name = patch.display_name.trim().slice(0, 48);
    if (name.length === 0) throw new HttpError(400, 'Display name cannot be empty', 'invalid_display_name');
    sets.push('display_name = ?');
    params.push(name);
  }
  if (patch.bio !== undefined) {
    sets.push('bio = ?');
    params.push(String(patch.bio).slice(0, 500));
  }
  if (patch.custom_status !== undefined) {
    sets.push('custom_status = ?');
    params.push(patch.custom_status === null ? null : String(patch.custom_status).slice(0, 128));
  }
  if (patch.avatar_id !== undefined) {
    sets.push('avatar_id = ?');
    params.push(patch.avatar_id);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (sets.length === 0) return user;
  sets.push('updated_at = ?');
  params.push(now, id);
  db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return requireUser(db, id);
}

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export function createSession(
  db: Database,
  userId: string,
  device: { label: string; kind: SessionInfo['kind'] },
  now = Date.now(),
): { token: string; session: SessionRow } {
  const token = generateToken();
  const id = newId(now);
  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, device_label, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, hashToken(token), now, now, device.label.slice(0, 64) || 'Unknown device', device.kind],
  );
  return { token, session: db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id])! };
}

export function sessionFromToken(db: Database, token: string, now = Date.now()): SessionRow | undefined {
  if (!token || typeof token !== 'string') return undefined;
  const row = db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  if (!row || row.revoked_at !== null) return undefined;
  db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, row.id]);
  return { ...row, last_seen_at: now };
}

export function authenticate(db: Database, username: string, password: string): UserRow {
  const user = getUserByUsername(db, username);
  if (!user) {
    // Hash anyway so the response time does not reveal whether the user exists.
    hashPassword(password);
    throw new HttpError(401, 'Incorrect username or password', 'invalid_credentials');
  }
  const full = db.get<{ password_hash: string; password_salt: string; password_algo: string }>(
    'SELECT password_hash, password_salt, password_algo FROM users WHERE id = ?',
    [user.id],
  )!;
  const ok = verifyPassword(password, {
    hash: full.password_hash,
    salt: full.password_salt,
    algo: full.password_algo,
  });
  if (!ok) throw new HttpError(401, 'Incorrect username or password', 'invalid_credentials');
  return user;
}

export function setPassword(db: Database, userId: string, password: string, now = Date.now()): void {
  validatePassword(password);
  const { hash, salt, algo } = hashPassword(password);
  db.run('UPDATE users SET password_hash = ?, password_salt = ?, password_algo = ?, updated_at = ? WHERE id = ?', [
    hash,
    salt,
    algo,
    now,
    userId,
  ]);
}

export function listSessions(db: Database, userId: string): SessionInfo[] {
  return db
    .all<SessionRow>(
      `SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
      [userId],
    )
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      device_label: row.device_label,
      kind: row.kind as SessionInfo['kind'],
      current: false,
    }));
}

export function revokeSession(db: Database, userId: string, sessionId: string): void {
  db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?', [Date.now(), sessionId, userId]);
}

export function revokeAllSessions(db: Database, userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ?', [Date.now(), userId, exceptSessionId]);
  } else {
    db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', [Date.now(), userId]);
  }
}

/* -------------------------------------------------------------------------- */
/* Relationships                                                              */
/* -------------------------------------------------------------------------- */

export function listRelationships(
  db: Database,
  userId: string,
  statusOf: (id: string) => UserStatus,
): RelationshipEntry[] {
  const rows = db.all<{
    target_id: string;
    type: string;
    created_at: number;
  }>(
    `SELECT target_id, type, created_at FROM relationships WHERE user_id = ? AND type <> 'blocked'
     UNION ALL
     SELECT target_id, 'blocked' AS type, created_at FROM relationships WHERE user_id = ? AND type = 'blocked'
     ORDER BY created_at DESC`,
    [userId, userId],
  );
  const seen = new Set<string>();
  const entries: RelationshipEntry[] = [];
  for (const row of rows) {
    if (seen.has(row.target_id)) continue;
    seen.add(row.target_id);
    const user = getUserById(db, row.target_id);
    if (!user) continue;
    entries.push({
      id: row.target_id,
      type: row.type as RelationshipEntry['type'],
      user: toPublicUser(user, statusOf(row.target_id)),
      since: row.created_at,
    });
  }
  return entries;
}

export function getRelationship(db: Database, userId: string, targetId: string): { type: string } | undefined {
  return db.get<{ type: string }>('SELECT type FROM relationships WHERE user_id = ? AND target_id = ?', [
    userId,
    targetId,
  ]);
}

export function isBlockedEitherWay(db: Database, a: string, b: string): boolean {
  const row = db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM relationships
     WHERE type = 'blocked' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))`,
    [a, b, b, a],
  );
  return Number(row?.c ?? 0) > 0;
}

/** Returns 'friend' | 'incoming' | 'outgoing' | 'blocked' | 'none' from `userId`'s view. */
export function friendshipState(db: Database, userId: string, targetId: string): string {
  if (userId === targetId) return 'self';
  const mine = getRelationship(db, userId, targetId);
  if (mine?.type === 'blocked') return 'blocked';
  const theirs = getRelationship(db, targetId, userId);
  if (mine?.type === 'friend' || theirs?.type === 'friend') return 'friend';
  if (theirs?.type === 'blocked') return 'blocked';
  if (mine?.type === 'outgoing' || theirs?.type === 'incoming') return 'outgoing';
  if (mine?.type === 'incoming' || theirs?.type === 'outgoing') return 'incoming';
  return 'none';
}

export interface FriendRequestResult {
  type: 'outgoing' | 'friend';
  /** true when the request auto-accepted an incoming request */
  accepted: boolean;
}

export function sendFriendRequest(db: Database, userId: string, targetId: string, now = Date.now()): FriendRequestResult {
  if (userId === targetId) throw new HttpError(400, 'You cannot add yourself', 'self_friend');
  requireUser(db, targetId);
  if (isBlockedEitherWay(db, userId, targetId)) {
    throw new HttpError(403, 'Friend request blocked', 'blocked');
  }
  const state = friendshipState(db, userId, targetId);
  if (state === 'friend') throw new HttpError(409, 'You are already friends', 'already_friends');
  if (state === 'outgoing') throw new HttpError(409, 'Friend request already sent', 'already_requested');

  return db.tx(() => {
    if (state === 'incoming') {
      // Both directions exist → the friendship is accepted immediately.
      db.run(
        `INSERT INTO relationships (id, user_id, target_id, type, created_at, updated_at)
         VALUES (?, ?, ?, 'friend', ?, ?)
         ON CONFLICT(user_id, target_id) DO UPDATE SET type = 'friend', updated_at = excluded.updated_at`,
        [newId(now), userId, targetId, now, now],
      );
      db.run(
        `INSERT INTO relationships (id, user_id, target_id, type, created_at, updated_at)
         VALUES (?, ?, ?, 'friend', ?, ?)
         ON CONFLICT(user_id, target_id) DO UPDATE SET type = 'friend', updated_at = excluded.updated_at`,
        [newId(now), targetId, userId, now, now],
      );
      return { type: 'friend' as const, accepted: true };
    }
    db.run(
      `INSERT INTO relationships (id, user_id, target_id, type, created_at, updated_at)
       VALUES (?, ?, ?, 'outgoing', ?, ?)
       ON CONFLICT(user_id, target_id) DO UPDATE SET type = 'outgoing', updated_at = excluded.updated_at`,
      [newId(now), userId, targetId, now, now],
    );
    db.run(
      `INSERT INTO relationships (id, user_id, target_id, type, created_at, updated_at)
       VALUES (?, ?, ?, 'incoming', ?, ?)
       ON CONFLICT(user_id, target_id) DO UPDATE SET type = 'incoming', updated_at = excluded.updated_at`,
      [newId(now), targetId, userId, now, now],
    );
    return { type: 'outgoing' as const, accepted: false };
  });
}

export function acceptFriendRequest(db: Database, userId: string, targetId: string, now = Date.now()): void {
  const incoming = getRelationship(db, userId, targetId);
  if (incoming?.type !== 'incoming') {
    throw new HttpError(404, 'No incoming friend request from that user', 'no_request');
  }
  db.tx(() => {
    db.run(
      `UPDATE relationships SET type = 'friend', updated_at = ? WHERE user_id = ? AND target_id = ?`,
      [now, userId, targetId],
    );
    db.run(
      `INSERT INTO relationships (id, user_id, target_id, type, created_at, updated_at)
       VALUES (?, ?, ?, 'friend', ?, ?)
       ON CONFLICT(user_id, target_id) DO UPDATE SET type = 'friend', updated_at = excluded.updated_at`,
      [newId(now), targetId, userId, now, now],
    );
  });
}

export function removeRelationship(db: Database, userId: string, targetId: string, now = Date.now()): void {
  const mine = getRelationship(db, userId, targetId);
  db.tx(() => {
    db.run('DELETE FROM relationships WHERE user_id = ? AND target_id = ?', [userId, targetId]);
    if (mine?.type !== 'blocked') {
      // Only clear the mirror row when it mirrors a friendship/request.
      const theirs = getRelationship(db, targetId, userId);
      if (theirs?.type !== 'blocked') {
        db.run("DELETE FROM relationships WHERE user_id = ? AND target_id = ? AND type <> 'blocked'", [
          targetId,
          userId,
        ]);
      }
    }
    void now;
  });
}

export function blockUser(db: Database, userId: string, targetId: string, now = Date.now()): void {
  if (userId === targetId) throw new HttpError(400, 'You cannot block yourself', 'self_block');
  requireUser(db, targetId);
  db.tx(() => {
    db.run(
      `INSERT INTO relationships (id, user_id, target_id, type, created_at, updated_at)
       VALUES (?, ?, ?, 'blocked', ?, ?)
       ON CONFLICT(user_id, target_id) DO UPDATE SET type = 'blocked', updated_at = excluded.updated_at`,
      [newId(now), userId, targetId, now, now],
    );
    db.run("DELETE FROM relationships WHERE user_id = ? AND target_id = ? AND type <> 'blocked'", [
      targetId,
      userId,
    ]);
  });
}

export function unblockUser(db: Database, userId: string, targetId: string): void {
  db.run("DELETE FROM relationships WHERE user_id = ? AND target_id = ? AND type = 'blocked'", [
    userId,
    targetId,
  ]);
}

/** Friends, plus the ids of everyone we share a DM with (used for DM auto-allow rules). */
export function friendIds(db: Database, userId: string): string[] {
  return db
    .all<{ target_id: string }>("SELECT target_id FROM relationships WHERE user_id = ? AND type = 'friend'", [userId])
    .map((r) => r.target_id);
}

export function publicUser(db: Database, id: string, status?: UserStatus): PublicUser {
  return toPublicUser(requireUser(db, id), status);
}
