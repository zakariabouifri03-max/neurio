/** Roles, permission hierarchy, channel overwrites, kicks and bans. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiClient, startHarness, type Harness } from './helpers/harness';
import type { Channel, Guild, Role } from '../shared/types';
import { Permissions } from '../shared/permissions';

let harness: Harness;
let owner: ApiClient;
let mod: ApiClient;
let member: ApiClient;
let guild: Guild & { channels: Channel[]; roles: Role[]; members: { user: { id: string } }[] };
let textChannel: Channel;
let privateChannel: Channel;

beforeAll(async () => {
  harness = await startHarness();
  owner = new ApiClient(harness.url);
  mod = new ApiClient(harness.url);
  member = new ApiClient(harness.url);
  await owner.register('owner');
  await mod.register('moderator');
  await member.register('plainmember');

  guild = (await owner.createGuild('Permissions HQ')) as typeof guild;
  textChannel = guild.channels.find((c) => c.type === 'text')!;
  const invite = await owner.post<{ invite: { code: string } }>(`/api/guilds/${guild.id}/invites`, {
    channel_id: textChannel.id,
  });
  await mod.post(`/api/invites/${invite.body.invite.code}/accept`);
  await member.post(`/api/invites/${invite.body.invite.code}/accept`);

  privateChannel = (
    await owner.post<{ channel: { id: string } }>(`/api/guilds/${guild.id}/channels`, {
      name: 'staff-room',
      type: 'text',
    })
  ).body.channel as Channel;
});

afterAll(async () => {
  await harness?.close();
});

describe('roles', () => {
  it('starts with @everyone and a moderator role', async () => {
    const roles = await owner.get<{ roles: Role[] }>(`/api/guilds/${guild.id}/roles`);
    expect(roles.body.roles.map((r) => r.name)).toContain('@everyone');
    expect(roles.body.roles.map((r) => r.name)).toContain('Moderator');
  });

  it('creates a role with permissions', async () => {
    const created = await owner.post<{ role: Role }>(`/api/guilds/${guild.id}/roles`, {
      name: 'Helper',
      color: 0x57f287,
      permissions: Permissions.SEND_MESSAGES | Permissions.VIEW_CHANNEL,
      hoist: true,
      mentionable: true,
    });
    expect(created.status).toBe(200);
    expect(created.body.role.name).toBe('Helper');
    expect(created.body.role.color).toBe(0x57f287);
    expect(created.body.role.hoist).toBe(true);
    expect(created.body.role.permissions & Permissions.SEND_MESSAGES).toBeTruthy();
  });

  it('assigns roles to a member and reflects them in permissions', async () => {
    const roles = await owner.get<{ roles: Role[] }>(`/api/guilds/${guild.id}/roles`);
    const helper = roles.body.roles.find((role) => role.name === 'Helper')!;
    const memberId = (await member.me()).id;
    const patch = await owner.patch(`/api/guilds/${guild.id}/members/${memberId}`, { role_ids: [helper.id] });
    expect(patch.status).toBe(200);
    const permissions = await member.get<{ permissions: number }>(
      `/api/permissions?guild_id=${guild.id}&channel_id=${textChannel.id}`,
    );
    expect(permissions.body.permissions & Permissions.SEND_MESSAGES).toBeTruthy();
  });

  it('refuses to let a member edit roles', async () => {
    const response = await member.post(`/api/guilds/${guild.id}/roles`, { name: 'Rogue Role' });
    expect(response.status).toBe(403);
  });

  it('refuses to delete @everyone', async () => {
    const roles = await owner.get<{ roles: Role[] }>(`/api/guilds/${guild.id}/roles`);
    const everyone = roles.body.roles.find((role) => role.is_default)!;
    const response = await owner.delete(`/api/guilds/${guild.id}/roles/${everyone.id}`);
    expect(response.status).toBe(400);
  });

  it('prevents a moderator from granting a role above their own', async () => {
    const roles = await owner.get<{ roles: Role[] }>(`/api/guilds/${guild.id}/roles`);
    const moderatorRole = roles.body.roles.find((role) => role.name === 'Moderator')!;
    const modId = (await mod.me()).id;
    await owner.patch(`/api/guilds/${guild.id}/members/${modId}`, { role_ids: [moderatorRole.id] });
    const attempt = await mod.patch(`/api/guilds/${guild.id}/members/${(await member.me()).id}`, {
      role_ids: [moderatorRole.id],
    });
    expect(attempt.status).toBe(403);
  });
});

describe('channel overwrites', () => {
  it('lets an administrator bypass a deny overwrite', async () => {
    const roles = await owner.get<{ roles: Role[] }>(`/api/guilds/${guild.id}/roles`);
    const everyone = roles.body.roles.find((role) => role.is_default)!;
    await owner.put(`/api/channels/${privateChannel.id}/overwrites/${everyone.id}`, {
      type: 'role',
      allow: 0,
      deny: Permissions.VIEW_CHANNEL,
    });
    expect((await member.get(`/api/channels/${privateChannel.id}`)).status).toBe(403);
    expect((await owner.get(`/api/channels/${privateChannel.id}`)).status).toBe(200);
  });

  it('restores access with a member overwrite', async () => {
    const memberId = (await member.me()).id;
    await owner.put(`/api/channels/${privateChannel.id}/overwrites/${memberId}`, {
      type: 'member',
      allow: Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES,
      deny: 0,
    });
    const response = await member.get(`/api/channels/${privateChannel.id}`);
    expect(response.status).toBe(200);
    const message = await member.sendMessage(privateChannel.id, 'let me in');
    expect(message.content).toBe('let me in');
  });

  it('hides the channel from the member once the overwrite is removed', async () => {
    const memberId = (await member.me()).id;
    await owner.delete(`/api/channels/${privateChannel.id}/overwrites/${memberId}`);
    expect((await member.get(`/api/channels/${privateChannel.id}`)).status).toBe(403);
  });

  it('lists overwrites for permitted members', async () => {
    const response = await owner.get<{ overwrites: { target_id: string }[] }>(
      `/api/channels/${privateChannel.id}/overwrites`,
    );
    expect(response.status).toBe(200);
    expect(response.body.overwrites.length).toBeGreaterThan(0);
    const denied = await member.get(`/api/channels/${privateChannel.id}/overwrites`);
    expect(denied.status).toBe(403);
  });
});

describe('moderation', () => {
  it('kicks a member and revokes their access', async () => {
    const memberId = (await member.me()).id;
    const kick = await owner.delete(`/api/guilds/${guild.id}/members/${memberId}`);
    expect(kick.status).toBe(200);
    expect((await member.get(`/api/guilds/${guild.id}`)).status).toBe(403);
    // Re-join for the next tests.
    const invite = await owner.post<{ invite: { code: string } }>(`/api/guilds/${guild.id}/invites`, {
      channel_id: textChannel.id,
    });
    await member.post(`/api/invites/${invite.body.invite.code}/accept`);
  });

  it('bans a member and blocks them from re-joining', async () => {
    const memberId = (await member.me()).id;
    const ban = await owner.post(`/api/guilds/${guild.id}/bans`, { user_id: memberId, reason: 'spam' });
    expect(ban.status).toBe(200);
    const bans = await owner.get<{ bans: { user_id: string; reason: string }[] }>(`/api/guilds/${guild.id}/bans`);
    expect(bans.body.bans.some((b) => b.user_id === memberId && b.reason === 'spam')).toBe(true);

    const invite = await owner.post<{ invite: { code: string } }>(`/api/guilds/${guild.id}/invites`, {
      channel_id: textChannel.id,
    });
    const attempt = await member.post(`/api/invites/${invite.body.invite.code}/accept`);
    expect(attempt.status).toBe(403);

    expect((await owner.delete(`/api/guilds/${guild.id}/bans/${memberId}`)).status).toBe(200);
    const rejoin = await member.post(`/api/invites/${invite.body.invite.code}/accept`);
    expect(rejoin.status).toBe(200);
  });

  it('refuses to kick the server owner', async () => {
    const ownerId = (await owner.me()).id;
    const response = await mod.delete(`/api/guilds/${guild.id}/members/${ownerId}`);
    expect(response.status).toBe(403);
  });

  it('lets a member leave of their own accord', async () => {
    const response = await member.post(`/api/guilds/${guild.id}/leave`);
    expect(response.status).toBe(200);
    expect((await member.get('/api/guilds')).body).toMatchObject({ guilds: [] });
  });
});
