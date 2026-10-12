/** Main layout: guild rail · channel sidebar · content · member list. */
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { GuildRail } from './GuildRail';
import { ChannelSidebar } from './ChannelSidebar';
import { MessageList } from './MessageList';
import { MemberList } from './MemberList';
import { FriendsView } from './FriendsView';
import { VoiceView } from './VoiceView';
import { Toasts } from './Toasts';
import { Avatar } from './Avatar';
import { colorForId } from '../lib/format';
import type { Attachment, VoiceState } from '../lib/types';

function ChannelHeader() {
  const { channel, guild, openModal, settings, updateSettings, joinVoice, activeCallChannelId, voiceStates, leaveVoice } =
    useStore(useShallow((state) => ({
      channel: state.selectedChannelId ? state.channels[state.selectedChannelId] : null,
      guild: state.selectedChannelId && state.channels[state.selectedChannelId]?.guild_id
        ? state.guilds[state.channels[state.selectedChannelId]!.guild_id!]
        : null,
      openModal: state.openModal,
      settings: state.settings,
      updateSettings: state.updateSettings,
      joinVoice: state.joinVoice,
      activeCallChannelId: state.activeCallChannelId,
      voiceStates: state.voiceStates,
      leaveVoice: state.leaveVoice,
    })));

  if (!channel) return null;
  const direct = channel.type === 'dm' || channel.type === 'group_dm';
  const others = (channel.recipients ?? []).filter((recipient) => recipient.id !== useStore.getState().user?.id);
  const title = direct ? others.map((other) => other.display_name).join(', ') || channel.name : channel.name;
  const participants: VoiceState[] = voiceStates[channel.id] ?? [];

  return (
    <header className="channel-header">
      {direct ? (
        <Avatar user={others[0] ?? null} size={26} />
      ) : (
        <span className="channel-glyph">{channel.type === 'voice' ? '🔊' : '#'}</span>
      )}
      <h2>{title}</h2>
      {channel.topic && <p className="channel-topic">{channel.topic}</p>}
      <span className="channel-network" data-connected={useStore.getState().connection === 'connected'}>
        {useStore.getState().connection === 'connected' ? 'live' : useStore.getState().connection}
      </span>
      <div className="channel-header-actions">
        {channel.type === 'voice' && (
          <button
            className="secondary small"
            onClick={() => (activeCallChannelId === channel.id ? void leaveVoice() : void joinVoice(channel.id))}
          >
            {activeCallChannelId === channel.id ? 'Leave call' : `Join call${participants.length ? ` (${participants.length})` : ''}`}
          </button>
        )}
        {channel.type === 'voice' && activeCallChannelId === channel.id && (
          <>
            <button className="secondary small" onClick={() => void useStore.getState().toggleVideo()}>
              Camera
            </button>
            <button className="secondary small" onClick={() => void useStore.getState().toggleScreen()}>
              Share screen
            </button>
          </>
        )}
        {!direct && (
          <>
            <button className="icon-button" title="Pinned messages" onClick={() => openModal('pins', { channelId: channel.id })}>
              📌
            </button>
            <button className="icon-button" title="Invite people" onClick={() => guild && openModal('invite', { guildId: guild.id })}>
              ✉
            </button>
            <button className="icon-button" title="Channel settings" onClick={() => openModal('editChannel', { channelId: channel.id })}>
              ⚙
            </button>
          </>
        )}
        {direct && others[0] && (
          <button className="icon-button" title="Profile" onClick={() => openModal('profile', { userId: others[0].id })}>
            ☰
          </button>
        )}
        <button className="icon-button" title="Search messages" onClick={() => openModal('search')}>
          🔍
        </button>
        <button
          className="icon-button"
          title={settings.showMembers ? 'Hide member list' : 'Show member list'}
          onClick={() => updateSettings({ showMembers: !settings.showMembers })}
        >
          👥
        </button>
      </div>
    </header>
  );
}

export function AppShell() {
  const { view, channel, settings, connection, user, guilds } = useStore(useShallow((state) => ({
    view: state.view,
    channel: state.selectedChannelId ? state.channels[state.selectedChannelId] : null,
    settings: state.settings,
    connection: state.connection,
    user: state.user,
    guilds: state.guilds,
  })));
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const openModal = useStore((state) => state.openModal);

  useEffect(() => {
    if (lightbox) openModal('lightbox', { attachment: lightbox });
  }, [lightbox, openModal]);

  const showMembers = settings.showMembers && view === 'channels' && !!channel && !channel.type.match(/dm/);

  return (
    <div className="app-shell">
      <GuildRail />
      <ChannelSidebar />
      <main className="content">
        {view === 'channels' && channel ? (
          <>
            <ChannelHeader />
            <VoiceView />
            <MessageList onOpenAttachment={setLightbox} />
          </>
        ) : view === 'friends' ? (
          <FriendsView />
        ) : (
          <div className="placeholder-view">
            <h2>Nothing selected</h2>
            <p>Pick a channel or open your friends list.</p>
            {Object.keys(guilds).length === 0 && (
              <p className="hint">You are not in any servers yet — create one or join with an invite code.</p>
            )}
          </div>
        )}
      </main>
      {showMembers && <MemberList channel={channel} />}
      <Toasts />
      {connection !== 'connected' && (
        <div className="connection-banner" data-status={connection}>
          {connection === 'reconnecting' ? 'Reconnecting to the gateway…' : `Gateway: ${connection}`}
        </div>
      )}
      {user && (
        <span className="user-accent" style={{ background: colorForId(user.id) }} />
      )}
    </div>
  );
}
