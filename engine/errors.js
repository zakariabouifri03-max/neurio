export class DownloadError extends Error {
  constructor(message, { code = 'DOWNLOAD_ERROR', statusCode, retryAfterMs, retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DownloadError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
  }
}

export function abortError() {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

export function isAbortError(error) {
  return Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR' || false));
}

export function isRetryableError(error) {
  if (error?.retryable) return true;
  if (error?.statusCode) return [408, 425, 429, 500, 502, 503, 504].includes(error.statusCode);
  return ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error?.code);
}

export function statusError(statusCode, headers = {}) {
  const retryAfterMs = parseRetryAfter(headers['retry-after']);
  const messages = {
    400: 'The server rejected this download request.',
    401: 'This file requires authentication. AI Download Manager Pro does not bypass sign-in requirements.',
    403: 'The server denied access to this file. Check the link or your access permission.',
    404: 'The file could not be found (404). Check that the URL is correct.',
    410: 'This download link has expired (410). Request a current link from its owner.',
    416: 'The server rejected the requested byte range.',
    429: 'The server is limiting requests (429). The manager will wait before retrying.',
    500: 'The server encountered an error (500).',
    502: 'The download server returned a gateway error (502).',
    503: 'The download server is temporarily unavailable (503).',
    504: 'The download server timed out (504).',
  };
  return new DownloadError(messages[statusCode] || `The server returned HTTP ${statusCode}.`, {
    code: `HTTP_${statusCode}`,
    statusCode,
    retryAfterMs,
    retryable: [408, 425, 429, 500, 502, 503, 504].includes(statusCode),
  });
}

export function parseRetryAfter(value, now = Date.now()) {
  if (Array.isArray(value)) value = value[0];
  if (value == null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  const date = Date.parse(String(value));
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - now, 24 * 60 * 60 * 1000));
  return undefined;
}

export function friendlyError(error) {
  if (!error) return 'An unexpected error occurred.';
  if (error.code === 'ENOSPC') return 'There is not enough free disk space to continue this download.';
  if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS') return 'The application cannot write to this folder. Choose a folder where you have permission.';
  if (error.code === 'ENOTDIR') return 'The selected download path is not a folder.';
  if (error.code === 'EINVAL_URL') return 'Enter a valid HTTP or HTTPS URL.';
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') return 'The server stopped responding. The download will retry from the saved byte position.';
  if (error.code === 'EAI_AGAIN' || error.code === 'ENOTFOUND') return 'The server address could not be resolved. Check your connection and try again.';
  if (error.code === 'ECONNRESET' || error.code === 'EPIPE') return 'The connection was interrupted. The download will retry from the saved byte position.';
  if (error.code === 'ERR_ENTITY_CHANGED') return 'The file changed on the server during transfer. The partial data was kept safe; resume to retry against the current version.';
  if (error.code === 'ERR_RANGE_UNSUPPORTED') return 'The server does not support byte ranges. Switching to a single connection.';
  if (error.code === 'ERR_DISK_SPACE') return 'There may not be enough free disk space for this file.';
  if (error.code === 'ERR_INCOMPLETE_FILE') return 'The server ended the transfer before all expected bytes arrived. The unfinished segment will be retried.';
  if (error.message?.startsWith('The server')) return error.message;
  return error.message || 'An unexpected error occurred. Open Diagnostics for technical details.';
}
