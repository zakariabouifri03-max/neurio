/** Voice channel state and call history. */
import type { Database } from '../db';
import { newId } from '../ids';
import type { VoiceState } from '../../shared/types';

export interface VoiceStateRow {
  user_id: string;
  channel_id: string;
  guild_id: string | null;
  session_id: string;
  self_mute: number;
  self_deaf: number;
  self_video: number;
  self_stream: number;
  mute: number;
  deaf: number;
  joined_at: number;
}

export function toVoiceState(row: VoiceStateRow): VoiceState {
  return {
    channel_id: row.channel_id,
    guild_id: row.guild_id,
    user_id: row.user_id,
    session_id: row.session_id,
    self_mute: row.self_mute === 1,
    self_deaf: row.self_deaf === 1,
    self_video: row.self_video === 1,
    self_stream: row.self_stream === 1,
    mute: row.mute === 1,
    deaf: row.deaf === 1,
    joined_at: row.joined_at,
  };
}

export interface JoinVoiceInput {
  userId: string;
  channelId: string;
  guildId: string | null;
  sessionId: string;
  selfMute?: boolean;
  selfDeaf?: boolean;
  selfVideo?: boolean;
  selfStream?: boolean;
}

export function joinVoice(db: Database, input: JoinVoiceInput, now = Date.now()): VoiceStateRow {
  const previous = getVoiceState(db, input.userId);
  return db.tx(() => {
    db.run(
      `INSERT INTO voice_states (user_id, channel_id, guild_id, session_id, self_mute, self_deaf, self_video, self_stream, mute, deaf, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         channel_id = excluded.channel_id,
         guild_id = excluded.guild_id,
         session_id = excluded.session_id,
         self_mute = excluded.self_mute,
         self_deaf = excluded.self_deaf,
         self_video = excluded.self_video,
         self_stream = excluded.self_stream,
         joined_at = CASE WHEN voice_states.channel_id = excluded.channel_id THEN voice_states.joined_at ELSE excluded.joined_at END`,
      [
        input.userId,
        input.channelId,
        input.guildId,
        input.sessionId,
        input.selfMute ? 1 : 0,
        input.selfDeaf ? 1 : 0,
        input.selfVideo ? 1 : 0,
        input.selfStream ? 1 : 0,
        now,
      ],
    );
    if (previous && previous.channel_id !== input.channelId) {
      closeCallParticipation(db, previous.channel_id, input.userId, now);
      endCallIfEmpty(db, previous.channel_id, now);
    }
    const call = ensureCall(db, input.channelId, input.guildId, input.userId, now);
    const participant = db.get<{ user_id: string }>(
      'SELECT user_id FROM call_participants WHERE call_id = ? AND user_id = ?',
      [call.id, input.userId],
    );
    if (participant) {
      db.run('UPDATE call_participants SET left_at = NULL WHERE call_id = ? AND user_id = ?', [call.id, input.userId]);
    } else {
      db.run('INSERT INTO call_participants (call_id, user_id, joined_at, left_at) VALUES (?, ?, ?, NULL)', [
        call.id,
        input.userId,
        now,
      ]);
    }
    return getVoiceState(db, input.userId)!;
  });
}

export function updateVoiceState(
  db: Database,
  userId: string,
  patch: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean; self_stream?: boolean },
): VoiceStateRow | undefined {
  const row = getVoiceState(db, userId);
  if (!row) return undefined;
  const sets: string[] = [];
  const params: number[] = [];
  if (patch.self_mute !== undefined) {
    sets.push('self_mute = ?');
    params.push(patch.self_mute ? 1 : 0);
  }
  if (patch.self_video !== undefined) {
    sets.push('self_video = ?');
    params.push(patch.self_video ? 1 : 0);
  }
  if (patch.self_stream !== undefined) {
    sets.push('self_stream = ?');
    params.push(patch.self_stream ? 1 : 0);
  }
  if (patch.self_deaf !== undefined) {
    sets.push('self_deaf = ?');
    params.push(patch.self_deaf ? 1 : 0);
    // Deafening yourself also mutes your microphone (Discord semantics).
    if (patch.self_deaf) {
      sets.push('self_mute = ?');
      params.push(1);
    }
  }
  if (sets.length === 0) return row;
  db.run(`UPDATE voice_states SET ${sets.join(', ')} WHERE user_id = ?`, [...params, userId]);
  return getVoiceState(db, userId);
}

export function getVoiceState(db: Database, userId: string): VoiceStateRow | undefined {
  return db.get<VoiceStateRow>('SELECT * FROM voice_states WHERE user_id = ?', [userId]);
}

export function listChannelVoiceStates(db: Database, channelId: string): VoiceStateRow[] {
  return db.all<VoiceStateRow>('SELECT * FROM voice_states WHERE channel_id = ? ORDER BY joined_at ASC', [
    channelId,
  ]);
}

export function listUserVoiceStates(db: Database, userIds: string[]): VoiceStateRow[] {
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(',');
  return db.all<VoiceStateRow>(`SELECT * FROM voice_states WHERE user_id IN (${placeholders})`, userIds);
}

export function leaveVoice(db: Database, userId: string, now = Date.now()): VoiceStateRow | undefined {
  const row = getVoiceState(db, userId);
  if (!row) return undefined;
  db.tx(() => {
    db.run('DELETE FROM voice_states WHERE user_id = ?', [userId]);
    closeCallParticipation(db, row.channel_id, userId, now);
    endCallIfEmpty(db, row.channel_id, now);
  });
  return row;
}

export interface CallRow {
  id: string;
  channel_id: string;
  guild_id: string | null;
  started_at: number;
  ended_at: number | null;
  started_by: string;
}

export function ensureCall(
  db: Database,
  channelId: string,
  guildId: string | null,
  startedBy: string,
  now = Date.now(),
): CallRow {
  const open = db.get<CallRow>(
    'SELECT * FROM calls WHERE channel_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [channelId],
  );
  if (open) return open;
  const id = newId(now);
  db.run('INSERT INTO calls (id, channel_id, guild_id, started_at, ended_at, started_by) VALUES (?, ?, ?, ?, NULL, ?)', [
    id,
    channelId,
    guildId,
    now,
    startedBy,
  ]);
  return db.get<CallRow>('SELECT * FROM calls WHERE id = ?', [id])!;
}

function closeCallParticipation(db: Database, channelId: string, userId: string, now: number): void {
  const call = db.get<CallRow>(
    'SELECT * FROM calls WHERE channel_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    [channelId],
  );
  if (!call) return;
  db.run('UPDATE call_participants SET left_at = ? WHERE call_id = ? AND user_id = ? AND left_at IS NULL', [
    now,
    call.id,
    userId,
  ]);
}

export function endCallIfEmpty(db: Database, channelId: string, now = Date.now()): void {
  const remaining = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM voice_states WHERE channel_id = ?', [channelId]);
  if (Number(remaining?.c ?? 0) > 0) return;
  db.run('UPDATE calls SET ended_at = ? WHERE channel_id = ? AND ended_at IS NULL', [now, channelId]);
}

export function callHistory(db: Database, channelId: string, limit = 20): CallRow[] {
  return db.all<CallRow>('SELECT * FROM calls WHERE channel_id = ? ORDER BY started_at DESC LIMIT ?', [
    channelId,
    limit,
  ]);
}

export function clearVoiceForSession(db: Database, sessionId: string, now = Date.now()): VoiceStateRow[] {
  const rows = db.all<VoiceStateRow>('SELECT * FROM voice_states WHERE session_id = ?', [sessionId]);
  for (const row of rows) leaveVoice(db, row.user_id, now);
  return rows;
}
