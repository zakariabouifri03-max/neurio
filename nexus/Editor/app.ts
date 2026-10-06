// ============================================================================
// NEXUS EDITOR — Application shell
// Menus, toolbar, panels, viewport, commands, play mode, build, toasts,
// statusbar, home screen — the full editor wiring.
// ============================================================================
import { h, clear } from './dom';
import { icon, logoSvg } from './icons';
import { store } from './store';
import { editorBus } from '@engine/core/events';
import { menubar, type MenuDef } from './menus';
import { DockLayout } from './layout';
import { command, runCommand, installShortcuts, palette, allCommands } from './commands';
import { Viewport, type GizmoMode, type TerrainTool } from './viewport';
import { HierarchyPanel, sceneSelector } from './panels/hierarchy';
import { InspectorPanel } from './panels/inspector';
import { AssetsPanel } from './panels/assets';
import { ConsolePanel, ProblemsPanel, OutputPanel, ProfilerPanel } from './panels/console';
import { AIPanel } from './panels/aipanel';
import { ScriptEditorPanel, VisualScriptPanel } from './scripteditor';
import { showNewProjectDialog, showCreateWithAIDialog, showBuildDialog, showSnapshotsDialog, showAISettingsDialog, modal } from './dialogs';
import { installDropHooks, createPrefabFromSelection } from './ai-bridge';
import { initAgent } from '@ai/agent';
import { diagnoseProblem, diagnoseGameplayBug, type Diagnosis } from '@ai/debugger';
import { refreshMemory } from '@ai/memory';
import { formatBytes } from '@engine/core/math';
import { HomeScreen } from './home';
import { template3dGame } from '@templates/index';

export class EditorApp {
  host: HTMLElement;
  /** the shared store singleton (exposed for tooling/tests) */
  readonly store = store;
  viewport: Viewport | null = null;
  layout: DockLayout | null = null;
  home: HomeScreen | null = null;
  aiPanel: AIPanel | null = null;
  output: OutputPanel | null = null;
  problemsPanel: ProblemsPanel | null = null;
  statusbar: HTMLElement | null = null;
  private playBtn: HTMLElement | null = null;
  private toolbarSecond: HTMLElement | null = null;
  private editorArea: HTMLElement | null = null;
  private toolButtons = new Map<string, HTMLElement>();

  constructor(host: HTMLElement) {
    this.host = host;
    installDropHooks();
    this.buildChrome();
    this.registerCommands();
    installShortcuts();
    this.showHome();
    store.refreshLlmStatus();
    editorBus.on('notify', ({ kind, text }) => this.toast(kind, text));
    editorBus.on('playModeChanged', () => this.updatePlayButtons());
    editorBus.on('projectChanged', () => this.updateStatusbar());
    editorBus.on('selectionChanged', () => this.updateStatusbar());
    window.addEventListener('beforeunload', () => { if (store.dirty) store.save(); });
  }

  // -------------------------------- chrome -----------------------------------

  private buildChrome() {
    clear(this.host);
    const app = h('div', { class: 'nx-app', style: { display: 'flex', flexDirection: 'column', height: '100%' } });
    app.append(this.buildMenubar(), this.buildToolbar());
    this.editorArea = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' }, id: 'editor-area' });
    app.append(this.editorArea);
    this.statusbar = this.buildStatusbar();
    app.append(this.statusbar);
    this.host.append(app);
    const toastWrap = h('div', { class: 'nx-toast-wrap' });
    document.body.append(toastWrap);
  }

  private buildMenubar(): HTMLElement {
    const menus: MenuDef[] = [
      {
        label: 'File', items: () => [
          { label: 'New Project…', icon: 'plus', fn: () => runCommand('project.new') },
          { label: 'Create With AI…', icon: 'sparkle', fn: () => runCommand('project.createAI') },
          { sep: true },
          { label: 'Save Project', kbd: 'Ctrl+S', fn: () => runCommand('project.save') },
          { label: 'Export Project (.zip)', fn: () => store.exportProject() },
          { sep: true },
          { label: 'Close Project', fn: () => runCommand('project.close') },
        ],
      },
      {
        label: 'Edit', items: () => [
          { label: 'Undo', kbd: 'Ctrl+Z', fn: () => runCommand('edit.undo') },
          { label: 'Redo', kbd: 'Ctrl+Y', fn: () => runCommand('edit.redo') },
          { sep: true },
          { label: 'Duplicate', kbd: 'Ctrl+D', fn: () => runCommand('edit.duplicate') },
          { label: 'Delete', kbd: 'Delete', fn: () => runCommand('edit.delete') },
          { sep: true },
          { label: 'Command Palette', kbd: 'Ctrl+Shift+P', fn: () => runCommand('palette') },
        ],
      },
      {
        label: 'Project', items: () => [
          { label: 'New Scene', fn: () => runCommand('project.newScene') },
          { label: 'Snapshots / Version History…', icon: 'history', fn: () => runCommand('project.snapshots') },
          { label: 'Refresh AI Memory', icon: 'brain', fn: () => runCommand('ai.memory') },
        ],
      },
      {
        label: 'Build', items: () => [
          { label: 'Build Game…', icon: 'hammer', fn: () => runCommand('build.game') },
          { label: 'Open Build Folder (path shown in Output)', fn: () => runCommand('build.openFolder') },
        ],
      },
      {
        label: 'Play', items: () => [
          { label: 'Play / Stop', kbd: 'Ctrl+P', fn: () => runCommand('play.toggle') },
          { label: 'Pause', kbd: 'Ctrl+Shift+P', fn: () => runCommand('play.pause') },
          { label: 'Restart', fn: () => runCommand('play.restart') },
          { sep: true },
          { label: 'Run Automated Playtest', icon: 'bug', fn: () => runCommand('play.test') },
        ],
      },
      {
        label: 'AI', items: () => [
          { label: 'Open AI Agent Panel', icon: 'brain', fn: () => runCommand('ai.open') },
          { label: 'Fix Latest Problem With AI', icon: 'bugfix', fn: () => runCommand('ai.fixProblem') },
          { sep: true },
          { label: 'AI Settings (Connect LLM)…', icon: 'settings', fn: () => showAISettingsDialog() },
        ],
      },
      {
        label: 'View', items: () => [
          { label: 'Focus Selection', kbd: 'F', fn: () => this.viewport?.focusSelection() },
          { label: 'Terrain Tools', icon: 'mountain', fn: () => this.toggleTerrainToolbar() },
          { sep: true },
          { label: 'Toggle Left Dock', fn: () => this.toggleZone('left') },
          { label: 'Toggle Right Dock', fn: () => this.toggleZone('right') },
          { label: 'Toggle Bottom Dock', fn: () => this.toggleZone('bottom') },
        ],
      },
    ];
    return menubar(menus, () => runCommand('project.close'));
  }

  private buildToolbar(): HTMLElement {
    const bar = h('div', { class: 'nx-toolbar' });
    const group = (...children: any[]) => h('div', { class: 'group' }, ...children);
    const tbtn = (id: string, iconName: string, title: string, fn: () => void, active = false) => {
      const b = h('button', { class: `nx-tbtn${active ? ' active' : ''}`, title, onclick: fn }, icon(iconName, 15));
      this.toolButtons.set(id, b);
      return b;
    };

    // transform tools
    const gizmoBtn = (mode: GizmoMode, iconName: string, title: string, kbd: string) =>
      tbtn(`gizmo-${mode}`, iconName, `${title} (${kbd})`, () => this.setGizmoMode(mode), mode === 'translate');
    bar.append(group(
      gizmoBtn('translate', 'move', 'Move', 'W'),
      gizmoBtn('rotate', 'rotate', 'Rotate', 'E'),
      gizmoBtn('scale', 'scale', 'Scale', 'R'),
      tbtn('snap', 'grid', 'Toggle grid snap', () => this.toggleSnap()),
    ));

    // play controls
    this.playBtn = tbtn('play', 'play', 'Play (Ctrl+P)', () => runCommand('play.toggle'));
    this.playBtn.classList.add('nx-play-btn', 'play');
    const pauseBtn = tbtn('pause', 'pause', 'Pause', () => runCommand('play.pause'));
    const stopBtn = tbtn('stop', 'stop', 'Stop', () => runCommand('play.toggle'));
    stopBtn.classList.add('nx-play-btn', 'stop');
    bar.append(group(this.playBtn, pauseBtn, stopBtn,
      tbtn('restart', 'restart', 'Restart play', () => runCommand('play.restart'))));

    // quick add
    bar.append(group(
      tbtn('add-cube', 'cube', 'Add cube', () => this.quickAdd('Cube')),
      tbtn('add-sphere', 'sphere', 'Add sphere', () => this.quickAdd('Sphere')),
      tbtn('add-light', 'light', 'Add point light', () => this.quickAdd('Light')),
      tbtn('terrain', 'mountain', 'Terrain tools', () => this.toggleTerrainToolbar()),
    ));

    // AI quick access
    bar.append(group(
      tbtn('ai', 'sparkle', 'AI Agent — ask anything', () => runCommand('ai.open')),
    ));

    // right side
    bar.append(h('div', { class: 'spacer' }));
    const nameEl = h('span', { class: 'project-name' }, 'No project');
    nameEl.id = 'tb-project-name';
    bar.append(nameEl, tbtn('build', 'hammer', 'Build Game', () => runCommand('build.game')));

    // second toolbar row (contextual — terrain tools)
    this.toolbarSecond = h('div', { class: 'nx-toolbar', style: { display: 'none' } });
    this.buildTerrainToolbar();
    const wrapper = h('div', { style: { display: 'flex', flexDirection: 'column' } }, bar, this.toolbarSecond);
    return wrapper as HTMLElement;
  }

  private buildTerrainToolbar() {
    const t = this.toolbarSecond!;
    clear(t);
    const tools: [TerrainTool, string, string][] = [
      ['none', 'cursor', 'Select / off'], ['raise', 'mountain', 'Raise'], ['lower', 'mountain', 'Lower'],
      ['smooth', 'water', 'Smooth'], ['flatten', 'hammer', 'Flatten'],
      ['paint0', 'layers', 'Paint Layer 1'], ['paint1', 'layers', 'Paint Layer 2'], ['paint2', 'layers', 'Paint Layer 3'],
    ];
    for (const [tool, iconName, label] of tools) {
      const b = h('button', {
        class: `nx-tbtn${this.viewport?.terrainTool === tool ? ' active' : ''}`,
        title: `Terrain: ${label}`,
        onclick: () => {
          if (!this.viewport) return;
          this.viewport.terrainTool = tool;
          this.buildTerrainToolbar();
          if (tool !== 'none') this.toast('info', `Terrain tool: ${label} — drag on terrain to sculpt. Shift = soft stroke.`);
        },
      }, icon(iconName, 14), ` ${label}`);
      t.append(b);
    }
    const radius = h('input', { type: 'range', min: 2, max: 40, value: 8, title: 'Brush radius', style: { width: '110px' } }) as HTMLInputElement;
    radius.oninput = () => { if (this.viewport) this.viewport.brushRadius = +radius.value; };
    const strength = h('input', { type: 'range', min: 5, max: 100, value: 50, title: 'Brush strength', style: { width: '110px' } }) as HTMLInputElement;
    strength.oninput = () => { if (this.viewport) this.viewport.brushStrength = +strength.value / 100; };
    t.append(h('div', { class: 'group' },
      h('span', { style: { color: 'var(--text-3)', fontSize: '10px' } }, 'Radius'), radius,
      h('span', { style: { color: 'var(--text-3)', fontSize: '10px' } }, 'Strength'), strength));
    t.append(h('div', { class: 'group' },
      h('button', {
        class: 'nx-tbtn', title: 'Generate island terrain on selected Terrain object',
        onclick: () => runCommand('terrain.island'),
      }, icon('water', 14), ' Generate Island')));
  }

  private toggleTerrainToolbar() {
    const t = this.toolbarSecond!;
    t.style.display = t.style.display === 'none' ? '' : 'none';
  }

  private buildStatusbar(): HTMLElement {
    const sb = h('div', { class: 'nx-statusbar' });
    const left = h('span', { id: 'sb-left' }, 'Ready');
    const mid = h('span', { id: 'sb-mid' }, '');
    const right = h('div', { class: 'right' },
      h('span', { id: 'sb-fps' }, '— FPS'),
      h('span', { id: 'sb-objects' }, '0 objects'),
      h('span', { id: 'sb-save' }, ''),
    );
    sb.append(left, h('span', { class: 'sep' }), mid, right);
    setInterval(() => {
      const fps = this.viewport?.fps ?? 0;
      const s = this.viewport?.statsOverlay;
      (sb.querySelector('#sb-fps') as HTMLElement).textContent = `${Math.round(fps)} FPS · ${s?.drawCalls ?? 0} draws`;
      (sb.querySelector('#sb-objects') as HTMLElement).textContent = `${s?.objects ?? 0} objects · ${(s?.triangles ?? 0).toLocaleString()} tris`;
      (sb.querySelector('#sb-save') as HTMLElement).textContent = store.dirty ? '● unsaved' : store.lastSavedAt ? `saved ${new Date(store.lastSavedAt).toLocaleTimeString()}` : '';
      this.updateStatusbar();
    }, 500);
    return sb;
  }

  private updateStatusbar() {
    const sb = this.statusbar!;
    (sb.querySelector('#sb-left') as HTMLElement).textContent = store.playing ? (store.paused ? '⏸ PAUSED (simulation halted)' : '▶ PLAYING') : 'Editing';
    const sel = store.selectedObject;
    (sb.querySelector('#sb-mid') as HTMLElement).textContent = sel ? `${sel.name} — ${sel.components.length} component(s)` : (store.scene?.name ?? '');
    const nameEl = document.querySelector('#tb-project-name');
    if (nameEl) nameEl.innerHTML = `${store.project?.name ?? 'No project'}${store.dirty ? '<span class="dirty-dot"></span>' : ''}`;
  }

  private updatePlayButtons() {
    if (!this.playBtn) return;
    const play = this.toolButtons.get('play')!;
    play.innerHTML = '';
    play.append(icon(store.playing ? 'stop' : 'play', 15));
    play.title = store.playing ? 'Stop (Ctrl+P)' : 'Play (Ctrl+P)';
    play.classList.toggle('active', store.playing);
    const vp = this.viewport;
    if (vp) (vp.host.querySelector('.playing-frame') as HTMLElement).style.display = store.playing ? 'block' : 'none';
    this.updateStatusbar();
  }

  // --------------------------------- home ------------------------------------

  showHome() {
    this.viewport?.dispose();
    this.viewport = null;
    if (this.layout) { this.layout = null; }
    clear(this.editorArea!);
    this.home = new HomeScreen(async () => {
      // new project flow
      showNewProjectDialog(() => this.openEditor());
    }, async (id) => {
      await store.openProject(id);
      this.openEditor();
    }, () => {
      showCreateWithAIDialog((idea) => {
        // create a project shell, then let the agent build the content
        const project = template3dGame('MyAIGame');
        project.template = 'ai';
        project.settings.targetPlatform = 'web';
        store.createProject(project).then(ok => {
          if (ok) { this.openEditor(); this.aiPanel?.agent.chat(idea); }
        });
      });
    });
    this.editorArea!.append(this.home.root);
  }

  openEditor() {
    if (!store.project) return;
    clear(this.editorArea!);
    this.home = null;
    refreshMemory('open');
    store.log('info', `Project "${store.project.name}" opened — template: ${store.project.template}, scenes: ${store.project.scenes.length}.`);

    // viewport
    const vpHost = h('div', { class: 'nx-viewport' });
    const vpOverlay = h('div', { class: 'vp-overlay' },
      h('span', { class: 'vp-badge' }, 'LMB orbit · RMB pan · wheel zoom'),
      h('span', { class: 'vp-badge' }, '<b>W/E/R</b> gizmo · <b>F</b> focus · <b>Ctrl+P</b> play'),
    );
    const dropOverlay = h('div', { class: 'drop-overlay' }, 'Drop asset here to place it in the scene');
    const playingFrame = h('div', { class: 'playing-frame', style: { display: 'none' } });
    vpHost.append(vpOverlay, dropOverlay, playingFrame);
    this.viewport = new Viewport(vpHost);
    this.viewport.onPlayToggle = () => this.updatePlayButtons();
    this.viewport.rebuildAll();

    // layout + panels
    this.layout = new DockLayout(this.editorArea!);
    vpHost.style.position = 'relative';
    this.layout.register({ id: 'viewport', title: '3D Viewport', icon: 'cube', factory: () => ({ root: vpHost }), defaultZone: 'center' });

    const hierarchy = new HierarchyPanel();
    this.layout.register({ id: 'hierarchy', title: 'Scene', icon: 'layers', factory: () => ({ root: hierarchy.root, toolbar: hierarchy.toolbar() }), defaultZone: 'left' });

    const inspector = new InspectorPanel();
    this.layout.register({ id: 'inspector', title: 'Inspector', icon: 'sliders', factory: () => ({ root: inspector.root }), defaultZone: 'right' });

    const assets = new AssetsPanel();
    this.layout.register({ id: 'assets', title: 'Assets', icon: 'folder', factory: () => ({ root: assets.root, toolbar: assets.toolbar() }), defaultZone: 'bottom' });

    const console_ = new ConsolePanel();
    this.layout.register({ id: 'console', title: 'Console', icon: 'terminal', factory: () => ({ root: console_.root, toolbar: console_.toolbar() }), defaultZone: 'bottom' });

    this.problemsPanel = new ProblemsPanel();
    this.layout.register({ id: 'problems', title: 'Problems', icon: 'bug', factory: () => ({ root: this.problemsPanel!.root }), defaultZone: 'bottom' });

    this.aiPanel = new AIPanel();
    this.layout.register({ id: 'ai', title: 'AI Agent', icon: 'brain', factory: () => ({ root: this.aiPanel!.root }), defaultZone: 'bottom' });

    this.output = new OutputPanel();
    this.layout.register({ id: 'output', title: 'Output', icon: 'file', factory: () => ({ root: this.output!.root }), defaultZone: 'bottomRight' });

    const profiler = new ProfilerPanel(() => this.viewport?.statsOverlay);
    this.layout.register({ id: 'profiler', title: 'Profiler', icon: 'gauge', factory: () => ({ root: profiler.root }), defaultZone: 'bottomRight' });

    const scriptEditor = new ScriptEditorPanel();
    this.layout.register({ id: 'scripts', title: 'Scripts', icon: 'code', factory: () => ({ root: scriptEditor.root, toolbar: scriptEditor.toolbar() }), defaultZone: 'center' });

    const vsEditor = new VisualScriptPanel();
    this.layout.register({ id: 'visualscript', title: 'Visual Script', icon: 'flow', factory: () => ({ root: vsEditor.root, toolbar: vsEditor.toolbar() }), defaultZone: 'center' });

    // default visible tabs
    this.layout.show('viewport');
    this.layout.show('hierarchy');
    this.layout.show('inspector');
    this.layout.show('assets');
    this.layout.show('console');

    // agent context
    initAgent({
      runGame: () => this.play(),
      stopGame: () => this.stop(),
      runPlaytest: async (seconds = 4) => this.runPlaytest(seconds),
      buildProject: async (mode = 'Release') => this.build(mode),
      focusObject: (id) => { store.select([id]); this.viewport?.focusSelection(); },
      openScript: (scriptId, line) => editorBus.emit('scriptOpened', { scriptId, line }),
    });
    this.problemsPanel.onFixWithAi = (p) => this.fixProblemWithAI(p);
    this.updatePlayButtons();
    this.updateStatusbar();
    window.dispatchEvent(new Event('resize'));
  }

  // ------------------------------ interactions -------------------------------

  private setGizmoMode(mode: GizmoMode) {
    this.viewport?.setGizmoMode(mode);
    for (const m of ['translate', 'rotate', 'scale']) {
      this.toolButtons.get(`gizmo-${m}`)?.classList.toggle('active', m === mode);
    }
  }

  private toggleSnap() {
    if (!this.viewport) return;
    this.viewport.snapEnabled = !this.viewport.snapEnabled;
    this.viewport.gizmo.setTranslationSnap(this.viewport.snapEnabled ? 0.5 : null);
    this.viewport.gizmo.setRotationSnap(this.viewport.snapEnabled ? (15 * Math.PI / 180) : null);
    this.viewport.gizmo.setScaleSnap(this.viewport.snapEnabled ? 0.25 : null);
    this.toolButtons.get('snap')?.classList.toggle('active', this.viewport.snapEnabled);
  }

  private toggleZone(zone: 'left' | 'right' | 'bottom') {
    if (!this.layout) return;
    const z = (this.layout.zones as any)[zone] as { el: HTMLElement } | undefined;
    if (z) z.el.style.display = z.el.style.display === 'none' ? '' : 'none';
    window.dispatchEvent(new Event('resize'));
  }

  private quickAdd(kind: string) {
    if (!store.project || !store.scene) return;
    import('@engine/core/ops').then(({ addGameObject, addComponent }) => {
      store.pushUndo(`Add ${kind}`);
      const go = addGameObject(store.project!, store.sceneId!, kind, {
        transform: { position: { x: 0, y: kind === 'Light' ? 3 : 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      });
      addComponent(store.project!, store.sceneId!, go.id, kind === 'Light' ? 'Light' : 'MeshRenderer', { mesh: kind });
      store.markDirty();
      editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
      store.select([go.id]);
    });
  }

  // -------------------------------- play mode --------------------------------

  play(sceneId?: string) {
    if (!store.project) return;
    if (store.playing) { this.stop(); return; }
    if (store.dirty) store.save();
    this.viewport?.enterPlayMode(sceneId);
  }
  stop() { this.viewport?.stopPlayMode(); }
  pause() { this.viewport?.pausePlayMode(); }
  async restart() {
    if (!store.playing) return;
    this.viewport?.stopPlayMode();
    await new Promise(r => setTimeout(r, 150));
    this.viewport?.enterPlayMode();
  }

  /** Automated playtest — real simulation with scripted input & assertions. */
  async runPlaytest(seconds = 4): Promise<any> {
    if (!store.project) return null;
    this.toast('info', `Running automated playtest (${seconds}s)…`);
    // play quickly, run harness, stop
    await this.viewport?.enterPlayMode();
    const runtime = this.viewport?.runtime;
    if (!runtime) return null;
    const report = await runtime.runPlaytest({
      seconds,
      inputScript: (t, input) => {
        // walk forward, jump every second
        input.down.add('KeyW');
        if (Math.floor(t) % 2 === 0 && t % 1 < 0.3) { input.pressed.add('Space'); }
      },
      assertions: [
        { name: 'Player exists and is simulated', check: (engine) => !!engine.player },
        { name: 'No script errors', check: () => this.viewport!.runtime!.problems.length === 0 },
      ],
    });
    this.stop();
    const okTxt = report.passed ? '✓ PASSED' : '✗ FAILED';
    store.log(report.passed ? 'info' : 'error', `Playtest ${okTxt} — ${report.framesSimulated} frames, errors: ${report.errors.length}, failures: ${report.failures.join(', ') || 'none'}`);
    this.toast(report.passed ? 'success' : 'error', `Playtest ${okTxt} (${report.framesSimulated} frames)`);
    return report;
  }

  // ------------------------------ AI debugger ---------------------------------

  fixProblemWithAI(problem?: any) {
    const p = problem ?? store.problems[0];
    if (!p) {
      this.toast('warning', 'No problems to fix — run the game first.');
      return;
    }
    if (!this.aiPanel) return;
    const emit = (e: any) => (this.aiPanel as any).onEvent(e);
    // reuse agent's debug handler through chat for consistent UX
    this.aiPanel.agent.chat(p.scriptId ? `Fix this error: ${p.file} line ${p.line}: ${p.message}` : `Debug: ${p.message}`);
  }

  // --------------------------------- build -----------------------------------

  async build(mode = 'Release'): Promise<{ ok: boolean }> {
    if (!store.project) return { ok: false };
    showBuildDialog(async (m) => this.runBuild(m));
    return { ok: true };
  }

  private async runBuild(mode: string): Promise<{ ok: boolean }> {
    const p = store.project!;
    await store.save();
    this.output?.clear();
    this.layout?.show('output');
    const out = this.output!;
    out.log(`──── NEXUS BUILD: ${p.name} [${mode}] ────`);
    out.log('[1/8] Validating project…');
    const { validateProject } = await import('@engine/core/ops');
    const issues = validateProject(p);
    const errors = issues.filter(i => i.severity === 'error');
    for (const i of issues) out.log(`  ${i.severity === 'error' ? '[ERROR]' : '[WARN]'} ${i.message}`);
    if (errors.length) {
      out.log('BUILD FAILED — validation errors above. Ask the AI Agent to fix them ("fix errors").');
      this.toast('error', `Build failed: ${errors.length} validation error(s)`);
      return { ok: false };
    }
    out.log('  [OK] project valid');
    try {
      const res = await fetch('/api/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: p.id, config: { mode, name: p.name.replace(/\s+/g, '') } }),
      });
      const j = await res.json();
      for (const line of j.log ?? []) out.log(line);
      if (j.ok) {
        this.toast('success', `Build complete: ${j.outputPath}`);
        out.log(`──── BUILD COMPLETE ────`);
        out.log(`Play it: ${j.htmlPath}`);
        out.log(`Windows EXE: run ${j.exeScriptPath} on the target machine (requires Node.js)`);
      } else {
        this.toast('error', `Build failed: ${j.error}`);
        out.log(`──── BUILD FAILED ──── ${j.error}`);
      }
      return j;
    } catch (e: any) {
      out.log(`[ERROR] Build request failed: ${e?.message ?? e}`);
      this.toast('error', 'Build failed — see Output panel');
      return { ok: false };
    }
  }

  // -------------------------------- commands ----------------------------------

  private registerCommands() {
    const c = command;
    c({ id: 'palette', label: 'Command Palette', category: 'General', kbd: 'Ctrl+Shift+P', run: () => palette.open() });
    c({ id: 'project.new', label: 'New Project…', category: 'Project', run: () => showNewProjectDialog(() => this.openEditor()) });
    c({ id: 'project.createAI', label: 'Create With AI…', category: 'Project', run: () => showCreateWithAIDialog((idea) => {
      const project = template3dGame('MyAIGame');
      project.template = 'ai';
      store.createProject(project).then(ok => { if (ok) { this.openEditor(); this.aiPanel?.agent.chat(idea); } });
    }) });
    c({ id: 'project.save', label: 'Save Project', category: 'Project', kbd: 'Ctrl+S', run: () => store.save() });
    c({ id: 'project.close', label: 'Close Project (Back to Home)', category: 'Project', run: () => { if (store.dirty && !confirm('Save changes first?')) { /* skip */ } else if (store.dirty) store.save(); store.setProject(null); this.showHome(); } });
    c({ id: 'project.newScene', label: 'New Scene', category: 'Project', run: async () => {
      if (!store.project) return;
      const { addScene } = await import('@engine/core/ops');
      store.pushUndo('New scene');
      const s = addScene(store.project, prompt('Scene name', 'Scene' + (store.project.scenes.length + 1)) ?? 'NewScene');
      store.markDirty();
      store.sceneId = s.id;
      editorBus.emit('sceneSwitched', { sceneId: s.id });
    } });
    c({ id: 'project.snapshots', label: 'Snapshots / Version History', category: 'Project', run: () => showSnapshotsDialog() });
    c({ id: 'edit.undo', label: 'Undo', category: 'Edit', kbd: 'Ctrl+Z', run: () => { const l = store.undo(); if (l) this.toast('info', `Undid: ${l}`); } });
    c({ id: 'edit.redo', label: 'Redo', category: 'Edit', kbd: 'Ctrl+Y', run: () => { const l = store.redo(); if (l) this.toast('info', `Redid: ${l}`); } });
    c({ id: 'edit.duplicate', label: 'Duplicate Selection', category: 'Edit', kbd: 'Ctrl+D', run: async () => {
      if (!store.scene || !store.project || !store.selection.length) return;
      const { duplicateGameObject } = await import('@engine/core/ops');
      store.pushUndo('Duplicate');
      const clones = store.selection.map(id => duplicateGameObject(store.project!, store.scene!.id, id)).filter(Boolean);
      store.markDirty();
      editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
      if (clones[0]) store.select([clones[0].id]);
    } });
    c({ id: 'edit.delete', label: 'Delete Selection', category: 'Edit', kbd: 'Delete', run: () => this.viewport?.deleteSelection(), when: () => !!store.selection.length && !store.playing });
    c({ id: 'play.toggle', label: 'Play / Stop', category: 'Play', kbd: 'Ctrl+P', run: () => this.play() });
    c({ id: 'play.pause', label: 'Pause / Resume', category: 'Play', run: () => this.pause() });
    c({ id: 'play.restart', label: 'Restart Play', category: 'Play', run: () => this.restart() });
    c({ id: 'play.test', label: 'Run Automated Playtest', category: 'Play', run: () => this.runPlaytest(4) });
    c({ id: 'build.game', label: 'Build Game…', category: 'Build', run: () => this.build() });
    c({ id: 'build.openFolder', label: 'Show Build Output Path', category: 'Build', run: () => this.layout?.show('output') });
    c({ id: 'ai.open', label: 'Open AI Agent', category: 'AI', run: () => this.layout?.show('ai') });
    c({ id: 'ai.fixProblem', label: 'Fix Latest Problem With AI', category: 'AI', run: () => this.fixProblemWithAI() });
    c({ id: 'ai.memory', label: 'Refresh AI Project Memory', category: 'AI', run: () => { refreshMemory('manual'); this.toast('success', 'AI memory refreshed'); } });
    c({ id: 'ai.settings', label: 'AI Settings (Connect LLM)', category: 'AI', run: () => showAISettingsDialog() });
    c({ id: 'terrain.island', label: 'Generate Island Terrain', category: 'Terrain', run: async () => {
      if (!store.project || !store.scene) return;
      const { addGameObject, addComponent } = await import('@engine/core/ops');
      const { generateIsland, encodeFloats, encodeBytes } = await import('@engine/terrain/terrain');
      store.pushUndo('Generate island');
      let terrain = store.scene.objects.find(o => o.components.some(cmp => cmp.type === 'Terrain'));
      if (!terrain) {
        terrain = addGameObject(store.project, store.sceneId, 'Terrain');
        addComponent(store.project, store.sceneId, terrain.id, 'Terrain', { size: 260, segments: 112 });
      }
      const comp: any = terrain.components.find(cmp => cmp.type === 'Terrain');
      const island = generateIsland({ size: comp.size, segments: comp.segments, maxHeight: 18, seed: Math.floor(Math.random() * 9999) });
      comp.heights = encodeFloats(island.heights);
      comp.colors = encodeBytes(island.colors);
      store.markDirty();
      editorBus.emit('sceneChanged', { sceneId: store.sceneId!, structural: true });
      this.toast('success', 'Island terrain generated');
    } });
    c({ id: 'prefab.fromSelection', label: 'Create Prefab From Selection', category: 'Project', run: () => { if (store.selection[0]) createPrefabFromSelection(store.selection[0]); } });
  }

  toast(kind: 'info' | 'success' | 'warning' | 'error', text: string) {
    const wrap = document.querySelector('.nx-toast-wrap');
    if (!wrap) return;
    const t = h('div', { class: `nx-toast ${kind}` }, text);
    wrap.append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4200);
  }
}
