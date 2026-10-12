/** Messages, attachments, reactions, pins, read state and search. */
import type { Database } from '../db';
import { HttpError, newId } from '../ids';
import type { Attachment, Message, MessageType, ReactionGroup, SearchHit, UserStatus } from '../../shared/types';
import { getUserById } from './users';
import { toPublicUser, type UserRow } from '../serialize';
import { requireChannel } from './guilds';

export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  type: string;
  created_at: number;
  edited_at: number | null;
  pinned: number;
  reference_id: string | null;
  mention_everyone: number;
  deleted_at: number | null;
}

export interface AttachmentRow {
  id: string;
  message_id: string | null;
  upload_id: string | null;
  channel_id: string | null;
  filename: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

export interface UploadRow {
  id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size: number;
  storage_key: string;
  sha256: string;
  created_at: number;
}

export const MESSAGE_LIMIT_DEFAULT = 50;
export const MESSAGE_LIMIT_MAX = 200;
export const CONTENT_MAX = 4000;

/* -------------------------------------------------------------------------- */
/* Uploads                                                                    */
/* -------------------------------------------------------------------------- */

export function insertUpload(
  db: Database,
  upload: {
    id: string;
    user_id: string;
    filename: string;
    content_type: string;
    size: number;
    storage_key: string;
    sha256: string;
    created_at: number;
  },
): void {
  db.run(
    `INSERT INTO uploads (id, user_id, filename, content_type, size, storage_key, sha256, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      upload.id,
      upload.user_id,
      upload.filename,
      upload.content_type,
      upload.size,
      upload.storage_key,
      upload.sha256,
      upload.created_at,
    ],
  );
}

export function getUpload(db: Database, id: string): UploadRow | undefined {
  return db.get<UploadRow>('SELECT * FROM uploads WHERE id = ?', [id]);
}

export function bumpDownloadCount(db: Database, id: string): void {
  db.run('UPDATE uploads SET download_count = download_count + 1 WHERE id = ?', [id]);
}

export function deleteUpload(db: Database, id: string): void {
  db.run('DELETE FROM uploads WHERE id = ?', [id]);
}

/** Orphaned uploads (uploaded but never attached) older than `maxAgeMs`. */
export function orphanUploads(db: Database, maxAgeMs: number, now = Date.now()): UploadRow[] {
  return db.all<UploadRow>(
    `SELECT u.* FROM uploads u
     LEFT JOIN attachments a ON a.upload_id = u.id
     LEFT JOIN users usr ON usr.avatar_id = u.id
     LEFT JOIN guilds g ON g.icon_id = u.id
     WHERE a.id IS NULL AND usr.id IS NULL AND g.id IS NULL AND u.created_at < ?`,
    [now - maxAgeMs],
  );
}

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

export interface ParsedContent {
  content: string;
  mentions: string[];
  mentionEveryone: boolean;
  mentionHere: boolean;
}

/** Extract <@id>, <@&id>, @everyone and @here from message content. */
export function parseMentions(db: Database, content: string, guildId: string | null): ParsedContent {
  const mentions = new Set<string>();
  const userRe = /<@!?(\d{1,20})>/g;
  let match: RegExpExecArray | null;
  while ((match = userRe.exec(content)) !== null) mentions.add(match[1]);
  const roleRe = /<@&(\d{1,20})>/g;
  while ((match = roleRe.exec(content)) !== null) {
    if (!guildId) continue;
    const members = db.all<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM member_roles WHERE role_id = ? AND guild_id = ?`,
      [match[1], guildId],
    );
    for (const member of members) mentions.add(member.user_id);
  }
  return {
    content,
    mentions: [...mentions],
    mentionEveryone: /(^|\s)@everyone(\s|$)/.test(content),
    mentionHere: /(^|\s)@here(\s|$)/.test(content),
  };
}

export interface CreateMessageInput {
  channelId: string;
  authorId: string;
  content: string;
  type?: MessageType;
  referenceId?: string | null;
  uploadIds?: string[];
  now?: number;
  skipMentionScan?: boolean;
}

export function createMessage(db: Database, input: CreateMessageInput): MessageRow {
  const now = input.now ?? Date.now();
  const content = (input.content ?? '').slice(0, CONTENT_MAX);
  const type: MessageType = input.type ?? 'default';
  if (content.trim().length === 0 && (input.uploadIds ?? []).length === 0) {
    throw new HttpError(400, 'Message cannot be empty', 'empty_message');
  }
  const channel = requireChannel(db, input.channelId);
  const id = newId(now);

  return db.tx(() => {
    const parsed = input.skipMentionScan
      ? { mentions: [], mentionEveryone: false, mentionHere: false }
      : parseMentions(db, content, channel.guild_id);

    db.run(
      `INSERT INTO messages (id, channel_id, author_id, content, type, created_at, edited_at, pinned, reference_id, mention_everyone)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
      [
        id,
        input.channelId,
        input.authorId,
        content,
        type,
        now,
        input.referenceId ?? null,
        parsed.mentionEveryone ? 1 : 0,
      ],
    );

    for (const userId of parsed.mentions) {
      db.run('INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?, ?)', [id, userId]);
    }
    if (parsed.mentionEveryone && channel.guild_id) {
      const members = db.all<{ user_id: string }>('SELECT user_id FROM guild_members WHERE guild_id = ?', [
        channel.guild_id,
      ]);
      for (const member of members) {
        db.run('INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?, ?)', [id, member.user_id]);
      }
    }

    for (const uploadId of input.uploadIds ?? []) {
      const upload = getUpload(db, uploadId);
      if (!upload) continue;
      db.run(
        `INSERT INTO attachments (id, message_id, upload_id, channel_id, filename, content_type, size, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        [newId(now), id, uploadId, input.channelId, upload.filename, upload.content_type, upload.size, now],
      );
    }

    db.run('UPDATE channels SET last_message_id = ? WHERE id = ?', [id, input.channelId]);
    try {
      db.run('INSERT INTO messages_fts (content, message_id, channel_id) VALUES (?, ?, ?)', [
        content,
        id,
        input.channelId,
      ]);
    } catch {
      /* FTS is best-effort: a failure must never block sending a message */
    }
    return db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', [id])!;
  });
}

export function getMessageRow(db: Database, id: string): MessageRow | undefined {
  return db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', [id]);
}

export function requireMessage(db: Database, id: string): MessageRow {
  const row = getMessageRow(db, id);
  if (!row || row.deleted_at !== null) throw new HttpError(404, 'Message not found', 'unknown_message');
  return row;
}

export function attachmentsFor(db: Database, messageIds: string[]): Map<string, Attachment[]> {
  const map = new Map<string, Attachment[]>();
  if (messageIds.length === 0) return map;
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db.all<AttachmentRow>(
    `SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
    messageIds,
  );
  for (const row of rows) {
    const list = map.get(row.message_id ?? '') ?? [];
    list.push({
      id: row.id,
      message_id: row.message_id,
      filename: row.filename,
      content_type: row.content_type,
      size: row.size,
      width: row.width,
      height: row.height,
      url: `/api/files/${row.upload_id ?? row.id}`,
      sha256: '',
      created_at: row.created_at,
    });
    map.set(row.message_id ?? '', list);
  }
  return map;
}

export function reactionsFor(
  db: Database,
  messageIds: string[],
  viewerId: string,
  statusOf?: (id: string) => UserStatus,
): Map<string, ReactionGroup[]> {
  const map = new Map<string, ReactionGroup[]>();
  if (messageIds.length === 0) return map;
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db.all<{ message_id: string; emoji: string; user_id: string }>(
    `SELECT message_id, emoji, user_id FROM message_reactions
     WHERE message_id IN (${placeholders}) ORDER BY created_at ASC`,
    messageIds,
  );
  for (const row of rows) {
    const groups = map.get(row.message_id) ?? [];
    let group = groups.find((g) => g.emoji === row.emoji);
    if (!group) {
      group = { emoji: row.emoji, count: 0, me: false, users: [] };
      groups.push(group);
    }
    group.count += 1;
    if (row.user_id === viewerId) group.me = true;
    if (group.users.length < 50) {
      const user = getUserById(db, row.user_id);
      if (user) group.users.push(toPublicUser(user, statusOf?.(row.user_id)));
    }
    map.set(row.message_id, groups);
  }
  return map;
}

export interface SerializeContext {
  viewerId: string;
  statusOf?: (id: string) => UserStatus;
}

/** Row → wire DTO, including author, attachments, reactions and reply preview. */
export function serializeMessage(db: Database, row: MessageRow, ctx: SerializeContext): Message {
  const author = getUserById(db, row.author_id);
  const attachments = attachmentsFor(db, [row.id]).get(row.id) ?? [];
  const reactions = reactionsFor(db, [row.id], ctx.viewerId, ctx.statusOf).get(row.id) ?? [];

  let referenced: Message['referenced_message'] = null;
  if (row.reference_id) {
    const ref = getMessageRow(db, row.reference_id);
    if (ref) {
      if (ref.deleted_at !== null) {
        referenced = {
          id: ref.id,
          content: '',
          author: placeholderUser('deleted'),
          created_at: ref.created_at,
          deleted: true,
        };
      } else {
        const refAuthor = getUserById(db, ref.author_id);
        referenced = {
          id: ref.id,
          content: ref.content.slice(0, 300),
          author: refAuthor ? toPublicUser(refAuthor) : placeholderUser('unknown'),
          created_at: ref.created_at,
          deleted: false,
        };
      }
    }
  }

  return {
    id: row.id,
    channel_id: row.channel_id,
    author: author ? toPublicUser(author, ctx.statusOf?.(row.author_id)) : placeholderUser('deleted'),
    content: row.content,
    type: row.type as MessageType,
    created_at: row.created_at,
    edited_at: row.edited_at,
    pinned: row.pinned === 1,
    referenced_message: referenced,
    attachments,
    reactions,
    mentions: db
      .all<{ user_id: string }>('SELECT user_id FROM message_mentions WHERE message_id = ?', [row.id])
      .map((m) => m.user_id),
    deleted: row.deleted_at !== null,
  };
}

function placeholderUser(kind: 'deleted' | 'unknown') {
  return {
    id: '0',
    username: kind === 'deleted' ? 'deleted-user' : 'unknown',
    display_name: kind === 'deleted' ? 'Deleted User' : 'Unknown',
    avatar_url: null,
    bio: '',
    custom_status: null,
    status: 'offline' as UserStatus,
    is_bot: false,
    created_at: 0,
  };
}

export function serializeMessages(db: Database, rows: MessageRow[], ctx: SerializeContext): Message[] {
  const visible = rows.filter((row) => row.deleted_at === null);
  if (visible.length === 0) return [];
  const ids = visible.map((r) => r.id);
  const attachments = attachmentsFor(db, ids);
  const reactions = reactionsFor(db, ids, ctx.viewerId, ctx.statusOf);
  const authors = new Map<string, UserRow>();
  for (const id of new Set(visible.map((r) => r.author_id))) {
    const user = getUserById(db, id);
    if (user) authors.set(id, user);
  }
  const refRows = new Map<string, MessageRow>();
  for (const row of visible) {
    if (row.reference_id && !refRows.has(row.reference_id)) {
      const ref = getMessageRow(db, row.reference_id);
      if (ref) refRows.set(row.reference_id, ref);
    }
  }
  const refAuthors = new Map<string, UserRow>();
  for (const ref of refRows.values()) {
    if (!refAuthors.has(ref.author_id)) {
      const user = getUserById(db, ref.author_id);
      if (user) refAuthors.set(ref.author_id, user);
    }
  }
  const mentions = new Map<string, string[]>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    for (const mention of db.all<{ message_id: string; user_id: string }>(
      `SELECT message_id, user_id FROM message_mentions WHERE message_id IN (${placeholders})`,
      ids,
    )) {
      const list = mentions.get(mention.message_id) ?? [];
      list.push(mention.user_id);
      mentions.set(mention.message_id, list);
    }
  }

  return visible.map((row) => {
    const author = authors.get(row.author_id);
    let referenced: Message['referenced_message'] = null;
    if (row.reference_id) {
      const ref = refRows.get(row.reference_id);
      if (ref) {
        referenced =
          ref.deleted_at !== null
            ? { id: ref.id, content: '', author: placeholderUser('deleted'), created_at: ref.created_at, deleted: true }
            : {
                id: ref.id,
                content: ref.content.slice(0, 300),
                author: refAuthors.get(ref.author_id)
                  ? toPublicUser(refAuthors.get(ref.author_id)!)
                  : placeholderUser('unknown'),
                created_at: ref.created_at,
                deleted: false,
              };
      }
    }
    return {
      id: row.id,
      channel_id: row.channel_id,
      author: author ? toPublicUser(author, ctx.statusOf?.(row.author_id)) : placeholderUser('deleted'),
      content: row.content,
      type: row.type as MessageType,
      created_at: row.created_at,
      edited_at: row.edited_at,
      pinned: row.pinned === 1,
      referenced_message: referenced,
      attachments: attachments.get(row.id) ?? [],
      reactions: reactions.get(row.id) ?? [],
      mentions: mentions.get(row.id) ?? [],
      deleted: false,
    };
  });
}

export interface ListMessagesOptions {
  before?: string | null;
  after?: string | null;
  around?: string | null;
  limit?: number;
  includeDeleted?: boolean;
}

export function listMessages(db: Database, channelId: string, options: ListMessagesOptions = {}): MessageRow[] {
  const limit = Math.min(Math.max(1, options.limit ?? MESSAGE_LIMIT_DEFAULT), MESSAGE_LIMIT_MAX);
  const deletedClause = options.includeDeleted ? '' : 'AND deleted_at IS NULL';
  if (options.around) {
    const half = Math.floor(limit / 2);
    const newer = db.all<MessageRow>(
      `SELECT * FROM messages WHERE channel_id = ? AND id >= ? ${deletedClause} ORDER BY id ASC LIMIT ?`,
      [channelId, options.around, half],
    );
    const older = db.all<MessageRow>(
      `SELECT * FROM messages WHERE channel_id = ? AND id < ? ${deletedClause} ORDER BY id DESC LIMIT ?`,
      [channelId, options.around, limit - half],
    );
    return [...older.reverse(), ...newer];
  }
  if (options.after) {
    return db.all<MessageRow>(
      `SELECT * FROM messages WHERE channel_id = ? AND id > ? ${deletedClause} ORDER BY id ASC LIMIT ?`,
      [channelId, options.after, limit],
    );
  }
  if (options.before) {
    return db.all<MessageRow>(
      `SELECT * FROM messages WHERE channel_id = ? AND id < ? ${deletedClause} ORDER BY id DESC LIMIT ?`,
      [channelId, options.before, limit],
    );
  }
  return db.all<MessageRow>(
    `SELECT * FROM messages WHERE channel_id = ? ${deletedClause} ORDER BY id DESC LIMIT ?`,
    [channelId, limit],
  );
}

export function editMessage(db: Database, messageId: string, content: string, now = Date.now()): MessageRow {
  const row = requireMessage(db, messageId);
  const trimmed = content.slice(0, CONTENT_MAX);
  if (trimmed.trim().length === 0) throw new HttpError(400, 'Message cannot be empty', 'empty_message');
  const channel = requireChannel(db, row.channel_id);
  db.tx(() => {
    const parsed = parseMentions(db, trimmed, channel.guild_id);
    db.run('UPDATE messages SET content = ?, edited_at = ?, mention_everyone = ? WHERE id = ?', [
      trimmed,
      now,
      parsed.mentionEveryone ? 1 : 0,
      messageId,
    ]);
    db.run('DELETE FROM message_mentions WHERE message_id = ?', [messageId]);
    for (const userId of parsed.mentions) {
      db.run('INSERT OR IGNORE INTO message_mentions (message_id, user_id) VALUES (?, ?)', [messageId, userId]);
    }
    try {
      db.run('DELETE FROM messages_fts WHERE message_id = ?', [messageId]);
      db.run('INSERT INTO messages_fts (content, message_id, channel_id) VALUES (?, ?, ?)', [
        trimmed,
        messageId,
        row.channel_id,
      ]);
    } catch {
      /* ignore FTS errors */
    }
  });
  return getMessageRow(db, messageId)!;
}

export function deleteMessage(db: Database, messageId: string, now = Date.now()): MessageRow {
  const row = requireMessage(db, messageId);
  // Soft delete keeps reply previews intact ("message deleted").
  db.run('UPDATE messages SET deleted_at = ?, content = ? WHERE id = ?', [now, '', messageId]);
  db.run('DELETE FROM messages_fts WHERE message_id = ?', [messageId]);
  db.run('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);
  return row;
}

export function deleteMessagesBulk(db: Database, ids: string[], now = Date.now()): { channel_id: string; ids: string[] } {
  if (ids.length === 0) throw new HttpError(400, 'No messages supplied', 'no_messages');
  const first = getMessageRow(db, ids[0]);
  if (!first) throw new HttpError(404, 'Message not found', 'unknown_message');
  db.tx(() => {
    for (const id of ids) {
      const row = getMessageRow(db, id);
      if (!row || row.channel_id !== first.channel_id || row.deleted_at !== null) continue;
      deleteMessage(db, id, now);
    }
  });
  return { channel_id: first.channel_id, ids };
}

export function setPinned(db: Database, messageId: string, pinned: boolean): MessageRow {
  requireMessage(db, messageId);
  db.run('UPDATE messages SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, messageId]);
  return getMessageRow(db, messageId)!;
}

export function listPinned(db: Database, channelId: string): MessageRow[] {
  return db.all<MessageRow>(
    'SELECT * FROM messages WHERE channel_id = ? AND pinned = 1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 50',
    [channelId],
  );
}

/* -------------------------------------------------------------------------- */
/* Reactions                                                                  */
/* -------------------------------------------------------------------------- */

export const REACTION_MAX_LENGTH = 32;

export function addReaction(db: Database, messageId: string, userId: string, emoji: string, now = Date.now()): void {
  requireMessage(db, messageId);
  const value = emoji.trim();
  if (value.length === 0 || value.length > REACTION_MAX_LENGTH) {
    throw new HttpError(400, 'Invalid emoji', 'invalid_emoji');
  }
  const existing = db.get<{ c: number }>(
    'SELECT COUNT(*) AS c FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    [messageId, userId, value],
  );
  if (Number(existing?.c ?? 0) === 0) {
    db.run('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', [
      messageId,
      userId,
      value,
      now,
    ]);
  }
}

export function removeReaction(db: Database, messageId: string, userId: string, emoji: string): void {
  db.run('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [
    messageId,
    userId,
    emoji,
  ]);
}

export function clearReactions(db: Database, messageId: string, emoji?: string): void {
  if (emoji) db.run('DELETE FROM message_reactions WHERE message_id = ? AND emoji = ?', [messageId, emoji]);
  else db.run('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);
}

/* -------------------------------------------------------------------------- */
/* Read state & unread counts                                                 */
/* -------------------------------------------------------------------------- */

export interface ReadStateRow {
  user_id: string;
  channel_id: string;
  last_read_message_id: string | null;
  mention_count: number;
  last_read_at: number;
}

export function getReadState(db: Database, userId: string, channelId: string): ReadStateRow | undefined {
  return db.get<ReadStateRow>('SELECT * FROM read_states WHERE user_id = ? AND channel_id = ?', [userId, channelId]);
}

export function setReadState(
  db: Database,
  userId: string,
  channelId: string,
  lastReadMessageId: string | null,
  now = Date.now(),
): ReadStateRow {
  const existing = getReadState(db, userId, channelId);
  const messageId = lastReadMessageId ?? existing?.last_read_message_id ?? null;
  db.run(
    `INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count, last_read_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id, channel_id)
     DO UPDATE SET last_read_message_id = excluded.last_read_message_id, mention_count = 0, last_read_at = excluded.last_read_at`,
    [userId, channelId, messageId, now],
  );
  return getReadState(db, userId, channelId)!;
}

export function bumpMentions(db: Database, userId: string, channelId: string, count = 1, now = Date.now()): void {
  db.run(
    `INSERT INTO read_states (user_id, channel_id, last_read_message_id, mention_count, last_read_at)
     VALUES (?, ?, NULL, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET mention_count = mention_count + ?`,
    [userId, channelId, count, now, count],
  );
}

export interface UnreadInfo {
  channel_id: string;
  unread_count: number;
  mention_count: number;
  last_message_id: string | null;
}

/** Newest message id in a channel, or null. */
export function lastMessageId(db: Database, channelId: string): string | null {
  const row = db.get<{ id: string }>(
    'SELECT id FROM messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
    [channelId],
  );
  return row?.id ?? null;
}

export function unreadFor(db: Database, userId: string, channelIds: string[]): UnreadInfo[] {
  const out: UnreadInfo[] = [];
  for (const channelId of channelIds) {
    const state = getReadState(db, userId, channelId);
    const params: (string | number)[] = [channelId];
    let query = 'SELECT COUNT(*) AS c FROM messages WHERE channel_id = ? AND deleted_at IS NULL AND author_id <> ?';
    params.push(userId);
    if (state?.last_read_message_id) {
      query += ' AND id > ?';
      params.push(state.last_read_message_id);
    }
    const row = db.get<{ c: number }>(query, params);
    const last = lastMessageId(db, channelId);
    const unread = Number(row?.c ?? 0);
    // Auto-clear the badge when the newest message is the one we already read.
    const cleared = state?.last_read_message_id && state.last_read_message_id === last;
    out.push({
      channel_id: channelId,
      unread_count: cleared ? 0 : unread,
      mention_count: cleared ? 0 : Number(state?.mention_count ?? 0),
      last_message_id: last,
    });
  }
  return out;
}

export function totalMentions(db: Database, userId: string, channelIds: string[]): number {
  return unreadFor(db, userId, channelIds).reduce((sum, entry) => sum + entry.mention_count, 0);
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export interface SearchOptions {
  query: string;
  userId: string;
  guildId?: string | null;
  channelId?: string | null;
  authorId?: string | null;
  pinnedOnly?: boolean;
  limit?: number;
}

const FTS_SPECIAL = /["'*^:()\[\]{}~\\-]/g;

function escapeFtsQuery(query: string): string {
  const tokens = query
    .replace(FTS_SPECIAL, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `"${token}"*`);
  return tokens.join(' AND ');
}

export function searchMessages(db: Database, options: SearchOptions): SearchHit[] {
  const limit = Math.min(Math.max(1, options.limit ?? 25), 100);
  const query = options.query.trim();
  if (query.length === 0) return [];
  const ftsQuery = escapeFtsQuery(query);
  if (ftsQuery.length === 0) return [];

  let rows: { message_id: string }[] = [];
  try {
    rows = db.all<{ message_id: string }>(
      `SELECT message_id FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`,
      [ftsQuery, limit * 4],
    );
  } catch {
    rows = [];
  }

  const ids = rows.map((r) => r.message_id);
  if (ids.length === 0) {
    // Fallback: substring search (covers CJK / punctuation-only queries).
    const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const fallback = db.all<MessageRow>(
      `SELECT * FROM messages WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`,
      [like, limit * 4],
    );
    return hydrateHits(db, fallback, options, limit);
  }

  const placeholders = ids.map(() => '?').join(',');
  const messageRows = db.all<MessageRow>(
    `SELECT * FROM messages WHERE id IN (${placeholders}) AND deleted_at IS NULL ORDER BY id DESC LIMIT ?`,
    [...ids, limit * 4],
  );
  return hydrateHits(db, messageRows, options, limit);
}

function hydrateHits(db: Database, rows: MessageRow[], options: SearchOptions, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const channelCache = new Map<string, { id: string; name: string; type: string; guild_id: string | null }>();
  const guildCache = new Map<string, string>();
  for (const row of rows) {
    if (hits.length >= limit) break;
    const channel =
      channelCache.get(row.channel_id) ??
      (() => {
        const value = db.get<{ id: string; name: string; type: string; guild_id: string | null }>(
          'SELECT id, name, type, guild_id FROM channels WHERE id = ?',
          [row.channel_id],
        );
        if (!value) return null;
        channelCache.set(row.channel_id, value);
        return value;
      })();
    if (!channel) continue;
    if (options.channelId && row.channel_id !== options.channelId) continue;
    if (options.guildId && channel.guild_id !== options.guildId) continue;
    if (options.authorId && row.author_id !== options.authorId) continue;
    if (options.pinnedOnly && row.pinned !== 1) continue;
    // Only surface messages from channels the viewer can see.
    if (channel.guild_id) {
      const member = db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [channel.guild_id, options.userId],
      );
      if (Number(member?.c ?? 0) === 0) continue;
    } else {
      const participant = db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM dm_recipients WHERE channel_id = ? AND user_id = ?',
        [row.channel_id, options.userId],
      );
      if (Number(participant?.c ?? 0) === 0) continue;
    }

    let guildName: string | null = null;
    if (channel.guild_id) {
      guildName =
        guildCache.get(channel.guild_id) ??
        (() => {
          const guild = db.get<{ name: string }>('SELECT name FROM guilds WHERE id = ?', [channel.guild_id]);
          const name = guild?.name ?? null;
          if (name) guildCache.set(channel.guild_id!, name);
          return name;
        })();
    }

    hits.push({
      message: serializeMessage(db, row, { viewerId: options.userId }),
      channel: { id: channel.id, name: channel.name, type: channel.type as SearchHit['channel']['type'], guild_id: channel.guild_id },
      guild_name: guildName,
      snippet: buildSnippet(row.content, options.query),
    });
  }
  return hits;
}

export function buildSnippet(content: string, query: string, radius = 60): string {
  const lower = content.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index === -1) return content.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(content.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}
