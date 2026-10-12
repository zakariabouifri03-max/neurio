/** Guilds (servers), channels, roles, members, overwrites, invites and DMs. */
import type { Database } from '../db';
import { HttpError, newId } from '../ids';
import { DEFAULT_EVERYONE_PERMISSIONS, Permissions } from '../../shared/permissions';
import type { Channel, ChannelType, Guild, PublicUser, Role, UserStatus } from '../../shared/types';
import {
  assertGuildMember,
  computeChannelPermissions,
  guildRoles,
  isGuildMember,
  isGuildOwner,
  memberRoleIds,
  type RoleRow,
} from '../permissions';
import {
  toChannel,
  toGuild,
  toGuildMember,
  toPublicUser,
  toRole,
  type ChannelRow,
  type UserRow,
} from '../serialize';
import { getUserById } from './users';
import { randomCode } from '../crypto';

export interface GuildRow {
  id: string;
  name: string;
  owner_id: string;
  icon_id: string | null;
  description: string;
  created_at: number;
}

export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,31}$/;

export function slugifyChannelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'channel';
}

/* -------------------------------------------------------------------------- */
/* Guilds                                                                     */
/* -------------------------------------------------------------------------- */

export function createGuild(
  db: Database,
  ownerId: string,
  input: { name: string; description?: string; icon_id?: string | null },
  now = Date.now(),
): GuildRow {
  const name = input.name.trim().slice(0, 64);
  if (name.length === 0) throw new HttpError(400, 'Server name is required', 'invalid_name');
  const id = newId(now);

  return db.tx(() => {
    db.run('INSERT INTO guilds (id, name, owner_id, icon_id, description, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      name,
      ownerId,
      input.icon_id ?? null,
      (input.description ?? '').slice(0, 300),
      now,
    ]);

    const everyoneRoleId = newId(now + 1);
    db.run(
      `INSERT INTO roles (id, guild_id, name, color, permissions, position, hoist, mentionable, is_default, created_at)
       VALUES (?, ?, '@everyone', 0, ?, 0, 0, 0, 1, ?)`,
      [everyoneRoleId, id, DEFAULT_EVERYONE_PERMISSIONS, now],
    );
    db.run(
      `INSERT INTO roles (id, guild_id, name, color, permissions, position, hoist, mentionable, is_default, created_at)
       VALUES (?, ?, 'Moderator', ?, ?, 1, 1, 1, 0, ?)`,
      [
        newId(now + 2),
        id,
        0x57f287,
        Permissions.VIEW_CHANNEL |
          Permissions.SEND_MESSAGES |
          Permissions.MANAGE_MESSAGES |
          Permissions.KICK_MEMBERS |
          Permissions.CREATE_INVITE |
          Permissions.ATTACH_FILES |
          Permissions.ADD_REACTIONS |
          Permissions.CONNECT_VOICE |
          Permissions.SPEAK |
          Permissions.VIDEO,
        now,
      ],
    );

    db.run('INSERT INTO guild_members (guild_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?)', [
      id,
      ownerId,
      now,
    ]);

    let position = 0;
    const text = newId(now + 3);
    db.run(
      `INSERT INTO channels (id, guild_id, name, type, topic, position, parent_id, created_at)
       VALUES (?, ?, 'general', 'text', ?, ?, NULL, ?)`,
      [text, id, 'Welcome to your new server', position++, now],
    );
    db.run(
      `INSERT INTO channels (id, guild_id, name, type, topic, position, parent_id, created_at)
       VALUES (?, ?, 'Lounge', 'voice', NULL, ?, NULL, ?)`,
      [newId(now + 4), id, position++, now],
    );
    return requireGuild(db, id);
  });
}

export function requireGuild(db: Database, id: string): GuildRow {
  const row = db.get<GuildRow>('SELECT * FROM guilds WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Server not found', 'unknown_guild');
  return row;
}

export function guildSummaries(
  db: Database,
  userId: string,
): (Guild & { member_count: number })[] {
  const rows = db.all<GuildRow & { member_count: number }>(
    `SELECT g.*, (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS member_count
     FROM guilds g
     JOIN guild_members gm ON gm.guild_id = g.id
     WHERE gm.user_id = ?
     ORDER BY g.created_at ASC`,
    [userId],
  );
  return rows.map((row) => ({ ...toGuild(row), member_count: Number(row.member_count ?? 0) }));
}

export function updateGuild(
  db: Database,
  guildId: string,
  patch: { name?: string; description?: string; icon_id?: string | null },
): GuildRow {
  const guild = requireGuild(db, guildId);
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 64);
    if (!name) throw new HttpError(400, 'Server name is required', 'invalid_name');
    sets.push('name = ?');
    params.push(name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description.slice(0, 300));
  }
  if (patch.icon_id !== undefined) {
    sets.push('icon_id = ?');
    params.push(patch.icon_id);
  }
  if (sets.length === 0) return guild;
  params.push(guildId);
  db.run(`UPDATE guilds SET ${sets.join(', ')} WHERE id = ?`, params);
  return requireGuild(db, guildId);
}

export function deleteGuild(db: Database, guildId: string): void {
  db.run('DELETE FROM guilds WHERE id = ?', [guildId]);
}

export function guildMemberIds(db: Database, guildId: string): string[] {
  return db
    .all<{ user_id: string }>('SELECT user_id FROM guild_members WHERE guild_id = ?', [guildId])
    .map((r) => r.user_id);
}

export function guildIdsForUser(db: Database, userId: string): string[] {
  return db
    .all<{ guild_id: string }>('SELECT guild_id FROM guild_members WHERE user_id = ?', [userId])
    .map((r) => r.guild_id);
}

export function listGuildMembers(
  db: Database,
  guildId: string,
  statusOf: (id: string) => UserStatus,
): ReturnType<typeof toGuildMember>[] {
  const rows = db.all<{ user_id: string; nickname: string | null; joined_at: number }>(
    'SELECT user_id, nickname, joined_at FROM guild_members WHERE guild_id = ? ORDER BY joined_at ASC',
    [guildId],
  );
  const out: ReturnType<typeof toGuildMember>[] = [];
  for (const row of rows) {
    const user = getUserById(db, row.user_id);
    if (!user) continue;
    out.push(
      toGuildMember(
        {
          guild_id: guildId,
          nickname: row.nickname,
          joined_at: row.joined_at,
          user,
          role_ids: memberRoleIds(db, guildId, row.user_id),
        },
        statusOf(row.user_id),
      ),
    );
  }
  return out;
}

export function guildBundle(
  db: Database,
  guildId: string,
  viewerId: string,
  statusOf: (id: string) => UserStatus,
): Guild & { channels: Channel[]; members: ReturnType<typeof toGuildMember>[]; roles: Role[] } {
  const guild = requireGuild(db, guildId);
  const channels = listGuildChannels(db, guildId).filter((channel) => {
    if (channel.type === 'category') return true;
    const bits = computeChannelPermissions(db, guildId, viewerId, channel.id);
    return (bits & Permissions.VIEW_CHANNEL) !== 0;
  });
  return {
    ...toGuild(guild),
    member_count: guildMemberIds(db, guildId).length,
    channels: channels.map((c) => toChannel(c)),
    members: listGuildMembers(db, guildId, statusOf),
    roles: guildRoles(db, guildId).map(toRole),
  };
}

export function addGuildMember(db: Database, guildId: string, userId: string, now = Date.now()): void {
  const exists = isGuildMember(db, guildId, userId);
  if (exists) return;
  db.run('INSERT INTO guild_members (guild_id, user_id, nickname, joined_at) VALUES (?, ?, NULL, ?)', [
    guildId,
    userId,
    now,
  ]);
}

export function removeGuildMember(db: Database, guildId: string, userId: string): void {
  db.tx(() => {
    db.run('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    db.run('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    db.run('DELETE FROM voice_states WHERE user_id = ? AND guild_id = ?', [userId, guildId]);
  });
}

export function setNickname(db: Database, guildId: string, userId: string, nickname: string | null): void {
  db.run('UPDATE guild_members SET nickname = ? WHERE guild_id = ? AND user_id = ?', [
    nickname === null ? null : nickname.trim().slice(0, 32) || null,
    guildId,
    userId,
  ]);
}

export function banMember(db: Database, guildId: string, userId: string, reason: string | null, now = Date.now()): void {
  db.tx(() => {
    db.run(
      `INSERT INTO bans (guild_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
      [guildId, userId, reason, now],
    );
    removeGuildMember(db, guildId, userId);
  });
}

export function unbanMember(db: Database, guildId: string, userId: string): void {
  db.run('DELETE FROM bans WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
}

export function isBanned(db: Database, guildId: string, userId: string): boolean {
  const row = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM bans WHERE guild_id = ? AND user_id = ?', [
    guildId,
    userId,
  ]);
  return Number(row?.c ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export function createRole(
  db: Database,
  guildId: string,
  input: { name: string; color?: number; permissions?: number; hoist?: boolean; mentionable?: boolean },
  now = Date.now(),
): RoleRow {
  const name = input.name.trim().slice(0, 32);
  if (!name) throw new HttpError(400, 'Role name is required', 'invalid_name');
  const max = db.get<{ m: number | null }>('SELECT MAX(position) AS m FROM roles WHERE guild_id = ?', [guildId]);
  const position = Number(max?.m ?? 0) + 1;
  const id = newId(now);
  db.run(
    `INSERT INTO roles (id, guild_id, name, color, permissions, position, hoist, mentionable, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      guildId,
      name,
      input.color ?? 0,
      (input.permissions ?? 0) >>> 0,
      position,
      input.hoist ? 1 : 0,
      input.mentionable === false ? 0 : 1,
      now,
    ],
  );
  return db.get<RoleRow>('SELECT * FROM roles WHERE id = ?', [id])!;
}

export function updateRole(
  db: Database,
  guildId: string,
  roleId: string,
  patch: { name?: string; color?: number; permissions?: number; position?: number; hoist?: boolean; mentionable?: boolean },
): RoleRow {
  const role = db.get<RoleRow>('SELECT * FROM roles WHERE id = ? AND guild_id = ?', [roleId, guildId]);
  if (!role) throw new HttpError(404, 'Role not found', 'unknown_role');
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 32);
    if (!name) throw new HttpError(400, 'Role name is required', 'invalid_name');
    sets.push('name = ?');
    params.push(name);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    params.push((patch.color >>> 0) & 0xffffff);
  }
  if (patch.permissions !== undefined) {
    if (role.is_default === 1 && (patch.permissions & 0x7fffffff) === 0) {
      throw new HttpError(400, '@everyone must keep some permissions', 'invalid_permissions');
    }
    sets.push('permissions = ?');
    params.push(patch.permissions >>> 0);
  }
  if (patch.position !== undefined) {
    if (role.is_default === 1) throw new HttpError(400, 'The @everyone role cannot be moved', 'invalid_position');
    sets.push('position = ?');
    params.push(Math.max(1, Math.min(999, Math.floor(patch.position))));
  }
  if (patch.hoist !== undefined) {
    sets.push('hoist = ?');
    params.push(patch.hoist ? 1 : 0);
  }
  if (patch.mentionable !== undefined) {
    sets.push('mentionable = ?');
    params.push(patch.mentionable ? 1 : 0);
  }
  if (sets.length > 0) {
    params.push(roleId);
    db.run(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return db.get<RoleRow>('SELECT * FROM roles WHERE id = ?', [roleId])!;
}

export function deleteRole(db: Database, guildId: string, roleId: string): void {
  const role = db.get<RoleRow>('SELECT * FROM roles WHERE id = ? AND guild_id = ?', [roleId, guildId]);
  if (!role) throw new HttpError(404, 'Role not found', 'unknown_role');
  if (role.is_default === 1) throw new HttpError(400, 'The @everyone role cannot be deleted', 'default_role');
  db.tx(() => {
    db.run('DELETE FROM member_roles WHERE role_id = ?', [roleId]);
    db.run('DELETE FROM roles WHERE id = ?', [roleId]);
    db.run("DELETE FROM permission_overwrites WHERE target_id = ? AND target_type = 'role'", [roleId]);
  });
}

export function setMemberRoles(db: Database, guildId: string, userId: string, roleIds: string[]): void {
  const valid = new Set(
    db
      .all<{ id: string }>('SELECT id FROM roles WHERE guild_id = ? AND is_default = 0', [guildId])
      .map((r) => r.id),
  );
  db.tx(() => {
    db.run('DELETE FROM member_roles WHERE guild_id = ? AND user_id = ?', [guildId, userId]);
    for (const roleId of roleIds) {
      if (!valid.has(roleId)) continue;
      db.run('INSERT INTO member_roles (guild_id, user_id, role_id) VALUES (?, ?, ?)', [guildId, userId, roleId]);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Channels                                                                   */
/* -------------------------------------------------------------------------- */

export function listGuildChannels(db: Database, guildId: string): ChannelRow[] {
  return db.all<ChannelRow>(
    'SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC, created_at ASC',
    [guildId],
  );
}

export function requireChannel(db: Database, id: string): ChannelRow {
  const row = db.get<ChannelRow>('SELECT * FROM channels WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Channel not found', 'unknown_channel');
  return row;
}

export function createChannel(
  db: Database,
  guildId: string,
  input: {
    name: string;
    type: ChannelType;
    topic?: string | null;
    parent_id?: string | null;
    position?: number;
    slowmode_seconds?: number;
  },
  now = Date.now(),
): ChannelRow {
  if (!['text', 'voice', 'category'].includes(input.type)) {
    throw new HttpError(400, 'Invalid channel type', 'invalid_type');
  }
  const name = input.type === 'category' ? input.name.trim().slice(0, 32) : slugifyChannelName(input.name);
  if (!name) throw new HttpError(400, 'Channel name is required', 'invalid_name');
  const maxPos = db.get<{ m: number | null }>('SELECT MAX(position) AS m FROM channels WHERE guild_id = ?', [guildId]);
  const id = newId(now);
  db.run(
    `INSERT INTO channels (id, guild_id, name, type, topic, position, parent_id, slowmode_seconds, nsfw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      guildId,
      name,
      input.type,
      input.topic ?? null,
      input.position ?? Number(maxPos?.m ?? 0) + 1,
      input.parent_id ?? null,
      Math.max(0, Math.min(21600, input.slowmode_seconds ?? 0)),
      now,
    ],
  );
  return requireChannel(db, id);
}

export function updateChannel(
  db: Database,
  channelId: string,
  patch: {
    name?: string;
    topic?: string | null;
    position?: number;
    parent_id?: string | null;
    slowmode_seconds?: number;
    nsfw?: boolean;
  },
): ChannelRow {
  const channel = requireChannel(db, channelId);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    const name = channel.type === 'category' ? patch.name.trim().slice(0, 32) : slugifyChannelName(patch.name);
    if (!name) throw new HttpError(400, 'Channel name is required', 'invalid_name');
    sets.push('name = ?');
    params.push(name);
  }
  if (patch.topic !== undefined) {
    sets.push('topic = ?');
    params.push(patch.topic === null ? null : patch.topic.slice(0, 1024));
  }
  if (patch.position !== undefined) {
    sets.push('position = ?');
    params.push(Math.max(0, Math.floor(patch.position)));
  }
  if (patch.parent_id !== undefined) {
    if (patch.parent_id !== null) {
      const parent = requireChannel(db, patch.parent_id);
      if (parent.guild_id !== channel.guild_id) {
        throw new HttpError(400, 'Category belongs to a different server', 'invalid_parent');
      }
      if (parent.type !== 'category') throw new HttpError(400, 'Parent must be a category', 'invalid_parent');
    }
    sets.push('parent_id = ?');
    params.push(patch.parent_id);
  }
  if (patch.slowmode_seconds !== undefined) {
    sets.push('slowmode_seconds = ?');
    params.push(Math.max(0, Math.min(21600, Math.floor(patch.slowmode_seconds))));
  }
  if (patch.nsfw !== undefined) {
    sets.push('nsfw = ?');
    params.push(patch.nsfw ? 1 : 0);
  }
  if (sets.length > 0) {
    params.push(channelId);
    db.run(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return requireChannel(db, channelId);
}

export function deleteChannel(db: Database, channelId: string): void {
  db.run('DELETE FROM channels WHERE id = ?', [channelId]);
}

export function setChannelOverwrite(
  db: Database,
  channelId: string,
  targetId: string,
  targetType: 'role' | 'member',
  allow: number,
  deny: number,
): void {
  db.run(
    `INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, target_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny,
       target_type = excluded.target_type`,
    [channelId, targetId, targetType, allow >>> 0, deny >>> 0],
  );
}

export function deleteChannelOverwrite(db: Database, channelId: string, targetId: string): void {
  db.run('DELETE FROM permission_overwrites WHERE channel_id = ? AND target_id = ?', [channelId, targetId]);
}

export function listChannelOverwrites(db: Database, channelId: string): {
  target_id: string;
  target_type: string;
  allow: number;
  deny: number;
}[] {
  return db.all('SELECT target_id, target_type, allow, deny FROM permission_overwrites WHERE channel_id = ?', [
    channelId,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Invites                                                                    */
/* -------------------------------------------------------------------------- */

export function createInvite(
  db: Database,
  guildId: string,
  channelId: string,
  inviterId: string,
  options: { max_uses?: number; max_age_seconds?: number | null } = {},
  now = Date.now(),
): { code: string } {
  const code = randomCode(8);
  const expiresAt =
    options.max_age_seconds === undefined || options.max_age_seconds === null
      ? null
      : now + options.max_age_seconds * 1000;
  db.run(
    `INSERT INTO invites (code, guild_id, channel_id, inviter_id, uses, max_uses, created_at, expires_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    [code, guildId, channelId, inviterId, Math.max(0, Math.floor(options.max_uses ?? 0)), now, expiresAt],
  );
  return { code };
}

export interface InviteRow {
  code: string;
  guild_id: string;
  channel_id: string;
  inviter_id: string | null;
  uses: number;
  max_uses: number;
  created_at: number;
  expires_at: number | null;
  revoked: number;
}

export function getInvite(db: Database, code: string): InviteRow | undefined {
  return db.get<InviteRow>('SELECT * FROM invites WHERE code = ?', [code]);
}

export function listInvites(db: Database, guildId: string): InviteRow[] {
  return db.all<InviteRow>(
    'SELECT * FROM invites WHERE guild_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 100',
    [guildId],
  );
}

export function deleteInvite(db: Database, code: string): void {
  db.run('UPDATE invites SET revoked = 1 WHERE code = ?', [code]);
}

export function inviteIsUsable(invite: InviteRow, now = Date.now()): boolean {
  if (invite.revoked === 1) return false;
  if (invite.expires_at !== null && invite.expires_at < now) return false;
  if (invite.max_uses > 0 && invite.uses >= invite.max_uses) return false;
  return true;
}

export function consumeInvite(db: Database, code: string): void {
  db.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', [code]);
}

/* -------------------------------------------------------------------------- */
/* DMs                                                                        */
/* -------------------------------------------------------------------------- */

export function dmRecipientIds(db: Database, channelId: string): string[] {
  return db
    .all<{ user_id: string }>('SELECT user_id FROM dm_recipients WHERE channel_id = ?', [channelId])
    .map((r) => r.user_id);
}

export function isDmParticipant(db: Database, channelId: string, userId: string): boolean {
  const row = db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM dm_recipients WHERE channel_id = ? AND user_id = ?',
    [channelId, userId],
  );
  return Number(row?.c ?? 0) > 0;
}

export function listDmChannels(db: Database, userId: string): ChannelRow[] {
  return db.all<ChannelRow>(
    `SELECT c.* FROM channels c
     JOIN dm_recipients r ON r.channel_id = c.id
     WHERE r.user_id = ? AND c.type IN ('dm', 'group_dm')
     ORDER BY COALESCE(c.last_message_id, '0') DESC`,
    [userId],
  );
}

export function findDirectChannel(db: Database, a: string, b: string): ChannelRow | undefined {
  return db.get<ChannelRow>(
    `SELECT c.* FROM channels c
     JOIN dm_recipients r1 ON r1.channel_id = c.id AND r1.user_id = ?
     JOIN dm_recipients r2 ON r2.channel_id = c.id AND r2.user_id = ?
     WHERE c.type = 'dm'
     LIMIT 1`,
    [a, b],
  );
}

export function getOrCreateDirectChannel(db: Database, a: string, b: string, now = Date.now()): ChannelRow {
  const existing = findDirectChannel(db, a, b);
  if (existing) return existing;
  const id = newId(now);
  db.tx(() => {
    db.run(
      `INSERT INTO channels (id, guild_id, name, type, topic, position, parent_id, created_at)
       VALUES (?, NULL, ?, 'dm', NULL, 0, NULL, ?)`,
      [id, 'dm', now],
    );
    db.run('INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)', [id, a]);
    db.run('INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)', [id, b]);
  });
  return requireChannel(db, id);
}

export function createGroupChannel(db: Database, ownerId: string, userIds: string[], name: string | null, now = Date.now()): ChannelRow {
  const unique = Array.from(new Set([ownerId, ...userIds]));
  if (unique.length < 2) throw new HttpError(400, 'A group needs at least two people', 'too_few_recipients');
  if (unique.length > 10) throw new HttpError(400, 'Groups are limited to 10 people', 'too_many_recipients');
  const id = newId(now);
  db.tx(() => {
    db.run(
      `INSERT INTO channels (id, guild_id, name, type, topic, position, parent_id, created_at)
       VALUES (?, NULL, ?, 'group_dm', NULL, 0, NULL, ?)`,
      [id, name?.slice(0, 64) || 'Group', now],
    );
    for (const userId of unique) {
      db.run('INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)', [id, userId]);
    }
  });
  return requireChannel(db, id);
}

export function dmChannelForUser(db: Database, channelId: string, userId: string): ChannelRow {
  const channel = requireChannel(db, channelId);
  if (channel.type !== 'dm' && channel.type !== 'group_dm') {
    throw new HttpError(400, 'Not a direct message channel', 'not_a_dm');
  }
  if (!isDmParticipant(db, channelId, userId)) {
    throw new HttpError(403, 'You are not part of this conversation', 'not_a_recipient');
  }
  return channel;
}

export function recipientsOf(db: Database, channelId: string): PublicUser[] {
  return dmRecipientIds(db, channelId)
    .map((id) => getUserById(db, id))
    .filter((u): u is UserRow => Boolean(u))
    .map((u) => toPublicUser(u));
}

export function isOwner(db: Database, guildId: string, userId: string): boolean {
  return isGuildOwner(db, guildId, userId);
}

export function assertMember(db: Database, guildId: string, userId: string): void {
  assertGuildMember(db, guildId, userId);
}

export function channelDto(db: Database, row: ChannelRow): Channel {
  if (row.type === 'dm' || row.type === 'group_dm') {
    return toChannel(row, recipientsOf(db, row.id));
  }
  return toChannel(row);
}

export function roleDto(row: RoleRow) {
  return toRole(row);
}
