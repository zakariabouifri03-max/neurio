/** Authentication, sessions and server discovery. */
import { HttpError } from '../ids';
import { assertObject, clientIp, optionalString, requiredString } from '../http';
import {
  authenticate,
  createSession,
  createUser,
  listSessions,
  publicUser,
  revokeAllSessions,
  revokeSession,
  sessionFromToken,
  setPassword,
  validatePassword,
  getUserById,
  listRelationships,
  friendIds,
} from '../store/users';
import { listDmChannels, guildIdsForUser } from '../store/guilds';
import { toPublicUser } from '../serialize';
import type { Router } from './router';
import type { RouteContext, RestDeps } from './types';
import { requireUser } from './helpers';
import type { AuthResult, ServerConfig } from '../../shared/types';
import { Permissions } from '../../shared/permissions';

function deviceFrom(body: Record<string, unknown>): { label: string; kind: 'desktop' | 'web' | 'test' } {
  const label = optionalString(body.device_label, 'device_label', 64) ?? 'Neurio desktop';
  const kind = optionalString(body.device_kind, 'device_kind', 16) ?? 'desktop';
  const parsed = kind === 'web' || kind === 'test' ? kind : 'desktop';
  return { label: label || 'Neurio desktop', kind: parsed };
}

export function serverConfig(deps: RestDeps): ServerConfig {
  return {
    name: deps.config.serverName,
    version: deps.config.version,
    ice_servers: deps.config.iceServers,
    offline_mode: deps.config.offlineMode,
    max_upload_bytes: deps.config.maxUploadBytes,
    registration_open: deps.registrationOpen(),
    voice: { recommended_max_mesh_peers: 6 },
  };
}

export function registerAuthRoutes(router: Router, deps: RestDeps): void {
  const authLimiter = { limit: 20, windowMs: 60_000, key: (ctx: RouteContext) => `auth:${clientIp(ctx.req)}` };

  router.get(
    '/api/health',
    () => ({
      ok: true,
      name: deps.config.serverName,
      version: deps.config.version,
      uptime_ms: Date.now() - deps.config.startedAt,
      gateway_clients: deps.gateway.clientCount,
    }),
    { auth: false },
  );

  router.get('/api/config', () => serverConfig(deps), { auth: false });

  router.post(
    '/api/auth/register',
    (ctx) => {
      const body = assertObject(ctx.body);
      if (!deps.registrationOpen()) {
        throw new HttpError(403, 'Registration is closed on this server', 'registration_closed');
      }
      const username = requiredString(body.username, 'username', 32);
      const password = requiredString(body.password, 'password', 200);
      const displayName = optionalString(body.display_name, 'display_name', 48);
      const created = createUser(deps.db, {
        username,
        password,
        display_name: displayName && displayName.trim().length > 0 ? displayName : username,
      });
      // The first account owns the server (can close registration, etc).
      if (deps.operatorId() === null) deps.setOperatorId(created.id);
      const device = deviceFrom(body);
      const { token, session } = createSession(deps.db, created.id, device);
      const result: AuthResult = {
        token,
        user: toPublicUser(created, 'online'),
        session: {
          id: session.id,
          created_at: session.created_at,
          last_seen_at: session.last_seen_at,
          device_label: session.device_label,
          kind: device.kind,
          current: true,
        },
      };
      return result;
    },
    { auth: false, limit: authLimiter },
  );

  router.post(
    '/api/auth/login',
    (ctx) => {
      const body = assertObject(ctx.body);
      const username = requiredString(body.username, 'username', 64);
      const password = requiredString(body.password, 'password', 200);
      const user = authenticate(deps.db, username, password);
      const device = deviceFrom(body);
      const { token, session } = createSession(deps.db, user.id, device);
      const result: AuthResult = {
        token,
        user: toPublicUser(user, deps.presence.statusOf(user.id)),
        session: {
          id: session.id,
          created_at: session.created_at,
          last_seen_at: session.last_seen_at,
          device_label: session.device_label,
          kind: device.kind,
          current: true,
        },
      };
      return result;
    },
    { auth: false, limit: authLimiter },
  );

  router.post('/api/auth/logout', (ctx) => {
    const user = requireUser(ctx);
    if (ctx.session) {
      revokeSession(deps.db, user.id, ctx.session.id);
      deps.gateway.disconnectUser(user.id, 'Signed out');
    }
    return { ok: true };
  });

  router.get('/api/auth/session', (ctx) => {
    const user = requireUser(ctx);
    const session = ctx.session!;
    const guilds = guildIdsForUser(deps.db, user.id);
    return {
      user: toPublicUser(user, deps.presence.ownStatus(user.id)),
      session: {
        id: session.id,
        created_at: session.created_at,
        last_seen_at: session.last_seen_at,
        device_label: session.device_label,
        kind: session.kind,
        current: true,
      },
      guilds,
      dm_channel_ids: listDmChannels(deps.db, user.id).map((c) => c.id),
      config: serverConfig(deps),
    };
  });

  /* --------------------------------- users -------------------------------- */

  router.get('/api/users/@me', (ctx) => {
    const user = requireUser(ctx);
    return { user: toPublicUser(user, deps.presence.ownStatus(user.id)) };
  });

  router.patch('/api/users/@me', (ctx) => {
    const user = requireUser(ctx);
    const body = assertObject(ctx.body);
    const patch: Record<string, string | null> = {};
    if (body.display_name !== undefined) patch.display_name = String(body.display_name).slice(0, 48);
    if (body.bio !== undefined) patch.bio = String(body.bio).slice(0, 500);
    if (body.custom_status !== undefined) {
      patch.custom_status = body.custom_status === null ? null : String(body.custom_status).slice(0, 128);
    }
    const sets: string[] = [];
    const params: (string | null)[] = [];
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
    if (sets.length > 0) {
      params.push(user.id);
      deps.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    if (patch.custom_status !== undefined) {
      deps.presence.setCustomStatus(user.id, patch.custom_status);
    }
    const updated = getUserById(deps.db, user.id)!;
    const dto = toPublicUser(updated, deps.presence.ownStatus(user.id));
    deps.gateway.dispatch('USER_UPDATE', { user: dto }, deps.gateway.audienceForUser(user.id), { includeSelf: true });
    return { user: dto };
  });

  router.post('/api/users/@me/password', (ctx) => {
    const user = requireUser(ctx);
    const body = assertObject(ctx.body);
    const current = requiredString(body.current_password, 'current_password', 200);
    const next = requiredString(body.new_password, 'new_password', 200);
    validatePassword(next);
    authenticate(deps.db, user.username, current); // throws when the current password is wrong
    setPassword(deps.db, user.id, next);
    // Changing the password signs every other device out.
    revokeAllSessions(deps.db, user.id, ctx.session?.id);
    return { ok: true, revoked_other_sessions: true };
  });

  router.get('/api/users/@me/sessions', (ctx) => {
    const user = requireUser(ctx);
    const current = ctx.session?.id;
    return {
      sessions: listSessions(deps.db, user.id).map((session) => ({
        ...session,
        current: session.id === current,
      })),
    };
  });

  router.delete('/api/users/@me/sessions/:sessionId', (ctx) => {
    const user = requireUser(ctx);
    revokeSession(deps.db, user.id, ctx.params.sessionId);
    return { ok: true };
  });

  router.post('/api/users/@me/sessions/revoke-all', (ctx) => {
    const user = requireUser(ctx);
    revokeAllSessions(deps.db, user.id, ctx.session?.id);
    return { ok: true };
  });

  router.get('/api/users/:userId', (ctx) => {
    const viewer = requireUser(ctx);
    const target = getUserById(deps.db, ctx.params.userId);
    if (!target) throw new HttpError(404, 'User not found', 'unknown_user');
    const mutualGuilds = deps.db.all<{ id: string; name: string }>(
      `SELECT g.id, g.name FROM guilds g
       JOIN guild_members a ON a.guild_id = g.id AND a.user_id = ?
       JOIN guild_members b ON b.guild_id = g.id AND b.user_id = ?`,
      [viewer.id, target.id],
    );
    const friendship = deps.db.get<{ type: string }>(
      'SELECT type FROM relationships WHERE user_id = ? AND target_id = ?',
      [viewer.id, target.id],
    );
    return {
      user: toPublicUser(target, deps.presence.statusOf(target.id)),
      mutual_guilds: mutualGuilds,
      friendship: friendship?.type ?? 'none',
    };
  });

  router.get('/api/users', (ctx) => {
    const viewer = requireUser(ctx);
    const query = (ctx.query.get('query') ?? '').trim().toLowerCase();
    if (query.length < 1) return { users: [] };
    const rows = deps.db.all<{ id: string; username: string; display_name: string }>(
      'SELECT id, username, display_name FROM users WHERE username_lower LIKE ? OR LOWER(display_name) LIKE ? LIMIT 25',
      [`%${query}%`, `%${query}%`],
    );
    const friends = new Set(friendIds(deps.db, viewer.id));
    return {
      users: rows
        .filter((row) => row.id !== viewer.id)
        .map((row) => ({
          id: row.id,
          username: row.username,
          display_name: row.display_name,
          status: deps.presence.statusOf(row.id),
          is_friend: friends.has(row.id),
        })),
    };
  });

  /* ----------------------------- relationships ---------------------------- */

  router.get('/api/relationships', (ctx) => {
    const user = requireUser(ctx);
    return {
      relationships: listRelationships(deps.db, user.id, (id) => deps.presence.statusOf(id)),
    };
  });

  router.get('/api/permissions/catalog', () => Permissions, { auth: false });
}

export function requireSession(deps: RestDeps, token: string | null) {
  if (!token) return null;
  return sessionFromToken(deps.db, token) ?? null;
}

export function userFromSession(deps: RestDeps, session: { user_id: string }) {
  return publicUser(deps.db, session.user_id, deps.presence.statusOf(session.user_id));
}
