// Run with: npm test (from chat/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, newConversation, deriveTitle, StoreError, INDEX_KEY, convKey } from '../js/store.js';

// In-memory stand-in for puter.kv (get/set/del, null for missing keys).
function memoryKV(extra = {}) {
  const data = new Map();
  return {
    data,
    MAX_VALUE_SIZE: 399 * 1024,
    async get(k) { return data.has(k) ? structuredClone(data.get(k)) : null; },
    async set(k, v) { data.set(k, structuredClone(v)); return true; },
    async del(k) { data.delete(k); return true; },
    ...extra,
  };
}

test('new conversations get an id, empty messages and timestamps', () => {
  const c = newConversation({ model: 'm1' });
  assert.ok(c.id && typeof c.id === 'string');
  assert.equal(c.model, 'm1');
  assert.deepEqual(c.messages, []);
  assert.equal(c.title, 'New chat');
});

test('deriveTitle uses the first non-empty line and truncates', () => {
  assert.equal(deriveTitle('\n  Hello there\nmore'), 'Hello there');
  const long = 'a'.repeat(200);
  const t = deriveTitle(long);
  assert.equal(t.length, 60);
  assert.ok(t.endsWith('…'));
});

test('listConversations is empty when nothing is stored', async () => {
  const store = createStore(memoryKV());
  assert.deepEqual(await store.listConversations(), []);
});

test('save writes the conversation and keeps the index newest-first', async () => {
  const kv = memoryKV();
  const store = createStore(kv);

  const a = newConversation({ model: 'm' });
  a.title = 'A'; a.updatedAt = 1000;
  const b = newConversation({ model: 'm' });
  b.title = 'B'; b.updatedAt = 2000;

  await store.saveConversation(a);
  const index = await store.saveConversation(b);

  assert.deepEqual(index.map((m) => m.title), ['B', 'A']);
  assert.deepEqual(await store.listConversations(), index);
  assert.equal((await store.getConversation(a.id)).title, 'A');
  assert.ok(kv.data.has(convKey(a.id)));
  assert.ok(kv.data.has(INDEX_KEY));
});

test('saving an existing conversation updates its index entry instead of duplicating it', async () => {
  const store = createStore(memoryKV());
  const c = newConversation({ model: 'm' });
  c.title = 'First'; c.updatedAt = 1;
  await store.saveConversation(c);
  c.title = 'Renamed'; c.updatedAt = 5;
  const index = await store.saveConversation(c);
  assert.equal(index.length, 1);
  assert.equal(index[0].title, 'Renamed');
});

test('getConversation returns null for unknown ids', async () => {
  const store = createStore(memoryKV());
  assert.equal(await store.getConversation('nope'), null);
});

test('deleteConversation removes the value and its index entry', async () => {
  const kv = memoryKV();
  const store = createStore(kv);
  const c = newConversation({ model: 'm' });
  await store.saveConversation(c);
  const index = await store.deleteConversation(c.id);
  assert.deepEqual(index, []);
  assert.equal(await store.getConversation(c.id), null);
  assert.ok(!kv.data.has(convKey(c.id)));
});

test('a chat larger than the KV value limit is rejected with a clear code', async () => {
  const store = createStore(memoryKV({ MAX_VALUE_SIZE: 1000 }));
  const c = newConversation({ model: 'm' });
  c.messages.push({ role: 'user', content: 'x'.repeat(2000), at: 1 });
  await assert.rejects(store.saveConversation(c), (err) => {
    assert.ok(err instanceof StoreError);
    assert.equal(err.code, 'too_long');
    return true;
  });
});

test('byte size counts multi-byte characters, not just string length', async () => {
  // 300 chars of 3-byte UTF-8 each → ~900+ bytes, over a 800-byte limit
  const store = createStore(memoryKV({ MAX_VALUE_SIZE: 800 }));
  const c = newConversation({ model: 'm' });
  c.messages.push({ role: 'user', content: '€'.repeat(300), at: 1 });
  await assert.rejects(store.saveConversation(c), { code: 'too_long' });
});
