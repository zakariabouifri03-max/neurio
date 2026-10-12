/** Row → DTO mapping. Keeps the wire format in one place. */
import type {
  Channel,
  ChannelType,
  Guild,
  GuildMember,
  PublicUser,
  Role,
  UserStatus,
} from '../shared/types';
import type { RoleRow } from './permissions';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_id: string | null;
  bio: string;
  custom_status: string | null;
  status: string;
  is_bot: number;
  created_at: number;
}

export const fileUrl = (id: string | null | undefined): string | null =>
  id ? `/api/files/${id}` : null;

export function toPublicUser(row: UserRow, status?: UserStatus): PublicUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: fileUrl(row.avatar_id),
    bio: row.bio ?? '',
    custom_status: row.custom_status ?? null,
    status: status ?? (row.status as UserStatus),
    is_bot: row.is_bot === 1,
    created_at: row.created_at,
  };
}

export interface ChannelRow {
  id: string;
  guild_id: string | null;
  name: string;
  type: string;
  topic: string | null;
  position: number;
  parent_id: string | null;
  slowmode_seconds: number;
  nsfw: number;
  created_at: number;
  last_message_id: string | null;
}

export function toChannel(row: ChannelRow, recipients?: PublicUser[]): Channel {
  const channel: Channel = {
    id: row.id,
    guild_id: row.guild_id,
    name: row.name,
    type: row.type as ChannelType,
    topic: row.topic,
    position: row.position,
    parent_id: row.parent_id,
    slowmode_seconds: row.slowmode_seconds,
    nsfw: row.nsfw === 1,
    created_at: row.created_at,
    last_message_id: row.last_message_id ?? null,
  };
  if (recipients) channel.recipients = recipients;
  return channel;
}

export function toGuild(row: {
  id: string;
  name: string;
  owner_id: string;
  icon_id: string | null;
  description: string;
  created_at: number;
}): Guild {
  return {
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    icon_url: fileUrl(row.icon_id),
    description: row.description ?? '',
    created_at: row.created_at,
  };
}

export function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    guild_id: row.guild_id,
    name: row.name,
    color: row.color,
    permissions: row.permissions >>> 0,
    position: row.position,
    hoist: row.hoist === 1,
    mentionable: row.mentionable === 1,
    is_default: row.is_default === 1,
  };
}

export function toGuildMember(row: {
  guild_id: string;
  nickname: string | null;
  joined_at: number;
  user: UserRow;
  role_ids?: string[];
}, status?: UserStatus): GuildMember {
  return {
    guild_id: row.guild_id,
    user: toPublicUser(row.user, status),
    nickname: row.nickname,
    role_ids: row.role_ids ?? [],
    joined_at: row.joined_at,
  };
}
