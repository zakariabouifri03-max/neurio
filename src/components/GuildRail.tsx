/** Left-most rail: server icons, home button, add server. */
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { colorForId, initials } from '../lib/format';
import type { Guild } from '../lib/types';

function GuildIcon({ guild, active, unread, onClick }: { guild: Guild; active: boolean; unread: number; onClick: () => void }) {
  return (
    <button
      className="guild-icon"
      data-active={active}
      onClick={onClick}
      title={guild.name}
      style={guild.icon_url ? undefined : { background: colorForId(guild.id) }}
    >
      {guild.icon_url ? <img src={guild.icon_url} alt={guild.name} /> : initials(guild.name)}
      {unread > 0 && <span className="guild-badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

export function GuildRail() {
  const { guilds, guildOrder, selectedGuildId, selectGuild, readStates, openModal, view, setView, channels } = useStore(
    useShallow((state) => ({
      guilds: state.guilds,
      guildOrder: state.guildOrder,
      selectedGuildId: state.selectedGuildId,
      selectGuild: state.selectGuild,
      readStates: state.readStates,
      openModal: state.openModal,
      view: state.view,
      setView: state.setView,
      channels: state.channels,
    })),
  );

  function unreadFor(guildId: string): number {
    const guild = guilds[guildId];
    if (!guild) return 0;
    let total = 0;
    for (const channel of guild.channels ?? []) {
      total += readStates[channel.id]?.mentions ?? 0;
    }
    return total;
  }

  const dmMentions = Object.entries(readStates).reduce((sum, [channelId, entry]) => {
    const channel = channels[channelId];
    if (channel && (channel.type === 'dm' || channel.type === 'group_dm')) return sum + entry.mentions;
    return sum;
  }, 0);

  return (
    <nav className="guild-rail" aria-label="Servers">
      <button
        className="guild-icon home"
        aria-label="Direct messages and friends"
        data-active={view === 'friends' || view === 'settings'}
        onClick={() => {
          // selectGuild(null) switches to the channel view, so set the view after it.
          selectGuild(null);
          setView('friends');
        }}
        title="Direct messages & friends"
      >
        <span className="home-glyph">◈</span>
        {dmMentions > 0 && <span className="guild-badge">{dmMentions}</span>}
      </button>
      <div className="rail-divider" />
      {guildOrder.map((guildId) => {
        const guild = guilds[guildId];
        if (!guild) return null;
        return (
          <GuildIcon
            key={guildId}
            guild={guild}
            active={selectedGuildId === guildId && view === 'channels'}
            unread={unreadFor(guildId)}
            onClick={() => selectGuild(guildId)}
          />
        );
      })}
      <button className="guild-icon add" aria-label="Create a server" onClick={() => openModal('createGuild')} title="Create a server">
        +
      </button>
      <button className="guild-icon add" aria-label="Join with an invite" onClick={() => openModal('joinGuild')} title="Join with an invite">
        ⇥
      </button>
    </nav>
  );
}
