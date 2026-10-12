/** Authorization + lookup helpers shared by every route group. */
import { HttpError } from '../ids';
import { Permissions } from '../../shared/permissions';
import { computeChannelPermissions, isGuildMember, isGuildOwner, highestRolePosition, memberRoleIds } from '../permissions';
import { listChannelOverwrites } from '../store/guilds';
import type { RouteContext } from './types';
import type { ChannelRow } from '../serialize';
import type { UserRow } from '../store/users';
import type { OverwriteRow } from '../permissions';

export function requireUser(ctx: RouteContext): UserRow {
  if (!ctx.user) throw new HttpError(401, 'You must sign in first', 'unauthorized');
  return ctx.user;
}

export function requireChannelRow(ctx: RouteContext, channelId: string): ChannelRow {
  const channel = ctx.db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', [channelId]);
  if (!channel) throw new HttpError(404, 'Channel not found', 'unknown_channel');
  return channel;
}

/** Throws unless the user can see the channel (DM participant or guild member with VIEW_CHANNEL). */
export function requireChannelAccess(ctx: RouteContext, channelId: string): ChannelRow {
  const user = requireUser(ctx);
  const channel = requireChannelRow(ctx, channelId);
  if (channel.guild_id) {
    if (!isGuildMember(ctx.db, channel.guild_id, user.id)) {
      throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
    }
    const bits = computeChannelPermissions(ctx.db, channel.guild_id, user.id, channel.id);
    if ((bits & Permissions.VIEW_CHANNEL) === 0) {
      throw new HttpError(403, 'You cannot view that channel', 'missing_view_channel');
    }
  } else {
    const participant = ctx.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM dm_recipients WHERE channel_id = ? AND user_id = ?',
      [channelId, user.id],
    );
    if (Number(participant?.c ?? 0) === 0) {
      throw new HttpError(403, 'You are not part of that conversation', 'not_a_recipient');
    }
  }
  return channel;
}

export function requireChannelPermission(
  ctx: RouteContext,
  channel: ChannelRow,
  permission: number,
  action: string,
): void {
  const user = requireUser(ctx);
  if (!channel.guild_id) return; // DMs: participants may do everything
  const bits = computeChannelPermissions(ctx.db, channel.guild_id, user.id, channel.id);
  const administrator = (bits & Permissions.ADMINISTRATOR) !== 0;
  if (!administrator && (bits & permission) !== permission) {
    throw new HttpError(403, `You do not have permission to ${action}`, 'missing_permissions');
  }
}

export function requireGuildPermission(
  ctx: RouteContext,
  guildId: string,
  permission: number,
  action: string,
): void {
  const user = requireUser(ctx);
  if (!isGuildMember(ctx.db, guildId, user.id)) {
    throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
  }
  if (isGuildOwner(ctx.db, guildId, user.id)) return;
  const memberships = memberRoleIds(ctx.db, guildId, user.id);
  const roles = ctx.db.all<{ id: string; permissions: number; is_default: number }>(
    'SELECT id, permissions, is_default FROM roles WHERE guild_id = ?',
    [guildId],
  );
  let bits = 0;
  for (const role of roles) {
    if (role.is_default === 1 || memberships.includes(role.id)) bits |= role.permissions >>> 0;
  }
  const administrator = (bits & Permissions.ADMINISTRATOR) !== 0;
  if (!administrator && (bits & permission) !== permission) {
    throw new HttpError(403, `You do not have permission to ${action}`, 'missing_permissions');
  }
}

/** A user may only manage roles strictly below their highest role. */
export function requireRoleHierarchy(ctx: RouteContext, guildId: string, targetRoleId: string): void {
  const user = requireUser(ctx);
  if (isGuildOwner(ctx.db, guildId, user.id)) return;
  const role = ctx.db.get<{ position: number; is_default: number }>(
    'SELECT position, is_default FROM roles WHERE id = ? AND guild_id = ?',
    [targetRoleId, guildId],
  );
  if (!role) throw new HttpError(404, 'Role not found', 'unknown_role');
  if (role.is_default === 1) throw new HttpError(403, 'You cannot modify the @everyone role', 'default_role');
  if (role.position >= highestRolePosition(ctx.db, guildId, user.id)) {
    throw new HttpError(403, 'That role is higher than your highest role', 'role_hierarchy');
  }
}

export function requireNotBanned(ctx: RouteContext, guildId: string): void {
  const user = requireUser(ctx);
  const banned = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bans WHERE guild_id = ? AND user_id = ?', [
    guildId,
    user.id,
  ]);
  if (Number(banned?.c ?? 0) > 0) {
    throw new HttpError(403, 'You are banned from that server', 'banned');
  }
}

export function overwritesOf(ctx: RouteContext, channelId: string): OverwriteRow[] {
  return listChannelOverwrites(ctx.db, channelId) as OverwriteRow[];
}

/** Block check for DMs and friend requests. */
export function assertNotBlocked(ctx: RouteContext, otherUserId: string): void {
  const user = requireUser(ctx);
  const blocked = ctx.db.get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM relationships
     WHERE type = 'blocked' AND ((user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?))`,
    [user.id, otherUserId, otherUserId, user.id],
  );
  if (Number(blocked?.c ?? 0) > 0) {
    throw new HttpError(403, 'You cannot message this user', 'blocked');
  }
}
