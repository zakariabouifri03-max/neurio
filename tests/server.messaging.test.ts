/**
 * End-to-end backend test: two real users, a real server, real WebSockets.
 * Covers accounts, sessions, friends, servers, channels, messaging,
 * reactions, replies, editing, deletion, presence, typing and search.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, GatewayClient, makeGateway, startHarness, waitUntil, type Harness } from './helpers/harness';

let harness: Harness;
let alice: ApiClient;
let bob: ApiClient;
let aliceGateway: GatewayClient;
let bobGateway: GatewayClient;

beforeAll(async () => {
  harness = await startHarness();
  alice = new ApiClient(harness.url);
  bob = new ApiClient(harness.url);
  await alice.register('alice');
  await bob.register('bob');
  aliceGateway = await makeGateway(harness.url, alice.token!);
  bobGateway = await makeGateway(harness.url, bob.token!);
});

afterAll(async () => {
  await aliceGateway?.close();
  await bobGateway?.close();
  await harness?.close();
});

describe('health & config', () => {
  it('reports health without authentication', async () => {
    const response = await new ApiClient(harness.url).get<{ ok: boolean }>('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('exposes server config', async () => {
    const response = await new ApiClient(harness.url).get<{ name: string; registration_open: boolean }>('/api/config');
    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Neurio');
    expect(response.body.registration_open).toBe(true);
  });
});

describe('accounts', () => {
  it('rejects short passwords', async () => {
    const client = new ApiClient(harness.url);
    const response = await client.post('/api/auth/register', { username: 'weak', password: '123' });
    expect(response.status).toBe(400);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    const client = new ApiClient(harness.url);
    const response = await client.post('/api/auth/register', { username: 'ALICE', password: 'password123' });
    expect(response.status).toBe(409);
  });

  it('rejects bad credentials', async () => {
    const client = new ApiClient(harness.url);
    const response = await client.post('/api/auth/login', { username: 'alice', password: 'wrong-password' });
    expect(response.status).toBe(401);
  });

  it('logs back in and returns a session for the same user', async () => {
    const client = new ApiClient(harness.url);
    const result = await client.login('alice');
    expect(result.user.username).toBe('alice');
    const me = await client.me();
    expect(me.username).toBe('alice');
    // The fresh session replaces the one created in beforeAll, so keep using it.
    const previousToken = alice.token;
    alice.token = client.token;
    const sessions = await alice.get<{ sessions: { id: string; current: boolean }[] }>('/api/users/@me/sessions');
    const current = sessions.body.sessions.find((session) => session.current)!;
    await alice.delete(`/api/users/@me/sessions/${current.id}`).catch(() => undefined);
    expect(previousToken).toBeTruthy();
    // Re-login once more so alice holds a live token for the remaining tests.
    const again = await alice.login('alice');
    expect(again.user.username).toBe('alice');
  });

  it('updates the profile', async () => {
    const response = await alice.patch<{ user: { display_name: string; bio: string } }>('/api/users/@me', {
      display_name: 'Alice Liddell',
      bio: 'Curiouser and curiouser',
    });
    expect(response.status).toBe(200);
    expect(response.body.user.display_name).toBe('Alice Liddell');
    expect(response.body.user.bio).toBe('Curiouser and curiouser');
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const response = await new ApiClient(harness.url).get('/api/users/@me');
    expect(response.status).toBe(401);
  });
});

describe('friends', () => {
  it('sends and accepts a friend request', async () => {
    const request = await alice.post<{ relationship: string }>('/api/relationships/requests', { username: 'bob' });
    expect(request.status).toBe(200);
    expect(request.body.relationship).toBe('outgoing');

    // Bob received the request over the gateway in real time.
    const incoming = await bobGateway.waitFor((event) => event.t === 'FRIEND_REQUEST_CREATE');
    expect((incoming.d as { from: { username: string } }).from.username).toBe('alice');

    const relationships = await bob.get<{ relationships: { type: string; user: { username: string } }[] }>(
      '/api/relationships',
    );
    expect(relationships.body.relationships.some((r) => r.type === 'incoming' && r.user.username === 'alice')).toBe(true);

    const accept = await bob.post('/api/relationships/requests/' + (await alice.me()).id + '/accept');
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ relationship: 'friend' });

    const friends = await alice.get<{ relationships: { type: string; user: { username: string } }[] }>(
      '/api/relationships',
    );
    expect(friends.body.relationships.some((r) => r.type === 'friend' && r.user.username === 'bob')).toBe(true);
  });

  it('blocks and unblocks a user', async () => {
    const bobId = (await bob.me()).id;
    expect((await alice.post(`/api/relationships/${bobId}/block`)).status).toBe(200);
    // Blocked users cannot send friend requests either way.
    const blockedAttempt = await bob.post('/api/relationships/requests', { username: 'alice' });
    expect(blockedAttempt.status).toBe(403);
    const dmAttempt = await bob.post('/api/dms', { recipient_id: (await alice.me()).id });
    expect(dmAttempt.status).toBe(403);
    expect((await alice.delete(`/api/relationships/${bobId}/block`)).status).toBe(200);

    // Blocking drops the friendship; restore it for the remaining tests.
    const request = await alice.post<{ relationship: string }>('/api/relationships/requests', { username: 'bob' });
    expect(request.body.relationship).toBe('outgoing');
    expect((await bob.post(`/api/relationships/requests/${(await alice.me()).id}/accept`)).status).toBe(200);
  });

  it('finds users by partial username', async () => {
    const response = await alice.get<{ users: { username: string }[] }>('/api/users?query=bo');
    expect(response.body.users.map((u) => u.username)).toContain('bob');
  });
});

describe('presence', () => {
  it('reports both users online in each other’s presence feed', async () => {
    await waitUntil(() => aliceGateway.eventNamed('PRESENCE_UPDATE') !== undefined);
    const presence = aliceGateway.events
      .filter((event) => event.t === 'PRESENCE_UPDATE')
      .map((event) => event.d as { user_id: string; status: string });
    expect(presence.some((p) => p.status === 'online')).toBe(true);
  });

  it('persists a status change and broadcasts it', async () => {
    aliceGateway.send({ op: 'presence.update', d: { status: 'dnd', custom_status: 'heads down' } });
    const update = await bobGateway.waitFor(
      (event) => event.t === 'PRESENCE_UPDATE' && (event.d as { status: string }).status === 'dnd',
    );
    expect((update.d as { custom_status: string }).custom_status).toBe('heads down');
    aliceGateway.send({ op: 'presence.update', d: { status: 'online' } });
  });
});

describe('servers, channels and messages', () => {
  let guildId: string;
  let textChannelId: string;
  let voiceChannelId: string;

  it('creates a server with default channels and roles', async () => {
    const guild = await alice.createGuild('Test Server');
    guildId = guild.id;
    expect(guild.name).toBe('Test Server');
    expect(guild.channels.length).toBeGreaterThanOrEqual(2);
    textChannelId = guild.channels.find((c) => c.type === 'text')!.id;
    voiceChannelId = guild.channels.find((c) => c.type === 'voice')!.id;
    expect(textChannelId).toBeTruthy();
    expect(voiceChannelId).toBeTruthy();
  });

  it('creates an invite and Bob joins through it', async () => {
    const invite = await alice.post<{ invite: { code: string } }>(`/api/guilds/${guildId}/invites`, {
      channel_id: textChannelId,
    });
    expect(invite.status).toBe(200);
    const code = invite.body.invite.code;

    const preview = await new ApiClient(harness.url).get<{ invite: { guild: { name: string } } }>(`/api/invites/${code}`);
    expect(preview.status).toBe(200);
    expect(preview.body.invite.guild.name).toBe('Test Server');

    const joined = await bob.post<{ guild: { id: string; members: unknown[] } }>(`/api/invites/${code}/accept`);
    expect(joined.status).toBe(200);
    expect(joined.body.guild.id).toBe(guildId);
    expect(joined.body.guild.members.length).toBe(2);

    // Alice sees the new member arrive live.
    await bobGateway.waitFor((event) => event.t === 'GUILD_MEMBER_ADD');
    const memberAdd = await aliceGateway.waitFor((event) => event.t === 'GUILD_MEMBER_ADD');
    expect((memberAdd.d as { guild_id: string }).guild_id).toBe(guildId);
  });

  it('delivers a message to the other member in real time', async () => {
    const message = await alice.sendMessage(textChannelId, 'hello world');
    const received = await bobGateway.waitFor(
      (event) => event.t === 'MESSAGE_CREATE' && (event.d as { message: { id: string } }).message.id === message.id,
    );
    const payload = received.d as { message: { content: string; author: { username: string } } };
    expect(payload.message.content).toBe('hello world');
    expect(payload.message.author.username).toBe('alice');
  });

  it('returns message history', async () => {
    await bob.sendMessage(textChannelId, 'hi alice');
    const history = await alice.get<{ messages: { content: string }[] }>(`/api/channels/${textChannelId}/messages`);
    expect(history.status).toBe(200);
    expect(history.body.messages.map((m) => m.content)).toEqual(['hi alice', 'hello world']);
  });

  it('edits a message and notifies the other side', async () => {
    const message = await alice.sendMessage(textChannelId, 'typo here');
    const edited = await alice.patch<{ message: { content: string; edited_at: number } }>(`/api/messages/${message.id}`, {
      content: 'fixed now',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.message.content).toBe('fixed now');
    expect(edited.body.message.edited_at).toBeGreaterThan(0);
    const update = await bobGateway.waitFor(
      (event) => event.t === 'MESSAGE_UPDATE' && (event.d as { message: { id: string } }).message.id === message.id,
    );
    expect((update.d as { message: { content: string } }).message.content).toBe('fixed now');
  });

  it('supports replies', async () => {
    const original = await alice.sendMessage(textChannelId, 'original message');
    const reply = await bob.sendMessage(textChannelId, 'replying to you', { reference_id: original.id });
    expect(reply.referenced_message?.id).toBe(original.id);
    expect(reply.referenced_message?.content).toBe('original message');
  });

  it('rejects a reply that points at another channel', async () => {
    const otherGuild = await alice.createGuild('Other Place');
    const otherChannel = otherGuild.channels.find((c) => c.type === 'text')!;
    const original = await alice.sendMessage(textChannelId, 'in the first server');
    const response = await alice.post(`/api/channels/${otherChannel.id}/messages`, {
      content: 'cross-channel reply',
      reference_id: original.id,
    });
    expect(response.status).toBe(400);
  });

  it('adds and removes reactions', async () => {
    const message = await alice.sendMessage(textChannelId, 'react to me');
    const added = await bob.put(`/api/messages/${message.id}/reactions/%F0%9F%91%8D`);
    expect(added.status).toBe(200);
    const fetched = await alice.get<{ message: { reactions: { emoji: string; count: number; me: boolean }[] } }>(
      `/api/channels/${textChannelId}/messages/${message.id}`,
    );
    expect(fetched.body.message.reactions[0].emoji).toBe('👍');
    expect(fetched.body.message.reactions[0].count).toBe(1);
    expect(fetched.body.message.reactions[0].me).toBe(false);

    expect((await bob.delete(`/api/messages/${message.id}/reactions/%F0%9F%91%8D`)).status).toBe(200);
    const after = await alice.get<{ message: { reactions: unknown[] } }>(
      `/api/channels/${textChannelId}/messages/${message.id}`,
    );
    expect(after.body.message.reactions).toHaveLength(0);
  });

  it('pins and unpins messages', async () => {
    const message = await alice.sendMessage(textChannelId, 'important notice');
    expect((await alice.put(`/api/messages/${message.id}/pin`)).status).toBe(200);
    const pins = await alice.get<{ messages: { id: string }[] }>(`/api/channels/${textChannelId}/pins`);
    expect(pins.body.messages.map((m) => m.id)).toContain(message.id);
    expect((await alice.delete(`/api/messages/${message.id}/pin`)).status).toBe(200);
  });

  it('deletes a message and broadcasts the removal', async () => {
    const message = await bob.sendMessage(textChannelId, 'temporary');
    expect((await bob.delete(`/api/messages/${message.id}`)).status).toBe(200);
    const deletion = await aliceGateway.waitFor(
      (event) => event.t === 'MESSAGE_DELETE' && (event.d as { message_id: string }).message_id === message.id,
    );
    expect((deletion.d as { channel_id: string }).channel_id).toBe(textChannelId);
    const history = await alice.get<{ messages: { id: string }[] }>(`/api/channels/${textChannelId}/messages`);
    expect(history.body.messages.map((m) => m.id)).not.toContain(message.id);
  });

  it('marks channels read and reports unread counts', async () => {
    const before = await alice.get<{ unread: { channel_id: string; unread_count: number }[] }>('/api/read-states');
    const entry = before.body.unread.find((u) => u.channel_id === textChannelId)!;
    expect(entry).toBeDefined();
    const latest = await bob.sendMessage(textChannelId, 'unread for alice');
    const unread = await alice.get<{ unread: { channel_id: string; unread_count: number }[] }>('/api/read-states');
    expect(unread.body.unread.find((u) => u.channel_id === textChannelId)!.unread_count).toBeGreaterThan(0);
    const ack = await alice.post(`/api/channels/${textChannelId}/ack`, { message_id: latest.id });
    expect(ack.status).toBe(200);
    const cleared = await alice.get<{ unread: { channel_id: string; unread_count: number }[] }>('/api/read-states');
    expect(cleared.body.unread.find((u) => u.channel_id === textChannelId)!.unread_count).toBe(0);
  });

  it('sends and receives typing indicators', async () => {
    aliceGateway.send({ op: 'typing', d: { channel_id: textChannelId } });
    const typing = await bobGateway.waitFor((event) => event.t === 'TYPING_START');
    expect((typing.d as { channel_id: string }).channel_id).toBe(textChannelId);
    expect((typing.d as { display_name: string }).display_name).toBe('Alice Liddell');
  });

  it('searches messages', async () => {
    await alice.sendMessage(textChannelId, 'the quick brown fox jumps');
    const search = await alice.get<{ hits: { message: { content: string }; channel: { id: string } }[] }>(
      '/api/search?q=quick%20brown',
    );
    expect(search.status).toBe(200);
    expect(search.body.hits.length).toBeGreaterThan(0);
    expect(search.body.hits[0].message.content).toContain('quick brown fox');
  });

  it('enforces slowmode', async () => {
    const channel = await alice.post<{ channel: { id: string } }>(`/api/guilds/${guildId}/channels`, {
      name: 'slow',
      type: 'text',
      slowmode_seconds: 60,
    });
    const channelId = channel.body.channel.id;
    await alice.sendMessage(channelId, 'first');
    const second = await alice.post(`/api/channels/${channelId}/messages`, { content: 'second' });
    expect(second.status).toBe(429);
  });

  it('hides channels from members without VIEW_CHANNEL', async () => {
    const secret = await alice.post<{ channel: { id: string } }>(`/api/guilds/${guildId}/channels`, {
      name: 'secret',
      type: 'text',
    });
    const channelId = secret.body.channel.id;
    // Deny @everyone by rebuilding the overwrite with the default role id.
    const roles = await alice.get<{ roles: { id: string; is_default: boolean }[] }>(`/api/guilds/${guildId}/roles`);
    const everyone = roles.body.roles.find((role) => role.is_default)!;
    const overwrite = await alice.put(`/api/channels/${channelId}/overwrites/${everyone.id}`, {
      type: 'role',
      allow: 0,
      deny: 1, // VIEW_CHANNEL
    });
    expect(overwrite.status).toBe(200);
    const bobView = await bob.get(`/api/channels/${channelId}`);
    expect(bobView.status).toBe(403);
    const aliceView = await alice.get(`/api/channels/${channelId}`);
    expect(aliceView.status).toBe(200);
    const bobGuild = await bob.get<{ guild: { channels: { id: string }[] } }>(`/api/guilds/${guildId}`);
    expect(bobGuild.body.guild.channels.map((c) => c.id)).not.toContain(channelId);
  });
});

describe('direct messages', () => {
  it('creates a DM channel and delivers messages privately', async () => {
    const aliceUser = await alice.me();
    const bobUser = await bob.me();
    const channel = await alice.dm(bobUser.id);
    expect(channel.type).toBe('dm');
    const message = await alice.sendMessage(channel.id, 'psst, direct message');
    const received = await bobGateway.waitFor(
      (event) => event.t === 'MESSAGE_CREATE' && (event.d as { message: { id: string } }).message.id === message.id,
    );
    expect((received.d as { message: { content: string } }).message.content).toBe('psst, direct message');
    // The same DM is reused, not duplicated.
    const again = await bob.dm(aliceUser.id);
    expect(again.id).toBe(channel.id);
  });

  it('lists DM channels for both participants', async () => {
    const channels = await bob.get<{ channels: { type: string; recipients?: { username: string }[] }[] }>('/api/dms');
    const dm = channels.body.channels.find((c) => c.type === 'dm')!;
    expect(dm.recipients?.map((r) => r.username)).toContain('alice');
  });

  it('creates a group DM', async () => {
    const carol = new ApiClient(harness.url);
    await carol.register('carol');
    const carolUser = await carol.me();
    const group = await alice.post<{ channel: { type: string; recipients: { username: string }[] } }>('/api/dms/group', {
      user_ids: [carolUser.id, (await bob.me()).id],
      name: 'The Trio',
    });
    expect(group.status).toBe(200);
    expect(group.body.channel.type).toBe('group_dm');
    expect(group.body.channel.recipients.length).toBe(3);
  });
});
