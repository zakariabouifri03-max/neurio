import http from 'node:http';
import https from 'node:https';
import { DownloadError, errorFromHttpStatus } from './errors.mjs';
import { parseRetryAfter } from './retry-manager.mjs';

const USER_AGENT = 'AI-Download-Manager-Pro/1.0 (+HTTP range downloader)';

export function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || '').trim());
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) };
}

export function sanitizeFilename(value, fallback = 'download') {
  let name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  name = name.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').replace(/^[. ]+/g, '');
  if (!name || name === '.' || name === '..') name = fallback;
  const stem = name.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) name = `_${name}`;
  if (name.length > 180) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    name = `${name.slice(0, Math.max(1, 180 - ext.length))}${ext}`;
  }
  return name;
}

function dispositionFilename(value) {
  if (!value) return null;
  const utf = /filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;]+)/i.exec(value);
  const basic = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(value);
  let candidate = utf?.[1]?.trim() || basic?.[1] || basic?.[2]?.trim();
  if (!candidate) return null;
  candidate = candidate.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  try { candidate = decodeURIComponent(candidate); } catch { /* retain raw value */ }
  return sanitizeFilename(candidate);
}

function filenameFromUrl(url) {
  const last = url.pathname.split('/').filter(Boolean).pop();
  let decoded = last || 'download';
  try { decoded = decodeURIComponent(decoded); } catch { /* ignore malformed escapes */ }
  return sanitizeFilename(decoded, 'download');
}

function parseChecksums(headers) {
  const result = {};
  const digest = headers.digest || headers['content-digest'];
  if (digest) {
    for (const item of String(digest).split(',')) {
      const match = /^\s*(sha-256|sha-1|md5)\s*=\s*:?(.*?)\s*:?\s*$/i.exec(item);
      if (!match) continue;
      const algorithm = match[1].toLowerCase().replace('-', '');
      const value = match[2].replace(/^"|"$/g, '');
      if (algorithm === 'sha256' || algorithm === 'sha1' || algorithm === 'md5') result[algorithm] = value;
    }
  }
  if (headers['content-md5'] && !result.md5) result.md5 = String(headers['content-md5']).trim();
  return result;
}

function metadataFromHeaders(headers, finalUrl) {
  const lengthRaw = headers['content-length'];
  const size = lengthRaw != null && /^\d+$/.test(String(lengthRaw)) ? Number(lengthRaw) : null;
  return {
    finalUrl: finalUrl.href,
    size: Number.isSafeInteger(size) ? size : null,
    contentType: headers['content-type'] || null,
    acceptRanges: String(headers['accept-ranges'] || '').toLowerCase().split(',').map(item => item.trim()).includes('bytes'),
    etag: headers.etag || null,
    lastModified: headers['last-modified'] || null,
    fileName: dispositionFilename(headers['content-disposition']) || filenameFromUrl(finalUrl),
    checksums: parseChecksums(headers),
  };
}

function mergeProbeHeaders(base, headers, finalUrl, rangeTotal = null) {
  const probe = metadataFromHeaders(headers, finalUrl);
  return {
    ...base,
    finalUrl: finalUrl.href,
    size: rangeTotal ?? probe.size ?? base.size,
    contentType: probe.contentType || base.contentType,
    acceptRanges: probe.acceptRanges || base.acceptRanges,
    etag: probe.etag || base.etag,
    lastModified: probe.lastModified || base.lastModified,
    fileName: headers['content-disposition'] ? probe.fileName : (base.fileName || probe.fileName),
    checksums: { ...(base.checksums || {}), ...(probe.checksums || {}) },
  };
}

export function getStableValidator(info) {
  const etag = String(info?.etag || '').trim();
  if (etag && !/^W\//i.test(etag)) return etag;
  return info?.lastModified || null;
}

export function validateHttpUrl(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch {
    throw new DownloadError('Enter a valid HTTP or HTTPS URL.', { code: 'INVALID_URL' });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new DownloadError('Only HTTP and HTTPS download URLs are supported.', { code: 'INVALID_URL' });
  }
  if (url.username || url.password) {
    throw new DownloadError('URLs containing embedded username/password credentials are not accepted. Use a direct link you are authorized to download.', { code: 'INVALID_URL' });
  }
  return url;
}

export class HttpClient {
  constructor({ timeoutMs = 30_000, logger = null } = {}) {
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16, maxTotalSockets: 32, timeout: timeoutMs });
    this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxTotalSockets: 32, timeout: timeoutMs });
  }

  _once(method, url, headers, signal) {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const agent = url.protocol === 'https:' ? this.httpsAgent : this.httpAgent;
      const request = transport.request(url, {
        method,
        agent,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Connection': 'keep-alive',
          ...headers,
        },
      }, response => resolve(response));
      request.setTimeout(this.timeoutMs, () => {
        request.destroy(new DownloadError('The server did not send data before the connection timed out.', { code: 'ETIMEDOUT', retryable: true }));
      });
      request.on('error', reject);
      request.end();
    });
  }

  async request(method, address, headers = {}, signal = null) {
    let url = address instanceof URL ? new URL(address.href) : validateHttpUrl(address);
    for (let redirects = 0; redirects <= 10; redirects++) {
      const response = await this._once(method, url, headers, signal);
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        const redirectedUrl = new URL(response.headers.location, url);
        response.destroy();
        const next = validateHttpUrl(redirectedUrl.href);
        if (!['http:', 'https:'].includes(next.protocol)) throw new DownloadError('The server redirected to an unsupported URL scheme.', { code: 'UNSUPPORTED_REDIRECT' });
        if (url.protocol === 'https:' && next.protocol === 'http:') throw new DownloadError('The server attempted an insecure HTTPS-to-HTTP redirect; the download was stopped.', { code: 'INSECURE_REDIRECT' });
        url = next;
        continue;
      }
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        throw new DownloadError('The server redirected too many times or omitted a redirect location.', { code: 'REDIRECT_ERROR' });
      }
      return { response, finalUrl: url };
    }
    throw new DownloadError('The server redirected too many times.', { code: 'REDIRECT_ERROR' });
  }

  async inspect(address, signal = null) {
    const original = validateHttpUrl(address);
    let headResult;
    try { headResult = await this.request('HEAD', original, {}, signal); }
    catch (error) {
      if (signal?.aborted) throw error;
      // A few legitimate file hosts reject HEAD but still permit GET. Fall back to a one-byte range probe.
      if (!['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(error?.code)) throw error;
      headResult = null;
    }

    let info = { finalUrl: original.href, size: null, contentType: null, acceptRanges: false, etag: null, lastModified: null, fileName: filenameFromUrl(original), checksums: {} };
    if (headResult) {
      const status = headResult.response.statusCode || 0;
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        headResult.response.destroy();
        throw errorFromHttpStatus(status);
      }
      if (status >= 200 && status < 300) info = metadataFromHeaders(headResult.response.headers, headResult.finalUrl);
      else if (![405, 501].includes(status) && status >= 400) {
        const retryAfter = parseRetryAfter(headResult.response.headers['retry-after']);
        headResult.response.destroy();
        throw errorFromHttpStatus(status, retryAfter);
      }
      headResult.response.destroy();
    }

    // Verify range support with a real GET. Accept-Ranges on HEAD alone is only advisory.
    if (info.size == null || info.size > 0) {
      const probeUrl = new URL(info.finalUrl || original.href);
      const { response, finalUrl } = await this.request('GET', probeUrl, { Range: 'bytes=0-0' }, signal);
      const status = response.statusCode || 0;
      if (status === 206) {
        const range = parseContentRange(response.headers['content-range']);
        if (range?.start === 0 && range.end === 0 && (range.total == null || range.total > 0)) {
          info = mergeProbeHeaders(info, response.headers, finalUrl, range.total);
          response.destroy();
          return { ...info, url: original.href, supportsRanges: true, validator: getStableValidator(info) };
        }
      }
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        response.destroy();
        throw errorFromHttpStatus(status);
      }
      if (status >= 400 && status !== 416) {
        const retryAfter = parseRetryAfter(response.headers['retry-after']);
        response.destroy();
        throw errorFromHttpStatus(status, retryAfter);
      }
      info = mergeProbeHeaders(info, response.headers, finalUrl);
      response.destroy();
      info = { ...info, supportsRanges: false };
    }
    return { ...info, url: original.href, supportsRanges: false, validator: getStableValidator(info) };
  }

  async openRange(address, start, end, { validator = null, signal = null } = {}) {
    const headers = { Range: `bytes=${start}-${end}` };
    if (validator) headers['If-Range'] = validator;
    return this.request('GET', address, headers, signal);
  }

  async openFrom(address, start, { validator = null, signal = null } = {}) {
    if (start <= 0) return this.request('GET', address, {}, signal);
    const headers = { Range: `bytes=${start}-` };
    if (validator) headers['If-Range'] = validator;
    return this.request('GET', address, headers, signal);
  }

  assertResponse(response, expectedStatus = 200) {
    const status = response.statusCode || 0;
    if (status !== expectedStatus) {
      const retryAfter = parseRetryAfter(response.headers['retry-after']);
      response.destroy();
      throw errorFromHttpStatus(status, retryAfter);
    }
  }

  close() {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}
