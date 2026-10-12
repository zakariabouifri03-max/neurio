#!/usr/bin/env node
/**
 * Seeds a friendly demo workspace so a fresh install has something to look at.
 *
 *   npm run seed                              # seeds the local data directory
 *   npm run seed -- --url http://127.0.0.1:8790
 *   npm run seed -- --no-start                # fail when no server is running
 *
 * If a server is already listening it is reused; otherwise one is started
 * temporarily (port 0, same data directory) and stopped again afterwards.
 *
 * What it creates — all local, no external service:
 *   accounts     operator / alice / bob / carol
 *   server       "Neurio HQ": text + voice channels, categories, private #staff
 *   roles        Founder (administrator) and a hoisted Moderator
 *   content      welcome text, a conversation, a reply, reactions, a pin
 *   social       friendships, a pending friend request, a direct message
 *   invites      a permanent invite code, printed at the end
 *
 * Running it twice is safe: it detects the existing server and does nothing.
 */
import { createApp, type NeurioApp } from './app';
import { configFromArgv, parseArgs } from './config';
import { Permissions } from '../shared/permissions';
import type { Channel, Guild, Role } from '../shared/types';

/* ---------------------------------- argv --------------------------------- */

const argv = process.argv.slice(2);
const { flags } = parseArgs(argv);
const flag = (name: string): string | null => (typeof flags.get(name) === 'string' ? (flags.get(name) as string) : null);

const explicitUrl = flag('url');
const operatorPassword = flag('password') ?? 'neurio-operator';
const memberPassword = flag('member-password') ?? 'neurio-demo';
const noStart = flags.get('no-start') === true;
const quiet = flags.get('quiet') === true;
const config = configFromArgv(argv, { dataDir: flag('data-dir') ?? undefined });

const log = (message: string): void => {
  if (!quiet) console.log(`  ${message}`);
};

/* --------------------------------- client -------------------------------- */

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class SeedClient {
  token: string | null = null;

  constructor(readonly base: string) {}

  async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { error?: { code?: string; message?: string } }) : {};
    if (!response.ok) {
      const error = payload.error ?? {};
      const detail = error.message ?? (text ? text.slice(0, 300) : `HTTP ${response.status}`);
      throw new HttpError(response.status, error.code ?? 'unknown', detail);
    }
    return payload as T;
  }

  get = <T>(path: string) => this.request<T>('GET', path);
  post = <T>(path: string, body?: unknown) => this.request<T>('POST', path, body);
  put = <T>(path: string, body?: unknown) => this.request<T>('PUT', path, body);
  patch = <T>(path: string, body?: unknown) => this.request<T>('PATCH', path, body);

  async register(username: string, password: string, displayName: string): Promise<boolean> {
    try {
      const result = await this.request<{ token: string }>(
        'POST',
        '/api/auth/register',
        { username, password, display_name: displayName },
        false,
      );
      this.token = result.token;
      return true;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 409 || error.code === 'registration_closed')) {
        await this.login(username, password);
        return false;
      }
      throw error;
    }
  }

  async login(username: string, password: string): Promise<void> {
    const result = await this.request<{ token: string }>('POST', '/api/auth/login', { username, password }, false);
    this.token = result.token;
  }

  async me(): Promise<string> {
    const result = await this.get<{ user: { id: string } }>('/api/users/@me');
    return result.user.id;
  }
}

/* -------------------------------- scenarios ------------------------------ */

const ACCOUNTS = [
  { username: 'operator', display: 'Server Operator', operator: true },
  { username: 'alice', display: 'Alice', operator: false },
  { username: 'bob', display: 'Bob', operator: false },
  { username: 'carol', display: 'Carol', operator: false },
] as const;

type Actor = 'operator' | 'alice' | 'bob' | 'carol';

/** Message templates; placeholders are filled in with real ids before posting. */
const CONVERSATION: Array<{ channel: string; as: Actor; content: string }> = [
  {
    channel: 'welcome',
    as: 'operator',
    content: 'Welcome to **Neurio HQ** — a demo workspace running entirely on this machine.',
  },
  {
    channel: 'welcome',
    as: 'operator',
    content:
      'Worth trying:\n' +
      '- `#general` for replies, reactions and edits\n' +
      '- ➕ the voice channel for a real WebRTC call (camera and screen sharing included)\n' +
      '- 🔍 in the channel header to search every message\n' +
      '- Settings → Sessions to see and revoke your own logins',
  },
  { channel: 'welcome', as: 'alice', content: 'Everything is local: SQLite on disk, uploads in a folder, no cloud services at all 👋' },
  { channel: 'welcome', as: 'bob', content: 'And it is open source, so hosting it for friends is just a matter of running one Node process.' },
  { channel: 'general', as: 'alice', content: 'Morning everyone ☀️ what is on the list today?' },
  { channel: 'general', as: 'bob', content: 'Finishing the screen-share controls — sharing a whole screen or a single window both work.' },
  {
    channel: 'general',
    as: 'operator',
    content: 'Great. Gentle reminder: be kind, keep it on topic, and use replies so threads stay readable 🙂',
  },
  {
    channel: 'general',
    as: 'carol',
    content: 'Testing mentions — does <@operator-id> ping you? And the role ping <@&moderator-role>. Channel link: <#devtalk-channel>.',
  },
  {
    channel: 'dev-talk',
    as: 'bob',
    content: '```ts\nconst server = await createApp({ port: 8790 });\nawait server.start();\n```\nThat is the whole backend entry point.',
  },
  {
    channel: 'dev-talk',
    as: 'alice',
    content: 'Presence, typing indicators and unread counts ride the same gateway socket, so they update instantly.',
  },
  { channel: 'random', as: 'carol', content: 'Pinned this so nobody forgets: the portable build needs no installer at all. 📌' },
  {
    channel: 'staff',
    as: 'operator',
    content: 'Private channel — only Founder and Moderator can read #staff. Sign in as carol and it will not even appear.',
  },
];

const REACTIONS: Array<{ channel: string; index: number; emoji: string; as: Actor }> = [
  { channel: 'welcome', index: 0, emoji: '🎉', as: 'alice' },
  { channel: 'welcome', index: 0, emoji: '🚀', as: 'bob' },
  { channel: 'general', index: 1, emoji: '👍', as: 'carol' },
  { channel: 'random', index: 0, emoji: '📌', as: 'alice' },
];

const MODERATOR_PERMISSIONS =
  Permissions.VIEW_CHANNEL |
  Permissions.SEND_MESSAGES |
  Permissions.MANAGE_MESSAGES |
  Permissions.MANAGE_CHANNELS |
  Permissions.KICK_MEMBERS |
  Permissions.BAN_MEMBERS |
  Permissions.CREATE_INVITE |
  Permissions.ATTACH_FILES |
  Permissions.ADD_REACTIONS |
  Permissions.CONNECT_VOICE |
  Permissions.SPEAK |
  Permissions.VIDEO |
  Permissions.MENTION_EVERYONE |
  Permissions.CHANGE_NICKNAME;

/* --------------------------------- seeder -------------------------------- */

async function seed(client: SeedClient): Promise<void> {
  const health = await client.get<{ name: string; version: string }>('/api/health');
  log(`connected to ${health.name} ${health.version} at ${client.base}`);

  // ---- accounts ---------------------------------------------------------
  const created: string[] = [];
  for (const account of ACCOUNTS) {
    const password = account.operator ? operatorPassword : memberPassword;
    const isNew = await client.register(account.username, password, account.display);
    if (isNew) created.push(account.username);
  }
  if (created.length) log(`created account(s): ${created.join(', ')}`);

  await client.login('operator', operatorPassword);
  const operatorId = await client.me();

  const members: Record<'alice' | 'bob' | 'carol', SeedClient> = {} as never;
  for (const username of ['alice', 'bob', 'carol'] as const) {
    const member = new SeedClient(client.base);
    await member.login(username, memberPassword);
    members[username] = member;
  }

  const actor = (who: Actor): SeedClient => (who === 'operator' ? client : members[who]);

  // ---- server -----------------------------------------------------------
  const existing = (await client.get<{ guilds: Guild[] }>('/api/guilds')).guilds.find((entry) => entry.name === 'Neurio HQ');
  if (existing) {
    log(`"${existing.name}" already exists (${existing.id}) — nothing to do`);
    return;
  }

  const createdGuild = await client.post<{ guild: Guild & { channels: Channel[]; roles: Role[] } }>('/api/guilds', {
    name: 'Neurio HQ',
    description: 'Demo workspace created by `npm run seed`. Everything runs locally.',
  });
  const guild = createdGuild.guild;
  const guildId = guild.id;
  log(`created server "Neurio HQ" (${guildId})`);

  // Fresh servers ship with #general, a voice channel and a Moderator role.
  const initial = await client.get<{ guild: Guild & { channels: Channel[]; roles: Role[] } }>(`/api/guilds/${guildId}`);
  const lounge = initial.guild.channels.find((channel) => channel.type === 'voice')!;
  // The starter voice channel becomes "General Voice" instead of adding a duplicate.
  const generalVoice = (await client.patch<{ channel: Channel }>(`/api/channels/${lounge.id}`, {
    name: 'General Voice',
    topic: 'Drop-in voice channel',
  })).channel;

  const createChannel = async (name: string, type: 'text' | 'voice' | 'category', topic?: string, parentId?: string) =>
    (
      await client.post<{ channel: Channel }>(`/api/guilds/${guildId}/channels`, {
        name,
        type,
        topic: topic ?? null,
        parent_id: parentId ?? null,
      })
    ).channel;

  const textCategory = await createChannel('Text channels', 'category');
  const voiceCategory = await createChannel('Voice channels', 'category');
  const general = initial.guild.channels.find((channel) => channel.type === 'text')!;
  await client.patch(`/api/channels/${general.id}`, { name: 'general', parent_id: textCategory.id });

  const channelsByName = new Map<string, Channel>([['general', general]]);
  channelsByName.set('welcome', await createChannel('welcome', 'text', 'Start here 👋', textCategory.id));
  channelsByName.set('dev-talk', await createChannel('dev-talk', 'text', 'Code, architecture and self-hosting', textCategory.id));
  channelsByName.set('random', await createChannel('random', 'text', 'Anything goes', textCategory.id));
  channelsByName.set('staff', await createChannel('staff', 'text', 'Private — moderators only'));
  channelsByName.set('general-voice', generalVoice);
  await client.patch(`/api/channels/${generalVoice.id}`, { parent_id: voiceCategory.id });
  channelsByName.set('dev-voice', await createChannel('Dev Voice', 'voice', 'Pair-programming voice channel', voiceCategory.id));

  // ---- roles ------------------------------------------------------------
  const roleList = await client.get<{ roles: Array<Role & { is_default?: boolean }> }>(`/api/guilds/${guildId}/roles`);
  const everyone = roleList.roles.find((role) => role.is_default) ?? roleList.roles.find((role) => role.name === '@everyone');
  const moderator =
    roleList.roles.find((role) => role.name === 'Moderator') ??
    (
      await client.post<{ role: Role }>(`/api/guilds/${guildId}/roles`, {
        name: 'Moderator',
        color: 0x57f287,
        hoist: true,
        mentionable: true,
        permissions: MODERATOR_PERMISSIONS,
      })
    ).role;
  await client.patch(`/api/guilds/${guildId}/roles/${moderator.id}`, {
    color: 0x57f287,
    hoist: true,
    mentionable: true,
    permissions: MODERATOR_PERMISSIONS,
  });

  const founder = (
    await client.post<{ role: Role }>(`/api/guilds/${guildId}/roles`, {
      name: 'Founder',
      color: 0x5865f2,
      hoist: true,
      mentionable: true,
      permissions: MODERATOR_PERMISSIONS | Permissions.ADMINISTRATOR | Permissions.MANAGE_ROLES | Permissions.MANAGE_GUILD,
    })
  ).role;
  await client.patch(`/api/guilds/${guildId}/members/${operatorId}`, { role_ids: [founder.id], nickname: null });
  log(`created role "Founder"; reused "Moderator" (${roleList.roles.length + 1} roles total)`);

  // #staff is hidden from @everyone and opened up for Moderator.
  const staff = channelsByName.get('staff')!;
  if (everyone) await client.put(`/api/channels/${staff.id}/overwrites/${everyone.id}`, { type: 'role', allow: 0, deny: Permissions.VIEW_CHANNEL });
  await client.put(`/api/channels/${staff.id}/overwrites/${moderator.id}`, {
    type: 'role',
    allow: Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES,
    deny: 0,
  });

  // ---- members ----------------------------------------------------------
  const invite = await client.post<{ invite: { code: string } }>(`/api/guilds/${guildId}/invites`, {
    channel_id: channelsByName.get('welcome')!.id,
  });
  const memberIds = new Map<Actor, string>([['operator', operatorId]]);
  for (const username of ['alice', 'bob', 'carol'] as const) {
    const member = members[username];
    await member.request<{ guild: Guild }>('POST', `/api/invites/${invite.invite.code}/accept`, {});
    memberIds.set(username, await member.me());
  }
  for (const username of ['alice', 'bob'] as const) {
    await client.patch(`/api/guilds/${guildId}/members/${memberIds.get(username)}`, { role_ids: [moderator.id] });
  }
  log('alice, bob and carol joined via an invite code; alice and bob are moderators');

  // ---- content ----------------------------------------------------------
  const render = (content: string): string =>
    content
      .replace('<@operator-id>', `<@${operatorId}>`)
      .replace('<@&moderator-role>', `<@&${moderator.id}>`)
      .replace('<#devtalk-channel>', `<#${channelsByName.get('dev-talk')!.id}>`);

  const posted: Record<string, string[]> = {};
  for (const entry of CONVERSATION) {
    const channel = channelsByName.get(entry.channel);
    if (!channel) continue;
    const result = await actor(entry.as).post<{ message: { id: string } }>(`/api/channels/${channel.id}/messages`, {
      content: render(entry.content),
    });
    (posted[entry.channel] ??= []).push(result.message.id);
  }

  // Reply, edits and extra flourishes.
  const generalMessages = posted.general ?? [];
  if (generalMessages.length >= 2) {
    await members.bob.post(`/api/channels/${channelsByName.get('general')!.id}/messages`, {
      content: 'Replying to the message above — reply previews render inline. ✅',
      reference_id: generalMessages[1],
    });
    await client.patch(`/api/messages/${generalMessages[1]}`, {
      content: 'Finishing the screen-share controls — sharing a whole screen or a single window both work. *(edited)*',
    });
  }

  for (const reaction of REACTIONS) {
    const channel = channelsByName.get(reaction.channel);
    const messageId = posted[reaction.channel]?.[reaction.index];
    if (!channel || !messageId) continue;
    await actor(reaction.as).put(`/api/messages/${messageId}/reactions/${encodeURIComponent(reaction.emoji)}`, {});
  }

  const pinnedId = posted.random?.[0];
  if (pinnedId) await client.put(`/api/messages/${pinnedId}/pin`, {});

  // ---- social -----------------------------------------------------------
  const aliceId = memberIds.get('alice')!;
  const bobId = memberIds.get('bob')!;
  const carolId = memberIds.get('carol')!;

  await client.post('/api/relationships/requests', { user_id: aliceId }); // operator ⇄ alice (auto-accepted)
  await members.alice.post('/api/relationships/requests', { user_id: bobId });
  await members.bob.post('/api/relationships/requests', { user_id: carolId }); // pending until carol accepts

  const dm = await client.post<{ channel: { id: string } }>('/api/dms', { recipient_id: bobId });
  await client.post(`/api/channels/${dm.channel.id}/messages`, { content: 'Hey Bob — the demo workspace is ready, take a look 🙂' });
  await members.bob.post(`/api/channels/${dm.channel.id}/messages`, {
    content: 'Looks great. I will hop into General Voice in a minute.',
  });

  const counts = Object.entries(posted)
    .map(([channel, ids]) => `${channel}:${ids.length}`)
    .join('  ');
  log(`posted messages (${counts}) plus a reply, edits, reactions and a pin`);

  console.log('');
  console.log('  ── demo workspace ready ───────────────────────────────────────────');
  console.log(`     server       ${guild.name}   (${guildId})`);
  console.log(`     invite code  ${invite.invite.code}`);
  console.log('     operator     operator / ' + operatorPassword + '   ← first account = server admin');
  console.log(`     members      alice, bob, carol — password ${memberPassword}`);
  console.log('     private      #staff is hidden from @everyone, visible to Moderator');
  console.log('  ───────────────────────────────────────────────────────────────────');
  console.log('');
}

/* --------------------------------- runner -------------------------------- */

let embedded: NeurioApp | null = null;

function logFailure(message: string): void {
  console.error(`\n  ${message}\n`);
}

async function resolveTarget(): Promise<string> {
  const candidates = explicitUrl ? [explicitUrl] : [`http://127.0.0.1:${config.port}`, 'http://127.0.0.1:8790'];
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return candidate;
    } catch {
      /* not listening — try the next candidate */
    }
  }

  if (noStart) {
    throw new Error(`no Neurio server answered on ${candidates.join(' or ')} — start one with "npm run server" first`);
  }

  log(`no running server on ${candidates.join(' / ')} — starting a temporary one`);
  embedded = await createApp({ dataDir: config.dataDir, port: 0, host: '127.0.0.1', logLevel: 'error' });
  const started = await embedded.start();
  return `http://127.0.0.1:${started.port}`;
}

async function main(): Promise<void> {
  const base = await resolveTarget();
  await seed(new SeedClient(base));
  log(`database: ${config.dbFile}`);
  log(`uploads:  ${config.uploadsDir}`);
}

main()
  .catch((error: unknown) => {
    logFailure(`seeding failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await embedded?.stop();
    setTimeout(() => process.exit(process.exitCode ?? 0), 60).unref();
  });
