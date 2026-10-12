/** Prints a friendly startup banner with LAN URLs so others can join. */
import { networkInterfaces } from 'node:os';
import type { NeurioApp, StartedApp } from './app';
import { SERVER_VERSION } from './config';

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) out.push(address.address);
    }
  }
  return out;
}

export function printStartupBanner(app: NeurioApp, started: StartedApp): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('  ┌───────────────────────────────────────────────────────────┐');
  lines.push('  │                      N E U R I O                          │');
  lines.push(`  │            self-hosted chat • v${SERVER_VERSION.padEnd(24)}│`);
  lines.push('  └───────────────────────────────────────────────────────────┘');
  lines.push('');
  lines.push(`  Local:      ${started.url}`);
  for (const address of lanAddresses()) {
    lines.push(`  Network:    http://${address}:${started.port}   (share with your LAN)`);
  }
  lines.push(`  Database:   ${app.config.dbFile}`);
  lines.push(`  Uploads:    ${app.config.uploadsDir}`);
  lines.push(`  Mode:       ${app.config.offlineMode ? 'offline-friendly (no cloud services required)' : 'online'}`);
  lines.push('');
  lines.push('  Open the URL above in the browser for web mode, or launch the');
  lines.push('  desktop app and point it at this server.');
  lines.push('');
  console.log(lines.join('\n'));
}
