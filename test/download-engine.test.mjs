import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { DownloadManager } from '../engine/download-manager.mjs';
import { createSegments, segmentsCoverFile } from '../engine/segment-manager.mjs';
import { isWithinSchedule } from '../engine/scheduler.mjs';
import { validateHttpUrl } from '../engine/http-client.mjs';

const DATA = Buffer.alloc(8 * 1024 * 1024);
for (let i = 0; i < DATA.length; i++) DATA[i] = (i * 31 + (i >> 4) * 7) % 251;

function parseRange(value) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value || '');
  if (!match) return null;
  return { start: Number(match[1]), end: match[2] ? Number(match[2]) : DATA.length - 1 };
}

async function listen(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

function rangeHandler({ ranges = true, slowMs = 0, failOnce = false, digest = null } = {}) {
  const stats = { rangeRequests: [], fullRequests: 0, failures: 0 };
  return {
    stats,
    handle: async (req, res) => {
      const common = {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="fixture.bin"',
        'Content-Length': DATA.length,
        'ETag': '"fixture-v1"',
        'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
        ...(ranges ? { 'Accept-Ranges': 'bytes' } : {}),
        ...(digest ? { Digest: digest } : {}),
      };
      if (req.method === 'HEAD') { res.writeHead(200, common); res.end(); return; }
      const range = ranges ? parseRange(req.headers.range) : null;
      if (range) {
        stats.rangeRequests.push({ ...range, raw: req.headers.range });
        if (req.headers['if-range'] && req.headers['if-range'] !== '"fixture-v1"') {
          stats.fullRequests += 1;
          res.writeHead(200, common); res.end(DATA); return;
        }
        const start = range.start;
        const end = Math.min(range.end, DATA.length - 1);
        const body = DATA.subarray(start, end + 1);
        const headers = { ...common, 'Content-Length': body.length, 'Content-Range': `bytes ${start}-${end}/${DATA.length}` };
        res.writeHead(206, headers);
        if (failOnce && start > 0 && stats.failures === 0) {
          stats.failures += 1;
          res.write(body.subarray(0, Math.min(2048, body.length)));
          await new Promise(resolve => setTimeout(resolve, 10));
          res.destroy();
          return;
        }
        if (!slowMs) { res.end(body); return; }
        for (let offset = 0; offset < body.length; offset += 16 * 1024) {
          if (res.destroyed) return;
          res.write(body.subarray(offset, Math.min(body.length, offset + 16 * 1024)));
          await new Promise(resolve => setTimeout(resolve, slowMs));
        }
        res.end();
        return;
      }
      if (req.headers.range) stats.ignoredRanges = (stats.ignoredRanges || 0) + 1;
      else stats.fullRequests += 1;
      res.writeHead(200, common);
      if (!slowMs) { res.end(DATA); return; }
      for (let offset = 0; offset < DATA.length; offset += 16 * 1024) {
        if (res.destroyed) return;
        res.write(DATA.subarray(offset, Math.min(DATA.length, offset + 16 * 1024)));
        await new Promise(resolve => setTimeout(resolve, slowMs));
      }
      res.end();
    },
  };
}

async function makeManager(root, { connections = 4, maxActiveDownloads = 2 } = {}) {
  const manager = new DownloadManager({
    appDataDirectory: path.join(root, 'state'),
    defaultDownloadDirectory: path.join(root, 'downloads'),
    metricsIntervalMs: 100,
    schedulerIntervalMs: 100,
  });
  await manager.initialize();
  await manager.updateSettings({ connections, maxActiveDownloads });
  return manager;
}

async function waitForJob(manager, id, predicate, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = manager.getState().downloads.find(item => item.id === id);
    if (job && predicate(job)) return job;
    if (job?.status === 'failed') throw new Error(`Download failed: ${job.error?.message || 'unknown error'} (${job.error?.code || ''})`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const current = manager.getState().downloads.find(item => item.id === id);
  throw new Error(`Timed out waiting for download; current state: ${current?.status || 'missing'}`);
}

async function temporaryDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'aidmp-test-'));
}

async function closeServer(server) {
  await new Promise(resolve => server.close(resolve));
}

const cleanups = [];
test.after(async () => {
  await Promise.all(cleanups.splice(0).map(async cleanup => {
    try { await cleanup(); } catch { /* best-effort cleanup */ }
  }));
});

test('segments cover each byte exactly and HTTP(S) validation rejects unsafe schemes', () => {
  const segments = createSegments(1003, 8);
  assert.equal(segments.length, 8);
  assert.equal(segmentsCoverFile(segments, 1003), false, 'segments are not complete until their bytes are verified');
  for (const segment of segments) { segment.complete = true; segment.downloaded = segment.end - segment.start + 1; }
  assert.equal(segmentsCoverFile(segments, 1003), true);
  assert.throws(() => validateHttpUrl('file:///etc/passwd'), { code: 'INVALID_URL' });
  assert.throws(() => validateHttpUrl('https://user:pass@example.com/file.zip'), { code: 'INVALID_URL' });
  assert.equal(validateHttpUrl('https://example.com/file.zip').protocol, 'https:');
});

test('parallel range download writes byte-correct output and verifies final size', async () => {
  const digest = createHash('sha256').update(DATA).digest('base64');
  const fixture = rangeHandler({ digest: `sha-256=:${digest}:` });
  const { server, base } = await listen(fixture.handle);
  const root = await temporaryDirectory();
  const manager = await makeManager(root, { connections: 4 });
  cleanups.push(async () => { await manager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });

  const job = await manager.addUrl(`${base}/fixture.bin`, { conflictAction: 'rename' });
  const finished = await waitForJob(manager, job.id, item => item.status === 'completed');
  const output = await fs.readFile(finished.finalPath);
  assert.deepEqual(output, DATA);
  assert.ok(fixture.stats.rangeRequests.length >= 5, 'one-byte support probe plus multiple segment requests');
  assert.equal(fixture.stats.fullRequests, 0);
  assert.equal(finished.verifiedBy, 'size-and-checksum');
  await assert.rejects(fs.access(`${finished.finalPath}.part`));
  await assert.rejects(fs.access(`${finished.finalPath}.part.json`));
});

test('a supplied but incorrect source checksum fails without publishing a completed file', async () => {
  const wrongDigest = Buffer.alloc(32, 0x5a).toString('base64');
  const fixture = rangeHandler({ digest: `sha-256=:${wrongDigest}:` });
  const { server, base } = await listen(fixture.handle);
  const root = await temporaryDirectory();
  const manager = await makeManager(root, { connections: 4 });
  cleanups.push(async () => { await manager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });

  const job = await manager.addUrl(`${base}/bad-digest.bin`, { conflictAction: 'rename' });
  const started = Date.now();
  let failed;
  while (Date.now() - started < 10_000) {
    failed = manager.getState().downloads.find(item => item.id === job.id);
    if (failed?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal(failed?.status, 'failed');
  assert.equal(failed.error.code, 'INTEGRITY_ERROR');
  assert.notEqual(failed.verifiedBy, 'size-and-checksum');
  await assert.rejects(fs.access(failed.finalPath));
  assert.ok(await fs.stat(path.join(failed.outputDirectory, `${failed.fileName}.part`)).then(stat => stat.size === DATA.length));
});

test('server without byte ranges automatically uses one normal connection', async () => {
  const fixture = rangeHandler({ ranges: false });
  const { server, base } = await listen(fixture.handle);
  const root = await temporaryDirectory();
  const manager = await makeManager(root, { connections: 8 });
  cleanups.push(async () => { await manager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });

  const job = await manager.addUrl(`${base}/fixture.bin`, { conflictAction: 'rename' });
  const finished = await waitForJob(manager, job.id, item => item.status === 'completed');
  assert.deepEqual(await fs.readFile(finished.finalPath), DATA);
  assert.equal(fixture.stats.fullRequests, 1);
  assert.equal(finished.connectionLimit, 1);
  assert.equal(finished.supportsRanges, false);
});

test('a server that stops honoring ranges triggers a clean single-connection fallback', async () => {
  const stats = { ranges: [], fullRequests: 0 };
  const handler = (req, res) => {
    const common = { 'Content-Type': 'application/octet-stream', 'Content-Length': DATA.length, 'ETag': '"fixture-v1"', 'Accept-Ranges': 'bytes', 'Content-Disposition': 'attachment; filename="fallback.bin"' };
    if (req.method === 'HEAD') { res.writeHead(200, common); res.end(); return; }
    const range = parseRange(req.headers.range);
    if (range?.start === 0 && range.end === 0) {
      stats.ranges.push('probe');
      res.writeHead(206, { ...common, 'Content-Length': 1, 'Content-Range': `bytes 0-0/${DATA.length}` });
      res.end(DATA.subarray(0, 1));
      return;
    }
    if (req.headers.range) {
      stats.ranges.push(req.headers.range);
      res.writeHead(200, common);
      res.end(DATA);
      return;
    }
    stats.fullRequests += 1;
    res.writeHead(200, common);
    res.end(DATA);
  };
  const { server, base } = await listen(handler);
  const root = await temporaryDirectory();
  const manager = await makeManager(root, { connections: 4 });
  cleanups.push(async () => { await manager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });

  const job = await manager.addUrl(`${base}/file.bin`, { conflictAction: 'rename' });
  const finished = await waitForJob(manager, job.id, item => item.status === 'completed');
  assert.deepEqual(await fs.readFile(finished.finalPath), DATA);
  assert.equal(finished.connectionLimit, 1);
  assert.equal(finished.supportsRanges, false);
  assert.equal(stats.fullRequests, 1);
  assert.ok(manager.getLogs().some(line => line.includes('Switching to a normal single connection')));
});

test('HTTP 403 is reported without retrying, bypassing, or issuing a body request', async () => {
  let headCount = 0;
  let getCount = 0;
  const { server, base } = await listen((req, res) => {
    if (req.method === 'HEAD') { headCount += 1; res.writeHead(403, { 'Content-Length': 0 }); res.end(); return; }
    getCount += 1; res.writeHead(403, { 'Content-Length': 0 }); res.end();
  });
  const root = await temporaryDirectory();
  const manager = await makeManager(root, { connections: 8 });
  cleanups.push(async () => { await manager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });

  const job = await manager.addUrl(`${base}/private.bin`, { conflictAction: 'rename' });
  const started = Date.now();
  let current;
  while (Date.now() - started < 3000) {
    current = manager.getState().downloads.find(item => item.id === job.id);
    if (current?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(current?.status, 'failed');
  assert.equal(current.error.code, 'HTTP_403');
  assert.match(current.error.message, /denied access/i);
  assert.equal(headCount, 1);
  assert.equal(getCount, 0);
});

test('interrupted segment retries from its last written byte and completes correctly', async () => {
  const fixture = rangeHandler({ failOnce: true });
  const { server, base } = await listen(fixture.handle);
  const root = await temporaryDirectory();
  const manager = await makeManager(root, { connections: 2 });
  cleanups.push(async () => { await manager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });

  const job = await manager.addUrl(`${base}/fixture.bin`, { conflictAction: 'rename' });
  const finished = await waitForJob(manager, job.id, item => item.status === 'completed');
  assert.deepEqual(await fs.readFile(finished.finalPath), DATA);
  assert.equal(fixture.stats.failures, 1);
  assert.ok(fixture.stats.rangeRequests.some(range => range.start > 0));
  assert.ok(manager.getLogs().some(line => line.includes('Retrying a failed segment from its last safely written byte.')));
});

test('pause, application restart, and resume preserve valid downloaded ranges', async () => {
  const fixture = rangeHandler({ slowMs: 4 });
  const { server, base } = await listen(fixture.handle);
  const root = await temporaryDirectory();
  let currentManager = await makeManager(root, { connections: 4 });
  cleanups.push(async () => { await currentManager.shutdown(); await closeServer(server); await fs.rm(root, { recursive: true, force: true }); });
  const manager = currentManager;

  const added = await manager.addUrl(`${base}/fixture.bin`, { conflictAction: 'rename' });
  const firstProgress = await waitForJob(manager, added.id, item => item.downloadedBytes > 24 * 1024 && item.status === 'downloading');
  await manager.pause(added.id);
  const paused = manager.getState().downloads.find(item => item.id === added.id);
  assert.equal(paused.status, 'paused');
  assert.ok(paused.downloadedBytes > 0 && paused.downloadedBytes < paused.size);
  assert.ok(await fs.stat(`${paused.outputDirectory}/${paused.fileName}.part`).then(stat => stat.isFile()));
  assert.ok(await fs.stat(`${paused.outputDirectory}/${paused.fileName}.part.json`).then(stat => stat.isFile()));

  await manager.shutdown();
  const restarted = await makeManager(root, { connections: 4 });
  currentManager = restarted;
  const restored = restarted.getState().downloads.find(item => item.id === added.id);
  assert.equal(restored.status, 'paused');
  assert.ok(restored.downloadedBytes > 0);
  const resumed = await restarted.resume(added.id);
  const completed = await waitForJob(restarted, added.id, item => item.status === 'completed');
  assert.deepEqual(await fs.readFile(completed.finalPath), DATA);
  assert.ok(resumed.downloadedBytes > 0);
  // The test server observed non-zero resumed range starts, rather than a blind restart.
  assert.ok(fixture.stats.rangeRequests.some(range => range.start > 0));
});

test('scheduler respects a daily and overnight window', () => {
  const mondayMorning = new Date(2026, 9, 5, 3, 0, 0);
  const mondayEvening = new Date(2026, 9, 5, 23, 0, 0);
  const tuesdayEarly = new Date(2026, 9, 6, 1, 0, 0);
  assert.equal(isWithinSchedule({ enabled: true, startTime: '02:00', stopTime: '07:00', days: [1] }, mondayMorning), true);
  assert.equal(isWithinSchedule({ enabled: true, startTime: '02:00', stopTime: '07:00', days: [1] }, mondayEvening), false);
  assert.equal(isWithinSchedule({ enabled: true, startTime: '22:00', stopTime: '04:00', days: [1] }, tuesdayEarly), true);
  assert.equal(isWithinSchedule({ enabled: false }, mondayEvening), true);
});
