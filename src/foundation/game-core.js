// Scalable browser equivalent of the project-level GameInstance/GameState boundary.
// Systems communicate through this small coordinator instead of reaching into Race.
export class GameProjectCore {
  constructor({ save, persist, getRuntime }) {
    this.save = save;
    this.persist = persist;
    this.getRuntime = getRuntime;
    this.state = 'boot';
    this.events = new EventTarget();
    this.settings = {
      graphicsQuality: 'auto',
      fullscreen: false,
      vsync: true,
      mouseSensitivity: 1,
      cameraSensitivity: 1,
      masterVolume: 1,
      ...(save.foundation?.settings || {}),
    };
    this.saveState = { version: 1, ...(save.foundation?.state || {}) };
    this._sync();
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.events.dispatchEvent(new CustomEvent('statechange', { detail: state }));
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this._sync();
    this.events.dispatchEvent(new CustomEvent('settingschange', { detail: this.settings }));
  }

  markDirty() { this._sync(); this.persist(this.save); }

  _sync() {
    this.save.foundation = { version: 1, settings: { ...this.settings }, state: { ...this.saveState } };
  }
}

export function createProjectLog(name, color = '#82d7ff') {
  return (...args) => {
    if (!globalThis.NEURIO?.debug?.enabled) return;
    console.info(`%c[${name}]`, `color:${color};font-weight:bold`, ...args);
  };
}

export const LogGameCore = createProjectLog('GameCore');
export const LogWorld = createProjectLog('World', '#8be28b');
export const LogVoxel = createProjectLog('Voxel', '#e3bf73');
export const LogInteraction = createProjectLog('Interaction', '#f2a4e8');
export const LogSave = createProjectLog('Save', '#c5b5ff');
