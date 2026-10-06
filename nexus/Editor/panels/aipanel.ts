// ============================================================================
// NEXUS EDITOR — AI Agent panel
// Chat interface with tool-call timeline, live plan progress, review dialogs
// (AI wants to modify N files…) and the AI debugger cards.
// ============================================================================
import { store } from '../store';
import { Agent, type AgentEvent } from '@ai/agent';
import { icon } from '../icons';
import { h, escape } from '../dom';

const EXAMPLES = [
  'Create a third-person player',
  'Add a zombie enemy',
  'Make zombies spawn at night',
  'Create a survival island with a village',
  'Add health bar and inventory UI',
  'The player cannot jump',
];

export class AIPanel {
  root: HTMLElement;
  private log: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLElement;
  private planState: { steps: Map<string, HTMLElement>; el: HTMLElement | null } = { steps: new Map(), el: null };
  agent: Agent;

  constructor() {
    this.root = h('div', { class: 'nx-ai' });
    this.log = h('div', { class: 'nx-ai-log' });
    this.input = h('textarea', { placeholder: 'Ask the agent… e.g. "Create a third-person player"' }) as HTMLTextAreaElement;
    this.sendBtn = h('button', { class: 'primary', style: { alignSelf: 'flex-end', height: '52px' }, onclick: () => this.send() }, icon('sparkle', 14), ' Send');
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });

    const chips = h('div', { class: 'nx-ai-chips' },
      EXAMPLES.map(x => h('span', { class: 'nx-chip', onclick: () => { this.input.value = x; this.send(); } }, x)));

    this.root.append(this.log, chips, h('div', { class: 'nx-ai-input' }, this.input, this.sendBtn));
    this.root.append(this.modeBar());

    this.agent = new Agent((e) => this.onEvent(e));
    this.welcome();
  }

  private modeBar(): HTMLElement {
    const dot = h('span', { class: `dot ${store.llmConfigured ? 'online' : 'offline'}` });
    const label = h('span', {}, store.llmConfigured ? `Connected LLM (${store.aiMode})` : 'Offline Agent (deterministic planner) — connect an LLM in AI ▸ AI Settings');
    editorBusSubscribe();
    return h('div', { class: 'nx-ai-mode' }, dot, label, h('span', { style: { marginLeft: 'auto' } }, 'AI operates only through structured tool calls'));
    function editorBusSubscribe() { /* mode refresh handled by app */ }
  }

  private welcome() {
    this.msg('agent', `<b>NEXUS AI Agent</b> — your development partner.<br>
I understand this project and modify it through <b>structured tool calls</b>: creating objects, wiring components, writing scripts, spawning enemies, building UI, debugging errors.<br>
Try: <i>“Create a third-person player”</i> or <i>“Create a survival island game”</i>.`);
  }

  private send() {
    const text = this.input.value.trim();
    if (!text || this.agent.busy) return;
    this.input.value = '';
    this.agent.chat(text);
  }

  private msg(role: 'user' | 'agent', html: string) {
    this.log.append(h('div', { class: `nx-msg ${role}`, html }));
    this.log.scrollTop = this.log.scrollHeight;
  }

  private onEvent(e: AgentEvent) {
    switch (e.type) {
      case 'message': {
        if (e.role === 'user') this.msg('user', escape(e.text));
        else this.msg('agent', e.html);
        break;
      }
      case 'tool': {
        const args = JSON.stringify(e.args ?? {}).slice(0, 120);
        const ok = typeof e.result === 'string' ? '' : e.result.ok ? '✓' : '✕';
        this.log.append(h('div', { class: 'nx-toolcall' },
          h('b', {}, `${e.name}`), ` ${args} → ${ok} ${typeof e.result === 'string' ? e.result : e.result.summary}`));
        this.log.scrollTop = this.log.scrollHeight;
        break;
      }
      case 'plan': {
        const el = h('div', { class: 'nx-msg agent' });
        el.append(h('b', {}, e.title));
        for (const s of e.steps) {
          const row = h('div', { class: 'plan-step pending', 'data-step': s.id }, h('span', { class: 'tick' }, '○'), h('span', {}, s.label));
          this.planState.steps.set(s.id, row);
          el.append(row);
        }
        this.log.append(el);
        this.planState.el = el;
        this.log.scrollTop = this.log.scrollHeight;
        break;
      }
      case 'plan-step': {
        const row = this.planState.steps.get(e.id);
        if (row) {
          row.className = `plan-step ${e.status}`;
          const tick = row.querySelector('.tick')!;
          tick.textContent = e.status === 'done' ? '✓' : e.status === 'running' ? '◌' : e.status === 'failed' ? '✕' : '–';
          if (e.note) row.title = e.note;
        }
        break;
      }
      case 'review': {
        const backdrop = h('div', { class: 'nx-modal-backdrop' });
        const list = h('div', { class: 'nx-review-list' },
          e.manifest.changes.map(c => h('div', { class: 'f' }, h('span', { class: 'tag' }, 'change'), c)));
        const modal = h('div', { class: 'nx-modal' },
          h('div', { class: 'nx-modal-header' }, icon('brain'), ` ${e.manifest.summary}`, h('span', { class: 'x', onclick: () => { backdrop.remove(); e.resolve(false); } }, '✕')),
          h('div', { class: 'nx-modal-body' },
            h('div', { style: { marginBottom: '8px', color: 'var(--text-1)' } }, 'The AI wants to make these changes:'),
            list,
            h('div', { style: { color: 'var(--text-3)', fontSize: '11px', marginTop: '10px' } }, 'Your project is snapshotted — you can undo everything (Ctrl+Z) after applying.')),
          h('div', { class: 'nx-modal-footer' },
            h('button', { onclick: () => { backdrop.remove(); e.resolve(false); this.msg('agent', 'Changes rejected — nothing was modified.'); } }, 'Cancel'),
            h('button', { class: 'primary', onclick: () => { backdrop.remove(); e.resolve(true); } }, 'Apply'),
          ));
        backdrop.append(modal);
        document.body.append(backdrop);
        break;
      }
      case 'diagnosis': {
        const d = e.diagnosis;
        const card = h('div', { class: 'nx-msg agent', style: { borderColor: 'var(--red)', borderWidth: '1px' } });
        card.append(h('b', {}, `🐞 ${d.title}`));
        card.append(h('div', {}, `**Cause:** ${d.cause}`.replace(/\*\*(.+?):\*\* /, '<b>Cause:</b> ')));
        card.append(h('div', { html: `<b>Solution:</b> ${escape(d.solution)}` }));
        if (d.filesAffected.length) card.append(h('div', { style: { color: 'var(--text-3)', fontSize: '11px' } }, `Files: ${d.filesAffected.join(', ')}`));
        const actions = h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } });
        actions.append(h('button', {
          class: 'primary',
          onclick: async () => { btn.disabled = true; await this.agent.applyDiagnosis(d); btn.disabled = false; },
        }, '⚡ Apply Fix'));
        const btn = actions.lastChild as HTMLButtonElement;
        actions.append(h('button', { onclick: () => card.style.opacity = '0.5' }, 'Cancel'));
        card.append(actions);
        this.log.append(card);
        this.log.scrollTop = this.log.scrollHeight;
        break;
      }
      case 'busy': {
        this.sendBtn.classList.toggle('disabled', e.busy);
        (this.sendBtn as HTMLButtonElement).disabled = e.busy;
        this.input.placeholder = e.busy ? 'Agent is working…' : 'Ask the agent… e.g. "Create a third-person player"';
        break;
      }
    }
  }
}
