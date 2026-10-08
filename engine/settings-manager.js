import fs from 'node:fs/promises';
import path from 'node:path';

export const CONNECTION_CHOICES = Object.freeze([1, 2, 4, 8, 16]);
export const BANDWIDTH_PRESETS = Object.freeze([
  { label: 'Unlimited', value: null },
  { label: '100 KB/s', value: 100_000 },
  { label: '500 KB/s', value: 500_000 },
  { label: '1 MB/s', value: 1_000_000 },
  { label: '5 MB/s', value: 5_000_000 },
  { label: '10 MB/s', value: 10_000_000 },
]);

export function defaultSettings(downloadDirectory = '') {
  return {
    downloadDirectory,
    connections: 8,
    maxActiveDownloads: 3,
    bandwidthLimitBps: null,
    autoOrganize: false,
    defaultPriority: 'normal',
    schedule: {
      enabled: false,
      startTime: '02:00',
      stopTime: '07:00',
      maxActiveDownloads: 3,
      bandwidthLimitBps: null,
    },
  };
}

function validRate(value) {
  if (value === null || value === undefined || value === '' || value === 'unlimited') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 10_000 && number <= 1_000_000_000 ? Math.round(number) : null;
}

function validClock(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? value : fallback;
}

export function sanitizeSettings(source = {}, defaultDirectory = '') {
  const defaults = defaultSettings(defaultDirectory);
  const connections = Number(source.connections);
  const schedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : {};
  const priority = ['high', 'normal', 'low'].includes(source.defaultPriority) ? source.defaultPriority : defaults.defaultPriority;
  const directory = typeof source.downloadDirectory === 'string' && source.downloadDirectory.trim()
    ? path.resolve(source.downloadDirectory.trim())
    : defaultDirectory;
  const maxActive = Number(source.maxActiveDownloads);
  const schedulerMax = Number(schedule.maxActiveDownloads);
  return {
    ...defaults,
    ...source,
    downloadDirectory: directory,
    connections: CONNECTION_CHOICES.includes(connections) ? connections : defaults.connections,
    maxActiveDownloads: Number.isInteger(maxActive) ? Math.max(1, Math.min(10, maxActive)) : defaults.maxActiveDownloads,
    bandwidthLimitBps: validRate(source.bandwidthLimitBps),
    autoOrganize: Boolean(source.autoOrganize),
    defaultPriority: priority,
    schedule: {
      enabled: Boolean(schedule.enabled),
      startTime: validClock(schedule.startTime, defaults.schedule.startTime),
      stopTime: validClock(schedule.stopTime, defaults.schedule.stopTime),
      maxActiveDownloads: Number.isInteger(schedulerMax) ? Math.max(1, Math.min(10, schedulerMax)) : defaults.schedule.maxActiveDownloads,
      bandwidthLimitBps: validRate(schedule.bandwidthLimitBps),
    },
  };
}

export class SettingsManager {
  constructor(filePath, defaultDirectory = '') {
    this.filePath = filePath;
    this.defaultDirectory = defaultDirectory;
    this.value = defaultSettings(defaultDirectory);
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.value = sanitizeSettings(parsed, this.defaultDirectory);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error;
      this.value = defaultSettings(this.defaultDirectory);
      await this.save();
    }
    return this.value;
  }

  async update(patch) {
    const merged = { ...this.value, ...patch };
    if (patch?.schedule) merged.schedule = { ...this.value.schedule, ...patch.schedule };
    this.value = sanitizeSettings(merged, this.defaultDirectory);
    await this.save();
    return this.value;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(this.value, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.filePath);
  }
}
