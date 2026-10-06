'use strict';
/**
 * Resumable HTTPS downloader with redirect following, progress, speed,
 * retries and optional SHA-256 verification. Used for every big artefact:
 * Temurin JRE, cmdline-tools, emulator, platform-tools, system images, AEHD.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const UA = 'NeurioDroid/1.0 (+https://github.com/zakariabouifri03-max/neurio)';
const MAX_REDIRECTS = 8;

function agentFor(url) {
  return url.startsWith('https:') ? https : http;
}

function head(url, redirects = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const doHead = (u, left) => {
      const lib = agentFor(u);
      const req = lib.request(u, { method: 'GET', headers: { 'User-Agent': UA, Range: 'bytes=0-0' } }, (res) => {
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && left > 0) {
          res.resume();
          return doHead(new URL(loc, u).toString(), left - 1);
        }
        res.resume();
        let total = 0;
        const cr = res.headers['content-range'];
        if (cr && cr.includes('/')) total = parseInt(cr.split('/').pop(), 10) || 0;
        if (!total && res.headers['content-length'] && res.statusCode === 200) {
          total = parseInt(res.headers['content-length'], 10) || 0;
        }
        resolve({ url: u, total, acceptRanges: String(res.headers['accept-ranges'] || '').includes('bytes') });
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('timeout')));
      req.end();
    };
    doHead(url, redirects);
  });
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {string} o.dest            final file path
 * @param {string} [o.sha256]        expected checksum (hex)
 * @param {number} [o.size]          expected size (skips HEAD when known)
 * @param {function} o.onProgress    ({received,total,speed,phase}) => void
 * @param {boolean} [o.resume=true]
 * @param {AbortSignal} [o.signal]
 */
async function download(o) {
  const { url, dest, onProgress = () => {}, signal } = o;
  const resume = o.resume !== false;
  const part = dest + '.part';
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  let total = o.size || 0;
  let acceptRanges = true;
  if (!total) {
    try {
      const h = await head(url);
      total = h.total;
      acceptRanges = h.acceptRanges !== false;
    } catch (_) { /* proceed blind */ }
  }

  let received = 0;
  try { received = resume && fs.existsSync(part) ? fs.statSync(part).size : 0; } catch (_) { received = 0; }
  if (received && (!acceptRanges || (total && received > total))) {
    try { fs.unlinkSync(part); } catch (_) {}
    received = 0;
  }
  if (total && received === total && fs.existsSync(dest)) return dest; // already done

  const attempt = (retry) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('aborted'));
    const headers = { 'User-Agent': UA };
    let start = received;
    try { start = fs.existsSync(part) ? fs.statSync(part).size : 0; } catch (_) { start = 0; }
    if (start > 0) headers.Range = `bytes=${start}-`;

    const get = (u, left) => {
      const lib = agentFor(u);
      const req = lib.get(u, { headers }, (res) => {
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && left > 0) {
          res.resume();
          return get(new URL(loc, u).toString(), left - 1);
        }
        if (res.statusCode === 416) { // range not satisfiable -> restart
          res.resume();
          try { fs.unlinkSync(part); } catch (_) {}
          received = 0;
          return resolve(attempt(retry));
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const appending = res.statusCode === 206;
        if (!appending) { start = 0; received = 0; }
        if (res.headers['content-range']) {
          const t = parseInt(String(res.headers['content-range']).split('/').pop(), 10);
          if (t) total = t;
        } else if (!appending && res.headers['content-length']) {
          total = parseInt(res.headers['content-length'], 10) || total;
        }
        const out = fs.createWriteStream(part, { flags: appending ? 'a' : 'w' });
        let lastTick = Date.now();
        let lastBytes = received;
        res.on('data', (chunk) => {
          received += chunk.length;
          const now = Date.now();
          if (now - lastTick >= 200) {
            const speed = ((received - lastBytes) * 1000) / (now - lastTick);
            lastTick = now; lastBytes = received;
            onProgress({ received, total, speed, phase: 'download' });
          }
        });
        res.pipe(out);
        out.on('error', (e) => { try { res.destroy(); } catch (_) {} reject(e); });
        out.on('close', () => {
          onProgress({ received, total, speed: 0, phase: 'download' });
          resolve();
        });
        req.on('abort', () => reject(new Error('aborted')));
      });
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error('network timeout')));
      if (signal) {
        const onAbort = () => { try { req.destroy(new Error('aborted')); } catch (_) {} };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    };
    get(url, MAX_REDIRECTS);
  }).catch(async (err) => {
    const aborted = /abort/i.test(String(err.message || err));
    if (aborted) throw err;
    if (retry > 0) {
      await new Promise((r) => setTimeout(r, 1500 * (4 - retry)));
      return attempt(retry - 1);
    }
    throw err;
  });

  await attempt(3);

  if (total && received < total) throw new Error(`Incomplete download (${received}/${total} bytes)`);
  if (o.sha256) {
    const got = await sha256File(part);
    if (got.toLowerCase() !== String(o.sha256).toLowerCase()) {
      try { fs.unlinkSync(part); } catch (_) {}
      throw new Error(`Checksum mismatch: expected ${o.sha256}, got ${got}`);
    }
  }
  if (fs.existsSync(dest)) { try { fs.unlinkSync(dest); } catch (_) {} }
  fs.renameSync(part, dest);
  onProgress({ received, total: received, speed: 0, phase: 'done' });
  return dest;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

/** GET a small text/JSON resource (used for repository XML discovery). */
function fetchText(url, { timeout = 25000, redirects = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    const get = (u, left) => {
      const lib = agentFor(u);
      const req = lib.get(u, { headers: { 'User-Agent': UA } }, (res) => {
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && left > 0) {
          res.resume();
          return get(new URL(loc, u).toString(), left - 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    };
    get(url, redirects);
  });
}

async function fetchJSON(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

function humanSize(n) {
  if (!n || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

module.exports = { download, fetchText, fetchJSON, sha256File, head, humanSize };
