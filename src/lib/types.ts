/** Renderer-facing type re-exports (keeps imports tidy across the app). */
export type {
  Attachment,
  AuthResult,
  CallRecord,
  Channel,
  ChannelType,
  Guild,
  GuildMember,
  IceServerConfig,
  Invite,
  Message,
  MessageType,
  PermissionOverwrite,
  PublicUser,
  ReactionGroup,
  ReadState,
  RelationshipEntry,
  Role,
  SearchHit,
  ServerConfig,
  SessionInfo,
  UserStatus,
  VoiceState,
} from '../../shared/types';

export type {
  ClientIdentify,
  ClientOp,
  Dispatch,
  DispatchEvent,
  GatewayHello,
  GatewayIncoming,
  PresenceUpdatePayload,
  RTCIceCandidateInitLike,
  ReadStatePayload,
  SignalPayload,
  TypingStartPayload,
  VoiceSignalPayload,
  VoiceSpeakingPayload,
} from '../../shared/protocol';

export type { PermissionKey } from '../../shared/permissions';

export interface UnreadInfoLike {
  channel_id: string;
  unread_count: number;
  mention_count: number;
  last_message_id: string | null;
}

export interface VoiceStateUpdatePayload {
  channel_id: string;
  user_id?: string;
  state: import('../../shared/types').VoiceState | null;
  states?: import('../../shared/types').VoiceState[];
}

export interface MessageDeletePayload {
  channel_id: string;
  message_id: string;
}

export interface MessageDeleteBulkPayload {
  channel_id: string;
  ids: string[];
}

export interface UserUpdatePayload {
  user: import('../../shared/types').PublicUser;
}

export interface ChannelUpdatePayload {
  channel: import('../../shared/types').Channel & { removed?: boolean };
}

export interface GuildUpdatePayload {
  guild: import('../../shared/types').Guild;
}

export interface FriendRequestPayload {
  user: import('../../shared/types').PublicUser;
  relationship?: string;
  from?: import('../../shared/types').PublicUser;
  accepted?: boolean;
}

export interface FriendRemovePayload {
  user_id: string;
  accepted?: boolean;
}

export interface SessionRevokedPayload {
  reason?: string;
}
