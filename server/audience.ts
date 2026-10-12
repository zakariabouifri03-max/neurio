/**
 * Audience resolution — "who should receive this event?".
 * Shared by the REST layer (fan-out after writes) and the gateway.
 */
import type { Database } from './db';

/** Everyone who can see a channel: guild members, or DM participants. */
export function channelAudience(db: Database, channelId: string): Set<string> {
  const channel = db.get<{ id: string; guild_id: string | null }>(
    'SELECT id, guild_id FROM channels WHERE id = ?',
    [channelId],
  );
  if (!channel) return new Set();
  if (channel.guild_id) {
    return new Set(
      db
        .all<{ user_id: string }>('SELECT user_id FROM guild_members WHERE guild_id = ?', [channel.guild_id])
        .map((row) => row.user_id),
    );
  }
  return new Set(
    db
      .all<{ user_id: string }>('SELECT user_id FROM dm_recipients WHERE channel_id = ?', [channelId])
      .map((row) => row.user_id),
  );
}

/** Same as {@link channelAudience} but as an array. */
export function getChannelMemberIds(db: Database, channelId: string): Set<string> {
  return channelAudience(db, channelId);
}

export function guildAudience(db: Database, guildId: string): Set<string> {
  return new Set(
    db.all<{ user_id: string }>('SELECT user_id FROM guild_members WHERE guild_id = ?', [guildId]).map((row) => row.user_id),
  );
}
