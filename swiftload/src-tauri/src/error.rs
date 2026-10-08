//! Error taxonomy.
//!
//! The distinction that matters for the whole application is
//! *transient* vs *permanent*: the retry manager only ever retries transient
//! failures with exponential backoff, and the UI only offers a **Retry** button
//! for failures that can plausibly succeed later.

use std::fmt;

use serde::Serialize;

use crate::types::UiError;

/// Stable machine-readable error codes shared with the frontend.
pub mod code {
    pub const INVALID_URL: &str = "invalid_url";
    pub const UNSUPPORTED_SCHEME: &str = "unsupported_scheme";
    pub const HTTP_NOT_FOUND: &str = "http_not_found";
    pub const HTTP_FORBIDDEN: &str = "http_forbidden";
    pub const HTTP_UNAUTHORIZED: &str = "http_unauthorized";
    pub const HTTP_CLIENT_ERROR: &str = "http_client_error";
    pub const HTTP_SERVER_ERROR: &str = "http_server_error";
    pub const TOO_MANY_REDIRECTS: &str = "too_many_redirects";
    pub const TIMEOUT: &str = "timeout";
    pub const CONNECTION_RESET: &str = "connection_reset";
    pub const DNS_FAILURE: &str = "dns_failure";
    pub const TLS_FAILURE: &str = "tls_failure";
    pub const PROXY_FAILURE: &str = "proxy_failure";
    pub const RANGE_UNSUPPORTED: &str = "range_unsupported";
    pub const REMOTE_CHANGED: &str = "remote_changed";
    pub const DISK_ERROR: &str = "disk_error";
    pub const SIZE_MISMATCH: &str = "size_mismatch";
    pub const HASH_MISMATCH: &str = "hash_mismatch";
    pub const CANCELLED: &str = "cancelled";
    pub const PAUSED: &str = "paused";
    pub const NOT_FOUND: &str = "not_found";
    pub const IO_OTHER: &str = "io_error";
    pub const SERVER: &str = "server_error";
    pub const BUSY: &str = "busy";
    pub const CHECKSUM_UNSUPPORTED: &str = "checksum_unsupported";
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum AppError {
    InvalidUrl(String),
    UnsupportedScheme(String),
    /// Non-2xx response. `permanent` marks 4xx-class failures the retry manager
    /// must not retry; `retry_after_secs` carries an honoured `Retry-After`
    /// header (429 / 503) so backoff matches what the server asked for.
    HttpStatus {
        status: u16,
        reason: String,
        permanent: bool,
        retry_after_secs: Option<u64>,
    },
    TooManyRedirects,
    Timeout(String),
    ConnectionReset(String),
    Dns(String),
    Tls(String),
    Proxy(String),
    /// The server answered a ranged request with `200 OK` (full body) or the
    /// resume offset is beyond EOF.
    RangeUnsupported(String),
    /// The resource changed on the server while we were downloading it.
    RemoteChanged(String),
    Disk(String),
    SizeMismatch { expected: u64, actual: u64 },
    HashMismatch { expected: String, actual: String },
    Cancelled,
    NotFound(String),
    Server(String),
    Io(String),
    Busy(String),
}

impl AppError {
    /// Builds an HTTP-status error, deriving `permanent` and the honoured
    /// `Retry-After` delay from the status code.
    pub fn http(status: u16, reason: impl Into<String>, retry_after_secs: Option<u64>) -> AppError {
        let permanent = !(status == 408 || status == 429 || status >= 500);
        AppError::HttpStatus {
            status,
            reason: reason.into(),
            permanent,
            retry_after_secs,
        }
    }

    /// The exact delay the server asked for, if any.
    pub fn retry_after(&self) -> Option<std::time::Duration> {
        match self {
            AppError::HttpStatus { retry_after_secs: Some(secs), .. } => {
                Some(std::time::Duration::from_secs(*secs))
            }
            _ => None,
        }
    }

    /// Codes that the frontend maps to a Retry affordance.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::InvalidUrl(_) => code::INVALID_URL,
            AppError::UnsupportedScheme(_) => code::UNSUPPORTED_SCHEME,
            AppError::HttpStatus { status, .. } => match status {
                401 => code::HTTP_UNAUTHORIZED,
                403 => code::HTTP_FORBIDDEN,
                404 | 410 => code::HTTP_NOT_FOUND,
                s if (400..500).contains(s) => code::HTTP_CLIENT_ERROR,
                _ => code::HTTP_SERVER_ERROR,
            },
            AppError::TooManyRedirects => code::TOO_MANY_REDIRECTS,
            AppError::Timeout(_) => code::TIMEOUT,
            AppError::ConnectionReset(_) => code::CONNECTION_RESET,
            AppError::Dns(_) => code::DNS_FAILURE,
            AppError::Tls(_) => code::TLS_FAILURE,
            AppError::Proxy(_) => code::PROXY_FAILURE,
            AppError::RangeUnsupported(_) => code::RANGE_UNSUPPORTED,
            AppError::RemoteChanged(_) => code::REMOTE_CHANGED,
            AppError::Disk(_) => code::DISK_ERROR,
            AppError::SizeMismatch { .. } => code::SIZE_MISMATCH,
            AppError::HashMismatch { .. } => code::HASH_MISMATCH,
            AppError::Cancelled => code::CANCELLED,
            AppError::NotFound(_) => code::NOT_FOUND,
            AppError::Server(_) => code::SERVER,
            AppError::Io(_) => code::IO_OTHER,
            AppError::Busy(_) => code::BUSY,
        }
    }

    /// Whether retrying later could possibly succeed.
    pub fn is_transient(&self) -> bool {
        match self {
            // Forever-permanent: a bad URL never becomes a good URL.
            AppError::InvalidUrl(_) | AppError::UnsupportedScheme(_) => false,
            // 4xx is the client's fault, except 408 Request Timeout and
            // 429 Too Many Requests which are explicitly "try again later".
            AppError::HttpStatus { status, permanent, .. } => {
                !permanent && (*status == 408 || *status == 429 || *status >= 500)
            }
            AppError::TooManyRedirects => false,
            AppError::Timeout(_)
            | AppError::ConnectionReset(_)
            | AppError::Dns(_)
            | AppError::Server(_) => true,
            AppError::Tls(_) => false,
            AppError::Proxy(_) => false,
            AppError::RangeUnsupported(_) => false,
            AppError::RemoteChanged(_) => false,
            AppError::Disk(_) => false,
            AppError::SizeMismatch { .. } => true,
            AppError::HashMismatch { .. } => false,
            AppError::Cancelled => false,
            AppError::NotFound(_) => false,
            AppError::Io(_) => false,
            AppError::Busy(_) => true,
        }
    }

    /// Sentence shown in the UI. Written for humans, not for logs.
    pub fn message(&self) -> String {
        match self {
            AppError::InvalidUrl(d) => {
                format!("That does not look like a valid URL ({d}). Expected something like https://example.com/file.zip.")
            }
            AppError::UnsupportedScheme(s) => format!(
                "The '{s}' scheme is not supported. SwiftLoad downloads over http:// or https://."
            ),
            AppError::HttpStatus { status, reason, retry_after_secs, .. } => match *status {
                404 | 410 => "HTTP 404 — file not found on the server.".to_string(),
                403 => "HTTP 403 — access denied by the server.".to_string(),
                401 => "HTTP 401 — authentication required.".to_string(),
                416 => "HTTP 416 — the server rejected the requested byte range.".to_string(),
                429 => with_retry_after("HTTP 429 — the server is rate limiting requests.", retry_after_secs),
                s if (500..600).contains(&s) => with_retry_after(
                    &format!("HTTP {s} — the server reported an internal error{}", reason_suffix(reason)),
                    retry_after_secs,
                ),
                s if (400..500).contains(&s) => format!("HTTP {s} — the server refused the request{}", reason_suffix(reason)),
                s => format!("HTTP {s} — unexpected response{}", reason_suffix(reason)),
            },
            AppError::TooManyRedirects => "The server redirected too many times (possible redirect loop).".to_string(),
            AppError::Timeout(d) => format!("Connection timed out{d}.", suffix(d)),
            AppError::ConnectionReset(d) => format!("Connection interrupted or reset by the server{}.", suffix(d)),
            AppError::Dns(d) => format!("Could not resolve the host name (DNS failure){}.", suffix(d)),
            AppError::Tls(d) => format!("SSL/TLS connection failed{}.", suffix(d)),
            AppError::Proxy(d) => format!("The configured proxy could not be used{}.", suffix(d)),
            AppError::RangeUnsupported(d) => format!("The server does not support resumable downloads{}.", suffix(d)),
            AppError::RemoteChanged(d) => format!(
                "The file changed on the server while SwiftLoad was downloading it{}. Restart the download.",
                suffix(d)
            ),
            AppError::Disk(d) => format!("Could not write to disk{}.", suffix(d)),
            AppError::SizeMismatch { expected, actual } => format!(
                "Size mismatch: expected {expected} bytes but the finished file has {actual} bytes. The file was kept as incomplete."
            ),
            AppError::HashMismatch { expected, actual } => {
                format!("SHA-256 mismatch: expected {expected}, got {actual}.")
            }
            AppError::Cancelled => "Download cancelled.".to_string(),
            AppError::NotFound(d) => format!("Not found{d}.", suffix(d)),
            AppError::Server(d) => format!("The download server reported an error{}.", suffix(d)),
            AppError::Io(d) => format!("I/O error{}.", suffix(d)),
            AppError::Busy(d) => format!("The download could not be started{}.", suffix(d)),
        }
    }

    /// Extra clue for a log file / tooltip — never contains credentials, and it
    /// is the frontend that decides whether to surface it.
    pub fn detail(&self) -> Option<String> {
        match self {
            AppError::Timeout(d)
            | AppError::ConnectionReset(d)
            | AppError::Dns(d)
            | AppError::Tls(d)
            | AppError::Proxy(d)
            | AppError::RangeUnsupported(d)
            | AppError::RemoteChanged(d)
            | AppError::Disk(d)
            | AppError::Io(d)
            | AppError::Busy(d) => non_empty(d),
            AppError::HttpStatus { reason, status, retry_after_secs, .. } => {
                let mut detail = format!("{status} {reason}");
                if let Some(secs) = retry_after_secs {
                    detail.push_str(&format!(" (retry-after: {secs}s)"));
                }
                non_empty(&detail)
            }
            AppError::SizeMismatch { expected, actual } => Some(format!("expected={expected} actual={actual}")),
            AppError::HashMismatch { expected, actual } => Some(format!("expected={expected} actual={actual}")),
            _ => None,
        }
    }

    pub fn to_ui(&self) -> UiError {
        UiError {
            code: self.code().to_string(),
            message: self.message(),
            detail: self.detail(),
            retryable: self.is_transient(),
        }
    }

    /// A short log-friendly rendering.
    pub fn log_line(&self) -> String {
        match self.detail() {
            Some(d) => format!("[{}] {} ({})", self.code(), self.message(), d),
            None => format!("[{}] {}", self.code(), self.message()),
        }
    }
}

fn suffix(detail: &str) -> String {
    if detail.trim().is_empty() {
        String::new()
    } else {
        format!(": {detail}")
    }
}

fn with_retry_after(message: &str, retry_after_secs: &Option<u64>) -> String {
    match retry_after_secs {
        Some(secs) => format!("{message} SwiftLoad will retry in {secs}s."),
        None => message.to_string(),
    }
}

fn reason_suffix(reason: &str) -> String {
    let reason = reason.trim();
    if reason.is_empty() {
        String::new()
    } else {
        format!(" ({reason})")
    }
}

fn non_empty(s: &str) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match e.kind() {
            ErrorKind::NotFound => AppError::NotFound(e.to_string()),
            ErrorKind::PermissionDenied => AppError::Disk(format!("permission denied: {e}")),
            ErrorKind::TimedOut => AppError::Timeout(e.to_string()),
            ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted | ErrorKind::BrokenPipe => {
                AppError::ConnectionReset(e.to_string())
            }
            _ => AppError::Disk(e.to_string()),
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // Order matters: a timeout also reports `is_request()`, and a
        // redirect-loop error is neither connect nor body.
        if e.is_timeout() {
            return AppError::Timeout(compact(&e));
        }
        if e.is_redirect() {
            return AppError::TooManyRedirects;
        }
        if e.is_connect() {
            let text = compact(&e);
            let lower = text.to_ascii_lowercase();
            if lower.contains("dns") || lower.contains("name or service") || lower.contains("failed to lookup") {
                return AppError::Dns(text);
            }
            if lower.contains("tls")
                || lower.contains("certificate")
                || lower.contains("ssl")
                || lower.contains("handshake")
            {
                return AppError::Tls(text);
            }
            if lower.contains("proxy") {
                return AppError::Proxy(text);
            }
            return AppError::ConnectionReset(format!("connection failed: {text}"));
        }
        if e.is_body() || e.is_decode() {
            return AppError::ConnectionReset(format!("response body error: {}", compact(&e)));
        }
        if e.is_status() {
            if let Some(status) = e.status() {
                return AppError::http(status.as_u16(), status.canonical_reason().unwrap_or(""), None);
            }
        }
        AppError::ConnectionReset(compact(&e))
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Server(format!("database error: {e}"))
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.message()
    }
}

/// Renders a `reqwest::Error` with its full source chain, which is where the
/// genuinely useful part (e.g. `invalid peer certificate`) lives.
fn compact(e: &reqwest::Error) -> String {
    let mut out = e.to_string();
    let mut src: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(e);
    let mut depth = 0;
    while let Some(inner) = src {
        if depth > 3 {
            break;
        }
        let text = inner.to_string();
        if !out.contains(&text) {
            out.push_str(": ");
            out.push_str(&text);
        }
        src = inner.source();
        depth += 1;
    }
    out
}

/// Convenience alias used across the engine.
pub type Result<T> = std::result::Result<T, AppError>;
