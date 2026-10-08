import { spawn } from "node:child_process";
import { createServer } from "node:net";

const PORT = 5173;
const DEV_URL = `http://localhost:${PORT}`;

function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = createServer();
      socket.once("error", () => {
        socket.close();
        if (Date.now() - start > timeoutMs) reject(new Error("Timed out waiting for Vite"));
        else setTimeout(tryOnce, 250);
      });
      socket.once("listening", () => {
        socket.close();
        setTimeout(tryOnce, 250);
      });
      const client = spawn("node", ["-e", `
        const n=require('net');
        const s=n.connect(${port},'127.0.0.1',()=>{s.end();process.exit(0)});
        s.on('error',()=>process.exit(1));
      `]);
      client.on("exit", (code) => {
        if (code === 0) resolve();
        else if (Date.now() - start > timeoutMs) reject(new Error("Timed out waiting for Vite"));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

const vite = spawn("npx", ["vite", "--host", "0.0.0.0", "--port", String(PORT)], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

vite.on("exit", (code) => {
  if (code) process.exit(code);
});

await waitForPort(PORT);
const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ANIMA_DEV_URL: DEV_URL },
});

electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
