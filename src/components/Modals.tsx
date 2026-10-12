/** Every dialog in one place: servers, invites, channels, roles, profile, search, pins. */
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { PERMISSION_LABELS, Permissions, permissionsToKeys, keysToPermissions } from '../../shared/permissions';
import { formatBytes, formatDateTime, statusLabel } from '../lib/format';
import type { Attachment, Message, PermissionKey, PublicUser, Role, SearchHit, SessionInfo } from '../lib/types';

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" data-wide={wide ? 'true' : undefined} role="dialog" aria-modal="true">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function CreateGuildModal({ onClose }: { onClose: () => void }) {
  const { createGuild, selectGuild } = useStore(useShallow((state) => ({ createGuild: state.createGuild, selectGuild: state.selectGuild })));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Create a server" onClose={onClose}>
      <form
        className="stacked-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const id = await createGuild(name.trim());
            selectGuild(id);
            onClose();
          } catch (caught) {
            setError((caught as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="hint">
          Servers live on your own machine. You get a #general text channel, a Lounge voice channel, a
          @everyone role and a Moderator role out of the box.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <label>
          Server name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My hangout" autoFocus />
        </label>
        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create server'}
        </button>
      </form>
    </Modal>
  );
}

function JoinGuildModal({ onClose }: { onClose: () => void }) {
  const { acceptInvite, selectGuild, toast } = useStore(useShallow((state) => ({
    acceptInvite: state.acceptInvite,
    selectGuild: state.selectGuild,
    toast: state.toast,
  })));
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = useStore((state) => state.api);

  useEffect(() => {
    const trimmed = code.trim().replace(/^.*\/invite\//, '');
    if (!trimmed || !api) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await api.invitePreview(trimmed);
        setPreview(`${response.invite.guild?.name ?? 'Server'} · ${response.invite.guild?.member_count ?? 0} members`);
      } catch (error) {
        setPreview(`— ${(error as Error).message}`);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [code, api]);

  return (
    <Modal title="Join a server" onClose={onClose}>
      <form
        className="stacked-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const id = await acceptInvite(code.trim());
            selectGuild(id);
            toast('Joined the server', 'success');
            onClose();
          } catch (error) {
            toast((error as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="hint">Paste an invite code (or a full invite link) from a friend. Codes look like <code>abcd2345</code>.</p>
        <label>
          Invite code
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="abcd2345" autoFocus />
        </label>
        {preview && <p className="hint">{preview}</p>}
        <button className="primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Joining…' : 'Join server'}
        </button>
      </form>
    </Modal>
  );
}

function InviteModal({ guildId }: { guildId: string }) {
  const closeModal = useStore((state) => state.closeModal);
  const { guilds, createInvite, selectedChannelId, channels } = useStore(useShallow((state) => ({
    guilds: state.guilds,
    createInvite: state.createInvite,
    selectedChannelId: state.selectedChannelId,
    channels: state.channels,
  })));
  const guild = guilds[guildId];
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useStore((state) => state.toast);

  const channel = selectedChannelId ? channels[selectedChannelId] : undefined;
  const targetChannel = channel?.guild_id === guildId ? channel : guild?.channels?.find((entry) => entry.type === 'text');

  return (
    <Modal title={`Invite people to ${guild?.name ?? 'server'}`} onClose={closeModal}>
      <div className="stacked-form">
        <p className="hint">
          Anyone on your network who can reach this server can use the code. Invites never expire unless you
          set a limit in the API.
        </p>
        {code ? (
          <>
            <div className="invite-code">
              <code>{code}</code>
              <button
                className="primary small"
                onClick={() => {
                  void navigator.clipboard?.writeText(code).catch(() => undefined);
                  toast('Invite code copied', 'success');
                }}
              >
                Copy
              </button>
            </div>
            <button
              className="link"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(`${window.location.origin}/#/invite/${code}`)
                  .catch(() => undefined);
                toast('Full invite link copied', 'success');
              }}
            >
              Copy invite link instead
            </button>
          </>
        ) : (
          <button
            className="primary"
            disabled={busy || !targetChannel}
            onClick={async () => {
              setBusy(true);
              try {
                const generated = await createInvite(guildId, targetChannel?.id);
                setCode(generated);
              } catch (error) {
                toast((error as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Generating…' : 'Generate a new invite'}
          </button>
        )}
      </div>
    </Modal>
  );
}

function RoleModal({ guildId, roleId }: { guildId: string; roleId?: string }) {
  const closeModal = useStore((state) => state.closeModal);
  const { guilds, createRole, updateRole, deleteRole, toast } = useStore(useShallow((state) => ({
    guilds: state.guilds,
    createRole: state.createRole,
    updateRole: state.updateRole,
    deleteRole: state.deleteRole,
    toast: state.toast,
  })));
  const guild = guilds[guildId];
  const role: Role | undefined = roleId ? guild?.roles?.find((entry) => entry.id === roleId) : undefined;
  const [name, setName] = useState(role?.name ?? 'New role');
  const [color, setColor] = useState(`#${(role?.color ?? 0x5865f2).toString(16).padStart(6, '0')}`);
  const [permissionKeys, setPermissionKeys] = useState<PermissionKey[]>(permissionsToKeys(role?.permissions ?? Permissions.VIEW_CHANNEL));
  const [hoist, setHoist] = useState(role?.hoist ?? false);

  return (
    <Modal title={role ? `Edit role · ${role.name}` : 'Create a role'} onClose={closeModal} wide>
      <div className="role-editor">
        <label>
          Role name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Colour
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={hoist} onChange={(event) => setHoist(event.target.checked)} />
          Show members with this role separately in the member list
        </label>

        <h3>Permissions</h3>
        <div className="permission-grid">
          {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map((key) => (
            <label key={key} className="checkbox" data-disabled={role?.is_default && key === 'ADMINISTRATOR'}>
              <input
                type="checkbox"
                checked={permissionKeys.includes(key)}
                onChange={(event) =>
                  setPermissionKeys((current) =>
                    event.target.checked ? [...current, key] : current.filter((entry) => entry !== key),
                  )
                }
              />
              {PERMISSION_LABELS[key]}
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button
            className="primary"
            onClick={async () => {
              const payload = {
                name,
                color: Number.parseInt(color.replace('#', ''), 16),
                permissions: keysToPermissions(permissionKeys),
                hoist,
              };
              if (role) await updateRole(guildId, role.id, payload);
              else await createRole(guildId, payload);
              toast(role ? 'Role updated' : 'Role created', 'success');
              closeModal();
            }}
          >
            {role ? 'Save changes' : 'Create role'}
          </button>
          {role && !role.is_default && (
            <button
              className="danger"
              onClick={async () => {
                await deleteRole(guildId, role.id);
                toast('Role deleted', 'success');
                closeModal();
              }}
            >
              Delete role
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ChannelModal({ channelId }: { channelId: string }) {
  const closeModal = useStore((state) => state.closeModal);
  const { channels, updateChannel, deleteChannel, guilds, setOverwrite, toast } = useStore(useShallow((state) => ({
    channels: state.channels,
    updateChannel: state.updateChannel,
    deleteChannel: state.deleteChannel,
    guilds: state.guilds,
    setOverwrite: state.setOverwrite,
    toast: state.toast,
  })));
  const channel = channels[channelId];
  const guild = channel?.guild_id ? guilds[channel.guild_id] : null;
  const [name, setName] = useState(channel?.name ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [slowmode, setSlowmode] = useState(channel?.slowmode_seconds ?? 0);
  const [selectedRole, setSelectedRole] = useState('');
  const [denyView, setDenyView] = useState(false);

  if (!channel) return null;

  return (
    <Modal title={`Edit #${channel.name}`} onClose={closeModal} wide>
      <div className="stacked-form">
        <label>
          Channel name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {channel.type === 'text' && (
          <>
            <label>
              Topic
              <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="What is this channel about?" />
            </label>
            <label>
              Slowmode (seconds between messages)
              <input
                type="number"
                min={0}
                max={21600}
                value={slowmode}
                onChange={(event) => setSlowmode(Number(event.target.value))}
              />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button
            className="primary"
            onClick={async () => {
              await updateChannel(channel.id, { name, topic, slowmode_seconds: slowmode });
              toast('Channel saved', 'success');
              closeModal();
            }}
          >
            Save
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!window.confirm(`Delete #${channel.name}? This removes its messages too.`)) return;
              await deleteChannel(channel.id);
              toast('Channel deleted', 'success');
              closeModal();
            }}
          >
            Delete channel
          </button>
        </div>

        {guild && (
          <>
            <h3>Permissions</h3>
            <p className="hint">
              Deny <strong>View channels</strong> for a role to make this channel private. Members with
              Administrator always keep access.
            </p>
            <div className="overwrite-row">
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
                <option value="">Choose a role…</option>
                {(guild.roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <label className="checkbox">
                <input type="checkbox" checked={denyView} onChange={(event) => setDenyView(event.target.checked)} />
                Deny viewing
              </label>
              <button
                className="primary small"
                disabled={!selectedRole}
                onClick={async () => {
                  const allow = denyView ? 0 : Permissions.VIEW_CHANNEL;
                  const deny = denyView ? Permissions.VIEW_CHANNEL : 0;
                  await setOverwrite(channel.id, selectedRole, 'role', allow, deny);
                  toast('Permission overwrite saved', 'success');
                }}
              >
                Apply
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function GuildMenuModal({ guildId }: { guildId: string }) {
  const closeModal = useStore((state) => state.closeModal);
  const { guilds, createGuild, toast, openModal } = useStore(useShallow((state) => ({
    guilds: state.guilds,
    createGuild: state.createGuild,
    toast: state.toast,
    openModal: state.openModal,
  })));
  const api = useStore((state) => state.api);
  const guild = guilds[guildId];
  const [name, setName] = useState(guild?.name ?? '');
  if (!guild) return null;

  return (
    <Modal title={guild.name} onClose={closeModal}>
      <div className="stacked-form">
        <div className="guild-preview">
          <Avatar user={{ id: guild.id, display_name: guild.name, avatar_url: guild.icon_url, status: 'online' }} size={56} showStatus={false} />
          <div>
            <strong>{guild.name}</strong>
            <small>
              {guild.member_count ?? guild.members?.length ?? 1} member
              {(guild.member_count ?? 1) === 1 ? '' : 's'} · created {formatDateTime(guild.created_at)}
            </small>
          </div>
        </div>
        <label>
          Server name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Server icon
          <input
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file || !api) return;
              try {
                await api.uploadGuildIcon(guild.id, file);
                await useStore.getState().refreshGuild(guild.id);
                toast('Server icon updated', 'success');
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          />
        </label>
        <div className="modal-actions">
          <button
            className="primary"
            onClick={async () => {
              await useStore.getState().updateProfile({});
              await api?.updateGuild(guild.id, { name });
              await useStore.getState().refreshGuild(guild.id);
              toast('Server updated', 'success');
              closeModal();
            }}
          >
            Save changes
          </button>
          <button className="link" onClick={() => { closeModal(); openModal('invite', { guildId }); }}>
            Invite people
          </button>
          <button className="link" onClick={() => { closeModal(); openModal('role', { guildId }); }}>
            Create role
          </button>
        </div>

        <h3>Roles</h3>
        <ul className="role-rows">
          {(guild.roles ?? []).map((role) => (
            <li key={role.id}>
              <span className="role-dot" style={{ background: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5' }} />
              <button className="link" onClick={() => { closeModal(); openModal('role', { guildId, roleId: role.id }); }}>
                {role.name}
              </button>
              <small>{permissionsToKeys(role.permissions).length} permissions</small>
            </li>
          ))}
        </ul>

        <h3>Danger zone</h3>
        {guild.owner_id === useStore.getState().user?.id ? (
          <button
            className="danger"
            onClick={async () => {
              if (!window.confirm(`Delete ${guild.name} for everyone? This cannot be undone.`)) return;
              try {
                await api?.deleteGuild(guild.id);
                toast('Server deleted', 'success');
                closeModal();
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          >
            Delete server
          </button>
        ) : (
          <button
            className="danger"
            onClick={async () => {
              if (!window.confirm(`Leave ${guild.name}?`)) return;
              try {
                await api?.request('POST', `/api/guilds/${guild.id}/leave`);
                toast('You left the server', 'success');
                closeModal();
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          >
            Leave server
          </button>
        )}
        {void createGuild}
      </div>
    </Modal>
  );
}

function ProfileModal({ userId }: { userId: string }) {
  const closeModal = useStore((state) => state.closeModal);
  const { user, guilds, relationships, openDm, acceptFriend, addFriend, blockUser, presence } = useStore(useShallow((state) => ({
    user: state.user,
    guilds: state.guilds,
    relationships: state.relationships,
    openDm: state.openDm,
    acceptFriend: state.acceptFriend,
    addFriend: state.addFriend,
    blockUser: state.blockUser,
    presence: state.presence,
  })));
  if (user?.id === userId) return <UserSettingsModal />;

  const allMembers = Object.values(guilds).flatMap((guild) => guild.members ?? []);
  const member = allMembers.find((candidate) => candidate.user.id === userId);
  const person: PublicUser | undefined = member?.user;
  const relationship = relationships.find((entry) => entry.user.id === userId);
  const status = presence[userId]?.status ?? person?.status ?? 'offline';

  return (
    <Modal title="Profile" onClose={closeModal}>
      <div className="profile-card">
        <div className="profile-banner" />
        <Avatar user={{ ...(person ?? { id: userId, display_name: 'Unknown', avatar_url: null }), status }} size={72} />
        <h3>{member?.nickname ?? person?.display_name ?? 'Unknown user'}</h3>
        <p className="muted">
          @{person?.username ?? 'unknown'} · {statusLabel(status)}
        </p>
        {presence[userId]?.custom_status && <p className="status-line">{presence[userId].custom_status}</p>}
        {person?.bio && <p>{person.bio}</p>}
        <div className="modal-actions">
          <button className="primary small" onClick={() => { void openDm(userId); closeModal(); }}>
            Send message
          </button>
          {relationship?.type === 'incoming' && (
            <button className="small" onClick={() => void acceptFriend(userId)}>
              Accept request
            </button>
          )}
          {!relationship && (
            <button className="small" onClick={() => person && void addFriend(person.username)}>
              Add friend
            </button>
          )}
          <button className="link danger" onClick={() => void blockUser(userId)}>
            Block
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UserSettingsModal() {
  const closeModal = useStore((state) => state.closeModal);
  const { user, updateProfile, uploadAvatar, settings, updateSettings, api, toast, microphoneLevel } = useStore(
    useShallow((state) => ({
      user: state.user,
      updateProfile: state.updateProfile,
      uploadAvatar: state.uploadAvatar,
      settings: state.settings,
      updateSettings: state.updateSettings,
      api: state.api,
      toast: state.toast,
      microphoneLevel: state.microphoneLevel,
    })),
  );
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '');
  const [tab, setTab] = useState<'profile' | 'appearance' | 'sessions' | 'server'>('profile');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [isOperator, setIsOperator] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);

  useEffect(() => {
    if (tab !== 'sessions' || !api) return;
    void api.sessions().then((response) => setSessions(response.sessions)).catch(() => setSessions([]));
  }, [tab, api]);

  useEffect(() => {
    if (tab !== 'server' || !api) return;
    void api
      .stats()
      .then((response) => {
        setStats(response as unknown as Record<string, unknown>);
        setRegistrationOpen(response.registration_open);
        return api.whoami();
      })
      .then((who) => setIsOperator(who.is_operator))
      .catch(() => setIsOperator(false));
  }, [tab, api]);

  return (
    <Modal title="Settings" onClose={closeModal} wide>
      <nav className="settings-tabs">
        {(['profile', 'appearance', 'sessions', 'server'] as const).map((candidate) => (
          <button key={candidate} data-active={tab === candidate} onClick={() => setTab(candidate)}>
            {candidate}
          </button>
        ))}
      </nav>

      {tab === 'profile' && (
        <div className="stacked-form">
          <div className="avatar-editor">
            <Avatar user={user} size={72} />
            <div>
              <input
                type="file"
                accept="image/*"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) await uploadAvatar(file);
                }}
              />
              <p className="hint">PNG, JPEG, GIF or WebP. Stored on your own server.</p>
            </div>
          </div>
          <label>
            Display name
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            About me
            <textarea rows={3} value={bio} onChange={(event) => setBio(event.target.value)} />
          </label>
          <label>
            Custom status
            <input
              value={customStatus}
              onChange={(event) => setCustomStatus(event.target.value)}
              placeholder="Working on something great"
            />
          </label>
          <p className="hint">
            Microphone level: <meter min={0} max={0.2} value={Math.min(microphoneLevel, 0.2)} /> (join a call to test)
          </p>
          <button
            className="primary"
            onClick={() =>
              void updateProfile({
                display_name: displayName,
                bio,
                custom_status: customStatus.trim() ? customStatus : null,
              })
            }
          >
            Save profile
          </button>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="stacked-form">
          <label>
            Theme
            <select value={settings.theme} onChange={(event) => updateSettings({ theme: event.target.value as typeof settings.theme })}>
              <option value="dark">Dark (default)</option>
              <option value="midnight">Midnight</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label>
            Font size
            <select
              value={settings.fontSize}
              onChange={(event) => updateSettings({ fontSize: event.target.value as typeof settings.fontSize })}
            >
              <option value="small">Small</option>
              <option value="normal">Normal</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.compactMode}
              onChange={(event) => updateSettings({ compactMode: event.target.checked })}
            />
            Compact message spacing
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.desktopNotifications}
              onChange={(event) => updateSettings({ desktopNotifications: event.target.checked })}
            />
            Desktop notifications
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.notificationSound}
              onChange={(event) => updateSettings({ notificationSound: event.target.checked })}
            />
            Play a chime for new messages
          </label>
          <label>
            Server address
            <input
              value={useStore.getState().baseUrl}
              onChange={(event) => localStorage.setItem('neurio.baseUrl', event.target.value)}
            />
          </label>
          <p className="hint">Changes apply immediately and are stored on this device.</p>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="stacked-form">
          <p className="hint">Every device signed into this account. Revoking a session signs that device out instantly.</p>
          <ul className="role-rows">
            {sessions.map((session) => (
              <li key={session.id}>
                <span>{session.device_label}</span>
                <small>
                  {session.kind} · last seen {formatDateTime(session.last_seen_at)}
                  {session.current ? ' · this device' : ''}
                </small>
                {!session.current && (
                  <button
                    className="link danger"
                    onClick={async () => {
                      await api?.revokeSession(session.id);
                      setSessions((current) => current.filter((entry) => entry.id !== session.id));
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            className="danger"
            onClick={async () => {
              await api?.request('POST', '/api/users/@me/sessions/revoke-all');
              toast('All other sessions were signed out', 'success');
            }}
          >
            Sign out everywhere else
          </button>

          <h3>Change password</h3>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              try {
                await api?.changePassword(String(data.get('current')), String(data.get('next')));
                toast('Password changed — other devices were signed out', 'success');
                form.reset();
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          >
            <input name="current" type="password" placeholder="Current password" autoComplete="current-password" />
            <input name="next" type="password" placeholder="New password" autoComplete="new-password" />
            <button className="primary" type="submit">
              Update password
            </button>
          </form>
        </div>
      )}

      {tab === 'server' && (
        <div className="stacked-form">
          {stats ? (
            <ul className="stats-list">
              <li>
                <span>Database</span>
                <code>{String((stats.database as { file: string }).file)}</code>
              </li>
              <li>
                <span>Schema version</span>
                <code>{String((stats.database as { schema_version: number }).schema_version)}</code>
              </li>
              <li>
                <span>Size on disk</span>
                <code>{formatBytes(Number((stats.database as { size_bytes: number }).size_bytes))}</code>
              </li>
              <li>
                <span>Uptime</span>
                <code>{Math.round(Number(stats.uptime_ms) / 1000)}s</code>
              </li>
              <li>
                <span>Live gateway connections</span>
                <code>{String(stats.gateway_clients)}</code>
              </li>
              {Object.entries(stats.counts as Record<string, number>).map(([key, value]) => (
                <li key={key}>
                  <span>{key}</span>
                  <code>{value}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Only the server operator can see these details.</p>
          )}
          {isOperator && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={registrationOpen}
                onChange={async (event) => {
                  setRegistrationOpen(event.target.checked);
                  await api?.setRegistration(event.target.checked);
                  toast('Registration setting saved', 'success');
                }}
              />
              Allow new accounts to register on this server
            </label>
          )}
          <div className="hint">
            <p>
              Voice and video are peer-to-peer (WebRTC). Working across the internet needs a reachable server
              plus STUN/TURN — see <code>docs/NETWORKING.md</code> in the project folder.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SearchModal() {
  const closeModal = useStore((state) => state.closeModal);
  const { api, selectedGuildId, channels, selectChannel, toast } = useStore(useShallow((state) => ({
    api: state.api,
    selectedGuildId: state.selectedGuildId,
    channels: state.channels,
    selectChannel: state.selectChannel,
    toast: state.toast,
  })));
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [inGuildOnly, setInGuildOnly] = useState(true);

  return (
    <Modal title="Search messages" onClose={closeModal} wide>
      <form
        className="search-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!api || query.trim().length === 0) return;
          setBusy(true);
          try {
            const response = await api.search({
              q: query.trim(),
              guild_id: inGuildOnly && selectedGuildId ? selectedGuildId : undefined,
            });
            setHits(response.hits);
            if (response.hits.length === 0) toast('No matches found', 'info');
          } catch (error) {
            toast((error as Error).message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all messages…" />
        <label className="checkbox">
          <input type="checkbox" checked={inGuildOnly} onChange={(event) => setInGuildOnly(event.target.checked)} />
          Only the selected server
        </label>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      <ul className="search-results">
        {hits.map((hit) => (
          <li key={hit.message.id}>
            <button
              onClick={() => {
                void selectChannel(hit.message.channel_id);
                closeModal();
              }}
            >
              <span className="search-meta">
                {hit.guild_name ? `${hit.guild_name} · ` : ''}
                {hit.channel.type === 'text' ? `#${channels[hit.channel.id]?.name ?? hit.channel.name}` : 'direct message'} ·{' '}
                {formatDateTime(hit.message.created_at)}
              </span>
              <span className="search-author">{hit.message.author.display_name}</span>
              <span className="search-snippet">{hit.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PinsModal({ channelId }: { channelId: string }) {
  const closeModal = useStore((state) => state.closeModal);
  const [messages, setMessages] = useState<Message[]>([]);
  const api = useStore((state) => state.api);
  const { togglePin, channels } = useStore(useShallow((state) => ({ togglePin: state.togglePin, channels: state.channels })));

  useEffect(() => {
    if (!api) return;
    void api.pins(channelId).then((response) => setMessages(response.messages)).catch(() => setMessages([]));
  }, [api, channelId]);

  return (
    <Modal title={`Pinned messages · #${channels[channelId]?.name ?? ''}`} onClose={closeModal} wide>
      <ul className="pin-list">
        {messages.map((message) => (
          <li key={message.id}>
            <div className="pin-head">
              <Avatar user={message.author} size={24} showStatus={false} />
              <strong>{message.author.display_name}</strong>
              <small>{formatDateTime(message.created_at)}</small>
              <button className="link" onClick={() => void togglePin(message.id, true)}>
                Unpin
              </button>
            </div>
            <Markdown content={message.content} />
          </li>
        ))}
        {messages.length === 0 && <p className="empty-note">Nothing pinned in this channel yet.</p>}
      </ul>
    </Modal>
  );
}

function LightboxModal({ attachment }: { attachment: Attachment }) {
  const closeModal = useStore((state) => state.closeModal);
  const api = useStore((state) => state.api);
  const url = api?.fileUrl(attachment.url) ?? attachment.url;
  return (
    <div className="lightbox" onClick={closeModal}>
      <img src={url} alt={attachment.filename} />
      <div className="lightbox-meta">
        <strong>{attachment.filename}</strong>
        <span>{formatBytes(attachment.size)}</span>
        {window.neurio?.saveFile && (
          <button
            className="primary small"
            onClick={async (event) => {
              event.stopPropagation();
              const saved = await window.neurio?.saveFile({ url, filename: attachment.filename });
              if (saved) useStore.getState().toast('Saved to disk', 'success');
            }}
          >
            Save as…
          </button>
        )}
      </div>
    </div>
  );
}

export function ModalHost() {
  const modal = useStore((state) => state.modal);
  const closeModal = useStore((state) => state.closeModal);
  if (!modal) return null;
  const props = (modal.props ?? {}) as Record<string, never> & { guildId: string; roleId?: string; channelId: string; userId: string; attachment: Attachment };

  switch (modal.kind) {
    case 'createGuild':
      return <CreateGuildModal onClose={closeModal} />;
    case 'joinGuild':
      return <JoinGuildModal onClose={closeModal} />;
    case 'invite':
      return <InviteModal guildId={props.guildId} />;
    case 'role':
      return <RoleModal guildId={props.guildId} roleId={props.roleId} />;
    case 'editChannel':
      return <ChannelModal channelId={props.channelId} />;
    case 'guildMenu':
      return <GuildMenuModal guildId={props.guildId} />;
    case 'profile':
      return <ProfileModal userId={props.userId} />;
    case 'userSettings':
      return <UserSettingsModal />;
    case 'search':
      return <SearchModal />;
    case 'pins':
      return <PinsModal channelId={props.channelId} />;
    case 'lightbox':
      return <LightboxModal attachment={props.attachment as unknown as Attachment} />;
    default:
      return (
        <Modal title={modal.kind} onClose={closeModal}>
          <p className="hint">Unknown dialog.</p>
        </Modal>
      );
  }
}
