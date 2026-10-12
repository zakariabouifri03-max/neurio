/** Message history with day separators, replies, reactions, editing and a composer. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';

/** Stable identity so selectors never return a fresh array (that re-renders forever). */
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_MEMBERS: GuildMember[] = [];
const EMPTY_TYPING: Record<string, { displayName: string; expiresAt: number }> = {};
import { Avatar } from './Avatar';
import { Markdown } from './Markdown';
import { EMOJI_CATEGORIES, QUICK_EMOJI, formatBytes, formatDay, formatTime } from '../lib/format';
import type { Attachment, GuildMember, Message, PublicUser } from '../lib/types';

function AttachmentView({ attachment, onOpen }: { attachment: Attachment; onOpen: (attachment: Attachment) => void }) {
  const api = useStore((state) => state.api);
  const url = api?.fileUrl(attachment.url) ?? attachment.url;
  const type = attachment.content_type;
  if (type.startsWith('image/')) {
    return (
      <button className="attachment image" onClick={() => onOpen(attachment)}>
        <img src={url} alt={attachment.filename} loading="lazy" />
        <span className="attachment-meta">
          {attachment.filename} · {formatBytes(attachment.size)}
        </span>
      </button>
    );
  }
  if (type.startsWith('video/')) {
    return (
      <div className="attachment media">
        <video src={url} controls preload="metadata" />
        <span className="attachment-meta">{attachment.filename} · {formatBytes(attachment.size)}</span>
      </div>
    );
  }
  if (type.startsWith('audio/')) {
    return (
      <div className="attachment media">
        <audio src={url} controls preload="metadata" />
        <span className="attachment-meta">{attachment.filename} · {formatBytes(attachment.size)}</span>
      </div>
    );
  }
  return (
    <a className="attachment file" href={url} download={attachment.filename} target="_blank" rel="noreferrer">
      <span className="file-glyph">📄</span>
      <span>
        <strong>{attachment.filename}</strong>
        <small>{formatBytes(attachment.size)}</small>
      </span>
      <span className="file-download">Download</span>
    </a>
  );
}

function MessageRow({
  message,
  previous,
  onReply,
  onOpenAttachment,
  hovering,
  setHovering,
}: {
  message: Message;
  previous: Message | null;
  onReply: (message: Message) => void;
  onOpenAttachment: (attachment: Attachment) => void;
  hovering: boolean;
  setHovering: (id: string | null) => void;
}) {
  const { user, editMessage, deleteMessage, toggleReaction, togglePin, openModal, guilds, channels } = useStore(
    useShallow((state) => ({
      user: state.user,
      editMessage: state.editMessage,
      deleteMessage: state.deleteMessage,
      toggleReaction: state.toggleReaction,
      togglePin: state.togglePin,
      openModal: state.openModal,
      guilds: state.guilds,
      channels: state.channels,
    })),
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isOwn = message.author.id === user?.id;
  const channel = channels[message.channel_id];
  const guild = channel?.guild_id ? guilds[channel.guild_id] : null;
  const memberMap = useMemo(() => {
    const map: Record<string, PublicUser> = {};
    for (const member of guild?.members ?? []) map[member.user.id] = member.user;
    if (user) map[user.id] = user;
    return map;
  }, [guild, user]);

  const sameAuthorAsPrevious =
    previous &&
    previous.author.id === message.author.id &&
    message.created_at - previous.created_at < 5 * 60 * 1000 &&
    !message.referenced_message;

  return (
    <div
      className={`message ${sameAuthorAsPrevious ? 'compact' : ''}`}
      onMouseEnter={() => setHovering(message.id)}
      onMouseLeave={() => setHovering(null)}
    >
      {message.referenced_message && (
        <div className="reply-preview">
          <span className="reply-arrow">↰</span>
          <strong>{message.referenced_message.author.display_name}</strong>
          <span className="reply-text">
            {message.referenced_message.deleted ? 'Original message was deleted' : message.referenced_message.content.slice(0, 120)}
          </span>
        </div>
      )}
      <div className="message-gutter">
        {!sameAuthorAsPrevious ? (
          <Avatar user={message.author} size={38} onClick={() => openModal('profile', { userId: message.author.id })} />
        ) : (
          <span className="message-timestamp-hover">{formatTime(message.created_at)}</span>
        )}
      </div>
      <div className="message-body">
        {!sameAuthorAsPrevious && (
          <div className="message-header">
            <button className="message-author" onClick={() => openModal('profile', { userId: message.author.id })}>
              {message.author.display_name}
            </button>
            <time className="message-time" dateTime={new Date(message.created_at).toISOString()}>
              {formatTime(message.created_at)}
            </time>
            {message.pinned && <span className="pin-tag" title="Pinned">📌</span>}
          </div>
        )}
        {editing ? (
          <form
            className="edit-form"
            onSubmit={async (event) => {
              event.preventDefault();
              await editMessage(message.id, draft);
              setEditing(false);
            }}
          >
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus rows={2} />
            <div className="edit-actions">
              <button type="button" className="link" onClick={() => { setEditing(false); setDraft(message.content); }}>
                Cancel
              </button>
              <button type="submit" className="primary small">
                Save
              </button>
            </div>
          </form>
        ) : (
          message.content.length > 0 && (
            <div className="message-content">
              <Markdown
                content={message.content}
                users={memberMap}
                roles={guild?.roles}
                channels={Object.fromEntries(Object.entries(channels).map(([id, value]) => [id, { name: value.name }]))}
              />
              {message.edited_at && <span className="edited-tag">(edited)</span>}
            </div>
          )
        )}
        {message.attachments.length > 0 && (
          <div className="attachments">
            {message.attachments.map((attachment) => (
              <AttachmentView key={attachment.id} attachment={attachment} onOpen={onOpenAttachment} />
            ))}
          </div>
        )}
        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className="reaction"
                data-mine={reaction.me}
                title={reaction.users.map((entry) => entry.display_name).join(', ')}
                onClick={() => void toggleReaction(message.id, reaction.emoji, reaction.me)}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {hovering && !editing && (
        <div className="message-actions">
          <button className="icon-button small" title="Add reaction" onClick={() => setPickerOpen((open) => !open)}>
            ☺+
          </button>
          <button className="icon-button small" title="Reply" onClick={() => onReply(message)}>
            ↩
          </button>
          <button className="icon-button small" title={message.pinned ? 'Unpin' : 'Pin'} onClick={() => void togglePin(message.id, message.pinned)}>
            📌
          </button>
          {isOwn && (
            <button className="icon-button small" title="Edit" onClick={() => setEditing(true)}>
              ✎
            </button>
          )}
          {isOwn && (
            <button className="icon-button small danger" title="Delete" onClick={() => void deleteMessage(message.id)}>
              🗑
            </button>
          )}
          {pickerOpen && (
            <div className="emoji-popover small" onMouseLeave={() => setPickerOpen(false)}>
              {QUICK_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  onClick={async () => {
                    await toggleReaction(message.id, emoji, message.reactions.some((reaction) => reaction.emoji === emoji && reaction.me));
                    setPickerOpen(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({ onOpenAttachment }: { onOpenAttachment: (attachment: Attachment) => void }) {
  const { channelId, messages, loadMessages, messageHasMore, typing, user } = useStore(useShallow((state) => ({
    channelId: state.selectedChannelId,
    messages: (state.selectedChannelId && state.messages[state.selectedChannelId]) || EMPTY_MESSAGES,
    loadMessages: state.loadMessages,
    messageHasMore: state.selectedChannelId ? state.messageHasMore[state.selectedChannelId] : false,
    typing: (state.selectedChannelId && state.typing[state.selectedChannelId]) || EMPTY_TYPING,
    user: state.user,
  })));
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [hovering, setHovering] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReplyTo(null);
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [channelId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length]);

  const typingNames = Object.entries(typing)
    .filter(([userId, entry]) => userId !== user?.id && entry.expiresAt > Date.now())
    .map(([, entry]) => entry.displayName);

  return (
    <div className="message-list" ref={scroller}>
      {messageHasMore && (
        <button
          className="load-more"
          onClick={() => channelId && void loadMessages(channelId, { before: messages[0]?.id })}
        >
          Load earlier messages
        </button>
      )}
      {messages.map((message, index) => {
        const previous = messages[index - 1] ?? null;
        const previousDay = previous ? new Date(previous.created_at).toDateString() : null;
        const currentDay = new Date(message.created_at).toDateString();
        return (
          <div key={message.id}>
            {previousDay !== currentDay && (
              <div className="day-separator">
                <span>{formatDay(message.created_at)}</span>
              </div>
            )}
            <MessageRow
              message={message}
              previous={previous}
              hovering={hovering === message.id}
              setHovering={setHovering}
              onReply={setReplyTo}
              onOpenAttachment={onOpenAttachment}
            />
          </div>
        );
      })}
      {messages.length === 0 && (
        <div className="empty-channel">
          <h2>This is the beginning</h2>
          <p>Send the first message — everything is stored locally in SQLite on your server.</p>
        </div>
      )}
      <div className="typing-indicator">
        {typingNames.length > 0 && (
          <span>
            <strong>{typingNames.slice(0, 3).join(', ')}</strong> {typingNames.length === 1 ? 'is' : 'are'} typing…
          </span>
        )}
      </div>
      <div ref={bottom} />
      {replyTo && (
        <div className="reply-bar">
          <span>Replying to <strong>{replyTo.author.display_name}</strong></span>
          <button className="link" onClick={() => setReplyTo(null)}>
            cancel
          </button>
        </div>
      )}
      {channelId && <Composer channelId={channelId} replyTo={replyTo} clearReply={() => setReplyTo(null)} />}
    </div>
  );
}

export function Composer({
  channelId,
  replyTo,
  clearReply,
}: {
  channelId: string;
  replyTo: Message | null;
  clearReply: () => void;
}) {
  const { sendMessage, sendTyping, uploadAvatar, user, channels, members, toast } = useStore(useShallow((state) => ({
    sendMessage: state.sendMessage,
    sendTyping: state.sendTyping,
    uploadAvatar: state.uploadAvatar,
    user: state.user,
    channels: state.channels,
    members: (state.channels[channelId]?.guild_id && state.guilds[state.channels[channelId]!.guild_id!]?.members) || EMPTY_MEMBERS,
    toast: state.toast,
  })));
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  const channel = channels[channelId];

  useEffect(() => {
    input.current?.focus();
    setDraft('');
    setFiles([]);
  }, [channelId]);

  const suggestions = mentionQuery === null
    ? []
    : members
        .filter((member) => member.user.display_name.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6);

  async function submit() {
    if (!draft.trim() && files.length === 0) return;
    const content = draft;
    const attachments = files;
    setDraft('');
    setFiles([]);
    clearReply();
    await sendMessage(channelId, content, { referenceId: replyTo?.id ?? null, files: attachments });
  }

  return (
    <div className="composer">
      {files.length > 0 && (
        <div className="composer-files">
          {files.map((file, index) => (
            <span className="composer-file" key={`${file.name}-${index}`}>
              📎 {file.name} <small>{formatBytes(file.size)}</small>
              <button className="link" onClick={() => setFiles(files.filter((_, i) => i !== index))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {mentionQuery !== null && suggestions.length > 0 && (
        <ul className="mention-suggestions">
          {suggestions.map((member) => (
            <li key={member.user.id}>
              <button
                onClick={() => {
                  setDraft((current) => `${current.replace(/@[^@\s]*$/, '')}<@${member.user.id}> `);
                  setMentionQuery(null);
                  input.current?.focus();
                }}
              >
                <Avatar user={member.user} size={22} showStatus={false} /> {member.nickname ?? member.user.display_name}
                <small>@{member.user.username}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pickerOpen && (
        <div className="emoji-popover" onMouseLeave={() => setPickerOpen(false)}>
          <div className="emoji-quick">
            {QUICK_EMOJI.map((emoji) => (
              <button key={emoji} onClick={() => setDraft((current) => `${current}${emoji}`)}>
                {emoji}
              </button>
            ))}
          </div>
          <div className="emoji-scroll">
            {EMOJI_CATEGORIES.map((category) => (
              <div key={category.name}>
                <h4>{category.name}</h4>
                <div className="emoji-grid">
                  {category.emoji.map((emoji) => (
                    <button key={emoji} onClick={() => setDraft((current) => `${current}${emoji}`)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="composer-box">
        <button
          className="icon-button"
          title="Attach a file"
          onClick={() => {
            const element = document.createElement('input');
            element.type = 'file';
            element.multiple = true;
            element.onchange = () => setFiles([...files, ...Array.from(element.files ?? [])]);
            element.click();
          }}
        >
          📎
        </button>
        <textarea
          ref={input}
          value={draft}
          rows={1}
          placeholder={`Message ${channel?.type === 'dm' || channel?.type === 'group_dm' ? '' : '#'}${channel?.name ?? ''}`.trim()}
          onChange={(event) => {
            setDraft(event.target.value);
            const mentionMatch = /@([^\s@]*)$/.exec(event.target.value);
            setMentionQuery(mentionMatch && (channel?.guild_id ?? null) ? mentionMatch[1] : null);
            if (Date.now() - lastTyping.current > 3000) {
              lastTyping.current = Date.now();
              sendTyping(channelId);
            }
          }}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length > 0) {
              event.preventDefault();
              setFiles([...files, ...pasted]);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
            if (event.key === 'Escape') clearReply();
          }}
        />
        <button className="icon-button" title="Emoji" onClick={() => setPickerOpen((open) => !open)}>
          ☺
        </button>
        <button
          className="icon-button"
          title="Set a custom status"
          onClick={async () => {
            const status = window.prompt('What are you up to? (leave empty to clear)');
            if (status !== null) useStore.getState().setStatus(user?.status ?? 'online', status || null);
          }}
        >
          💬
        </button>
        <button
          className="icon-button"
          title="Upload an avatar"
          onClick={() => {
            const element = document.createElement('input');
            element.type = 'file';
            element.accept = 'image/*';
            element.onchange = async () => {
              const file = element.files?.[0];
              if (file) await uploadAvatar(file);
            };
            element.click();
          }}
        >
          🖼️
        </button>
        <button className="primary small" onClick={() => void submit()} disabled={!draft.trim() && files.length === 0}>
          Send
        </button>
      </div>
      <div className="composer-hint">
        <span>
          <strong>Enter</strong> to send · <strong>Shift+Enter</strong> for a new line · drag files or paste images
        </span>
        <button className="link" onClick={() => toast('Markdown: **bold**, *italic*, `code`, ~~strike~~', 'info')}>
          formatting help
        </button>
      </div>
    </div>
  );
}
