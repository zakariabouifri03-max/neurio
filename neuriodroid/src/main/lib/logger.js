'use strict';
/** Rotating file + in-memory logger. Streams to the renderer over IPC. */
const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  constructor() {
    this.file = null;
    this.stream = null;
    this.ring = [];
    this.limit = 2000;
    this.level = LEVELS.info;
    this.listeners = new Set();
  }

  attach(logDir, name = 'neuriodroid') {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      // Rotate: keep the last file as .old, start a fresh one each launch.
      const file = path.join(logDir, `${name}.log`);
      if (fs.existsSync(file)) {
        try { fs.rmSync(file + '.old', { force: true }); } catch (_) {}
        try { fs.renameSync(file, file + '.old'); } catch (_) {}
      }
      this.file = file;
      this.stream = fs.createWriteStream(file, { flags: 'a' });
    } catch (_) { this.stream = null; }
    return this;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  write(level, scope, message, meta) {
    if ((LEVELS[level] || 20) < this.level) return;
    const entry = {
      t: Date.now(),
      time: new Date().toISOString(),
      level, scope, message,
      meta: meta === undefined ? undefined : safe(meta),
    };
    this.ring.push(entry);
    if (this.ring.length > this.limit) this.ring.splice(0, this.ring.length - this.limit);
    const line = `[${entry.time}] ${level.toUpperCase()} ${scope}: ${message}` +
      (entry.meta !== undefined ? ' ' + JSON.stringify(entry.meta) : '');
    if (this.stream) { try { this.stream.write(line + '\n'); } catch (_) {} }
    if (level === 'error') console.error(line);
    for (const fn of this.listeners) { try { fn(entry); } catch (_) {} }
  }

  scoped(scope) {
    return {
      debug: (m, x) => this.write('debug', scope, m, x),
      info: (m, x) => this.write('info', scope, m, x),
      warn: (m, x) => this.write('warn', scope, m, x),
      error: (m, x) => this.write('error', scope, m, x),
    };
  }

  tail(n = 400) { return this.ring.slice(-n); }
}

function safe(v) {
  try {
    return JSON.parse(JSON.stringify(v, (k, val) =>
      (val instanceof Error ? { message: val.message, stack: String(val.stack).split('\n').slice(0, 4) } : val)));
  } catch (_) { return String(v); }
}

module.exports = new Logger();
