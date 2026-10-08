# Neurio Chat

An AI chat app built on [Puter.js](https://developer.puter.com). It streams replies from 500+ models, saves conversations to the signed-in user's own Puter account, and needs no API keys and no backend.

Powered by [Puter](https://developer.puter.com).

## Features

- **Sign in with Puter** (`puter.auth`). Usage is billed to each user's own Puter account (the user-pays model).
- **Model picker** filled from `puter.ai.listModels()`, grouped by provider. Falls back to a short built-in list if the call fails.
- **Streaming replies** via `puter.ai.chat(messages, { model, stream: true })`, with a Stop button that keeps the partial answer.
- **Markdown** (headings, lists, code blocks with copy, quotes, links). Everything is HTML-escaped first, so model output cannot inject markup.
- **Reasoning** chunks shown in a collapsible "Thinking" panel.
- **Conversations**: new, switch, rename, delete, regenerate the last reply. Titles come from the first message.
- **Settings** (this browser): default model, a system prompt sent with every request, and light/dark/system theme.
- **Storage** in `puter.kv`, one index key plus one key per conversation (see below).
- Responsive layout: the sidebar becomes a drawer on small screens.

## Run it

It is plain HTML, CSS, and ES modules, with no build step. Puter.js must be served over `http(s)`, not opened from `file://`.

```bash
# from the repository root
python3 -m http.server 8000
# then open http://localhost:8000/chat/
```

The page loads Puter.js from `https://js.puter.com/v2/`.

## Layout

```
chat/
├── index.html        page structure, loads Puter.js and js/app.js
├── styles.css        light/dark theme, responsive layout
├── js/
│   ├── app.js        UI controller: auth, models, streaming, actions
│   ├── store.js      conversation storage on puter.kv (testable, no DOM)
│   └── markdown.js   small, safe Markdown renderer (testable, no DOM)
└── tests/            unit tests for store.js and markdown.js
```

## Storage model

| Key | Value |
| --- | --- |
| `chat:index` | `[{ id, title, model, updatedAt }]`, newest first |
| `chat:conv:<id>` | `{ id, title, model, createdAt, updatedAt, messages: [{ role, content, at, reasoning?, error?, stopped? }] }` |

Each user's data lives in their own Puter account, scoped to this app.

**Limit:** a single KV value is capped at `puter.kv.MAX_VALUE_SIZE` (about 400 KB). When a chat would exceed that, the app stops saving it, shows a message, and locks the composer. The user can start a new chat. Splitting long chats across several keys (see the Puter "Split a Large Value" recipe) is the next step if long chats are needed.

Settings (default model, system prompt, theme) are stored in this browser's `localStorage`, not in the cloud.

## Tests

```bash
cd chat
npm test        # Node 18+; unit tests for markdown.js and store.js
```

The UI was also checked end to end in headless Chromium with a stand-in for `js.puter.com`, covering sign-in, streaming, Stop, errors, reasoning, persistence across reloads, regenerate, rename, delete, system prompt, model switching, themes, the mobile drawer, storage limits, and `file://`. The stand-in is not committed; test against the real service before shipping.

## Service worker note

The game at the repository root registers `sw.js` with a scope covering all of `/`, which includes `/chat/`. Its cache-first fetch handler would otherwise keep serving stale copies of the chat files. `sw.js` therefore passes `/chat/` requests straight to the network.

## Adding features

- **New model options** go in the `options` object of `puter.ai.chat()` in `js/app.js` (`buildRequest` / `generateReply`). See the [puter.ai.chat docs](https://docs.puter.com/AI/chat/).
- **Image or file input** can use the `media` argument or `"file"` content parts described in the same docs.
- **Cross-device settings** could move from `localStorage` to `puter.kv` using the "Save User Settings" recipe.
