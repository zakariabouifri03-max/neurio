import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { DownloadError, abortError, statusError } from './errors.js';
import { parseChecksums } from './integrity-checker.js';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 8;

function headerNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (![start, end].every(Number.isSafeInteger) || (total !== null && !Number.isSafeInteger(total)) || end < start) return null;
  return { start, end, total };
}

function makeHeaders(headers = {}) {
  return {
    'User-Agent': 'AI Download Manager Pro/1.0 (+https://github.com/zakariabouifri03-max/neurio)',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
    ...headers,
  };
}

function validateUrl(input) {
  let url;
  try { url = new URL(input); } catch {
    throw new DownloadError('Enter a valid HTTP or HTTPS URL.', { code: 'EINVAL_URL' });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new DownloadError('Only public HTTP and HTTPS URLs are supported. Sign-in and access requirements are not bypassed.', { code: 'EINVAL_URL' });
  }
  url.hash = '';
  return url;
}

function abortableResponse(response, signal, removeListener) {
  if (!signal) return;
  const stop = () => response.destroy(abortError());
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  const cleanup = () => {
    signal.removeEventListener('abort', stop);
    removeListener?.();
  };
  response.once('close', cleanup);
  response.once('end', cleanup);
}

export class HttpClient {
  constructor({ timeoutMs = 30_000, maxRedirects = MAX_REDIRECTS } = {}) {
    this.timeoutMs = timeoutMs;
    this.maxRedirects = maxRedirects;
    this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, timeout: timeoutMs });
    this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16, timeout: timeoutMs });
  }

  async request(method, inputUrl, { headers = {}, signal, timeoutMs = this.timeoutMs } = {}) {
    const url = validateUrl(inputUrl);
    return this.#request(method, url, makeHeaders(headers), signal, timeoutMs, 0);
  }

  #request(method, url, headers, signal, timeoutMs, redirectCount) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const transport = url.protocol === 'https:' ? https : http;
      const agent = url.protocol === 'https:' ? this.httpsAgent : this.httpAgent;
      let req;
      let finished = false;
      const onAbort = () => req?.destroy(abortError());
      const clearSignal = () => signal?.removeEventListener('abort', onAbort);
      try {
        req = transport.request(url, { method, headers, agent, timeout: timeoutMs }, (response) => {
          const status = response.statusCode || 0;
          if (REDIRECTS.has(status) && response.headers.location) {
            if (redirectCount >= this.maxRedirects) {
              response.destroy();
              clearSignal();
              finished = true;
              reject(new DownloadError('The server redirected too many times.', { code: 'ERR_TOO_MANY_REDIRECTS' }));
              return;
            }
            let next;
            try { next = new URL(response.headers.location, url); } catch {
              response.destroy();
              clearSignal();
              finished = true;
              reject(new DownloadError('The server returned an invalid redirect.', { code: 'ERR_INVALID_REDIRECT' }));
              return;
            }
            try { validateUrl(next); } catch (error) {
              response.destroy();
              clearSignal();
              finished = true;
              reject(error);
              return;
            }
            // A redirect may not carry credentials across hosts; these requests
            // intentionally contain no saved cookies or authentication headers.
            response.resume();
            response.once('end', () => {
              clearSignal();
              const redirectedMethod = status === 303 && method !== 'HEAD' ? 'GET' : method;
              this.#request(redirectedMethod, next, headers, signal, timeoutMs, redirectCount + 1).then(resolve, reject);
            });
            response.once('error', (error) => {
              clearSignal();
              if (!finished) reject(error);
            });
            return;
          }
          finished = true;
          abortableResponse(response, signal, clearSignal);
          response.requestUrl = url.toString();
          resolve(response);
        });
      } catch (error) {
        clearSignal();
        reject(error);
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      req.once('error', (error) => {
        clearSignal();
        if (!finished) reject(error);
      });
      req.once('timeout', () => {
        const error = new DownloadError('The server connection timed out.', { code: 'ETIMEDOUT', retryable: true });
        req.destroy(error);
      });
      req.end();
    });
  }

  async inspect(inputUrl, signal) {
    const originalUrl = validateUrl(inputUrl).toString();
    let headResponse = null;
    let headError = null;
    try {
      headResponse = await this.request('HEAD', originalUrl, { signal });
    } catch (error) {
      headError = error;
    }

    let head = null;
    if (headResponse) {
      head = {
        status: headResponse.statusCode || 0,
        headers: headResponse.headers,
        url: headResponse.requestUrl || originalUrl,
      };
      await drain(headResponse);
    }

    const headStatus = head?.status || 0;
    const headAllowed = head && headStatus >= 200 && headStatus < 300;
    const headMethodUnsupported = [405, 501].includes(headStatus);
    const headForbidden = [401, 403].includes(headStatus);
    const headMissing = [404, 410].includes(headStatus);

    if (headMissing) throw statusError(headStatus, head.headers);
    if (headError && !isRecoverableProbeError(headError)) throw headError;

    // Use an actual one-byte GET to verify range support. Accept-Ranges alone
    // is advisory; only a valid 206 and Content-Range prove byte-range support.
    let probe;
    try {
      probe = await this.request('GET', head?.url || originalUrl, {
        headers: { Range: 'bytes=0-0' },
        signal,
      });
    } catch (error) {
      if (headForbidden || headStatus >= 400) throw statusError(headStatus, head?.headers || {});
      throw error;
    }

    const headers = { ...(head?.headers || {}), ...probe.headers };
    const status = probe.statusCode || 0;
    const contentRange = parseContentRange(probe.headers['content-range']);
    const rangeSupported = status === 206 && contentRange?.start === 0 && contentRange?.end === 0 && Number.isSafeInteger(contentRange.total) && contentRange.total > 0;
    const totalBytes = rangeSupported ? contentRange.total : headerNumber(head?.headers?.['content-length']) ?? headerNumber(probe.headers['content-length']);
    const result = {
      url: probe.requestUrl || head?.url || originalUrl,
      totalBytes,
      rangeSupported,
      acceptRanges: String(headers['accept-ranges'] || '').toLowerCase(),
      contentType: headers['content-type'] || 'application/octet-stream',
      etag: headers.etag || null,
      lastModified: headers['last-modified'] || null,
      contentDisposition: headers['content-disposition'] || null,
      checksums: parseChecksums(headers),
      headStatus,
      probeStatus: status,
    };
    if (rangeSupported) await drain(probe);
    else {
      // If the server ignored Range, never consume a potentially huge 200 body
      // just to probe. A fresh single-connection request will start at byte 0.
      probe.destroy();
      await new Promise((resolve) => probe.once('close', resolve));
    }

    if (status >= 400) throw statusError(status, headers);
    if (status < 200 || status >= 300) throw new DownloadError(`The server returned an unexpected HTTP status (${status}).`, { code: `HTTP_${status}`, statusCode: status });
    if (result.totalBytes !== null && result.totalBytes > Number.MAX_SAFE_INTEGER) {
      throw new DownloadError('This file is larger than the current platform can safely address.', { code: 'ERR_FILE_TOO_LARGE' });
    }
    if (headMethodUnsupported) result.headStatus = headStatus;
    return result;
  }

  close() {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

function isRecoverableProbeError(error) {
  return ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND'].includes(error?.code) || error?.code === 'HTTP_405' || error?.code === 'HTTP_501';
}

function drain(response) {
  return new Promise((resolve, reject) => {
    if (response.destroyed || response.readableEnded) return resolve();
    response.once('end', resolve);
    response.once('error', reject);
    response.resume();
  });
}
