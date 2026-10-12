/**
 * Gateway client: one WebSocket per signed-in session, with heartbeats,
 * automatic reconnect (exponential backoff) and a small typed event emitter.
 */
import type { ClientOp, Dispatch, GatewayHello, GatewayIncoming, SignalPayload, UserStatus } from './types';

export interface GatewayHandlers {
  onHello?: (hello: GatewayHello) => void;
  onReady?: (payload: { session_id: string; guilds: string[]; dm_channel_ids: string[] }) => void;
  onDispatch?: (event: Dispatch) => void;
  onDisconnect?: (code: number, reason: string) => void;
  onError?: (code: string, message: string) => void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

const RECONNECT_BASE_MS = 700;
const RECONNECT_MAX_MS = 15_000;

export class Gateway {
  #url: string;
  #token: string;
  #socket: WebSocket | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #handlers: GatewayHandlers = {};
  #seq: number | null = null;
  #attempts = 0;
  #closedByUser = false;
  #status: ConnectionStatus = 'idle';
  #statusListeners = new Set<(status: ConnectionStatus) => void>();

  constructor(url: string, token: string) {
    this.#url = url;
    this.#token = token;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status);
  }

  on(handlers: GatewayHandlers): void {
    this.#handlers = { ...this.#handlers, ...handlers };
  }

  connect(): void {
    this.#closedByUser = false;
    if (this.#socket && (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.#setStatus(this.#attempts === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(this.#url.replace(/^http/, 'ws') + '/gateway');
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#attempts = 0;
      this.#setStatus('connected');
      this.send({
        op: 'identify',
        d: {
          token: this.#token,
          protocol_version: 1,
          client: {
            kind: window.neurio?.isDesktop ? 'electron' : 'web',
            name: 'Neurio',
            version: window.neurio?.version ?? '1.0.0',
          },
        },
      });
    });

    socket.addEventListener('message', (event) => {
      let payload: GatewayIncoming;
      try {
        payload = JSON.parse(String(event.data)) as GatewayIncoming;
      } catch {
        return;
      }
      switch (payload.op) {
        case 'hello': {
          this.#handlers.onHello?.(payload.d as GatewayHello);
          const interval = (payload.d as GatewayHello).heartbeat_interval_ms ?? 30_000;
          this.#startHeartbeat(interval);
          break;
        }
        case 'dispatch': {
          const dispatch = payload as Dispatch;
          this.#seq = dispatch.s;
          if (dispatch.t === 'READY') {
            const ready = dispatch.d as { session_id: string; guilds: string[]; dm_channel_ids: string[] };
            this.#handlers.onReady?.(ready);
          }
          this.#handlers.onDispatch?.(dispatch);
          break;
        }
        case 'invalid_session':
          this.#closedByUser = true;
          this.#handlers.onError?.('invalid_session', (payload.d as { message?: string }).message ?? 'Session expired');
          this.disconnect();
          break;
        case 'error': {
          const error = payload.d as { code: string; message: string; fatal?: boolean };
          this.#handlers.onError?.(error.code, error.message);
          break;
        }
        default:
          break;
      }
    });

    socket.addEventListener('close', (event) => {
      this.#stopHeartbeat();
      this.#handlers.onDisconnect?.(event.code, event.reason);
      if (!this.#closedByUser) this.#scheduleReconnect();
      else this.#setStatus('closed');
    });

    socket.addEventListener('error', () => {
      // The close handler drives reconnection; nothing to do here.
    });
  }

  #startHeartbeat(intervalMs: number): void {
    this.#stopHeartbeat();
    this.#heartbeat = setInterval(() => {
      this.send({ op: 'heartbeat', d: { seq: this.#seq } });
    }, intervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #scheduleReconnect(): void {
    this.#attempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.#attempts - 1), RECONNECT_MAX_MS);
    this.#setStatus('reconnecting');
    setTimeout(() => {
      if (!this.#closedByUser) this.connect();
    }, delay);
  }

  send(payload: ClientOp): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(payload));
  }

  typing(channelId: string): void {
    this.send({ op: 'typing', d: { channel_id: channelId } });
  }

  setPresence(status: UserStatus, customStatus?: string | null): void {
    this.send({ op: 'presence.update', d: { status, custom_status: customStatus } });
  }

  joinVoice(input: {
    channelId: string;
    selfMute: boolean;
    selfDeaf: boolean;
    selfVideo: boolean;
    selfStream: boolean;
  }): void {
    this.send({
      op: 'voice.join',
      d: {
        channel_id: input.channelId,
        self_mute: input.selfMute,
        self_deaf: input.selfDeaf,
        self_video: input.selfVideo,
        self_stream: input.selfStream,
      },
    });
  }

  leaveVoice(channelId: string): void {
    this.send({ op: 'voice.leave', d: { channel_id: channelId } });
  }

  updateVoiceState(patch: {
    channelId: string;
    selfMute?: boolean;
    selfDeaf?: boolean;
    selfVideo?: boolean;
    selfStream?: boolean;
  }): void {
    this.send({
      op: 'voice.state',
      d: {
        channel_id: patch.channelId,
        self_mute: patch.selfMute,
        self_deaf: patch.selfDeaf,
        self_video: patch.selfVideo,
        self_stream: patch.selfStream,
      },
    });
  }

  signal(channelId: string, targetUserId: string | null, payload: SignalPayload): void {
    this.send({ op: 'voice.signal', d: { channel_id: channelId, target_user_id: targetUserId, payload } });
  }

  speaking(channelId: string, speaking: boolean): void {
    this.send({ op: 'voice.speaking', d: { channel_id: channelId, speaking } });
  }

  disconnect(): void {
    this.#closedByUser = true;
    this.#stopHeartbeat();
    this.#socket?.close(1000, 'client closing');
    this.#socket = null;
    this.#setStatus('closed');
  }
}
