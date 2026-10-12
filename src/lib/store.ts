/**
 * Application store (zustand).
 *
 * Holds the session, guilds/channels/messages, presence, typing, voice state
 * and every action the UI calls. Gateway events mutate this store; REST calls
 * fill it in.
 */
import { create } from 'zustand';
import { Api } from './api';
import { Gateway, type ConnectionStatus } from './gateway';
import { VoiceEngine, type VoicePeerSnapshot } from './voice';
import { notify, setBadge } from './notifications';
import type {
  Channel,
  ChannelUpdatePayload,
  Dispatch,
  FriendRemovePayload,
  FriendRequestPayload,
  Guild,
  GuildUpdatePayload,
  Message,
  MessageDeleteBulkPayload,
  MessageDeletePayload,
  PresenceUpdatePayload,
  PublicUser,
  ReadStatePayload,
  RelationshipEntry,
  ServerConfig,
  SignalPayload,
  TypingStartPayload,
  UserStatus,
  UserUpdatePayload,
  VoiceSignalPayload,
  VoiceSpeakingPayload,
  VoiceState,
  VoiceStateUpdatePayload,
} from './types';

export type AppView = 'channels' | 'friends' | 'settings';

export interface UiSettings {
  theme: 'dark' | 'midnight' | 'light';
  compactMode: boolean;
  fontSize: 'small' | 'normal' | 'large';
  desktopNotifications: boolean;
  notificationSound: boolean;
  showMembers: boolean;
}

const DEFAULT_SETTINGS: UiSettings = {
  theme: 'dark',
  compactMode: false,
  fontSize: 'normal',
  desktopNotifications: true,
  notificationSound: false,
  showMembers: true,
};

const STORAGE = {
  token: 'neurio.token',
  baseUrl: 'neurio.baseUrl',
  settings: 'neurio.settings',
};

function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE.settings);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UiSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function defaultBaseUrl(): string {
  // `?server=http://host:8790` wins: the Android shell and the desktop app use it to point
  // a freshly installed client at a specific server (and the PWA lets link-invites carry it).
  if (typeof window !== 'undefined') {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('server');
      if (fromQuery) {
        const normalized = fromQuery.replace(/\/+$/, '');
        localStorage.setItem(STORAGE.baseUrl, normalized);
        return normalized;
      }
    } catch {
      /* ignore a malformed query string */
    }
  }
  const stored = localStorage.getItem(STORAGE.baseUrl);
  if (stored) return stored;
  const envUrl = import.meta.env?.VITE_NEURIO_SERVER as string | undefined;
  if (envUrl) return envUrl;
  // Desktop and browser-mode builds are served by the local Node server, so the
  // API lives on the same origin.
  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) return window.location.origin;
  return 'http://127.0.0.1:8790';
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

type GuildWithDetails = Guild & { member_count?: number };

interface StoreState {
  api: Api | null;
  gateway: Gateway | null;
  voiceEngine: VoiceEngine | null;
  baseUrl: string;
  token: string | null;
  user: PublicUser | null;
  config: ServerConfig | null;
  authStatus: 'restoring' | 'anonymous' | 'authenticated';
  connection: ConnectionStatus;
  lastError: string | null;

  guilds: Record<string, GuildWithDetails>;
  guildOrder: string[];
  channels: Record<string, Channel>;
  dmOrder: string[];
  messages: Record<string, Message[]>;
  messageHasMore: Record<string, boolean>;
  readStates: Record<string, { unread: number; mentions: number; lastRead: string | null }>;
  presence: Record<string, PresenceUpdatePayload>;
  typing: Record<string, Record<string, { displayName: string; expiresAt: number }>>;
  voiceStates: Record<string, VoiceState[]>;
  relationships: RelationshipEntry[];
  activeCallChannelId: string | null;
  callPeers: VoicePeerSnapshot[];
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  micMuted: boolean;
  deafened: boolean;
  videoEnabled: boolean;
  screenEnabled: boolean;
  speakingUsers: Record<string, boolean>;
  selfSpeaking: boolean;
  microphoneLevel: number;
  focusedChannelId: string | null;

  view: AppView;
  selectedGuildId: string | null;
  selectedChannelId: string | null;
  settings: UiSettings;
  modal: { kind: string; props?: Record<string, unknown> } | null;
  searchOpen: boolean;
  toasts: Toast[];

  bootstrap(baseUrl?: string): Promise<void>;
  login(username: string, password: string, baseUrl?: string): Promise<void>;
  register(username: string, password: string, displayName: string, baseUrl?: string): Promise<void>;
  logout(): Promise<void>;
  bootstrapData(): Promise<void>;
  selectGuild(guildId: string | null): void;
  setView(view: AppView): void;
  selectChannel(channelId: string): Promise<void>;
  refreshGuild(guildId: string): Promise<void>;
  loadMessages(channelId: string, options?: { before?: string; reset?: boolean }): Promise<void>;
  sendMessage(channelId: string, content: string, options?: { referenceId?: string | null; files?: File[] }): Promise<void>;
  editMessage(messageId: string, content: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  toggleReaction(messageId: string, emoji: string, mine: boolean): Promise<void>;
  togglePin(messageId: string, pinned: boolean): Promise<void>;
  sendTyping(channelId: string): void;
  ackChannel(channelId: string, messageId?: string | null): Promise<void>;
  setStatus(status: UserStatus, customStatus?: string | null): void;

  createGuild(name: string): Promise<string>;
  acceptInvite(code: string): Promise<string>;
  createInvite(guildId: string, channelId?: string): Promise<string>;
  createChannel(guildId: string, name: string, type: 'text' | 'voice' | 'category'): Promise<void>;
  updateChannel(channelId: string, patch: Record<string, unknown>): Promise<void>;
  deleteChannel(channelId: string): Promise<void>;
  setOverwrite(channelId: string, targetId: string, type: 'role' | 'member', allow: number, deny: number): Promise<void>;
  clearOverwrite(channelId: string, targetId: string): Promise<void>;
  updateMember(guildId: string, userId: string, patch: { nickname?: string | null; role_ids?: string[] }): Promise<void>;
  kickMember(guildId: string, userId: string): Promise<void>;
  createRole(guildId: string, input: Record<string, unknown>): Promise<void>;
  updateRole(guildId: string, roleId: string, patch: Record<string, unknown>): Promise<void>;
  deleteRole(guildId: string, roleId: string): Promise<void>;

  addFriend(username: string): Promise<void>;
  acceptFriend(userId: string): Promise<void>;
  removeFriend(userId: string): Promise<void>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  openDm(userId: string): Promise<string>;

  joinVoice(channelId: string, options?: { video?: boolean; screen?: boolean }): Promise<void>;
  leaveVoice(): Promise<void>;
  toggleMute(): void;
  toggleDeafen(): void;
  toggleVideo(): Promise<void>;
  toggleScreen(): Promise<void>;

  updateProfile(patch: { display_name?: string; bio?: string; custom_status?: string | null }): Promise<void>;
  uploadAvatar(file: File): Promise<void>;
  updateSettings(patch: Partial<UiSettings>): void;
  openModal(kind: string, props?: Record<string, unknown>): void;
  closeModal(): void;
  toggleSearch(open?: boolean): void;
  toast(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
}

/* -------------------------------------------------------------------------- */
/* module-level helpers (they read/write the store through useStore)          */
/* -------------------------------------------------------------------------- */

let toastSequence = 0;

export function pushToast(message: string, tone: Toast['tone'] = 'info'): void {
  toastSequence += 1;
  const id = toastSequence;
  useStore.setState((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
  setTimeout(() => useStore.getState().dismissToast(id), tone === 'error' ? 8000 : 4500);
}

function updateBadge(): void {
  const { readStates } = useStore.getState();
  const mentions = Object.values(readStates).reduce((sum, entry) => sum + entry.mentions, 0);
  setBadge(mentions);
}

function applyDispatch(event: Dispatch): void {
  const payload = event.d;
  switch (event.t) {
    case 'MESSAGE_CREATE': {
      const { message } = payload as { message: Message };
      const state = useStore.getState();
      const list = state.messages[message.channel_id] ?? [];
      if (!list.some((existing) => existing.id === message.id)) {
        const next = [...list, message].sort((a, b) => (a.id < b.id ? -1 : 1));
        const focused = state.focusedChannelId === message.channel_id && document.hasFocus();
        const mentionsMe = message.mentions.includes(state.user?.id ?? '');
        const current = state.readStates[message.channel_id] ?? { unread: 0, mentions: 0, lastRead: null };
        const readStates = {
          ...state.readStates,
          [message.channel_id]: focused
            ? { unread: 0, mentions: 0, lastRead: message.id }
            : {
                unread: current.unread + (message.author.id === state.user?.id ? 0 : 1),
                mentions: current.mentions + (mentionsMe ? 1 : 0),
                lastRead: current.lastRead,
              },
        };
        useStore.setState({ messages: { ...state.messages, [message.channel_id]: next }, readStates });
      }

      const fresh = useStore.getState();
      const isMine = message.author.id === fresh.user?.id;
      const focused = fresh.focusedChannelId === message.channel_id && document.hasFocus();
      if (focused) {
        void fresh.ackChannel(message.channel_id, message.id);
      } else if (!isMine) {
        const channel = fresh.channels[message.channel_id];
        const guild = channel?.guild_id ? fresh.guilds[channel.guild_id] : null;
        const label =
          channel?.type === 'dm' || channel?.type === 'group_dm'
            ? message.author.display_name
            : `#${channel?.name ?? 'channel'}${guild ? ` · ${guild.name}` : ''}`;
        void notify(`${message.author.display_name} · ${label}`, message.content.slice(0, 140) || 'Sent an attachment', {
          channelId: message.channel_id,
          enabled: fresh.settings.desktopNotifications,
          playSound: fresh.settings.notificationSound,
        });
      }
      updateBadge();
      return;
    }
    case 'MESSAGE_UPDATE': {
      const { message } = payload as { message: Message };
      const state = useStore.getState();
      const list = state.messages[message.channel_id];
      if (!list) return;
      useStore.setState({
        messages: {
          ...state.messages,
          [message.channel_id]: list.map((existing) => (existing.id === message.id ? message : existing)),
        },
      });
      return;
    }
    case 'MESSAGE_DELETE': {
      const { channel_id, message_id } = payload as MessageDeletePayload;
      const state = useStore.getState();
      const list = state.messages[channel_id];
      if (!list) return;
      useStore.setState({
        messages: { ...state.messages, [channel_id]: list.filter((message) => message.id !== message_id) },
      });
      return;
    }
    case 'MESSAGE_DELETE_BULK': {
      const { channel_id, ids } = payload as MessageDeleteBulkPayload;
      const state = useStore.getState();
      const list = state.messages[channel_id];
      if (!list) return;
      const removed = new Set(ids);
      useStore.setState({
        messages: { ...state.messages, [channel_id]: list.filter((message) => !removed.has(message.id)) },
      });
      return;
    }
    case 'TYPING_START': {
      const typing = payload as TypingStartPayload;
      const state = useStore.getState();
      const channel = { ...(state.typing[typing.channel_id] ?? {}) };
      channel[typing.user_id] = { displayName: typing.display_name, expiresAt: typing.expires_at };
      useStore.setState({ typing: { ...state.typing, [typing.channel_id]: channel } });
      setTimeout(() => {
        const current = useStore.getState();
        const entries = { ...(current.typing[typing.channel_id] ?? {}) };
        const entry = entries[typing.user_id];
        if (entry && entry.expiresAt <= Date.now()) {
          delete entries[typing.user_id];
          useStore.setState({ typing: { ...current.typing, [typing.channel_id]: entries } });
        }
      }, Math.max(500, typing.expires_at - Date.now() + 50));
      return;
    }
    case 'PRESENCE_UPDATE': {
      const presence = payload as PresenceUpdatePayload;
      const state = useStore.getState();
      useStore.setState({ presence: { ...state.presence, [presence.user_id]: presence } });
      return;
    }
    case 'USER_UPDATE': {
      const { user } = payload as UserUpdatePayload;
      const state = useStore.getState();
      useStore.setState({
        user: state.user?.id === user.id ? { ...state.user, ...user } : state.user,
        guilds: Object.fromEntries(
          Object.entries(state.guilds).map(([id, guild]) => [
            id,
            {
              ...guild,
              members: guild.members?.map((member) =>
                member.user.id === user.id ? { ...member, user: { ...member.user, ...user } } : member,
              ),
            },
          ]),
        ),
        relationships: state.relationships.map((relationship) =>
          relationship.user.id === user.id ? { ...relationship, user: { ...relationship.user, ...user } } : relationship,
        ),
      });
      return;
    }
    case 'READ_STATE_UPDATE': {
      const update = payload as ReadStatePayload;
      const state = useStore.getState();
      const current = state.readStates[update.channel_id] ?? { unread: 0, mentions: 0, lastRead: null };
      useStore.setState({
        readStates: {
          ...state.readStates,
          [update.channel_id]: {
            unread: update.last_read_message_id === null ? current.unread : 0,
            mentions: update.mention_count,
            lastRead: update.last_read_message_id ?? current.lastRead,
          },
        },
      });
      updateBadge();
      return;
    }
    case 'FRIEND_REQUEST_CREATE':
    case 'FRIEND_REQUEST_REMOVE': {
      const request = payload as FriendRequestPayload & FriendRemovePayload;
      void useStore
        .getState()
        .api?.relationships()
        .then((response) => useStore.setState({ relationships: response.relationships }))
        .catch(() => undefined);
      if (event.t === 'FRIEND_REQUEST_CREATE' && request.user) {
        pushToast(`${request.user.display_name} sent you a friend request`, 'info');
      } else if (request.accepted) {
        pushToast('Friend request accepted', 'success');
      }
      return;
    }
    case 'GUILD_CREATE':
    case 'GUILD_UPDATE': {
      const { guild } = payload as GuildUpdatePayload;
      if (!guild?.id) return;
      const state = useStore.getState();
      const channels = { ...state.channels };
      for (const channel of guild.channels ?? []) channels[channel.id] = channel;
      useStore.setState({
        guilds: { ...state.guilds, [guild.id]: { ...state.guilds[guild.id], ...guild } },
        guildOrder: state.guildOrder.includes(guild.id) ? state.guildOrder : [...state.guildOrder, guild.id],
        channels,
      });
      return;
    }
    case 'GUILD_DELETE': {
      const { id } = payload as { id: string };
      const state = useStore.getState();
      const guilds = { ...state.guilds };
      delete guilds[id];
      const wasSelected = state.selectedGuildId === id;
      useStore.setState({
        guilds,
        guildOrder: state.guildOrder.filter((guildId) => guildId !== id),
        selectedGuildId: wasSelected ? null : state.selectedGuildId,
        selectedChannelId: wasSelected ? null : state.selectedChannelId,
        view: wasSelected ? 'friends' : state.view,
      });
      return;
    }
    case 'CHANNEL_CREATE': {
      const { channel } = payload as { channel: Channel };
      const state = useStore.getState();
      const guild = channel.guild_id ? state.guilds[channel.guild_id] : null;
      useStore.setState({
        channels: { ...state.channels, [channel.id]: channel },
        dmOrder:
          (channel.type === 'dm' || channel.type === 'group_dm') && !state.dmOrder.includes(channel.id)
            ? [channel.id, ...state.dmOrder]
            : state.dmOrder,
        guilds:
          guild && !(guild.channels ?? []).some((existing) => existing.id === channel.id)
            ? { ...state.guilds, [channel.guild_id!]: { ...guild, channels: [...(guild.channels ?? []), channel] } }
            : state.guilds,
      });
      return;
    }
    case 'CHANNEL_UPDATE': {
      const { channel } = payload as ChannelUpdatePayload;
      if (!channel?.id) return;
      const state = useStore.getState();
      if (channel.removed) {
        const channels = { ...state.channels };
        delete channels[channel.id];
        useStore.setState({ channels, dmOrder: state.dmOrder.filter((id) => id !== channel.id) });
        return;
      }
      useStore.setState({
        channels: { ...state.channels, [channel.id]: channel },
        guilds: channel.guild_id
          ? {
              ...state.guilds,
              [channel.guild_id]: {
                ...state.guilds[channel.guild_id],
                channels: (state.guilds[channel.guild_id]?.channels ?? []).map((existing) =>
                  existing.id === channel.id ? channel : existing,
                ),
              },
            }
          : state.guilds,
      });
      return;
    }
    case 'CHANNEL_DELETE': {
      const { channel_id } = payload as { channel_id: string };
      const state = useStore.getState();
      const channels = { ...state.channels };
      const removed = channels[channel_id];
      delete channels[channel_id];
      useStore.setState({
        channels,
        dmOrder: state.dmOrder.filter((id) => id !== channel_id),
        selectedChannelId: state.selectedChannelId === channel_id ? null : state.selectedChannelId,
        guilds:
          removed?.guild_id && state.guilds[removed.guild_id]
            ? {
                ...state.guilds,
                [removed.guild_id]: {
                  ...state.guilds[removed.guild_id],
                  channels: (state.guilds[removed.guild_id]?.channels ?? []).filter((c) => c.id !== channel_id),
                },
              }
            : state.guilds,
      });
      return;
    }
    case 'GUILD_MEMBER_ADD':
    case 'GUILD_MEMBER_UPDATE':
    case 'GUILD_MEMBER_REMOVE': {
      const data = payload as { guild_id: string; member?: { user: { id: string } }; user_id?: string };
      void useStore.getState().refreshGuild(data.guild_id);
      return;
    }
    case 'GUILD_ROLE_CREATE':
    case 'GUILD_ROLE_UPDATE':
    case 'GUILD_ROLE_DELETE': {
      void useStore.getState().refreshGuild((payload as { guild_id: string }).guild_id);
      return;
    }
    case 'VOICE_STATE_UPDATE': {
      const update = payload as VoiceStateUpdatePayload;
      const state = useStore.getState();
      const merged = new Map((update.states ?? []).map((entry) => [entry.user_id, entry]));
      const next = [...merged.values()].filter((entry) => entry.channel_id === update.channel_id);
      useStore.setState({
        voiceStates: { ...state.voiceStates, [update.channel_id]: next },
        speakingUsers: update.user_id && update.state === null
          ? { ...state.speakingUsers, [update.user_id]: false }
          : state.speakingUsers,
      });
      if (state.voiceEngine?.channelId === update.channel_id) state.voiceEngine.syncRoster(update.states ?? []);
      return;
    }
    case 'VOICE_SPEAKING': {
      const speaking = payload as VoiceSpeakingPayload;
      const state = useStore.getState();
      useStore.setState({ speakingUsers: { ...state.speakingUsers, [speaking.user_id]: speaking.speaking } });
      state.voiceEngine?.applySpeaking(speaking.user_id, speaking.speaking);
      return;
    }
    case 'VOICE_SIGNAL': {
      const signal = payload as VoiceSignalPayload;
      void useStore.getState().voiceEngine?.handleSignal(signal.from_user_id, signal.payload as SignalPayload);
      return;
    }
    case 'SESSION_REVOKED': {
      pushToast('Your session was signed out remotely', 'error');
      void useStore.getState().logout();
      return;
    }
    default:
      return;
  }
}

async function refreshGuildData(): Promise<void> {
  const { api } = useStore.getState();
  if (!api) return;
  const list = await api.guilds();
  const state = useStore.getState();
  useStore.setState({
    guildOrder: list.guilds.map((guild) => guild.id),
    guilds: { ...state.guilds, ...Object.fromEntries(list.guilds.map((guild) => [guild.id, guild])) },
  });
  for (const guild of list.guilds) void useStore.getState().refreshGuild(guild.id);
  const voiceResults = await Promise.all(
    list.guilds.map((guild) =>
      api
        .voiceStates(guild.id)
        .then((response) => response.states)
        .catch(() => [] as VoiceState[]),
    ),
  );
  const current = useStore.getState();
  const voiceStates = { ...current.voiceStates };
  for (const states of voiceResults) {
    for (const state of states) {
      voiceStates[state.channel_id] = [
        ...(voiceStates[state.channel_id] ?? []).filter((entry) => entry.user_id !== state.user_id),
        state,
      ];
    }
  }
  useStore.setState({ voiceStates });
}

/** Identity of the live gateway socket, so a re-bootstrap never needlessly reconnects. */
let gatewayKey: string | null = null;

function connectGateway(): void {
  const { baseUrl, token, user, config, gateway: previous } = useStore.getState();
  if (!token || !user) return;

  const key = `${baseUrl}|${token}`;
  if (previous && gatewayKey === key && previous.status !== 'closed') {
    // Already connected to this server as this user — keep the socket and its state.
    return;
  }

  previous?.disconnect();

  const gateway = new Gateway(baseUrl, token);
  gateway.on({
    onReady: () => void refreshGuildData(),
    onDispatch: applyDispatch,
    onError: (code, message) => {
      if (code === 'invalid_session') {
        localStorage.removeItem(STORAGE.token);
        useStore.setState({ authStatus: 'anonymous', token: null, user: null });
      } else {
        pushToast(message, 'error');
      }
    },
  });
  gateway.onStatus((status) => useStore.setState({ connection: status }));

  const voiceEngine = new VoiceEngine({
    gateway,
    userId: user.id,
    iceServers: config?.ice_servers ?? [],
    events: {
      onPeersChanged: (peers) => useStore.setState({ callPeers: peers }),
      onLocalStream: (stream) => useStore.setState({ localStream: stream }),
      onScreenStream: (stream) => useStore.setState({ screenStream: stream }),
      onSpeaking: (speaking) => {
        const state = useStore.getState();
        useStore.setState({
          selfSpeaking: speaking,
          speakingUsers: state.user ? { ...state.speakingUsers, [state.user.id]: speaking } : state.speakingUsers,
        });
      },
      onMicrophoneLevel: (level) => useStore.setState({ microphoneLevel: level }),
      onError: (message) => pushToast(message, 'error'),
    },
  });

  gatewayKey = key;
  useStore.setState({ gateway, voiceEngine });
  gateway.connect();
}

/* -------------------------------------------------------------------------- */
/* the store                                                                  */
/* -------------------------------------------------------------------------- */

export const useStore = create<StoreState>((set, get) => ({
  api: null,
  gateway: null,
  voiceEngine: null,
  baseUrl: defaultBaseUrl(),
  token: null,
  user: null,
  config: null,
  authStatus: 'restoring',
  connection: 'idle',
  lastError: null,

  guilds: {},
  guildOrder: [],
  channels: {},
  dmOrder: [],
  messages: {},
  messageHasMore: {},
  readStates: {},
  presence: {},
  typing: {},
  voiceStates: {},
  relationships: [],
  activeCallChannelId: null,
  callPeers: [],
  localStream: null,
  screenStream: null,
  micMuted: false,
  deafened: false,
  videoEnabled: false,
  screenEnabled: false,
  speakingUsers: {},
  selfSpeaking: false,
  microphoneLevel: 0,
  focusedChannelId: null,

  view: 'channels',
  selectedGuildId: null,
  selectedChannelId: null,
  settings: loadSettings(),
  modal: null,
  searchOpen: false,
  toasts: [],

  async bootstrap(baseUrl) {
    const url = (baseUrl ?? get().baseUrl).replace(/\/$/, '');
    localStorage.setItem(STORAGE.baseUrl, url);
    const token = localStorage.getItem(STORAGE.token);
    const api = new Api({ baseUrl: url, token });
    set({ api, baseUrl: url, token });

    try {
      const config = await api.serverConfig();
      set({ config, lastError: null });
    } catch {
      set({ authStatus: 'anonymous', lastError: `Cannot reach a Neurio server at ${url}` });
      return;
    }

    if (!token) {
      set({ authStatus: 'anonymous' });
      return;
    }

    try {
      const session = await api.session();
      set({ user: session.user, config: session.config, authStatus: 'authenticated', lastError: null });
      await get().bootstrapData();
      connectGateway();
    } catch {
      localStorage.removeItem(STORAGE.token);
      set({ authStatus: 'anonymous', token: null });
    }
  },

  async login(username, password, baseUrl) {
    const url = (baseUrl ?? get().baseUrl).replace(/\/$/, '');
    localStorage.setItem(STORAGE.baseUrl, url);
    const api = new Api({ baseUrl: url });
    const result = await api.login({ username, password });
    api.token = result.token;
    localStorage.setItem(STORAGE.token, result.token);
    set({ api, baseUrl: url, token: result.token, user: result.user, authStatus: 'authenticated', lastError: null });
    set({ config: await api.serverConfig().catch(() => null) });
    await get().bootstrapData();
    connectGateway();
  },

  async register(username, password, displayName, baseUrl) {
    const url = (baseUrl ?? get().baseUrl).replace(/\/$/, '');
    localStorage.setItem(STORAGE.baseUrl, url);
    const api = new Api({ baseUrl: url });
    const result = await api.register({ username, password, display_name: displayName });
    api.token = result.token;
    localStorage.setItem(STORAGE.token, result.token);
    set({ api, baseUrl: url, token: result.token, user: result.user, authStatus: 'authenticated', lastError: null });
    set({ config: await api.serverConfig().catch(() => null) });
    await get().bootstrapData();
    connectGateway();
  },

  async logout() {
    gatewayKey = null;
    const { api, gateway, voiceEngine, baseUrl } = get();
    voiceEngine?.destroy();
    gateway?.disconnect();
    await api?.logout().catch(() => undefined);
    localStorage.removeItem(STORAGE.token);
    set({
      api: new Api({ baseUrl }),
      gateway: null,
      voiceEngine: null,
      token: null,
      user: null,
      authStatus: 'anonymous',
      guilds: {},
      guildOrder: [],
      channels: {},
      dmOrder: [],
      messages: {},
      messageHasMore: {},
      readStates: {},
      presence: {},
      typing: {},
      voiceStates: {},
      relationships: [],
      activeCallChannelId: null,
      callPeers: [],
      selectedGuildId: null,
      selectedChannelId: null,
      focusedChannelId: null,
      view: 'channels',
      connection: 'idle',
    });
    setBadge(0);
  },

  async bootstrapData() {
    const { api } = get();
    if (!api) return;
    try {
      const [guildList, dmList, relationshipList, readStates] = await Promise.all([
        api.guilds(),
        api.dms(),
        api.relationships(),
        api.readStates(),
      ]);
      const previous = get();
      // `/api/guilds` returns summaries — merge them so channels we already have
      // (from GUILD_CREATE / createGuild) are not thrown away.
      const guilds: Record<string, GuildWithDetails> = {};
      for (const summary of guildList.guilds) {
        guilds[summary.id] = { ...(previous.guilds[summary.id] ?? {}), ...summary };
      }
      const channels: Record<string, Channel> = {};
      for (const channel of Object.values(previous.channels)) {
        if (guilds[channel.guild_id ?? '']) channels[channel.id] = channel;
      }
      for (const channel of dmList.channels) channels[channel.id] = channel;

      const readMap: StoreState['readStates'] = {};
      for (const entry of readStates.unread) {
        readMap[entry.channel_id] = {
          unread: entry.unread_count,
          mentions: entry.mention_count,
          lastRead: entry.last_message_id,
        };
      }
      set({
        guilds,
        guildOrder: guildList.guilds.map((guild) => guild.id),
        channels,
        dmOrder: dmList.channels.map((channel) => channel.id),
        relationships: relationshipList.relationships,
        readStates: readMap,
        selectedGuildId: get().selectedGuildId ?? guildList.guilds[0]?.id ?? null,
      });
      updateBadge();

      // Guilds we only know as summaries get their channels fetched in the
      // background, so the sidebar fills in even before the gateway says READY.
      for (const summary of guildList.guilds) {
        if (!get().guilds[summary.id]?.channels) void get().refreshGuild(summary.id);
      }
    } catch (error) {
      pushToast(`Could not load your data: ${(error as Error).message}`, 'error');
    }
  },

  setView(view) {
    set({ view });
  },

  selectGuild(guildId) {
    const guild = guildId ? get().guilds[guildId] : null;
    const firstText = guild?.channels?.find((channel) => channel.type === 'text');
    set({ selectedGuildId: guildId, view: 'channels', selectedChannelId: firstText?.id ?? null });
    if (firstText) void get().selectChannel(firstText.id);
    if (guildId) void get().refreshGuild(guildId);
  },

  async selectChannel(channelId) {
    const channel = get().channels[channelId];
    set({
      selectedChannelId: channelId,
      focusedChannelId: channelId,
      view: 'channels',
      selectedGuildId: channel?.guild_id ?? get().selectedGuildId,
    });
    if (!get().messages[channelId]) await get().loadMessages(channelId, { reset: true });
    await get().ackChannel(channelId, null);
  },

  async refreshGuild(guildId) {
    const { api } = get();
    if (!api || !get().guilds[guildId]) return;
    try {
      const response = await api.guild(guildId);
      const state = get();
      const channels = { ...state.channels };
      for (const channel of response.guild.channels ?? []) channels[channel.id] = channel;
      set({ guilds: { ...state.guilds, [guildId]: response.guild }, channels });
    } catch {
      /* the guild may have been deleted meanwhile */
    }
  },

  async loadMessages(channelId, options = {}) {
    const { api } = get();
    if (!api) return;
    const existing = get().messages[channelId] ?? [];
    const before = options.before ?? (options.reset ? undefined : existing[0]?.id);
    try {
      const response = await api.messages(channelId, { before, limit: 50 });
      const current = options.reset || !before ? [] : get().messages[channelId] ?? [];
      const merged = [...response.messages, ...current].filter(
        (message, index, list) => list.findIndex((other) => other.id === message.id) === index,
      );
      merged.sort((a, b) => (a.id < b.id ? -1 : 1));
      const last = merged[merged.length - 1];
      const state = get();
      set({
        messages: { ...state.messages, [channelId]: merged },
        messageHasMore: { ...state.messageHasMore, [channelId]: response.messages.length >= 50 },
        readStates: {
          ...state.readStates,
          [channelId]: {
            unread: 0,
            mentions: 0,
            lastRead: last?.id ?? state.readStates[channelId]?.lastRead ?? null,
          },
        },
      });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async sendMessage(channelId, content, options = {}) {
    const { api } = get();
    if (!api) return;
    try {
      let uploadIds: string[] = [];
      if (options.files && options.files.length > 0) {
        const uploaded = await api.uploadFiles(options.files);
        uploadIds = uploaded.attachments.map((attachment) => attachment.id);
      }
      const trimmed = content.trim();
      if (trimmed.length === 0 && uploadIds.length === 0) return;
      const response = await api.sendMessage(channelId, {
        content: trimmed,
        reference_id: options.referenceId ?? null,
        upload_ids: uploadIds,
      });
      const state = get();
      const list = state.messages[channelId] ?? [];
      if (!list.some((message) => message.id === response.message.id)) {
        set({ messages: { ...state.messages, [channelId]: [...list, response.message] } });
      }
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async editMessage(messageId, content) {
    const { api } = get();
    if (!api) return;
    try {
      const response = await api.editMessage(messageId, content);
      const state = get();
      const list = state.messages[response.message.channel_id];
      if (!list) return;
      set({
        messages: {
          ...state.messages,
          [response.message.channel_id]: list.map((message) => (message.id === messageId ? response.message : message)),
        },
      });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async deleteMessage(messageId) {
    const { api } = get();
    if (!api) return;
    const state = get();
    const channelId = Object.keys(state.messages).find((id) =>
      state.messages[id].some((message) => message.id === messageId),
    );
    try {
      await api.deleteMessage(messageId);
      if (channelId) {
        const list = get().messages[channelId] ?? [];
        set({ messages: { ...get().messages, [channelId]: list.filter((message) => message.id !== messageId) } });
      }
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async toggleReaction(messageId, emoji, mine) {
    const { api } = get();
    if (!api) return;
    try {
      if (mine) await api.removeReaction(messageId, emoji);
      else await api.addReaction(messageId, emoji);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async togglePin(messageId, pinned) {
    const { api } = get();
    if (!api) return;
    try {
      if (pinned) await api.unpinMessage(messageId);
      else await api.pinMessage(messageId);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  sendTyping(channelId) {
    get().gateway?.typing(channelId);
  },

  async ackChannel(channelId, messageId) {
    const { api } = get();
    const messages = get().messages[channelId] ?? [];
    const last = messageId ?? messages[messages.length - 1]?.id ?? null;
    const state = get();
    set({ readStates: { ...state.readStates, [channelId]: { unread: 0, mentions: 0, lastRead: last } } });
    updateBadge();
    if (!api) return;
    try {
      await api.ack(channelId, last);
    } catch {
      /* best effort */
    }
  },

  setStatus(status, customStatus) {
    const { user, gateway } = get();
    gateway?.setPresence(status, customStatus);
    if (user) set({ user: { ...user, status, custom_status: customStatus ?? user.custom_status } });
  },

  async createGuild(name) {
    const { api } = get();
    if (!api) throw new Error('Not signed in');
    const response = await api.createGuild({ name });
    const state = get();
    const channels = { ...state.channels };
    for (const channel of response.guild.channels ?? []) channels[channel.id] = channel;
    set({
      guilds: { ...state.guilds, [response.guild.id]: response.guild },
      guildOrder: [...state.guildOrder, response.guild.id],
      channels,
    });
    return response.guild.id;
  },

  async acceptInvite(code) {
    const { api } = get();
    if (!api) throw new Error('Not signed in');
    const trimmed = code
      .trim()
      .replace(/^.*\/invite\//, '')
      .replace(/^#/, '');
    const response = await api.acceptInvite(trimmed);
    const state = get();
    const channels = { ...state.channels };
    for (const channel of response.guild.channels ?? []) channels[channel.id] = channel;
    set({
      guilds: { ...state.guilds, [response.guild.id]: response.guild },
      guildOrder: state.guildOrder.includes(response.guild.id)
        ? state.guildOrder
        : [...state.guildOrder, response.guild.id],
      channels,
      selectedGuildId: response.guild.id,
    });
    return response.guild.id;
  },

  async createInvite(guildId, channelId) {
    const { api } = get();
    if (!api) throw new Error('Not signed in');
    const response = await api.createInvite(guildId, { channel_id: channelId, max_uses: 0, max_age_seconds: null });
    return response.invite.code;
  },

  async createChannel(guildId, name, type) {
    const { api } = get();
    if (!api) return;
    try {
      const response = await api.createChannel(guildId, { name, type });
      const state = get();
      set({
        channels: { ...state.channels, [response.channel.id]: response.channel },
        guilds: {
          ...state.guilds,
          [guildId]: {
            ...state.guilds[guildId],
            channels: [...(state.guilds[guildId]?.channels ?? []), response.channel],
          },
        },
      });
      if (type === 'text') await get().selectChannel(response.channel.id);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async updateChannel(channelId, patch) {
    const { api } = get();
    if (!api) return;
    try {
      const response = await api.updateChannel(channelId, patch);
      const state = get();
      set({
        channels: { ...state.channels, [channelId]: response.channel },
        guilds: response.channel.guild_id
          ? {
              ...state.guilds,
              [response.channel.guild_id]: {
                ...state.guilds[response.channel.guild_id],
                channels: (state.guilds[response.channel.guild_id]?.channels ?? []).map((channel) =>
                  channel.id === channelId ? response.channel : channel,
                ),
              },
            }
          : state.guilds,
      });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async deleteChannel(channelId) {
    const { api } = get();
    if (!api) return;
    const channel = get().channels[channelId];
    try {
      await api.deleteChannel(channelId);
      const state = get();
      const channels = { ...state.channels };
      delete channels[channelId];
      set({
        channels,
        dmOrder: state.dmOrder.filter((id) => id !== channelId),
        selectedChannelId: state.selectedChannelId === channelId ? null : state.selectedChannelId,
        guilds:
          channel?.guild_id && state.guilds[channel.guild_id]
            ? {
                ...state.guilds,
                [channel.guild_id]: {
                  ...state.guilds[channel.guild_id],
                  channels: (state.guilds[channel.guild_id]?.channels ?? []).filter((c) => c.id !== channelId),
                },
              }
            : state.guilds,
      });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async setOverwrite(channelId, targetId, type, allow, deny) {
    const { api } = get();
    if (!api) return;
    try {
      await api.setOverwrite(channelId, targetId, { type, allow, deny });
      pushToast('Channel permissions updated', 'success');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async clearOverwrite(channelId, targetId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.deleteOverwrite(channelId, targetId);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async updateMember(guildId, userId, patch) {
    const { api } = get();
    if (!api) return;
    try {
      await api.updateMember(guildId, userId, patch);
      await get().refreshGuild(guildId);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async kickMember(guildId, userId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.kickMember(guildId, userId);
      await get().refreshGuild(guildId);
      pushToast('Member removed', 'success');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async createRole(guildId, input) {
    const { api } = get();
    if (!api) return;
    try {
      await api.createRole(guildId, input);
      await get().refreshGuild(guildId);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async updateRole(guildId, roleId, patch) {
    const { api } = get();
    if (!api) return;
    try {
      await api.updateRole(guildId, roleId, patch);
      await get().refreshGuild(guildId);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async deleteRole(guildId, roleId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.deleteRole(guildId, roleId);
      await get().refreshGuild(guildId);
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async addFriend(username) {
    const { api } = get();
    if (!api) return;
    try {
      const response = await api.addFriend({ username });
      pushToast(response.accepted ? 'You are now friends!' : `Friend request sent to ${username}`, 'success');
      set({ relationships: (await api.relationships()).relationships });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async acceptFriend(userId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.acceptFriend(userId);
      set({ relationships: (await api.relationships()).relationships });
      pushToast('Friend added', 'success');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async removeFriend(userId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.removeFriend(userId);
      set({ relationships: (await api.relationships()).relationships });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async blockUser(userId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.blockUser(userId);
      set({ relationships: (await api.relationships()).relationships });
      pushToast('User blocked', 'success');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async unblockUser(userId) {
    const { api } = get();
    if (!api) return;
    try {
      await api.unblockUser(userId);
      set({ relationships: (await api.relationships()).relationships });
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async openDm(userId) {
    const { api } = get();
    if (!api) throw new Error('Not signed in');
    const response = await api.openDm(userId);
    const state = get();
    set({
      channels: { ...state.channels, [response.channel.id]: response.channel },
      dmOrder: state.dmOrder.includes(response.channel.id)
        ? state.dmOrder
        : [response.channel.id, ...state.dmOrder],
    });
    await get().selectChannel(response.channel.id);
    return response.channel.id;
  },

  async joinVoice(channelId, options = {}) {
    const { gateway, user, voiceEngine } = get();
    if (!gateway || !user) return;
    if (voiceEngine?.channelId === channelId) return;
    if (!voiceEngine) {
      pushToast('Voice is unavailable until the gateway reconnects', 'error');
      return;
    }
    try {
      await voiceEngine.join({
        channelId,
        selfMute: get().micMuted,
        selfDeaf: get().deafened,
        video: options.video ?? false,
        screen: options.screen ?? false,
      });
      const channel = get().channels[channelId];
      if (channel?.guild_id) {
        const api = get().api;
        const states = await api?.voiceStates(channel.guild_id).catch(() => null);
        if (states) voiceEngine.syncRoster(states.states.filter((state) => state.channel_id === channelId));
      }
      set({
        activeCallChannelId: channelId,
        videoEnabled: (voiceEngine.localStream?.getVideoTracks().length ?? 0) > 0,
      });
    } catch (error) {
      pushToast(`Could not join voice: ${(error as Error).message}`, 'error');
    }
  },

  async leaveVoice() {
    await get().voiceEngine?.leave();
    set({
      activeCallChannelId: null,
      callPeers: [],
      localStream: null,
      screenStream: null,
      videoEnabled: false,
      screenEnabled: false,
      selfSpeaking: false,
    });
  },

  toggleMute() {
    const next = !get().micMuted;
    set({ micMuted: next });
    get().voiceEngine?.setMuted(next);
  },

  toggleDeafen() {
    const next = !get().deafened;
    set({ deafened: next, micMuted: next ? true : get().micMuted });
    get().voiceEngine?.setDeafened(next);
  },

  async toggleVideo() {
    const engine = get().voiceEngine;
    if (!engine?.channelId) return;
    const next = !get().videoEnabled;
    try {
      await engine.enableVideo(next);
      set({ videoEnabled: next });
    } catch (error) {
      pushToast(`Camera unavailable: ${(error as Error).message}`, 'error');
    }
  },

  async toggleScreen() {
    const engine = get().voiceEngine;
    if (!engine?.channelId) return;
    const next = !get().screenEnabled;
    try {
      await engine.enableScreen(next);
      set({ screenEnabled: next });
    } catch (error) {
      pushToast(`Screen sharing cancelled: ${(error as Error).message}`, 'error');
    }
  },

  async updateProfile(patch) {
    const { api } = get();
    if (!api) return;
    try {
      const response = await api.updateProfile(patch);
      set({ user: response.user });
      pushToast('Profile saved', 'success');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  async uploadAvatar(file) {
    const { api } = get();
    if (!api) return;
    try {
      const response = await api.uploadAvatar(file);
      set({ user: response.user });
      pushToast('Avatar updated', 'success');
    } catch (error) {
      pushToast((error as Error).message, 'error');
    }
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    localStorage.setItem(STORAGE.settings, JSON.stringify(settings));
    set({ settings });
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.fontSize = settings.fontSize;
    document.documentElement.dataset.compact = settings.compactMode ? 'true' : 'false';
  },

  openModal(kind, props) {
    set({ modal: { kind, props } });
  },

  closeModal() {
    set({ modal: null });
  },

  toggleSearch(open) {
    set((state) => ({ searchOpen: open ?? !state.searchOpen }));
  },

  toast(message, tone = 'info') {
    pushToast(message, tone);
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }));
  },
}));

/** Apply the stored theme on first paint. */
export function applyInitialTheme(): void {
  const settings = loadSettings();
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.fontSize = settings.fontSize;
  document.documentElement.dataset.compact = settings.compactMode ? 'true' : 'false';
}

export type { Channel, Message, PublicUser };
