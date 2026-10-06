// ============================================================================
// NEXUS ENGINE — Input system (keyboard, mouse, pointer lock)
// ============================================================================
export class InputSystem {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouse = { dx: 0, dy: 0, x: 0, y: 0, buttons: 0, wheel: 0, locked: false };
  private clickRequested = false;
  private interactRequested = false;
  enabled = true;
  private handlers: Array<[string, any, any]> = [];
  private target: HTMLElement | Window;

  constructor(target: HTMLElement | Window = window) {
    this.target = target;
    const add = (el: any, ev: string, fn: any, opts?: any) => {
      el.addEventListener(ev, fn, opts);
      this.handlers.push([ev, fn, el]);
    };
    add(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    add(window, 'keyup', (e: KeyboardEvent) => { this.down.delete(e.code); this.released.add(e.code); });
    add(window, 'blur', () => { this.down.clear(); });
    add(target as any, 'mousedown', (e: MouseEvent) => { if (this.enabled) { this.mouse.buttons |= (1 << e.button); if (e.button === 0) this.clickRequested = true; } });
    add(window, 'mouseup', (e: MouseEvent) => { this.mouse.buttons &= ~(1 << e.button); });
    add(window, 'mousemove', (e: MouseEvent) => {
      if (!this.enabled) return;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    add(window, 'wheel', (e: WheelEvent) => { if (this.enabled) this.mouse.wheel += e.deltaY; }, { passive: true });
    add(document, 'pointerlockchange', () => { this.mouse.locked = !!document.pointerLockElement; });
    add(window, 'beforeunload', () => this.dispose());
  }

  isKeyDown(code: string) { return this.enabled && this.down.has(code); }
  wasPressed(code: string) { return this.enabled && this.pressed.has(code); }
  wasReleased(code: string) { return this.enabled && this.released.has(code); }
  wasClicked() { return this.enabled && this.clickRequested; }
  consumeClick() { const c = this.clickRequested; this.clickRequested = false; return c; }
  requestInteract() { this.interactRequested = true; }
  consumeInteract() { const i = this.interactRequested; this.interactRequested = false; return i; }

  /** Combination helpers used by controllers. */
  get moveVector(): { x: number; z: number } {
    let x = 0, z = 0;
    if (this.isKeyDown('KeyW') || this.isKeyDown('ArrowUp')) z -= 1;
    if (this.isKeyDown('KeyS') || this.isKeyDown('ArrowDown')) z += 1;
    if (this.isKeyDown('KeyA') || this.isKeyDown('ArrowLeft')) x -= 1;
    if (this.isKeyDown('KeyD') || this.isKeyDown('ArrowRight')) x += 1;
    return { x, z };
  }
  get sprintDown() { return this.isKeyDown('ShiftLeft') || this.isKeyDown('ShiftRight'); }
  get crouchDown() { return this.isKeyDown('ControlLeft') || this.isKeyDown('KeyC'); }
  get jumpPressed() { return this.wasPressed('Space'); }
  get interactPressed() { return this.wasPressed('KeyE') || this.consumeInteract(); }

  async requestPointerLock(el: HTMLElement) {
    try { await (el as any).requestPointerLock?.(); } catch { /* ignore */ }
  }
  exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Called by the runtime at end of frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.clickRequested = false;
  }

  dispose() {
    for (const [ev, fn, el] of this.handlers) el.removeEventListener(ev, fn);
    this.handlers = [];
    this.exitPointerLock();
  }
}
