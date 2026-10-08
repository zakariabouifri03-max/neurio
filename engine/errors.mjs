export class DownloadError extends Error {
  constructor(message, { code = 'DOWNLOAD_ERROR', status = null, retryable = false, cause = null, details = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DownloadError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export class RangeFallbackError extends DownloadError {
  constructor(message = 'The server did not honor a byte-range request.') {
    super(message, { code: 'RANGE_FALLBACK' });
    this.name = 'RangeFallbackError';
  }
}

export class PauseError extends DownloadError {
  constructor() {
    super('Download paused.', { code: 'PAUSED' });
    this.name = 'PauseError';
  }
}

export class CancelError extends DownloadError {
  constructor() {
    super('Download cancelled.', { code: 'CANCELLED' });
    this.name = 'CancelError';
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || error?.code === 'PAUSED' || error?.code === 'CANCELLED';
}

export function errorFromHttpStatus(status, retryAfter = null) {
  const messages = {
    401: 'The server requires authorization for this file.',
    403: 'The server denied access to this file. Check that the link is valid and that you are authorized to use it.',
    404: 'The file was not found (HTTP 404).',
    408: 'The server timed out while handling the request.',
    410: 'This download link is no longer available.',
    429: 'The server is rate-limiting requests. AI Download Manager Pro will back off and retry respectfully.',
    500: 'The server encountered an internal error (HTTP 500).',
    502: 'A gateway between you and the server returned an error (HTTP 502).',
    503: 'The server is temporarily unavailable (HTTP 503).',
    504: 'A gateway timed out while contacting the server (HTTP 504).',
  };
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return new DownloadError(messages[status] || `The server returned HTTP ${status}.`, {
    code: `HTTP_${status}`,
    status,
    retryable,
    details: retryAfter == null ? null : { retryAfter },
  });
}

export function friendlyError(error) {
  if (!error) return 'An unknown error occurred.';
  if (error.code === 'ENOSPC') return 'The download could not continue because the destination disk is full. Free disk space, then resume the download.';
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'The application does not have permission to write to the selected folder. Choose a folder you can access.';
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') return 'The server could not be found. Check your internet connection and the URL.';
  if (['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'EHOSTDOWN'].includes(error.code)) return 'The network connection was interrupted. The affected segment will be retried when possible.';
  if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') return 'The server stopped responding before the request completed.';
  if (error.code === 'INVALID_URL') return 'Enter a valid HTTP or HTTPS download URL.';
  if (error.code === 'INTEGRITY_ERROR') return 'The downloaded file did not pass integrity checks. The incomplete file was not marked as complete.';
  if (error.code === 'RANGE_UNSUPPORTED') return 'The server does not support parallel byte-range downloads. Switching to a single connection.';
  if (error.status) return error.message;
  return error.message || 'The download could not be completed.';
}
