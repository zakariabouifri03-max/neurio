/**
 * Presence tracker.
 *
 * A user counts as online while they hold at least one live gateway socket.
 * "invisible" users keep their chosen status internally but appear offline to
 * everybody else. The chosen status survives disconnects, so signing back in
 * restores what the user picked.
 */
import type { Database } from './db';
import type { UserStatus } from '../shared/types';

export interface PresenceEntry {
  /** status the user selected */
  status: UserStatus;
  /** live connections (gateway sockets) */
  connections: number;
  custom_status: string | null;
}

export class PresenceManager {
  #entries = new Map<string, PresenceEntry>();
  #listeners = new Set<(userId: string, status: UserStatus, voiceChannelId: string | null) => void>();
  #db: Database;
  #voiceChannelOf: (userId: string) => string | null = () => null;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Wired up by the gateway so presence updates can carry the voice channel. */
  setVoiceLookup(fn: (userId: string) => string | null): void {
    this.#voiceChannelOf = fn;
  }

  onChange(listener: (userId: string, status: UserStatus, voiceChannelId: string | null) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private emit(userId: string): void {
    const status = this.statusOf(userId);
    const voiceChannel = this.#voiceChannelOf(userId);
    for (const listener of this.#listeners) listener(userId, status, voiceChannel);
  }

  /** Register a connection; returns the resulting status for that user. */
  connect(userId: string): UserStatus {
    const entry = this.#entries.get(userId);
    const row = this.#db.get<{ status: string; custom_status: string | null }>(
      'SELECT status, custom_status FROM users WHERE id = ?',
      [userId],
    );
    const stored = (row?.status as UserStatus) ?? 'online';
    const next: PresenceEntry = entry
      ? { ...entry, connections: entry.connections + 1 }
      : { status: stored === 'offline' || stored === 'invisible' ? 'online' : stored, connections: 1, custom_status: row?.custom_status ?? null };
    this.#entries.set(userId, next);
    // Persist the resolved status so a restart does not resurrect "offline".
    if (next.status !== stored) {
      this.#db.run('UPDATE users SET status = ? WHERE id = ?', [next.status, userId]);
    }
    this.emit(userId);
    return this.statusOf(userId);
  }

  disconnect(userId: string): void {
    const entry = this.#entries.get(userId);
    if (!entry) return;
    const connections = entry.connections - 1;
    if (connections <= 0) this.#entries.delete(userId);
    else this.#entries.set(userId, { ...entry, connections });
    this.emit(userId);
  }

  setStatus(userId: string, status: UserStatus, customStatus?: string | null): void {
    const entry = this.#entries.get(userId) ?? {
      status,
      connections: 0,
      custom_status: customStatus ?? null,
    };
    this.#entries.set(userId, {
      status,
      connections: entry.connections,
      custom_status: customStatus === undefined ? entry.custom_status : customStatus,
    });
    const sets = ['status = ?'];
    const params: (string | null)[] = [status];
    if (customStatus !== undefined) {
      sets.push('custom_status = ?');
      params.push(customStatus);
    }
    params.push(userId);
    this.#db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    this.emit(userId);
  }

  setCustomStatus(userId: string, customStatus: string | null): void {
    const entry = this.#entries.get(userId);
    if (entry) this.#entries.set(userId, { ...entry, custom_status: customStatus });
    this.#db.run('UPDATE users SET custom_status = ? WHERE id = ?', [customStatus, userId]);
    this.emit(userId);
  }

  /** Effective status **as other people see it**. */
  statusOf(userId: string): UserStatus {
    const entry = this.#entries.get(userId);
    if (!entry || entry.connections <= 0) return 'offline';
    if (entry.status === 'invisible') return 'offline';
    if (entry.status === 'offline') return 'offline';
    return entry.status;
  }

  /** Status as the user sees themselves (keeps invisible/idle accurate). */
  ownStatus(userId: string): UserStatus {
    const entry = this.#entries.get(userId);
    if (!entry || entry.connections <= 0) return 'offline';
    return entry.status;
  }

  customStatusOf(userId: string): string | null {
    return this.#entries.get(userId)?.custom_status ?? null;
  }

  onlineUserIds(): string[] {
    return [...this.#entries.entries()]
      .filter(([, entry]) => entry.connections > 0 && entry.status !== 'invisible')
      .map(([userId]) => userId);
  }

  connectionCount(userId: string): number {
    return this.#entries.get(userId)?.connections ?? 0;
  }

  snapshot(): Record<string, UserStatus> {
    const out: Record<string, UserStatus> = {};
    for (const [userId] of this.#entries) out[userId] = this.statusOf(userId);
    return out;
  }
}
