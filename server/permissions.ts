/**
 * Server-side permission resolution.
 *
 * Order of operations (matching the behaviour people expect from Discord):
 *   1. ADMINISTRATOR in any role → every permission, and channel overwrites
 *      cannot take permissions away again.
 *   2. Union of the permissions of all the member's roles (including @everyone).
 *   3. @everyone channel overwrite → apply deny, then allow.
 *   4. Role channel overwrites → union of denies, union of allows; deny wins.
 *   5. Member channel overwrite → allow wins over deny (member-specific grant).
 */
import { Permissions, hasPermission } from '../shared/permissions';
import type { Database, Row } from './db';
import { HttpError } from './ids';

export interface RoleRow {
  id: string;
  guild_id: string;
  name: string;
  color: number;
  permissions: number;
  position: number;
  hoist: number;
  mentionable: number;
  is_default: number;
}

export interface OverwriteRow {
  channel_id: string;
  target_id: string;
  target_type: string;
  allow: number;
  deny: number;
}

export function memberRoleIds(db: Database, guildId: string, userId: string): string[] {
  return db
    .all<{ role_id: string }>('SELECT role_id FROM member_roles WHERE guild_id = ? AND user_id = ?', [
      guildId,
      userId,
    ])
    .map((r) => r.role_id);
}

export function guildRoles(db: Database, guildId: string): RoleRow[] {
  return db.all<RoleRow>(
    'SELECT * FROM roles WHERE guild_id = ? ORDER BY position DESC, created_at ASC',
    [guildId],
  );
}

export function isGuildMember(db: Database, guildId: string, userId: string): boolean {
  const row = db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ? AND user_id = ?',
    [guildId, userId],
  );
  return Number(row?.c ?? 0) > 0;
}

export function assertGuildMember(db: Database, guildId: string, userId: string): void {
  if (!isGuildMember(db, guildId, userId)) {
    throw new HttpError(403, 'You are not a member of this server', 'not_a_member');
  }
}

export function isGuildOwner(db: Database, guildId: string, userId: string): boolean {
  const row = db.get<{ owner_id: string }>('SELECT owner_id FROM guilds WHERE id = ?', [guildId]);
  return row?.owner_id === userId;
}

/** Compute a member's guild-level permissions (no channel context). */
export function computeGuildPermissions(db: Database, guildId: string, userId: string): number {
  if (isGuildOwner(db, guildId, userId)) return Permissions.ADMINISTRATOR | 0x7fffffff;
  const roles = guildRoles(db, guildId);
  const memberRoles = new Set(memberRoleIds(db, guildId, userId));
  let bits = 0;
  for (const role of roles) {
    if (role.is_default === 1 || memberRoles.has(role.id)) bits |= role.permissions >>> 0;
  }
  return bits >>> 0;
}

export function computeChannelPermissions(
  db: Database,
  guildId: string,
  userId: string,
  channelId: string,
): number {
  const guildBits = computeGuildPermissions(db, guildId, userId);
  if ((guildBits & Permissions.ADMINISTRATOR) !== 0) return guildBits;

  let bits = guildBits;
  const overwrites = db.all<OverwriteRow>(
    'SELECT * FROM permission_overwrites WHERE channel_id = ?',
    [channelId],
  );
  if (overwrites.length === 0) return bits >>> 0;

  const everyoneRole = db.get<{ id: string }>(
    'SELECT id FROM roles WHERE guild_id = ? AND is_default = 1',
    [guildId],
  );
  const memberRoles = new Set(memberRoleIds(db, guildId, userId));

  const applyOverwrite = (allow: number, deny: number): void => {
    bits = (bits & ~deny) | allow;
  };

  const everyoneOverwrite = overwrites.find(
    (o) => o.target_type === 'role' && everyoneRole && o.target_id === everyoneRole.id,
  );
  if (everyoneOverwrite) applyOverwrite(everyoneOverwrite.allow, everyoneOverwrite.deny);

  let roleAllow = 0;
  let roleDeny = 0;
  for (const overwrite of overwrites) {
    if (overwrite.target_type !== 'role') continue;
    if (everyoneOverwrite && overwrite.target_id === everyoneOverwrite.target_id) continue;
    if (!memberRoles.has(overwrite.target_id)) continue;
    roleAllow |= overwrite.allow;
    roleDeny |= overwrite.deny;
  }
  if (roleAllow !== 0 || roleDeny !== 0) applyOverwrite(roleAllow, roleDeny);

  const memberOverwrite = overwrites.find(
    (o) => o.target_type === 'member' && o.target_id === userId,
  );
  if (memberOverwrite) {
    // Member-specific: an explicit allow beats a role deny.
    bits = (bits | memberOverwrite.allow) & ~(memberOverwrite.deny & ~memberOverwrite.allow);
  }

  return bits >>> 0;
}

/** Permissions for a channel, handling both guild channels and DMs. */
export function channelPermissions(
  db: Database,
  userId: string,
  channel: Row | { id: string; guild_id: string | null; type: string },
): number {
  const guildId = channel.guild_id as string | null;
  if (guildId === null || guildId === undefined) {
    // DMs and group DMs: participants can do everything.
    return 0x7fffffff;
  }
  return computeChannelPermissions(db, guildId, userId, String(channel.id));
}

export function can(
  db: Database,
  userId: string,
  channel: { id: string; guild_id: string | null },
  permission: number,
): boolean {
  return hasPermission(channelPermissions(db, userId, channel), permission);
}

export function assertCan(
  db: Database,
  userId: string,
  channel: { id: string; guild_id: string | null },
  permission: number,
  action = 'do that',
): void {
  if (!can(db, userId, channel, permission)) {
    throw new HttpError(403, `You do not have permission to ${action}`, 'missing_permissions');
  }
}

/** Highest role position — used to prevent editing roles above your own. */
export function highestRolePosition(db: Database, guildId: string, userId: string): number {
  if (isGuildOwner(db, guildId, userId)) return Number.MAX_SAFE_INTEGER;
  const roles = guildRoles(db, guildId);
  const memberRoles = new Set(memberRoleIds(db, guildId, userId));
  let highest = 0;
  for (const role of roles) {
    if (role.is_default === 1 || memberRoles.has(role.id)) {
      highest = Math.max(highest, role.position);
    }
  }
  return highest;
}
