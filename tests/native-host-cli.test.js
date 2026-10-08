import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function readFrame(buffer) {
  assert.ok(buffer.length >= 4);
  const size = buffer.readUInt32LE(0);
  assert.equal(buffer.length, size + 4);
  return JSON.parse(buffer.subarray(4).toString('utf8'));
}

test('packaged native-host entry validates messages without opening non-web URLs', async () => {
  const child = spawn(process.execPath, [path.join(root, 'electron/native-host-cli.cjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.stdin.end(frame({ type: 'download', url: 'file:///etc/passwd' }));
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Native-host CLI timed out. stderr: ${Buffer.concat(stderr)}`));
    }, 3000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(result, 0);
  assert.deepEqual(readFrame(Buffer.concat(stdout)), { ok: false, error: 'Only valid HTTP or HTTPS download links are accepted.' });
  assert.equal(Buffer.concat(stderr).length, 0);
});
