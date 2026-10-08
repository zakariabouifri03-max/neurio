import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { DownloadManager } from '../engine/download-manager.mjs';
import { FileWriter } from '../engine/file-writer.mjs';

const data = Buffer.alloc(2 * 1024 * 1024);
for (let i = 0; i < data.length; i++) data[i] = (i * 19 + 23) % 251;

function parseRange(value) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(value || '');
  return match ? { start: Number(match[1]), end: match[2] ? Number(match[2]) : data.length - 1 } : null;
}

test('FileWriter refuses to silently truncate a partial file during resume', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aidmp-writer-test-'));
  const partPath = path.join(root, 'fixture.part');
  try {
    await fs.writeFile(partPath, Buffer.from('keep'));
    await assert.rejects(FileWriter.open(partPath, { totalSize: 16, resume: true }), { code: 'PARTIAL_FILE_SIZE_MISMATCH' });
    assert.deepEqual(await fs.readFile(partPath), Buffer.from('keep'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('resume discards an owned partial file with a truncated preallocated length', async () => {
  const rangeStarts = [];
  const server = http.createServer(async (request, response) => {
    const common = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length,
      'Content-Disposition': 'attachment; filename="partial-safety.bin"',
      'ETag': '"partial-safety-v1"',
      'Accept-Ranges': 'bytes',
    };
    if (request.method === 'HEAD') { response.writeHead(200, common); response.end(); return; }
    const range = parseRange(request.headers.range);
    if (range) {
      rangeStarts.push(range.start);
      const end = Math.min(range.end, data.length - 1);
      const body = data.subarray(range.start, end + 1);
      response.writeHead(206, { ...common, 'Content-Length': body.length, 'Content-Range': `bytes ${range.start}-${end}/${data.length}` });
      for (let offset = 0; offset < body.length; offset += 16 * 1024) {
        if (response.destroyed) return;
        response.write(body.subarray(offset, Math.min(body.length, offset + 16 * 1024)));
        await new Promise(resolve => setTimeout(resolve, 3));
      }
      response.end();
      return;
    }
    response.writeHead(200, common);
    response.end(data);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aidmp-partial-test-'));
  const options = { appDataDirectory: path.join(root, 'state'), defaultDownloadDirectory: path.join(root, 'downloads'), metricsIntervalMs: 50 };
  let manager = new DownloadManager(options);
  try {
    await manager.initialize();
    await manager.updateSettings({ connections: 4, maxActiveDownloads: 1 });
    const url = `http://127.0.0.1:${server.address().port}/partial-safety.bin`;
    const added = await manager.addUrl(url, { conflictAction: 'rename' });
    const started = Date.now();
    let active;
    while (Date.now() - started < 5000) {
      active = manager.getState().downloads.find(item => item.id === added.id);
      if (active?.status === 'downloading' && active.downloadedBytes > 32 * 1024) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(active?.downloadedBytes > 0, 'download should have written some bytes before pause');
    await manager.pause(added.id);
    const paused = manager.getState().downloads.find(item => item.id === added.id);
    const partPath = path.join(paused.outputDirectory, `${paused.fileName}.part`);
    await manager.shutdown();

    // Simulate external truncation/corruption while keeping the sidecar metadata intact.
    await fs.truncate(partPath, 4096);
    const previousRequestCount = rangeStarts.length;
    manager = new DownloadManager(options);
    await manager.initialize();
    await manager.updateSettings({ connections: 4, maxActiveDownloads: 1 });
    await manager.resume(added.id);

    const deadline = Date.now() + 8000;
    let finished;
    while (Date.now() < deadline) {
      finished = manager.getState().downloads.find(item => item.id === added.id);
      if (finished?.status === 'completed') break;
      if (finished?.status === 'failed') throw new Error(finished.error?.message || 'Safe restart failed.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(finished?.status, 'completed');
    assert.deepEqual(await fs.readFile(finished.finalPath), data);
    assert.ok(rangeStarts.slice(previousRequestCount).some(start => start === 0), 'the restarted transfer begins again at byte zero');
    assert.ok(manager.getLogs().some(line => line.includes('failed resume validation')));
  } finally {
    await manager.shutdown();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
