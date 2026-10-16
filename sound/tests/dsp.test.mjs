import test from "node:test";
import assert from "node:assert/strict";
import { LookaheadLimiter } from "../dsp.mjs";
function render(limiter, left, right = left) {
  const result = [new Float32Array(left.length), new Float32Array(left.length)];
  for (let offset = 0; offset < left.length; offset += 128) {
    const end = Math.min(offset + 128, left.length);
    limiter.process(
      [left.subarray(offset, end), right.subarray(offset, end)],
      result.map((channel) => channel.subarray(offset, end)),
    );
  }
  return result;
}
test("quiet audio is unchanged except for the declared look-ahead delay", () => {
  const limiter = new LookaheadLimiter(48000);
  const input = Float32Array.from(
    { length: 3000 },
    (_, i) => Math.sin(i * 0.08) * 0.2,
  );
  const [output] = render(limiter, input);
  for (let i = 0; i < output.length; i++)
    assert.equal(output[i], i < limiter.delay ? 0 : input[i - limiter.delay]);
});
test("strong peaks stay at or below -1 dBFS at several sample rates", () => {
  for (const sampleRate of [8000, 44100, 48000, 96000]) {
    const limiter = new LookaheadLimiter(sampleRate);
    const left = Float32Array.from({ length: 25000 }, (_, i) =>
      i % 199 === 0 ? 12 : Math.sin(i * 0.037) * 4,
    );
    const right = Float32Array.from(
      { length: left.length },
      (_, i) => Math.cos(i * 0.079) * 6,
    );
    for (const output of render(limiter, left, right)) {
      for (const sample of output)
        assert.ok(
          Number.isFinite(sample) && Math.abs(sample) <= limiter.ceiling + 1e-7,
          `sample=${sample}`,
        );
    }
  }
});
test("stereo channels share gain to preserve their balance", () => {
  const limiter = new LookaheadLimiter(44100);
  const input = Float32Array.from(
    { length: 4000 },
    (_, i) => Math.sin(i * 0.08) * 5,
  );
  const [left, right] = render(
    limiter,
    input,
    input.map((x) => x * 0.5),
  );
  for (let i = 0; i < left.length; i++)
    assert.ok(Math.abs(right[i] - left[i] * 0.5) < 1e-7);
});
test("isolated impulses do not escape the delayed peak window", () => {
  const limiter = new LookaheadLimiter(48000);
  const input = new Float32Array(80000);
  input[0] = 20;
  input[1024] = -30;
  input[70000] = 2;
  const [output] = render(limiter, input);
  assert.ok(output[limiter.delay] > 0.88);
  for (const sample of output)
    assert.ok(Math.abs(sample) <= limiter.ceiling + 1e-7);
});
test("non-finite input is silenced and a disconnected input produces silence", () => {
  const limiter = new LookaheadLimiter(48000);
  const input = new Float32Array(1000);
  input[1] = Infinity;
  input[2] = NaN;
  const [output] = render(limiter, input);
  assert.ok(output.every((x) => x === 0));
  const silent = [new Float32Array(128), new Float32Array(128)];
  limiter.process([], silent);
  assert.ok(silent.every((channel) => channel.every((x) => x === 0)));
});
