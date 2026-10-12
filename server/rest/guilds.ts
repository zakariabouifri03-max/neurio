/** Servers (guilds), members, roles and invites. */
import { HttpError } from '../ids';
import { assertObject, optionalBoolean, optionalNumber, optionalString, readMultipart, requiredString } from '../http';
import {
  addGuildMember,
  banMember,
  consumeInvite,
  createGuild,
  createInvite,
  createRole,
  deleteGuild,
  deleteInvite,
  deleteRole,
  getInvite,
  guildBundle,
  guildMemberIds,
  guildSummaries,
  inviteIsUsable,
  listGuildMembers,
  listInvites,
  removeGuildMember,
  requireGuild,
  setMemberRoles,
  setNickname,
  unbanMember,
  updateGuild,
  updateRole,
  listGuildChannels,
} from '../store/guilds';
import { Permissions } from '../../shared/permissions';
import { isGuildMember } from '../permissions';
import { toGuild, toPublicUser, toRole } from '../serialize';
import { getUserById } from '../store/users';
import { requireGuildPermission, requireRoleHierarchy, requireNotBanned, requireUser } from './helpers';
import { isImageType } from '../media';
import type { Router } from './router';
import type { RestDeps } from './types';
import type { Guild } from '../../shared/types';

export function registerGuildRoutes(router: Router, deps: RestDeps): void {
  const statusOf = (id: string) => deps.presence.statusOf(id);

  router.get('/api/guilds', (ctx) => {
    const user = requireUser(ctx);
    return { guilds: guildSummaries(deps.db, user.id) };
  });

  router.post(
    '/api/guilds',
    (ctx) => {
      const user = requireUser(ctx);
      const body = assertObject(ctx.body);
      const guild = createGuild(deps.db, user.id, {
        name: requiredString(body.name, 'name', 64),
        description: optionalString(body.description, 'description', 300),
      });
      const bundle = guildBundle(deps.db, guild.id, user.id, statusOf);
      deps.gateway.dispatchToUser(user.id, 'GUILD_CREATE', bundle);
      return { guild: bundle };
    },
    { limit: { limit: 10, windowMs: 60_000 } },
  );

  router.get('/api/guilds/:guildId', (ctx) => {
    const user = requireUser(ctx);
    if (!isGuildMember(deps.db, ctx.params.guildId, user.id)) {
      throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
    }
    return { guild: guildBundle(deps.db, ctx.params.guildId, user.id, statusOf) };
  });

  router.patch('/api/guilds/:guildId', (ctx) => {
    const guildId = ctx.params.guildId;
    const body = assertObject(ctx.body);
    const renamed = body.name !== undefined;
    const iconChanged = body.icon_id !== undefined;
    requireGuildPermission(ctx, guildId, Permissions.MANAGE_GUILD, 'edit this server');
    const guild = updateGuild(deps.db, guildId, {
      name: optionalString(body.name, 'name', 64),
      description: optionalString(body.description, 'description', 300),
    });
    void renamed;
    void iconChanged;
    deps.gateway.dispatch('GUILD_UPDATE', { guild: toGuild(guild) }, deps.gateway.audienceForGuild(guildId));
    return { guild: toGuild(guild) };
  });

  router.post('/api/guilds/:guildId/icon', async (ctx) => {
    requireGuildPermission(ctx, ctx.params.guildId, Permissions.MANAGE_GUILD, 'change the server icon');
    const user = requireUser(ctx);
    const form = await readMultipart(ctx.req, Math.min(deps.config.maxUploadBytes, 8 * 1024 * 1024));
    const file = (form.getAll('file') as unknown[]).find((v): v is File => typeof v === 'object' && v !== null);
    if (!file) throw new HttpError(400, 'No file uploaded (use the "file" field)', 'no_file');
    if (!isImageType(file.type)) throw new HttpError(415, 'Server icons must be images', 'unsupported_media_type');
    const data = Buffer.from(await file.arrayBuffer());
    const { upload } = deps.uploads.save(deps.db, {
      data,
      filename: file.name || 'icon.png',
      contentType: file.type,
      userId: user.id,
    });
    const guild = updateGuild(deps.db, ctx.params.guildId, { icon_id: upload.id });
    const dto = toGuild(guild);
    deps.gateway.dispatch('GUILD_UPDATE', { guild: dto }, deps.gateway.audienceForGuild(ctx.params.guildId));
    return { guild: dto };
  });

  router.delete('/api/guilds/:guildId', (ctx) => {
    const user = requireUser(ctx);
    const guild = requireGuild(deps.db, ctx.params.guildId);
    if (guild.owner_id !== user.id) throw new HttpError(403, 'Only the owner can delete a server', 'not_owner');
    const members = guildMemberIds(deps.db, guild.id);
    deleteGuild(deps.db, guild.id);
    for (const memberId of members) {
      deps.gateway.dispatchToUser(memberId, 'GUILD_DELETE', { id: guild.id });
    }
    return { ok: true };
  });

  /* -------------------------------- members ------------------------------- */

  router.get('/api/guilds/:guildId/members', (ctx) => {
    const user = requireUser(ctx);
    if (!isGuildMember(deps.db, ctx.params.guildId, user.id)) {
      throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
    }
    return { members: listGuildMembers(deps.db, ctx.params.guildId, statusOf) };
  });

  router.patch('/api/guilds/:guildId/members/:userId', (ctx) => {
    const guildId = ctx.params.guildId;
    const targetId = ctx.params.userId;
    const actor = requireUser(ctx);
    const body = assertObject(ctx.body);
    const isSelf = actor.id === targetId;
    if (body.nickname !== undefined) {
      if (!isSelf) requireGuildPermission(ctx, guildId, Permissions.MANAGE_GUILD, 'change nicknames');
      else requireGuildPermission(ctx, guildId, Permissions.CHANGE_NICKNAME, 'change your nickname');
      setNickname(deps.db, guildId, targetId, body.nickname === null ? null : String(body.nickname).slice(0, 32));
    }
    if (body.role_ids !== undefined) {
      requireGuildPermission(ctx, guildId, Permissions.MANAGE_ROLES, 'manage roles');
      if (!Array.isArray(body.role_ids)) throw new HttpError(400, 'role_ids must be an array', 'invalid_field');
      const roleIds = body.role_ids.map(String);
      // Never allow handing out a role at or above your own highest role.
      for (const roleId of roleIds) {
        const role = deps.db.get<{ position: number; is_default: number }>(
          'SELECT position, is_default FROM roles WHERE id = ? AND guild_id = ?',
          [roleId, guildId],
        );
        if (!role || role.is_default === 1) continue;
        requireRoleHierarchy(ctx, guildId, roleId);
      }
      setMemberRoles(deps.db, guildId, targetId, roleIds);
    }
    const member = listGuildMembers(deps.db, guildId, statusOf).find((m) => m.user.id === targetId);
    deps.gateway.dispatch('GUILD_MEMBER_UPDATE', { guild_id: guildId, member }, deps.gateway.audienceForGuild(guildId));
    return { member };
  });

  router.delete('/api/guilds/:guildId/members/:userId', (ctx) => {
    const guildId = ctx.params.guildId;
    const targetId = ctx.params.userId;
    const actor = requireUser(ctx);
    const guild = requireGuild(deps.db, guildId);
    const isSelf = actor.id === targetId;
    if (!isSelf) {
      requireGuildPermission(ctx, guildId, Permissions.KICK_MEMBERS, 'kick members');
      if (guild.owner_id === targetId) throw new HttpError(403, 'The owner cannot be kicked', 'cannot_kick_owner');
    } else if (guild.owner_id === actor.id) {
      throw new HttpError(400, 'Transfer ownership or delete the server instead of leaving', 'owner_cannot_leave');
    }
    removeGuildMember(deps.db, guildId, targetId);
    deps.gateway.dispatchToUser(targetId, 'GUILD_DELETE', { id: guildId });
    deps.gateway.dispatch('GUILD_MEMBER_REMOVE', { guild_id: guildId, user_id: targetId }, deps.gateway.audienceForGuild(guildId));
    return { ok: true };
  });

  router.get('/api/guilds/:guildId/bans', (ctx) => {
    requireGuildPermission(ctx, ctx.params.guildId, Permissions.BAN_MEMBERS, 'view bans');
    const bans = deps.db.all<{ user_id: string; reason: string | null; created_at: number }>(
      'SELECT user_id, reason, created_at FROM bans WHERE guild_id = ?',
      [ctx.params.guildId],
    );
    return {
      bans: bans.map((ban) => ({
        user: (() => {
          const user = getUserById(deps.db, ban.user_id);
          return user ? toPublicUser(user, statusOf(user.id)) : null;
        })(),
        user_id: ban.user_id,
        reason: ban.reason,
        created_at: ban.created_at,
      })),
    };
  });

  router.post('/api/guilds/:guildId/bans', (ctx) => {
    const guildId = ctx.params.guildId;
    requireGuildPermission(ctx, guildId, Permissions.BAN_MEMBERS, 'ban members');
    const body = assertObject(ctx.body);
    const userId = requiredString(body.user_id, 'user_id', 32);
    const guild = requireGuild(deps.db, guildId);
    if (guild.owner_id === userId) throw new HttpError(403, 'You cannot ban the owner', 'cannot_ban_owner');
    banMember(deps.db, guildId, userId, optionalString(body.reason, 'reason', 200) ?? null);
    deps.gateway.dispatchToUser(userId, 'GUILD_DELETE', { id: guildId, banned: true });
    deps.gateway.dispatch('GUILD_MEMBER_REMOVE', { guild_id: guildId, user_id: userId }, deps.gateway.audienceForGuild(guildId));
    return { ok: true };
  });

  router.delete('/api/guilds/:guildId/bans/:userId', (ctx) => {
    requireGuildPermission(ctx, ctx.params.guildId, Permissions.BAN_MEMBERS, 'unban members');
    unbanMember(deps.db, ctx.params.guildId, ctx.params.userId);
    return { ok: true };
  });

  /* --------------------------------- roles -------------------------------- */

  router.get('/api/guilds/:guildId/roles', (ctx) => {
    const user = requireUser(ctx);
    if (!isGuildMember(deps.db, ctx.params.guildId, user.id)) {
      throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
    }
    const rows = deps.db.all<import('../permissions').RoleRow>(
      'SELECT * FROM roles WHERE guild_id = ? ORDER BY position DESC',
      [ctx.params.guildId],
    );
    return { roles: rows.map(toRole) };
  });

  router.post('/api/guilds/:guildId/roles', (ctx) => {
    const guildId = ctx.params.guildId;
    requireGuildPermission(ctx, guildId, Permissions.MANAGE_ROLES, 'create roles');
    const body = assertObject(ctx.body);
    const role = createRole(deps.db, guildId, {
      name: requiredString(body.name, 'name', 32),
      color: optionalNumber(body.color, 'color') ?? 0,
      permissions: optionalNumber(body.permissions, 'permissions') ?? 0,
      hoist: optionalBoolean(body.hoist, 'hoist') ?? false,
      mentionable: optionalBoolean(body.mentionable, 'mentionable') ?? true,
    });
    const dto = toRole(role);
    deps.gateway.dispatch('GUILD_ROLE_CREATE', { guild_id: guildId, role: dto }, deps.gateway.audienceForGuild(guildId));
    return { role: dto };
  });

  router.patch('/api/guilds/:guildId/roles/:roleId', (ctx) => {
    const guildId = ctx.params.guildId;
    requireGuildPermission(ctx, guildId, Permissions.MANAGE_ROLES, 'edit roles');
    requireRoleHierarchy(ctx, guildId, ctx.params.roleId);
    const body = assertObject(ctx.body);
    const role = updateRole(deps.db, guildId, ctx.params.roleId, {
      name: optionalString(body.name, 'name', 32),
      color: optionalNumber(body.color, 'color'),
      permissions: optionalNumber(body.permissions, 'permissions'),
      position: optionalNumber(body.position, 'position'),
      hoist: optionalBoolean(body.hoist, 'hoist'),
      mentionable: optionalBoolean(body.mentionable, 'mentionable'),
    });
    const dto = toRole(role);
    const audience = deps.gateway.audienceForGuild(guildId);
    deps.gateway.dispatch('GUILD_ROLE_UPDATE', { guild_id: guildId, role: dto }, audience);
    // Permission changes can hide channels — push a fresh guild view.
    for (const memberId of audience) {
      if (!isGuildMember(deps.db, guildId, memberId)) continue;
      deps.gateway.dispatchToUser(memberId, 'GUILD_UPDATE', { guild: guildBundle(deps.db, guildId, memberId, statusOf) });
    }
    return { role: dto };
  });

  router.delete('/api/guilds/:guildId/roles/:roleId', (ctx) => {
    const guildId = ctx.params.guildId;
    requireGuildPermission(ctx, guildId, Permissions.MANAGE_ROLES, 'delete roles');
    requireRoleHierarchy(ctx, guildId, ctx.params.roleId);
    deleteRole(deps.db, guildId, ctx.params.roleId);
    deps.gateway.dispatch(
      'GUILD_ROLE_DELETE',
      { guild_id: guildId, role_id: ctx.params.roleId },
      deps.gateway.audienceForGuild(guildId),
    );
    return { ok: true };
  });

  /* -------------------------------- invites ------------------------------- */

  router.get('/api/guilds/:guildId/invites', (ctx) => {
    requireGuildPermission(ctx, ctx.params.guildId, Permissions.MANAGE_INVITES, 'manage invites');
    const invites = listInvites(deps.db, ctx.params.guildId).map((invite) => {
      const inviter = invite.inviter_id ? getUserById(deps.db, invite.inviter_id) : null;
      return {
        code: invite.code,
        guild_id: invite.guild_id,
        channel_id: invite.channel_id,
        inviter: inviter ? toPublicUser(inviter, statusOf(inviter.id)) : null,
        uses: invite.uses,
        max_uses: invite.max_uses,
        created_at: invite.created_at,
        expires_at: invite.expires_at,
      };
    });
    return { invites };
  });

  router.post('/api/guilds/:guildId/invites', (ctx) => {
    const guildId = ctx.params.guildId;
    requireGuildPermission(ctx, guildId, Permissions.CREATE_INVITE, 'create invites');
    const user = requireUser(ctx);
    const body = assertObject(ctx.body);
    const channelId =
      optionalString(body.channel_id, 'channel_id', 32) ??
      listGuildChannels(deps.db, guildId).find((c) => c.type === 'text')?.id;
    if (!channelId) throw new HttpError(400, 'This server has no text channel to invite into', 'no_channel');
    const { code } = createInvite(deps.db, guildId, channelId, user.id, {
      max_uses: optionalNumber(body.max_uses, 'max_uses') ?? 0,
      max_age_seconds: optionalNumber(body.max_age_seconds, 'max_age_seconds') ?? null,
    });
    const invite = getInvite(deps.db, code)!;
    return {
      invite: {
        code,
        guild_id: guildId,
        channel_id: channelId,
        uses: invite.uses,
        max_uses: invite.max_uses,
        created_at: invite.created_at,
        expires_at: invite.expires_at,
      },
    };
  });

  router.delete('/api/invites/:code', (ctx) => {
    const invite = getInvite(deps.db, ctx.params.code);
    if (!invite) throw new HttpError(404, 'Invite not found', 'unknown_invite');
    requireGuildPermission(ctx, invite.guild_id, Permissions.MANAGE_INVITES, 'revoke invites');
    deleteInvite(deps.db, invite.code);
    return { ok: true };
  });

  router.get(
    '/api/invites/:code',
    (ctx) => {
      const invite = getInvite(deps.db, ctx.params.code);
      if (!invite) throw new HttpError(404, 'That invite is invalid', 'unknown_invite');
      if (!inviteIsUsable(invite)) throw new HttpError(410, 'That invite has expired', 'expired_invite');
      const guild = requireGuild(deps.db, invite.guild_id);
      const inviter = invite.inviter_id ? getUserById(deps.db, invite.inviter_id) : null;
      return {
        invite: {
          code: invite.code,
          guild_id: guild.id,
          channel_id: invite.channel_id,
          uses: invite.uses,
          max_uses: invite.max_uses,
          created_at: invite.created_at,
          expires_at: invite.expires_at,
          inviter: inviter ? toPublicUser(inviter, statusOf(inviter.id)) : null,
          guild: {
            id: guild.id,
            name: guild.name,
            icon_url: guild.icon_id ? `/api/files/${guild.icon_id}` : null,
            member_count: guildMemberIds(deps.db, guild.id).length,
          },
        },
      };
    },
    { auth: false },
  );

  router.post(
    '/api/invites/:code/accept',
    (ctx) => {
      const user = requireUser(ctx);
      const invite = getInvite(deps.db, ctx.params.code);
      if (!invite) throw new HttpError(404, 'That invite is invalid', 'unknown_invite');
      if (!inviteIsUsable(invite)) throw new HttpError(410, 'That invite has expired', 'expired_invite');
      requireNotBanned(ctx, invite.guild_id);
      const alreadyMember = isGuildMember(deps.db, invite.guild_id, user.id);
      if (!alreadyMember) {
        consumeInvite(deps.db, invite.code);
        addGuildMember(deps.db, invite.guild_id, user.id);
      }
      const bundle = guildBundle(deps.db, invite.guild_id, user.id, statusOf);
      deps.gateway.dispatchToUser(user.id, 'GUILD_CREATE', bundle);
      if (!alreadyMember) {
        deps.gateway.dispatch(
          'GUILD_MEMBER_ADD',
          {
            guild_id: invite.guild_id,
            member: bundle.members?.find((m) => m.user.id === user.id),
          },
          deps.gateway.audienceForGuild(invite.guild_id),
        );
      }
      return { guild: bundle, already_member: alreadyMember };
    },
    { limit: { limit: 20, windowMs: 60_000 } },
  );

  router.get('/api/guilds/:guildId/voice-states', (ctx) => {
    const user = requireUser(ctx);
    if (!isGuildMember(deps.db, ctx.params.guildId, user.id)) {
      throw new HttpError(403, 'You are not a member of that server', 'not_a_member');
    }
    return { states: deps.gateway.voiceStatesForGuild(ctx.params.guildId) };
  });

  router.post('/api/guilds/:guildId/transfer', (ctx) => {
    const user = requireUser(ctx);
    const guild = requireGuild(deps.db, ctx.params.guildId);
    if (guild.owner_id !== user.id) throw new HttpError(403, 'Only the owner can transfer a server', 'not_owner');
    const body = assertObject(ctx.body);
    const targetId = requiredString(body.user_id, 'user_id', 32);
    if (!isGuildMember(deps.db, guild.id, targetId)) throw new HttpError(400, 'That user is not a member', 'not_a_member');
    deps.db.run('UPDATE guilds SET owner_id = ? WHERE id = ?', [targetId, guild.id]);
    const audience = deps.gateway.audienceForGuild(guild.id);
    deps.gateway.dispatch('GUILD_UPDATE', { guild: toGuild(requireGuild(deps.db, guild.id)) }, audience);
    return { guild: toGuild(requireGuild(deps.db, guild.id)) as Guild };
  });

  router.post('/api/guilds/:guildId/leave', (ctx) => {
    const user = requireUser(ctx);
    const guild = requireGuild(deps.db, ctx.params.guildId);
    if (guild.owner_id === user.id) {
      throw new HttpError(400, 'The owner cannot leave — delete the server or transfer ownership', 'owner_cannot_leave');
    }
    removeGuildMember(deps.db, guild.id, user.id);
    deps.gateway.dispatchToUser(user.id, 'GUILD_DELETE', { id: guild.id });
    deps.gateway.dispatch(
      'GUILD_MEMBER_REMOVE',
      { guild_id: guild.id, user_id: user.id },
      deps.gateway.audienceForGuild(guild.id),
    );
    return { ok: true };
  });

}
