import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { redactUrl } from './format.js';

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_MEMORY_LINES = 600;

function cleanDetails(details) {
  if (!details || typeof details !== 'object') return details;
  const copy = { ...details };
  if (copy.url) copy.url = redactUrl(copy.url);
  if (copy.error instanceof Error) copy.error = { name: copy.error.name, code: copy.error.code, message: copy.error.message };
  return copy;
}

export class Logger extends EventEmitter {
  constructor(directory) {
    super();
    this.directory = directory;
    this.filePath = path.join(directory, 'manager.log');
    this.lines = [];
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.lines = content.split(/\r?\n/).filter(Boolean).slice(-MAX_MEMORY_LINES).map((line) => {
        try { return JSON.parse(line); } catch { return { timestamp: new Date().toISOString(), level: 'info', message: line }; }
      });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return this;
  }

  log(level, message, details) {
    const item = { timestamp: new Date().toISOString(), level, message: String(message), ...(details ? { details: cleanDetails(details) } : {}) };
    this.lines.push(item);
    if (this.lines.length > MAX_MEMORY_LINES) this.lines.splice(0, this.lines.length - MAX_MEMORY_LINES);
    this.emit('entry', item);
    const row = `${JSON.stringify(item)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const stat = await fs.stat(this.filePath).catch(() => null);
        if (stat?.size > MAX_LOG_BYTES) await fs.rename(this.filePath, `${this.filePath}.${Date.now()}.old`).catch(() => {});
        await fs.appendFile(this.filePath, row, 'utf8');
      } catch {
        // Logging must never stop or fail a download.
      }
    });
    return item;
  }

  info(message, details) { return this.log('info', message, details); }
  warn(message, details) { return this.log('warn', message, details); }
  error(message, details) { return this.log('error', message, details); }
  debug(message, details) { return this.log('debug', message, details); }

  recent(limit = 200) {
    const count = Math.max(1, Math.min(500, Number(limit) || 200));
    return this.lines.slice(-count).reverse();
  }

  async readFile() {
    await this.writeQueue;
    try { return await fs.readFile(this.filePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }
}
