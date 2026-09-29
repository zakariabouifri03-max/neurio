#!/usr/bin/env node
/* ============================================================================
 * Scam Baqi — scam-ai-server.mjs
 *
 * One file, zero dependencies. It does two things:
 *   1. serves the game   (scam/ … index.html, src/, vendor/)
 *   2. bridges the game to a **local** language model, so callers talk through
 *      a real LLM — no cloud, no API keys, no telemetry.
 *
 *   node tools/scam-ai-server.mjs                  # auto-detect a local model
 *   node tools/scam-ai-server.mjs --port 8123
 *   node tools/scam-ai-server.mjs --url http://127.0.0.1:11434/v1 --model qwen2.5:3b
 *   node tools/scam-ai-server.mjs --no-ai          # static file server only
 *
 * Auto-detected backends (started by *you*, on your machine):
 *   Ollama        http://127.0.0.1:11434     (ollama pull qwen2.5:3b)
 *   LM Studio     http://127.0.0.1:1234/v1
 *   llama.cpp     http://127.0.0.1:8080/v1   (llama-server -m model.gguf)
 *   text-gen-webui http://127.0.0.1:5000/v1
 *
 * The browser only ever talks to THIS server (/api/ai/*) — never to the model
 * directly — so there are no CORS surprises and nothing leaves the machine.
 * ==========================================================================*/
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.findIndex((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (i < 0) return def;
  const a = argv[i];
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const PORT = Number(arg('port', process.env.PORT || 8123));
const HOST = String(arg('host', '0.0.0.0'));
const DIR = resolve(ROOT, String(arg('dir', 'scam')));
const NO_AI = !!arg('no-ai', false);
const FORCED_URL = (arg('url', process.env.SCAM_AI_URL || '') || '').toString().replace(/\/+$/, '');
const FORCED_MODEL = (arg('model', process.env.SCAM_AI_MODEL || '') || '').toString();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wav': 'audio/wav'
};

// ------------------------------------------------------------- backend detect
const CANDIDATES = [
  { kind: 'ollama', base: 'http://127.0.0.1:11434' },
  { kind: 'openai', base: 'http://127.0.0.1:1234/v1', label: 'LM Studio' },
  { kind: 'openai', base: 'http://127.0.0.1:8080/v1', label: 'llama.cpp' },
  { kind: 'openai', base: 'http://127.0.0.1:5000/v1', label: 'text-generation-webui' },
  { kind: 'openai', base: 'http://127.0.0.1:11435/v1', label: 'custom' }
];

const backend = { kind: null, base: '', model: '', label: '', checked: 0, error: '' };

async function jget(url, ms = 1500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { clearTimeout(t); return null; }
}

async function detect(force = false) {
  if (NO_AI) { backend.kind = null; backend.error = ' AI مسدود (--no-ai)'; return backend; }
  if (!force && backend.kind && Date.now() - backend.checked < 5000) return backend;
  backend.checked = Date.now();

  if (FORCED_URL) {
    const isOllama = /:11434$/.test(FORCED_URL) && !/\/v1$/.test(FORCED_URL);
    if (isOllama) {
      const tags = await jget(FORCED_URL + '/api/tags');
      const models = tags && tags.models ? tags.models.map((m) => m.name) : [];
      backend.kind = 'ollama'; backend.base = FORCED_URL; backend.label = 'Ollama';
      backend.model = FORCED_MODEL || models[0] || 'llama3.2';
      backend.error = models.length ? '' : 'الموديل ما كاينش — دير: ollama pull ' + backend.model;
      return backend;
    }
    const models = await jget(FORCED_URL + '/models');
    const list = models && models.data ? models.data.map((m) => m.id) : [];
    backend.kind = 'openai'; backend.base = FORCED_URL; backend.label = 'OpenAI-compatible';
    backend.model = FORCED_MODEL || list[0] || '';
    backend.error = list.length ? '' : 'ما لقيتش موديل مطبّع ف ' + FORCED_URL;
    return backend;
  }

  for (const c of CANDIDATES) {
    if (c.kind === 'ollama') {
      const tags = await jget(c.base + '/api/tags');
      if (tags && Array.isArray(tags.models)) {
        backend.kind = 'ollama'; backend.base = c.base; backend.label = 'Ollama';
        backend.model = FORCED_MODEL || (tags.models[0] && tags.models[0].name) || '';
        backend.error = backend.model ? '' : 'Ollama خدام و لكن بلا موديل — دير: ollama pull qwen2.5:3b';
        return backend;
      }
    } else {
      const models = await jget(c.base + '/models');
      if (models && Array.isArray(models.data) && models.data.length) {
        backend.kind = 'openai'; backend.base = c.base; backend.label = c.label;
        backend.model = FORCED_MODEL || models.data[0].id;
        backend.error = '';
        return backend;
      }
    }
  }
  backend.kind = null; backend.base = ''; backend.model = '';
  backend.error = 'ما لقيت حتى موديل محلي شغّال';
  return backend;
}

// ------------------------------------------------------------------- helpers
function status() {
  return {
    online: !!backend.kind, backend: backend.label || (backend.kind || ''), model: backend.model,
    streaming: true, base: backend.base, reason: backend.error || '', brain: 'scam/src/brain.js'
  };
}

function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(s),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(s);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve2) => {
    let n = 0, chunks = [];
    req.on('data', (c) => { n += c.length; if (n < limit) chunks.push(c); else req.destroy(); });
    req.on('end', () => { try { resolve2(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve2({}); } });
    req.on('error', () => resolve2({}));
  });
}

/** Stream the model's answer to the browser as SSE frames: data: {"t":"…"} … data: [DONE] */
async function chat(req, res) {
  await detect();
  if (!backend.kind) { json(res, 503, { error: 'AI ليس متوفر — اللعبة غادي تتخدم بالمحرّك المحلي', detail: backend.error }); return; }
  const body = await readBody(req);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const model = body.model || backend.model;
  const temperature = typeof body.temperature === 'number' ? body.temperature : 0.8;
  const maxTokens = Math.min(600, body.max_tokens || 200);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
  const done = () => { res.write('data: [DONE]\n\n'); res.end(); };

  const url = backend.kind === 'ollama' ? backend.base + '/api/chat' : backend.base + '/chat/completions';
  const payload = backend.kind === 'ollama'
    ? { model, messages, stream: true, options: { temperature, num_predict: maxTokens } }
    : { model, messages, stream: true, temperature, max_tokens: maxTokens };

  let full = '';
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok || !r.body) { send({ e: 'backend ' + r.status }); done(); return; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: fin } = await reader.read();
      if (fin) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let piece = '';
        if (backend.kind === 'ollama') {
          try { const j = JSON.parse(line); piece = (j.message && j.message.content) || ''; } catch { }
        } else {
          const data = line.startsWith('data:') ? line.slice(5).trim() : line;
          if (data === '[DONE]') continue;
          try { const j = JSON.parse(data); piece = (j.choices && j.choices[0] && ((j.choices[0].delta && j.choices[0].delta.content) || j.choices[0].text)) || ''; } catch { }
        }
        if (piece) { full += piece; send({ t: piece }); }
      }
      if (res.writableEnded) break;
    }
    send({ full });
  } catch (e) {
    send({ e: String(e && e.message || e) });
  }
  done();
}

// -------------------------------------------------------------------- static
function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = normalize(join(DIR, rel));
  if (!file.startsWith(DIR)) { res.writeHead(403); res.end('no'); return; }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
  const buf = readFileSync(file);
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-cache' });
  res.end(buf);
}

// -------------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end();
    return;
  }
  if (url === '/api/ai/status') { await detect(); return json(res, 200, status()); }
  if (url === '/api/ai/chat' && req.method === 'POST') { return chat(req, res); }
  if (url === '/api/ai/detect') { await detect(true); return json(res, 200, status()); }
  return serveStatic(req, res);
});

server.listen(PORT, HOST, async () => {
  await detect(true);
  const where = 'http://localhost:' + PORT + '/';
  console.log('\n  ☎️  Scam Baqi — سكام مع الصحاب');
  console.log('  ──────────────────────────────────────────────');
  console.log('  اللعبة:      ' + where);
  if (NO_AI) {
    console.log('  الذكاء:      محرّك محلي مدرّب (offline 100%) — --no-ai');
  } else if (backend.kind) {
    console.log('  AI حقيقي:    ✅ ' + backend.label + ' · ' + (backend.model || '?') + ' · ' + backend.base);
  } else {
    console.log('  AI حقيقي:    ✖ ' + backend.error);
    console.log('               (اللعبة غادي تخدم بالمحرّك المحلي المدرّب — 100% offline)');
    console.log('               باش تشغّل AI محلي:  ollama pull qwen2.5:3b   و من بعد عاود شغّل هاد السيرفر');
  }
  console.log('  ──────────────────────────────────────────────');
  console.log('  كل شي محلي: لا إنترنت، لا مفاتيح، لا سجلات.');
  if (String(arg('open', '')) === 'true') console.log('\n  حلّ ' + where + ' ف المتصفح.\n');
});
