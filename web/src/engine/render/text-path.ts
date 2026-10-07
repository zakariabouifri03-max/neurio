/**
 * Minimal SVG path maths for text-on-path rendering.
 *
 * The studio only ever emits absolute `M`, `L`, `Q` and `C` commands (see the
 * arc/wave generators in the text panel), so that subset is all we parse. The
 * helpers here let the Canvas2D renderer place glyphs along the same curve the
 * DOM renderer gets for free from `<textPath>`.
 *
 * @module engine/render/text-path
 */

export type PathCommand =
  | { kind: 'M'; x: number; y: number }
  | { kind: 'L'; x: number; y: number }
  | { kind: 'Q'; x1: number; y1: number; x: number; y: number }
  | { kind: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number };

/** Tokenises an SVG path `d` string into absolute move/line/quadratic/cubic segments. */
export function parsePath(d: string): PathCommand[] {
  const tokens = d.match(/[MLQC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const commands: PathCommand[] = [];
  let index = 0;
  const num = () => Number(tokens[index++]) || 0;

  while (index < tokens.length) {
    const letter = tokens[index++]!.toUpperCase();
    if (letter === 'M') {
      commands.push({ kind: 'M', x: num(), y: num() });
    } else if (letter === 'L') {
      commands.push({ kind: 'L', x: num(), y: num() });
    } else if (letter === 'Q') {
      const x1 = num();
      const y1 = num();
      commands.push({ kind: 'Q', x1, y1, x: num(), y: num() });
    } else if (letter === 'C') {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      commands.push({ kind: 'C', x1, y1, x2, y2, x: num(), y: num() });
    }
  }
  return commands;
}

function quadAt(t: number, a: number, b: number, c: number): number {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
}

function quadTangent(t: number, a: number, b: number, c: number): number {
  const u = 1 - t;
  return 2 * u * (b - a) + 2 * t * (c - b);
}

function cubicAt(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function cubicTangent(t: number, a: number, b: number, c: number, d: number): number {
  const u = 1 - t;
  return 3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c);
}

export type PathFrame = { x: number; y: number; angle: number };

/** Flattens the path into `segments + 1` evenly spaced samples with tangents. */
export function samplePath(commands: PathCommand[], segments = 64): PathFrame[] {
  if (!commands.length) return [{ x: 0, y: 0, angle: 0 }];
  const frames: PathFrame[] = [];
  let startX = 0;
  let startY = 0;

  for (const command of commands) {
    if (command.kind === 'M') {
      startX = command.x;
      startY = command.y;
      frames.push({ x: startX, y: startY, angle: 0 });
      continue;
    }
    const from = frames[frames.length - 1] ?? { x: startX, y: startY, angle: 0 };
    for (let step = 1; step <= segments; step++) {
      const t = step / segments;
      if (command.kind === 'L') {
        frames.push({ x: from.x + (command.x - from.x) * t, y: from.y + (command.y - from.y) * t, angle: 0 });
      } else if (command.kind === 'Q') {
        frames.push({
          x: quadAt(t, from.x, command.x1, command.x),
          y: quadAt(t, from.y, command.y1, command.y),
          angle: 0,
        });
      } else {
        frames.push({
          x: cubicAt(t, from.x, command.x1, command.x2, command.x),
          y: cubicAt(t, from.y, command.y1, command.y2, command.y),
          angle: 0,
        });
      }
    }
  }

  // Tangents from neighbouring samples (central difference).
  for (let i = 0; i < frames.length; i++) {
    const prev = frames[Math.max(0, i - 1)]!;
    const next = frames[Math.min(frames.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    frames[i]!.angle = Math.atan2(dy, dx);
  }
  return frames;
}

/** Cumulative arc length at each sample, used to advance glyphs by real distance. */
export function pathDistances(frames: PathFrame[]): number[] {
  const distances = [0];
  for (let i = 1; i < frames.length; i++) {
    const dx = frames[i]!.x - frames[i - 1]!.x;
    const dy = frames[i]!.y - frames[i - 1]!.y;
    distances.push(distances[i - 1]! + Math.hypot(dx, dy));
  }
  return distances;
}

/** Position + rotation of the point `distance` along the sampled path. */
export function pointAtDistance(frames: PathFrame[], distances: number[], distance: number): PathFrame {
  const total = distances[distances.length - 1] ?? 0;
  const clamped = Math.max(0, Math.min(total, distance));
  let index = 1;
  while (index < distances.length - 1 && distances[index]! < clamped) index++;
  const start = distances[index - 1]!;
  const end = distances[index]!;
  const t = end === start ? 0 : (clamped - start) / (end - start);
  const a = frames[index - 1]!;
  const b = frames[index]!;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + shortestAngle(a.angle, b.angle) * t,
  };
}

function shortestAngle(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
