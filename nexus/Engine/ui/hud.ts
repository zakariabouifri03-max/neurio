// ============================================================================
// NEXUS ENGINE — In-game UI system
// UI documents (panels / text / images / buttons / progress bars) rendered as
// a DOM overlay during Play Mode, with live bindings to gameplay values and
// built-in templates (health bar, stamina, crosshair, inventory, menus...).
// ============================================================================
import type { UiDocumentData, UiElementData } from '../core/types';
import { uid } from '../core/types';

export class HudSystem {
  host: HTMLElement;
  private docs = new Map<string, UiDocumentData>();
  private roots = new Map<string, HTMLDivElement>();
  private elements = new Map<string, HTMLElement>();
  engine: any;
  private messageEl: HTMLElement | null = null;
  private messageTimer: any = null;
  private menuStack: string[] = [];

  constructor(host: HTMLElement, engine: any) {
    this.host = host;
    this.engine = engine;
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:inherit;';
  }

  registerDocuments(docs: UiDocumentData[]) {
    for (const d of docs) this.docs.set(d.id, d);
  }

  buildAll() {
    for (const d of this.docs.values()) this.buildDoc(d);
  }

  private buildDoc(d: UiDocumentData) {
    const root = document.createElement('div');
    root.dataset.uiDoc = d.name;
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.roots.set(d.id, root);
    this.host.appendChild(root);
    for (const el of d.elements) this.buildElement(el, root, d);
    root.style.display = (d.mode === 'menu') ? 'none' : (d.visibleInPlay ? '' : 'none');
    if (d.mode === 'overlay' && d.visibleInPlay) root.style.display = '';
  }

  private buildElement(el: UiElementData, parent: HTMLElement, doc: UiDocumentData) {
    const node = document.createElement('div');
    node.dataset.elId = el.id;
    const pos = (v: number | string) => typeof v === 'number' ? `${v}px` : v;
    const anchor = el.anchor ?? 'top-left';
    node.style.cssText = `position:absolute;box-sizing:border-box;`;
    if (anchor === 'center') {
      node.style.left = `calc(50% + ${pos(el.x)})`; node.style.top = `calc(50% + ${pos(el.y)})`;
      node.style.transform = 'translate(-50%,-50%)';
    } else if (anchor === 'bottom-left') { node.style.left = pos(el.x); node.style.bottom = pos(el.y); }
    else if (anchor === 'bottom-right') { node.style.right = pos(el.x); node.style.bottom = pos(el.y); }
    else if (anchor === 'top-right') { node.style.right = pos(el.x); node.style.top = pos(el.y); }
    else { node.style.left = pos(el.x); node.style.top = pos(el.y); }
    node.style.width = pos(el.width); node.style.height = pos(el.height);

    switch (el.type) {
      case 'panel':
        node.style.background = el.background ?? 'rgba(10,14,20,0.72)';
        node.style.border = '1px solid rgba(120,200,220,0.25)';
        node.style.borderRadius = '6px';
        break;
      case 'text':
        node.style.color = el.color ?? '#e8edf4';
        node.style.fontSize = `${el.fontSize ?? 14}px`;
        node.style.display = 'flex';
        node.style.alignItems = 'center';
        node.style.justifyContent = el.anchor === 'center' ? 'center' : 'flex-start';
        node.style.textShadow = '0 1px 3px rgba(0,0,0,0.8)';
        node.style.whiteSpace = 'pre-wrap';
        node.textContent = el.text ?? '';
        break;
      case 'image': {
        const img = document.createElement('img');
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        img.src = el.image ?? '';
        img.draggable = false;
        node.appendChild(img);
        break;
      }
      case 'button': {
        node.style.background = el.background ?? 'rgba(28,42,58,0.9)';
        node.style.border = '1px solid rgba(120,200,220,0.45)';
        node.style.borderRadius = '5px';
        node.style.color = el.color ?? '#dff3ff';
        node.style.fontSize = `${el.fontSize ?? 14}px`;
        node.style.display = 'flex'; node.style.alignItems = 'center'; node.style.justifyContent = 'center';
        node.style.cursor = 'pointer';
        node.style.pointerEvents = 'auto';
        node.textContent = el.text ?? '';
        node.onmouseenter = () => node.style.background = 'rgba(46,80,110,0.95)';
        node.onmouseleave = () => node.style.background = el.background ?? 'rgba(28,42,58,0.9)';
        node.onclick = (e) => { e.stopPropagation(); this.handleAction(el.action ?? '', doc); };
        break;
      }
      case 'progressbar': {
        node.style.background = 'rgba(8,12,18,0.75)';
        node.style.border = '1px solid rgba(140,160,180,0.4)';
        node.style.borderRadius = '4px';
        node.style.overflow = 'hidden';
        const fill = document.createElement('div');
        fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${(el.fill ?? 1) * 100}%;background:${el.fillColor ?? '#3fbf7f'};transition:width .15s;`;
        node.appendChild(fill);
        (node as any).__fill = fill;
        break;
      }
    }
    parent.appendChild(node);
    this.elements.set(el.id, node);
    for (const c of el.children ?? []) this.buildElement(c, node, doc);
  }

  private handleAction(action: string, doc: UiDocumentData) {
    const engine = this.engine;
    switch (action) {
      case 'start': this.hideMenu(doc.id); engine.events.emit('gameStart', {}); break;
      case 'continue': this.hideMenu(doc.id); engine.events.emit('gameContinue', {}); break;
      case 'resume': this.hideAllMenus(); engine.ui?.setPaused?.(false); break;
      case 'pause': engine.ui?.setPaused?.(true); break;
      case 'save': engine.saveSystem?.saveNow?.(); break;
      case 'restart': engine.events.emit('requestRestart', {}); break;
      case 'quit': engine.events.emit('requestQuit', {}); break;
      case 'toggleInventory': this.toggle('Inventory'); break;
      case 'close': this.hide(doc.name); break;
      default: engine.events.emit(`ui:${action}`, { doc: doc.id });
    }
  }

  show(name: string) {
    const d = [...this.docs.values()].find(x => x.name === name);
    if (!d) return;
    const root = this.roots.get(d.id);
    if (!root) return;
    root.style.display = '';
    if (d.mode === 'menu') { this.menuStack.push(d.id); root.style.pointerEvents = 'auto'; this.engine?.ui?.setPaused?.(true); }
  }
  hide(name: string) {
    const d = [...this.docs.values()].find(x => x.name === name);
    if (!d) return;
    this.hideMenu(d.id);
  }
  toggle(name: string) {
    const d = [...this.docs.values()].find(x => x.name === name);
    if (!d) return;
    const root = this.roots.get(d.id);
    if (!root) return;
    if (root.style.display === 'none') this.show(name); else this.hideMenu(d.id);
  }
  private hideMenu(id: string) {
    const root = this.roots.get(id);
    if (root) { root.style.display = 'none'; root.style.pointerEvents = 'none'; }
    this.menuStack = this.menuStack.filter(x => x !== id);
    if (this.menuStack.length === 0) this.engine?.ui?.setPaused?.(false);
  }
  hideAllMenus() {
    for (const id of [...this.menuStack]) this.hideMenu(id);
  }
  get hasMenuOpen() { return this.menuStack.length > 0; }

  setText(elId: string, text: string) {
    const el = this.elements.get(elId);
    if (el) el.textContent = text;
  }
  setFill(elId: string, f: number) {
    const el = this.elements.get(elId) as any;
    if (el?.__fill) el.__fill.style.width = `${Math.max(0, Math.min(1, f)) * 100}%`;
  }

  showMessage(text: string, seconds = 3) {
    if (!this.messageEl) {
      this.messageEl = document.createElement('div');
      this.messageEl.style.cssText = 'position:absolute;left:50%;top:14%;transform:translateX(-50%);background:rgba(10,16,24,0.82);border:1px solid rgba(120,200,220,0.35);color:#e8f4ff;padding:10px 22px;border-radius:6px;font-size:15px;pointer-events:none;transition:opacity .3s;';
      this.host.appendChild(this.messageEl);
    }
    this.messageEl.textContent = text;
    this.messageEl.style.opacity = '1';
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => { if (this.messageEl) this.messageEl.style.opacity = '0'; }, seconds * 1000);
  }

  /** Per-frame binding updates from the engine blackboard. */
  updateBindings(blackboard: any) {
    for (const d of this.docs.values()) {
      const root = this.roots.get(d.id);
      if (!root || root.style.display === 'none') continue;
      this.updateElementBindings(d.elements, blackboard);
    }
  }

  private updateElementBindings(elements: UiElementData[], bb: any) {
    for (const el of elements) {
      const node = this.elements.get(el.id) as any;
      if (!node) continue;
      if (el.binding) {
        const value = resolvePath(bb, el.binding);
        if (el.type === 'progressbar') {
          const max = el.bindingMax ? resolvePath(bb, el.bindingMax) ?? 100 : 100;
          if (typeof value === 'number') node.__fill && (node.__fill.style.width = `${Math.max(0, Math.min(1, value / max)) * 100}%`);
        } else if (value !== undefined && value !== null && node.textContent !== String(value)) {
          node.textContent = String(value);
        }
      }
      if (el.children) this.updateElementBindings(el.children, bb);
    }
  }

  dispose() {
    this.host.innerHTML = '';
    this.roots.clear();
    this.elements.clear();
    this.docs.clear();
  }
}

function resolvePath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// ============================================================================
// UI templates — used by the editor's "Create UI" and by game templates.
// ============================================================================

export function templateHealthBar(): UiDocumentData {
  return {
    id: uid('ui_'), name: 'HUD', mode: 'overlay', visibleInPlay: true,
    elements: [
      { id: uid('e_'), type: 'panel', x: 16, y: 16, width: 260, height: 54, background: 'rgba(8,12,18,0.6)' },
      { id: uid('e_'), type: 'progressbar', x: 10, y: 8, width: 240, height: 16, fillColor: '#e2564b', binding: 'player.health', bindingMax: 'player.maxHealth' },
      { id: uid('e_'), type: 'progressbar', x: 10, y: 30, width: 240, height: 10, fillColor: '#3fbf9f', binding: 'player.stamina', bindingMax: 'player.maxStamina' },
      { id: uid('e_'), type: 'text', x: 10, y: 42, width: 240, height: 10, fontSize: 10, color: '#9fb2c8', binding: 'game.clock' },
    ],
  };
}

export function templateCrosshair(): UiDocumentData {
  return {
    id: uid('ui_'), name: 'Crosshair', mode: 'overlay', visibleInPlay: true,
    elements: [
      { id: uid('e_'), type: 'panel', x: -9, y: -9, width: 18, height: 2, anchor: 'center', background: '#dff3ff' },
      { id: uid('e_'), type: 'panel', x: -1, y: -1, width: 2, height: 18, anchor: 'center', background: '#dff3ff' },
    ],
  };
}

export function templateInventory(): UiDocumentData {
  return {
    id: uid('ui_'), name: 'Inventory', mode: 'overlay', visibleInPlay: false,
    elements: [
      { id: uid('e_'), type: 'panel', x: '20%', y: '18%', width: '60%', height: '64%', background: 'rgba(10,15,22,0.88)' },
      { id: uid('e_'), type: 'text', x: 24, y: 16, width: 300, height: 30, text: 'INVENTORY', fontSize: 18, color: '#9fe8ff' },
      { id: uid('e_'), type: 'text', x: 24, y: 56, width: '90%', height: '70%', fontSize: 15, color: '#e8edf4', binding: 'inventory.text' },
      { id: uid('e_'), type: 'button', x: 'calc(100% - 120px)', y: 16, width: 90, height: 28, text: 'Close', action: 'close' },
    ],
  };
}

export function templateMainMenu(gameName: string): UiDocumentData {
  return {
    id: uid('ui_'), name: 'MainMenu', mode: 'menu', visibleInPlay: true,
    elements: [
      { id: uid('e_'), type: 'panel', x: 0, y: 0, width: '100%', height: '100%', background: 'linear-gradient(160deg, rgba(8,12,20,0.92), rgba(14,24,38,0.85))' },
      { id: uid('e_'), type: 'text', x: 0, y: '22%', width: '100%', height: 60, anchor: 'top-left', text: gameName.toUpperCase(), fontSize: 44, color: '#9fe8ff' },
      { id: uid('e_'), type: 'text', x: 0, y: '30%', width: '100%', height: 24, text: 'A NEXUS GAME STUDIO GAME', fontSize: 12, color: '#6d7f94' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: '44%', width: 180, height: 40, text: 'New Game', action: 'start' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(44% + 52px)', width: 180, height: 40, text: 'Continue', action: 'continue' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(44% + 104px)', width: 180, height: 40, text: 'Quit', action: 'quit' },
    ],
  };
}

export function templatePauseMenu(): UiDocumentData {
  return {
    id: uid('ui_'), name: 'PauseMenu', mode: 'menu', visibleInPlay: false,
    elements: [
      { id: uid('e_'), type: 'panel', x: 0, y: 0, width: '100%', height: '100%', background: 'rgba(6,9,14,0.7)' },
      { id: uid('e_'), type: 'text', x: 0, y: '26%', width: '100%', height: 50, text: 'PAUSED', fontSize: 34, color: '#9fe8ff' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: '42%', width: 180, height: 38, text: 'Resume', action: 'resume' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(42% + 50px)', width: 180, height: 38, text: 'Save Game', action: 'save' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(42% + 100px)', width: 180, height: 38, text: 'Restart', action: 'restart' },
      { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(42% + 150px)', width: 180, height: 38, text: 'Quit To Menu', action: 'quit' },
    ],
  };
}

export function templateEndScreens(): UiDocumentData[] {
  return [
    {
      id: uid('ui_'), name: 'Win', mode: 'menu', visibleInPlay: false,
      elements: [
        { id: uid('e_'), type: 'panel', x: 0, y: 0, width: '100%', height: '100%', background: 'rgba(8,18,12,0.82)' },
        { id: uid('e_'), type: 'text', x: 0, y: '34%', width: '100%', height: 60, text: 'YOU WIN', fontSize: 46, color: '#7fe8a4' },
        { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: '52%', width: 180, height: 40, text: 'Play Again', action: 'restart' },
        { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(52% + 52px)', width: 180, height: 40, text: 'Main Menu', action: 'quit' },
      ],
    },
    {
      id: uid('ui_'), name: 'Lose', mode: 'menu', visibleInPlay: false,
      elements: [
        { id: uid('e_'), type: 'panel', x: 0, y: 0, width: '100%', height: '100%', background: 'rgba(24,8,8,0.82)' },
        { id: uid('e_'), type: 'text', x: 0, y: '34%', width: '100%', height: 60, text: 'YOU DIED', fontSize: 46, color: '#e87f7f' },
        { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: '52%', width: 180, height: 40, text: 'Respawn', action: 'restart' },
        { id: uid('e_'), type: 'button', x: 'calc(50% - 90px)', y: 'calc(52% + 52px)', width: 180, height: 40, text: 'Main Menu', action: 'quit' },
      ],
    },
  ];
}

export function templateCrafting(): UiDocumentData {
  return {
    id: uid('ui_'), name: 'Crafting', mode: 'overlay', visibleInPlay: false,
    elements: [
      { id: uid('e_'), type: 'panel', x: '15%', y: '16%', width: '70%', height: '68%', background: 'rgba(10,15,22,0.9)' },
      { id: uid('e_'), type: 'text', x: 24, y: 16, width: 300, height: 30, text: 'CRAFTING', fontSize: 18, color: '#9fe8ff' },
      { id: uid('e_'), type: 'text', x: 24, y: 56, width: '90%', height: '72%', fontSize: 14, color: '#dfe8f2', binding: 'crafting.text' },
      { id: uid('e_'), type: 'text', x: 24, y: 'calc(100% - 44px)', width: '90%', height: 24, fontSize: 11, color: '#8ea2b8', binding: 'crafting.hint' },
      { id: uid('e_'), type: 'button', x: 'calc(100% - 120px)', y: 16, width: 90, height: 28, text: 'Close', action: 'close' },
    ],
  };
}

export function templateInteractPrompt(): UiElementData {
  return { id: uid('e_'), type: 'text', x: '50%', y: '62%', width: 300, height: 24, anchor: 'center', text: '', fontSize: 14, color: '#ffe9a8', binding: 'game.interactPrompt' };
}
