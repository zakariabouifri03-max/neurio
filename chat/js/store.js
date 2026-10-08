// Conversation storage on top of Puter's key-value store (puter.kv).
//
// Layout (all keys live in the signed-in user's own Puter account):
//   chat:index          → [{ id, title, model, updatedAt }]   newest first
//   chat:conv:<id>      → { id, title, model, createdAt, updatedAt, messages }
//
// Every KV value is capped (puter.kv.MAX_VALUE_SIZE, ~400 KB). A chat that
// would exceed the cap is rejected with a StoreError('too_long') so the UI can
// explain it, instead of failing with a generic error. See README.md.

export const INDEX_KEY = 'chat:index';
export const convKey = (id) => `chat:conv:${id}`;

const DEFAULT_MAX_BYTES = 399 * 1024;
const TITLE_MAX = 60;

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const byteLength = (text) => new TextEncoder().encode(text).length;

export function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newConversation({ model }) {
  const now = Date.now();
  return {
    id: makeId(),
    title: 'New chat',
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

// Use the first line of the first user message as the chat title.
export function deriveTitle(text) {
  const firstLine = String(text).split('\n').map((l) => l.trim()).find(Boolean) || 'New chat';
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
}

const metaOf = (conv) => ({
  id: conv.id,
  title: conv.title,
  model: conv.model,
  updatedAt: conv.updatedAt,
});

const sortNewestFirst = (list) => list.sort((a, b) => b.updatedAt - a.updatedAt);

// `kv` is any object with get/set/del, such as puter.kv.
export function createStore(kv, { maxBytes = kv?.MAX_VALUE_SIZE ?? DEFAULT_MAX_BYTES } = {}) {
  async function listConversations() {
    const index = await kv.get(INDEX_KEY);
    return Array.isArray(index) ? sortNewestFirst([...index]) : [];
  }

  async function getConversation(id) {
    return (await kv.get(convKey(id))) ?? null;
  }

  // Saves the conversation and its index entry. Returns the updated index.
  async function saveConversation(conv) {
    const json = JSON.stringify(conv);
    if (byteLength(json) > maxBytes) {
      throw new StoreError(
        'too_long',
        'This chat is too long to save. Start a new chat to keep going.',
      );
    }

    await kv.set(convKey(conv.id), conv);

    const index = (await listConversations()).filter((m) => m.id !== conv.id);
    index.push(metaOf(conv));
    sortNewestFirst(index);
    await kv.set(INDEX_KEY, index);
    return index;
  }

  async function deleteConversation(id) {
    await kv.del(convKey(id));
    const index = (await listConversations()).filter((m) => m.id !== id);
    await kv.set(INDEX_KEY, index);
    return index;
  }

  return { listConversations, getConversation, saveConversation, deleteConversation };
}
