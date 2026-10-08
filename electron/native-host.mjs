import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateHttpUrl } from '../engine/http-client.mjs';

const MAX_MESSAGE_BYTES = 1024 * 1024;

function getAppDataDirectory() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'AI Download Manager Pro');
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'AI Download Manager Pro');
  return path.join(os.homedir(), '.config', 'AI Download Manager Pro');
}

let outputChain = Promise.resolve();
function sendNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  const message = Buffer.concat([header, body]);
  outputChain = outputChain.then(() => new Promise(resolve => process.stdout.write(message, resolve)));
  return outputChain;
}

async function dispatch(message) {
  if (!message || message.type !== 'enqueue-url' || typeof message.url !== 'string' || message.url.length > 8192) {
    return { accepted: false, message: 'Only an explicitly selected HTTP or HTTPS download link is supported.' };
  }
  const url = validateHttpUrl(message.url);
  const inbox = path.join(getAppDataDirectory(), 'browser-inbox');
  await fs.mkdir(inbox, { recursive: true });
  const base = `${Date.now()}-${randomUUID()}.json`;
  const tempPath = path.join(inbox, `${base}.tmp`);
  const targetPath = path.join(inbox, base);
  await fs.writeFile(tempPath, JSON.stringify({ version: 1, url: url.href, createdAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, targetPath);
  return { accepted: true, message: 'The selected link was sent to AI Download Manager Pro.' };
}

export async function runNativeHost() {
  // Native Messaging is framed as a 4-byte little-endian length followed by UTF-8 JSON.
  // Protocol output is written only to stdout; diagnostics belong on stderr.
  let buffer = Buffer.alloc(0);
  let tail = Promise.resolve();
  process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        sendNativeMessage({ accepted: false, message: 'The browser message exceeded the size limit.' });
        process.exitCode = 1;
        process.stdin.destroy();
        return;
      }
      if (buffer.length < length + 4) break;
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      tail = tail.then(async () => {
        try { await sendNativeMessage(await dispatch(JSON.parse(body.toString('utf8')))); }
        catch (error) {
          process.stderr.write(`[AI Download Manager Pro native host] ${error.message}\n`);
          await sendNativeMessage({ accepted: false, message: error.message || 'The selected link could not be sent.' });
        }
      });
    }
  });
  await new Promise(resolve => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
  await tail;
  await outputChain;
  process.exit(process.exitCode || 0);
}
