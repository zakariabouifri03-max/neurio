/**
 * Integration-test harness: boots a real Neurio server on an ephemeral port,
 * gives you a typed REST client and a real WebSocket gateway client.
 * Everything talks over the network stack for real — no mocks.
 */
import { WebSocket } from 'ws';
import { createApp, type NeurioApp } from '../../server/app';
import type { AuthResult, Channel, Guild, Message, PublicUser } from '../../shared/types';
import type { Dispatch, GatewayIncoming } from '../../shared/protocol';

export interface Harness {
  app: NeurioApp;
  url: string;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const app = await createApp({
    dataDir: ':memory:',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'error',
    verbose: false,
  });
  const started = await app.start();
  return {
    app,
    url: started.url,
    async close() {
      await app.stop();
    },
  };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    public token: string | null = null,
  ) {}

  get user(): string | null {
    return this.token;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; raw?: boolean; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed as T };
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body });
  }
  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body });
  }
  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body });
  }
  delete<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, { body });
  }

  /* ------------------------------- helpers -------------------------------- */

  async register(username: string, password = 'password123', extra: Record<string, unknown> = {}) {
    const response = await this.post<AuthResult>('/api/auth/register', {
      username,
      password,
      display_name: username.toUpperCase(),
      ...extra,
    });
    if (response.status !== 200) throw new Error(`register failed: ${JSON.stringify(response.body)}`);
    this.token = response.body.token;
    return response.body;
  }

  async login(username: string, password = 'password123') {
    const response = await this.post<AuthResult>('/api/auth/login', { username, password });
    if (response.status !== 200) throw new Error(`login failed: ${JSON.stringify(response.body)}`);
    this.token = response.body.token;
    return response.body;
  }

  async createGuild(name: string): Promise<Guild & { channels: Channel[] }> {
    const response = await this.post<{ guild: Guild & { channels: Channel[] } }>('/api/guilds', { name });
    if (response.status !== 200) throw new Error(`createGuild failed: ${JSON.stringify(response.body)}`);
    return response.body.guild;
  }

  async sendMessage(channelId: string, content: string, extra: Record<string, unknown> = {}): Promise<Message> {
    const response = await this.post<{ message: Message }>(`/api/channels/${channelId}/messages`, {
      content,
      ...extra,
    });
    if (response.status !== 200) throw new Error(`sendMessage failed: ${JSON.stringify(response.body)}`);
    return response.body.message;
  }

  async me(): Promise<PublicUser> {
    const response = await this.get<{ user: PublicUser }>('/api/users/@me');
    if (response.status !== 200) throw new Error(`me failed: ${JSON.stringify(response.body)}`);
    return response.body.user;
  }

  async dm(userId: string): Promise<Channel> {
    const response = await this.post<{ channel: Channel }>('/api/dms', { recipient_id: userId });
    if (response.status !== 200) throw new Error(`dm failed: ${JSON.stringify(response.body)}`);
    return response.body.channel;
  }
}

/** One remote peer, without an account yet. */
export class GatewayClient {
  readonly events: Dispatch[] = [];
  #socket: WebSocket | null = null;
  #waiters: { predicate: (event: Dispatch) => boolean; resolve: (event: Dispatch) => void; timer: NodeJS.Timeout }[] = [];
  heartbeat: NodeJS.Timeout | null = null;
  seq: number | null = null;

  constructor(private readonly url: string) {}

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.#socket = new WebSocket(this.url.replace('http', 'ws') + '/gateway');
    await new Promise<void>((resolve, reject) => {
      this.#socket!.once('open', () => resolve());
      this.#socket!.once('error', (error) => reject(error));
    });
    this.#socket.on('message', (raw) => this.#onMessage(raw.toString()));
  }

  #onMessage(raw: string): void {
    const payload = JSON.parse(raw) as GatewayIncoming;
    if (payload.op === 'hello') return;
    if (payload.op === 'dispatch') {
      this.seq = payload.s;
      this.events.push(payload);
      for (const waiter of [...this.#waiters]) {
        if (waiter.predicate(payload)) {
          clearTimeout(waiter.timer);
          this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
          waiter.resolve(payload);
        }
      }
    }
  }

  async identify(token: string): Promise<void> {
    this.send({
      op: 'identify',
      d: {
        token,
        protocol_version: 1,
        client: { kind: 'test', name: 'vitest', version: '1.0.0' },
      },
    });
    await this.waitFor((event) => event.t === 'READY');
  }

  send(payload: unknown): void {
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error('gateway socket is not open');
    }
    this.#socket.send(JSON.stringify(payload));
  }

  waitFor(predicate: (event: Dispatch) => boolean, timeoutMs = 5000): Promise<Dispatch> {
    const existing = this.events.find(predicate);
    if (existing) {
      // Allow the same event to be awaited repeatedly (e.g. two MESSAGE_CREATEs).
      const index = this.events.indexOf(existing);
      if (index >= 0 && !this.#consumed.has(index)) {
        this.#consumed.add(index);
        return Promise.resolve(existing);
      }
    }
    return new Promise<Dispatch>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((w) => w.timer !== timer);
        reject(new Error(`timed out waiting for gateway event (saw: ${this.events.map((e) => e.t).join(', ')})`));
      }, timeoutMs);
      this.#waiters.push({ predicate, resolve, timer });
    });
  }

  #consumed = new Set<number>();

  eventNamed(name: string): Dispatch | undefined {
    return this.events.find((event) => event.t === name);
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (!this.#socket) return;
    const socket = this.#socket;
    this.#socket = null;
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
      setTimeout(resolve, 500);
    });
  }
}

export async function makeGateway(url: string, token: string): Promise<GatewayClient> {
  const client = new GatewayClient(url);
  await client.connect();
  await client.identify(token);
  return client;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until `fn` returns true (or throw after the timeout). */
export async function waitUntil(fn: () => boolean, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fn()) return;
    await sleep(intervalMs);
  }
  throw new Error('waitUntil: condition was never satisfied');
}
