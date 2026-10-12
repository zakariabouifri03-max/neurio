/** Channel list for the selected server + DM list + the user panel. */
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { colorForId, statusLabel } from '../lib/format';
import type { Channel, UserStatus, VoiceState } from '../lib/types';

function ChannelRow({ channel, active, unread, mentions }: { channel: Channel; active: boolean; unread: number; mentions: number }) {
  const { selectChannel, openModal, voiceStates, activeCallChannelId } = useStore(useShallow((state) => ({
    selectChannel: state.selectChannel,
    openModal: state.openModal,
    voiceStates: state.voiceStates,
    activeCallChannelId: state.activeCallChannelId,
  })));
  const participants: VoiceState[] = voiceStates[channel.id] ?? [];
  const guild = useStore((state) => state.guilds[channel.guild_id ?? ''] ?? null);
  const users = guild?.members ?? [];
  const presence = useStore((state) => state.presence);
  const speakingUsers = useStore((state) => state.speakingUsers);

  return (
    <div className="channel-group">
      <button
        className="channel-row"
        data-active={active}
        data-unread={unread > 0}
        onClick={() => void selectChannel(channel.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (channel.guild_id) openModal('editChannel', { channelId: channel.id });
        }}
      >
        <span className="channel-glyph">{channel.type === 'voice' ? '🔊' : '#'}</span>
        <span className="channel-name">{channel.name}</span>
        {mentions > 0 && <span className="badge mention">{mentions}</span>}
        {unread > 0 && mentions === 0 && <span className="badge unread" />}
        {channel.slowmode_seconds > 0 && <span className="slowmode" title={`Slowmode: ${channel.slowmode_seconds}s`}>⏳</span>}
      </button>
      {channel.type === 'voice' && participants.length > 0 && (
        <ul className="voice-participants">
          {participants.map((state) => {
            const member = users.find((candidate) => candidate.user.id === state.user_id);
            const name = member?.nickname ?? member?.user.display_name ?? state.user_id;
            const status = presence[state.user_id]?.status ?? member?.user.status ?? 'online';
            return (
              <li key={state.user_id} data-speaking={speakingUsers[state.user_id] ? 'true' : undefined}>
                <div className="voice-avatar">
                  <Avatar user={{ id: state.user_id, display_name: name, avatar_url: member?.user.avatar_url ?? null, status }} size={20} showStatus={false} />
                  {speakingUsers[state.user_id] && <span className="speaking-ring" />}
                </div>
                <span className="voice-name">{name}</span>
                <span className="voice-flags">
                  {state.self_video && <span title="Camera on">🎥</span>}
                  {state.self_stream && <span title="Sharing screen">🖥️</span>}
                  {(state.self_mute || state.mute) && <span title="Muted">🔇</span>}
                  {state.deaf && <span title="Server deafened">🎧</span>}
                </span>
                {state.user_id === activeCallChannelId && <span className="voice-self">you</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ChannelSidebar() {
  const {
    guilds,
    selectedGuildId,
    channels,
    dmOrder,
    selectedChannelId,
    selectChannel,
    readStates,
    user,
    openModal,
    setView,
    view,
    voiceEngine,
    activeCallChannelId,
    createChannel,
    micMuted,
    deafened,
    toggleMute,
    toggleDeafen,
    leaveVoice,
    connection,
    relationships,
    presence,
  } = useStore(useShallow((state) => ({
    guilds: state.guilds,
    selectedGuildId: state.selectedGuildId,
    channels: state.channels,
    dmOrder: state.dmOrder,
    selectedChannelId: state.selectedChannelId,
    selectChannel: state.selectChannel,
    readStates: state.readStates,
    user: state.user,
    openModal: state.openModal,
    setView: state.setView,
    view: state.view,
    voiceEngine: state.voiceEngine,
    activeCallChannelId: state.activeCallChannelId,
    createChannel: state.createChannel,
    micMuted: state.micMuted,
    deafened: state.deafened,
    toggleMute: state.toggleMute,
    toggleDeafen: state.toggleDeafen,
    leaveVoice: state.leaveVoice,
    connection: state.connection,
    relationships: state.relationships,
    presence: state.presence,
  })));

  const [addingChannel, setAddingChannel] = useState<'text' | 'voice' | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [statusMenu, setStatusMenu] = useState(false);

  const guild = selectedGuildId ? guilds[selectedGuildId] : null;

  const grouped = useMemo(() => {
    const list = (guild?.channels?.length ? guild.channels : Object.values(channels)).filter((c) => c.guild_id === selectedGuildId) ?? [];
    const categories = list.filter((channel) => channel.type === 'category').sort((a, b) => a.position - b.position);
    const text = list.filter((channel) => channel.type === 'text').sort((a, b) => a.position - b.position);
    const voice = list.filter((channel) => channel.type === 'voice').sort((a, b) => a.position - b.position);
    return { categories, text, voice };
  }, [guild, channels, selectedGuildId]);

  const dmChannels = dmOrder.map((id) => channels[id]).filter((channel): channel is Channel => Boolean(channel));

  function displayNameFor(channel: Channel): string {
    if (channel.type === 'dm' || channel.type === 'group_dm') {
      const others = (channel.recipients ?? []).filter((recipient) => recipient.id !== user?.id);
      if (channel.type === 'group_dm') {
        return channel.name !== 'Group' ? channel.name : others.map((recipient) => recipient.display_name).join(', ') || 'Group';
      }
      return others[0]?.display_name ?? 'Direct message';
    }
    return channel.name;
  }

  function statusFor(channel: Channel): string {
    const other = (channel.recipients ?? []).find((recipient) => recipient.id !== user?.id);
    if (!other) return 'online';
    return presence[other.id]?.status ?? other.status;
  }

  const friendsBadge =
    relationships.filter((relationship) => relationship.type === 'incoming').length +
    dmChannels.reduce((sum, channel) => sum + (readStates[channel.id]?.mentions ?? 0), 0);

  return (
    <aside className="channel-sidebar">
      {guild ? (
        <>
          <header className="sidebar-header" onClick={() => openModal('guildMenu', { guildId: guild.id })}>
            <span className="sidebar-title">{guild.name}</span>
            <span className="sidebar-caret">▾</span>
          </header>
          <div className="channel-scroll">
            <div className="channel-section">
              <span>Text channels</span>
              <button
                className="icon-button tiny"
                title="Create text channel"
                onClick={() => setAddingChannel(addingChannel === 'text' ? null : 'text')}
              >
                +
              </button>
            </div>
            {grouped.text.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                active={selectedChannelId === channel.id && view === 'channels'}
                unread={readStates[channel.id]?.unread ?? 0}
                mentions={readStates[channel.id]?.mentions ?? 0}
              />
            ))}
            {addingChannel === 'text' && (
              <form
                className="new-channel"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!newChannelName.trim()) return;
                  await createChannel(guild.id, newChannelName, 'text');
                  setNewChannelName('');
                  setAddingChannel(null);
                }}
              >
                <input
                  autoFocus
                  value={newChannelName}
                  onChange={(event) => setNewChannelName(event.target.value)}
                  placeholder="new-channel"
                />
              </form>
            )}

            {grouped.voice.length > 0 && (
              <>
                <div className="channel-section">
                  <span>Voice channels</span>
                  <button
                    className="icon-button tiny"
                    title="Create voice channel"
                    onClick={() => setAddingChannel(addingChannel === 'voice' ? null : 'voice')}
                  >
                    +
                  </button>
                </div>
                {addingChannel === 'voice' && (
                  <form
                    className="new-channel"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!newChannelName.trim()) return;
                      await createChannel(guild.id, newChannelName, 'voice');
                      setNewChannelName('');
                      setAddingChannel(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={newChannelName}
                      onChange={(event) => setNewChannelName(event.target.value)}
                      placeholder="Lounge"
                    />
                  </form>
                )}
                {grouped.voice.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    active={activeCallChannelId === channel.id}
                    unread={0}
                    mentions={0}
                  />
                ))}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <header className="sidebar-header">
            <span className="sidebar-title">Direct messages</span>
          </header>
          <div className="channel-scroll">
            <button
              className="channel-row friends-row"
              data-active={view === 'friends'}
              onClick={() => setView('friends')}
            >
              <span className="channel-glyph">☺</span>
              <span className="channel-name">Friends</span>
              {friendsBadge > 0 && <span className="badge mention">{friendsBadge}</span>}
            </button>
            {dmChannels.map((channel) => (
              <button
                key={channel.id}
                className="channel-row dm-row"
                data-active={selectedChannelId === channel.id}
                data-unread={(readStates[channel.id]?.unread ?? 0) > 0}
                onClick={() => void selectChannel(channel.id)}
              >
                <Avatar
                  user={{
                    id: (channel.recipients ?? []).find((recipient) => recipient.id !== user?.id)?.id ?? channel.id,
                    display_name: displayNameFor(channel),
                    avatar_url: (channel.recipients ?? []).find((recipient) => recipient.id !== user?.id)?.avatar_url ?? null,
                    status: statusFor(channel) as UserStatus,
                  }}
                  size={26}
                />
                <span className="channel-name">{displayNameFor(channel)}</span>
                {channel.type === 'group_dm' && <span className="tag">group</span>}
                {(readStates[channel.id]?.mentions ?? 0) > 0 && (
                  <span className="badge mention">{readStates[channel.id].mentions}</span>
                )}
              </button>
            ))}
            {dmChannels.length === 0 && <p className="empty-note">No conversations yet — add a friend to start chatting.</p>}
          </div>
        </>
      )}

      {voiceEngine?.channelId && (
        <div className="voice-status-bar">
          <div className="voice-status-info">
            <span className="voice-status-dot" data-connected={connection === 'connected'} />
            <div>
              <strong>Voice connected</strong>
              <small>{channels[voiceEngine.channelId]?.name ?? 'call'}</small>
            </div>
          </div>
          <div className="voice-status-actions">
            <button className="icon-button" onClick={toggleMute} title={micMuted ? 'Unmute' : 'Mute'}>
              {micMuted ? '🔇' : '🎙️'}
            </button>
            <button className="icon-button" onClick={toggleDeafen} title={deafened ? 'Undeafen' : 'Deafen'}>
              {deafened ? '🔕' : '🎧'}
            </button>
            <button className="icon-button danger" onClick={() => void leaveVoice()} title="Leave call">
              ✖
            </button>
          </div>
        </div>
      )}

      <div className="user-panel">
        <Avatar user={user} size={32} onClick={() => openModal('userSettings')} />
        <div className="user-panel-text">
          <strong>{user?.display_name}</strong>
          <small>{user?.custom_status || statusLabel(user?.status ?? 'offline')}</small>
        </div>
        <div className="user-panel-actions">
          <button className="icon-button" onClick={toggleMute} title={micMuted ? 'Unmute microphone' : 'Mute microphone'}>
            {micMuted ? '🔇' : '🎙️'}
          </button>
          <button className="icon-button" onClick={toggleDeafen} title={deafened ? 'Undeafen' : 'Deafen'}>
            {deafened ? '🔕' : '🎧'}
          </button>
          <button className="icon-button" onClick={() => setStatusMenu((open) => !open)} title="Change status">
            ⚙
          </button>
        </div>
        {statusMenu && (
          <div className="status-menu" onMouseLeave={() => setStatusMenu(false)}>
            {(['online', 'idle', 'dnd', 'invisible'] as UserStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => {
                  useStore.getState().setStatus(status);
                  setStatusMenu(false);
                }}
              >
                <span className="status-dot" data-status={status} />
                {statusLabel(status)}
              </button>
            ))}
            <button onClick={() => { openModal('userSettings'); setStatusMenu(false); }}>Settings…</button>
            <button onClick={() => void useStore.getState().logout()}>Sign out</button>
          </div>
        )}
        <span className="user-color-strip" style={{ background: colorForId(user?.id ?? '') }} />
      </div>
    </aside>
  );
}
