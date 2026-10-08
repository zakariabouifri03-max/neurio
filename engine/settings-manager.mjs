import fs from 'node:fs/promises';
import path from 'node:path';

export const CONNECTION_OPTIONS = [1, 2, 4, 8, 16];
export const BANDWIDTH_PRESETS = [0, 100 * 1024, 500 * 1024, 1 * 1024 ** 2, 5 * 1024 ** 2, 10 * 1024 ** 2];

export function defaultSettings(downloadDirectory) {
  return {
    version: 1,
    downloadDirectory,
    connections: 8,
    maxActiveDownloads: 3,
    bandwidthLimitBps: 0,
    autoOrganize: false,
    keepCompletedHistory: 200,
    schedule: {
      enabled: false,
      startTime: '02:00',
      stopTime: '07:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      maxActiveDownloads: 3,
      bandwidthLimitBps: 0,
      pauseOutsideWindow: true,
    },
  };
}

function integerIn(value, min, max, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ? String(value) : fallback;
}

export function normalizeSettings(value, base) {
  const input = value && typeof value === 'object' ? value : {};
  const defaults = base || defaultSettings();
  const connections = CONNECTION_OPTIONS.includes(Number(input.connections)) ? Number(input.connections) : defaults.connections;
  const scheduleInput = input.schedule && typeof input.schedule === 'object' ? input.schedule : {};
  const days = Array.isArray(scheduleInput.days)
    ? [...new Set(scheduleInput.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : defaults.schedule.days;
  return {
    ...defaults,
    ...input,
    version: 1,
    downloadDirectory: typeof input.downloadDirectory === 'string' && input.downloadDirectory.trim()
      ? path.resolve(input.downloadDirectory.trim()) : defaults.downloadDirectory,
    connections,
    maxActiveDownloads: integerIn(input.maxActiveDownloads, 1, 6, defaults.maxActiveDownloads),
    bandwidthLimitBps: Math.max(0, Math.min(1024 ** 3, Number.isFinite(Number(input.bandwidthLimitBps)) ? Math.floor(Number(input.bandwidthLimitBps)) : defaults.bandwidthLimitBps)),
    autoOrganize: Boolean(input.autoOrganize),
    keepCompletedHistory: integerIn(input.keepCompletedHistory, 25, 1000, defaults.keepCompletedHistory),
    schedule: {
      ...defaults.schedule,
      ...scheduleInput,
      enabled: Boolean(scheduleInput.enabled),
      startTime: validTime(scheduleInput.startTime, defaults.schedule.startTime),
      stopTime: validTime(scheduleInput.stopTime, defaults.schedule.stopTime),
      days,
      maxActiveDownloads: integerIn(scheduleInput.maxActiveDownloads, 1, 6, defaults.schedule.maxActiveDownloads),
      bandwidthLimitBps: Math.max(0, Math.min(1024 ** 3, Number.isFinite(Number(scheduleInput.bandwidthLimitBps)) ? Math.floor(Number(scheduleInput.bandwidthLimitBps)) : defaults.schedule.bandwidthLimitBps)),
      pauseOutsideWindow: scheduleInput.pauseOutsideWindow !== false,
    },
  };
}

export class SettingsManager {
  constructor(filePath, defaultDownloadDirectory) {
    this.filePath = filePath;
    this.defaults = defaultSettings(path.resolve(defaultDownloadDirectory));
    this.value = this.defaults;
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.value = normalizeSettings(raw, this.defaults);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.value = this.defaults;
      await this.persist();
    }
    await fs.mkdir(this.value.downloadDirectory, { recursive: true });
    return this.get();
  }

  get() { return structuredClone(this.value); }

  async update(patch) {
    const shallow = { ...this.value, ...(patch || {}) };
    if (patch?.schedule) shallow.schedule = { ...this.value.schedule, ...patch.schedule };
    this.value = normalizeSettings(shallow, this.defaults);
    await fs.mkdir(this.value.downloadDirectory, { recursive: true });
    await this.persist();
    return this.get();
  }

  async persist() {
    const temporary = `${this.filePath}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(this.value, null, 2), 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}
