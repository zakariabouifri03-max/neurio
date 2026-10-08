import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateHttpUrl } from './http-client.mjs';

export class BrowserBridge {
  constructor({ inboxDirectory, onUrl, logger, intervalMs = 1000 }) {
    this.inboxDirectory = inboxDirectory;
    this.onUrl = onUrl;
    this.logger = logger;
    this.intervalMs = intervalMs;
    this.timer = null;
    this._processing = false;
  }

  async initialize() {
    await fs.mkdir(this.inboxDirectory, { recursive: true });
    await this.processInbox();
    this.timer = setInterval(() => this.processInbox(), this.intervalMs);
    this.timer.unref?.();
  }

  async processInbox() {
    if (this._processing) return;
    this._processing = true;
    try {
      const names = (await fs.readdir(this.inboxDirectory)).filter(name => name.endsWith('.json')).sort();
      for (const name of names) {
        const filePath = path.join(this.inboxDirectory, name);
        try {
          const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
          const url = validateHttpUrl(payload.url).href;
          await this.onUrl(url);
          this.logger?.info('A download URL was received from the browser integration.', { host: new URL(url).host });
        } catch (error) {
          this.logger?.warn('A browser integration message was rejected.', { reason: error.message });
        } finally {
          await fs.rm(filePath, { force: true }).catch(() => {});
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger?.warn('Could not read the browser integration inbox.', { reason: error.message });
    } finally {
      this._processing = false;
    }
  }

  async enqueue(url) {
    const validated = validateHttpUrl(url);
    await fs.mkdir(this.inboxDirectory, { recursive: true });
    const name = `${Date.now()}-${randomUUID()}.json`;
    const temporary = path.join(this.inboxDirectory, `${name}.tmp`);
    const target = path.join(this.inboxDirectory, name);
    await fs.writeFile(temporary, JSON.stringify({ version: 1, url: validated.href, createdAt: new Date().toISOString() }), 'utf8');
    await fs.rename(temporary, target);
    return true;
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
