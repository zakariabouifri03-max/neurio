// ============================================================================
// NEXUS GAME STUDIO — Server
// Project persistence, asset storage, build pipeline endpoint, snapshots,
// AI (LLM) proxy. Serves the built editor (www/) and project content.
// Runs standalone (node serverout/server.mjs) or inside Electron.
// ============================================================================
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../BuildSystem/pipeline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROJECTS_ROOT = path.join(ROOT, 'Projects');
const PORT = parseInt(process.env.NEXUS_PORT ?? '8756', 10);

fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

const app = express();
app.use(express.json({ limit: '512mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 * 1024 },
});

// -------------------------------- static ------------------------------------

app.use(express.static(path.join(ROOT, 'www'), { index: 'index.html' }));
app.use('/Projects', express.static(PROJECTS_ROOT));

// -------------------------------- projects ----------------------------------

app.get('/api/projects', (req, res) => {
  const out: any[] = [];
  for (const id of fs.readdirSync(PROJECTS_ROOT)) {
    const p = path.join(PROJECTS_ROOT, id, 'project.json');
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        out.push({ id, name: j.name, template: j.template, modifiedAt: j.modifiedAt, createdAt: j.createdAt });
      } catch { }
    }
  }
  res.json(out);
});

app.post('/api/projects', (req, res) => {
  const project = req.body;
  if (!project?.id || !project?.name) return res.status(400).json({ error: 'invalid project payload' });
  const dir = path.join(PROJECTS_ROOT, project.id);
  fs.mkdirSync(path.join(dir, 'Content'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 1));
  console.log(`[nexus] project created: ${project.name} (${project.id})`);
  res.json({ ok: true, id: project.id });
});

app.get('/api/projects/:id', (req, res) => {
  const p = path.join(PROJECTS_ROOT, req.params.id, 'project.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.sendFile(p);
});

app.put('/api/projects/:id', (req, res) => {
  const dir = path.join(PROJECTS_ROOT, req.params.id);
  const p = path.join(dir, 'project.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  // rolling backup
  try {
    const bdir = path.join(dir, '.backups');
    fs.mkdirSync(bdir, { recursive: true });
    const backups = fs.readdirSync(bdir).filter(f => f.startsWith('project-')).sort();
    fs.copyFileSync(p, path.join(bdir, `project-${Date.now()}.json`));
    while (backups.length >= 10) fs.unlinkSync(path.join(bdir, backups.shift()!));
  } catch { }
  fs.writeFileSync(p, JSON.stringify(req.body, null, 1));
  res.json({ ok: true });
});

app.post('/api/projects/:id/assets', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no file' });
  const dir = path.join(PROJECTS_ROOT, req.params.id, 'Content');
  fs.mkdirSync(dir, { recursive: true });
  const safeName = file.originalname.replace(/[^\w.\- ]/g, '_');
  const rel = `Content/${safeName}`;
  fs.writeFileSync(path.join(dir, safeName), file.buffer);
  const ext = path.extname(safeName).toLowerCase();
  const type =
    ['.glb', '.gltf', '.fbx', '.obj'].includes(ext) ? 'model' :
    ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? 'texture' :
    ['.wav', '.mp3', '.ogg'].includes(ext) ? 'audio' : 'other';
  res.json({
    id: 'a_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4),
    name: safeName.replace(/\.\w+$/, ''),
    type, path: rel, size: file.size, meta: {},
  });
});

// ------------------------------- snapshots ----------------------------------

app.post('/api/projects/:id/snapshots', (req, res) => {
  const dir = path.join(PROJECTS_ROOT, req.params.id);
  const src = path.join(dir, 'project.json');
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'not found' });
  const sdir = path.join(dir, '.snapshots');
  fs.mkdirSync(sdir, { recursive: true });
  const id = `snap_${Date.now().toString(36)}`;
  const entry = { id, name: req.body?.name ?? 'Snapshot', time: new Date().toISOString() };
  // snapshot project + content
  const snapDir = path.join(sdir, id);
  fs.mkdirSync(snapDir, { recursive: true });
  fs.copyFileSync(src, path.join(snapDir, 'project.json'));
  const contentDir = path.join(dir, 'Content');
  if (fs.existsSync(contentDir)) fs.cpSync(contentDir, path.join(snapDir, 'Content'), { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'meta.json'), JSON.stringify(entry));
  res.json({ ok: true, ...entry });
});

app.get('/api/projects/:id/snapshots', (req, res) => {
  const sdir = path.join(PROJECTS_ROOT, req.params.id, '.snapshots');
  if (!fs.existsSync(sdir)) return res.json([]);
  const out: any[] = [];
  for (const id of fs.readdirSync(sdir)) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(sdir, id, 'meta.json'), 'utf8'))); } catch { }
  }
  res.json(out.sort((a: any, b: any) => +new Date(a.time) - +new Date(b.time)));
});

app.post('/api/projects/:id/snapshots/:snapId/restore', (req, res) => {
  const dir = path.join(PROJECTS_ROOT, req.params.id);
  const snapDir = path.join(dir, '.snapshots', req.params.snapId);
  const snapProject = path.join(snapDir, 'project.json');
  if (!fs.existsSync(snapProject)) return res.status(404).json({ error: 'snapshot not found' });
  // safety: snapshot current state first
  const current = path.join(dir, 'project.json');
  if (fs.existsSync(current)) {
    const sdir = path.join(dir, '.snapshots');
    fs.mkdirSync(sdir, { recursive: true });
    const id = `snap_${Date.now().toString(36)}`;
    fs.mkdirSync(path.join(sdir, id), { recursive: true });
    fs.copyFileSync(current, path.join(sdir, id, 'project.json'));
    fs.writeFileSync(path.join(sdir, id, 'meta.json'), JSON.stringify({ id, name: 'Auto (pre-restore)', time: new Date().toISOString() }));
  }
  fs.copyFileSync(snapProject, current);
  res.json({ ok: true });
});

// --------------------------------- export -----------------------------------

app.get('/api/projects/:id/export', async (req, res) => {
  // simple zip via 'node:zlib' is not trivial — produce a .json bundle instead
  const dir = path.join(PROJECTS_ROOT, req.params.id);
  const p = path.join(dir, 'project.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  const project = JSON.parse(fs.readFileSync(p, 'utf8'));
  const bundle: any = { ...project, __bundle: 'nexus-project', content: {} };
  const contentDir = path.join(dir, 'Content');
  if (fs.existsSync(contentDir)) {
    for (const f of fs.readdirSync(contentDir)) {
      try { bundle.content[f] = fs.readFileSync(path.join(contentDir, f)).toString('base64'); } catch { }
    }
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/\s+/g, '_')}.nexusproj.json"`);
  res.send(JSON.stringify(bundle));
});

// ---------------------------------- build -----------------------------------

app.post('/api/build', (req, res) => {
  const { projectId, config } = req.body;
  const result = runBuild(PROJECTS_ROOT, projectId, {
    mode: config?.mode === 'Development' ? 'Development' : 'Release',
    name: (config?.name ?? 'MyGame').replace(/[^\w\-]/g, '') || 'MyGame',
  }, path.join(ROOT, 'www-runtime', 'runtime.js'));
  res.json(result);
});

// ----------------------------------- AI -------------------------------------

const CONFIG_PATH = path.join(ROOT, 'Server', 'config.json');

function readConfig(): any {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; }
}

app.get('/api/ai/status', (_req, res) => {
  const cfg = readConfig();
  res.json({ configured: !!(cfg?.apiKey && cfg?.model), model: cfg?.model ?? null, provider: cfg?.provider ?? null });
});

app.post('/api/ai/config', (req, res) => {
  const { provider, baseUrl, apiKey, model } = req.body ?? {};
  if (!apiKey || !model) return res.status(400).json({ ok: false, error: 'apiKey and model are required' });
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ provider, baseUrl, apiKey, model }, null, 2));
  console.log(`[nexus] AI configured: ${provider} / ${model}`);
  res.json({ ok: true });
});

app.post('/api/ai/llm', async (req, res) => {
  const cfg = readConfig();
  if (!cfg?.apiKey) return res.status(400).json({ error: 'No LLM configured — set one in AI Settings.' });
  const { messages, tools } = req.body ?? {};
  try {
    const reply = await callProvider(cfg, messages, tools);
    res.json(reply);
  } catch (e: any) {
    console.warn('[nexus] LLM error:', e?.message);
    res.status(502).json({ error: e?.message ?? 'LLM request failed' });
  }
});

async function callProvider(cfg: any, messages: any[], tools: any[]): Promise<any> {
  const toolSpecs = (tools ?? []).map((t: any) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.params ?? {}).map(([k, v]: any) => [k, { type: v.type === 'array' ? 'array' : v.type === 'any' ? 'string' : v.type, description: v.description }])),
        required: Object.entries(t.params ?? {}).filter(([_, v]: any) => v.required).map(([k]: any) => k),
      },
    },
  }));

  if (cfg.provider === 'anthropic') {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const rest = messages.filter(m => m.role !== 'system');
    const body: any = {
      model: cfg.model,
      max_tokens: 4096,
      system,
      messages: rest.map(m => m.role === 'tool'
        ? { role: 'user', content: `Tool result (${m.name}): ${m.content}` }
        : { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content ?? '' }),
      tools: toolSpecs.map(t => ({
        name: t.function.name, description: t.function.description, input_schema: t.function.parameters,
      })),
    };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    // map tool_use blocks to openai-style tool_calls
    const toolCalls = (j.content ?? []).filter((c: any) => c.type === 'tool_use').map((c: any) => ({
      id: c.id, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
    }));
    const text = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    return { role: 'assistant', content: text, tool_calls: toolCalls.length ? toolCalls : undefined };
  }

  // OpenAI-compatible
  const base = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: messages.map((m: any) => ({
        role: m.role === 'tool' ? 'tool' : m.role,
        content: m.content ?? '',
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      ...(toolSpecs.length ? { tools: toolSpecs, tool_choice: 'auto' } : {}),
    }),
  });
  if (!r.ok) throw new Error(`LLM API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const msg = j.choices?.[0]?.message ?? {};
  return { role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls };
}

// --------------------------------- health -----------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'NEXUS GAME STUDIO', version: '1.0.0' }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const index = path.join(ROOT, 'www', 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(503).send('NEXUS editor bundle not built — run <code>npm run build</code> first.');
});

export { app, PROJECTS_ROOT };

if (process.env.NEXUS_NO_SERVE !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  NEXUS GAME STUDIO - server ready');
    console.log('  http://localhost:' + PORT);
    console.log('  Projects: ' + PROJECTS_ROOT);
  });
}
