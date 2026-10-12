/**
 * Gateway — real-time WebSocket layer.
 *
 * Responsibilities: authenticate sockets, heartbeat, fan out dispatches
 * (messages, presence, typing, voice state) to exactly the right audience, and
 * relay WebRTC signalling payloads between peers.
 *
 * The server itself never inspects SDP/ICE: voice and video are peer-to-peer
 * (WebRTC mesh). For two machines on different networks a STUN/TURN server is
 * required — see docs/NETWORKING.md.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Database } from './db';
import { logger } from './logger';
import { PresenceManager } from './presence';
import { sessionFromToken, getUserById } from './store/users';
import { requireChannel, listDmChannels, guildIdsForUser, guildMemberIds } from './store/guilds';
import {
  joinVoice,
  leaveVoice,
  updateVoiceState,
  getVoiceState,
  toVoiceState,
  listChannelVoiceStates,
  listUserVoiceStates,
} from './store/voice';
import { toPublicUser } from './serialize';
import type { Dispatch, DispatchEvent, ClientOp, SignalPayload, TypingStartPayload, PresenceUpdatePayload, VoiceSignalPayload, VoiceSpeakingPayload } from '../shared/protocol';
import { GATEWAY_PROTOCOL_VERSION } from '../shared/protocol';
import type { UserStatus, VoiceState } from '../shared/types';

const log = logger('gateway');

export interface GatewayDeps {
  db: Database;
  presence: PresenceManager;
  serverName: string;
  serverVersion: string;
  /** called when a socket identifies: returns the guild + DM ids for READY */
  buildReady: (userId: string) => { guilds: string[]; dmChannelIds: string[] };
  onSessionClosed?: (userId: string, sessionId: string) => void;
}

interface Client {
  connectionId: string;
  socket: WebSocket;
  userId: string;
  sessionId: string;
  seq: number;
  identified: boolean;
  alive: boolean;
  voiceChannelId: string | null;
  typingTokens: Map<string, number>;
  createdAt: number;
}

const HEARTBEAT_INTERVAL = 30_000;
const MESSAGE_LIMIT_BYTES = 1 << 20; // 1 MiB per gateway frame
const TYPING_COOLDOWN_MS = 2_500;

/** Very small token bucket used to keep noisy clients from flooding peers. */
class TokenBucket {
  #tokens: number;
  #last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.#tokens = capacity;
    this.#last = Date.now();
  }
  take(cost = 1): boolean {
    const now = Date.now();
    const elapsed = (now - this.#last) / 1000;
    this.#last = now;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsed * this.refillPerSecond);
    if (this.#tokens < cost) return false;
    this.#tokens -= cost;
    return true;
  }
}

export class Gateway {
  #deps: GatewayDeps;
  #clients = new Set<Client>();
  #byUser = new Map<string, Set<Client>>();
  #heartbeat: NodeJS.Timeout | null = null;
  #limiter: TokenBucket;
  #closed = false;

  constructor(deps: GatewayDeps) {
    this.#deps = deps;
    this.#limiter = new TokenBucket(120, 30);
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  socketCountFor(userId: string): number {
    return this.#byUser.get(userId)?.size ?? 0;
  }

  attach(server: HttpServer): WebSocketServer {
    const wss = new WebSocketServer({
      server,
      path: '/gateway',
      maxPayload: MESSAGE_LIMIT_BYTES,
      perMessageDeflate: false,
    });
    wss.on('connection', (socket, request) => this.#onConnection(socket, request));
    this.#heartbeat = setInterval(() => this.#sweep(), HEARTBEAT_INTERVAL);
    this.#heartbeat.unref?.();
    wss.on('close', () => {
      if (this.#heartbeat) clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    });
    log.info('gateway listening on /gateway');
    return wss;
  }

  /* ------------------------------ connection ---------------------------- */

  #onConnection(socket: WebSocket, _request: IncomingMessage): void {
    const client: Client = {
      connectionId: randomUUID(),
      socket,
      userId: '',
      sessionId: '',
      seq: 0,
      identified: false,
      alive: true,
      voiceChannelId: null,
      typingTokens: new Map(),
      createdAt: Date.now(),
    };
    this.#clients.add(client);

    this.#send(client, {
      op: 'hello',
      d: {
        heartbeat_interval_ms: HEARTBEAT_INTERVAL,
        protocol_version: GATEWAY_PROTOCOL_VERSION,
        server: { name: this.#deps.serverName, version: this.#deps.serverVersion },
      },
    });

    // Unidentified sockets are dropped quickly so we do not leak connections.
    const identifyTimer = setTimeout(() => {
      if (!client.identified) this.#close(client, 4002, 'Did not identify in time');
    }, 15_000);

    socket.on('message', (raw: RawData) => this.#onMessage(client, raw));
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => {
      clearTimeout(identifyTimer);
      this.#cleanup(client);
    });
    socket.on('error', (error) => {
      log.warn(`socket error: ${(error as Error).message}`);
    });
  }

  #cleanup(client: Client): void {
    // Sockets can close while the server is shutting down, at which point the
    // database is already gone — never let that throw.
    if (this.#closed) return;
    try {
      this.#cleanupInner(client);
    } catch (error) {
      log.debug(`cleanup after close failed: ${(error as Error).message}`);
    }
  }

  #cleanupInner(client: Client): void {
    this.#clients.delete(client);
    if (client.userId) {
      const set = this.#byUser.get(client.userId);
      set?.delete(client);
      if (set && set.size === 0) this.#byUser.delete(client.userId);
      if (client.voiceChannelId) {
        leaveVoice(this.#deps.db, client.userId);
        this.dispatchVoiceState(client.userId, client.voiceChannelId);
      }
      const stillOnline = (this.#byUser.get(client.userId)?.size ?? 0) > 0;
      this.#deps.presence.disconnect(client.userId);
      if (!stillOnline) this.dispatchPresence(client.userId);
      this.#deps.onSessionClosed?.(client.userId, client.sessionId);
    }
  }

  #send(client: Client, payload: unknown): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    try {
      client.socket.send(JSON.stringify(payload));
    } catch (error) {
      log.warn(`send failed: ${(error as Error).message}`);
    }
  }

  #error(client: Client, code: string, message: string, fatal = false): void {
    this.#send(client, { op: 'error', d: { code, message, fatal } });
    if (fatal) this.#close(client, 4001, message);
  }

  #close(client: Client, code: number, reason: string): void {
    try {
      client.socket.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  /* -------------------------------- messages ---------------------------- */

  #onMessage(client: Client, raw: RawData): void {
    if (!this.#limiter.take()) {
      this.#error(client, 'rate_limited', 'Too many gateway messages', false);
      return;
    }
    let parsed: ClientOp;
    try {
      parsed = JSON.parse(raw.toString()) as ClientOp;
    } catch {
      this.#error(client, 'invalid_json', 'Could not parse payload');
      return;
    }
    if (!parsed || typeof parsed.op !== 'string') {
      this.#error(client, 'invalid_op', 'Missing op');
      return;
    }
    try {
      this.#route(client, parsed);
    } catch (error) {
      log.warn(`op ${parsed.op} failed: ${(error as Error).message}`);
      this.#error(client, 'op_failed', (error as Error).message);
    }
  }

  #route(client: Client, message: ClientOp): void {
    if (message.op === 'identify') {
      this.#identify(client, message);
      return;
    }
    if (!client.identified) {
      this.#error(client, 'not_authenticated', 'Send identify first', true);
      return;
    }
    switch (message.op) {
      case 'heartbeat':
        this.#send(client, { op: 'heartbeat_ack', d: { seq: message.d.seq ?? null } });
        client.alive = true;
        return;
      case 'typing':
        this.#typing(client, message.d.channel_id);
        return;
      case 'presence.update':
        this.#updatePresence(client, message.d.status, message.d.custom_status);
        return;
      case 'voice.join':
        this.#voiceJoin(client, message.d);
        return;
      case 'voice.leave':
        this.#voiceLeave(client, message.d.channel_id);
        return;
      case 'voice.state':
        this.#voiceStatePatch(client, message.d);
        return;
      case 'voice.signal':
        this.#voiceSignal(client, message.d.channel_id, message.d.target_user_id, message.d.payload);
        return;
      case 'voice.speaking':
        this.#voiceSpeaking(client, message.d.channel_id, message.d.speaking);
        return;
      case 'subscribe':
        // Reserved for future partial-subscription support.
        return;
      default:
        this.#error(client, 'unknown_op', `Unknown op ${(message as { op: string }).op}`);
    }
  }

  #identify(client: Client, message: Extract<ClientOp, { op: 'identify' }>): void {
    if (client.identified) {
      this.#error(client, 'already_identified', 'Already identified');
      return;
    }
    const token = message.d?.token;
    if (typeof token !== 'string' || token.length === 0) {
      this.#error(client, 'missing_token', 'Authentication token required', true);
      return;
    }
    const session = sessionFromToken(this.#deps.db, token);
    if (!session) {
      this.#send(client, { op: 'invalid_session', d: { resumable: false, message: 'Session expired' } });
      this.#close(client, 4003, 'Invalid session');
      return;
    }
    const user = getUserById(this.#deps.db, session.user_id);
    if (!user) {
      this.#send(client, { op: 'invalid_session', d: { resumable: false, message: 'Unknown user' } });
      this.#close(client, 4003, 'Unknown user');
      return;
    }

    client.userId = session.user_id;
    client.sessionId = session.id;
    client.identified = true;

    let set = this.#byUser.get(session.user_id);
    if (!set) {
      set = new Set();
      this.#byUser.set(session.user_id, set);
    }
    set.add(client);

    const ready = this.#deps.buildReady(session.user_id);
    const status = this.#deps.presence.connect(session.user_id);
    const voice = getVoiceState(this.#deps.db, session.user_id);
    client.voiceChannelId = voice?.channel_id ?? null;

    const readyPayload = {
      session_id: session.id,
      user: toPublicUser(user, this.#deps.presence.ownStatus(session.user_id)),
      guilds: ready.guilds,
      dm_channel_ids: ready.dmChannelIds,
      resume_gateway_url: null,
    };
    // READY is a normal dispatch so clients only need one event pipeline.
    this.#send(client, { op: 'dispatch', t: 'READY', s: ++client.seq, d: readyPayload });
    log.info(`identified ${user.username} (${ready.guilds.length} guilds)`);
    this.dispatchPresence(session.user_id, status);
  }

  #typing(client: Client, channelId: string): void {
    if (typeof channelId !== 'string') return;
    const now = Date.now();
    const last = client.typingTokens.get(channelId) ?? 0;
    if (now - last < TYPING_COOLDOWN_MS) return;
    client.typingTokens.set(channelId, now);

    const channel = this.#deps.db.get<{ id: string; guild_id: string | null }>(
      'SELECT id, guild_id FROM channels WHERE id = ?',
      [channelId],
    );
    if (!channel) return;
    const audience = this.audienceForChannel(channelId);
    if (!audience.has(client.userId)) return; // not allowed to type there
    const user = getUserById(this.#deps.db, client.userId);
    if (!user) return;
    const payload: TypingStartPayload = {
      channel_id: channelId,
      user_id: client.userId,
      display_name: user.display_name,
      expires_at: now + 8000,
    };
    this.dispatch('TYPING_START', payload, audience, { exclude: client.userId });
  }

  #updatePresence(client: Client, status: UserStatus, customStatus?: string | null): void {
    const allowed: UserStatus[] = ['online', 'idle', 'dnd', 'invisible'];
    if (!allowed.includes(status)) return;
    this.#deps.presence.setStatus(client.userId, status, customStatus);
    this.dispatchPresence(client.userId);
    // The user themselves gets their own status echoed (including invisible).
    this.#send(client, {
      op: 'dispatch',
      t: 'USER_UPDATE',
      s: ++client.seq,
      d: {
        user: toPublicUser(getUserById(this.#deps.db, client.userId)!, this.#deps.presence.ownStatus(client.userId)),
      },
    });
  }

  /* ------------------------------ voice --------------------------------- */

  #voiceJoin(
    client: Client,
    data: Extract<ClientOp, { op: 'voice.join' }>['d'],
  ): void {
    const channel = requireChannel(this.#deps.db, data.channel_id);
    if (channel.type !== 'voice') throw new Error('Not a voice channel');
    if (channel.guild_id) {
      const member = this.#deps.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM guild_members WHERE guild_id = ? AND user_id = ?',
        [channel.guild_id, client.userId],
      );
      if (Number(member?.c ?? 0) === 0) throw new Error('Not a member of this server');
    } else {
      const participant = this.#deps.db.get<{ c: number }>(
        'SELECT COUNT(*) AS c FROM dm_recipients WHERE channel_id = ? AND user_id = ?',
        [channel.id, client.userId],
      );
      if (Number(participant?.c ?? 0) === 0) throw new Error('Not part of this call');
    }

    const previous = client.voiceChannelId;
    joinVoice(this.#deps.db, {
      userId: client.userId,
      channelId: channel.id,
      guildId: channel.guild_id,
      sessionId: client.sessionId,
      selfMute: data.self_mute,
      selfDeaf: data.self_deaf,
      selfVideo: data.self_video,
      selfStream: data.self_stream,
    });
    client.voiceChannelId = channel.id;
    if (previous && previous !== channel.id) this.dispatchVoiceState(client.userId, previous);
    this.dispatchVoiceState(client.userId, channel.id);
    this.dispatchPresence(client.userId);
  }

  #voiceLeave(client: Client, channelId: string): void {
    const row = getVoiceState(this.#deps.db, client.userId);
    if (!row) return;
    leaveVoice(this.#deps.db, client.userId);
    client.voiceChannelId = null;
    this.dispatchVoiceState(client.userId, row.channel_id);
    this.dispatchPresence(client.userId);
    void channelId;
  }

  #voiceStatePatch(client: Client, data: Extract<ClientOp, { op: 'voice.state' }>['d']): void {
    const row = getVoiceState(this.#deps.db, client.userId);
    if (!row) return;
    updateVoiceState(this.#deps.db, client.userId, {
      self_mute: data.self_mute,
      self_deaf: data.self_deaf,
      self_video: data.self_video,
      self_stream: data.self_stream,
    });
    this.dispatchVoiceState(client.userId, row.channel_id);
  }

  #voiceSignal(
    client: Client,
    channelId: string,
    targetUserId: string | null,
    payload: SignalPayload,
  ): void {
    if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') return;
    const state = getVoiceState(this.#deps.db, client.userId);
    if (!state || state.channel_id !== channelId) return; // must be in that voice channel
    const audience = this.audienceForChannel(channelId);
    const message: VoiceSignalPayload = {
      channel_id: channelId,
      from_user_id: client.userId,
      payload,
    };
    if (targetUserId) {
      if (!audience.has(targetUserId)) return;
      const targetState = getVoiceState(this.#deps.db, targetUserId);
      if (!targetState || targetState.channel_id !== channelId) return;
      this.dispatch('VOICE_SIGNAL', message, new Set([targetUserId]));
      // Echo to the sender's other connections so their state stays in sync.
      this.dispatch('VOICE_SIGNAL', message, new Set([client.userId]), { excludeConnection: client.connectionId });
      return;
    }
    this.dispatch('VOICE_SIGNAL', message, audience, {
      exclude: client.userId,
    });
  }

  #voiceSpeaking(client: Client, channelId: string, speaking: boolean): void {
    const state = getVoiceState(this.#deps.db, client.userId);
    if (!state || state.channel_id !== channelId) return;
    const payload: VoiceSpeakingPayload = { channel_id: channelId, user_id: client.userId, speaking: !!speaking };
    this.dispatch('VOICE_SPEAKING', payload, this.audienceForChannel(channelId), { exclude: client.userId });
  }

  /* ------------------------------ dispatch ------------------------------ */

  /** Broadcast a presence update to everybody who can see this user. */
  dispatchPresence(userId: string, status?: UserStatus): void {
    const payload: PresenceUpdatePayload = {
      user_id: userId,
      status: status ?? this.#deps.presence.statusOf(userId),
      custom_status: this.#deps.presence.customStatusOf(userId),
      voice_channel_id: getVoiceState(this.#deps.db, userId)?.channel_id ?? null,
    };
    this.dispatch('PRESENCE_UPDATE', payload, this.audienceForUser(userId), { includeSelf: true });
  }

  /**
   * Broadcast a voice-state change. The payload always carries the full
   * roster for that channel plus the state of the user who changed, so clients
   * can update their UI without a follow-up request.
   */
  dispatchVoiceState(userId: string, channelId: string): void {
    const row = getVoiceState(this.#deps.db, userId);
    const payload = {
      channel_id: channelId,
      user_id: userId,
      state: row ? toVoiceState(row) : null,
      states: listChannelVoiceStates(this.#deps.db, channelId).map(toVoiceState),
    };
    this.dispatch('VOICE_STATE_UPDATE', payload, this.audienceForChannel(channelId), { includeSelf: true });
  }

  dispatch<P>(
    event: DispatchEvent,
    payload: P,
    audience: Set<string>,
    options: { exclude?: string; includeSelf?: boolean; excludeConnection?: string } = {},
  ): number {
    if (audience.size === 0) return 0;
    let sent = 0;
    for (const userId of audience) {
      if (options.exclude && options.exclude === userId) continue;
      const clients = this.#byUser.get(userId);
      if (!clients) continue;
      for (const client of clients) {
        if (options.excludeConnection && client.connectionId === options.excludeConnection) continue;
        const message: Dispatch<P> = { op: 'dispatch', t: event, s: ++client.seq, d: payload };
        this.#send(client, message);
        sent += 1;
      }
    }
    return sent;
  }

  dispatchToUser<P>(userId: string, event: DispatchEvent, payload: P): void {
    const clients = this.#byUser.get(userId);
    if (!clients) return;
    for (const client of clients) {
      const message: Dispatch<P> = { op: 'dispatch', t: event, s: ++client.seq, d: payload };
      this.#send(client, message);
    }
  }

  /** Everyone who can see a channel: guild members, or DM recipients. */
  audienceForChannel(channelId: string): Set<string> {
    const channel = this.#deps.db.get<{ id: string; guild_id: string | null }>(
      'SELECT id, guild_id FROM channels WHERE id = ?',
      [channelId],
    );
    if (!channel) return new Set();
    if (channel.guild_id) return new Set(guildMemberIds(this.#deps.db, channel.guild_id));
    return new Set(
      this.#deps.db
        .all<{ user_id: string }>('SELECT user_id FROM dm_recipients WHERE channel_id = ?', [channelId])
        .map((r) => r.user_id),
    );
  }

  audienceForGuild(guildId: string): Set<string> {
    return new Set(guildMemberIds(this.#deps.db, guildId));
  }

  /** Everyone who should hear about a user's presence: guild-mates, friends, DM partners. */
  audienceForUser(userId: string): Set<string> {
    const audience = new Set<string>([userId]);
    for (const guildId of guildIdsForUser(this.#deps.db, userId)) {
      for (const member of guildMemberIds(this.#deps.db, guildId)) audience.add(member);
    }
    for (const row of this.#deps.db.all<{ target_id: string }>(
      "SELECT target_id FROM relationships WHERE user_id = ? AND type IN ('friend','incoming','outgoing')",
      [userId],
    )) {
      audience.add(row.target_id);
    }
    for (const channel of listDmChannels(this.#deps.db, userId)) {
      for (const row of this.#deps.db.all<{ user_id: string }>(
        'SELECT user_id FROM dm_recipients WHERE channel_id = ?',
        [channel.id],
      )) {
        audience.add(row.user_id);
      }
    }
    return audience;
  }

  /** Voice states for every voice channel the user can see (sent on demand). */
  voiceStatesForGuild(guildId: string): VoiceState[] {
    const channelIds = this.#deps.db
      .all<{ id: string }>("SELECT id FROM channels WHERE guild_id = ? AND type = 'voice'", [guildId])
      .map((r) => r.id);
    if (channelIds.length === 0) return [];
    const placeholders = channelIds.map(() => '?').join(',');
    return listUserVoiceStates(
      this.#deps.db,
      this.#deps.db
        .all<{ user_id: string }>(`SELECT user_id FROM voice_states WHERE channel_id IN (${placeholders})`, channelIds)
        .map((r) => r.user_id),
    ).map(toVoiceState);
  }

  /** Force-disconnect every socket of a user (session revoked, password change). */
  disconnectUser(userId: string, reason = 'Session ended'): void {
    const clients = this.#byUser.get(userId);
    if (!clients) return;
    for (const client of [...clients]) {
      this.#send(client, { op: 'dispatch', t: 'SESSION_REVOKED', s: ++client.seq, d: { reason } });
      this.#close(client, 4004, reason);
    }
  }

  shutdown(): void {
    this.#closed = true;
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const client of [...this.#clients]) {
      client.socket.removeAllListeners('close');
      client.socket.removeAllListeners('message');
      this.#close(client, 1001, 'Server shutting down');
    }
    this.#clients.clear();
    this.#byUser.clear();
  }

  #sweep(): void {
    for (const client of [...this.#clients]) {
      if (!client.alive) {
        this.#close(client, 4009, 'Heartbeat timeout');
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        /* ignore */
      }
    }
  }
}
