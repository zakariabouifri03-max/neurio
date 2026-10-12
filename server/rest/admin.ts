/** Operator-only endpoints. The first account created on a server is the operator. */
import { HttpError } from '../ids';
import { assertObject, optionalBoolean } from '../http';
import { requireUser } from './helpers';
import { toPublicUser } from '../serialize';
import { listSessions } from '../store/users';
import type { Router } from './router';
import type { RestDeps } from './types';

export function registerAdminRoutes(router: Router, deps: RestDeps): void {
  const requireOperator = (userId: string): void => {
    const operator = deps.operatorId();
    if (!operator) throw new HttpError(403, 'No operator is configured on this server', 'no_operator');
    if (operator !== userId) throw new HttpError(403, 'Operator access only', 'not_operator');
  };

  router.get('/api/admin/overview', (ctx) => {
    const user = requireUser(ctx);
    requireOperator(user.id);
    const stats = deps.db.stats();
    const counts = {
      users: stats.users,
      messages: stats.messages,
      guilds: Number(deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM guilds')?.c ?? 0),
      channels: Number(deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM channels')?.c ?? 0),
      uploads: Number(deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM uploads')?.c ?? 0),
      online: deps.presence.onlineUserIds().length,
    };
    return {
      counts,
      gateway_clients: deps.gateway.clientCount,
      database: {
        file: stats.file,
        schema_version: stats.version,
        size_bytes: stats.sizeBytes,
      },
      uptime_ms: Date.now() - deps.config.startedAt,
      registration_open: deps.registrationOpen(),
      data_dir: deps.config.dataDir,
      config: {
        host: deps.config.host,
        port: deps.config.port,
        offline_mode: deps.config.offlineMode,
        ice_servers: deps.config.iceServers,
        max_upload_bytes: deps.config.maxUploadBytes,
      },
    };
  });

  router.patch('/api/admin/config', (ctx) => {
    const user = requireUser(ctx);
    requireOperator(user.id);
    const body = assertObject(ctx.body);
    const open = optionalBoolean(body.registration_open, 'registration_open');
    if (open !== undefined) deps.setRegistrationOpen(open);
    return { registration_open: deps.registrationOpen() };
  });

  router.get('/api/admin/users', (ctx) => {
    const user = requireUser(ctx);
    requireOperator(user.id);
    const rows = deps.db.all<{ id: string; username: string; display_name: string; status: string; created_at: number; is_bot: number }>(
      'SELECT id, username, display_name, status, created_at, is_bot FROM users ORDER BY created_at ASC LIMIT 500',
    );
    return {
      users: rows.map((row) => ({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        status: deps.presence.statusOf(row.id),
        is_bot: row.is_bot === 1,
        created_at: row.created_at,
        sessions: listSessions(deps.db, row.id).length,
        operator: deps.operatorId() === row.id,
      })),
    };
  });

  router.get('/api/admin/whoami', (ctx) => {
    const user = requireUser(ctx);
    return {
      user: toPublicUser(user, deps.presence.ownStatus(user.id)),
      is_operator: deps.operatorId() === user.id,
    };
  });
}
