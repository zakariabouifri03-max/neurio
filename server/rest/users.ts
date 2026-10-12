/** Friend requests, blocks, avatars and read state. */
import { HttpError } from '../ids';
import { assertObject, readMultipart, requiredString, optionalString } from '../http';
import {
  acceptFriendRequest,
  blockUser,
  getUserById,
  getUserByUsername,
  listRelationships,
  removeRelationship,
  sendFriendRequest,
  unblockUser,
  updateUser,
} from '../store/users';
import { toPublicUser } from '../serialize';
import { listDmChannels, guildIdsForUser } from '../store/guilds';
import { unreadFor } from '../store/messages';
import { computeChannelPermissions, computeGuildPermissions } from '../permissions';
import { Permissions } from '../../shared/permissions';
import { requireUser } from './helpers';
import type { Router } from './router';
import type { RestDeps } from './types';
import { isImageType } from '../media';

export function registerUserRoutes(router: Router, deps: RestDeps): void {
  /* ------------------------------- friend code ---------------------------- */
  router.post(
    '/api/relationships/requests',
    (ctx) => {
      const user = requireUser(ctx);
      const body = assertObject(ctx.body);
      let targetId = optionalString(body.user_id, 'user_id', 32);
      if (!targetId) {
        const username = requiredString(body.username, 'username', 64);
        const target = getUserByUsername(deps.db, username.replace(/^@/, ''));
        if (!target) throw new HttpError(404, 'No user with that username', 'unknown_user');
        targetId = target.id;
      }
      const target = getUserById(deps.db, targetId);
      if (!target) throw new HttpError(404, 'No user with that username', 'unknown_user');
      const result = sendFriendRequest(deps.db, user.id, target.id);
      const payload = {
        user: toPublicUser(target, deps.presence.statusOf(target.id)),
        relationship: result.type,
        from: toPublicUser(user, deps.presence.statusOf(user.id)),
      };
      if (result.accepted) {
        // Both sides now see a friendship.
        deps.gateway.dispatchToUser(target.id, 'FRIEND_REQUEST_REMOVE', { user_id: user.id, accepted: true });
        deps.gateway.dispatchToUser(user.id, 'FRIEND_REQUEST_REMOVE', { user_id: target.id, accepted: true });
      } else {
        deps.gateway.dispatchToUser(target.id, 'FRIEND_REQUEST_CREATE', payload);
      }
      deps.gateway.dispatchPresence(user.id);
      return { relationship: result.type, accepted: result.accepted };
    },
    { limit: { limit: 20, windowMs: 60_000 } },
  );

  router.post('/api/relationships/requests/:userId/accept', (ctx) => {
    const user = requireUser(ctx);
    const target = getUserById(deps.db, ctx.params.userId);
    if (!target) throw new HttpError(404, 'User not found', 'unknown_user');
    acceptFriendRequest(deps.db, user.id, target.id);
    const payload = { user: toPublicUser(user, deps.presence.statusOf(user.id)), accepted: true };
    deps.gateway.dispatchToUser(target.id, 'FRIEND_REQUEST_REMOVE', { user_id: user.id, accepted: true });
    deps.gateway.dispatchToUser(user.id, 'FRIEND_REQUEST_REMOVE', { user_id: target.id, accepted: true });
    deps.gateway.dispatchToUser(user.id, 'FRIEND_REQUEST_CREATE', payload);
    return { ok: true, relationship: 'friend' };
  });

  router.delete('/api/relationships/:userId', (ctx) => {
    const user = requireUser(ctx);
    removeRelationship(deps.db, user.id, ctx.params.userId);
    deps.gateway.dispatchToUser(ctx.params.userId, 'FRIEND_REQUEST_REMOVE', { user_id: user.id });
    return { ok: true };
  });

  router.post('/api/relationships/:userId/block', (ctx) => {
    const user = requireUser(ctx);
    blockUser(deps.db, user.id, ctx.params.userId);
    deps.gateway.dispatchToUser(ctx.params.userId, 'FRIEND_REQUEST_REMOVE', { user_id: user.id });
    return { ok: true, blocked: true };
  });

  router.delete('/api/relationships/:userId/block', (ctx) => {
    const user = requireUser(ctx);
    unblockUser(deps.db, user.id, ctx.params.userId);
    return { ok: true, blocked: false };
  });

  router.get('/api/relationships', (ctx) => {
    const user = requireUser(ctx);
    return { relationships: listRelationships(deps.db, user.id, (id) => deps.presence.statusOf(id)) };
  });

  /* -------------------------------- avatar -------------------------------- */

  router.post('/api/users/@me/avatar', async (ctx) => {
    const user = requireUser(ctx);
    const form = await readMultipart(ctx.req, Math.min(deps.config.maxUploadBytes, 8 * 1024 * 1024));
    const file = (form.getAll('file') as unknown[]).find((v): v is File => typeof v === 'object' && v !== null);
    if (!file) throw new HttpError(400, 'No file uploaded (use the "file" field)', 'no_file');
    if (!isImageType(file.type)) throw new HttpError(415, 'Avatars must be images', 'unsupported_media_type');
    const data = Buffer.from(await file.arrayBuffer());
    const { upload } = deps.uploads.save(deps.db, {
      data,
      filename: file.name || 'avatar.png',
      contentType: file.type,
      userId: user.id,
    });
    const updated = updateUser(deps.db, user.id, { avatar_id: upload.id });
    const dto = toPublicUser(updated, deps.presence.ownStatus(user.id));
    deps.gateway.dispatch('USER_UPDATE', { user: dto }, deps.gateway.audienceForUser(user.id), { includeSelf: true });
    return { user: dto };
  });

  router.delete('/api/users/@me/avatar', (ctx) => {
    const user = requireUser(ctx);
    const updated = updateUser(deps.db, user.id, { avatar_id: null });
    const dto = toPublicUser(updated, deps.presence.ownStatus(user.id));
    deps.gateway.dispatch('USER_UPDATE', { user: dto }, deps.gateway.audienceForUser(user.id), { includeSelf: true });
    return { user: dto };
  });

  /* ------------------------------ read state ------------------------------ */

  router.get('/api/read-states', (ctx) => {
    const user = requireUser(ctx);
    const channels: string[] = [];
    for (const guildId of guildIdsForUser(deps.db, user.id)) {
      for (const row of deps.db.all<{ id: string }>('SELECT id FROM channels WHERE guild_id = ?', [guildId])) {
        // Only channels the member can actually see contribute to badges.
        if ((computeChannelPermissions(deps.db, guildId, user.id, row.id) & Permissions.VIEW_CHANNEL) !== 0) {
          channels.push(row.id);
        }
      }
    }
    for (const channel of listDmChannels(deps.db, user.id)) channels.push(channel.id);
    return { unread: unreadFor(deps.db, user.id, channels) };
  });

  router.post('/api/channels/:channelId/ack', (ctx) => {
    const user = requireUser(ctx);
    const body = assertObject(ctx.body);
    const messageId = optionalString(body.message_id, 'message_id', 32) ?? null;
    const channel = deps.db.get<{ id: string; guild_id: string | null }>(
      'SELECT id, guild_id FROM channels WHERE id = ?',
      [ctx.params.channelId],
    );
    if (!channel) throw new HttpError(404, 'Channel not found', 'unknown_channel');
    if (!channel.guild_id) {
      const participant = deps.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM dm_recipients WHERE channel_id = ? AND user_id = ?',
        [channel.id, user.id],
      );
      if (Number(participant?.c ?? 0) === 0) throw new HttpError(403, 'Not your conversation', 'not_a_recipient');
    }
    deps.db.run(
      `INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count, last_read_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET
         last_read_message_id = COALESCE(excluded.last_read_message_id, read_states.last_read_message_id),
         mention_count = 0,
         last_read_at = excluded.last_read_at`,
      [user.id, channel.id, messageId, deps.now()],
    );
    const payload = { channel_id: channel.id, last_read_message_id: messageId, mention_count: 0 };
    deps.gateway.dispatch('READ_STATE_UPDATE', payload, new Set([user.id]));
    return payload;
  });

  router.get('/api/permissions', (ctx) => {
    const user = requireUser(ctx);
    const guildId = ctx.query.get('guild_id');
    if (!guildId) throw new HttpError(400, 'guild_id is required', 'missing_field');
    const channelId = ctx.query.get('channel_id');
    const bits = channelId
      ? computeChannelPermissions(deps.db, guildId, user.id, channelId)
      : computeGuildPermissions(deps.db, guildId, user.id);
    return { permissions: bits, is_administrator: (bits & Permissions.ADMINISTRATOR) !== 0 };
  });
}
