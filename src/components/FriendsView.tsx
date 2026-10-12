/** Friends, requests, blocks and user search. */
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { Avatar } from './Avatar';
import { formatRelative } from '../lib/format';
import type { PublicUser } from '../lib/types';

export function FriendsView() {
  const {
    relationships,
    addFriend,
    acceptFriend,
    removeFriend,
    blockUser,
    unblockUser,
    openDm,
    api,
    presence,
    openModal,
  } = useStore(useShallow((state) => ({
    relationships: state.relationships,
    addFriend: state.addFriend,
    acceptFriend: state.acceptFriend,
    removeFriend: state.removeFriend,
    blockUser: state.blockUser,
    unblockUser: state.unblockUser,
    openDm: state.openDm,
    api: state.api,
    presence: state.presence,
    openModal: state.openModal,
  })));

  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'blocked' | 'add'>('online');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [newFriend, setNewFriend] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const friends = relationships.filter((entry) => entry.type === 'friend');
  const incoming = relationships.filter((entry) => entry.type === 'incoming');
  const outgoing = relationships.filter((entry) => entry.type === 'outgoing');
  const blocked = relationships.filter((entry) => entry.type === 'blocked');

  useEffect(() => {
    if (tab !== 'add' || !api || query.trim().length === 0) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.searchUsers(query.trim());
        setResults(
          response.users.map(
            (user) =>
              ({
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                avatar_url: null,
                bio: '',
                custom_status: null,
                status: user.status as PublicUser['status'],
                is_bot: false,
                created_at: 0,
              }) satisfies PublicUser,
          ),
        );
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, tab, api]);

  const visible = tab === 'online' ? friends.filter((entry) => (presence[entry.user.id]?.status ?? entry.user.status) !== 'offline') : friends;

  return (
    <div className="friends-view">
      <header className="friends-header">
        <h2>Friends</h2>
        <nav className="friends-tabs">
          {(['online', 'all', 'pending', 'blocked'] as const).map((candidate) => (
            <button key={candidate} data-active={tab === candidate} onClick={() => setTab(candidate)}>
              {candidate === 'pending' ? `Pending${incoming.length ? ` (${incoming.length})` : ''}` : candidate}
            </button>
          ))}
          <button className="primary small" data-active={tab === 'add'} onClick={() => setTab('add')}>
            Add friend
          </button>
        </nav>
      </header>

      {statusMessage && <div className="info-banner">{statusMessage}</div>}

      {tab === 'add' && (
        <section className="friends-add">
          <h3>Add a friend by username</h3>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!newFriend.trim()) return;
              const username = newFriend.trim().replace(/^@/, '');
              try {
                await addFriend(username);
                setStatusMessage(`Friend request sent to ${username}.`);
              } catch (error) {
                setStatusMessage(`Could not send a request to ${username}: ${(error as Error).message}`);
              }
              setNewFriend('');
            }}
          >
            <input
              value={newFriend}
              onChange={(event) => setNewFriend(event.target.value)}
              placeholder="Enter a username, e.g. alex"
              spellCheck={false}
            />
            <button className="primary" type="submit">
              Send request
            </button>
          </form>
          <p className="hint">
            Requests are delivered instantly over the local gateway when the other person is online.
          </p>

          <h3>Search people on this server</h3>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by username or display name"
          />
          {searching && <p className="hint">Searching…</p>}
          <ul className="people-results">
            {results.map((person) => (
              <li key={person.id}>
                <Avatar user={person} size={32} />
                <span>
                  <strong>{person.display_name}</strong>
                  <small>@{person.username} · {person.status}</small>
                </span>
                <button className="primary small" onClick={() => void addFriend(person.username)}>
                  Add friend
                </button>
                <button className="link" onClick={() => void openDm(person.id)}>
                  Message
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'pending' && (
        <section>
          {incoming.length > 0 && <h3>Incoming — {incoming.length}</h3>}
          <ul className="friend-rows">
            {incoming.map((entry) => (
              <li key={entry.id}>
                <Avatar user={entry.user} size={34} />
                <span>
                  <strong>{entry.user.display_name}</strong>
                  <small>@{entry.user.username} invited you to be friends</small>
                </span>
                <button className="primary small" onClick={() => void acceptFriend(entry.user.id)}>
                  Accept
                </button>
                <button className="link" onClick={() => void removeFriend(entry.user.id)}>
                  Ignore
                </button>
              </li>
            ))}
          </ul>
          {outgoing.length > 0 && <h3>Outgoing — {outgoing.length}</h3>}
          <ul className="friend-rows">
            {outgoing.map((entry) => (
              <li key={entry.id}>
                <Avatar user={entry.user} size={34} />
                <span>
                  <strong>{entry.user.display_name}</strong>
                  <small>Waiting for a reply…</small>
                </span>
                <button className="link" onClick={() => void removeFriend(entry.user.id)}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'blocked' && (
        <section>
          <ul className="friend-rows">
            {blocked.map((entry) => (
              <li key={entry.id}>
                <Avatar user={entry.user} size={34} />
                <span>
                  <strong>{entry.user.display_name}</strong>
                  <small>@{entry.user.username}</small>
                </span>
                <button className="link" onClick={() => void unblockUser(entry.user.id)}>
                  Unblock
                </button>
              </li>
            ))}
            {blocked.length === 0 && <p className="empty-note">Nobody is blocked.</p>}
          </ul>
        </section>
      )}

      {(tab === 'online' || tab === 'all') && (
        <section>
          <ul className="friend-rows">
            {visible.map((entry) => (
              <li key={entry.id}>
                <Avatar user={{ ...entry.user, status: presence[entry.user.id]?.status ?? entry.user.status }} size={34} onClick={() => openModal('profile', { userId: entry.user.id })} />
                <span>
                  <strong>{entry.user.display_name}</strong>
                  <small>{presence[entry.user.id]?.custom_status || `@${entry.user.username}`} · friends since {formatRelative(entry.since)}</small>
                </span>
                <button className="primary small" onClick={() => void openDm(entry.user.id)}>
                  Message
                </button>
                <button className="link" onClick={() => void removeFriend(entry.user.id)}>
                  Remove
                </button>
                <button className="link danger" onClick={() => void blockUser(entry.user.id)}>
                  Block
                </button>
              </li>
            ))}
            {visible.length === 0 && <p className="empty-note">No friends to show here yet.</p>}
          </ul>
        </section>
      )}
    </div>
  );
}
