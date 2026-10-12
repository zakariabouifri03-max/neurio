/** Messages, reactions, pins, uploads, files and search. */
import { HttpError } from '../ids';
import { assertObject, optionalNumber, optionalString, readMultipart, requiredString } from '../http';
import {
  assertNotBlocked,
  requireChannelAccess,
  requireChannelPermission,
  requireUser,
} from './helpers';
import { dmRecipientIds } from '../store/guilds';
import { channelAudience } from '../audience';
import {
  addReaction,
  clearReactions,
  createMessage,
  deleteMessage,
  deleteMessagesBulk,
  editMessage,
  getMessageRow,
  getReadState,
  getUpload,
  listMessages,
  listPinned,
  removeReaction,
  requireMessage,
  searchMessages,
  serializeMessage,
  serializeMessages,
  setPinned,
  setReadState,
  bumpMentions,
  MESSAGE_LIMIT_MAX,
} from '../store/messages';
import { Permissions } from '../../shared/permissions';
import { destroyUpload } from './files';
import type { Router } from './router';
import type { RouteContext, RestDeps } from './types';

export function registerMessageRoutes(router: Router, deps: RestDeps): void {
  const statusOf = (id: string) => deps.presence.statusOf(id);
  const ctxOf = (viewerId: string) => ({ viewerId, statusOf });

  /* ---------------------------- message history --------------------------- */

  router.get('/api/channels/:channelId/messages', (ctx) => {
    const user = requireUser(ctx);
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    const limit = Math.min(optionalNumber(ctx.query.get('limit') ?? undefined, 'limit') ?? 50, MESSAGE_LIMIT_MAX);
    const rows = listMessages(deps.db, channel.id, {
      before: ctx.query.get('before'),
      after: ctx.query.get('after'),
      around: ctx.query.get('around'),
      limit,
    });
    return { messages: serializeMessages(deps.db, rows, ctxOf(user.id)) };
  });

  router.get('/api/channels/:channelId/messages/:messageId', (ctx) => {
    const user = requireUser(ctx);
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    const row = requireMessage(deps.db, ctx.params.messageId);
    if (row.channel_id !== channel.id) throw new HttpError(404, 'Message not found', 'unknown_message');
    return { message: serializeMessage(deps.db, row, ctxOf(user.id)) };
  });

  router.post(
    '/api/channels/:channelId/messages',
    (ctx) => {
      const user = requireUser(ctx);
      const channel = requireChannelAccess(ctx, ctx.params.channelId);
      requireChannelPermission(ctx, channel, Permissions.SEND_MESSAGES, 'send messages in that channel');
      const body = assertObject(ctx.body);
      const content = optionalString(body.content, 'content', 4000) ?? '';
      const referenceId = optionalString(body.reference_id, 'reference_id', 32) || null;
      const uploadIds = Array.isArray(body.upload_ids) ? body.upload_ids.map(String).slice(0, 10) : [];

      // Direct messages respect blocks.
      if (!channel.guild_id) {
        for (const recipientId of dmRecipientIds(deps.db, channel.id)) {
          if (recipientId !== user.id) assertNotBlocked(ctx, recipientId);
        }
      }

      // Slowmode: per user, per channel.
      if (channel.slowmode_seconds > 0) {
        const last = deps.db.get<{ created_at: number }>(
          'SELECT created_at FROM messages WHERE channel_id = ? AND author_id = ? ORDER BY id DESC LIMIT 1',
          [channel.id, user.id],
        );
        if (last && deps.now() - last.created_at < channel.slowmode_seconds * 1000) {
          const wait = Math.ceil((channel.slowmode_seconds * 1000 - (deps.now() - last.created_at)) / 1000);
          throw new HttpError(429, `Slowmode is on — wait ${wait}s`, 'slowmode');
        }
      }

      if (uploadIds.length > 0) {
        requireChannelPermission(ctx, channel, Permissions.ATTACH_FILES, 'attach files');
      }
      for (const uploadId of uploadIds) {
        const upload = getUpload(deps.db, uploadId);
        if (!upload) throw new HttpError(400, 'Unknown attachment', 'unknown_upload');
        if (upload.user_id !== user.id) throw new HttpError(403, 'That upload belongs to somebody else', 'upload_owner');
      }

      if (referenceId) {
        const ref = getMessageRow(deps.db, referenceId);
        if (!ref || ref.channel_id !== channel.id) {
          throw new HttpError(400, 'You can only reply to messages in the same channel', 'invalid_reference');
        }
      }

      const row = createMessage(deps.db, {
        channelId: channel.id,
        authorId: user.id,
        content,
        referenceId,
        uploadIds,
        now: deps.now(),
      });
      const message = serializeMessage(deps.db, row, ctxOf(user.id));
      const audience = channelAudience(deps.db, channel.id);
      deps.gateway.dispatch('MESSAGE_CREATE', { message }, audience);
      bumpMentionState(deps, channel.id, message.mentions, message.author.id, message.id);
      if (!channel.guild_id) {
        // Sending a DM marks it read for the author.
        setReadState(deps.db, user.id, channel.id, row.id, deps.now());
      }
      return { message };
    },
    { limit: { limit: 20, windowMs: 10_000 } },
  );

  router.patch('/api/messages/:messageId', (ctx) => {
    const user = requireUser(ctx);
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    if (row.author_id !== user.id) {
      requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'edit that message');
    }
    const body = assertObject(ctx.body);
    const updated = editMessage(deps.db, row.id, requiredString(body.content, 'content', 4000), deps.now());
    const message = serializeMessage(deps.db, updated, ctxOf(user.id));
    deps.gateway.dispatch('MESSAGE_UPDATE', { message }, channelAudience(deps.db, channel.id));
    return { message };
  });

  router.delete('/api/messages/:messageId', (ctx) => {
    const user = requireUser(ctx);
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    if (row.author_id !== user.id && channel.guild_id) {
      requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'delete that message');
    }
    deleteOwnAttachments(deps, row.id);
    deleteMessage(deps.db, row.id, deps.now());
    deps.gateway.dispatch(
      'MESSAGE_DELETE',
      { channel_id: row.channel_id, message_id: row.id },
      channelAudience(deps.db, channel.id),
    );
    return { ok: true };
  });

  router.post('/api/channels/:channelId/messages/bulk-delete', (ctx) => {
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'delete messages');
    const body = assertObject(ctx.body);
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new HttpError(400, 'ids must be a non-empty array', 'invalid_field');
    }
    const ids = body.ids.map(String).slice(0, 100);
    for (const id of ids) deleteOwnAttachments(deps, id);
    const result = deleteMessagesBulk(deps.db, ids, deps.now());
    deps.gateway.dispatch(
      'MESSAGE_DELETE_BULK',
      { channel_id: result.channel_id, ids: result.ids },
      channelAudience(deps.db, channel.id),
    );
    return { ok: true, deleted: result.ids.length };
  });

  /* ------------------------------ reactions ------------------------------- */

  router.put('/api/messages/:messageId/reactions/:emoji', (ctx) => {
    const user = requireUser(ctx);
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    requireChannelPermission(ctx, channel, Permissions.ADD_REACTIONS, 'add reactions');
    addReaction(deps.db, row.id, user.id, ctx.params.emoji, deps.now());
    dispatchReactions(deps, row.channel_id, row.id);
    return { ok: true };
  });

  router.delete('/api/messages/:messageId/reactions/:emoji', (ctx) => {
    const user = requireUser(ctx);
    const row = requireMessage(deps.db, ctx.params.messageId);
    requireChannelAccess(ctx, row.channel_id);
    removeReaction(deps.db, row.id, user.id, ctx.params.emoji);
    dispatchReactions(deps, row.channel_id, row.id);
    return { ok: true };
  });

  router.delete('/api/messages/:messageId/reactions/:emoji/users/:userId', (ctx) => {
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'remove reactions');
    deps.db.run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [
      row.id,
      ctx.params.userId,
      ctx.params.emoji,
    ]);
    dispatchReactions(deps, row.channel_id, row.id);
    return { ok: true };
  });

  router.delete('/api/messages/:messageId/reactions', (ctx) => {
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'clear reactions');
    clearReactions(deps.db, row.id);
    dispatchReactions(deps, row.channel_id, row.id);
    return { ok: true };
  });

  /* -------------------------------- pins ---------------------------------- */

  router.get('/api/channels/:channelId/pins', (ctx) => {
    const user = requireUser(ctx);
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    return { messages: serializeMessages(deps.db, listPinned(deps.db, channel.id), ctxOf(user.id)) };
  });

  router.put('/api/messages/:messageId/pin', (ctx) => {
    const user = requireUser(ctx);
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'pin messages');
    setPinned(deps.db, row.id, true);
    const message = serializeMessage(deps.db, getMessageRow(deps.db, row.id)!, ctxOf(user.id));
    deps.gateway.dispatch('MESSAGE_UPDATE', { message }, channelAudience(deps.db, channel.id));
    return { message };
  });

  router.delete('/api/messages/:messageId/pin', (ctx) => {
    const user = requireUser(ctx);
    const row = requireMessage(deps.db, ctx.params.messageId);
    const channel = requireChannelAccess(ctx, row.channel_id);
    requireChannelPermission(ctx, channel, Permissions.MANAGE_MESSAGES, 'unpin messages');
    setPinned(deps.db, row.id, false);
    const message = serializeMessage(deps.db, getMessageRow(deps.db, row.id)!, ctxOf(user.id));
    deps.gateway.dispatch('MESSAGE_UPDATE', { message }, channelAudience(deps.db, channel.id));
    return { message };
  });

  /* ------------------------------- uploads -------------------------------- */

  router.post(
    '/api/uploads',
    async (ctx) => {
      const user = requireUser(ctx);
      const form = await readMultipart(ctx.req, deps.config.maxUploadBytes + 1024 * 1024);
      const files = form.getAll('files').filter((entry): entry is File => typeof entry === 'object' && entry !== null);
      const legacy = form.getAll('file').filter((entry): entry is File => typeof entry === 'object' && entry !== null);
      const all = [...files, ...legacy];
      if (all.length === 0) throw new HttpError(400, 'No files uploaded (use the "files" field)', 'no_file');
      if (all.length > 10) throw new HttpError(400, 'Up to 10 files per message', 'too_many_files');
      const attachments = [];
      for (const file of all) {
        const data = Buffer.from(await file.arrayBuffer());
        const { upload } = deps.uploads.save(deps.db, {
          data,
          filename: file.name || 'file',
          contentType: file.type || 'application/octet-stream',
          userId: user.id,
          now: deps.now(),
        });
        const size = deps.uploads.dimensions(data);
        attachments.push({
          id: upload.id,
          filename: upload.filename,
          content_type: upload.content_type,
          size: upload.size,
          width: size?.width ?? null,
          height: size?.height ?? null,
          url: `/api/files/${upload.id}`,
          sha256: upload.sha256,
          created_at: upload.created_at,
        });
      }
      return { attachments };
    },
    { limit: { limit: 60, windowMs: 60_000 } },
  );

  /* -------------------------------- search -------------------------------- */

  router.get('/api/search', (ctx) => {
    const user = requireUser(ctx);
    const query = (ctx.query.get('q') ?? ctx.query.get('query') ?? '').trim();
    if (query.length === 0) return { hits: [], query };
    const guildId = ctx.query.get('guild_id');
    const channelId = ctx.query.get('channel_id');
    if (channelId) requireChannelAccess(ctx, channelId);
    if (guildId) {
      const member = deps.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [guildId, user.id],
      );
      if (Number(member?.c ?? 0) === 0) throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
    }
    const hits = searchMessages(deps.db, {
      query,
      userId: user.id,
      guildId: guildId ?? null,
      channelId: channelId ?? null,
      authorId: ctx.query.get('author_id'),
      pinnedOnly: ctx.query.get('pinned') === 'true',
      limit: Math.min(optionalNumber(ctx.query.get('limit') ?? undefined, 'limit') ?? 25, 50),
    });
    return { hits, query };
  });

  /* ------------------------------- utilities ------------------------------ */

  router.post('/api/channels/:channelId/typing', (ctx) => {
    const user = requireUser(ctx);
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    const payload = {
      channel_id: channel.id,
      user_id: user.id,
      display_name: user.display_name,
      expires_at: deps.now() + 8000,
    };
    deps.gateway.dispatch('TYPING_START', payload, channelAudience(deps.db, channel.id), { exclude: user.id });
    return { ok: true };
  });

  router.get('/api/channels/:channelId/unread', (ctx) => {
    const user = requireUser(ctx);
    const channel = requireChannelAccess(ctx, ctx.params.channelId);
    const state = getReadState(deps.db, user.id, channel.id);
    const row = deps.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM messages WHERE channel_id = ? AND deleted_at IS NULL AND author_id <> ?
       ${state?.last_read_message_id ? 'AND id > ?' : ''}`,
      state?.last_read_message_id
        ? [channel.id, user.id, state.last_read_message_id]
        : [channel.id, user.id],
    );
    return {
      channel_id: channel.id,
      unread_count: Number(row?.c ?? 0),
      mention_count: state?.mention_count ?? 0,
      last_read_message_id: state?.last_read_message_id ?? null,
    };
  });
}

function dispatchReactions(deps: RestDeps, channelId: string, messageId: string): void {
  const audience = channelAudience(deps.db, channelId);
  for (const memberId of audience) {
    const row = getMessageRow(deps.db, messageId);
    if (!row || row.deleted_at !== null) continue;
    deps.gateway.dispatchToUser(memberId, 'MESSAGE_UPDATE', {
      message: serializeMessage(deps.db, row, { viewerId: memberId, statusOf: (id) => deps.presence.statusOf(id) }),
    });
  }
}

/** Mentions bump the unread badge for every mentioned user. */
function bumpMentionState(
  deps: RestDeps,
  channelId: string,
  mentions: string[],
  authorId: string,
  messageId: string,
): void {
  for (const userId of mentions) {
    if (userId === authorId) continue;
    const exists = deps.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE id = ?', [userId]);
    if (Number(exists?.c ?? 0) === 0) continue;
    bumpMentions(deps.db, userId, channelId, 1, deps.now());
    deps.gateway.dispatchToUser(userId, 'READ_STATE_UPDATE', {
      channel_id: channelId,
      last_read_message_id: null,
      mention_count: getReadState(deps.db, userId, channelId)?.mention_count ?? 1,
      message_id: messageId,
      highlight: true,
    });
  }
}

function deleteOwnAttachments(deps: RestDeps, messageId: string): void {
  const rows = deps.db.all<{ upload_id: string | null }>(
    'SELECT upload_id FROM attachments WHERE message_id = ?',
    [messageId],
  );
  for (const row of rows) {
    if (row.upload_id) destroyUpload(deps, row.upload_id);
  }
}

export type { RouteContext };
