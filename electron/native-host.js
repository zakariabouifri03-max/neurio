import { spawn } from 'node:child_process';
import { URL } from 'node:url';

const MAX_MESSAGE_BYTES = 1024 * 1024;

function validDownloadUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function writeMessage(stream, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stream.write(Buffer.concat([header, body]));
}

function launchDesktop(url) {
  return new Promise((resolve, reject) => {
    // In a packaged install process.execPath is the app's Windows executable.
    // The second-instance event in the main process safely hands off the URL.
    const child = spawn(process.execPath, ['--open-url', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function runNativeMessagingHost({ input = process.stdin, output = process.stdout, launch = launchDesktop } = {}) {
  let buffer = Buffer.alloc(0);
  let chain = Promise.resolve();

  const processFrame = async (message) => {
    if (message?.type !== 'download') {
      writeMessage(output, { ok: false, error: 'Unsupported message.' });
      return;
    }
    const url = validDownloadUrl(message.url);
    if (!url) {
      writeMessage(output, { ok: false, error: 'Only valid HTTP or HTTPS download links are accepted.' });
      return;
    }
    try {
      await launch(url);
      writeMessage(output, { ok: true, accepted: true });
    } catch (error) {
      writeMessage(output, { ok: false, error: 'Could not open AI Download Manager Pro.' });
      process.stderr.write(`Native host launch error: ${error.message}\n`);
    }
  };

  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        process.stderr.write(`Rejected oversized native message (${length} bytes).\n`);
        input.destroy();
        return;
      }
      if (buffer.length < length + 4) break;
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      let message;
      try { message = JSON.parse(body.toString('utf8')); } catch {
        chain = chain.then(() => writeMessage(output, { ok: false, error: 'Invalid message format.' }));
        continue;
      }
      chain = chain.then(() => processFrame(message)).catch((error) => {
        process.stderr.write(`Native host message error: ${error.message}\n`);
      });
    }
  });
  input.on('error', (error) => process.stderr.write(`Native host input error: ${error.message}\n`));
  input.once('end', () => {
    chain.finally(() => {
      if (input === process.stdin) process.exit(0);
    });
  });
  input.resume();
}
