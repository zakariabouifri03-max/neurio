import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { DownloadManager } from '../engine/download-manager.mjs';

const payload = Buffer.from('A real, small test payload for duplicate and deferred queue handling.');

async function setup() {
  let headRequests = 0;
  const server = http.createServer((request, response) => {
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': payload.length,
      'Content-Disposition': 'attachment; filename="queue-fixture.bin"',
      'ETag': '"queue-fixture-v1"',
      'Accept-Ranges': 'bytes',
    };
    if (request.method === 'HEAD') { headRequests += 1; response.writeHead(200, headers); response.end(); return; }
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    if (match) {
      const start = Number(match[1]);
      const end = Math.min(match[2] ? Number(match[2]) : payload.length - 1, payload.length - 1);
      const body = payload.subarray(start, end + 1);
      response.writeHead(206, { ...headers, 'Content-Length': body.length, 'Content-Range': `bytes ${start}-${end}/${payload.length}` });
      response.end(body);
      return;
    }
    response.writeHead(200, headers);
    response.end(payload);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aidmp-queue-test-'));
  const manager = new DownloadManager({
    appDataDirectory: path.join(root, 'state'),
    defaultDownloadDirectory: path.join(root, 'downloads'),
    metricsIntervalMs: 50,
  });
  await manager.initialize();
  await manager.updateSettings({ connections: 2, maxActiveDownloads: 2 });
  return { manager, server, root, url: `http://127.0.0.1:${port}/download`, getHeadRequests: () => headRequests };
}

async function waitFor(manager, id, predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const item = manager.getState().downloads.find(download => download.id === id);
    if (item && predicate(item)) return item;
    if (item?.status === 'failed') throw new Error(item.error?.message || 'Download failed.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for a queue item.');
}

async function dispose({ manager, server, root }) {
  await manager.shutdown();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

test('a deliberately queued download starts only after the user resumes it', async () => {
  const fixture = await setup();
  try {
    const added = await fixture.manager.addUrl(fixture.url, { startNow: false, conflictAction: 'rename' });
    const queued = fixture.manager.getState().downloads.find(item => item.id === added.id);
    assert.equal(queued.status, 'queued');
    assert.equal(queued.deferred, true);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(fixture.getHeadRequests(), 0, 'a deferred item must not start in the background');

    await fixture.manager.resume(added.id);
    const completed = await waitFor(fixture.manager, added.id, item => item.status === 'completed');
    assert.equal(completed.deferred, false);
    assert.deepEqual(await fs.readFile(completed.finalPath), payload);
    assert.equal(fixture.getHeadRequests(), 1);
  } finally { await dispose(fixture); }
});

test('simultaneous same-name additions reserve one partial path instead of sharing it', async () => {
  const fixture = await setup();
  try {
    const [first, second] = await Promise.all([
      fixture.manager.addUrl(fixture.url, { conflictAction: 'ask' }),
      fixture.manager.addUrl(fixture.url, { conflictAction: 'ask' }),
    ]);
    const deadline = Date.now() + 8000;
    let items = [];
    while (Date.now() < deadline) {
      items = fixture.manager.getState().downloads.filter(item => [first.id, second.id].includes(item.id));
      if (items.length === 2 && items.every(item => ['completed', 'needs-attention'].includes(item.status))) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(items.length, 2);
    assert.equal(items.filter(item => item.status === 'completed').length, 1);
    assert.equal(items.filter(item => item.status === 'needs-attention').length, 1);
    const completed = items.find(item => item.status === 'completed');
    assert.deepEqual(await fs.readFile(completed.finalPath), payload);
  } finally { await dispose(fixture); }
});

test('an existing destination requires a choice and Rename preserves both files', async () => {
  const fixture = await setup();
  try {
    const first = await fixture.manager.addUrl(fixture.url, { conflictAction: 'rename' });
    const original = await waitFor(fixture.manager, first.id, item => item.status === 'completed');
    const second = await fixture.manager.addUrl(fixture.url, { conflictAction: 'ask' });
    const waiting = await waitFor(fixture.manager, second.id, item => item.status === 'needs-attention');
    assert.equal(waiting.error.code, 'DUPLICATE_FILE');
    assert.deepEqual(await fs.readFile(original.finalPath), payload);

    await fixture.manager.resolveDuplicate(second.id, 'rename');
    const renamed = await waitFor(fixture.manager, second.id, item => item.status === 'completed');
    assert.notEqual(renamed.finalPath, original.finalPath);
    assert.match(path.basename(renamed.finalPath), /\(1\)/);
    assert.deepEqual(await fs.readFile(original.finalPath), payload);
    assert.deepEqual(await fs.readFile(renamed.finalPath), payload);
  } finally { await dispose(fixture); }
});
