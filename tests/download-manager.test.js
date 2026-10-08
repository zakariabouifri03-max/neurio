import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DownloadManager } from '../engine/download-manager.js';

async function startServer({ body, ranges = true, slowMs = 0, failFirstRange = false, failStatus = 503, retryAfter = '0', status = 200, validator = true }) {
  let data = Buffer.from(body);
  let etag = `"${createHash('sha1').update(data).digest('hex')}"`;
  const validatorHeaders = () => validator ? { ETag: etag } : {};
  const requests = [];
  let didFail = false;
  let activeRangeRequests = 0;
  let maxConcurrentRanges = 0;
  const server = http.createServer(async (request, response) => {
    const range = request.headers.range;
    requests.push({ method: request.method, range: range || null, ifRange: request.headers['if-range'] || null });
    if (request.method === 'HEAD') {
      response.writeHead(status, { 'Content-Length': data.length, 'Accept-Ranges': ranges ? 'bytes' : 'none', ...validatorHeaders(), 'Content-Type': 'application/octet-stream' });
      response.end();
      return;
    }
    if (status !== 200) {
      response.writeHead(status, { 'Content-Length': 0 });
      response.end();
      return;
    }
    if (range && ranges) {
      if (failFirstRange && !didFail && range !== 'bytes=0-0') {
        didFail = true;
        response.writeHead(failStatus, { 'Retry-After': retryAfter, 'Content-Length': 0 });
        response.end();
        return;
      }
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) {
        response.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        response.end();
        return;
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), data.length - 1);
      if (start >= data.length) {
        response.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        response.end();
        return;
      }
      const bytes = data.subarray(start, end + 1);
      activeRangeRequests += 1;
      maxConcurrentRanges = Math.max(maxConcurrentRanges, activeRangeRequests);
      response.writeHead(206, {
        'Content-Length': bytes.length,
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Accept-Ranges': 'bytes',
        ...validatorHeaders(),
        'Content-Type': 'application/octet-stream',
      });
      try {
        if (slowMs > 0) {
          for (let offset = 0; offset < bytes.length; offset += 8192) {
            if (response.destroyed) break;
            response.write(bytes.subarray(offset, Math.min(bytes.length, offset + 8192)));
            await delay(slowMs);
          }
          if (!response.destroyed) response.end();
        } else response.end(bytes);
      } finally { activeRangeRequests -= 1; }
      return;
    }
    response.writeHead(200, {
      'Content-Length': data.length,
      'Accept-Ranges': ranges ? 'bytes' : 'none',
      ...validatorHeaders(),
      'Content-Type': 'application/octet-stream',
    });
    if (slowMs > 0) {
      for (let offset = 0; offset < data.length; offset += 8192) {
        if (response.destroyed) break;
        response.write(data.subarray(offset, Math.min(data.length, offset + 8192)));
        await delay(slowMs);
      }
      if (!response.destroyed) response.end();
    } else response.end(data);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    requests,
    setBody(body) { data = Buffer.from(body); etag = `\"${createHash('sha1').update(data).digest('hex')}\"`; },
    get maxConcurrentRanges() { return maxConcurrentRanges; },
    url: `http://127.0.0.1:${server.address().port}/asset.bin`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function makeManager(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aiddm-test-'));
  const manager = new DownloadManager({ appDataDirectory: path.join(root, 'app'), downloadDirectory: path.join(root, 'downloads') });
  await manager.initialize();
  t.after(async () => {
    await manager.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { manager, root };
}

async function waitFor(manager, predicate, timeoutMs = 12_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const state = manager.getState();
    const found = state.downloads.find(predicate);
    if (found) return found;
    await delay(25);
  }
  throw new Error(`Timed out waiting for download state. Latest: ${JSON.stringify(manager.getState().downloads)}`);
}

test('downloads and verifies segmented byte ranges without corrupting output', async (t) => {
  const payload = Buffer.alloc(34 * 1024 * 1024 + 123);
  for (let i = 0; i < payload.length; i += 1) payload[i] = (i * 31 + 17) % 256;
  const remote = await startServer({ body: payload, ranges: true, slowMs: 2 });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 4, startImmediately: true, duplicatePolicy: 'rename' });
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.equal(complete.totalBytes, payload.length);
  const output = await fs.readFile(complete.finalPath);
  assert.deepEqual(output, payload);
  assert.ok(remote.requests.some((request) => request.range && request.range !== 'bytes=0-0'), 'engine should issue real range requests');
  assert.ok(remote.maxConcurrentRanges > 1, `expected concurrent range requests; peak was ${remote.maxConcurrentRanges}`);
  assert.equal(await fs.stat(`${complete.finalPath}.part.json`).then(() => true, () => false), false, 'sidecar removed after verified completion');
});

test('falls back to one ordinary GET when the server ignores Range', async (t) => {
  const payload = Buffer.from('single connection fallback payload\n'.repeat(4000));
  const remote = await startServer({ body: payload, ranges: false });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 8, startImmediately: true });
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.equal(complete.rangeSupported, false);
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
  assert.ok(remote.requests.some((request) => request.method === 'GET' && request.range === null), 'fallback must issue a normal GET');
});

test('uses one coherent connection if ranges lack a stable file validator', async (t) => {
  const payload = Buffer.from('range-capable source without a strong validator'.repeat(4000));
  const remote = await startServer({ body: payload, ranges: true, validator: false });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 8, startImmediately: true });
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.equal(complete.rangeSupported, true, 'the server did support Range');
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
  assert.ok(remote.requests.some((request) => request.range === null), 'a full GET keeps one server representation coherent');
  assert.equal(remote.maxConcurrentRanges, 1, 'only the one-byte capability probe may use Range');
  assert.ok(remote.requests.every((request) => request.range === null || request.range === 'bytes=0-0'));
});

test('respects a 429 Retry-After and reduces connection concurrency', async (t) => {
  const payload = Buffer.alloc(1024 * 1024, 0x2a);
  const remote = await startServer({ body: payload, ranges: true, failFirstRange: true, failStatus: 429, retryAfter: '1' });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 8, startImmediately: true });
  const startedAt = Date.now();
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status), 20_000);
  const elapsed = Date.now() - startedAt;
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.ok(elapsed >= 900, `Retry-After should be observed; elapsed ${elapsed}ms`);
  assert.ok(complete.retryCount >= 1);
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
});

test('enforces the active-download limit while draining multiple queued files', async (t) => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x57);
  const remote = await startServer({ body: payload, ranges: true, slowMs: 2 });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  await manager.updateSettings({ maxActiveDownloads: 2 });
  const added = [];
  for (let i = 0; i < 3; i += 1) added.push(await manager.addDownload({ url: `${remote.url}?item=${i}`, connections: 2, startImmediately: true }));
  const initial = manager.getState();
  assert.equal(initial.stats.active, 2);
  assert.equal(initial.stats.queued, 1);
  const finished = await Promise.all(added.map((item) => waitFor(manager, (entry) => entry.id === item.download.id && ['completed', 'failed'].includes(entry.status), 20_000)));
  assert.ok(finished.every((entry) => entry.status === 'completed'), JSON.stringify(finished));
  for (const entry of finished) assert.deepEqual(await fs.readFile(entry.finalPath), payload);
});

test('applies a custom bandwidth limit to real response bytes', async (t) => {
  const payload = Buffer.alloc(120 * 1024, 0x73);
  const remote = await startServer({ body: payload, ranges: true });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  await manager.updateSettings({ bandwidthLimitBps: 100_000 });
  const startedAt = Date.now();
  const added = await manager.addDownload({ url: remote.url, connections: 1, startImmediately: true });
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status), 10_000);
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.ok(Date.now() - startedAt >= 700, '100 KB/s must slow the actual transfer stream');
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
});

test('rejects invalid URLs and applies duplicate skip/rename policies', async (t) => {
  const payload = Buffer.from('duplicate policy');
  const remote = await startServer({ body: payload, ranges: false });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  await assert.rejects(manager.addDownload({ url: 'file:///etc/passwd' }), /HTTP and HTTPS/);
  const first = await manager.addDownload({ url: remote.url, startImmediately: true, duplicatePolicy: 'rename' });
  const complete = await waitFor(manager, (entry) => entry.id === first.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(complete.status, 'completed');
  const skipped = await manager.addDownload({ url: remote.url, duplicatePolicy: 'skip' });
  assert.equal(skipped.skipped, true);
  const renamed = await manager.addDownload({ url: remote.url, duplicatePolicy: 'rename', startImmediately: true });
  const renamedComplete = await waitFor(manager, (entry) => entry.id === renamed.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(renamedComplete.status, 'completed');
  assert.notEqual(renamedComplete.finalPath, complete.finalPath);
  assert.deepEqual(await fs.readFile(renamedComplete.finalPath), payload);
});

test('pause and resume continues from saved bytes on a range-capable server', async (t) => {
  const payload = Buffer.alloc(512 * 1024, 0x6d);
  const remote = await startServer({ body: payload, ranges: true, slowMs: 4 });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 1, startImmediately: true });
  await waitFor(manager, (entry) => entry.id === added.download.id && entry.downloadedBytes > 24_000);
  await manager.pauseDownload(added.download.id);
  const paused = manager.getState().downloads.find((entry) => entry.id === added.download.id);
  assert.equal(paused.status, 'paused');
  assert.ok(paused.downloadedBytes > 0);
  await manager.resumeDownload(added.download.id);
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status), 20_000);
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
  const resumedRange = remote.requests.find((request) => request.range && !['bytes=0-0', 'bytes=0-524287'].includes(request.range));
  assert.ok(resumedRange, `expected a non-zero resumed Range request; got ${JSON.stringify(remote.requests)}`);
});

test('discards saved bytes when the source validator changes before resume', async (t) => {
  const firstVersion = Buffer.alloc(512 * 1024, 0x24);
  const secondVersion = Buffer.alloc(512 * 1024, 0x81);
  const remote = await startServer({ body: firstVersion, ranges: true, slowMs: 4 });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 1, startImmediately: true });
  await waitFor(manager, (entry) => entry.id === added.download.id && entry.downloadedBytes > 24_000);
  await manager.pauseDownload(added.download.id);
  remote.setBody(secondVersion);
  await manager.resumeDownload(added.download.id);
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status), 20_000);
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.deepEqual(await fs.readFile(complete.finalPath), secondVersion, 'old partial bytes must not be mixed with the new source version');
  assert.ok(remote.requests.some((request) => request.range && request.range !== 'bytes=0-0' && request.ifRange), 'resumed range requests must carry a source validator');
});

test('reopens an interrupted manager and resumes verified ranges after restart', async (t) => {
  const payload = Buffer.alloc(1024 * 1024, 0x39);
  const remote = await startServer({ body: payload, ranges: true, slowMs: 5 });
  t.after(remote.close);
  const { manager: first, root } = await makeManager(t);
  const added = await first.addDownload({ url: remote.url, connections: 1, startImmediately: true });
  await waitFor(first, (entry) => entry.id === added.download.id && entry.downloadedBytes > 30_000);
  await first.shutdown();

  const second = new DownloadManager({ appDataDirectory: path.join(root, 'app'), downloadDirectory: path.join(root, 'downloads') });
  await second.initialize();
  t.after(() => second.shutdown());
  assert.equal(second.getState().interruptedCount, 1);
  const restored = second.getState().downloads.find((entry) => entry.id === added.download.id);
  assert.equal(restored.status, 'paused');
  assert.ok(restored.downloadedBytes > 0);
  await second.resumeDownload(restored.id);
  const complete = await waitFor(second, (entry) => entry.id === restored.id && ['completed', 'failed'].includes(entry.status), 20_000);
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
  assert.ok(remote.requests.some((request) => request.range && request.range !== 'bytes=0-0' && request.range !== `bytes=0-${payload.length - 1}`));
});

test('retries a failed segment and respects server response handling', async (t) => {
  const payload = Buffer.alloc(1024 * 1024, 0x44);
  const remote = await startServer({ body: payload, ranges: true, failFirstRange: true });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 2, startImmediately: true });
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status), 20_000);
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.ok(complete.retryCount >= 1);
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
});

test('reports HTTP errors rather than marking a failed response complete', async (t) => {
  const remote = await startServer({ body: Buffer.alloc(0), ranges: false, status: 404 });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 2, startImmediately: true });
  const finished = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /404/);
  assert.equal(await fs.access(finished.finalPath).then(() => true, () => false), false);
});

test('treats 403 as terminal and never retries or bypasses access controls', async (t) => {
  const remote = await startServer({ body: Buffer.alloc(0), ranges: false, status: 403 });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 16, startImmediately: true });
  const finished = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(finished.status, 'failed');
  assert.match(finished.error, /denied access/i);
  assert.equal(finished.effectiveConnections, 1);
  assert.equal(finished.retryCount, 0);
  assert.equal(remote.requests.filter((request) => request.method === 'GET').length, 1, 'only the ordinary capability check is sent');
  assert.equal(await fs.access(finished.finalPath).then(() => true, () => false), false);
});

test('validates an advertised checksum before promoting the partial file', async (t) => {
  const payload = Buffer.from('verified with SHA-256');
  const actual = createHash('sha256').update(payload).digest('hex');
  const remote = await startServer({ body: payload, ranges: false });
  const original = remote.server.listeners('request')[0];
  remote.server.removeAllListeners('request');
  remote.server.on('request', (request, response) => {
    if (request.method === 'HEAD') {
      response.writeHead(200, { 'Content-Length': payload.length, 'Accept-Ranges': 'none', 'X-Checksum-Sha256': actual });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Length': payload.length, 'X-Checksum-Sha256': actual });
    response.end(payload);
  });
  t.after(remote.close);
  const { manager } = await makeManager(t);
  const added = await manager.addDownload({ url: remote.url, connections: 1, startImmediately: true });
  const complete = await waitFor(manager, (entry) => entry.id === added.download.id && ['completed', 'failed'].includes(entry.status));
  assert.equal(complete.status, 'completed', complete.error || complete.statusMessage);
  assert.equal(complete.integrity.checksumVerified, true);
  assert.equal(complete.integrity.calculated.sha256, actual);
  assert.deepEqual(await fs.readFile(complete.finalPath), payload);
  void original;
});
