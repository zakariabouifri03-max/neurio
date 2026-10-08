import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionManager } from '../engine/connection-manager.js';
import { BandwidthLimiter } from '../engine/bandwidth-limiter.js';
import { RetryManager } from '../engine/retry-manager.js';
import { Scheduler } from '../engine/scheduler.js';
import { friendlyError } from '../engine/errors.js';
import { makeSegments, normalizeSegments, sumSegmentBytes } from '../engine/segment-manager.js';

test('segment ranges are contiguous, bounded and resume-normalizable for large files', () => {
  const size = 10 * 1024 * 1024 * 1024 + 17;
  const segments = makeSegments(size, 8);
  assert.ok(segments.length > 8);
  assert.ok(segments.length < 4096);
  assert.equal(segments[0].start, 0);
  assert.equal(segments.at(-1).end, size - 1);
  for (let i = 1; i < segments.length; i += 1) assert.equal(segments[i].start, segments[i - 1].end + 1);
  const partial = segments.map((segment) => ({ ...segment }));
  partial[0].downloadedBytes = 512;
  assert.equal(sumSegmentBytes(partial), 512);
  assert.equal(normalizeSegments(partial, size).length, segments.length);
  assert.equal(normalizeSegments([{ id: 0, start: 0, end: 5, downloadedBytes: 2 }], 10), null);
});

test('bandwidth limiter waits instead of merely changing a displayed setting', async () => {
  const limiter = new BandwidthLimiter(100_000);
  const startedAt = Date.now();
  await limiter.consume(100_000);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 700, `expected ~1s at 100 KB/s, measured ${elapsed}ms`);
  limiter.setRate(null);
  const unlimitedStart = Date.now();
  await limiter.consume(100_000);
  assert.ok(Date.now() - unlimitedStart < 100, 'unlimited mode should not throttle');
});

test('retries use exponential backoff but never violate a longer Retry-After', async () => {
  const retry = new RetryManager({ maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, random: () => 0 });
  let calls = 0;
  const startedAt = Date.now();
  const value = await retry.run(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('rate limited');
      error.statusCode = 429;
      error.retryAfterMs = 100;
      error.retryable = true;
      throw error;
    }
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
  assert.ok(Date.now() - startedAt >= 95);
});

test('adaptive concurrency decreases after errors and recovers only to the user limit', () => {
  const changes = [];
  const connections = new ConnectionManager(8, (event) => changes.push(event));
  connections.onConnectionError();
  connections.onConnectionError();
  connections.onConnectionError();
  assert.equal(connections.effective, 4);
  for (let i = 0; i < 12; i += 1) connections.onSuccess();
  assert.equal(connections.effective, 5);
  assert.ok(changes.length >= 2);
  connections.onForbidden();
  assert.equal(connections.effective, 1);
});

test('scheduler evaluates normal and overnight local-time windows', () => {
  const manager = { settings: { schedule: { enabled: true, startTime: '02:00', stopTime: '07:00' } } };
  const scheduler = new Scheduler(manager);
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 2, 0)), true);
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 6, 59)), true);
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 7, 0)), false);
  manager.settings.schedule = { enabled: true, startTime: '22:00', stopTime: '06:00' };
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 23, 30)), true);
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 5, 59)), true);
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 12, 0)), false);
  manager.settings.schedule.enabled = false;
  assert.equal(scheduler.isInsideWindow(new Date(2026, 0, 1, 12, 0)), true);
});

test('disk-full failures are translated into a user-actionable message', () => {
  assert.match(friendlyError({ code: 'ENOSPC' }), /free disk space/i);
});
