// Spawns the real server on a free port, runs the protocol test against it, shuts down.
import { spawn } from 'node:child_process';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8123 + Math.floor(Math.random() * 200);

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), QUIET: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
srv.stderr.on('data', (d) => process.stderr.write('[server!] ' + d));

const wait = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('server did not come up');
};

let code = 1;
try {
  await wait();
  const t = spawn(process.execPath, [path.join(ROOT, 'tools', 'protocol-test.mjs')], {
    cwd: ROOT, env: { ...process.env, WS: `ws://localhost:${PORT}/ws` }, stdio: 'inherit',
  });
  code = await new Promise((res) => t.on('exit', (c) => res(c || 0)));
} catch (e) {
  console.error(e.message);
} finally {
  srv.kill('SIGTERM');
  setTimeout(() => srv.kill('SIGKILL'), 800);
}
process.exit(code);
