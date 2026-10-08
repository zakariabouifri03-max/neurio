// Neurio Chat — UI controller. Talks to Puter.js for auth, models, AI replies,
// and storage. Loaded as an ES module after the Puter.js script tag.

import { renderMarkdown } from './markdown.js';
import { createStore, newConversation, deriveTitle, StoreError } from './store.js';

const SETTINGS_KEY = 'neurio-chat:settings';
const DEFAULT_MODEL = 'gpt-5.4-nano';
// Used only if the model list cannot be loaded.
const FALLBACK_MODELS = ['gpt-5.4-nano', 'gpt-5.6-luna', 'claude-sonnet-5', 'claude-opus-4-8'];
// Number of recent messages sent with each request, to keep requests bounded.
const MAX_CONTEXT_MESSAGES = 50;
const SUGGESTIONS = [
  'Explain a tricky concept in simple terms',
  'Help me plan a weekend trip to Marrakech',
  'Write a short poem about the sea at night',
  'Review this JavaScript for bugs: const x = [1,2,3].map(n => n * "2")',
];

const $ = (sel) => document.querySelector(sel);
const el = {
  sidebar: $('#sidebar'),
  scrim: $('#scrim'),
  menuBtn: $('#menuBtn'),
  newChatBtn: $('#newChatBtn'),
  convList: $('#convList'),
  convEmpty: $('#convEmpty'),
  signOutBtn: $('#signOutBtn'),
  userBox: $('#userBox'),
  userName: $('#userName'),
  settingsBtn: $('#settingsBtn'),
  welcome: $('#welcome'),
  signInBtn: $('#signInBtn'),
  welcomeStatus: $('#welcomeStatus'),
  thread: $('#thread'),
  messages: $('#messages'),
  composerWrap: $('#composerWrap'),
  input: $('#input'),
  sendBtn: $('#sendBtn'),
  stopBtn: $('#stopBtn'),
  modelSelect: $('#modelSelect'),
  chatTitle: $('#chatTitle'),
  renameBtn: $('#renameBtn'),
  deleteBtn: $('#deleteBtn'),
  banner: $('#banner'),
  toast: $('#toast'),
  settingsDialog: $('#settingsDialog'),
  settingsForm: $('#settingsForm'),
  systemPrompt: $('#systemPrompt'),
  defaultModel: $('#defaultModel'),
  theme: $('#theme'),
};

const state = {
  puter: null,
  store: null,
  user: null,
  models: [],
  index: [],          // [{ id, title, model, updatedAt }] from storage
  conv: null,         // the open conversation (null = new, unsaved chat)
  streaming: false,
  stopDeferred: null, // resolves when the user presses Stop
  chatFull: false,    // set when the open chat hit the storage size limit
  settings: loadSettings(),
};

// ───────────────────────── settings (this browser only) ─────────────────────────

function loadSettings() {
  const defaults = { systemPrompt: '', model: DEFAULT_MODEL, theme: 'system' };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch {
    // Storage can be disabled (private mode); settings then last for this page only.
  }
}

function applyTheme() {
  const theme = state.settings.theme;
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

const currentModel = () => state.conv?.model || state.settings.model || DEFAULT_MODEL;

// ───────────────────────── small DOM helpers ─────────────────────────

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, ms = 3500) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.add('hidden'), ms);
}

function showBanner(message) {
  el.banner.replaceChildren(h('span', {}, message));
  if (!message) el.banner.classList.add('hidden');
  else el.banner.classList.remove('hidden');
}

function describeError(err) {
  if (!err) return 'Something went wrong.';
  if (typeof err === 'string') return err;
  return err.msg || err.message || JSON.stringify(err);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────── boot & auth ─────────────────────────

async function waitForPuter(timeoutMs = 10000) {
  const started = Date.now();
  while (!window.puter) {
    if (Date.now() - started > timeoutMs) return null;
    await delay(100);
  }
  return window.puter;
}

async function boot() {
  applyTheme();
  bindEvents();

  if (location.protocol === 'file:') {
    el.welcomeStatus.textContent =
      'Open this app through a web server (for example: python3 -m http.server), not by double-clicking the file. Puter.js needs an http:// origin.';
    el.signInBtn.disabled = true;
    return;
  }

  const puter = await waitForPuter();
  if (!puter) {
    el.welcomeStatus.textContent =
      'Could not load Puter.js from js.puter.com. Check your internet connection and reload.';
    el.signInBtn.disabled = true;
    return;
  }

  state.puter = puter;
  state.store = createStore(puter.kv);

  let signedIn = false;
  try {
    signedIn = await puter.auth.isSignedIn();
  } catch (err) {
    console.warn('isSignedIn failed', err);
  }

  if (signedIn) await enterApp();
  else showWelcome();
}

function showWelcome() {
  el.signInBtn.disabled = false;
  el.welcomeStatus.textContent = 'Your chats and AI usage run on your own Puter account, so there are no API keys to set up.';
  el.welcome.classList.remove('hidden');
  el.thread.classList.add('hidden');
  el.composerWrap.classList.add('hidden');
  el.userBox.classList.add('hidden');
}

async function signIn() {
  el.signInBtn.disabled = true;
  el.welcomeStatus.textContent = 'Waiting for sign-in…';
  try {
    await state.puter.auth.signIn();
    await enterApp();
  } catch (err) {
    // The popup was closed by the user or blocked; let them try again.
    el.welcomeStatus.textContent = describeError(err);
    el.signInBtn.disabled = false;
  }
}

async function signOut() {
  try {
    await state.puter.auth.signOut();
  } finally {
    location.reload();
  }
}

async function enterApp() {
  el.welcome.classList.add('hidden');
  el.thread.classList.remove('hidden');
  el.composerWrap.classList.remove('hidden');

  try {
    state.user = await state.puter.auth.getUser();
  } catch {
    state.user = null;
  }
  el.userName.textContent = state.user?.username ? `@${state.user.username}` : 'Signed in';
  el.userBox.classList.remove('hidden');

  loadModels(); // runs in the background; the picker fills in when ready

  try {
    state.index = await state.store.listConversations();
  } catch (err) {
    showBanner(`Could not load your chats: ${describeError(err)}`);
    state.index = [];
  }
  renderSidebar();
  renderConversation();
}

async function loadModels() {
  let list = [];
  try {
    list = await state.puter.ai.listModels();
  } catch (err) {
    console.warn('listModels failed; using fallback list', err);
  }
  const models = (Array.isArray(list) ? list : [])
    .filter((m) => m && m.id)
    .map((m) => ({ id: m.id, provider: m.provider || 'other', name: m.name || m.id }));
  state.models = models.length
    ? models
    : FALLBACK_MODELS.map((id) => ({ id, provider: 'puter', name: id }));
  fillModelSelect(el.modelSelect, currentModel());
  fillModelSelect(el.defaultModel, state.settings.model);
}

function fillModelSelect(select, selected) {
  const byProvider = new Map();
  for (const m of state.models) {
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
    byProvider.get(m.provider).push(m);
  }
  if (selected && !state.models.some((m) => m.id === selected)) {
    byProvider.set('other', [...(byProvider.get('other') || []), { id: selected, name: selected }]);
  }
  const groups = [...byProvider.keys()].sort().map((provider) =>
    h('optgroup', { label: provider },
      byProvider.get(provider)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => h('option', { value: m.id, selected: m.id === selected }, m.name === m.id ? m.id : `${m.name} (${m.id})`)),
    ),
  );
  select.replaceChildren(...groups);
  select.value = selected;
}

// ───────────────────────── sidebar & conversations ─────────────────────────

function renderSidebar() {
  el.convEmpty.classList.toggle('hidden', state.index.length > 0);
  el.convList.replaceChildren(...state.index.map((meta) => {
    const active = state.conv?.id === meta.id;
    return h('li', {},
      h('button', {
        type: 'button',
        class: `conv-item${active ? ' active' : ''}`,
        title: meta.title,
        'aria-current': active ? 'true' : false,
        onclick: () => openConversation(meta.id),
      }, meta.title || 'Untitled chat'),
    );
  }));
}

async function openConversation(id) {
  if (state.streaming) return toast('Wait for the reply to finish, or press Stop.');
  if (state.conv?.id === id) return closeSidebar();
  try {
    const conv = await state.store.getConversation(id);
    if (!conv) {
      toast('That chat no longer exists.');
      state.index = await state.store.listConversations();
      renderSidebar();
      return;
    }
    state.conv = conv;
    state.chatFull = false;
    renderConversation();
    renderSidebar();
    closeSidebar();
  } catch (err) {
    toast(`Could not open chat: ${describeError(err)}`);
  }
}

function newChat() {
  if (state.streaming) return toast('Wait for the reply to finish, or press Stop.');
  state.conv = null;
  state.chatFull = false;
  renderConversation();
  renderSidebar();
  closeSidebar();
  el.input.focus();
}

// Saves the open chat, refreshes the sidebar, and returns whether it saved.
async function persist() {
  state.conv.updatedAt = Date.now();
  state.index = await state.store.saveConversation(state.conv);
  renderSidebar();
  document.title = `${state.conv.title} · Neurio Chat`;
}

// ───────────────────────── rendering the thread ─────────────────────────

function renderConversation() {
  const conv = state.conv;
  el.messages.replaceChildren();
  el.chatTitle.textContent = conv ? conv.title : 'New chat';
  document.title = conv ? `${conv.title} · Neurio Chat` : 'Neurio Chat';
  el.renameBtn.disabled = !conv || conv.messages.length === 0;
  el.deleteBtn.disabled = !conv || conv.messages.length === 0;
  fillModelSelect(el.modelSelect, currentModel());
  el.input.disabled = state.chatFull;
  el.input.placeholder = state.chatFull
    ? 'This chat is full. Start a new chat to continue.'
    : 'Message Neurio…';
  el.sendBtn.disabled = state.chatFull;

  if (!conv || conv.messages.length === 0) {
    el.messages.append(emptyState());
    return;
  }
  conv.messages.forEach((msg, idx) => {
    el.messages.append(messageNode(msg, idx, { canRegenerate: isLastAssistant(idx) }));
  });
  scrollToBottom(true);
}

function isLastAssistant(idx) {
  const msgs = state.conv.messages;
  return msgs[idx].role === 'assistant' && idx === msgs.length - 1;
}

function emptyState() {
  return h('div', { class: 'hero' },
    h('div', { class: 'hero-mark' }, '✦'),
    h('h2', {}, 'How can I help today?'),
    h('p', { class: 'muted' }, 'Pick a model above, then ask anything. Your chats are saved to your Puter account.'),
    h('div', { class: 'chips' },
      SUGGESTIONS.map((text) => h('button', {
        type: 'button',
        class: 'chip',
        onclick: () => {
          el.input.value = text;
          autosize();
          el.input.focus();
        },
      }, text)),
    ),
  );
}

function messageNode(msg, idx, { canRegenerate = false, streaming = false } = {}) {
  const isUser = msg.role === 'user';
  const bubble = h('div', { class: 'bubble' });
  const node = h('article', {
    class: `msg ${isUser ? 'user' : 'assistant'}`,
    'data-idx': idx,
  },
    h('div', { class: 'msg-role' }, isUser ? 'You' : 'Neurio'),
    bubble,
  );
  fillBubble(bubble, msg, { streaming });

  const actions = h('div', { class: 'msg-actions' });
  if (!streaming && msg.content) {
    actions.append(h('button', { type: 'button', class: 'mini-btn', 'data-action': 'copy-msg' }, 'Copy'));
  }
  if (!isUser && canRegenerate && !streaming && !state.chatFull) {
    actions.append(h('button', { type: 'button', class: 'mini-btn', 'data-action': 'regenerate' }, '↻ Regenerate'));
  }
  if (actions.childNodes.length) node.append(actions);
  return node;
}

// Rebuilds the inside of a message bubble. Safe to call repeatedly while streaming.
function fillBubble(bubble, msg, { streaming = false } = {}) {
  const parts = [];
  const reasoningWasOpen = bubble.querySelector('details.reasoning')?.open ?? false;

  if (msg.role === 'user') {
    parts.push(h('div', { class: 'plain' }, msg.content));
  } else {
    if (msg.reasoning) {
      parts.push(h('details', { class: 'reasoning', open: reasoningWasOpen },
        h('summary', {}, streaming && !msg.content ? 'Thinking…' : 'Thinking'),
        h('div', { class: 'reasoning-body' }, msg.reasoning),
      ));
    }
    if (msg.content) {
      const md = h('div', { class: 'md' });
      md.innerHTML = renderMarkdown(msg.content); // escaped inside renderMarkdown
      parts.push(md);
    }
    if (streaming && !msg.content && !msg.reasoning) {
      parts.push(h('div', { class: 'typing', 'aria-label': 'Neurio is typing' }, h('span'), h('span'), h('span')));
    }
    if (msg.error) {
      parts.push(h('div', { class: 'error' }, `⚠ ${msg.error}`));
    }
    if (msg.stopped) {
      parts.push(h('div', { class: 'muted small' }, 'Stopped.'));
    }
  }

  bubble.replaceChildren(...parts);
}

function scrollToBottom(force = false) {
  const t = el.thread;
  if (force || t.scrollHeight - t.scrollTop - t.clientHeight < 160) {
    t.scrollTop = t.scrollHeight;
  }
}

// ───────────────────────── sending & streaming ─────────────────────────

function buildRequest(conv) {
  const history = conv.messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(({ role, content }) => ({ role, content }));
  const system = state.settings.systemPrompt.trim();
  return system ? [{ role: 'system', content: system }, ...history] : history;
}

async function sendMessage(raw) {
  const text = raw.trim();
  if (!text || state.streaming || state.chatFull || !state.puter) return;

  const created = !state.conv;
  if (created) state.conv = newConversation({ model: currentModel() });
  const conv = state.conv;

  const userMsg = { role: 'user', content: text, at: Date.now() };
  conv.messages.push(userMsg);
  if (conv.messages.length === 1) conv.title = deriveTitle(text);

  el.input.value = '';
  autosize();

  try {
    await persist();
  } catch (err) {
    conv.messages.pop();
    if (created && conv.messages.length === 0) conv.title = 'New chat';
    el.input.value = text;
    autosize();
    handleSaveError(err);
    return;
  }

  renderConversation();
  await generateReply();
}

function handleSaveError(err) {
  if (err instanceof StoreError && err.code === 'too_long') {
    state.chatFull = true;
    el.input.disabled = true;
    el.sendBtn.disabled = true;
    el.input.placeholder = 'This chat is full. Start a new chat to continue.';
    toast(err.message, 6000);
    return;
  }
  toast(`Could not save: ${describeError(err)}`, 6000);
}

async function generateReply() {
  const conv = state.conv;
  const request = buildRequest(conv);
  const assistant = { role: 'assistant', content: '', at: Date.now() };
  conv.messages.push(assistant);

  const node = messageNode(assistant, conv.messages.length - 1, { streaming: true });
  el.messages.append(node);
  const bubble = node.querySelector('.bubble');
  scrollToBottom(true);

  state.streaming = true;
  state.stopDeferred = deferred();
  setBusy(true);

  let text = '';
  let reasoning = '';
  let error = null;
  let stopped = false;
  let frame = 0;

  const paint = () => {
    frame = 0;
    fillBubble(bubble, { ...assistant, content: text, reasoning }, { streaming: true });
    scrollToBottom();
  };
  const schedulePaint = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  try {
    const response = await state.puter.ai.chat(request, { model: conv.model, stream: true });
    const iterator = response[Symbol.asyncIterator]();

    while (true) {
      const next = iterator.next();
      next.catch(() => {}); // a late error after Stop must not surface as unhandled
      const result = await Promise.race([next, state.stopDeferred.promise]);
      if (result === STOP) {
        stopped = true;
        iterator.return?.().catch(() => {});
        break;
      }
      if (result.done) break;

      const part = result.value;
      if (part.type === 'text' && part.text) {
        text += part.text;
      } else if (part.type === 'reasoning' && part.reasoning) {
        reasoning += part.reasoning;
      } else if (part.type === 'error') {
        error = part.message || 'The model stopped with an error.';
        break;
      } else {
        continue;
      }
      schedulePaint();
    }
  } catch (err) {
    error = describeError(err);
  }

  if (frame) cancelAnimationFrame(frame);
  assistant.content = text;
  if (reasoning) assistant.reasoning = reasoning;
  if (error) assistant.error = error;
  if (stopped) assistant.stopped = true;
  if (!text && !error && !stopped) assistant.error = 'The model returned an empty reply.';

  state.streaming = false;
  state.stopDeferred = null;
  setBusy(false);

  try {
    await persist();
  } catch (err) {
    handleSaveError(err);
  }

  // Replace the streaming node with its final, actionable version.
  const finalNode = messageNode(assistant, conv.messages.length - 1, { canRegenerate: true });
  node.replaceWith(finalNode);
  renderSidebar();
  if (!el.input.disabled) el.input.focus();
}

const STOP = Symbol('stop');
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise: promise.then(() => STOP), resolve };
}

function stopStreaming() {
  state.stopDeferred?.resolve();
}

async function regenerate() {
  if (state.streaming || !state.conv || state.chatFull) return;
  const msgs = state.conv.messages;
  while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
  if (!msgs.length) return;
  renderConversation();
  await generateReply();
}

function setBusy(busy) {
  el.sendBtn.classList.toggle('hidden', busy);
  el.stopBtn.classList.toggle('hidden', !busy);
  el.thread.setAttribute('aria-busy', String(busy));
  el.messages.setAttribute('aria-busy', String(busy));
  el.newChatBtn.disabled = busy;
}

// ───────────────────────── chat actions ─────────────────────────

async function renameChat() {
  const conv = state.conv;
  if (!conv || state.streaming) return;
  const next = window.prompt('Rename chat', conv.title);
  if (next == null || !next.trim()) return;
  conv.title = next.trim().slice(0, 80);
  try {
    await persist();
    el.chatTitle.textContent = conv.title;
  } catch (err) {
    toast(`Could not rename: ${describeError(err)}`);
  }
}

async function deleteChat() {
  const conv = state.conv;
  if (!conv || state.streaming) return;
  const saved = state.index.some((m) => m.id === conv.id);
  if (saved && !window.confirm(`Delete "${conv.title}"? This cannot be undone.`)) return;
  try {
    if (saved) state.index = await state.store.deleteConversation(conv.id);
    state.conv = null;
    state.chatFull = false;
    renderConversation();
    renderSidebar();
    toast('Chat deleted.');
  } catch (err) {
    toast(`Could not delete: ${describeError(err)}`);
  }
}

async function changeModel(model) {
  state.settings.model = model;
  saveSettings();
  if (state.conv) {
    state.conv.model = model;
    if (state.conv.messages.length) {
      try {
        await persist();
      } catch (err) {
        handleSaveError(err);
      }
    }
  }
  fillModelSelect(el.modelSelect, model);
}

function openSettings() {
  el.systemPrompt.value = state.settings.systemPrompt;
  fillModelSelect(el.defaultModel, state.settings.model);
  el.theme.value = state.settings.theme;
  el.settingsDialog.showModal();
}

function saveSettingsForm(event) {
  event.preventDefault();
  state.settings.systemPrompt = el.systemPrompt.value;
  state.settings.model = el.defaultModel.value || DEFAULT_MODEL;
  state.settings.theme = el.theme.value;
  saveSettings();
  applyTheme();
  if (!state.conv) fillModelSelect(el.modelSelect, state.settings.model);
  el.settingsDialog.close();
  toast('Settings saved.');
}

// ───────────────────────── composer & layout ─────────────────────────

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
}

function openSidebar() {
  el.sidebar.classList.add('open');
  el.scrim.classList.add('show');
}

function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.scrim.classList.remove('show');
}

function bindEvents() {
  el.signInBtn.addEventListener('click', signIn);
  el.signOutBtn.addEventListener('click', signOut);
  el.newChatBtn.addEventListener('click', newChat);
  el.settingsBtn.addEventListener('click', openSettings);
  el.settingsForm.addEventListener('submit', saveSettingsForm);
  $('#settingsCancel').addEventListener('click', () => el.settingsDialog.close());
  el.menuBtn.addEventListener('click', () => (el.sidebar.classList.contains('open') ? closeSidebar() : openSidebar()));
  el.scrim.addEventListener('click', closeSidebar);
  el.renameBtn.addEventListener('click', renameChat);
  el.deleteBtn.addEventListener('click', deleteChat);
  el.modelSelect.addEventListener('change', (e) => changeModel(e.target.value));
  el.stopBtn.addEventListener('click', stopStreaming);

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(el.input.value);
  });

  el.input.addEventListener('input', autosize);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage(el.input.value);
    }
  });

  // One delegated handler for the per-message and per-code-block buttons.
  el.messages.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'regenerate') return regenerate();

    if (action === 'copy-code') {
      const text = btn.closest('.code-block').querySelector('code').textContent;
      return copyText(text, btn);
    }
    if (action === 'copy-msg') {
      const msg = state.conv?.messages[Number(btn.closest('.msg').dataset.idx)];
      return copyText(msg?.content ?? '', btn);
    }
  });
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1200);
  } catch {
    toast('Copy failed. Select the text and copy it manually.');
  }
}

// Sync the model picker's stored value on load and when settings change elsewhere.
window.addEventListener('storage', (e) => {
  if (e.key !== SETTINGS_KEY) return;
  state.settings = loadSettings();
  applyTheme();
});

boot().catch((err) => {
  console.error(err);
  showBanner(`Something went wrong starting the app: ${describeError(err)}`);
});
