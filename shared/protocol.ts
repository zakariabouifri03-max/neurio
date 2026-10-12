/**
 * Neurio — gateway (WebSocket) protocol.
 *
 * The WebSocket gateway carries *everything that must be pushed in real time*:
 * messages, presence, typing indicators, voice state and WebRTC signalling.
 * Bulk reads/writes go through the REST API (see shared/rest.ts).
 *
 * Payload shape (both directions):
 *   { op: string, d?: unknown, s?: number, t?: string }
 *     op  — operation name
 *     d   — data
 *     s   — sequence number (server → client only)
 *     t   — dispatch event name (server → client only)
 */

import type { PublicUser, UserStatus } from './types';

export const GATEWAY_PROTOCOL_VERSION = 1;

export interface ClientIdentify {
  token: string;
  protocol_version: number;
  client: {
    kind: 'electron' | 'web' | 'test';
    name: string;
    version: string;
  };
}

export interface GatewaySession {
  session_id: string;
  user: PublicUser;
  heartbeat_interval_ms: number;
  guilds: string[];
}

export type ClientOp =
  | { op: 'identify'; d: ClientIdentify }
  | { op: 'heartbeat'; d: { seq: number | null } }
  | { op: 'typing'; d: { channel_id: string } }
  | { op: 'presence.update'; d: { status: UserStatus; custom_status?: string | null } }
  | {
      op: 'voice.join';
      d: {
        channel_id: string;
        self_mute: boolean;
        self_deaf: boolean;
        self_video: boolean;
        self_stream: boolean;
      };
    }
  | { op: 'voice.leave'; d: { channel_id: string } }
  | {
      op: 'voice.state';
      d: {
        channel_id: string;
        self_mute?: boolean;
        self_deaf?: boolean;
        self_video?: boolean;
        self_stream?: boolean;
      };
    }
  | {
      /** WebRTC SDP / ICE relay — opaque to the server. */
      op: 'voice.signal';
      d: {
        channel_id: string;
        /** target peer, or null to broadcast to the whole channel */
        target_user_id: string | null;
        payload: SignalPayload;
      };
    }
  | { op: 'voice.speaking'; d: { channel_id: string; speaking: boolean } }
  | { op: 'subscribe'; d: { channel_ids: string[] } };

export type SignalPayload =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInitLike | null }
  | { type: 'renegotiate' }
  | { type: 'stream-state'; video: boolean; screen: boolean; audio: boolean }
  | { type: 'bye'; reason?: string };

/** Structural clone of RTCIceCandidateInit so the server can stay DOM-free. */
export interface RTCIceCandidateInitLike {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type ServerOp = 'hello' | 'dispatch' | 'heartbeat_ack' | 'invalid_session' | 'error';

export interface GatewayHello {
  heartbeat_interval_ms: number;
  protocol_version: number;
  server: { name: string; version: string };
}

/** Payload of the READY dispatch. */
export interface GatewayReady {
  session_id: string;
  user: PublicUser;
  guilds: string[];
  /** Every DM channel the user takes part in, with recipients resolved. */
  dm_channel_ids: string[];
  resume_gateway_url: string | null;
}

export type DispatchEvent =
  | 'READY'
  | 'MESSAGE_CREATE'
  | 'MESSAGE_UPDATE'
  | 'MESSAGE_DELETE'
  | 'MESSAGE_DELETE_BULK'
  | 'TYPING_START'
  | 'PRESENCE_UPDATE'
  | 'USER_UPDATE'
  | 'READ_STATE_UPDATE'
  | 'FRIEND_REQUEST_CREATE'
  | 'FRIEND_REQUEST_REMOVE'
  | 'GUILD_CREATE'
  | 'GUILD_UPDATE'
  | 'GUILD_DELETE'
  | 'CHANNEL_CREATE'
  | 'CHANNEL_UPDATE'
  | 'CHANNEL_DELETE'
  | 'GUILD_MEMBER_ADD'
  | 'GUILD_MEMBER_UPDATE'
  | 'GUILD_MEMBER_REMOVE'
  | 'GUILD_ROLE_CREATE'
  | 'GUILD_ROLE_UPDATE'
  | 'GUILD_ROLE_DELETE'
  | 'VOICE_STATE_UPDATE'
  | 'VOICE_SIGNAL'
  | 'VOICE_SPEAKING'
  | 'SESSION_REVOKED';

export interface Dispatch<P = unknown> {
  op: 'dispatch';
  t: DispatchEvent;
  s: number;
  d: P;
}

export interface GatewayError {
  op: 'error';
  d: { code: string; message: string; fatal?: boolean };
}

export interface GatewayInvalidSession {
  op: 'invalid_session';
  d: { resumable: boolean; message?: string };
}

/** Event payloads ---------------------------------------------------------- */

export interface TypingStartPayload {
  channel_id: string;
  user_id: string;
  display_name: string;
  expires_at: number;
}

export interface PresenceUpdatePayload {
  user_id: string;
  status: UserStatus;
  custom_status: string | null;
  /** present while the user sits in a voice channel */
  voice_channel_id?: string | null;
}

export interface ReadStatePayload {
  channel_id: string;
  last_read_message_id: string | null;
  mention_count: number;
}

export interface VoiceSignalPayload {
  channel_id: string;
  from_user_id: string;
  payload: SignalPayload;
}

export interface VoiceSpeakingPayload {
  channel_id: string;
  user_id: string;
  speaking: boolean;
}

export type GatewayIncoming =
  | { op: 'hello'; d: GatewayHello }
  | Dispatch
  | { op: 'heartbeat_ack'; d: { seq: number | null } }
  | GatewayError
  | GatewayInvalidSession;

export const DISPATCH_EVENTS: readonly DispatchEvent[] = [
  'READY',
  'MESSAGE_CREATE',
  'MESSAGE_UPDATE',
  'MESSAGE_DELETE',
  'MESSAGE_DELETE_BULK',
  'TYPING_START',
  'PRESENCE_UPDATE',
  'USER_UPDATE',
  'READ_STATE_UPDATE',
  'FRIEND_REQUEST_CREATE',
  'FRIEND_REQUEST_REMOVE',
  'GUILD_CREATE',
  'GUILD_UPDATE',
  'GUILD_DELETE',
  'CHANNEL_CREATE',
  'CHANNEL_UPDATE',
  'CHANNEL_DELETE',
  'GUILD_MEMBER_ADD',
  'GUILD_MEMBER_UPDATE',
  'GUILD_MEMBER_REMOVE',
  'GUILD_ROLE_CREATE',
  'GUILD_ROLE_UPDATE',
  'GUILD_ROLE_DELETE',
  'VOICE_STATE_UPDATE',
  'VOICE_SIGNAL',
  'VOICE_SPEAKING',
  'SESSION_REVOKED',
];
