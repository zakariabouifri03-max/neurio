/** Channels, permission overwrites and direct messages. */
import { HttpError } from '../ids';
import { assertObject, optionalBoolean, optionalNumber, optionalString, requiredString } from '../http';
import { assertNotBlocked, requireChannelAccess, requireGuildPermission, requireUser } from './helpers';
import {
  channelDto,
  createChannel,
  createGroupChannel,
  deleteChannel,
  deleteChannelOverwrite,
  dmChannelForUser,
  getOrCreateDirectChannel,
  guildBundle,
  guildMemberIds,
  isDmParticipant,
  listChannelOverwrites,
  listDmChannels,
  recipientsOf,
  requireChannel,
  setChannelOverwrite,
  updateChannel,
} from '../store/guilds';
import { Permissions } from '../../shared/permissions';
import type { ChannelType } from '../../shared/types';
import type { Router } from './router';
import type { RestDeps } from './types';

export function registerChannelRoutes(router: Router, deps: RestDeps): void {
  /* ------------------------------- guild channels ------------------------- */

  router.post('/api/guilds/:guildId/channels', (ctx) => {
    const guildId = ctx.params.guildId;
    requireGuildPermission(ctx, guildId, Permissions.MANAGE_CHANNELS, 'create channels');
    const body = assertObject(ctx.body);
    const type = (optionalString(body.type, 'type', 16) ?? 'text') as ChannelType;
    const channel = createChannel(deps.db, guildId, {
      name: requiredString(body.name, 'name', 32),
      type,
      topic: optionalString(body.topic, 'topic', 1024) ?? null,
      parent_id: optionalString(body.parent_id, 'parent_id', 32) || null,
      slowmode_seconds: optionalNumber(body.slowmode_seconds, 'slowmode_seconds') ?? 0,
    });
    const dto = channelDto(deps.db, channel);
    deps.gateway.dispatch('CHANNEL_CREATE', { channel: dto }, deps.gateway.audienceForGuild(guildId));
    return { channel: dto };
  });

  router.get('/api/channels/:channelId', (ctx) => {
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    return { channel: channelDto(deps.db, channel) };
  });

  router.patch('/api/channels/:channelId', (ctx) => {
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    if (channel.guild_id) {
      requireGuildPermission(ctx, channel.guild_id, Permissions.MANAGE_CHANNELS, 'edit channels');
    }
    const body = assertObject(ctx.body);
    const updated = updateChannel(deps.db, channel.id, {
      name: optionalString(body.name, 'name', 32),
      topic: body.topic === null ? null : optionalString(body.topic, 'topic', 1024),
      position: optionalNumber(body.position, 'position'),
      parent_id: body.parent_id === null ? null : optionalString(body.parent_id, 'parent_id', 32),
      slowmode_seconds: optionalNumber(body.slowmode_seconds, 'slowmode_seconds'),
      nsfw: optionalBoolean(body.nsfw, 'nsfw'),
    });
    const dto = channelDto(deps.db, updated);
    const audience = channel.guild_id
      ? deps.gateway.audienceForGuild(channel.guild_id)
      : new Set(recipientsOf(deps.db, channel.id).map((r) => r.id));
    deps.gateway.dispatch('CHANNEL_UPDATE', { channel: dto }, audience);
    return { channel: dto };
  });

  router.delete('/api/channels/:channelId', (ctx) => {
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    if (!channel.guild_id) {
      // Leaving a DM/group conversation.
      const user = requireUser(ctx);
      deps.db.run('DELETE FROM dm_recipients WHERE channel_id = ? AND user_id = ?', [channel.id, user.id]);
      const left = deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM dm_recipients WHERE channel_id = ?', [
        channel.id,
      ]);
      if (Number(left?.c ?? 0) === 0) deleteChannel(deps.db, channel.id);
      deps.gateway.dispatch('CHANNEL_DELETE', { channel_id: channel.id }, deps.gateway.audienceForChannel(channel.id));
      return { ok: true };
    }
    requireGuildPermission(ctx, channel.guild_id, Permissions.MANAGE_CHANNELS, 'delete channels');
    const members = guildMemberIds(deps.db, channel.guild_id);
    deleteChannel(deps.db, channel.id);
    for (const memberId of members) {
      deps.gateway.dispatchToUser(memberId, 'CHANNEL_DELETE', { channel_id: channel.id, guild_id: channel.guild_id });
    }
    return { ok: true };
  });

  router.get('/api/channels/:channelId/overwrites', (ctx) => {
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    if (!channel.guild_id) throw new HttpError(400, 'Direct messages have no permission overwrites', 'not_a_guild_channel');
    requireGuildPermission(ctx, channel.guild_id, Permissions.MANAGE_ROLES, 'view channel permissions');
    return { overwrites: listChannelOverwrites(deps.db, channel.id) };
  });

  router.put('/api/channels/:channelId/overwrites/:targetId', (ctx) => {
    const channel = requireChannelRowId(ctx, ctx.params.channelId);
    if (!channel.guild_id) throw new HttpError(400, 'Direct messages have no permission overwrites', 'not_a_guild_channel');
    requireGuildPermission(ctx, channel.guild_id, Permissions.MANAGE_ROLES, 'edit channel permissions');
    const body = assertObject(ctx.body);
    const targetType = (optionalString(body.type, 'type', 16) ?? inferTargetType(deps, channel.guild_id, ctx.params.targetId)) as
      | 'role'
      | 'member';
    const allow = optionalNumber(body.allow, 'allow') ?? 0;
    const deny = optionalNumber(body.deny, 'deny') ?? 0;
    setChannelOverwrite(deps.db, channel.id, ctx.params.targetId, targetType, allow, deny);
    dispatchGuildRefresh(deps, channel.guild_id);
    return { ok: true };
  });

  router.delete('/api/channels/:channelId/overwrites/:targetId', (ctx) => {
    const channel = requireChannelRowId(ctx, ctx.params.channelId);
    if (!channel.guild_id) throw new HttpError(400, 'Direct messages have no permission overwrites', 'not_a_guild_channel');
    requireGuildPermission(ctx, channel.guild_id, Permissions.MANAGE_ROLES, 'edit channel permissions');
    deleteChannelOverwrite(deps.db, channel.id, ctx.params.targetId);
    dispatchGuildRefresh(deps, channel.guild_id);
    return { ok: true };
  });

  /* ----------------------------------- DMs -------------------------------- */

  router.get('/api/dms', (ctx) => {
    const user = requireUser(ctx);
    return { channels: listDmChannels(deps.db, user.id).map((row) => channelDto(deps.db, row)) };
  });

  router.post(
    '/api/dms',
    (ctx) => {
      const user = requireUser(ctx);
      const body = assertObject(ctx.body);
      const recipientId = requiredString(body.recipient_id, 'recipient_id', 32);
      if (recipientId === user.id) throw new HttpError(400, 'You cannot DM yourself', 'self_dm');
      assertNotBlocked(ctx, recipientId);
      const channel = getOrCreateDirectChannel(deps.db, user.id, recipientId);
      const dto = channelDto(deps.db, channel);
      for (const recipient of dto.recipients ?? []) {
        deps.gateway.dispatchToUser(recipient.id, 'CHANNEL_CREATE', { channel: dto });
      }
      return { channel: dto };
    },
    { limit: { limit: 30, windowMs: 60_000 } },
  );

  router.post(
    '/api/dms/group',
    (ctx) => {
      const user = requireUser(ctx);
      const body = assertObject(ctx.body);
      const ids = Array.isArray(body.user_ids) ? body.user_ids.map(String) : [];
      const channel = createGroupChannel(deps.db, user.id, ids, optionalString(body.name, 'name', 64) ?? null);
      const dto = channelDto(deps.db, channel);
      for (const recipient of dto.recipients ?? []) {
        deps.gateway.dispatchToUser(recipient.id, 'CHANNEL_CREATE', { channel: dto });
      }
      return { channel: dto };
    },
    { limit: { limit: 10, windowMs: 60_000 } },
  );

  router.post('/api/channels/:channelId/recipients', (ctx) => {
    const user = requireUser(ctx);
    const channel = dmChannelForUser(deps.db, ctx.params.channelId, user.id);
    if (channel.type !== 'group_dm') throw new HttpError(400, 'Only group conversations accept new members', 'not_a_group');
    const body = assertObject(ctx.body);
    const userId = requiredString(body.user_id, 'user_id', 32);
    if (isDmParticipant(deps.db, channel.id, userId)) return { channel: channelDto(deps.db, channel) };
    const count = recipientsOf(deps.db, channel.id).length;
    if (count >= 10) throw new HttpError(400, 'Groups are limited to 10 people', 'too_many_recipients');
    assertNotBlocked(ctx, userId);
    deps.db.run('INSERT INTO dm_recipients (channel_id, user_id) VALUES (?, ?)', [channel.id, userId]);
    const dto = channelDto(deps.db, requireChannel(deps.db, channel.id));
    for (const recipient of dto.recipients ?? []) {
      deps.gateway.dispatchToUser(recipient.id, 'CHANNEL_CREATE', { channel: dto });
    }
    return { channel: dto };
  });

  router.delete('/api/channels/:channelId/recipients/:userId', (ctx) => {
    const user = requireUser(ctx);
    const channel = dmChannelForUser(deps.db, ctx.params.channelId, user.id);
    if (channel.type !== 'group_dm') throw new HttpError(400, 'Only group conversations work like that', 'not_a_group');
    const targetId = ctx.params.userId === '@me' ? user.id : ctx.params.userId;
    const audience = deps.gateway.audienceForChannel(channel.id);
    deps.db.run('DELETE FROM dm_recipients WHERE channel_id = ? AND user_id = ?', [channel.id, targetId]);
    for (const memberId of audience) {
      deps.gateway.dispatchToUser(memberId, 'CHANNEL_UPDATE', {
        channel: memberId === targetId ? { id: channel.id, removed: true } : channelDto(deps.db, requireChannel(deps.db, channel.id)),
      });
    }
    return { ok: true };
  });

  function requireChannelRowId(_ctx: unknown, channelId: string) {
    return requireChannel(deps.db, channelId);
  }

  function inferTargetType(
    deps: RestDeps,
    guildId: string,
    targetId: string,
  ): 'role' | 'member' {
    const role = deps.db.get<{ id: string }>('SELECT id FROM roles WHERE id = ? AND guild_id = ?', [targetId, guildId]);
    return role ? 'role' : 'member';
  }

  function dispatchGuildRefresh(deps: RestDeps, guildId: string): void {
    const audiences = deps.gateway.audienceForGuild(guildId);
    for (const memberId of audiences) {
      const member = deps.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [guildId, memberId],
      );
      if (Number(member?.c ?? 0) === 0) continue;
      deps.gateway.dispatchToUser(memberId, 'GUILD_UPDATE', {
        guild: guildBundle(deps.db, guildId, memberId, (id) => deps.presence.statusOf(id)),
      });
    }
  }
}
