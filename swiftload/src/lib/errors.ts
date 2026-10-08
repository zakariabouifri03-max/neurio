import type { UiError } from "./types";

/**
 * Error presentation.
 *
 * The Rust side already sends a human sentence (`message`) plus a machine
 * readable `code`; this module only decides how the UI *presents* it: which
 * icon, whether a Retry button makes sense, and what to do when the failure did
 * not come from the engine at all.
 */

const FALLBACK: UiError = {
  code: "unknown",
  message: "Something went wrong.",
  detail: null,
  retryable: false,
};

/** Normalises anything thrown in the frontend into a `UiError`. */
export function toUiError(error: unknown): UiError {
  if (typeof error === "string") {
    return { ...FALLBACK, message: error };
  }
  if (error && typeof error === "object") {
    const candidate = error as Partial<UiError> & { code?: string };
    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return {
        code: candidate.code ?? "unknown",
        message: candidate.message,
        detail: candidate.detail ?? null,
        retryable: Boolean(candidate.retryable),
      };
    }
    if (error instanceof Error) {
      return { ...FALLBACK, message: error.message, detail: error.stack ?? null };
    }
  }
  return FALLBACK;
}

/** Short label used in badges and the error banner. */
export function errorLabel(error: UiError): string {
  switch (error.code) {
    case "invalid_url":
      return "Invalid URL";
    case "unsupported_scheme":
      return "Unsupported address";
    case "http_not_found":
      return "Not found";
    case "http_forbidden":
      return "Access denied";
    case "http_unauthorized":
      return "Login required";
    case "http_client_error":
      return "Request rejected";
    case "http_server_error":
      return "Server error";
    case "too_many_redirects":
      return "Redirect loop";
    case "timeout":
      return "Timed out";
    case "connection_reset":
      return "Connection lost";
    case "dns_failure":
      return "Host not found";
    case "tls_failure":
      return "TLS failure";
    case "proxy_failure":
      return "Proxy failure";
    case "range_unsupported":
      return "Resume unsupported";
    case "remote_changed":
      return "File changed";
    case "disk_error":
      return "Disk error";
    case "size_mismatch":
      return "Incomplete file";
    case "hash_mismatch":
      return "Checksum failed";
    case "cancelled":
      return "Cancelled";
    case "not_found":
      return "Not found";
    case "busy":
      return "Busy";
    default:
      return "Error";
  }
}

/** Human sentence for a short tooltip. */
export function errorHint(error: UiError): string {
  if (error.code === "range_unsupported") {
    return "The server does not support resumable downloads. SwiftLoad continues with a single connection.";
  }
  if (error.code === "disk_error") {
    return "Check that the download folder exists, is writable and has free space.";
  }
  return error.message;
}
