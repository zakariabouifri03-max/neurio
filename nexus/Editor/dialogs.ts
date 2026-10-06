// ============================================================================
// NEXUS EDITOR — Dialogs
// New Project, Create With AI (game plan wizard), Build, Snapshots,
// AI Settings (LLM connect), Review Changes.
// ============================================================================
import { h } from './dom';
import { icon } from './icons';
import { store } from './store';
import { TEMPLATES } from '@templates/index';
import { buildGamePlan } from '@ai/planner';
import { configureLlm } from '@ai/llm';
import { editorBus } from '@engine/core/events';
import { refreshMemory } from '@ai/memory';

export function modal(title: string, body: HTMLElement, footer?: HTMLElement, wide = false): { close: () => void; el: HTMLElement } {
  const backdrop = h('div', { class: 'nx-modal-backdrop' });
  const m = h('div', { class: `nx-modal${wide ? ' wide' : ''}` },
    h('div', { class: 'nx-modal-header' }, icon('sparkle'), ` ${title}`, h('span', { class: 'x', onclick: () => backdrop.remove() }, '✕')),
    h('div', { class: 'nx-modal-body' }, body),
    footer ? h('div', { class: 'nx-modal-footer' }, footer) : '',
  );
  backdrop.append(m);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
  return { close: () => backdrop.remove(), el: m };
}

// -------------------------------- New Project -------------------------------

export function showNewProjectDialog(onCreated: () => void) {
  let selected = TEMPLATES[0];
  const body = h('div', {},
    h('div', { class: 'nx-form-row' },
      h('label', {}, 'Project Name'),
      h('div', { class: 'ctrl' }, Object.assign(h('input', { type: 'text', value: 'MyGame' }), { id: 'np-name' }))),
    h('div', { class: 'nx-form-row' },
      h('label', {}, 'Location'),
      h('div', { class: 'ctrl' }, h('input', { type: 'text', value: 'Projects/', disabled: true, title: 'Projects are stored under the NEXUS workspace Projects/ directory' }),
        h('span', { style: { fontSize: '10px', color: 'var(--text-3)' } }, '(server workspace)'))),
    h('div', { class: 'nx-form-row' },
      h('label', {}, 'Graphics Quality'),
      h('div', { class: 'ctrl' }, selectEl(['low', 'medium', 'high', 'ultra'], 'high', { id: 'np-quality' }))),
    h('div', { class: 'nx-form-row' },
      h('label', {}, 'Target Platform'),
      h('div', { class: 'ctrl' }, selectEl(['windows', 'web'], 'web', { id: 'np-platform' }))),
    h('div', { class: 'nx-form-row', style: { alignItems: 'flex-start' } },
      h('label', {}, 'Template'),
      h('div', { class: 'nx-cards', id: 'np-templates' })),
  );

  const grid = body.querySelector('#np-templates')!;
  for (const t of TEMPLATES) {
    const card = h('div', { class: `nx-card${t === selected ? ' selected' : ''}` },
      h('div', { class: 't' }, icon(t.icon, 16), t.name),
      h('div', { class: 'd' }, t.description));
    card.onclick = () => {
      selected = t;
      grid.querySelectorAll('.nx-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    };
    grid.append(card);
  }

  const footer = h('div', {},
    h('button', {
      onclick: async () => {
        const name = (body.querySelector('#np-name') as HTMLInputElement).value.trim() || 'MyGame';
        const quality = (body.querySelector('#np-quality') as HTMLSelectElement).value as any;
        const platform = (body.querySelector('#np-platform') as HTMLSelectElement).value as any;
        const project = selected.build(name);
        project.settings.graphicsQuality = quality;
        project.settings.targetPlatform = platform;
        refreshMemoryFor(project);
        const ok = await store.createProject(project);
        if (ok) { editorBus.emit('notify', { kind: 'success', text: `Project "${name}" created (${project.scenes[0].objects.length} objects)` }); onCreated(); }
      },
    }, icon('check', 12), ' Create Project'),
  );

  modal('New Project', body, footer, true);
}

function refreshMemoryFor(project: any) {
  // lightweight memory init for new projects (store not yet swapped)
  const saved = store.project;
  (store as any).project = project;
  try { refreshMemory('init'); } finally { (store as any).project = saved; }
}

function selectEl(options: string[], value: string, attrs: any = {}): HTMLElement {
  const s = h('select', attrs);
  for (const o of options) {
    const opt = h('option', { value: o }, o);
    if (o === value) (opt as any).selected = true;
    s.append(opt);
  }
  return s;
}

// ------------------------------ Create With AI ------------------------------

export function showCreateWithAIDialog(onPlanReady: (plan: any) => void) {
  const textarea = h('textarea', {
    style: { width: '100%', height: '90px', background: 'var(--bg-0)', border: '1px solid var(--border-1)', borderRadius: '6px', padding: '10px', color: 'var(--text-0)', resize: 'vertical', outline: 'none' },
    placeholder: 'Describe your game…\ne.g. "Create a realistic third-person survival game on a large island"',
  }) as HTMLTextAreaElement;

  const presets = [
    'Create a realistic third-person survival game on a large island',
    'Make a first-person horror game set in a dark maze',
    'Create a top-down shooter with waves of robots',
    'Make a third-person adventure with a village and patrolling guards',
  ];
  const chips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0' } },
    presets.map(p => h('span', { class: 'nx-chip', onclick: () => { textarea.value = p; } }, p)));

  const planContainer = h('div', {});

  const analyze = () => {
    const text = textarea.value.trim();
    if (!text) return;
    const plan = buildGamePlan(text);
    planContainer.innerHTML = '';
    planContainer.append(h('div', { style: { margin: '14px 0 6px', color: 'var(--text-0)', fontWeight: 600 } }, `GAME PLAN — ${plan.genre}`));
    for (const section of plan.sections) {
      planContainer.append(h('div', { style: { color: 'var(--accent)', fontSize: '11px', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '10px 0 4px' } }, section.name));
      for (const item of section.items) {
        planContainer.append(h('div', { style: { display: 'flex', gap: '8px', padding: '1.5px 0', color: 'var(--text-1)' } },
          h('span', { style: { color: 'var(--green)' } }, '✓'), item.label));
      }
    }
    generateBtn.style.display = '';
    planContainer.dataset.ready = '1';
  };

  const generateBtn = h('button', {
    class: 'primary', style: { display: 'none' },
    onclick: () => {
      const text = textarea.value.trim();
      if (!text) return;
      dlg.close();
      onPlanReady(text);
    },
  }, icon('sparkle', 12), ' Generate ▸');

  const body = h('div', {},
    h('div', { style: { color: 'var(--text-2)', marginBottom: '10px' } }, 'Describe the game you want. The AI will draft a development plan, then generate it step-by-step with real tool calls.'),
    textarea, chips,
    h('div', { style: { display: 'flex', gap: '8px', margin: '10px 0' } },
      h('button', { onclick: analyze }, icon('brain', 12), ' Analyze & Plan'),
    ),
    planContainer,
  );

  const dlg = modal('Create With AI', body, generateBtn, true);
}

// --------------------------------- Build ------------------------------------

export function showBuildDialog(onBuild: (mode: string) => Promise<any>) {
  let mode = 'Release';
  const body = h('div', {},
    h('div', { class: 'nx-form-row' }, h('label', {}, 'Configuration'),
      h('div', { class: 'ctrl' }, selectEl(['Development', 'Release'], 'Release', { id: 'bd-mode', onchange: (e: any) => { mode = e.target.value; } }))),
    h('div', { class: 'nx-form-row' }, h('label', {}, 'Target'),
      h('div', { class: 'ctrl' }, h('input', { type: 'text', value: `${store.project?.settings.targetPlatform === 'windows' ? 'Windows (EXE package)' : 'Standalone HTML (+ EXE packaging scripts)'}`, disabled: true }))),
    h('div', { style: { color: 'var(--text-3)', fontSize: '11px', lineHeight: '1.6', background: 'var(--bg-2)', padding: '10px', borderRadius: '6px', marginTop: '8px' } },
      `The build pipeline: Validate Project → Validate Assets → Compile Scripts → Process Assets → Package Content → Create Runtime → Generate EXE package → Validate.\nOutput: <Game>.html (double-click playable, fully offline) + Launch-<Game>.bat + Make-<Game>-Exe.bat (one-click real Windows EXE via Electron packaging — requires Node.js on the target machine).`),
  );
  const footer = h('div', {},
    h('button', { class: 'primary', onclick: async () => { dlg.close(); await onBuild(mode); } }, icon('hammer', 12), ' Build'));
  const dlg = modal('Build Game', body, footer);
}

// ------------------------------- Snapshots ----------------------------------

export async function showSnapshotsDialog() {
  if (!store.project) return;
  let snaps: any[] = [];
  try { const r = await fetch(`/api/projects/${store.project.id}/snapshots`); snaps = await r.json(); } catch { }
  const body = h('div', {});
  body.append(h('div', { style: { color: 'var(--text-2)', marginBottom: '10px' } }, `Snapshots preserve the whole project. Current: ${snaps.length} snapshot(s).`));
  const list = h('div', { class: 'nx-review-list' });
  for (const s of [...snaps].reverse()) {
    list.append(h('div', { class: 'f' },
      h('span', { class: 'tag' }, new Date(s.time).toLocaleString()),
      h('span', { style: { flex: '1' } }, s.name),
      h('button', {
        style: { fontSize: '10px', padding: '2px 8px' },
        onclick: async () => {
          if (!confirm(`Restore snapshot "${s.name}"? Current state will be snapshotted first.`)) return;
          const r = await fetch(`/api/projects/${store.project!.id}/snapshots/${s.id}/restore`, { method: 'POST' });
          if (r.ok) {
            await store.openProject(store.project!.id);
            editorBus.emit('notify', { kind: 'success', text: `Snapshot "${s.name}" restored` });
            dlg.close();
          }
        },
      }, 'Restore'),
    ));
  }
  if (!snaps.length) list.append(h('div', { class: 'f' }, 'No snapshots yet.'));
  body.append(list);
  const footer = h('div', {},
    h('button', {
      onclick: async () => {
        const name = prompt('Snapshot name', `Snapshot ${String(snaps.length + 1).padStart(3, '0')}`);
        if (!name) return;
        await store.save();
        await fetch(`/api/projects/${store.project!.id}/snapshots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        dlg.close();
        showSnapshotsDialog();
      },
    }, icon('save', 12), ' Create Snapshot'));
  const dlg = modal('Version History / Snapshots', body, footer);
}

// ------------------------------- AI Settings --------------------------------

export function showAISettingsDialog() {
  const body = h('div', {},
    h('div', { style: { color: 'var(--text-2)', lineHeight: '1.6', marginBottom: '12px' } },
      `The agent runs in <b>Offline mode</b> by default: a deterministic planner that executes structured tool calls. Connect an LLM for open-ended reasoning — the model drives the <b>same tools</b>, so it can still only change the project through validated operations.`),
    h('div', { class: 'nx-form-row' }, h('label', {}, 'Provider'),
      h('div', { class: 'ctrl' }, selectEl(['openai-compatible', 'anthropic'], 'openai-compatible', { id: 'ai-provider' }))),
    h('div', { class: 'nx-form-row' }, h('label', {}, 'Base URL'),
      h('div', { class: 'ctrl' }, Object.assign(h('input', { type: 'text', value: 'https://api.openai.com/v1' }), { id: 'ai-url' }))),
    h('div', { class: 'nx-form-row' }, h('label', {}, 'API Key'),
      h('div', { class: 'ctrl' }, Object.assign(h('input', { type: 'password', placeholder: 'sk-…' }), { id: 'ai-key' }))),
    h('div', { class: 'nx-form-row' }, h('label', {}, 'Model'),
      h('div', { class: 'ctrl' }, Object.assign(h('input', { type: 'text', value: 'gpt-4o-mini' }), { id: 'ai-model' }))),
    h('div', { style: { color: 'var(--text-3)', fontSize: '11px' } }, 'The key is stored server-side (Server/config.json) and never sent to the browser client.'),
  );
  const status = h('span', { style: { color: 'var(--text-3)', fontSize: '11px' } }, store.llmConfigured ? '● LLM connected' : '○ Offline mode');
  const footer = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
    status,
    h('button', {
      class: 'primary', onclick: async () => {
        const cfg = {
          provider: (body.querySelector('#ai-provider') as HTMLSelectElement).value,
          baseUrl: (body.querySelector('#ai-url') as HTMLInputElement).value,
          apiKey: (body.querySelector('#ai-key') as HTMLInputElement).value,
          model: (body.querySelector('#ai-model') as HTMLInputElement).value,
        };
        const r = await configureLlm(cfg);
        if (r.ok) {
          await store.refreshLlmStatus();
          status.textContent = '● LLM connected';
          status.style.color = 'var(--green)';
          editorBus.emit('notify', { kind: 'success', text: 'LLM connected — the agent now uses it for open-ended requests.' });
        } else {
          status.textContent = `✕ ${r.error}`;
          status.style.color = 'var(--red)';
        }
      },
    }, icon('brain', 12), ' Connect'),
  );
  modal('AI Settings', body, footer);
}
