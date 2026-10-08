import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DownloadError, RangeFallbackError, PauseError, CancelError, errorFromHttpStatus, friendlyError } from './errors.mjs';
import { HttpClient, parseContentRange, sanitizeFilename, validateHttpUrl, getStableValidator } from './http-client.mjs';
import { FileWriter } from './file-writer.mjs';
import { ResumeManager } from './resume-manager.mjs';
import { RetryManager, parseRetryAfter } from './retry-manager.mjs';
import { BandwidthLimiter } from './bandwidth-limiter.mjs';
import { createSegments, segmentBytes, segmentsCoverFile } from './segment-manager.mjs';
import { IntegrityChecker } from './integrity-checker.mjs';
import { ConnectionManager } from './connection-manager.mjs';
import { QueueManager } from './queue-manager.mjs';
import { Scheduler } from './scheduler.mjs';
import { SettingsManager, CONNECTION_OPTIONS } from './settings-manager.mjs';
import { BrowserBridge } from './browser-bridge.mjs';
import { availableName, categoryForFilename, exists } from './path-utils.mjs';
import { Logger } from './logger.mjs';

const QUEUED_STATES = new Set(['queued', 'scheduled', 'paused', 'retrying', 'checking', 'failed', 'needs-attention']);
const ACTIVE_STATES = new Set(['checking', 'downloading', 'retrying']);
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'skipped']);
const PRIORITIES = new Set(['high', 'normal', 'low']);

function safeDisplayUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return String(value || ''); }
}

function calcDownloaded(job) {
  if (!Array.isArray(job.segments)) return 0;
  return segmentBytes(job.segments);
}

function normalizeError(error) {
  return {
    message: friendlyError(error),
    code: error?.code || 'DOWNLOAD_ERROR',
    status: error?.status || null,
  };
}

function metadataBelongsToJob(metadata, job) {
  return Boolean(metadata && metadata.url === job.url && (!metadata.id || metadata.id === job.id));
}

function compareVersion(previous, info) {
  if (previous.size != null && info.size != null && previous.size !== info.size) return false;
  const oldValidator = previous.validator || getStableValidator(previous);
  const newValidator = info.validator || getStableValidator(info);
  if (!oldValidator || !newValidator) return false;
  return oldValidator === newValidator;
}

function retryAfterFrom(error) {
  if (error?.details?.retryAfter != null) return error.details.retryAfter;
  return null;
}

function responseMatchesInfo(response, info) {
  const etag = response.headers?.etag;
  const lastModified = response.headers?.['last-modified'];
  if (info?.etag && etag && etag !== info.etag) return false;
  if (info?.lastModified && lastModified && lastModified !== info.lastModified) return false;
  return true;
}

function rangeExpected(response, start, end, size) {
  const range = parseContentRange(response.headers['content-range']);
  if (!range || range.start !== start || range.end !== end) return false;
  if (range.total != null && size != null && range.total !== size) return false;
  if (range.total == null && size != null) return false;
  return true;
}

function makeRuntimeFields(job) {
  return {
    ...job,
    ownsPart: Boolean(job.ownsPart),
    deferred: Boolean(job.deferred),
    _running: false,
    _runController: null,
    _runPromise: null,
    _lastEmitAt: 0,
    _lastMetaSave: 0,
    _metadataChain: Promise.resolve(),
    _sessionStartedAt: null,
    _sessionBytes: 0,
    _windowStart: Date.now(),
    _windowBytes: 0,
    _lastByteAt: 0,
    _lastSpeedBps: 0,
    _rangeFallbackRequested: false,
    _verified: false,
  };
}

export class DownloadManager extends EventEmitter {
  constructor({
    appDataDirectory,
    defaultDownloadDirectory,
    browserInboxDirectory = null,
    logger = null,
    httpClient = null,
    retryManager = null,
    enableBrowserBridge = false,
    schedulerIntervalMs = 15_000,
    metricsIntervalMs = 500,
  }) {
    super();
    if (!appDataDirectory || !defaultDownloadDirectory) throw new TypeError('appDataDirectory and defaultDownloadDirectory are required.');
    this.appDataDirectory = path.resolve(appDataDirectory);
    this.defaultDownloadDirectory = path.resolve(defaultDownloadDirectory);
    this.statePath = path.join(this.appDataDirectory, 'downloads-state.json');
    this.settingsStore = new SettingsManager(path.join(this.appDataDirectory, 'settings.json'), this.defaultDownloadDirectory);
    this.logger = logger || new Logger(path.join(this.appDataDirectory, 'logs'));
    this.http = httpClient || new HttpClient({ logger: this.logger });
    this.retry = retryManager || new RetryManager();
    this.resumeManager = new ResumeManager();
    this.integrity = new IntegrityChecker();
    this.limiter = new BandwidthLimiter(0);
    this.connections = new ConnectionManager(this.logger);
    this.queue = new QueueManager();
    this.jobs = new Map();
    this.settings = null;
    this.scheduler = null;
    this.browserBridge = null;
    this.browserInboxDirectory = browserInboxDirectory || path.join(this.appDataDirectory, 'browser-inbox');
    this.enableBrowserBridge = enableBrowserBridge;
    this.schedulerIntervalMs = schedulerIntervalMs;
    this.metricsIntervalMs = metricsIntervalMs;
    this.metricsTimer = null;
    this.initialized = false;
    this.shuttingDown = false;
    this.schedulerInside = true;
    this._stateChain = Promise.resolve();
    this._pathPreparationChain = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return this.getState();
    await fs.mkdir(this.appDataDirectory, { recursive: true });
    await this.logger.initialize?.();
    this.settings = await this.settingsStore.initialize();
    this.limiter.setLimit(this.settings.bandwidthLimitBps);
    await fs.mkdir(this.settings.downloadDirectory, { recursive: true });
    await this._restoreState();
    this.scheduler = new Scheduler({
      getSchedule: () => this.settings.schedule,
      intervalMs: this.schedulerIntervalMs,
      onWindowChange: inside => this._onScheduleWindowChange(inside),
      onTick: inside => this._onSchedulerTick(inside),
    });
    this.scheduler.start();
    this.metricsTimer = setInterval(() => this._tickMetrics(), this.metricsIntervalMs);
    this.metricsTimer.unref?.();
    this.initialized = true;
    if (this.enableBrowserBridge) {
      this.browserBridge = new BrowserBridge({
        inboxDirectory: this.browserInboxDirectory,
        logger: this.logger,
        onUrl: url => this.addUrl(url, { conflictAction: 'ask', source: 'browser' }),
      });
      await this.browserBridge.initialize();
    }
    this.initialized = true;
    this.logger.info('Download manager ready.', { downloadDirectory: this.settings.downloadDirectory });
    await this._persistState();
    this._emit('state', { state: this.getState() });
    this._pump();
    return this.getState();
  }

  async _restoreState() {
    let parsed = [];
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      parsed = Array.isArray(raw?.jobs) ? raw.jobs : [];
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) this.logger.warn('Could not read the saved download queue; starting with an empty queue.', { reason: error.message });
    }
    const retained = parsed.slice(-1000);
    for (const record of retained) {
      if (!record || typeof record.id !== 'string' || typeof record.url !== 'string') continue;
      try { validateHttpUrl(record.url); } catch { continue; }
      const job = makeRuntimeFields({
        ...record,
        status: ACTIVE_STATES.has(record.status) ? 'paused' : (record.status || 'paused'),
        speedBps: 0,
        averageSpeedBps: 0,
        peakSpeedBps: Number(record.peakSpeedBps) || 0,
        activeConnections: 0,
        connectionLimit: Number(record.connectionLimit) || this.settings.connections,
        error: ['failed', 'needs-attention'].includes(record.status) ? record.error : null,
        interrupted: ACTIVE_STATES.has(record.status) || record.status === 'downloading',
        ownsPart: Boolean(record.ownsPart),
        deferred: Boolean(record.deferred),
      });
      if (!Array.isArray(job.segments)) job.segments = [];
      job.downloadedBytes = calcDownloaded(job);
      if (job.status === 'completed' && job.finalPath && !(await exists(job.finalPath))) {
        job.status = 'failed';
        job.error = { message: 'The completed file is no longer present in its destination folder.', code: 'FILE_MISSING', status: null };
      }
      this.jobs.set(job.id, job);
      if (job.status === 'paused' && job.partPath && await exists(job.partPath)) {
        this.logger.info('Interrupted download is available to resume.', { fileName: job.fileName, jobId: job.id });
      }
    }
    // Recover a sidecar if the queue-state write was interrupted after its metadata was saved.
    await this._scanForUnlistedPartials();
    for (const job of this.jobs.values()) {
      if (job.interrupted) this._emitJob(job);
    }
  }

  async _scanForUnlistedPartials() {
    const directory = this.settings.downloadDirectory;
    let names;
    try { names = await fs.readdir(directory); } catch { return; }
    for (const name of names.filter(value => value.endsWith('.part.json'))) {
      const metadataPath = path.join(directory, name);
      const metadata = await this.resumeManager.load(metadataPath);
      if (!metadata || this.jobs.has(metadata.id)) continue;
      try { validateHttpUrl(metadata.url); } catch { continue; }
      if (!metadata.partPath || !await exists(metadata.partPath)) continue;
      const job = makeRuntimeFields({
        id: metadata.id || randomUUID(),
        url: metadata.url,
        fileName: metadata.fileName || path.basename(name, '.part.json'),
        outputDirectory: metadata.outputDirectory || directory,
        finalPath: metadata.finalPath,
        partPath: metadata.partPath,
        metadataPath,
        size: metadata.size,
        info: {
          size: metadata.size,
          etag: metadata.etag,
          lastModified: metadata.lastModified,
          supportsRanges: Boolean(metadata.supportsRanges),
          contentType: metadata.contentType,
          checksums: {},
        },
        validator: metadata.validator,
        segments: metadata.segments,
        downloadedBytes: calcDownloaded({ segments: metadata.segments }),
        status: 'paused',
        priority: 'normal',
        queueOrder: this.jobs.size,
        createdAt: metadata.createdAt || new Date().toISOString(),
        updatedAt: metadata.updatedAt || new Date().toISOString(),
        source: 'recovered',
        interrupted: true,
        ownsPart: true,
      });
      this.jobs.set(job.id, job);
      this.logger.info('Recovered an interrupted download from its sidecar metadata.', { fileName: job.fileName, jobId: job.id });
    }
  }

  _persistable(job) {
    const fields = [
      'id', 'url', 'fileName', 'outputDirectory', 'finalPath', 'partPath', 'metadataPath', 'size', 'info', 'validator',
      'segments', 'downloadedBytes', 'status', 'priority', 'queueOrder', 'createdAt', 'updatedAt', 'completedAt',
      'connectionLimit', 'requestedConnections', 'peakSpeedBps', 'error', 'source', 'conflictAction', 'category',
      'verifiedBy', 'interrupted', 'targetExists', 'targetKind', 'deferred', 'ownsPart',
    ];
    const output = {};
    for (const field of fields) if (job[field] !== undefined) output[field] = job[field];
    return output;
  }

  async _persistState() {
    if (!this.settings) return;
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      jobs: [...this.jobs.values()].map(job => this._persistable(job)),
    };
    const temp = `${this.statePath}.tmp`;
    this._stateChain = this._stateChain.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
      await fs.rename(temp, this.statePath);
    }).catch(error => this.logger.warn('Could not save download queue state.', { reason: error.message }));
    return this._stateChain;
  }

  _emit(type, payload = {}) {
    this.emit('event', { type, at: new Date().toISOString(), ...payload });
  }

  _snapshotJob(job) {
    const downloadedBytes = calcDownloaded(job);
    const now = Date.now();
    const speedBps = job._lastByteAt && now - job._lastByteAt > 1500 ? 0 : Number(job.speedBps) || 0;
    const total = Number.isSafeInteger(job.size) && job.size >= 0 ? job.size : null;
    const remaining = total == null ? null : Math.max(0, total - downloadedBytes);
    const eta = speedBps > 0 && remaining != null ? Math.ceil(remaining / speedBps) : null;
    const segmentCount = job.segments?.length || 1;
    return {
      id: job.id,
      url: safeDisplayUrl(job.url),
      host: (() => { try { return new URL(job.url).host; } catch { return ''; } })(),
      fileName: job.fileName || 'Preparing download…',
      finalPath: job.finalPath || null,
      outputDirectory: job.outputDirectory,
      status: job.status,
      priority: job.priority || 'normal',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt || null,
      size: total,
      downloadedBytes,
      remainingBytes: remaining,
      progress: total ? Math.min(100, (downloadedBytes / total) * 100) : (job.status === 'completed' ? 100 : 0),
      speedBps,
      averageSpeedBps: Number(job.averageSpeedBps) || 0,
      peakSpeedBps: Number(job.peakSpeedBps) || 0,
      etaSeconds: eta,
      activeConnections: Number(job.activeConnections) || 0,
      connectionLimit: Math.max(1, Number(job.connectionLimit) || 1),
      requestedConnections: Number(job.requestedConnections) || this.settings?.connections || 8,
      segmentCount,
      supportsRanges: Boolean(job.info?.supportsRanges),
      contentType: job.info?.contentType || null,
      category: job.category || (job.fileName ? categoryForFilename(job.fileName) : 'Other'),
      error: job.error || null,
      targetExists: Boolean(job.targetExists),
      targetKind: job.targetKind || null,
      verifiedBy: job.verifiedBy || null,
      source: job.source || 'manual',
      interrupted: Boolean(job.interrupted),
      deferred: Boolean(job.deferred),
    };
  }

  getState() {
    const snapshots = [...this.jobs.values()].map(job => this._snapshotJob(job));
    const active = snapshots.filter(job => ACTIVE_STATES.has(job.status));
    const queue = this.queue.order([...this.jobs.values()].filter(job => QUEUED_STATES.has(job.status))).map(job => this._snapshotJob(job));
    const completed = snapshots.filter(job => job.status === 'completed').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    return {
      app: { name: 'AI Download Manager Pro', version: '1.0.0' },
      settings: this.settings ? structuredClone(this.settings) : null,
      scheduler: {
        enabled: Boolean(this.settings?.schedule?.enabled),
        insideWindow: this.scheduler ? this.scheduler.current() : true,
        nextState: this.settings?.schedule?.enabled ? (this.scheduler?.current() ? 'active' : 'waiting') : 'inactive',
      },
      stats: {
        activeDownloads: active.length,
        queuedDownloads: queue.length,
        completedDownloads: completed.length,
        currentSpeedBps: active.reduce((sum, job) => sum + job.speedBps, 0),
        averageSpeedBps: active.reduce((sum, job) => sum + job.averageSpeedBps, 0),
        peakSpeedBps: active.reduce((sum, job) => sum + job.peakSpeedBps, 0),
        activeConnections: active.reduce((sum, job) => sum + job.activeConnections, 0),
      },
      downloads: snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      queue,
      completed,
    };
  }

  getLogs(limit = 250) { return this.logger.getRecent(limit); }

  async inspectUrl(address, { fileName = null, outputDirectory = null } = {}) {
    const url = validateHttpUrl(address);
    const info = await this.http.inspect(url.href);
    const name = sanitizeFilename(fileName || info.fileName, info.fileName || 'download');
    const directory = path.resolve(outputDirectory || this.settings.downloadDirectory);
    const category = this.settings.autoOrganize ? categoryForFilename(name) : null;
    const targetPath = path.join(directory, ...(category ? [category] : []), name);
    const partialPath = path.join(directory, `${name}.part`);
    let activeMatch = null;
    for (const job of this.jobs.values()) {
      if (job.url === url.href && ['paused', 'failed', 'scheduled', 'queued', 'checking', 'downloading', 'retrying', 'needs-attention'].includes(job.status) && job.partPath && await exists(job.partPath)) {
        activeMatch = job;
        break;
      }
    }
    return {
      url: safeDisplayUrl(url.href),
      fileName: name,
      size: info.size,
      contentType: info.contentType,
      supportsRanges: Boolean(info.supportsRanges),
      validatorAvailable: Boolean(info.validator),
      etag: info.etag,
      lastModified: info.lastModified,
      targetPath,
      targetExists: await exists(targetPath),
      partialExists: await exists(partialPath),
      resumableDownloadId: activeMatch && activeMatch.status !== 'needs-attention' ? activeMatch.id : null,
      resumableStatus: activeMatch && activeMatch.status !== 'needs-attention' ? activeMatch.status : null,
      note: info.supportsRanges
        ? (info.validator ? 'The server confirmed byte-range support and provides a stable validator.' : 'The server supports ranges but did not provide a stable validator; using one connection avoids mixing file versions.')
        : 'The server does not support byte ranges. The engine will use a normal single connection.',
    };
  }

  async addUrl(address, options = {}) {
    const url = validateHttpUrl(address);
    if (!this.initialized) await this.initialize();
    const settings = this.settings;
    const priority = PRIORITIES.has(String(options.priority).toLowerCase()) ? String(options.priority).toLowerCase() : 'normal';
    const job = makeRuntimeFields({
      id: randomUUID(),
      url: url.href,
      fileName: options.fileName ? sanitizeFilename(options.fileName) : null,
      outputDirectory: path.resolve(options.outputDirectory || settings.downloadDirectory),
      finalPath: null,
      partPath: null,
      metadataPath: null,
      size: null,
      info: null,
      validator: null,
      segments: [],
      downloadedBytes: 0,
      status: 'queued',
      deferred: options.startNow === false,
      ownsPart: false,
      priority,
      queueOrder: Date.now(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requestedConnections: CONNECTION_OPTIONS.includes(Number(options.connections)) ? Number(options.connections) : settings.connections,
      connectionLimit: Number(options.connections) || settings.connections,
      speedBps: 0,
      averageSpeedBps: 0,
      peakSpeedBps: 0,
      activeConnections: 0,
      source: options.source || 'manual',
      conflictAction: ['replace', 'rename', 'skip', 'ask'].includes(options.conflictAction) ? options.conflictAction : 'ask',
      targetExists: false,
      targetKind: null,
      error: null,
    });
    this.jobs.set(job.id, job);
    this.logger.info('Download added to the queue.', { fileName: job.fileName || safeDisplayUrl(job.url), host: new URL(job.url).host, jobId: job.id });
    this._emitJob(job);
    await this._persistState();
    this._pump();
    return this._snapshotJob(job);
  }

  async addMany(urls, options = {}) {
    const added = [];
    for (const address of urls) {
      try { added.push(await this.addUrl(address, options)); }
      catch (error) { added.push({ error: friendlyError(error), url: safeDisplayUrl(String(address)) }); }
    }
    return added;
  }

  async resolveDuplicate(id, action) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'needs-attention') throw new Error('This download is not waiting for a duplicate-file decision.');
    if (action === 'resume') {
      const existing = [...this.jobs.values()].find(other => other.id !== job.id && other.url === job.url && other.partPath && !['completed', 'cancelled', 'skipped'].includes(other.status));
      if (!existing) throw new Error('No resumable download for this URL was found.');
      job.status = 'skipped';
      job.error = null;
      job.updatedAt = new Date().toISOString();
      await this._persistState();
      if (['paused', 'failed', 'scheduled', 'retrying'].includes(existing.status) || (existing.status === 'queued' && existing.deferred)) return this.resume(existing.id);
      return this._snapshotJob(existing);
    }
    if (!['replace', 'rename', 'skip'].includes(action)) throw new Error('Choose Replace, Rename, Skip, or Resume existing.');
    job.conflictAction = action;
    job.status = action === 'skip' ? 'skipped' : 'queued';
    job.targetExists = false;
    job.targetKind = null;
    job.error = null;
    job.updatedAt = new Date().toISOString();
    if (action === 'skip') this.logger.info('Download skipped because a destination file already exists.', { fileName: job.fileName, jobId: job.id });
    this._emitJob(job);
    await this._persistState();
    if (action !== 'skip') this._pump();
    return this._snapshotJob(job);
  }

  async pause(id) {
    const job = this.jobs.get(id);
    if (!job || TERMINAL_STATES.has(job.status)) return null;
    if (job.status === 'needs-attention') return this._snapshotJob(job);
    job.status = 'paused';
    job.interrupted = false;
    job.updatedAt = new Date().toISOString();
    if (job._runController && !job._runController.signal.aborted) job._runController.abort(new PauseError());
    this._emitJob(job);
    await this._persistState();
    await job._runPromise?.catch(() => {});
    await this._saveMetadata(job, true).catch(() => {});
    this.logger.info('Download paused.', { fileName: job.fileName, jobId: job.id });
    this._emitJob(job);
    return this._snapshotJob(job);
  }

  async resume(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'queued' && job.deferred) {
      job.deferred = false;
      job.updatedAt = new Date().toISOString();
      this._emitJob(job);
      await this._persistState();
      this._pump();
      return this._snapshotJob(job);
    }
    if (!['paused', 'failed', 'scheduled', 'retrying'].includes(job.status)) return this._snapshotJob(job);
    if (job.status === 'failed' && job.error?.code === 'INTEGRITY_ERROR') {
      await this._resetPartial(job, 'The previous file failed integrity verification; starting a clean attempt.');
    }
    job.status = this.settings.schedule.enabled && !this.scheduler?.current() ? 'scheduled' : 'queued';
    job.deferred = false;
    job.error = null;
    job.interrupted = false;
    job.speedBps = 0;
    job.averageSpeedBps = 0;
    job._sessionBytes = 0;
    job._sessionStartedAt = null;
    job.updatedAt = new Date().toISOString();
    this.logger.info('Download resumed or queued for resume.', { fileName: job.fileName, jobId: job.id });
    this._emitJob(job);
    await this._persistState();
    this._pump();
    return this._snapshotJob(job);
  }

  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job || TERMINAL_STATES.has(job.status)) return null;
    job.status = 'cancelled';
    job.error = null;
    job.updatedAt = new Date().toISOString();
    if (job._runController && !job._runController.signal.aborted) job._runController.abort(new CancelError());
    this._emitJob(job);
    await this._persistState();
    await job._runPromise?.catch(() => {});
    const savedMetadata = job.metadataPath ? await this.resumeManager.load(job.metadataPath) : null;
    const ownsPartial = Boolean(job.ownsPart || (savedMetadata?.id === job.id && savedMetadata?.url === job.url));
    if (ownsPartial && job.partPath) await fs.rm(job.partPath, { force: true }).catch(() => {});
    if (ownsPartial && job.metadataPath) await this.resumeManager.remove(job.metadataPath);
    job.ownsPart = false;
    this.logger.info(ownsPartial ? 'Download cancelled; its incomplete temporary file was removed.' : 'Queued download cancelled; no existing temporary file was removed.', { fileName: job.fileName, jobId: job.id });
    this._emitJob(job);
    await this._persistState();
    return this._snapshotJob(job);
  }

  async pauseAll() {
    const active = [...this.jobs.values()].filter(job => ['downloading', 'checking', 'retrying'].includes(job.status));
    await Promise.all(active.map(job => this.pause(job.id)));
    return this.getState();
  }

  async resumeAll() {
    const jobs = [...this.jobs.values()].filter(job => ['paused', 'failed', 'scheduled'].includes(job.status) || (job.status === 'queued' && job.deferred));
    await Promise.all(jobs.map(job => this.resume(job.id)));
    return this.getState();
  }

  async cancelAll() {
    const jobs = [...this.jobs.values()].filter(job => !TERMINAL_STATES.has(job.status));
    await Promise.all(jobs.map(job => this.cancel(job.id)));
    return this.getState();
  }

  async retry(id) { return this.resume(id); }

  async setPriority(id, priority) {
    const job = this.jobs.get(id);
    if (!job || !PRIORITIES.has(priority)) throw new Error('Priority must be High, Normal, or Low.');
    job.priority = priority;
    job.updatedAt = new Date().toISOString();
    this._emitJob(job);
    await this._persistState();
    this._pump();
    return this._snapshotJob(job);
  }

  async reorder(ids) {
    if (!Array.isArray(ids)) throw new TypeError('A list of download IDs is required.');
    this.queue.reorder([...this.jobs.values()], ids.filter(id => typeof id === 'string'));
    await this._persistState();
    this._emit('queue-updated', { state: this.getState() });
    this._pump();
    return this.getState().queue;
  }

  async updateSettings(patch) {
    const previous = this.settings;
    this.settings = await this.settingsStore.update(patch);
    this._applyCurrentLimits();
    if (previous.downloadDirectory !== this.settings.downloadDirectory) await fs.mkdir(this.settings.downloadDirectory, { recursive: true });
    this.logger.info('Settings updated.', { connections: this.settings.connections, maxActiveDownloads: this.settings.maxActiveDownloads, bandwidthLimitBps: this.settings.bandwidthLimitBps });
    this._emit('settings-updated', { settings: this.settings });
    await this._persistState();
    this._pump();
    return this.settings;
  }

  async setSchedule(schedule) {
    const settings = await this.updateSettings({ schedule: { ...this.settings.schedule, ...schedule } });
    this.scheduler?._tick();
    return settings.schedule;
  }

  _onScheduleWindowChange(inside) {
    this.schedulerInside = inside;
    this._applyCurrentLimits();
    const schedule = this.settings?.schedule;
    if (!schedule?.enabled) {
      for (const job of this.jobs.values()) {
        if (job.status === 'scheduled') {
          job.status = 'queued';
          job.updatedAt = new Date().toISOString();
          this._emitJob(job);
        }
      }
      this._pump();
      return;
    }
    if (!inside && schedule.pauseOutsideWindow) {
      for (const job of this.jobs.values()) {
        if (['downloading', 'checking', 'retrying'].includes(job.status)) {
          job.status = 'scheduled';
          job.updatedAt = new Date().toISOString();
          if (job._runController && !job._runController.signal.aborted) job._runController.abort(new PauseError());
          this.logger.info('Download paused by its configured schedule.', { fileName: job.fileName, jobId: job.id });
          this._emitJob(job);
        }
      }
    }
    if (inside) {
      for (const job of this.jobs.values()) {
        if (job.status === 'scheduled') {
          job.status = 'queued';
          job.error = null;
          job.updatedAt = new Date().toISOString();
          this._emitJob(job);
        }
      }
    }
    this._persistState();
    this._pump();
  }

  _onSchedulerTick(inside) {
    this.schedulerInside = inside;
    this._applyCurrentLimits();
    if (!this.settings.schedule.enabled || inside) {
      for (const job of this.jobs.values()) {
        if (job.status === 'scheduled') {
          job.status = 'queued';
          job.error = null;
          job.updatedAt = new Date().toISOString();
          this._emitJob(job);
        }
      }
    }
    this._pump();
  }

  _applyCurrentLimits() {
    if (!this.settings) return;
    const scheduledWindow = this.settings.schedule.enabled && this.scheduler?.current();
    this.limiter.setLimit(scheduledWindow ? this.settings.schedule.bandwidthLimitBps : this.settings.bandwidthLimitBps);
  }

  _effectiveMaxActive() {
    if (this.settings.schedule.enabled && this.scheduler && this.scheduler.current()) return this.settings.schedule.maxActiveDownloads;
    return this.settings.maxActiveDownloads;
  }

  _pump() {
    if (this.shuttingDown || !this.settings) return;
    if (this.settings.schedule.enabled && this.scheduler && !this.scheduler.current()) return;
    const maxActive = this._effectiveMaxActive();
    let running = [...this.jobs.values()].filter(job => job._running).length;
    while (running < maxActive) {
      const job = this.queue.next([...this.jobs.values()]);
      if (!job) break;
      this._startJob(job);
      running += 1;
    }
  }

  _startJob(job) {
    job._running = true;
    job._runController = new AbortController();
    job._sessionStartedAt = Date.now();
    job._sessionBytes = 0;
    job._windowStart = Date.now();
    job._windowBytes = 0;
    job._lastByteAt = 0;
    job.speedBps = 0;
    job.averageSpeedBps = 0;
    job._rangeFallbackRequested = false;
    job._runPromise = this._runJob(job).catch(error => {
      this.logger.error('Unexpected download worker error.', { fileName: job.fileName, reason: error?.message, jobId: job.id });
      if (!['paused', 'scheduled', 'cancelled'].includes(job.status)) {
        job.status = 'failed';
        job.error = normalizeError(error);
        this._emitJob(job);
      }
    }).finally(async () => {
      job.activeConnections = 0;
      job._running = false;
      job._runController = null;
      job._runPromise = null;
      job.updatedAt = new Date().toISOString();
      if (!['completed', 'cancelled', 'skipped'].includes(job.status)) await this._saveMetadata(job, true).catch(() => {});
      await this._persistState();
      this._emitJob(job);
      this._pump();
    });
  }

  async _runJob(job) {
    const signal = job._runController.signal;
    try {
      job.status = 'checking';
      job.error = null;
      job.updatedAt = new Date().toISOString();
      this._emitJob(job);
      await this._persistState();
      const info = await this._inspectWithRetries(job, signal);
      if (signal.aborted) throw signal.reason;
      await this._prepareJob(job, info);
      if (job.status === 'needs-attention' || job.status === 'skipped') return;
      if (job._verified) {
        await this._commit(job);
        return;
      }

      job.status = 'downloading';
      job.updatedAt = new Date().toISOString();
      this.logger.info('Download started.', { fileName: job.fileName, host: new URL(job.url).host, jobId: job.id });
      if (job.size === 0) {
        const emptyFile = await FileWriter.open(job.partPath, { totalSize: 0, resume: false });
        job.ownsPart = true;
        await this._persistState();
        await emptyFile.sync();
        await emptyFile.close();
        job.segments = [];
        job.downloadedBytes = 0;
      } else if (info.supportsRanges && info.validator && info.size > 0 && job.requestedConnections > 1) {
        const prior = job.segments.length;
        if (!prior) job.segments = createSegments(info.size, job.requestedConnections);
        this.connections.initialize(job, job.requestedConnections);
        if (prior) job.connectionLimit = Math.min(job.requestedConnections, Math.max(1, prior));
        this.logger.info(`Server supports byte ranges; using up to ${job.connectionLimit} parallel connections.`, { fileName: job.fileName, jobId: job.id });
        this._emitJob(job);
        try {
          await this._downloadSegmented(job, signal);
        } catch (error) {
          if (!(error instanceof RangeFallbackError) && error?.code !== 'RANGE_FALLBACK') throw error;
          this.logger.warn('The server stopped honoring byte ranges. Switching to a normal single connection without combining partial responses.', { fileName: job.fileName, jobId: job.id });
          await this._resetPartial(job, 'Server range behavior changed; restarting safely with one connection.');
          job.info.supportsRanges = false;
          job.validator = getStableValidator(job.info);
          job.connectionLimit = 1;
          job.segments = job.size == null ? [{ index: 0, start: 0, end: -1, downloaded: 0, complete: false, failures: 0 }] : createSegments(job.size, 1);
          await this._saveMetadata(job, true);
          await this._downloadSingle(job, signal);
        }
      } else {
        if (!info.supportsRanges) this.logger.info('Server does not support byte ranges; using a normal single connection.', { fileName: job.fileName, jobId: job.id });
        else if (!info.validator && job.requestedConnections > 1) this.logger.warn('Server omitted a stable file validator; using one connection to avoid mixing different file versions.', { fileName: job.fileName, jobId: job.id });
        if (!job.segments.length) job.segments = job.size == null ? [{ index: 0, start: 0, end: -1, downloaded: 0, complete: false, failures: 0 }] : createSegments(job.size, 1);
        this.connections.initialize(job, 1);
        await this._downloadSingle(job, signal);
      }
      if (signal.aborted) throw signal.reason;
      job.downloadedBytes = calcDownloaded(job);
      if (job.size == null) job.size = job.downloadedBytes;
      if (!segmentsCoverFile(job.segments, job.size)) {
        throw new DownloadError('Not every byte range completed. The file was kept as an incomplete download.', { code: 'INTEGRITY_ERROR' });
      }
      await this._saveMetadata(job, true);
      const verification = await this.integrity.verify(job.partPath, { expectedSize: job.size, checksums: job.info?.checksums || {} });
      job._verified = true;
      job.verifiedBy = verification.verifiedBy;
      this.logger.info(verification.verifiedBy === 'size-and-checksum' ? 'File size and source checksum verified.' : 'File size verified.', { fileName: job.fileName, size: verification.size, jobId: job.id });
      await this._commit(job);
    } catch (error) {
      if (job.status === 'cancelled' || error?.code === 'CANCELLED') return;
      if (job.status === 'paused' || job.status === 'scheduled' || error?.code === 'PAUSED') {
        job.activeConnections = 0;
        job.speedBps = 0;
        job.updatedAt = new Date().toISOString();
        await this._saveMetadata(job, true).catch(() => {});
        return;
      }
      job.status = 'failed';
      job.speedBps = 0;
      job.activeConnections = 0;
      job.error = normalizeError(error);
      job.updatedAt = new Date().toISOString();
      this.logger.error('Download failed.', { fileName: job.fileName, message: job.error.message, code: job.error.code, jobId: job.id });
      await this._saveMetadata(job, true).catch(() => {});
      this._emitJob(job);
    }
  }

  async _inspectWithRetries(job, signal) {
    let attempt = 0;
    while (true) {
      try {
        const info = await this.http.inspect(job.url, signal);
        return info;
      } catch (error) {
        if (signal.aborted) throw signal.reason || error;
        if (!this.retry.shouldRetry(error, attempt)) throw error;
        attempt += 1;
        const delay = this.retry.delay(attempt, retryAfterFrom(error));
        job.status = 'retrying';
        job.error = { message: `${friendlyError(error)} Retrying in ${Math.ceil(delay / 1000)} seconds.`, code: error.code || 'RETRY', status: error.status || null };
        this.logger.warn('Retrying the server information request with exponential backoff.', { fileName: job.fileName, attempt, delayMs: delay, jobId: job.id });
        this._emitJob(job);
        await this.retry.wait(delay, signal);
      }
    }
  }

  async _prepareJob(job, info) {
    const userName = job.fileName;
    job.info = info;
    job.validator = info.validator || getStableValidator(info);
    job.size = info.size;
    job.fileName = sanitizeFilename(userName || info.fileName, 'download');
    job.category = categoryForFilename(job.fileName);
    job.outputDirectory = path.resolve(job.outputDirectory || this.settings.downloadDirectory);

    const assignPaths = name => {
      job.fileName = name;
      job.category = categoryForFilename(name);
      const categoryFolder = this.settings.autoOrganize ? job.category : null;
      job.finalPath = path.join(job.outputDirectory, ...(categoryFolder ? [categoryFolder] : []), name);
      job.partPath = path.join(job.outputDirectory, `${name}.part`);
      job.metadataPath = `${job.partPath}.json`;
    };
    assignPaths(job.fileName);

    // Serialize the short filesystem conflict/reservation phase. Network inspection
    // happens before this lock, so unrelated links still probe in parallel.
    const previousPreparation = this._pathPreparationChain;
    let releasePreparation;
    this._pathPreparationChain = new Promise(resolve => { releasePreparation = resolve; });
    await previousPreparation;
    try {
      let sameUrlPartial = null;
      for (const other of this.jobs.values()) {
        if (other.id === job.id || other.url !== job.url || !other.partPath || ['completed', 'cancelled', 'skipped'].includes(other.status)) continue;
        if (await exists(other.partPath)) { sameUrlPartial = other; break; }
      }
      if (sameUrlPartial) {
        if (job.conflictAction === 'skip') {
          job.status = 'skipped';
          job.targetExists = true;
          job.targetKind = 'partial';
          this._emitJob(job);
          return;
        }
        if (job.conflictAction === 'replace') {
          await this.cancel(sameUrlPartial.id);
          this.logger.warn('An existing partial file was replaced at the user’s request.', { fileName: sameUrlPartial.fileName, jobId: sameUrlPartial.id });
        } else if (job.conflictAction === 'rename') {
          const original = path.parse(job.fileName);
          let suffix = 1;
          let candidate = job.fileName;
          while (true) {
            assignPaths(candidate);
            const owner = [...this.jobs.values()].some(other => other.id !== job.id && other.partPath === job.partPath && other.ownsPart && !['completed', 'cancelled', 'skipped'].includes(other.status));
            if (!owner && !await exists(job.partPath) && !await exists(job.metadataPath) && !await exists(job.finalPath)) break;
            candidate = `${original.name} (${suffix++})${original.ext}`;
          }
        } else {
          job.status = 'needs-attention';
          job.targetExists = true;
          job.targetKind = 'partial';
          job.error = { message: 'An interrupted download for this URL already exists. Resume that item instead of creating a second partial file.', code: 'DUPLICATE_PARTIAL', status: null };
          job.updatedAt = new Date().toISOString();
          this._emitJob(job);
          await this._persistState();
          return;
        }
      }

      let finalExists = await exists(job.finalPath);
      let partExists = await exists(job.partPath);
      let previous = await this.resumeManager.load(job.metadataPath);
      let ownPartial = Boolean(partExists && (metadataBelongsToJob(previous, job) || (!previous && job.ownsPart)));
      let pathOwner = [...this.jobs.values()].find(other => other.id !== job.id && other.partPath && path.resolve(other.partPath) === path.resolve(job.partPath) && other.ownsPart && !['completed', 'cancelled', 'skipped'].includes(other.status));
      const partialConflict = (partExists && !ownPartial) || Boolean(pathOwner);
      const targetConflict = finalExists || partialConflict;

      if (targetConflict && job.conflictAction === 'skip') {
        job.status = 'skipped';
        job.targetExists = true;
        job.targetKind = finalExists ? 'file' : 'partial';
        this._emitJob(job);
        return;
      }

      if (targetConflict && job.conflictAction === 'rename') {
        const original = path.parse(job.fileName);
        let suffix = 1;
        let candidate = job.fileName;
        while (true) {
          assignPaths(candidate);
          const reserved = [...this.jobs.values()].some(other => other.id !== job.id && other.partPath && path.resolve(other.partPath) === path.resolve(job.partPath) && other.ownsPart && !['completed', 'cancelled', 'skipped'].includes(other.status));
          if (!reserved && !await exists(job.partPath) && !await exists(job.metadataPath) && !await exists(job.finalPath)) break;
          candidate = `${original.name} (${suffix++})${original.ext}`;
        }
        finalExists = false;
        partExists = false;
        previous = null;
        ownPartial = false;
        pathOwner = null;
      } else if (targetConflict && !['replace'].includes(job.conflictAction)) {
        job.status = 'needs-attention';
        job.targetExists = true;
        job.targetKind = finalExists ? 'file' : 'partial';
        job.error = {
          message: finalExists
            ? 'A file with this name already exists. Choose Replace, Rename, Skip, or resume the interrupted download.'
            : 'An incomplete .part file already exists. Choose Rename, Replace, or resume the interrupted download.',
          code: (sameUrlPartial || pathOwner?.url === job.url || previous?.url === job.url) ? 'DUPLICATE_PARTIAL' : 'DUPLICATE_FILE',
          status: null,
        };
        job.updatedAt = new Date().toISOString();
        this._emitJob(job);
        await this._persistState();
        return;
      }

      if (job.conflictAction === 'replace' && partialConflict) {
        const owner = pathOwner || (previous?.id ? this.jobs.get(previous.id) : null);
        if (owner && owner.id !== job.id) await this.cancel(owner.id);
        else {
          await fs.rm(job.partPath, { force: true });
          await this.resumeManager.remove(job.metadataPath);
        }
        partExists = false;
        previous = null;
        ownPartial = false;
        pathOwner = null;
      }

      partExists = await exists(job.partPath);
      previous = await this.resumeManager.load(job.metadataPath);
      ownPartial = Boolean(partExists && (metadataBelongsToJob(previous, job) || (!previous && job.ownsPart)));
      let partSizeMatches = false;
      if (partExists && info.size != null) {
        try { partSizeMatches = (await fs.stat(job.partPath)).size === info.size; } catch { partSizeMatches = false; }
      }
      if (partExists && ownPartial && partSizeMatches && previous?.url === job.url && compareVersion(previous, info) && info.supportsRanges && job.validator) {
        job.segments = previous.segments;
        job.downloadedBytes = calcDownloaded(job);
        job.info = { ...info, checksums: { ...(previous.checksums || {}), ...info.checksums } };
        job.size = info.size;
        job.ownsPart = true;
        this.logger.info('Resuming verified byte ranges from the saved temporary file.', { fileName: job.fileName, downloadedBytes: job.downloadedBytes, jobId: job.id });
      } else {
        if (partExists && ownPartial) await fs.rm(job.partPath, { force: true });
        if (previous?.id === job.id) await this.resumeManager.remove(job.metadataPath);
        if (partExists && ownPartial && previous?.url === job.url) {
          this.logger.warn('The saved partial file failed resume validation (size, file length, or server validator); restarting from zero to avoid a corrupted file.', { fileName: job.fileName, jobId: job.id });
        }
        job.segments = [];
        job.downloadedBytes = 0;
        job.ownsPart = false;
      }
      job._verified = false;
      job.error = null;
      job.targetExists = finalExists;
      job.updatedAt = new Date().toISOString();
      // Reserve the temporary path before another queued job can claim the same filename.
      job.ownsPart = true;
      await this._persistState();
    } finally {
      releasePreparation();
    }
  }

  async _downloadSegmented(job, signal) {
    const size = job.size;
    if (!Number.isSafeInteger(size) || size < 1 || !job.validator) throw new RangeFallbackError('The file size or stable validator is missing.');
    if (!job.segments.length) job.segments = createSegments(size, job.requestedConnections);
    if (!segmentsCoverRanges(job.segments, size)) job.segments = createSegments(size, job.requestedConnections);
    job.downloadedBytes = calcDownloaded(job);
    let writer;
    const rangeController = new AbortController();
    const abortRangeWithParent = () => {
      if (!rangeController.signal.aborted) rangeController.abort(signal.reason || new PauseError());
    };
    if (signal.aborted) abortRangeWithParent();
    else signal.addEventListener('abort', abortRangeWithParent, { once: true });
    try {
      const partialExists = await exists(job.partPath);
      if (!partialExists && job.downloadedBytes > 0) {
        job.segments = createSegments(size, job.requestedConnections);
        job.downloadedBytes = 0;
      }
      try {
        writer = await FileWriter.open(job.partPath, { totalSize: size, resume: partialExists && job.downloadedBytes > 0 });
      } catch (error) {
        if (error?.code !== 'PARTIAL_FILE_SIZE_MISMATCH') throw error;
        await this._resetPartial(job, 'The temporary file length changed after resume validation; restarting the range transfer from zero.');
        job.segments = createSegments(size, job.requestedConnections);
        job.downloadedBytes = 0;
        writer = await FileWriter.open(job.partPath, { totalSize: size, resume: false });
      }
      job.ownsPart = true;
      await this._persistState();
      const pending = job.segments.filter(segment => !segment.complete);
      if (!pending.length) return;
      let cursor = 0;
      const workerCount = Math.max(1, Math.min(job.connectionLimit || job.requestedConnections, pending.length));
      const workers = Array.from({ length: workerCount }, (_, workerIndex) => (async () => {
        while (!rangeController.signal.aborted && workerIndex < job.connectionLimit) {
          let segment = null;
          while (cursor < job.segments.length) {
            const candidate = job.segments[cursor++];
            if (!candidate.complete) { segment = candidate; break; }
          }
          if (!segment) return;
          await this._downloadSegment(job, segment, writer, rangeController.signal, rangeController);
        }
      })());
      const settled = await Promise.allSettled(workers);
      if (signal.aborted) throw signal.reason || new PauseError();
      if (job._rangeFallbackRequested) throw new RangeFallbackError();
      const failed = settled.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      if (!segmentsCoverFile(job.segments, size)) throw new DownloadError('One or more byte ranges did not finish.', { code: 'INCOMPLETE_RANGES', retryable: true });
    } finally {
      signal.removeEventListener('abort', abortRangeWithParent);
      if (writer) {
        await writer.sync().catch(() => {});
        await writer.close().catch(() => {});
      }
      job.activeConnections = 0;
      job.downloadedBytes = calcDownloaded(job);
      await this._saveMetadata(job, true).catch(() => {});
      this._emitJob(job);
    }
  }

  async _downloadSegment(job, segment, writer, signal, rangeController) {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw signal.reason || new PauseError();
      const segmentLength = segment.end - segment.start + 1;
      const offset = segment.start + segment.downloaded;
      if (segment.downloaded >= segmentLength) {
        segment.complete = true;
        return;
      }
      let response = null;
      let connectionCounted = false;
      try {
        job.activeConnections += 1;
        connectionCounted = true;
        this._emitJobThrottled(job);
        const result = await this.http.openRange(job.url, offset, segment.end, { validator: job.validator, signal });
        response = result.response;
        const status = response.statusCode || 0;
        if (status === 200) {
          response.destroy();
          job._rangeFallbackRequested = true;
          const error = new RangeFallbackError();
          if (!signal.aborted) rangeController.abort(error);
          throw error;
        }
        if (status !== 206) throw errorFromHttpStatus(status, parseRetryAfter(response.headers['retry-after']));
        if (!responseMatchesInfo(response, job.info)) {
          response.destroy();
          job._rangeFallbackRequested = true;
          const error = new RangeFallbackError('The server changed its validator during a range transfer.');
          if (!signal.aborted) rangeController.abort(error);
          throw error;
        }
        if (!rangeExpected(response, offset, segment.end, job.size)) {
          response.destroy();
          job._rangeFallbackRequested = true;
          const error = new RangeFallbackError('The server returned a mismatched Content-Range response.');
          if (!signal.aborted) rangeController.abort(error);
          throw error;
        }
        const expectedThisResponse = segment.end - offset + 1;
        const responseLength = response.headers['content-length'] == null ? null : Number(response.headers['content-length']);
        if (responseLength != null && responseLength !== expectedThisResponse) {
          response.destroy();
          throw new DownloadError('The server returned an inconsistent Content-Length for a byte range.', { code: 'RANGE_LENGTH_MISMATCH', retryable: true });
        }
        let received = 0;
        let position = offset;
        for await (const chunkValue of response) {
          if (signal.aborted) throw signal.reason || new PauseError();
          const chunk = Buffer.from(chunkValue);
          if (received + chunk.length > expectedThisResponse) throw new DownloadError('The server sent more bytes than requested for a range.', { code: 'RANGE_LENGTH_MISMATCH' });
          await this.limiter.consume(chunk.length, signal);
          await writer.writeAt(chunk, position);
          position += chunk.length;
          received += chunk.length;
          segment.downloaded += chunk.length;
          this._noteBytes(job, chunk.length);
          this._emitJobThrottled(job);
          await this._saveMetadata(job, false);
        }
        if (received !== expectedThisResponse) {
          throw new DownloadError(`A byte range ended early (${received} of ${expectedThisResponse} bytes).`, { code: 'SHORT_RESPONSE', retryable: true });
        }
        segment.complete = true;
        segment.failures = 0;
        this.connections.noteSuccess(job);
        this.logger.info('Segment completed.', { fileName: job.fileName, segment: segment.index + 1, totalSegments: job.segments.length, bytes: segmentLength, jobId: job.id });
        await this._saveMetadata(job, true);
        return;
      } catch (error) {
        if (response && !response.destroyed && !response.complete) response.destroy();
        if (signal.aborted) throw signal.reason || error;
        if (job._rangeFallbackRequested || error?.code === 'RANGE_FALLBACK') throw error;
        segment.failures = (segment.failures || 0) + 1;
        this.connections.noteFailure(job, error);
        const retryAfter = retryAfterFrom(error);
        if (!this.retry.shouldRetry(error, attempt)) throw error;
        const delay = this.retry.delay(attempt + 1, retryAfter);
        job.status = 'retrying';
        this.logger.warn('Retrying a failed segment from its last safely written byte.', { fileName: job.fileName, segment: segment.index + 1, downloadedBytes: segment.downloaded, attempt: attempt + 1, delayMs: delay, jobId: job.id });
        this._emitJob(job);
        await this._saveMetadata(job, true);
        if (connectionCounted) {
          job.activeConnections = Math.max(0, job.activeConnections - 1);
          connectionCounted = false;
          this._emitJobThrottled(job);
        }
        await this.retry.wait(delay, signal);
        job.status = 'downloading';
      } finally {
        if (connectionCounted) {
          job.activeConnections = Math.max(0, job.activeConnections - 1);
          this._emitJobThrottled(job);
        }
      }
    }
  }

  async _downloadSingle(job, signal) {
    if (!job.segments.length) job.segments = job.size == null ? [{ index: 0, start: 0, end: -1, downloaded: 0, complete: false, failures: 0 }] : createSegments(job.size, 1);
    if (job.segments.length !== 1) job.segments = job.size == null ? [{ index: 0, start: 0, end: -1, downloaded: 0, complete: false, failures: 0 }] : createSegments(job.size, 1);
    const segment = job.segments[0];
    let attempt = 0;
    while (true) {
      if (signal.aborted) throw signal.reason || new PauseError();
      if (segment.complete) return;
      const canResume = segment.downloaded > 0 && job.info?.supportsRanges && job.validator && Number.isSafeInteger(job.size);
      const offset = canResume ? segment.downloaded : 0;
      let response = null;
      let connectionCounted = false;
      let writer = null;
      try {
        if (offset > 0 && !await exists(job.partPath)) {
          await this._resetPartial(job, 'The temporary file disappeared during resume; restarting from zero.');
          job.segments = [segment];
          segment.start = 0;
          segment.end = job.size == null ? -1 : job.size - 1;
          segment.downloaded = 0;
          segment.complete = false;
          attempt = 0;
          continue;
        }
        job.activeConnections += 1;
        connectionCounted = true;
        this._emitJobThrottled(job);
        const result = offset > 0
          ? await this.http.openFrom(job.url, offset, { validator: job.validator, signal })
          : await this.http.request('GET', job.url, {}, signal);
        response = result.response;
        const status = response.statusCode || 0;
        if (offset > 0 && status === 200) {
          response.destroy();
          this.logger.warn('The server validator changed while resuming. Discarding saved bytes and restarting from zero.', { fileName: job.fileName, jobId: job.id });
          await this._resetPartial(job, 'The server representation changed; restarting safely.');
          job.segments = [segment];
          segment.start = 0;
          segment.end = job.size == null ? -1 : job.size - 1;
          segment.downloaded = 0;
          segment.complete = false;
          attempt = 0;
          continue;
        }
        if (offset > 0 && status === 416) {
          const range = parseContentRange(response.headers['content-range']);
          response.destroy();
          if (job.size != null && offset === job.size && range?.total === job.size) {
            segment.complete = true;
            return;
          }
          await this._resetPartial(job, 'The server rejected the saved byte position; restarting safely.');
          job.segments = [segment];
          segment.start = 0;
          segment.end = job.size == null ? -1 : job.size - 1;
          segment.downloaded = 0;
          segment.complete = false;
          attempt = 0;
          continue;
        }
        if (offset > 0) {
          if (status !== 206) throw errorFromHttpStatus(status, parseRetryAfter(response.headers['retry-after']));
          if (!responseMatchesInfo(response, job.info)) {
            response.destroy();
            await this._resetPartial(job, 'The server validator changed during resume; restarting safely.');
            job.segments = [segment];
            segment.start = 0;
            segment.end = job.size == null ? -1 : job.size - 1;
            segment.downloaded = 0;
            segment.complete = false;
            attempt = 0;
            continue;
          }
          const range = parseContentRange(response.headers['content-range']);
          if (!range || range.start !== offset || (job.size != null && range.total !== job.size)) {
            response.destroy();
            await this._resetPartial(job, 'The server returned a mismatched resume range; restarting safely.');
            job.segments = [segment];
            segment.start = 0;
            segment.end = job.size == null ? -1 : job.size - 1;
            segment.downloaded = 0;
            segment.complete = false;
            attempt = 0;
              continue;
          }
        } else if (status !== 200) {
          throw errorFromHttpStatus(status, parseRetryAfter(response.headers['retry-after']));
        }

        const responseLength = response.headers['content-length'] == null ? null : Number(response.headers['content-length']);
        let responseTotal = job.size;
        if (offset > 0) {
          const range = parseContentRange(response.headers['content-range']);
          responseTotal = range?.total ?? responseTotal;
        } else if (Number.isSafeInteger(responseLength)) {
          responseTotal = responseLength;
        }
        if (responseTotal != null && responseTotal !== job.size && offset === 0) {
          if (job.size != null) this.logger.warn('The file size changed between metadata lookup and download; using the size reported by the download response.', { fileName: job.fileName, previousSize: job.size, currentSize: responseTotal, jobId: job.id });
          job.size = responseTotal;
          segment.end = responseTotal - 1;
        }
        const expectedThisResponse = offset > 0
          ? (responseTotal == null ? null : responseTotal - offset)
          : responseTotal;
        if (responseLength != null && expectedThisResponse != null && responseLength !== expectedThisResponse) {
          throw new DownloadError('The server returned an inconsistent Content-Length for the download.', { code: 'CONTENT_LENGTH_MISMATCH', retryable: true });
        }
        const partExists = await exists(job.partPath);
        writer = await FileWriter.open(job.partPath, { totalSize: job.size, resume: offset > 0 && partExists });
        job.ownsPart = true;
        await this._persistState();
        let received = 0;
        let position = offset;
        for await (const chunkValue of response) {
          if (signal.aborted) throw signal.reason || new PauseError();
          const chunk = Buffer.from(chunkValue);
          if (expectedThisResponse != null && received + chunk.length > expectedThisResponse) {
            throw new DownloadError('The server sent more bytes than the announced file size.', { code: 'CONTENT_LENGTH_MISMATCH' });
          }
          await this.limiter.consume(chunk.length, signal);
          await writer.writeAt(chunk, position);
          position += chunk.length;
          received += chunk.length;
          segment.downloaded = position;
          this._noteBytes(job, chunk.length);
          this._emitJobThrottled(job);
          await this._saveMetadata(job, false);
        }
        if (expectedThisResponse != null && received !== expectedThisResponse) {
          throw new DownloadError(`The server ended the response early (${received} of ${expectedThisResponse} bytes).`, { code: 'SHORT_RESPONSE', retryable: true });
        }
        if (job.size == null) {
          job.size = position;
          segment.end = position - 1;
        }
        if (position !== job.size) throw new DownloadError('The single-connection download did not reach the announced file size.', { code: 'SHORT_RESPONSE', retryable: true });
        segment.downloaded = job.size;
        segment.end = job.size - 1;
        segment.complete = true;
        segment.failures = 0;
        this.connections.noteSuccess(job);
        this.logger.info('Single-connection download stream completed.', { fileName: job.fileName, bytes: job.size, jobId: job.id });
        await this._saveMetadata(job, true);
        return;
      } catch (error) {
        if (response && !response.destroyed && !response.complete) response.destroy();
        if (signal.aborted) throw signal.reason || error;
        if (error?.code === 'PAUSED' || error?.code === 'CANCELLED') throw error;
        if (writer) {
          await writer.sync().catch(() => {});
          await writer.close().catch(() => {});
          writer = null;
        }
        if (connectionCounted) {
          job.activeConnections = Math.max(0, job.activeConnections - 1);
          connectionCounted = false;
          this._emitJobThrottled(job);
        }
        if (error?.code === 'PARTIAL_FILE_SIZE_MISMATCH' && offset > 0) {
          await this._resetPartial(job, 'The temporary file length changed during resume; restarting from zero.');
          job.segments = [segment];
          segment.start = 0;
          segment.end = job.size == null ? -1 : job.size - 1;
          segment.downloaded = 0;
          segment.complete = false;
          attempt = 0;
          continue;
        }
        if (!(job.info?.supportsRanges && job.validator && Number.isSafeInteger(job.size)) && segment.downloaded > 0) {
          segment.downloaded = 0;
          segment.complete = false;
          job.downloadedBytes = 0;
          await fs.rm(job.partPath, { force: true }).catch(() => {});
          await this._saveMetadata(job, true).catch(() => {});
        }
        segment.failures = (segment.failures || 0) + 1;
        this.connections.noteFailure(job, error);
        if (!this.retry.shouldRetry(error, attempt)) throw error;
        attempt += 1;
        const delay = this.retry.delay(attempt, retryAfterFrom(error));
        job.status = 'retrying';
        this.logger.warn('Retrying the single-connection download from the last safe byte position when validators permit.', { fileName: job.fileName, attempt, delayMs: delay, jobId: job.id });
        this._emitJob(job);
        await this._saveMetadata(job, true);
        await this.retry.wait(delay, signal);
        job.status = 'downloading';
      } finally {
        if (writer) {
          await writer.sync().catch(() => {});
          await writer.close().catch(() => {});
        }
        if (connectionCounted) {
          job.activeConnections = Math.max(0, job.activeConnections - 1);
          this._emitJobThrottled(job);
        }
      }
    }
  }

  async _resetPartial(job, reason) {
    if (job.partPath) await fs.rm(job.partPath, { force: true }).catch(() => {});
    if (job.metadataPath) await this.resumeManager.remove(job.metadataPath);
    job.segments = [];
    job.downloadedBytes = 0;
    job.speedBps = 0;
    job.ownsPart = false;
    job._verified = false;
    job.updatedAt = new Date().toISOString();
    if (reason) this.logger.warn(reason, { fileName: job.fileName, jobId: job.id });
    await this._persistState();
  }

  async _commit(job) {
    if (!job.partPath || !job.finalPath) throw new DownloadError('The temporary file or destination path is missing.', { code: 'FILE_PATH_ERROR' });
    await fs.mkdir(path.dirname(job.finalPath), { recursive: true });
    let finalPath = job.finalPath;
    const targetExists = await exists(finalPath);
    let backup = null;
    if (targetExists) {
      if (job.conflictAction === 'replace') {
        backup = `${finalPath}.replaced-${job.id}`;
        await fs.rename(finalPath, backup);
      } else if (job.conflictAction === 'rename') {
        const newName = await availableName(path.dirname(finalPath), job.fileName);
        finalPath = path.join(path.dirname(finalPath), newName);
      } else {
        job.status = 'needs-attention';
        job.targetExists = true;
        job.targetKind = 'file';
        job.error = { message: 'A file appeared at the destination while the download was running. Choose Replace, Rename, or Skip; the verified temporary file has been preserved.', code: 'DUPLICATE_FILE', status: null };
        this._emitJob(job);
        await this._persistState();
        return;
      }
    }
    try {
      await fs.rename(job.partPath, finalPath);
      if (backup) await fs.rm(backup, { force: true }).catch(() => {});
    } catch (error) {
      if (backup) await fs.rename(backup, job.finalPath).catch(() => {});
      throw error;
    }
    job.finalPath = finalPath;
    job.ownsPart = false;
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    job.error = null;
    job.targetExists = false;
    job.speedBps = 0;
    job.activeConnections = 0;
    job.downloadedBytes = job.size;
    job._verified = false;
    await this.resumeManager.remove(job.metadataPath);
    this.logger.info('Download completed and moved into its final filename.', { fileName: job.fileName, path: finalPath, bytes: job.size, jobId: job.id });
    this._emitJob(job);
    await this._trimHistory();
    await this._persistState();
  }

  async _trimHistory() {
    const completed = [...this.jobs.values()].filter(job => job.status === 'completed').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    const max = this.settings.keepCompletedHistory;
    for (const job of completed.slice(max)) this.jobs.delete(job.id);
  }

  _noteBytes(job, bytes) {
    if (bytes <= 0) return;
    job._sessionBytes += bytes;
    job._windowBytes += bytes;
    job._lastByteAt = Date.now();
    this.connections.observeBytes(job, bytes, { bandwidthLimited: this.limiter.limitBps > 0 });
  }

  _tickMetrics() {
    if (!this.settings) return;
    const now = Date.now();
    let changed = false;
    for (const job of this.jobs.values()) {
      if (!job._running || !['downloading', 'retrying'].includes(job.status)) continue;
      const elapsed = Math.max(1, now - (job._windowStart || now));
      job.speedBps = (job._windowBytes || 0) / (elapsed / 1000);
      job._windowBytes = 0;
      job._windowStart = now;
      if (job._lastByteAt && now - job._lastByteAt > 1500) job.speedBps = 0;
      const sessionElapsed = Math.max(1, now - (job._sessionStartedAt || now));
      job.averageSpeedBps = (job._sessionBytes || 0) / (sessionElapsed / 1000);
      job.peakSpeedBps = Math.max(job.peakSpeedBps || 0, job.speedBps || 0);
      this._emitJobThrottled(job, true);
      changed = true;
    }
    if (changed) this._emit('metrics', { stats: this.getState().stats });
  }

  _emitJobThrottled(job, force = false) {
    const now = Date.now();
    if (!force && now - (job._lastEmitAt || 0) < 250) return;
    job._lastEmitAt = now;
    job.downloadedBytes = calcDownloaded(job);
    job.updatedAt = new Date().toISOString();
    this._emitJob(job);
  }

  _emitJob(job) {
    job.downloadedBytes = calcDownloaded(job);
    this._emit('job-updated', { job: this._snapshotJob(job) });
    this._emit('metrics', { stats: this.getState().stats });
  }

  async _saveMetadata(job, force) {
    if (!job.metadataPath || !job.fileName || !job.url || !job.segments.length) return;
    const now = Date.now();
    if (!force && now - (job._lastMetaSave || 0) < 1000) return;
    job._lastMetaSave = now;
    job.downloadedBytes = calcDownloaded(job);
    job._metadataChain = (job._metadataChain || Promise.resolve()).catch(() => {}).then(() => this.resumeManager.save(job));
    return job._metadataChain;
  }

  async reveal(id) {
    const job = this.jobs.get(id);
    return job?.finalPath || job?.outputDirectory || this.settings.downloadDirectory;
  }

  async removeHistory(id) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'completed') return false;
    this.jobs.delete(id);
    await this._persistState();
    this._emit('state', { state: this.getState() });
    return true;
  }

  async shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.scheduler?.stop();
    this.browserBridge?.close();
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    const running = [...this.jobs.values()].filter(job => job._running);
    for (const job of running) {
      if (job.status !== 'cancelled') job.status = 'paused';
      if (job._runController && !job._runController.signal.aborted) job._runController.abort(new PauseError());
    }
    await Promise.all(running.map(job => job._runPromise?.catch(() => {})));
    for (const job of this.jobs.values()) {
      if (!['completed', 'cancelled', 'skipped'].includes(job.status)) await this._saveMetadata(job, true).catch(() => {});
    }
    await this._persistState();
    await this.logger._writeChain?.catch(() => {});
    this.http.close();
  }
}

function segmentsCoverRanges(segments, size) {
  if (!segments.length) return false;
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  let next = 0;
  for (const segment of ordered) {
    if (segment.start !== next || segment.end < segment.start || segment.end >= size) return false;
    next = segment.end + 1;
  }
  return next === size;
}
