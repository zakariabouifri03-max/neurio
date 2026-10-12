/** Formatting helpers, emoji picker data and a tiny safe markdown renderer. */

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDay(timestamp);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

const AVATAR_COLORS = [
  '#5865f2',
  '#1abc9c',
  '#e67e22',
  '#eb459e',
  '#3ba55d',
  '#9b59b6',
  '#f04747',
  '#00a8fc',
];

export function colorForId(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100000;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function statusColor(status: string): string {
  switch (status) {
    case 'online':
      return '#3ba55d';
    case 'idle':
      return '#faa61a';
    case 'dnd':
      return '#ed4245';
    default:
      return '#747f8d';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'idle':
      return 'Idle';
    case 'dnd':
      return 'Do Not Disturb';
    case 'invisible':
      return 'Invisible';
    default:
      return 'Offline';
  }
}

export const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '✅', '👀', '🤔', '🚀', '🙏'];

export const EMOJI_CATEGORIES: { name: string; emoji: string[] }[] = [
  {
    name: 'Smileys',
    emoji: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'],
  },
  {
    name: 'People',
    emoji: ['👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦾', '🖕', '✍️', '💅', '🤳', '💃', '🕺', '👯', '🧑‍💻', '🧑‍🎓', '🧑‍🏫', '🧑‍🔧', '🧑‍🍳', '🧑‍🌾', '🧑‍🎤', '🧑‍🚀'],
  },
  {
    name: 'Animals',
    emoji: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🕷️', '🦂', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊'],
  },
  {
    name: 'Food',
    emoji: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🥕', '🌽', '🌶️', '🥒', '🥬', '🧄', '🧅', '🍄', '🥜', '🍞', '🥐', '🥖', '🥨', '🧀', '🥚', '🍳', '🧇', '🥞', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🥙', '🍜', '🍝', '🍣', '🍱', '🍤', '🍦', '🍩', '🍪', '🎂', '🍰', '🍫', '🍬', '🍭', '☕', '🍵', '🍺', '🍻', '🥂', '🍷'],
  },
  {
    name: 'Activities',
    emoji: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🎮', '🕹️', '🎲', '♟️', '🎯', '🎳', '🎰', '🧩', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻'],
  },
  {
    name: 'Travel',
    emoji: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🛵', '🏍️', '🚲', '🛴', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '🏔️', '⛰️', '🌋', '🗻', '🏕️', '🏖️', '🏜️', '🏝️', '🏞️', '🗽', '🗼', '🏰', '🏯'],
  },
  {
    name: 'Objects',
    emoji: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '💰', '💳', '💎', '⚖️', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🖼️', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🎊', '🎉'],
  },
  {
    name: 'Symbols',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅'],
  },
];

export interface Token {
  type: 'text' | 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'codeblock' | 'link' | 'user' | 'channel' | 'role' | 'emoji' | 'everyone';
  value: string;
  extra?: string;
}

const MENTION_RE = /^<@!?(\d+)>$/;
const ROLE_RE = /^<@&(\d+)>$/;
const CHANNEL_RE = /^<#(\d+)>$/;

/**
 * Very small markdown subset: **bold**, *italic*, __underline__, ~~strike~~,
 * `code`, ```blocks```, links, <@mentions>, <#channels>. Everything else is
 * rendered as plain text, so no HTML is ever injected.
 */
export function tokenizeMarkdown(input: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(```[\s\S]*?```|`[^`\n]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|__[^_]+__|~~[^~]+~~|https?:\/\/[^\s<>()]+|<[@#][^>]+>|@everyone|@here|:[a-z0-9_+-]+:)/gi;
  let lastIndex = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) tokens.push({ type: 'text', value: input.slice(lastIndex, index) });
    const raw = match[0];
    if (raw.startsWith('```')) tokens.push({ type: 'codeblock', value: raw.replace(/```/g, '').trim() });
    else if (raw.startsWith('`')) tokens.push({ type: 'code', value: raw.slice(1, -1) });
    else if (raw.startsWith('**')) tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    else if (raw.startsWith('__')) tokens.push({ type: 'underline', value: raw.slice(2, -2) });
    else if (raw.startsWith('~~')) tokens.push({ type: 'strike', value: raw.slice(2, -2) });
    else if (raw.startsWith('*')) tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    else if (/^https?:\/\//i.test(raw)) tokens.push({ type: 'link', value: raw });
    else if (raw === '@everyone' || raw === '@here') tokens.push({ type: 'everyone', value: raw });
    else if (MENTION_RE.test(raw)) tokens.push({ type: 'user', value: raw.replace(/[<@!>]/g, '') });
    else if (ROLE_RE.test(raw)) tokens.push({ type: 'role', value: raw.replace(/[<@&>]/g, '') });
    else if (CHANNEL_RE.test(raw)) tokens.push({ type: 'channel', value: raw.replace(/[<#>]/g, '') });
    else if (/^:[a-z0-9_+-]+:$/i.test(raw)) tokens.push({ type: 'emoji', value: raw });
    else tokens.push({ type: 'text', value: raw });
    lastIndex = index + raw.length;
  }
  if (lastIndex < input.length) tokens.push({ type: 'text', value: input.slice(lastIndex) });
  return tokens;
}

export function extractEmojiShortcodes(input: string): string[] {
  return [...input.matchAll(/:([a-z0-9_+-]+):/gi)].map((match) => match[0]);
}
