/** Right-hand member list, grouped by role and presence. */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';

/** Stable identity for selectors (a fresh [] would re-render forever). */
const EMPTY_MEMBERS: GuildMember[] = [];
import { Avatar } from './Avatar';
import type { Channel, GuildMember, Role } from '../lib/types';

function groupMembers(members: GuildMember[], roles: Role[], userStatus: (id: string) => string) {
  const hoisted = [...roles].filter((role) => role.hoist && !role.is_default).sort((a, b) => b.position - a.position);
  const groups: { label: string; color: number; members: GuildMember[] }[] = [];
  const seen = new Set<string>();
  for (const role of hoisted) {
    const list = members.filter(
      (member) => !seen.has(member.user.id) && member.role_ids.includes(role.id),
    );
    if (list.length === 0) continue;
    for (const member of list) seen.add(member.user.id);
    groups.push({ label: role.name, color: role.color, members: list });
  }
  const online = members.filter((member) => !seen.has(member.user.id) && userStatus(member.user.id) !== 'offline');
  const offline = members.filter((member) => !seen.has(member.user.id) && userStatus(member.user.id) === 'offline');
  if (online.length > 0) groups.push({ label: 'Online', color: 0, members: online });
  if (offline.length > 0) groups.push({ label: 'Offline', color: 0, members: offline });
  return groups;
}

export function MemberList({ channel }: { channel: Channel | null }) {
  const { guild, presence, openModal, updateMember, members } = useStore(useShallow((state) => ({
    guild: (channel?.guild_id && state.guilds[channel.guild_id]) || null,
    presence: state.presence,
    openModal: state.openModal,
    updateMember: state.updateMember,
    members: (channel?.guild_id && state.guilds[channel.guild_id]?.members) || EMPTY_MEMBERS,
  })));

  const statusOf = (userId: string) => presence[userId]?.status ?? 'offline';
  const groups = useMemo(
    () => groupMembers(members, guild?.roles ?? [], statusOf),
    [members, guild?.roles, presence],
  );

  if (channel?.type === 'dm' || channel?.type === 'group_dm' || !guild) return null;

  async function setNickname(member: GuildMember) {
    const nickname = window.prompt(`Nickname for ${member.user.display_name}`, member.nickname ?? '');
    if (nickname === null) return;
    await updateMember(guild!.id, member.user.id, { nickname: nickname.trim() || null });
  }

  return (
    <aside className="member-list">
      {groups.map((group) => (
        <section key={group.label}>
          <h3 style={group.color ? { color: `#${group.color.toString(16).padStart(6, '0')}` } : undefined}>
            {group.label} — {group.members.length}
          </h3>
          <ul>
            {group.members.map((member) => {
              const status = statusOf(member.user.id);
              const voice = presence[member.user.id]?.voice_channel_id;
              return (
                <li key={member.user.id}>
                  <button
                    className="member-row"
                    data-offline={status === 'offline'}
                    onClick={() => openModal('profile', { userId: member.user.id })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void setNickname(member);
                    }}
                  >
                    <Avatar user={{ ...member.user, status }} size={30} />
                    <span className="member-text">
                      <strong style={member.user.custom_status ? undefined : { color: undefined }}>
                        {member.nickname ?? member.user.display_name}
                      </strong>
                      {voice && <small>🔊 in voice</small>}
                      {!voice && member.user.custom_status && <small>{member.user.custom_status}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {members.length === 0 && <p className="empty-note">Loading members…</p>}
    </aside>
  );
}
