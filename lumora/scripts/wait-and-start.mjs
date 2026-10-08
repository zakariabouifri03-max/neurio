import net from 'node:net';
import { spawn } from 'node:child_process';
const port = 5174;
const tryConnect = () => new Promise((res) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.end(); res(true); });
  s.on('error', () => res(false));
});
for (let i = 0; i < 120; i++) { if (await tryConnect()) break; await new Promise(r => setTimeout(r, 500)); }
spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], {
  stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: `http://localhost:${port}` }
});
