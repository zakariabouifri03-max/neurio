/**
 * Effect ↔ FFmpeg compatibility suite.
 *
 * For every registered effect, at its default value AND at every extreme of
 * every numeric parameter, this runs the generated filter through a real FFmpeg
 * (`-f lavfi -i testsrc2 -vf <filter> -f null -`).
 *
 * That catches the class of bug that static types cannot: an effect emitting a
 * filter name or option the local FFmpeg build does not accept. A wrong
 * `mode=static` on `vignette` is exactly what this caught during development.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { effectRegistry } from '../../src/core/effects/registry';
import { buildFilter } from '../../src/utils/ffmpegEscape';
import type { EffectParam, EffectParamValues } from '../../src/core/types/effects';

function findFfmpeg(): string | null {
  const candidates = [process.env['ADZAK_FFMPEG'], '/tmp/iff/x/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2', 'ffmpeg'].filter(
    Boolean,
  ) as string[];
  for (const c of candidates) {
    if (spawnSync(c, ['-version'], { encoding: 'utf8' }).status === 0) return c;
  }
  return null;
}

const ffmpeg = findFfmpeg();

function runsCleanly(filter: string): string | null {
  const result = spawnSync(
    ffmpeg!,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=25:duration=0.2',
      '-vf',
      filter,
      '-frames:v',
      '3',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return result.status === 0 ? null : (result.stderr || 'unknown error').trim().split('\n')[0]!;
}

/** Every value a parameter can plausibly take at render time. */
function extremeValues(param: EffectParam): (number | boolean | string)[] {
  switch (param.type) {
    case 'bool':
      return [true, false];
    case 'enum':
      return (param.options ?? []).map((o) => o.value);
    case 'color':
      return [String(param.default), '#ff0000'];
    case 'string':
      return []; // file-path params are exercised by the LUT test below
    case 'int':
    case 'float': {
      const out: number[] = [];
      if (typeof param.default === 'number') out.push(param.default);
      if (param.min !== undefined) out.push(param.min);
      if (param.max !== undefined) out.push(param.max);
      if (param.min !== undefined && param.max !== undefined) {
        out.push((param.min + param.max) / 2);
      }
      return [...new Set(out)];
    }
    default:
      return [];
  }
}

describe.skipIf(!ffmpeg)('built-in effects compile against real FFmpeg', () => {
  const effects = effectRegistry.all();

  it('has effects registered', () => {
    expect(effects.length).toBeGreaterThan(5);
  });

  for (const def of effects) {
    it(`${def.id} renders at default and at parameter extremes`, () => {
      const fileParams = def.params.filter((p) => p.type === 'string');
      if (fileParams.length && def.params.length === 1) {
        // LUT-style effects need a real file; verified separately in the plan test.
        const spec = def.toFilter({ [fileParams[0]!.id]: '' }, { width: 320, height: 180, fps: 25, timeSec: 0, warnings: [] });
        expect(spec).toBeNull();
        return;
      }

      const base: EffectParamValues = {};
      for (const p of def.params) base[p.id] = p.default;

      const cases: { label: string; params: EffectParamValues }[] = [
        { label: 'defaults', params: base },
      ];
      for (const param of def.params) {
        for (const value of extremeValues(param)) {
          cases.push({
            label: `${param.id}=${String(value)}`,
            params: { ...base, [param.id]: value },
          });
        }
      }

      for (const testCase of cases) {
        const spec = def.toFilter(testCase.params, { width: 320, height: 180, fps: 25, timeSec: 0, warnings: [] });
        if (!spec) continue; // neutral → intentionally no filter
        const filter = buildFilter(spec.filter, spec.args);
        if (!filter) continue;
        const failure = runsCleanly(filter);
        expect(failure, `${def.id} [${testCase.label}] → "${filter}"`).toBeNull();
      }
    });
  }
});
