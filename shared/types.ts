/**
 * Neurio — shared domain types.
 *
 * These types are used by the local Node server, the Electron main process and
 * the React renderer. Everything here is plain JSON-serialisable data.
 */

export type Snowflake = string;

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface PublicUser {
  id: Snowflake;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  custom_status: string | null;
  status: UserStatus;
  is_bot: boolean;
  created_at: number;
}

export interface RelationshipEntry {
  id: Snowflake;
  type: 'friend' | 'incoming' | 'outgoing' | 'blocked';
  user: PublicUser;
  since: number;
}

export type ChannelType = 'text' | 'voice' | 'category' | 'dm' | 'group_dm';

export interface Channel {
  id: Snowflake;
  guild_id: Snowflake | null;
  name: string;
  type: ChannelType;
  topic: string | null;
  position: number;
  parent_id: Snowflake | null;
  slowmode_seconds: number;
  nsfw: boolean;
  created_at: number;
  /** Only present for DM channels */
  recipients?: PublicUser[];
  /** Message id of the latest message (derived, may be null) */
  last_message_id?: Snowflake | null;
}

export interface PermissionOverwrite {
  channel_id: Snowflake;
  target_id: Snowflake;
  target_type: 'role' | 'member';
  allow: number;
  deny: number;
}

export interface Role {
  id: Snowflake;
  guild_id: Snowflake;
  name: string;
  color: number;
  permissions: number;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  /** The @everyone role cannot be deleted and always sits at position 0 */
  is_default: boolean;
}

export interface GuildMember {
  guild_id: Snowflake;
  user: PublicUser;
  nickname: string | null;
  role_ids: Snowflake[];
  joined_at: number;
}

export interface Guild {
  id: Snowflake;
  name: string;
  owner_id: Snowflake;
  icon_url: string | null;
  description: string;
  created_at: number;
  /** Populated for the guilds the client is a member of */
  channels?: Channel[];
  members?: GuildMember[];
  roles?: Role[];
  member_count?: number;
}

export interface Invite {
  code: string;
  guild_id: Snowflake;
  channel_id: Snowflake;
  inviter: PublicUser | null;
  guild?: Pick<Guild, 'id' | 'name' | 'icon_url'> & { member_count?: number };
  uses: number;
  max_uses: number;
  created_at: number;
  expires_at: number | null;
}

export type MessageType = 'default' | 'system' | 'call';

export interface Attachment {
  id: Snowflake;
  message_id: Snowflake | null;
  filename: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  sha256: string;
  created_at: number;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  me: boolean;
  users: PublicUser[];
}

export interface Message {
  id: Snowflake;
  channel_id: Snowflake;
  author: PublicUser;
  content: string;
  type: MessageType;
  created_at: number;
  edited_at: number | null;
  pinned: boolean;
  /** id + short preview of the message this one replies to */
  referenced_message: Pick<Message, 'id' | 'content' | 'author' | 'created_at' | 'deleted'> | null;
  attachments: Attachment[];
  reactions: ReactionGroup[];
  mentions: Snowflake[];
  deleted: boolean;
}

export interface ReadState {
  channel_id: Snowflake;
  last_read_message_id: Snowflake | null;
  mention_count: number;
  last_read_at: number;
}

export interface VoiceState {
  channel_id: Snowflake;
  guild_id: Snowflake | null;
  user_id: Snowflake;
  session_id: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
  /** server mute/deaf by a moderator */
  mute: boolean;
  deaf: boolean;
  joined_at: number;
}

export type SessionKind = 'desktop' | 'web' | 'test';

export interface SessionInfo {
  id: Snowflake;
  created_at: number;
  last_seen_at: number;
  device_label: string;
  kind: SessionKind;
  current: boolean;
}

export interface AuthResult {
  token: string;
  session: SessionInfo;
  user: PublicUser;
}

export interface ServerConfig {
  name: string;
  version: string;
  /** WebRTC ICE servers handed to clients. Empty by default (LAN only). */
  ice_servers: IceServerConfig[];
  /** true when the server was started in a mode that never talks to the internet */
  offline_mode: boolean;
  max_upload_bytes: number;
  registration_open: boolean;
  voice: {
    /** Mesh voice is P2P: this is the recommended maximum peers per voice channel */
    recommended_max_mesh_peers: number;
  };
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface CallRecord {
  channel_id: Snowflake;
  guild_id: Snowflake | null;
  started_at: number;
  ended_at: number | null;
  participants: PublicUser[];
}

export interface SearchHit {
  message: Message;
  channel: Pick<Channel, 'id' | 'name' | 'type' | 'guild_id'>;
  guild_name: string | null;
  snippet: string;
}
