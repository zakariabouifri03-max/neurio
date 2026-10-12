/**
 * Thin REST client for the local Neurio server.
 * The base URL is a loopback address (desktop) or the self-hosted origin (web).
 */
import type {
  AuthResult,
  Channel,
  Guild,
  Invite,
  Message,
  PublicUser,
  RelationshipEntry,
  SearchHit,
  ServerConfig,
  SessionInfo,
  UnreadInfoLike,
  VoiceState,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ApiOptions {
  baseUrl: string;
  token?: string | null;
}

export class Api {
  baseUrl: string;
  token: string | null;

  constructor(options: ApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token ?? null;
  }

  url(path: string, withToken = false): string {
    if (!withToken || !this.token) return `${this.baseUrl}${path}`;
    return `${this.baseUrl}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(this.token)}`;
  }

  /** URL usable in <img>/<video> tags (token in the query string, GET only). */
  fileUrl(path: string | null | undefined): string | null {
    if (!path) return null;
    return this.url(path, true);
  }

  async request<T>(method: string, path: string, body?: unknown, options: { form?: FormData } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload: BodyInit | undefined;
    if (options.form) {
      payload = options.form;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetch(this.url(path), { method, headers, body: payload });
    } catch (error) {
      throw new ApiError(0, 'network_error', `Cannot reach the Neurio server at ${this.baseUrl}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
    }
    if (!response.ok) {
      const error = (parsed ?? {}) as { error?: string; message?: string };
      throw new ApiError(response.status, error.error ?? 'error', error.message ?? response.statusText);
    }
    return parsed as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }
  delete<T>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, body);
  }

  /* ------------------------------- endpoints ------------------------------ */

  health() {
    return this.get<{ ok: boolean; name: string; version: string }>('/api/health');
  }

  serverConfig() {
    return this.get<ServerConfig>('/api/config');
  }

  register(input: { username: string; password: string; display_name?: string }) {
    return this.post<AuthResult>('/api/auth/register', {
      ...input,
      device_label: 'Neurio desktop',
      device_kind: 'desktop',
    });
  }

  login(input: { username: string; password: string }) {
    return this.post<AuthResult>('/api/auth/login', {
      ...input,
      device_label: 'Neurio desktop',
      device_kind: 'desktop',
    });
  }

  logout() {
    return this.post<{ ok: boolean }>('/api/auth/logout');
  }

  session() {
    return this.get<{
      user: PublicUser;
      session: SessionInfo;
      guilds: string[];
      dm_channel_ids: string[];
      config: ServerConfig;
    }>('/api/auth/session');
  }

  guilds() {
    return this.get<{ guilds: (Guild & { member_count: number })[] }>('/api/guilds');
  }

  guild(guildId: string) {
    return this.get<{ guild: Guild }>(`/api/guilds/${guildId}`);
  }

  createGuild(input: { name: string; description?: string }) {
    return this.post<{ guild: Guild }>('/api/guilds', input);
  }

  updateGuild(guildId: string, patch: { name?: string; description?: string }) {
    return this.patch<{ guild: Guild }>(`/api/guilds/${guildId}`, patch);
  }

  deleteGuild(guildId: string) {
    return this.delete<{ ok: boolean }>(`/api/guilds/${guildId}`);
  }

  uploadGuildIcon(guildId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.request<{ guild: Guild }>('POST', `/api/guilds/${guildId}/icon`, undefined, { form });
  }

  createChannel(guildId: string, input: { name: string; type: string; topic?: string; parent_id?: string }) {
    return this.post<{ channel: Channel }>(`/api/guilds/${guildId}/channels`, input);
  }

  updateChannel(channelId: string, patch: Record<string, unknown>) {
    return this.patch<{ channel: Channel }>(`/api/channels/${channelId}`, patch);
  }

  deleteChannel(channelId: string) {
    return this.delete<{ ok: boolean }>(`/api/channels/${channelId}`);
  }

  setOverwrite(channelId: string, targetId: string, input: { type: 'role' | 'member'; allow: number; deny: number }) {
    return this.put<{ ok: boolean }>(`/api/channels/${channelId}/overwrites/${targetId}`, input);
  }

  deleteOverwrite(channelId: string, targetId: string) {
    return this.delete<{ ok: boolean }>(`/api/channels/${channelId}/overwrites/${targetId}`);
  }

  messages(channelId: string, params: { before?: string; after?: string; limit?: number } = {}) {
    const query = new URLSearchParams();
    if (params.before) query.set('before', params.before);
    if (params.after) query.set('after', params.after);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return this.get<{ messages: Message[] }>(`/api/channels/${channelId}/messages${suffix ? `?${suffix}` : ''}`);
  }

  sendMessage(channelId: string, input: { content: string; reference_id?: string | null; upload_ids?: string[] }) {
    return this.post<{ message: Message }>(`/api/channels/${channelId}/messages`, input);
  }

  editMessage(messageId: string, content: string) {
    return this.patch<{ message: Message }>(`/api/messages/${messageId}`, { content });
  }

  deleteMessage(messageId: string) {
    return this.delete<{ ok: boolean }>(`/api/messages/${messageId}`);
  }

  addReaction(messageId: string, emoji: string) {
    return this.put<{ ok: boolean }>(`/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  removeReaction(messageId: string, emoji: string) {
    return this.delete<{ ok: boolean }>(`/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  pinMessage(messageId: string) {
    return this.put<{ message: Message }>(`/api/messages/${messageId}/pin`);
  }

  unpinMessage(messageId: string) {
    return this.delete<{ message: Message }>(`/api/messages/${messageId}/pin`);
  }

  pins(channelId: string) {
    return this.get<{ messages: Message[] }>(`/api/channels/${channelId}/pins`);
  }

  uploadFiles(files: File[]) {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return this.request<{ attachments: { id: string; filename: string; url: string }[] }>(
      'POST',
      '/api/uploads',
      undefined,
      { form },
    );
  }

  dms() {
    return this.get<{ channels: Channel[] }>('/api/dms');
  }

  openDm(recipientId: string) {
    return this.post<{ channel: Channel }>('/api/dms', { recipient_id: recipientId });
  }

  createGroupDm(userIds: string[], name?: string) {
    return this.post<{ channel: Channel }>('/api/dms/group', { user_ids: userIds, name });
  }

  relationships() {
    return this.get<{ relationships: RelationshipEntry[] }>('/api/relationships');
  }

  addFriend(input: { username?: string; user_id?: string }) {
    return this.post<{ relationship: string; accepted: boolean }>('/api/relationships/requests', input);
  }

  acceptFriend(userId: string) {
    return this.post<{ ok: boolean }>(`/api/relationships/requests/${userId}/accept`);
  }

  removeFriend(userId: string) {
    return this.delete<{ ok: boolean }>(`/api/relationships/${userId}`);
  }

  blockUser(userId: string) {
    return this.post<{ ok: boolean }>(`/api/relationships/${userId}/block`);
  }

  unblockUser(userId: string) {
    return this.delete<{ ok: boolean }>(`/api/relationships/${userId}/block`);
  }

  searchUsers(query: string) {
    return this.get<{
      users: { id: string; username: string; display_name: string; status: string; is_friend: boolean }[];
    }>(`/api/users?query=${encodeURIComponent(query)}`);
  }

  userProfile(userId: string) {
    return this.get<{ user: PublicUser; mutual_guilds: { id: string; name: string }[]; friendship: string }>(
      `/api/users/${userId}`,
    );
  }

  updateProfile(patch: { display_name?: string; bio?: string; custom_status?: string | null }) {
    return this.patch<{ user: PublicUser }>('/api/users/@me', patch);
  }

  uploadAvatar(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.request<{ user: PublicUser }>('POST', '/api/users/@me/avatar', undefined, { form });
  }

  deleteAvatar() {
    return this.delete<{ user: PublicUser }>('/api/users/@me/avatar');
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.post<{ ok: boolean }>('/api/users/@me/password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  sessions() {
    return this.get<{ sessions: SessionInfo[] }>('/api/users/@me/sessions');
  }

  revokeSession(sessionId: string) {
    return this.delete<{ ok: boolean }>(`/api/users/@me/sessions/${sessionId}`);
  }

  readStates() {
    return this.get<{ unread: UnreadInfoLike[] }>('/api/read-states');
  }

  ack(channelId: string, messageId?: string | null) {
    return this.post<{ channel_id: string }>(`/api/channels/${channelId}/ack`, { message_id: messageId ?? null });
  }

  typing(channelId: string) {
    return this.post<{ ok: boolean }>(`/api/channels/${channelId}/typing`);
  }

  search(params: { q: string; guild_id?: string; channel_id?: string; author_id?: string; pinned?: boolean }) {
    const query = new URLSearchParams({ q: params.q });
    if (params.guild_id) query.set('guild_id', params.guild_id);
    if (params.channel_id) query.set('channel_id', params.channel_id);
    if (params.author_id) query.set('author_id', params.author_id);
    if (params.pinned) query.set('pinned', 'true');
    return this.get<{ hits: SearchHit[]; query: string }>(`/api/search?${query.toString()}`);
  }

  createInvite(guildId: string, input: { channel_id?: string; max_uses?: number; max_age_seconds?: number | null }) {
    return this.post<{ invite: Invite }>(`/api/guilds/${guildId}/invites`, input);
  }

  invites(guildId: string) {
    return this.get<{ invites: Invite[] }>(`/api/guilds/${guildId}/invites`);
  }

  revokeInvite(code: string) {
    return this.delete<{ ok: boolean }>(`/api/invites/${code}`);
  }

  invitePreview(code: string) {
    return this.get<{ invite: Invite }>(`/api/invites/${code}`);
  }

  acceptInvite(code: string) {
    return this.post<{ guild: Guild; already_member: boolean }>(`/api/invites/${code}/accept`);
  }

  members(guildId: string) {
    return this.get<{ members: Guild['members'] }>(`/api/guilds/${guildId}/members`);
  }

  updateMember(guildId: string, userId: string, patch: { nickname?: string | null; role_ids?: string[] }) {
    return this.patch<{ member: unknown }>(`/api/guilds/${guildId}/members/${userId}`, patch);
  }

  kickMember(guildId: string, userId: string) {
    return this.delete<{ ok: boolean }>(`/api/guilds/${guildId}/members/${userId}`);
  }

  banMember(guildId: string, userId: string, reason?: string) {
    return this.post<{ ok: boolean }>(`/api/guilds/${guildId}/bans`, { user_id: userId, reason });
  }

  roles(guildId: string) {
    return this.get<{ roles: Guild['roles'] }>(`/api/guilds/${guildId}/roles`);
  }

  createRole(guildId: string, input: Record<string, unknown>) {
    return this.post<{ role: unknown }>(`/api/guilds/${guildId}/roles`, input);
  }

  updateRole(guildId: string, roleId: string, patch: Record<string, unknown>) {
    return this.patch<{ role: unknown }>(`/api/guilds/${guildId}/roles/${roleId}`, patch);
  }

  deleteRole(guildId: string, roleId: string) {
    return this.delete<{ ok: boolean }>(`/api/guilds/${guildId}/roles/${roleId}`);
  }

  voiceStates(guildId: string) {
    return this.get<{ states: VoiceState[] }>(`/api/guilds/${guildId}/voice-states`);
  }

  permissions(guildId: string, channelId?: string) {
    const suffix = channelId ? `&channel_id=${channelId}` : '';
    return this.get<{ permissions: number; is_administrator: boolean }>(
      `/api/permissions?guild_id=${guildId}${suffix}`,
    );
  }

  stats() {
    return this.get<{
      counts: Record<string, number>;
      gateway_clients: number;
      database: { file: string; schema_version: number; size_bytes: number };
      uptime_ms: number;
      registration_open: boolean;
      data_dir: string;
    }>('/api/admin/overview');
  }

  setRegistration(open: boolean) {
    return this.patch<{ registration_open: boolean }>('/api/admin/config', { registration_open: open });
  }

  whoami() {
    return this.get<{ user: PublicUser; is_operator: boolean }>('/api/admin/whoami');
  }
}
