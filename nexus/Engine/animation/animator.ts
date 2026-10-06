// ============================================================================
// NEXUS ENGINE — Animation state machine for imported model clips
// Auto-maps clips by name (idle/walk/run/jump/attack), crossfades between
// states, exposes setLocomotion() for controllers & NPCs.
// ============================================================================
import * as THREE from 'three';
import { RuntimeComponent } from '../runtime/object';
import { getComponentDef } from '../core/registry';
import { clamp } from '../core/math';

const NAME_ALIASES: Record<string, string[]> = {
  Idle: ['idle', 'stand', 'breathing'],
  Walk: ['walk', 'walking', 'move'],
  Run: ['run', 'running', 'sprint', 'jog'],
  Jump: ['jump', 'jumping', 'air'],
  Attack: ['attack', 'hit', 'punch', 'swing', 'shoot'],
  Death: ['death', 'die', 'dead'],
};

export class AnimatorCmp extends RuntimeComponent {
  static register() { getComponentDef('Animator')!.runtime = AnimatorCmp; }
  mixer: THREE.AnimationMixer | null = null;
  actions = new Map<string, THREE.AnimationAction>();
  current: string | null = null;
  private modelAssetId: string | null = null;
  private lastLocomotionSet = '';

  async onStart() {
    await this.setup();
  }

  async setup() {
    const meshSlot = this.gameObject.slots.mesh as THREE.Object3D | undefined;
    const modelAssetId = (this.gameObject.getComponentData('MeshRenderer') as any)?.modelAsset
      ?? (this.gameObject.getComponentData('MeshRenderer') as any)?.asset;
    if (!meshSlot || !modelAssetId) {
      // try again when the async model loads
      setTimeout(() => { if (!this.destroyed && !this.mixer) this.setup(); }, 500);
      return;
    }
    const resolver = (this.engine as any).resolver;
    const src = await resolver?.modelSource?.(modelAssetId);
    const clips: THREE.AnimationClip[] = src?.userData?.animations ?? [];
    if (!clips.length || !meshSlot) return;
    this.mixer = new THREE.AnimationMixer(meshSlot);
    const states = (this.data as any).states ?? [];
    for (const st of states) {
      const clip = this.findClip(clips, st.clip) ?? this.findClip(clips, st.name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.setLoop(st.loop !== false ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = true;
      action.setEffectiveTimeScale(st.speed ?? 1);
      this.actions.set(st.name, action);
    }
    this.play((this.data as any).initialState ?? 'Idle', true);
  }

  private findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | null {
    if (!name) return null;
    const lower = name.toLowerCase();
    return clips.find(c => c.name.toLowerCase() === lower)
      ?? clips.find(c => c.name.toLowerCase().includes(lower))
      ?? null;
  }

  play(state: string, immediate = false) {
    if (!this.mixer) return;
    const next = this.actions.get(state);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    if (this.current === state && next.isRunning()) return;
    const fade = immediate ? 0 : (this.data as any).crossfade ?? 0.22;
    next.reset();
    if (prev && fade > 0) { next.crossFadeFrom(prev, fade, true); }
    next.play();
    this.current = state;
  }

  /** Called by controllers/NPCs every frame: maps speed → Idle/Walk/Run + air state. */
  setLocomotion(speedNorm: number, grounded: boolean) {
    if (!this.mixer || !(this.data as any).autoLocomotion) return;
    let state = 'Idle';
    if (!grounded) state = 'Jump';
    else if (speedNorm > 0.75) state = 'Run';
    else if (speedNorm > 0.05) state = 'Walk';
    if (state !== this.lastLocomotionSet) {
      this.lastLocomotionSet = state;
      this.play(state);
    }
  }

  trigger(state: string) { this.play(state); }

  onUpdate(dt: number) {
    this.mixer?.update(dt);
  }
}

export function registerAnimator() { AnimatorCmp.register(); }
