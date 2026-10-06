// ============================================================================
// NEXUS EDITOR — Home screen (project hub)
// Recent projects, template gallery, Create With AI hero.
// ============================================================================
import { h } from './dom';
import { icon, logoSvg } from './icons';
import { store } from './store';
import { TEMPLATES } from '@templates/index';
import { showCreateWithAIDialog } from './dialogs';

export class HomeScreen {
  root: HTMLElement;

  constructor(onNewProject: () => void, onOpen: (id: string) => void, onCreateAI: () => void) {
    this.root = h('div', { class: 'nx-home' });
    const hero = h('div', { class: 'hero' });
    hero.innerHTML = `${logoSvg}<h1>NEXUS GAME STUDIO</h1><p>AI-POWERED 3D GAME DEVELOPMENT ENVIRONMENT</p>`;
    this.root.append(hero);

    // quick actions
    this.root.append(h('div', { style: { display: 'flex', gap: '12px' } },
      h('button', { class: 'primary', style: { padding: '12px 26px', fontSize: '13px' }, onclick: onNewProject }, icon('plus', 14), ' New Project'),
      h('button', { style: { padding: '12px 26px', fontSize: '13px' }, onclick: onCreateAI }, icon('sparkle', 14), ' Create With AI'),
    ));

    // recent projects
    const recents = h('div', { class: 'section' }, h('h2', {}, 'Recent Projects'));
    const list = h('div', { class: 'nx-cards' });
    recents.append(list);
    this.root.append(recents);
    store.listProjects().then(projects => {
      if (!projects.length) {
        list.append(h('div', { style: { color: 'var(--text-3)', gridColumn: '1/-1', fontSize: '12px' } }, 'No projects yet — create one above.'));
        return;
      }
      for (const p of projects.slice().reverse()) {
        list.append(h('div', {
          class: 'nx-card',
          onclick: () => onOpen(p.id),
        },
          h('div', { class: 't' }, icon('package', 16), p.name),
          h('div', { class: 'd' }, `${p.template ?? 'project'} · ${new Date(p.modifiedAt).toLocaleString()}`),
        ));
      }
    }).catch(() => {
      list.append(h('div', { style: { color: 'var(--red)', gridColumn: '1/-1' } }, '⚠ Could not reach the NEXUS server — is it running? (npm run dev / npm start)'));
    });

    // templates info
    const tSec = h('div', { class: 'section' }, h('h2', {}, 'Game Templates'));
    const tList = h('div', { class: 'nx-cards' });
    for (const t of TEMPLATES) {
      tList.append(h('div', { class: 'nx-card', style: { cursor: 'default' } },
        h('div', { class: 't' }, icon(t.icon, 16), t.name),
        h('div', { class: 'd' }, t.description),
      ));
    }
    tSec.append(tList);
    this.root.append(tSec);
  }
}
