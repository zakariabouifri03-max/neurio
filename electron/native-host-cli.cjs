const { spawn } = require('node:child_process');
const path = require('node:path');

const MAX_MESSAGE_BYTES = 1024 * 1024;
const APP_EXE_NAME = 'AI-Download-Manager-Pro.exe';

function send(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function validateUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

function appExecutablePath() {
  // electron-builder places this host in <install>/resources. The desktop
  // executable sits one directory above resources, regardless of install path.
  return path.resolve(path.dirname(process.execPath), '..', APP_EXE_NAME);
}

function launchDesktop(url) {
  return new Promise((resolve, reject) => {
    const executable = appExecutablePath();
    const child = spawn(executable, ['--open-url', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

let buffer = Buffer.alloc(0);
let pending = Promise.resolve();

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE(0);
    if (size > MAX_MESSAGE_BYTES) {
      process.stderr.write(`Rejected oversized native message (${size} bytes).\n`);
      process.exitCode = 2;
      process.stdin.destroy();
      return;
    }
    if (buffer.length < size + 4) return;
    const frame = buffer.subarray(4, 4 + size);
    buffer = buffer.subarray(4 + size);
    let message;
    try { message = JSON.parse(frame.toString('utf8')); }
    catch {
      pending = pending.then(() => send({ ok: false, error: 'Invalid message format.' }));
      continue;
    }
    pending = pending.then(async () => {
      if (message?.type !== 'download') return send({ ok: false, error: 'Unsupported message.' });
      const url = validateUrl(message.url);
      if (!url) return send({ ok: false, error: 'Only valid HTTP or HTTPS download links are accepted.' });
      try {
        await launchDesktop(url);
        send({ ok: true, accepted: true });
      } catch (error) {
        process.stderr.write(`Could not launch desktop app: ${error.message}\n`);
        send({ ok: false, error: 'Could not open AI Download Manager Pro. Repair or reinstall the desktop app.' });
      }
    }).catch((error) => process.stderr.write(`Native host error: ${error.message}\n`));
  }
});

process.stdin.on('error', (error) => process.stderr.write(`Native host input error: ${error.message}\n`));
process.stdin.on('end', () => pending.finally(() => process.exit(0)));
process.stdin.resume();
