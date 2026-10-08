import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

function safeDetails(value) {
  if (value == null) return '';
  try {
    return ` ${JSON.stringify(value, (key, item) => {
      if (/^(url|href)$/i.test(key) && typeof item === 'string') {
        try {
          const url = new URL(item);
          return `${url.protocol}//${url.host}${url.pathname}`;
        } catch { return '[redacted URL]'; }
      }
      return item;
    })}`;
  } catch { return ''; }
}

export class Logger extends EventEmitter {
  constructor(directory, { maxEntries = 1000 } = {}) {
    super();
    this.directory = directory;
    this.filePath = path.join(directory, 'download-manager.log');
    this.maxEntries = maxEntries;
    this.entries = [];
    this._writeChain = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      this.entries = text.split(/\r?\n/).filter(Boolean).slice(-this.maxEntries);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  log(level, message, details = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: String(level).toUpperCase(),
      message: String(message),
      details: details == null ? null : safeDetails(details).trim(),
    };
    const line = `${entry.timestamp} [${entry.level}] ${entry.message}${entry.details ? ` ${entry.details}` : ''}`;
    this.entries.push(line);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    this._writeChain = this._writeChain.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      await fs.appendFile(this.filePath, `${line}\n`, 'utf8');
      const stat = await fs.stat(this.filePath);
      if (stat.size > 5 * 1024 * 1024) {
        const trimmed = this.entries.slice(-Math.floor(this.maxEntries / 2)).join('\n') + '\n';
        await fs.writeFile(this.filePath, trimmed, 'utf8');
      }
    }).catch(() => {});
    this.emit('entry', line);
    return line;
  }

  info(message, details) { return this.log('INFO', message, details); }
  warn(message, details) { return this.log('WARN', message, details); }
  error(message, details) { return this.log('ERROR', message, details); }

  getRecent(limit = 250) { return this.entries.slice(-Math.max(1, limit)); }

  async clear() {
    this.entries = [];
    await this._writeChain.catch(() => {});
    await fs.writeFile(this.filePath, '', 'utf8').catch(() => {});
    this.emit('cleared');
  }
}
