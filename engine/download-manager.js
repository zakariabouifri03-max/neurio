import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpClient, parseContentRange } from './http-client.js';
import { FileWriter } from './file-writer.js';
import { IntegrityChecker, parseChecksums } from './integrity-checker.js';
import { Logger } from './logger.js';
import { SettingsManager, CONNECTION_CHOICES } from './settings-manager.js';
import { BandwidthLimiter } from './bandwidth-limiter.js';
import { ConnectionManager } from './connection-manager.js';
import { RetryManager } from './retry-manager.js';
import { Scheduler } from './scheduler.js';
import { QueueManager } from './queue-manager.js';
import { ResumeManager } from './resume-manager.js';
import { makeSegments, normalizeSegments, sumSegmentBytes, rangesForMetadata } from './segment-manager.js';
import { DownloadError, abortError, friendlyError, isAbortError, statusError } from './errors.js';
import { fileNameFromUrl, getFileCategory, getSafeOrigin, sanitizeFileName } from './format.js';

const STORE_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 30_000;
const CHECKPOINT_BYTES = 8 * 1024 * 1024;
const CHECKPOINT_MS = 2_000;
const ALLOWED_PRIORITIES = new Set(['high', 'normal', 'low']);
const DUPLICATE_POLICIES = new Set(['replace', 'rename', 'skip', 'resume']);

function exists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

function cleanEntry(entry) {
  const copy = { ...entry };
  for (const key of [
    'speedBytesPerSecond', 'averageSpeedBps', 'peakSpeedBps', 'etaSeconds',
    'activeConnections', 'effectiveConnections', 'statusMessage', '_metadataWriteQueue', 'connectionManager',
  ]) delete copy[key];
  return copy;
}

function parseDispositionName(value) {
  if (!value) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8'[^']*')?([^;]+)/i.exec(value);
  if (extended) {
    const raw = extended[1].trim().replace(/^"|"$/g, '').replace(/^UTF-8''/i, '');
    try { return sanitizeFileName(decodeURIComponent(raw)); } catch { /* fall through */ }
  }
  const quoted = /filename\s*=\s*"((?:\\.|[^"])*)"/i.exec(value);
  const bare = /filename\s*=\s*([^;]+)/i.exec(value);
  const raw = quoted?.[1]?.replace(/\\(.)/g, '$1') || bare?.[1]?.trim();
  if (!raw) return null;
  try { return sanitizeFileName(decodeURIComponent(raw)); } catch { return sanitizeFileName(raw); }
}

function normalizedUrl(value) {
  const url = new URL(value);
  url.hash = '';
  return url.toString();
}

function sameUrl(a, b) {
  try { return normalizedUrl(a) === normalizedUrl(b); } catch { return false; }
}

function hasStableValidator(etag, lastModified) {
  return Boolean((etag && !/^W\//i.test(etag)) || lastModified);
}

function sameStableValidator(previous, current) {
  if (previous?.etag && !/^W\//i.test(previous.etag) && current?.etag && !/^W\//i.test(current.etag)) {
    return previous.etag === current.etag;
  }
  if (previous?.lastModified && current?.lastModified) return previous.lastModified === current.lastModified;
  return false;
}

function newAbortController(parentSignal) {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', forward, { once: true });
  }
  return { controller, dispose: () => parentSignal?.removeEventListener('abort', forward) };
}

function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function responseHeaders(response) {
  const headers = {};
  for (const [name, value] of Object.entries(response.headers || {})) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

export class DownloadManager extends EventEmitter {
  constructor({ appDataDirectory, downloadDirectory, httpClient, retryManager, tickMs = 500 } = {}) {
    super();
    if (!appDataDirectory || !downloadDirectory) throw new TypeError('appDataDirectory and downloadDirectory are required.');
    this.appDataDirectory = path.resolve(appDataDirectory);
    this.defaultDownloadDirectory = path.resolve(downloadDirectory);
    this.storePath = path.join(this.appDataDirectory, 'downloads.json');
    this.settingsManager = new SettingsManager(path.join(this.appDataDirectory, 'settings.json'), this.defaultDownloadDirectory);
    this.logger = new Logger(path.join(this.appDataDirectory, 'logs'));
    this.http = httpClient || new HttpClient({ timeoutMs: DEFAULT_TIMEOUT_MS });
    this.retry = retryManager || new RetryManager();
    this.integrity = new IntegrityChecker();
    this.resumeManager = new ResumeManager();
    this.limiter = new BandwidthLimiter(null);
    this.scheduler = new Scheduler(this);
    this.queue = new QueueManager(this);
    this.downloads = new Map();
    this.runners = new Map();
    this.settings = null;
    this.initialized = false;
    this.closing = false;
    this.stateWriteQueue = Promise.resolve();
    this.tickMs = tickMs;
    this.tickTimer = null;
    this.nextQueuePosition = 0;
    this.logger.on('entry', (entry) => this._publish('log', { entry }));
  }

  async initialize() {
    if (this.initialized) return this.getState();
    await fs.mkdir(this.appDataDirectory, { recursive: true });
    await fs.mkdir(this.defaultDownloadDirectory, { recursive: true });
    await this.logger.initialize();
    this.settings = await this.settingsManager.load();
    await fs.mkdir(this.settings.downloadDirectory, { recursive: true });
    this.limiter.setRate(this.settings.bandwidthLimitBps);

    let stored = [];
    try {
      const raw = JSON.parse(await fs.readFile(this.storePath, 'utf8'));
      stored = Array.isArray(raw.downloads) ? raw.downloads : [];
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') this.logger.warn('Saved download list could not be read; starting with an empty list.', { code: error.code });
    }

    for (const saved of stored) {
      if (!saved || typeof saved.id !== 'string' || !saved.finalPath || !saved.partPath) continue;
      let entry = { ...saved };
      try {
        const rawMetadata = await this.resumeManager.load(entry.metadataPath || `${entry.partPath}.json`);
        entry = { ...entry, ...this.#entryFromMetadata(rawMetadata, entry) };
      } catch (error) {
        if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') this.logger.warn('Download metadata could not be loaded.', { id: saved.id, code: error.code });
      }
      if (['checking', 'downloading', 'pausing'].includes(entry.status)) {
        entry.status = 'paused';
        entry.pauseReason = 'restart';
        entry.autoStart = false;
        entry.statusMessage = 'Interrupted when the app closed. Ready to resume.';
        entry.speedBytesPerSecond = 0;
        entry.activeConnections = 0;
      }
      if (entry.status === 'queued') entry.autoStart = false;
      this.#normalizeEntry(entry);
      this.downloads.set(entry.id, entry);
      this.nextQueuePosition = Math.max(this.nextQueuePosition, (entry.queuePosition ?? 0) + 1);
    }

    this.initialized = true;
    this.tickTimer = setInterval(() => this.#sampleSpeeds(), this.tickMs);
    this.tickTimer.unref?.();
    this.scheduler.start();
    await this.persistState();
    this._publishState();
    return this.getState();
  }

  #normalizeEntry(entry) {
    const defaults = {
      priority: 'normal', status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      downloadedBytes: 0, totalBytes: null, activeTimeMs: 0, peakSpeedBps: 0, speedBytesPerSecond: 0,
      averageSpeedBps: 0, etaSeconds: null, activeConnections: 0, selectedConnections: this.settings?.connections || 8,
      effectiveConnections: this.settings?.connections || 8, segments: [], retries: 0, autoStart: false,
      duplicatePolicy: 'rename', userFileName: false, contentType: 'application/octet-stream',
      rangeSupported: false, pauseReason: null, statusMessage: '', checksums: {},
    };
    for (const [key, value] of Object.entries(defaults)) {
      if (entry[key] === undefined) entry[key] = value;
    }
    entry.metadataPath = entry.metadataPath || `${entry.partPath}.json`;
    entry.downloadedBytes = Math.max(0, Number(entry.downloadedBytes) || 0);
    entry.totalBytes = entry.totalBytes == null || entry.totalBytes === ''
      ? null
      : (Number.isSafeInteger(Number(entry.totalBytes)) && Number(entry.totalBytes) >= 0 ? Number(entry.totalBytes) : null);
    entry.segments = Array.isArray(entry.segments) ? entry.segments : [];
    entry.activeTimeMs = Math.max(0, Number(entry.activeTimeMs) || 0);
    entry.retries = Math.max(0, Number(entry.retries) || 0);
    entry.fileName = sanitizeFileName(entry.fileName || path.basename(entry.finalPath));
    entry.source = entry.source || getSafeOrigin(entry.url);
    entry.activeConnections = 0;
    entry.speedBytesPerSecond = 0;
    entry.averageSpeedBps = Number(entry.averageSpeedBps) || 0;
    entry.peakSpeedBps = Number(entry.peakSpeedBps) || 0;
    return entry;
  }

  #entryFromMetadata(metadata, prior) {
    if (!metadata || typeof metadata !== 'object') return {};
    const segments = Array.isArray(metadata.segments) ? metadata.segments : (Array.isArray(metadata.downloadedRanges) ? metadata.downloadedRanges : []);
    return {
      ...prior,
      id: metadata.id || prior.id,
      url: metadata.url || prior.url,
      fileName: metadata.fileName || prior.fileName,
      finalPath: metadata.finalPath || prior.finalPath,
      partPath: metadata.partPath || prior.partPath,
      metadataPath: metadata.metadataPath || prior.metadataPath,
      totalBytes: metadata.totalBytes ?? prior.totalBytes,
      downloadedBytes: metadata.downloadedBytes ?? prior.downloadedBytes,
      segments,
      etag: metadata.etag ?? prior.etag,
      lastModified: metadata.lastModified ?? prior.lastModified,
      rangeSupported: metadata.rangeSupported ?? prior.rangeSupported,
      contentType: metadata.contentType || prior.contentType,
      checksums: metadata.checksums || prior.checksums || {},
      createdAt: metadata.createdAt || prior.createdAt,
      activeTimeMs: metadata.activeTimeMs ?? prior.activeTimeMs,
    };
  }

  get settings() { return this._settings; }
  set settings(value) { this._settings = value; }

  getState() {
    const downloads = [...this.downloads.values()].map((entry) => this.#publicEntry(entry));
    const counts = { active: 0, queued: 0, completed: 0, failed: 0, paused: 0 };
    let completedBytes = 0;
    for (const entry of downloads) {
      if (['checking', 'downloading', 'pausing'].includes(entry.status)) counts.active += 1;
      else if (entry.status === 'queued') counts.queued += 1;
      else if (entry.status === 'completed') { counts.completed += 1; completedBytes += entry.totalBytes || entry.downloadedBytes; }
      else if (entry.status === 'failed') counts.failed += 1;
      else if (entry.status === 'paused') counts.paused += 1;
    }
    return {
      downloads: downloads.sort((a, b) => this.#sortDownloads(a, b)),
      settings: this.settings ? structuredClone(this.settings) : null,
      scheduleActive: this.scheduler.isInsideWindow(new Date(), this.settings?.schedule),
      queuePaused: this.queue.paused,
      interruptedCount: downloads.filter((entry) => entry.status === 'paused' && entry.pauseReason === 'restart').length,
      stats: { ...counts, completedBytes },
    };
  }

  #publicEntry(entry) {
    const downloadedBytes = Math.max(0, Number(entry.downloadedBytes) || 0);
    const totalBytes = Number.isSafeInteger(entry.totalBytes) ? entry.totalBytes : null;
    return {
      id: entry.id,
      url: entry.url,
      source: entry.source || getSafeOrigin(entry.url),
      fileName: entry.fileName,
      finalPath: entry.finalPath,
      directory: entry.directory,
      status: entry.status,
      statusMessage: entry.statusMessage || '',
      progress: totalBytes > 0 ? Math.min(100, downloadedBytes / totalBytes * 100) : 0,
      downloadedBytes,
      totalBytes,
      remainingBytes: totalBytes == null ? null : Math.max(0, totalBytes - downloadedBytes),
      speedBytesPerSecond: Number(entry.speedBytesPerSecond) || 0,
      averageSpeedBps: Number(entry.averageSpeedBps) || 0,
      peakSpeedBps: Number(entry.peakSpeedBps) || 0,
      etaSeconds: Number.isFinite(entry.etaSeconds) ? entry.etaSeconds : null,
      activeConnections: Number(entry.activeConnections) || 0,
      effectiveConnections: Number(entry.effectiveConnections) || 0,
      selectedConnections: Number(entry.selectedConnections) || 1,
      rangeSupported: Boolean(entry.rangeSupported),
      priority: entry.priority,
      queuePosition: entry.queuePosition,
      createdAt: entry.createdAt,
      completedAt: entry.completedAt || null,
      error: entry.error || null,
      message: entry.message || '',
      pauseReason: entry.pauseReason || null,
      retryCount: Number(entry.retries) || 0,
      integrity: entry.integrity || null,
      category: entry.category || null,
      autoStart: Boolean(entry.autoStart),
      contentType: entry.contentType || 'application/octet-stream',
    };
  }

  #sortDownloads(a, b) {
    const order = { downloading: 0, checking: 0, pausing: 0, queued: 1, paused: 2, failed: 3, completed: 4, cancelled: 5, skipped: 6 };
    const stateDiff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (stateDiff) return stateDiff;
    if (a.status === 'queued') return (a.queuePosition ?? 0) - (b.queuePosition ?? 0);
    return String(b.createdAt).localeCompare(String(a.createdAt));
  }

  _publish(type, data = {}) {
    const event = { type, ...data, timestamp: new Date().toISOString() };
    this.emit('event', event);
  }

  _publishState() { this._publish('state', { state: this.getState() }); }

  async addDownload({ url, directory, fileName, connections, priority, startImmediately = true, duplicatePolicy = 'rename' } = {}) {
    this.#assertReady();
    let parsed;
    try { parsed = new URL(String(url || '').trim()); } catch { throw new DownloadError('Enter a valid HTTP or HTTPS URL.', { code: 'EINVAL_URL' }); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      throw new DownloadError('Only HTTP and HTTPS URLs without embedded credentials are supported.', { code: 'EINVAL_URL' });
    }
    parsed.hash = '';
    const normalized = parsed.toString();
    const selectedConnections = CONNECTION_CHOICES.includes(Number(connections)) ? Number(connections) : this.settings.connections;
    const selectedPriority = ALLOWED_PRIORITIES.has(priority) ? priority : this.settings.defaultPriority;
    const policy = DUPLICATE_POLICIES.has(duplicatePolicy) ? duplicatePolicy : 'rename';
    const targetDirectory = path.resolve(directory || this.settings.downloadDirectory);
    await fs.mkdir(targetDirectory, { recursive: true });
    const chosenName = sanitizeFileName(fileName || fileNameFromUrl(normalized));
    let finalPath = path.join(targetDirectory, chosenName);
    let partPath = `${finalPath}.part`;
    let metadataPath = `${partPath}.json`;

    const liveDuplicate = [...this.downloads.values()].find((entry) => sameUrl(entry.url, normalized) && entry.status !== 'cancelled' && entry.status !== 'skipped' && path.resolve(entry.directory) === targetDirectory);
    if (liveDuplicate && liveDuplicate.status !== 'completed') {
      if (policy === 'skip') return { skipped: true, fileName: liveDuplicate.fileName };
      if (policy === 'rename') {
        // An explicit Rename is allowed to create another copy; the path
        // reservation below ensures it cannot share the partial file.
      } else {
        if (policy === 'resume' && startImmediately && ['paused', 'failed', 'queued'].includes(liveDuplicate.status)) await this.resumeDownload(liveDuplicate.id);
        return { download: this.#publicEntry(liveDuplicate), existing: true };
      }
    }

    if (policy === 'resume') {
      if (await exists(metadataPath)) {
        try {
          const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
          if (sameUrl(metadata.url, normalized)) {
            const existingId = metadata.id;
            if (existingId && this.downloads.has(existingId)) return { download: this.#publicEntry(this.downloads.get(existingId)), existing: true };
            const existing = this.#entryFromMetadata(metadata, { ...metadata, status: 'paused', pauseReason: 'resume', directory: targetDirectory, finalPath, partPath, metadataPath, source: getSafeOrigin(normalized) });
            this.#normalizeEntry(existing);
            existing.id = existing.id || randomUUID();
            existing.status = 'paused';
            existing.pauseReason = 'resume';
            existing.autoStart = false;
            this.downloads.set(existing.id, existing);
            await this.persistState();
            this._publishState();
            return { download: this.#publicEntry(existing), existing: true };
          }
        } catch (error) {
          if (error.code !== 'ENOENT') this.logger.warn('An existing partial download could not be resumed.', { fileName: chosenName, code: error.code });
        }
      }
      if (await exists(finalPath)) throw new DownloadError('A completed file with this name already exists. Choose Replace, Rename, or Skip instead of Resume.', { code: 'ERR_DUPLICATE_FILE' });
      throw new DownloadError('There is no matching partial download to resume. Choose Replace, Rename, or Skip.', { code: 'ERR_NO_PARTIAL' });
    }

    if (policy === 'skip' && (await exists(finalPath) || await exists(partPath))) {
      this.logger.info('Duplicate destination skipped by user choice.', { fileName: chosenName });
      return { skipped: true, fileName: chosenName };
    }
    if (policy === 'rename') finalPath = await this.#uniquePath(targetDirectory, chosenName);
    else if (policy === 'replace') {
      // Keep any existing completed file in place until the replacement has
      // passed size and checksum verification.
      const oldMeta = `${finalPath}.part.json`;
      if (await exists(oldMeta)) {
        try {
          const previous = JSON.parse(await fs.readFile(oldMeta, 'utf8'));
          if (!sameUrl(previous.url, normalized)) await this.#removePartialFiles(`${finalPath}.part`, oldMeta);
        } catch { await this.#removePartialFiles(`${finalPath}.part`, oldMeta); }
      }
    }
    partPath = `${finalPath}.part`;
    metadataPath = `${partPath}.json`;
    const entry = this.#normalizeEntry({
      id: randomUUID(),
      url: normalized,
      source: getSafeOrigin(normalized),
      fileName: path.basename(finalPath),
      directory: targetDirectory,
      finalPath,
      partPath,
      metadataPath,
      status: 'queued',
      statusMessage: startImmediately ? 'Waiting for an available download slot.' : 'Added to queue. Start it when you are ready.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      selectedConnections,
      effectiveConnections: selectedConnections,
      priority: selectedPriority,
      queuePosition: this.nextQueuePosition++,
      autoStart: Boolean(startImmediately),
      duplicatePolicy: policy,
      userFileName: Boolean(fileName),
      totalBytes: null,
      downloadedBytes: 0,
      rangeSupported: false,
      etag: null,
      lastModified: null,
      contentType: 'application/octet-stream',
      checksums: {},
      segments: [],
      retries: 0,
      activeTimeMs: 0,
      speedBytesPerSecond: 0,
      averageSpeedBps: 0,
      peakSpeedBps: 0,
      etaSeconds: null,
      activeConnections: 0,
      message: '',
      pauseReason: null,
      error: null,
    });
    this.downloads.set(entry.id, entry);
    await this.persistState();
    this.logger.info(startImmediately ? 'Download added and ready to start.' : 'Download added to the queue.', { id: entry.id, fileName: entry.fileName, source: entry.source, connections: selectedConnections });
    this._publishState();
    this._pumpQueue();
    return { download: this.#publicEntry(entry), existing: false };
  }

  #isPathReserved(filePath, exceptId) {
    const candidate = path.resolve(filePath);
    return [...this.downloads.values()].some((entry) => entry.id !== exceptId && !['cancelled', 'skipped'].includes(entry.status) && path.resolve(entry.finalPath) === candidate);
  }

  async #uniquePath(directory, fileName, exceptId) {
    const extension = path.extname(fileName);
    const base = extension ? fileName.slice(0, -extension.length) : fileName;
    for (let index = 0; index < 10_000; index += 1) {
      const name = index === 0 ? fileName : `${base} (${index})${extension}`;
      const candidate = path.join(directory, name);
      if (!(await exists(candidate)) && !(await exists(`${candidate}.part`)) && !this.#isPathReserved(candidate, exceptId)) return candidate;
    }
    throw new DownloadError('A unique destination name could not be selected.', { code: 'ERR_DUPLICATE_FILE' });
  }

  #metadata(entry) {
    const ranges = rangesForMetadata(entry.segments || []);
    return {
      version: STORE_VERSION,
      id: entry.id,
      url: entry.url,
      fileName: entry.fileName,
      directory: entry.directory,
      finalPath: entry.finalPath,
      partPath: entry.partPath,
      metadataPath: entry.metadataPath,
      totalBytes: entry.totalBytes,
      downloadedBytes: entry.downloadedBytes,
      downloadedRanges: ranges,
      segments: entry.segments,
      etag: entry.etag || null,
      lastModified: entry.lastModified || null,
      rangeSupported: Boolean(entry.rangeSupported),
      contentType: entry.contentType || 'application/octet-stream',
      checksums: entry.checksums || {},
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString(),
      activeTimeMs: entry.activeTimeMs || 0,
    };
  }

  async #persistMetadata(entry) {
    const data = this.#metadata(entry);
    entry._metadataWriteQueue = (entry._metadataWriteQueue || Promise.resolve()).catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(entry.metadataPath), { recursive: true });
      await this.resumeManager.save(entry.metadataPath, data);
    });
    return entry._metadataWriteQueue;
  }

  async persistState() {
    if (!this.initialized && !this.settings) return;
    const snapshot = {
      version: STORE_VERSION,
      savedAt: new Date().toISOString(),
      downloads: [...this.downloads.values()].map((entry) => cleanEntry(entry)),
    };
    this.stateWriteQueue = this.stateWriteQueue.catch(() => {}).then(async () => {
      const temp = `${this.storePath}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      await fs.rename(temp, this.storePath);
    });
    return this.stateWriteQueue;
  }

  #assertReady() {
    if (!this.initialized) throw new Error('DownloadManager.initialize() must be called before use.');
    if (this.closing) throw new Error('The download manager is shutting down.');
  }

  _pumpQueue() {
    if (!this.initialized || this.closing || this.queue.paused || this.scheduler.lastAllowed === false) return;
    const maxActive = this.settings?.schedule?.enabled && this.scheduler.isInsideWindow(new Date(), this.settings.schedule)
      ? this.settings.schedule.maxActiveDownloads
      : this.settings?.maxActiveDownloads || 3;
    const candidates = this.queue.ordered([...this.downloads.values()].filter((entry) => entry.status === 'queued' && entry.autoStart));
    while (this.runners.size < maxActive && candidates.length) {
      const entry = candidates.shift();
      this.#startRunner(entry);
    }
  }

  #startRunner(entry) {
    const runtime = {
      controller: new AbortController(),
      rangeController: null,
      pauseRequested: false,
      cancelRequested: false,
      pauseReason: null,
      activeConnections: 0,
      sessionStartedAt: Date.now(),
      lastSampleAt: Date.now(),
      lastSampleBytes: entry.downloadedBytes || 0,
      sharedError: null,
      writer: null,
      connectionManager: null,
      promise: null,
    };
    this.runners.set(entry.id, runtime);
    entry.status = 'checking';
    entry.statusMessage = 'Checking the server and available download options…';
    entry.error = null;
    entry.pauseReason = null;
    entry.updatedAt = new Date().toISOString();
    entry.activeTimeMs = Math.max(0, Number(entry.activeTimeMs) || 0);
    runtime.promise = this.#executeEntry(entry, runtime).finally(async () => {
      if (runtime.sessionStartedAt) entry.activeTimeMs += Math.max(0, Date.now() - runtime.sessionStartedAt);
      entry.activeConnections = 0;
      entry.speedBytesPerSecond = 0;
      entry.updatedAt = new Date().toISOString();
      this.runners.delete(entry.id);
      await this.persistState().catch(() => {});
      this._publishState();
      this._pumpQueue();
    });
    this._publishState();
  }

  async #executeEntry(entry, runtime) {
    let writer = null;
    try {
      entry.startedAt = entry.startedAt || new Date().toISOString();
      entry.statusMessage = 'Inspecting the server…';
      await this.persistState();
      this.logger.info('Download started.', { id: entry.id, fileName: entry.fileName, source: entry.source, selectedConnections: entry.selectedConnections });
      this._publishState();
      const previousTotalBytes = entry.totalBytes;
      const inspection = await this.retry.run(
        () => this.http.inspect(entry.url, runtime.controller.signal),
        {
          signal: runtime.controller.signal,
          label: 'server check',
          beforeRetry: (error) => {
            if (error.statusCode === 429) {
              entry.effectiveConnections = Math.max(1, Math.ceil((entry.effectiveConnections || entry.selectedConnections) / 2));
              this.logger.warn('The server rate-limited its capability check; the connection limit was reduced and Retry-After will be respected.', { id: entry.id, effectiveConnections: entry.effectiveConnections });
            }
          },
          onRetry: ({ attempt, delayMs, error }) => {
            entry.statusMessage = `Server check retry in ${Math.ceil(delayMs / 1000)}s…`;
            this.logger.warn('Retry started for the server capability check.', { id: entry.id, attempt, delayMs, code: error.code, statusCode: error.statusCode });
            this._publish('download-update', { download: this.#publicEntry(entry) });
          },
        },
      );
      if (runtime.controller.signal.aborted) throw abortError();
      entry.resolvedUrl = inspection.url;
      entry.totalBytes = inspection.totalBytes;
      entry.contentType = inspection.contentType || entry.contentType;
      entry.checksums = inspection.checksums || {};

      const responseName = parseDispositionName(inspection.contentDisposition);
      if (!entry.userFileName && responseName && responseName !== entry.fileName) {
        const next = await this.#resolveHeaderName(entry, responseName);
        if (next?.skipped) {
          entry.status = 'skipped';
          entry.message = 'Skipped because the destination already exists.';
          return;
        }
      }

      const hasSavedBytes = Number(entry.downloadedBytes) > 0 || (entry.segments || []).some((segment) => Number(segment.downloadedBytes) > 0);
      if (hasSavedBytes) {
        const changedSize = previousTotalBytes != null && inspection.totalBytes != null && previousTotalBytes !== inspection.totalBytes;
        const canCompareValidator = hasStableValidator(entry.etag, entry.lastModified) && hasStableValidator(inspection.etag, inspection.lastModified);
        const changedValidator = canCompareValidator && !sameStableValidator(entry, inspection);
        const cannotVerify = !canCompareValidator;
        if (changedSize || changedValidator || cannotVerify) {
          this.logger.warn('Saved partial bytes were discarded because the server version could not be verified safely.', { id: entry.id, fileName: entry.fileName, changedSize, changedValidator, cannotVerify });
          entry.downloadedBytes = 0;
          entry.segments = [];
          await fs.unlink(entry.partPath).catch(() => {});
          await fs.unlink(entry.metadataPath).catch(() => {});
        }
      }

      entry.etag = inspection.etag || null;
      entry.lastModified = inspection.lastModified || null;
      entry.rangeSupported = Boolean(inspection.rangeSupported && Number.isSafeInteger(inspection.totalBytes));
      entry.connectionManager = null;
      const connectionManager = new ConnectionManager(entry.rangeSupported ? entry.selectedConnections : 1, ({ before, effective, selected, reason }) => {
        entry.effectiveConnections = effective;
        this.logger.warn('Adaptive connection limit changed.', { id: entry.id, before, effective, selected, reason });
        this._publish('download-update', { download: this.#publicEntry(entry) });
      });
      runtime.connectionManager = connectionManager;
      entry.effectiveConnections = entry.rangeSupported ? connectionManager.effective : 1;

      const safeForRangeAssembly = entry.rangeSupported && hasStableValidator(entry.etag, entry.lastModified);
      if (safeForRangeAssembly) {
        if (entry.selectedConnections > 1) {
          this.logger.info('Server supports byte ranges; segmented downloads are enabled.', { id: entry.id, fileName: entry.fileName, totalBytes: entry.totalBytes, selectedConnections: entry.selectedConnections });
          entry.statusMessage = `Server supports byte ranges · up to ${entry.selectedConnections} connections`;
        } else {
          this.logger.info('Server supports byte ranges; using the selected single connection.', { id: entry.id, fileName: entry.fileName });
          entry.statusMessage = 'Server supports byte ranges · 1 selected connection';
        }
        let segments = normalizeSegments(entry.segments, entry.totalBytes);
        let reset = !segments;
        if (segments) {
          try {
            const partialStat = await fs.stat(entry.partPath);
            if (partialStat.size !== entry.totalBytes) reset = true;
          } catch { reset = true; }
        }
        if (reset) {
          segments = makeSegments(entry.totalBytes, entry.selectedConnections);
          entry.downloadedBytes = 0;
        } else {
          entry.downloadedBytes = sumSegmentBytes(segments);
        }
        entry.segments = segments;
        writer = await FileWriter.open(entry.partPath, { expectedSize: entry.totalBytes, reset });
        runtime.writer = writer;
        await this.#checkDiskSpace(entry.directory, entry.totalBytes);
        await this.#persistMetadata(entry);
        const ranged = await this.#downloadRanged(entry, runtime, writer, connectionManager);
        if (!ranged) {
          if (runtime.controller.signal.aborted) throw abortError();
          this.logger.warn('Server did not honor a byte-range request. Switching to a normal single connection.', { id: entry.id, fileName: entry.fileName });
          entry.statusMessage = 'Server does not support parallel range downloads. Switching to single connection mode.';
          entry.rangeSupported = false;
          entry.effectiveConnections = 1;
          entry.segments = [];
          entry.downloadedBytes = 0;
          await writer.truncate(0);
          await writer.sync();
          await this.#persistMetadata(entry);
          await this.#downloadSingle(entry, runtime, writer);
        }
      } else {
        if (entry.rangeSupported && !hasStableValidator(entry.etag, entry.lastModified)) {
          this.logger.warn('The server supports byte ranges but supplied no strong ETag or Last-Modified validator. Using one full connection to avoid assembling bytes from different file versions.', { id: entry.id, fileName: entry.fileName });
          entry.statusMessage = 'Ranges detected, but no stable file validator was supplied. Using one connection for version safety.';
        } else if (entry.selectedConnections > 1) {
          this.logger.info('Server does not support byte ranges; using one connection.', { id: entry.id, fileName: entry.fileName, acceptRanges: inspection.acceptRanges || 'not advertised' });
          entry.statusMessage = 'Server does not support parallel range downloads. Switching to single connection mode.';
        } else {
          entry.statusMessage = 'Starting a single-connection download…';
        }
        entry.effectiveConnections = 1;
        entry.segments = [];
        entry.downloadedBytes = 0;
        writer = await FileWriter.open(entry.partPath, { reset: true });
        runtime.writer = writer;
        await this.#checkDiskSpace(entry.directory, entry.totalBytes);
        await this.#persistMetadata(entry);
        await this.#downloadSingle(entry, runtime, writer);
      }

      if (runtime.controller.signal.aborted) throw abortError();
      await writer.sync();
      const finalPartSize = (await writer.stat()).size;
      if (Number.isSafeInteger(entry.totalBytes) && finalPartSize !== entry.totalBytes) {
        throw new DownloadError(`The temporary file has ${finalPartSize} bytes; ${entry.totalBytes} bytes were expected.`, { code: 'ERR_INCOMPLETE_FILE' });
      }
      entry.downloadedBytes = finalPartSize;
      await writer.close();
      writer = null;
      runtime.writer = null;

      entry.statusMessage = 'Verifying file size and available checksums…';
      this._publish('download-update', { download: this.#publicEntry(entry) });
      const verification = await this.integrity.verify(entry.partPath, { expectedSize: entry.totalBytes, checksums: entry.checksums });
      entry.integrity = verification;
      this.logger.info('Integrity verified.', { id: entry.id, fileName: entry.fileName, sizeBytes: verification.size, sizeVerified: verification.sizeVerified, checksumVerified: verification.checksumVerified });

      const destination = await this.#promote(entry);
      entry.finalPath = destination;
      entry.directory = path.dirname(destination);
      entry.status = 'completed';
      entry.completedAt = new Date().toISOString();
      entry.statusMessage = 'Download verified and saved.';
      entry.message = verification.checksumVerified ? 'Size and source checksum verified.' : 'File size verified.';
      entry.error = null;
      entry.pauseReason = null;
      entry.speedBytesPerSecond = 0;
      entry.etaSeconds = 0;
      entry.activeConnections = 0;
      entry.downloadedBytes = verification.size;
      entry.category = this.settings.autoOrganize ? getFileCategory(entry.fileName) : null;
      await fs.unlink(entry.metadataPath).catch(() => {});
      this.logger.info('Download completed.', { id: entry.id, fileName: entry.fileName, sizeBytes: verification.size, finalPath: entry.finalPath });
      this._publish('notification', { level: 'success', title: 'Download complete', message: entry.fileName, id: entry.id });
    } catch (error) {
      if (writer) {
        try { await writer.sync(); } catch { /* keep the original transfer error */ }
        try { await writer.close(); } catch { /* ignored */ }
      }
      runtime.writer = null;
      if (runtime.sharedError && isAbortError(error)) error = runtime.sharedError;
      if (error.statusCode === 403) {
        entry.effectiveConnections = 1;
        this.logger.warn('Server returned HTTP 403; concurrency was reduced to one. No access-control retry will be attempted.', { id: entry.id, fileName: entry.fileName });
      }
      if (runtime.cancelRequested) {
        entry.status = 'cancelled';
        entry.statusMessage = 'Download cancelled.';
        entry.speedBytesPerSecond = 0;
      } else if (runtime.pauseRequested || (isAbortError(error) && runtime.pauseReason)) {
        entry.status = 'paused';
        entry.pauseReason = runtime.pauseReason || 'user';
        entry.autoStart = false;
        entry.statusMessage = entry.pauseReason === 'scheduler' ? 'Paused outside the scheduled window.' : 'Paused. Your verified byte ranges are saved.';
        entry.speedBytesPerSecond = 0;
        this.logger.info('Download paused safely.', { id: entry.id, fileName: entry.fileName, downloadedBytes: entry.downloadedBytes });
      } else if (isAbortError(error)) {
        entry.status = 'paused';
        entry.pauseReason = 'restart';
        entry.autoStart = false;
        entry.statusMessage = 'Interrupted. Resume is available.';
      } else {
        const message = friendlyError(error);
        entry.status = 'failed';
        entry.error = message;
        entry.statusMessage = message;
        entry.speedBytesPerSecond = 0;
        entry.activeConnections = 0;
        this.logger.error('Download failed.', { id: entry.id, fileName: entry.fileName, code: error.code, statusCode: error.statusCode, message: error.message });
        this._publish('notification', { level: 'error', title: 'Download failed', message, id: entry.id });
      }
      entry.updatedAt = new Date().toISOString();
      if (error.code === 'ERR_CHECKSUM_MISMATCH') {
        entry.downloadedBytes = 0;
        entry.segments = [];
        await this.#removePartialFiles(entry.partPath, entry.metadataPath);
      } else if (!runtime.cancelRequested) {
        await this.#persistMetadata(entry).catch((persistError) => this.logger.warn('Could not save recovery metadata.', { id: entry.id, code: persistError.code }));
      }
    } finally {
      if (writer) await writer.close().catch(() => {});
      runtime.writer = null;
      if (entry.status !== 'completed') {
        entry.speedBytesPerSecond = 0;
        entry.activeConnections = 0;
      }
      entry.updatedAt = new Date().toISOString();
      await this.persistState().catch(() => {});
      this._publish('download-update', { download: this.#publicEntry(entry) });
    }
  }

  async #resolveHeaderName(entry, suggestedName) {
    const oldPath = entry.finalPath;
    let target = path.join(entry.directory, sanitizeFileName(suggestedName));
    if (path.resolve(target) === path.resolve(oldPath)) return { changed: false };
    const policy = entry.duplicatePolicy || 'rename';
    const existsAtTarget = await exists(target) || await exists(`${target}.part`) || await exists(`${target}.part.json`) || this.#isPathReserved(target, entry.id);
    if (this.#isPathReserved(target, entry.id) && ['replace', 'resume'].includes(policy)) throw new DownloadError('Another queued or active download is already using the suggested filename. Choose Rename or wait for it to finish.', { code: 'ERR_DUPLICATE_FILE' });
    if (existsAtTarget && policy === 'skip') return { skipped: true };
    if (existsAtTarget && policy === 'rename') target = await this.#uniquePath(entry.directory, path.basename(target), entry.id);
    let resumeMetadata = null;
    if (existsAtTarget && policy === 'resume') {
      const metadataPath = `${target}.part.json`;
      if (await exists(metadataPath)) {
        resumeMetadata = await fs.readFile(metadataPath, 'utf8').then(JSON.parse).catch(() => null);
        if (!resumeMetadata || !sameUrl(resumeMetadata.url, entry.url)) {
          target = await this.#uniquePath(entry.directory, path.basename(target), entry.id);
          resumeMetadata = null;
        }
      } else if (await exists(target)) {
        throw new DownloadError('The suggested destination already exists. Choose Replace, Rename, or Skip.', { code: 'ERR_DUPLICATE_FILE' });
      }
    }
    if (resumeMetadata) {
      entry.fileName = resumeMetadata.fileName || path.basename(target);
      entry.finalPath = resumeMetadata.finalPath || target;
      entry.partPath = resumeMetadata.partPath || `${target}.part`;
      entry.metadataPath = resumeMetadata.metadataPath || `${entry.partPath}.json`;
      entry.totalBytes = resumeMetadata.totalBytes ?? entry.totalBytes;
      entry.downloadedBytes = resumeMetadata.downloadedBytes || 0;
      entry.segments = resumeMetadata.segments || resumeMetadata.downloadedRanges || [];
      entry.etag = resumeMetadata.etag || null;
      entry.lastModified = resumeMetadata.lastModified || null;
      entry.checksums = resumeMetadata.checksums || entry.checksums;
    } else {
      entry.fileName = path.basename(target);
      entry.finalPath = target;
      entry.partPath = `${target}.part`;
      entry.metadataPath = `${entry.partPath}.json`;
    }
    entry.updatedAt = new Date().toISOString();
    this.logger.info('Using the filename supplied by the server.', { id: entry.id, fileName: entry.fileName });
    await this.persistState();
    return { changed: true };
  }

  async #checkDiskSpace(directory, expectedSize) {
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || typeof fs.statfs !== 'function') return;
    try {
      const stat = await fs.statfs(directory, { bigint: true });
      const free = stat.bavail * stat.bsize;
      if (free < BigInt(expectedSize) + 1024n * 1024n) {
        throw new DownloadError('There is not enough free disk space to store the complete file.', { code: 'ENOSPC' });
      }
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      if (['ENOSPC', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      // Some Windows filesystems do not expose statfs; writes remain guarded.
    }
  }

  async #downloadRanged(entry, runtime, writer, connections) {
    const rangeLink = newAbortController(runtime.controller.signal);
    const rangeController = rangeLink.controller;
    runtime.rangeController = rangeController;
    const busy = new Set();
    const state = { fallback: false, error: null, cooldownUntil: 0 };
    const segments = entry.segments;
    const workers = Math.max(1, Math.min(entry.selectedConnections, segments.length));
    this.logger.info('Connections created for segmented transfer.', { id: entry.id, selectedConnections: entry.selectedConnections, workers, segments: segments.length });

    const worker = async () => {
      while (!rangeController.signal.aborted && !state.error && !state.fallback) {
        if (runtime.controller.signal.aborted) throw abortError();
        if (Date.now() < state.cooldownUntil) {
          await wait(Math.min(500, state.cooldownUntil - Date.now()), rangeController.signal);
          continue;
        }
        if (runtime.activeConnections >= connections.effective) {
          await wait(40, rangeController.signal);
          continue;
        }
        const segment = segments.find((candidate) => !candidate.complete && !busy.has(candidate.id));
        if (!segment) {
          if (busy.size === 0) return;
          await wait(30, rangeController.signal);
          continue;
        }
        busy.add(segment.id);
        runtime.activeConnections += 1;
        entry.activeConnections = runtime.activeConnections;
        entry.status = 'downloading';
        entry.statusMessage = `Downloading segment ${segment.id + 1} of ${segments.length}…`;
        this._publish('download-update', { download: this.#publicEntry(entry) });
        try {
          await this.retry.run(
            () => this.#transferSegment(entry, segment, writer, rangeController.signal),
            {
              signal: rangeController.signal,
              label: `segment ${segment.id + 1}`,
              onRetry: ({ attempt, delayMs, error }) => {
                segment.retries = (segment.retries || 0) + 1;
                entry.retries += 1;
                entry.statusMessage = `Retrying segment ${segment.id + 1} in ${Math.ceil(delayMs / 1000)}s…`;
                this.logger.warn('Retry started for a failed segment.', { id: entry.id, segment: segment.id, attempt, delayMs, code: error.code, statusCode: error.statusCode });
                this._publish('download-update', { download: this.#publicEntry(entry) });
              },
              beforeRetry: (error) => {
                if (error.statusCode === 429) {
                  connections.onRateLimited();
                  state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + Math.max(1000, error.retryAfterMs || 0));
                } else if (error.statusCode === 403) {
                  connections.onForbidden();
                } else {
                  connections.onConnectionError();
                }
                entry.effectiveConnections = connections.effective;
              },
              onAttemptSuccess: () => connections.onSuccess(),
            },
          );
        } catch (error) {
          if (error.code === 'ERR_RANGE_UNSUPPORTED') {
            state.fallback = true;
            rangeController.abort();
          } else if (isAbortError(error) && (state.fallback || runtime.controller.signal.aborted)) {
            // Pause/cancel/fallback is handled by the parent runner.
          } else {
            if (error.statusCode === 403) connections.onForbidden();
            state.error = error;
            runtime.sharedError = error;
            rangeController.abort();
          }
        } finally {
          busy.delete(segment.id);
          runtime.activeConnections = Math.max(0, runtime.activeConnections - 1);
          entry.activeConnections = runtime.activeConnections;
          this._publish('download-update', { download: this.#publicEntry(entry) });
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: workers }, () => worker().catch((error) => {
        if (!isAbortError(error) && !state.fallback && !state.error) {
          state.error = error;
          runtime.sharedError = error;
          rangeController.abort();
        }
      })));
    } finally {
      rangeLink.dispose();
      runtime.rangeController = null;
    }
    if (state.error) throw state.error;
    if (runtime.controller.signal.aborted) throw abortError();
    if (state.fallback) return false;
    if (segments.some((segment) => !segment.complete)) throw new DownloadError('One or more file segments did not finish.', { code: 'ERR_INCOMPLETE_FILE' });
    return true;
  }

  async #transferSegment(entry, segment, writer, signal) {
    if (signal?.aborted) throw abortError();
    const requestedStart = segment.start + segment.downloadedBytes;
    if (requestedStart > segment.end) {
      segment.complete = true;
      return;
    }
    const headers = { Range: `bytes=${requestedStart}-${segment.end}` };
    const validator = entry.etag && !/^W\//i.test(entry.etag) ? entry.etag : entry.lastModified;
    if (validator) headers['If-Range'] = validator;
    const response = await this.http.request('GET', entry.resolvedUrl || entry.url, { headers, signal });
    const status = response.statusCode || 0;
    if (status === 200) {
      response.destroy();
      throw new DownloadError('The server ignored the byte-range request.', { code: 'ERR_RANGE_UNSUPPORTED' });
    }
    if (status >= 400) {
      response.destroy();
      throw statusError(status, responseHeaders(response));
    }
    if (status !== 206) {
      response.destroy();
      throw new DownloadError(`Expected HTTP 206 for a byte range but received ${status}.`, { code: 'ERR_RANGE_RESPONSE', statusCode: status });
    }
    const range = parseContentRange(response.headers['content-range']);
    const total = entry.totalBytes;
    if (!range || range.start !== requestedStart || range.end !== segment.end || range.total !== total) {
      response.destroy();
      if (entry.etag || entry.lastModified) {
        throw new DownloadError('The server returned a different file version or an invalid byte range.', { code: 'ERR_ENTITY_CHANGED' });
      }
      throw new DownloadError('The server returned an invalid byte range.', { code: 'ERR_RANGE_RESPONSE' });
    }
    const responseEtag = response.headers.etag;
    const responseModified = response.headers['last-modified'];
    if ((entry.etag && responseEtag && entry.etag !== responseEtag) || (entry.lastModified && responseModified && entry.lastModified !== responseModified)) {
      response.destroy();
      throw new DownloadError('The remote file changed while its segments were downloading.', { code: 'ERR_ENTITY_CHANGED' });
    }

    const expectedBytes = segment.end - requestedStart + 1;
    const responseLength = Number(response.headers['content-length']);
    if (Number.isSafeInteger(responseLength) && responseLength !== expectedBytes) {
      response.destroy();
      throw new DownloadError('The server announced an unexpected segment length.', { code: 'ERR_RANGE_RESPONSE' });
    }
    let receivedThisAttempt = 0;
    let lastPersistAtBytes = segment.downloadedBytes;
    let lastPersistAt = Date.now();
    try {
      for await (const chunk of response) {
        if (signal?.aborted) throw abortError();
        await this.limiter.consume(chunk.length, signal);
        if (segment.downloadedBytes + chunk.length > segment.end - segment.start + 1) {
          throw new DownloadError('The server sent bytes beyond the requested segment.', { code: 'ERR_RANGE_RESPONSE' });
        }
        const position = segment.start + segment.downloadedBytes;
        await writer.write(chunk, position);
        segment.downloadedBytes += chunk.length;
        entry.downloadedBytes += chunk.length;
        receivedThisAttempt += chunk.length;
        const enoughBytes = segment.downloadedBytes - lastPersistAtBytes >= CHECKPOINT_BYTES;
        const enoughTime = Date.now() - lastPersistAt >= CHECKPOINT_MS;
        if (enoughBytes || enoughTime) {
          await writer.sync();
          await this.#persistMetadata(entry);
          lastPersistAtBytes = segment.downloadedBytes;
          lastPersistAt = Date.now();
        }
      }
    } catch (error) {
      await writer.sync().catch(() => {});
      await this.#persistMetadata(entry).catch(() => {});
      throw error;
    }
    await writer.sync();
    const segmentLength = segment.end - segment.start + 1;
    if (segment.downloadedBytes !== segmentLength) {
      await this.#persistMetadata(entry);
      throw new DownloadError(`Segment ${segment.id + 1} ended after ${receivedThisAttempt} new bytes.`, { code: 'ERR_INCOMPLETE_FILE', retryable: true });
    }
    segment.complete = true;
    this.logger.info('Segment completed.', { id: entry.id, segment: segment.id, bytes: segmentLength });
    await this.#persistMetadata(entry);
  }

  async #downloadSingle(entry, runtime, writer) {
    entry.status = 'downloading';
    entry.effectiveConnections = 1;
    entry.activeConnections = 1;
    runtime.activeConnections = 1;
    entry.statusMessage = 'Downloading with one connection…';
    this._publish('download-update', { download: this.#publicEntry(entry) });
    await this.retry.run(async (attempt) => {
      if (runtime.controller.signal.aborted) throw abortError();
      if (attempt > 1) {
        await writer.truncate(0);
        await writer.sync();
        entry.downloadedBytes = 0;
        await this.#persistMetadata(entry);
      } else {
        await writer.truncate(0);
      }
      const response = await this.http.request('GET', entry.resolvedUrl || entry.url, { signal: runtime.controller.signal });
      const status = response.statusCode || 0;
      if (status >= 400) {
        response.destroy();
        throw statusError(status, responseHeaders(response));
      }
      if (status < 200 || status >= 300 || status === 206) {
        response.destroy();
        throw new DownloadError(`The server returned an unexpected HTTP status (${status}) for a normal download.`, { code: `HTTP_${status}`, statusCode: status });
      }
      const announced = Number(response.headers['content-length']);
      const responseTotal = Number.isSafeInteger(announced) && announced >= 0 ? announced : entry.totalBytes;
      if (entry.totalBytes != null && responseTotal != null && responseTotal !== entry.totalBytes) {
        response.destroy();
        throw new DownloadError('The file size changed between the server check and download request.', { code: 'ERR_ENTITY_CHANGED' });
      }
      if (responseTotal != null) entry.totalBytes = responseTotal;
      entry.checksums = { ...entry.checksums, ...parseChecksums(responseHeaders(response)) };
      let position = 0;
      let lastPersistAtBytes = 0;
      let lastPersistAt = Date.now();
      try {
        for await (const chunk of response) {
          if (runtime.controller.signal.aborted) throw abortError();
          await this.limiter.consume(chunk.length, runtime.controller.signal);
          if (Number.isSafeInteger(entry.totalBytes) && position + chunk.length > entry.totalBytes) {
            throw new DownloadError('The server sent more bytes than its declared file size.', { code: 'ERR_ENTITY_CHANGED' });
          }
          await writer.write(chunk, position);
          position += chunk.length;
          entry.downloadedBytes = position;
          if (position - lastPersistAtBytes >= CHECKPOINT_BYTES || Date.now() - lastPersistAt >= CHECKPOINT_MS) {
            await writer.sync();
            await this.#persistMetadata(entry);
            lastPersistAtBytes = position;
            lastPersistAt = Date.now();
          }
        }
      } catch (error) {
        await writer.sync().catch(() => {});
        await this.#persistMetadata(entry).catch(() => {});
        throw error;
      }
      await writer.sync();
      if (Number.isSafeInteger(entry.totalBytes) && position !== entry.totalBytes) {
        await this.#persistMetadata(entry);
        throw new DownloadError(`The server closed after ${position} of ${entry.totalBytes} expected bytes.`, { code: 'ERR_INCOMPLETE_FILE', retryable: true });
      }
      entry.downloadedBytes = position;
      if (entry.totalBytes == null) entry.totalBytes = position;
      await this.#persistMetadata(entry);
      return position;
    }, {
      signal: runtime.controller.signal,
      label: 'single connection',
      onRetry: ({ attempt, delayMs, error }) => {
        entry.retries += 1;
        entry.statusMessage = `Connection interrupted · retry ${attempt + 1} in ${Math.ceil(delayMs / 1000)}s`;
        this.logger.warn('Retry started for the single-connection download.', { id: entry.id, attempt, delayMs, code: error.code, statusCode: error.statusCode });
        this._publish('download-update', { download: this.#publicEntry(entry) });
      },
      beforeRetry: (error) => {
        if (error.statusCode === 429) {
          runtime.connectionManager?.onRateLimited();
          this.limiter.setRate(this.settings.schedule?.enabled && this.scheduler.isInsideWindow() ? this.settings.schedule.bandwidthLimitBps : this.settings.bandwidthLimitBps);
        } else if (error.statusCode === 403) runtime.connectionManager?.onForbidden();
        else runtime.connectionManager?.onConnectionError();
      },
    });
    runtime.activeConnections = 0;
    entry.activeConnections = 0;
  }

  async #promote(entry) {
    let destination = entry.finalPath;
    if (this.settings.autoOrganize) {
      const category = getFileCategory(entry.fileName);
      destination = path.join(entry.directory, category, entry.fileName);
      await fs.mkdir(path.dirname(destination), { recursive: true });
    }
    if (await exists(destination)) {
      if (entry.duplicatePolicy === 'skip') throw new DownloadError('The destination file appeared while the download was running; the verified partial file was kept.', { code: 'ERR_DUPLICATE_FILE' });
      if (entry.duplicatePolicy === 'rename') destination = await this.#uniquePath(path.dirname(destination), path.basename(destination), entry.id);
      if (entry.duplicatePolicy === 'resume') throw new DownloadError('The destination already exists; choose Replace or Rename to finish this download.', { code: 'ERR_DUPLICATE_FILE' });
      if (entry.duplicatePolicy === 'replace') {
        const backup = `${destination}.backup-${Date.now()}`;
        await fs.rename(destination, backup);
        try {
          await fs.rename(entry.partPath, destination);
          await fs.unlink(backup).catch(() => {});
        } catch (error) {
          await fs.rename(backup, destination).catch(() => {});
          throw error;
        }
        return destination;
      }
    }
    await fs.rename(entry.partPath, destination);
    return destination;
  }

  #sampleSpeeds() {
    if (!this.initialized) return;
    const now = Date.now();
    let anyActive = false;
    for (const [id, runtime] of this.runners) {
      const entry = this.downloads.get(id);
      if (!entry) continue;
      anyActive = true;
      const elapsed = Math.max(0.05, (now - runtime.lastSampleAt) / 1000);
      const delta = Math.max(0, entry.downloadedBytes - runtime.lastSampleBytes);
      const speed = delta / elapsed;
      runtime.lastSampleAt = now;
      runtime.lastSampleBytes = entry.downloadedBytes;
      entry.speedBytesPerSecond = speed;
      entry.averageSpeedBps = entry.activeTimeMs + (now - runtime.sessionStartedAt) > 0
        ? entry.downloadedBytes / ((entry.activeTimeMs + now - runtime.sessionStartedAt) / 1000)
        : 0;
      entry.peakSpeedBps = Math.max(entry.peakSpeedBps || 0, speed);
      entry.etaSeconds = entry.totalBytes != null && speed > 0 ? Math.max(0, (entry.totalBytes - entry.downloadedBytes) / speed) : null;
      if (entry.rangeSupported && entry.selectedConnections > 1 && runtime.connectionManager?.effective > 1 && !this.limiter.rate && entry.totalBytes && entry.downloadedBytes < entry.totalBytes * 0.9 && speed > 0) {
        runtime.speedBaselineBps = Math.max(speed, (runtime.speedBaselineBps || speed) * 0.97);
        if (speed < runtime.speedBaselineBps * 0.35) runtime.slowSamples = (runtime.slowSamples || 0) + 1;
        else runtime.slowSamples = 0;
        if (runtime.slowSamples >= 10) {
          runtime.connectionManager.reduce('Sustained transfer speed fell well below its recent baseline; concurrency was reduced.');
          entry.effectiveConnections = runtime.connectionManager.effective;
          runtime.slowSamples = 0;
          runtime.speedBaselineBps = speed;
        }
      }
      entry.activeConnections = runtime.activeConnections || 0;
      entry.effectiveConnections = runtime.connectionManager?.effective || (entry.rangeSupported ? entry.selectedConnections : 1);
      entry.updatedAt = new Date(now).toISOString();
      this._publish('download-update', { download: this.#publicEntry(entry) });
    }
    if (!anyActive) return;
  }

  async pauseDownload(id, reason = 'user') {
    const entry = this.downloads.get(id);
    if (!entry) return { ok: false, error: 'Download not found.' };
    if (entry.status === 'queued') {
      entry.status = 'paused';
      entry.autoStart = false;
      entry.pauseReason = reason;
      entry.statusMessage = 'Paused in queue.';
      entry.speedBytesPerSecond = 0;
      await this.persistState();
      this._publishState();
      return { ok: true };
    }
    const runtime = this.runners.get(id);
    if (!runtime) return { ok: true };
    runtime.pauseRequested = true;
    runtime.pauseReason = reason;
    entry.status = 'pausing';
    entry.statusMessage = reason === 'scheduler' ? 'Stopping safely at the end of current disk writes…' : 'Pausing safely…';
    runtime.controller.abort();
    await runtime.promise;
    return { ok: true };
  }

  async resumeDownload(id) {
    this.#assertReady();
    const entry = this.downloads.get(id);
    if (!entry) throw new DownloadError('Download not found.', { code: 'ERR_NOT_FOUND' });
    if (entry.status === 'completed') return { download: this.#publicEntry(entry) };
    if (entry.status === 'cancelled') throw new DownloadError('This download was cancelled and its partial data was removed. Add the URL again to restart.', { code: 'ERR_CANCELLED' });
    if (entry.status === 'skipped') throw new DownloadError('This download was skipped.', { code: 'ERR_SKIPPED' });
    entry.status = 'queued';
    entry.autoStart = true;
    entry.pauseReason = null;
    entry.error = null;
    entry.statusMessage = 'Waiting for an available download slot.';
    entry.message = '';
    entry.updatedAt = new Date().toISOString();
    await this.persistState();
    this.logger.info('Download resumed or queued for resume.', { id: entry.id, fileName: entry.fileName, downloadedBytes: entry.downloadedBytes });
    this._publishState();
    this._pumpQueue();
    return { download: this.#publicEntry(entry) };
  }

  async cancelDownload(id) {
    const entry = this.downloads.get(id);
    if (!entry) return { ok: false, error: 'Download not found.' };
    const runtime = this.runners.get(id);
    if (runtime) {
      runtime.cancelRequested = true;
      runtime.pauseRequested = false;
      runtime.controller.abort();
      await runtime.promise;
    }
    await this.#removePartialFiles(entry.partPath, entry.metadataPath);
    entry.status = 'cancelled';
    entry.statusMessage = 'Download cancelled. Incomplete data was removed.';
    entry.message = '';
    entry.error = null;
    entry.downloadedBytes = 0;
    entry.segments = [];
    entry.speedBytesPerSecond = 0;
    entry.activeConnections = 0;
    entry.autoStart = false;
    entry.updatedAt = new Date().toISOString();
    this.logger.info('Download cancelled and temporary data removed.', { id, fileName: entry.fileName });
    await this.persistState();
    this._publishState();
    this._pumpQueue();
    return { ok: true };
  }

  async removeDownload(id) {
    const entry = this.downloads.get(id);
    if (!entry) return { ok: false };
    if (['checking', 'downloading', 'pausing'].includes(entry.status)) await this.cancelDownload(id);
    this.downloads.delete(id);
    await this.persistState();
    this._publishState();
    return { ok: true };
  }

  async pauseAll() { await this.queue.pauseAll(); }
  async resumeAll() { await this.queue.resumeAll(); }
  async cancelAll() { await this.queue.cancelAll(); }

  async reorderQueue(ids) { return this.queue.reorder(ids); }

  async setPriority(id, priority) {
    const entry = this.downloads.get(id);
    if (!entry) throw new DownloadError('Download not found.', { code: 'ERR_NOT_FOUND' });
    if (!ALLOWED_PRIORITIES.has(priority)) throw new DownloadError('Choose High, Normal or Low priority.', { code: 'ERR_INVALID_PRIORITY' });
    entry.priority = priority;
    entry.updatedAt = new Date().toISOString();
    await this.persistState();
    this.logger.info('Download priority changed.', { id, fileName: entry.fileName, priority });
    this._publishState();
    this._pumpQueue();
    return this.#publicEntry(entry);
  }

  async updateSettings(patch) {
    this.#assertReady();
    this.settings = await this.settingsManager.update(patch || {});
    await fs.mkdir(this.settings.downloadDirectory, { recursive: true });
    this.limiter.setRate(this.settings.schedule?.enabled && this.scheduler.isInsideWindow() ? this.settings.schedule.bandwidthLimitBps : this.settings.bandwidthLimitBps);
    this.scheduler.lastAllowed = null;
    await this.scheduler.tick();
    await this.persistState();
    this.logger.info('Settings updated.', { downloadDirectory: this.settings.downloadDirectory, connections: this.settings.connections, maxActiveDownloads: this.settings.maxActiveDownloads, autoOrganize: this.settings.autoOrganize });
    this._publishState();
    this._pumpQueue();
    return structuredClone(this.settings);
  }

  async #removePartialFiles(partPath, metadataPath = `${partPath}.json`) {
    await fs.unlink(partPath).catch(() => {});
    await fs.unlink(metadataPath).catch(() => {});
    await fs.unlink(`${metadataPath}.tmp`).catch(() => {});
  }

  async #onScheduleStart() {
    this.limiter.setRate(this.settings.schedule.bandwidthLimitBps);
    for (const entry of this.downloads.values()) {
      if (entry.status === 'paused' && entry.pauseReason === 'scheduler') {
        entry.status = 'queued';
        entry.autoStart = true;
        entry.pauseReason = null;
        entry.statusMessage = 'Scheduled download resumed.';
      }
    }
    await this.persistState();
    this._publishState();
    this._pumpQueue();
  }

  async #onScheduleStop() {
    await Promise.all([...this.runners.keys()].map((id) => this.pauseDownload(id, 'scheduler')));
    this.limiter.setRate(this.settings.bandwidthLimitBps);
  }

  async logs(limit = 200) { return this.logger.recent(limit); }
  async readLogs() { return this.logger.readFile(); }

  async shutdown() {
    if (this.closing) return;
    this.closing = true;
    this.scheduler.stop();
    if (this.tickTimer) clearInterval(this.tickTimer);
    const active = [...this.runners.entries()];
    for (const [, runtime] of active) {
      runtime.pauseRequested = true;
      runtime.pauseReason = 'restart';
      runtime.controller.abort();
    }
    await Promise.all(active.map(([, runtime]) => runtime.promise.catch(() => {})));
    for (const entry of this.downloads.values()) {
      if (entry.status === 'queued') entry.autoStart = false;
      if (entry.status === 'paused' && entry.pauseReason !== 'user' && entry.pauseReason !== 'scheduler') entry.pauseReason = 'restart';
      await this.#persistMetadata(entry).catch(() => {});
    }
    await this.persistState().catch(() => {});
    await this.logger.writeQueue.catch(() => {});
    this.http.close();
  }
}
