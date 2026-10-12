/**
 * Neurio — permission bitfield.
 *
 * Permissions are stored as a single SQLite INTEGER per role / overwrite.
 * `ADMINISTRATOR` grants everything and cannot be denied by channel overwrites.
 * Bit 31 is used (not bit 0..) so the value stays positive in JS (`2 ** 31`
 * would overflow into the sign bit; we use `1 << 30` style masks instead).
 */

export const Permissions = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  MANAGE_ROLES: 1 << 4,
  MANAGE_GUILD: 1 << 5,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  CREATE_INVITE: 1 << 8,
  ATTACH_FILES: 1 << 9,
  ADD_REACTIONS: 1 << 10,
  CONNECT_VOICE: 1 << 11,
  SPEAK: 1 << 12,
  VIDEO: 1 << 13,
  MENTION_EVERYONE: 1 << 14,
  MANAGE_INVITES: 1 << 15,
  CHANGE_NICKNAME: 1 << 16,
  ADMINISTRATOR: 1 << 30,
} as const;

export type PermissionKey = keyof typeof Permissions;

export const ALL_PERMISSIONS =
  Object.values(Permissions).reduce((acc, bit) => acc | bit, 0) >>> 0;

/** Sensible defaults for the @everyone role of a freshly created server. */
export const DEFAULT_EVERYONE_PERMISSIONS =
  Permissions.VIEW_CHANNEL |
  Permissions.SEND_MESSAGES |
  Permissions.ATTACH_FILES |
  Permissions.ADD_REACTIONS |
  Permissions.CREATE_INVITE |
  Permissions.CONNECT_VOICE |
  Permissions.SPEAK |
  Permissions.VIDEO |
  Permissions.CHANGE_NICKNAME;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  VIEW_CHANNEL: 'View channels',
  SEND_MESSAGES: 'Send messages',
  MANAGE_MESSAGES: 'Manage messages',
  MANAGE_CHANNELS: 'Manage channels',
  MANAGE_ROLES: 'Manage roles',
  MANAGE_GUILD: 'Manage server',
  KICK_MEMBERS: 'Kick members',
  BAN_MEMBERS: 'Ban members',
  CREATE_INVITE: 'Create invite',
  ATTACH_FILES: 'Attach files',
  ADD_REACTIONS: 'Add reactions',
  CONNECT_VOICE: 'Connect to voice',
  SPEAK: 'Speak in voice',
  VIDEO: 'Video & screen share',
  MENTION_EVERYONE: 'Mention @everyone',
  MANAGE_INVITES: 'Manage invites',
  CHANGE_NICKNAME: 'Change nickname',
  ADMINISTRATOR: 'Administrator',
};

export const PERMISSION_DESCRIPTIONS: Partial<Record<PermissionKey, string>> = {
  ADMINISTRATOR: 'Members with this permission bypass every other permission check.',
  MANAGE_GUILD: 'Change the server name, icon and description.',
  MANAGE_ROLES: 'Create, edit, delete roles and assign them to members.',
};

export function hasPermission(value: number, permission: number): boolean {
  if (permission === 0) return false; // never treat "no permission" as granted
  if ((value & Permissions.ADMINISTRATOR) !== 0) return true;
  return (value & permission) === permission;
}

export function permissionsToKeys(value: number): PermissionKey[] {
  return (Object.keys(Permissions) as PermissionKey[]).filter(
    (key) => (value & Permissions[key]) !== 0,
  );
}

export function keysToPermissions(keys: readonly string[]): number {
  let value = 0;
  for (const key of keys) {
    if (key in Permissions) value |= Permissions[key as PermissionKey];
  }
  return value >>> 0;
}

export const DEFAULT_ROLE_COLORS = [
  0x5865f2, 0x1abc9c, 0x57f287, 0xfee75c, 0xe67e22, 0xeb459e, 0xed4245,
];
