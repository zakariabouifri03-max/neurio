// ============================================================================
// NEXUS AI AGENT — AI Debugger ("Fix With AI")
// Analyzes problems (script errors with line numbers, gameplay bug reports)
// and proposes a fix: cause, solution, affected files. Can auto-apply and
// re-test via the automated playtest harness.
// ============================================================================

import { store } from '../Editor/store';
import { runTool, type ToolResult } from './tools';
import { rememberBug } from './memory';
import type { ProblemItem } from '../Editor/store';

export interface Diagnosis {
  title: string;
  cause: string;
  solution: string;
  filesAffected: string[];
  severity: 'error' | 'warning';
  /** Apply the fix via tools. Returns summary. */
  apply: () => ToolResult | string;
  /** Verify by running a playtest. */
  testPlan?: { seconds: number; assertions: string[] };
}

/** Diagnose a script problem (console error with file/line). */
export function diagnoseProblem(p: ProblemItem): Diagnosis | null {
  const script = Object.values(store.project?.scripts ?? {}).find(s => s.id === p.scriptId || s.name === p.file.replace(/\.js$/, ''));
  if (!script) return null;
  const lines = script.source.split('\n');
  const lineIdx = Math.max(0, Math.min(lines.length - 1, p.line - 1));
  const line = lines[lineIdx] ?? '';
  const msg = p.message;

  // --- pattern: cannot read properties of undefined ---
  const undefMatch = msg.match(/Cannot read propert(?:y|ies) (?:of|\(')(?:.*?)(?:'\))? of (undefined|null)/)
    ?? msg.match(/is not defined/);
  if (undefMatch) {
    const ident = msg.match(/'([\w$]+)' is not defined/)?.[1]
      ?? msg.match(/Cannot read propert(?:y|ies) '([\w$]+)'/)?.[1]
      ?? 'value';
    // look for likely typos in the script
    const suggestion = findTypo(ident, script.source);
    if (suggestion) {
      return {
        title: `Undefined reference: "${ident}" (${script.name}.js:${p.line})`,
        cause: `"${ident}" is not defined. A similar name "${suggestion}" exists — likely a typo on line ${p.line}.`,
        solution: `Replace "${ident}" with "${suggestion}".`,
        filesAffected: [`${script.name}.js`],
        severity: 'error',
        apply: () => {
          const fixed = script.source.split('\n')
            .map((l, i) => i === lineIdx ? l.replace(new RegExp(`\\b${ident}\\b`, 'g'), suggestion) : l)
            .join('\n');
          return runTool('modify_script', { script: script.id, source: fixed });
        },
        testPlan: { seconds: 3, assertions: ['No script errors during play'] },
      };
    }
    return {
      title: `Undefined reference: "${ident}" (${script.name}.js:${p.line})`,
      cause: `The value "${ident}" is used before it exists (undefined at runtime) — line ${p.line}: ${line.trim().slice(0, 80)}`,
      solution: 'Guard the access with a null check (e.g. `if (target) { ... }`) or initialize the variable in onStart().',
      filesAffected: [`${script.name}.js`],
      severity: 'error',
      apply: () => {
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const guarded = lines.map((l, i) => i === lineIdx ? `${indent}if (${identToGuard(ident, line)}) { /* guarded — value was undefined */ }` : l).join('\n');
        return runTool('modify_script', { script: script.id, source: guarded });
      },
      testPlan: { seconds: 3, assertions: ['No script errors during play'] },
    };
  }

  // --- pattern: not a function ---
  const fnMatch = msg.match(/([\w$.]+) is not a function/);
  if (fnMatch) {
    const name = fnMatch[1];
    return {
      title: `Invalid call: ${name}() (${script.name}.js:${p.line})`,
      cause: `"${name}" is not a function. Check the Nexus API — the object doesn't expose this method.`,
      solution: `Remove or replace the "${name}()" call on line ${p.line}. Common correct calls: Nexus.log(), Nexus.find(name), this.gameObject.move(dx,dy,dz).`,
      filesAffected: [`${script.name}.js`],
      severity: 'error',
      apply: () => {
        const fixed = lines.map((l, i) => i === lineIdx ? `// FIXED (AI debugger): removed invalid call — ${l.trim()}` : l).join('\n');
        return runTool('modify_script', { script: script.id, source: fixed });
      },
      testPlan: { seconds: 3, assertions: ['No script errors during play'] },
    };
  }

  // --- generic syntax error ---
  return {
    title: `Script error in ${script.name}.js:${p.line}`,
    cause: `${msg} — line ${p.line}: ${line.trim().slice(0, 100)}`,
    solution: 'Review the flagged line. Connect an LLM in AI Settings for deeper automatic analysis of unfamiliar errors.',
    filesAffected: [`${script.name}.js`],
    severity: 'error',
    apply: () => 'No automatic fix available for this error class — open the script to fix it manually, or connect an LLM.',
  };
}

function identToGuard(ident: string, line: string): string {
  // If the line reads `x.prop` guard on x; if `x(...)` guard on x.
  const m = line.match(/([\w$]+)\s*\.\s*[\w$]+/) ?? line.match(/([\w$]+)\s*\(/);
  return m ? m[1] : ident;
}

function findTypo(ident: string, source: string): string | null {
  // collect identifiers declared/used in the script + common API names
  const known = new Set<string>([
    ...[...source.matchAll(/(?:const|let|var|class|function)\s+([\w$]+)/g)].map(m => m[1]),
    ...[...source.matchAll(/this\.([\w$]+)/g)].map(m => m[1]),
    'Nexus', 'gameObject', 'engine', 'props', 'dt', 'onStart', 'onUpdate', 'onDestroy', 'onTriggerEnter', 'onInteract',
  ]);
  let best: string | null = null, bestDist = 99;
  for (const k of known) {
    if (k === ident) continue;
    const d = editDistance(ident, k);
    if (d < bestDist && d <= Math.max(1, Math.floor(ident.length / 3))) { bestDist = d; best = k; }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

// -------------------------- gameplay bug reports ----------------------------

/**
 * Diagnose natural-language gameplay bugs, e.g. "The player cannot jump."
 * Inspects the actual controller configuration and finds real issues.
 */
export function diagnoseGameplayBug(report: string): Diagnosis[] {
  const t = report.toLowerCase();
  const out: Diagnosis[] = [];
  const scene = store.scene;
  if (!scene) return out;

  const controllers = scene.objects.filter(o => o.components.some(c => ['ThirdPersonController', 'FirstPersonController', 'TopDownController'].includes(c.type)));
  if (!controllers.length) {
    out.push({
      title: 'No player controller in scene',
      cause: 'The scene has no player controller object, so player input is not processed.',
      solution: 'Create a player (e.g. ask: "Create a third-person player").',
      filesAffected: [],
      severity: 'error',
      apply: () => 'Run "Create a third-person player" to add one.',
    });
    return out;
  }

  const jumpBug = /(can'?t|cannot|won'?t|unable to) jump|no jump|jump.*not work|jump.*broken/.test(t);
  const moveBug = /(can'?t|cannot|won'?t|unable to) (move|walk|run)|movement.*not work|stuck/.test(t);
  const attackBug = /(can'?t|cannot|won'?t) attack|attack.*not work/.test(t);
  const spawnBug = /(not|doesn'?t) spawn|spawn.*not work/.test(t);

  for (const c of controllers) {
    const ctrl = c.components.find(x => ['ThirdPersonController', 'FirstPersonController', 'TopDownController'].includes(x.type))!;
    const collider = c.components.find(x => x.type === 'Collider');
    const rigid = c.components.find(x => x.type === 'RigidBody');

    if (jumpBug) {
      // real diagnostic checks:
      if ((ctrl.jumpForce ?? 7.5) <= 0.01) {
        out.push({
          title: `Jump force is zero on "${c.name}"`,
          cause: `${ctrl.type}.jumpForce = ${ctrl.jumpForce}. With no impulse the player cannot leave the ground.`,
          solution: `Set jumpForce to ~7.5 (a healthy value for gravity scale ${ctrl.gravityScale ?? 1.8}).`,
          filesAffected: [`scene: ${c.name} → ${ctrl.type}`],
          severity: 'error',
          apply: () => runTool('modify_component', { object: c.id, component: ctrl.type, property: 'jumpForce', value: 7.5 }),
          testPlan: { seconds: 2.5, assertions: ['Player jumps when Space is pressed'] },
        });
      }
      if ((ctrl.groundCheckExtra ?? 0.18) < 0.05) {
        out.push({
          title: `Ground check too strict on "${c.name}"`,
          cause: `groundCheckExtra = ${ctrl.groundCheckExtra}. The ground ray barely reaches the floor, so the player is almost never considered grounded and jumps are rejected.`,
          solution: 'Set groundCheckExtra to 0.18 so the ground ray tolerates small gaps/slopes.',
          filesAffected: [`scene: ${c.name} → ${ctrl.type}`],
          severity: 'error',
          apply: () => runTool('modify_component', { object: c.id, component: ctrl.type, property: 'groundCheckExtra', value: 0.18 }),
          testPlan: { seconds: 2.5, assertions: ['Player jumps when Space is pressed'] },
        });
      }
      if (!collider || !rigid) {
        out.push({
          title: `Player "${c.name}" is missing ${!collider ? 'a Collider' : 'a RigidBody'}`,
          cause: `Jumping applies an impulse to the physics body. Without ${!collider ? 'a Collider' : 'a RigidBody'} there is no body to push.`,
          solution: `Add a capsule Collider and a RigidBody (mass ~72, lock rotation).`,
          filesAffected: [`scene: ${c.name}`],
          severity: 'error',
          apply: () => {
            if (!collider) runTool('add_component', { object: c.id, component: 'Collider', props: { shape: 'capsule', radius: 0.42, size: { x: 0.9, y: 1.75, z: 0.9 }, center: { x: 0, y: 0.12, z: 0 } } });
            if (!rigid) runTool('add_component', { object: c.id, component: 'RigidBody', props: { mass: 72, lockRotation: true, linearDamping: 0.02 } });
            return { ok: true, summary: 'Added physics components to the player.' };
          },
          testPlan: { seconds: 2.5, assertions: ['Player jumps when Space is pressed'] },
        });
      }
      if ((ctrl.useStamina !== false) && (ctrl as any).staminaDrain >= 40) {
        out.push({
          title: `Stamina drain is extreme on "${c.name}"`,
          cause: `staminaDrain = ${ctrl.staminaDrain}/s with useStamina on — stamina hits zero almost immediately and jumps are blocked when exhausted.`,
          solution: 'Set staminaDrain to ~12 and staminaRegen to ~9.',
          filesAffected: [`scene: ${c.name} → ${ctrl.type}`],
          severity: 'warning',
          apply: () => {
            runTool('modify_component', { object: c.id, component: ctrl.type, property: 'staminaDrain', value: 12 });
            return runTool('modify_component', { object: c.id, component: ctrl.type, property: 'staminaRegen', value: 9 });
          },
          testPlan: { seconds: 2.5, assertions: ['Player jumps when Space is pressed'] },
        });
      }
    }

    if (moveBug) {
      if ((ctrl.moveSpeed ?? 6) <= 0.01) {
        out.push({
          title: `Move speed is zero on "${c.name}"`,
          cause: 'moveSpeed = 0 — the player cannot walk.',
          solution: 'Set moveSpeed to ~6.',
          filesAffected: [`scene: ${c.name} → ${ctrl.type}`],
          severity: 'error',
          apply: () => runTool('modify_component', { object: c.id, component: ctrl.type, property: 'moveSpeed', value: 6 }),
          testPlan: { seconds: 2.5, assertions: ['Player moves with WASD'] },
        });
      }
    }
  }

  if (attackBug) {
    const hasWeapon = scene.objects.some(o => o.components.some(c => c.type === 'Weapon' || c.type === 'Projectile'));
    if (!hasWeapon) out.push({
      title: 'No weapon on the player',
      cause: 'Attacks require a Weapon (melee) or Projectile component.',
      solution: 'Add a Weapon component to the player.',
      filesAffected: ['scene: Player'],
      severity: 'warning',
      apply: () => runTool('add_component', { object: controllers[0]?.id ?? 'Player', component: 'Weapon', props: { damage: 18, range: 2.4, cooldown: 0.65, affectsTag: 'enemy' } }),
      testPlan: { seconds: 3, assertions: ['Attack works on click'] },
    });
  }

  if (spawnBug) {
    const spawners = scene.objects.filter(o => o.components.some(c => c.type === 'Spawner'));
    for (const s of spawners) {
      const sp = s.components.find(c => c.type === 'Spawner')!;
      if (!sp.prefab) {
        out.push({
          title: `Spawner "${s.name}" has no prefab assigned`,
          cause: 'The Spawner cannot spawn anything — its prefab slot is empty.',
          solution: 'Assign a prefab asset to the spawner.',
          filesAffected: [`scene: ${s.name} → Spawner`],
          severity: 'error',
          apply: () => {
            const prefab = store.project?.assets.find(a => a.type === 'prefab' && /zombie|enemy|soldier/i.test(a.name));
            if (!prefab) return { ok: false, summary: 'No enemy prefab exists — create an enemy first.' };
            return runTool('modify_component', { object: s.id, component: 'Spawner', property: 'prefab', value: prefab.id });
          },
        });
      }
    }
    if (!spawners.length) {
      out.push({
        title: 'No spawner in the scene',
        cause: 'Nothing in the scene spawns enemies.',
        solution: 'Ask: "Make zombies spawn at night" to create a spawner setup.',
        filesAffected: [],
        severity: 'warning',
        apply: () => 'Create an enemy and spawner first (e.g. "Add a zombie enemy", then "Make zombies spawn at night").',
      });
    }
  }

  if (!out.length) {
    rememberBug(report);
    out.push({
      title: 'No definitive cause found automatically',
      cause: `I inspected the player controllers and gameplay systems but found no configuration issue matching "${report}".`,
      solution: 'Run the game, reproduce the issue, then use Fix With AI on the exact console error — or connect an LLM (AI Settings) for open-ended debugging.',
      filesAffected: [],
      severity: 'warning',
      apply: () => 'Nothing to apply automatically.',
    });
  }
  return out;
}
