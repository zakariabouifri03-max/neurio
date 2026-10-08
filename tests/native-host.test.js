import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { runNativeMessagingHost } from '../electron/native-host.js';

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length, 0);
  return Buffer.concat([length, body]);
}

function collectOne(output) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => reject(new Error('Native host response timed out.')), 2000);
    output.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32LE(0);
      if (buffer.length < size + 4) return;
      clearTimeout(timeout);
      resolve(JSON.parse(buffer.subarray(4, size + 4).toString('utf8')));
    });
  });
}

test('native messaging host validates and hands off only explicit HTTP(S) links', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const launched = [];
  runNativeMessagingHost({ input, output, launch: async (url) => launched.push(url) });
  const firstResponse = collectOne(output);
  input.write(frame({ type: 'download', url: 'https://files.example.test/movie.mp4?token=secret' }));
  assert.deepEqual(await firstResponse, { ok: true, accepted: true });
  assert.equal(launched.length, 1);
  assert.equal(launched[0], 'https://files.example.test/movie.mp4?token=secret');

  const secondResponse = collectOne(output);
  input.write(frame({ type: 'download', url: 'file:///etc/passwd' }));
  assert.equal((await secondResponse).ok, false);
  assert.equal(launched.length, 1);
  input.end();
  output.destroy();
});
