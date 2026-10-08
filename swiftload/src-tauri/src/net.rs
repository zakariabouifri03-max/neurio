//! Connection manager: URL validation, HTTP client construction, and the
//! capability probe used to choose a download strategy.
//!
//! ## TLS
//! The client is built with `rustls` and the **native root certificates**
//! (`rustls-tls-native-roots`), i.e. the same trust store Windows uses.
//! Certificate verification is never disabled — there is no code path in this
//! application that calls `danger_accept_invalid_certs`, and there is no setting
//! that could enable it.
//!
//! ## Content decoding
//! `reqwest`'s automatic gzip/brotli decoding is intentionally *not* compiled in
//! (`default-features = false`, no `gzip` feature). Transparent decompression
//! would make `Content-Length` describe the compressed stream while the file we
//! write is the decompressed one, which would corrupt both resume arithmetic and
//! the integrity check. Requests therefore advertise `Accept-Encoding: identity`.
//!
//! ## Timeouts
//! There is deliberately **no whole-request timeout**: a legitimate download can
//! run for hours. Instead the application uses `connect_timeout` plus an idle
//! watchdog implemented in the download worker (`stall_timeout_ms`).

use std::time::{Duration, Instant};

use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_RANGES, AUTHORIZATION, CONTENT_DISPOSITION,
    CONTENT_LENGTH, CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE, RETRY_AFTER,
};
use reqwest::{Client, Response, StatusCode};
use url::Url;

use crate::error::{code, AppError, Result};
use crate::logging::{Category, Logger};
use crate::settings::{NetworkSettings, ProxyMode};
use crate::types::ResourceMeta;

/// Longest URL we accept, to keep pathological input out of the database.
pub const MAX_URL_LEN: usize = 8192;

/// The `Range` header we send to prove (or disprove) byte-range support.
pub const PROBE_RANGE: &str = "bytes=0-0";

/// Validates a user supplied URL and normalises it.
///
/// Rejected: anything that is not `http`/`https`, URLs without a host, URLs that
/// contain control characters or whitespace, and oversized URLs. Fragments are
/// stripped because they are never sent to the server.
pub fn validate_url(raw: &str) -> Result<Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidUrl("the address is empty".into()));
    }
    if trimmed.len() > MAX_URL_LEN {
        return Err(AppError::InvalidUrl(format!(
            "the address is longer than {MAX_URL_LEN} characters"
        )));
    }
    if trimmed.chars().any(|c| c.is_control() || c == ' ') {
        return Err(AppError::InvalidUrl(
            "the address contains spaces or control characters".into(),
        ));
    }
    // Percent-decode mistakes such as a literal '|' or '"' inside the path show
    // up as parse errors below; the url crate rejects them for us.

    let parsed = Url::parse(trimmed).map_err(|e| AppError::InvalidUrl(e.to_string()))?;

    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(AppError::UnsupportedScheme(other.to_string())),
    }

    match parsed.host_str() {
        Some(host) if !host.is_empty() => {}
        _ => return Err(AppError::InvalidUrl("the address has no host name".into())),
    }

    if parsed.cannot_be_a_base() {
        return Err(AppError::InvalidUrl("the address is not a file address".into()));
    }

    let mut parsed = parsed;
    parsed.set_fragment(None);
    Ok(parsed)
}

/// Splits credentials out of a URL so that they are sent as an `Authorization`
/// header instead of leaking into the request line (and into logs).
pub fn prepare_url(url: &Url) -> (Url, Option<String>) {
    if url.username().is_empty() && url.password().is_none() {
        return (url.clone(), None);
    }
    let user = percent_encoding::percent_decode_str(url.username())
        .decode_utf8_lossy()
        .to_string();
    let pass = url
        .password()
        .map(|p| percent_encoding::percent_decode_str(p).decode_utf8_lossy().to_string())
        .unwrap_or_default();
    let header = format!("Basic {}", crate::util::base64_encode(format!("{user}:{pass}").as_bytes()));

    let mut clean = url.clone();
    let _ = clean.set_username("");
    let _ = clean.set_password(None);
    (clean, Some(header))
}

/// Builds the "Range" header value for an inclusive range.
pub fn range_header(start: u64, end: u64) -> String {
    format!("bytes={start}-{end}")
}

/// Parsed `Content-Range` response header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContentRange {
    pub start: u64,
    pub end: u64,
    /// `None` when the server reported `*` as the complete length.
    pub total: Option<u64>,
}

impl ContentRange {
    pub fn len(&self) -> u64 {
        self.end.saturating_sub(self.start).saturating_add(1)
    }
}

/// Parses `bytes 0-1023/2048` (whitespace tolerant, returns `None` for
/// `bytes */2048` which carries no range).
pub fn parse_content_range(value: &str) -> Option<ContentRange> {
    let value = value.trim();
    let rest = value.strip_prefix("bytes")?.trim_start();
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.trim().split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = end.trim().parse().ok()?;
    if end < start {
        return None;
    }
    let total = match total.trim() {
        "*" => None,
        other => Some(other.parse::<u64>().ok()?),
    };
    Some(ContentRange { start, end, total })
}

/// Extracts a filename candidate from `Content-Disposition`, honouring RFC 5987
/// (`filename*=UTF-8''…`) and quoted/bare `filename=` forms.
pub fn filename_from_content_disposition(value: &str) -> Option<String> {
    let mut plain: Option<String> = None;

    for part in split_directives(value) {
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("filename*") {
            // `filename*=UTF-8''percent-encoded`
            let original = &part[part.len() - rest.len()..];
            if let Some(value) = original.trim_start_matches('=').splitn(2, '\'').nth(1) {
                // value is now `''percent-encoded` or `charset'lang'percent`
                let encoded = value.splitn(2, '\'').nth(1).unwrap_or(value);
                let decoded = percent_encoding::percent_decode_str(encoded.trim_matches('"'))
                    .decode_utf8_lossy()
                    .to_string();
                return Some(decoded);
            }
        } else if let Some(rest) = lower.strip_prefix("filename") {
            let original = &part[part.len() - rest.len()..];
            let raw = original.trim_start_matches('=').trim();
            let unquoted = raw.trim_matches('"').replace("\\\"", "\"");
            if !unquoted.is_empty() {
                plain = Some(unquoted);
            }
        }
    }

    plain.filter(|name| !name.trim().is_empty())
}

/// Splits a header value on `;` while respecting quoted sections.
fn split_directives(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut escaped = false;
    for ch in value.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_quotes => escaped = true,
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            ';' if !in_quotes => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

/// Last path segment of a URL, percent-decoded.
pub fn filename_from_url(url: &Url) -> Option<String> {
    let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    let last = segments.last()?;
    let decoded = percent_encoding::percent_decode_str(last).decode_utf8_lossy().to_string();
    if decoded.trim().is_empty() {
        None
    } else {
        Some(decoded)
    }
}

/// Parses `Retry-After` (delta-seconds or HTTP-date).
pub fn parse_retry_after(headers: &HeaderMap) -> Option<u64> {
    let raw = headers.get(RETRY_AFTER)?.to_str().ok()?.trim().to_string();
    if let Ok(seconds) = raw.parse::<u64>() {
        return Some(seconds.min(3600));
    }
    // HTTP-date form.
    if let Ok(date) = chrono::DateTime::parse_from_rfc2822(&raw) {
        let now = chrono::Utc::now();
        let delta = (date.with_timezone(&chrono::Utc) - now).num_seconds();
        return Some(delta.clamp(0, 3600) as u64);
    }
    None
}

/// The HTTP transport. Cheap to clone (the inner `reqwest::Client` is `Arc`ed).
#[derive(Clone)]
pub struct HttpClient {
    client: Client,
    user_agent: String,
    logger: Logger,
    stall_timeout: Option<Duration>,
}

impl HttpClient {
    /// Builds a client from the network settings.
    pub fn build(net: &NetworkSettings, logger: Logger) -> Result<HttpClient> {
        let mut builder = Client::builder()
            .connect_timeout(net.connect_timeout().max(Duration::from_millis(1)))
            .user_agent(net.user_agent.clone())
            .pool_max_idle_per_host(net.pool_idle_per_host as usize)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_nodelay(true)
            // Never relax certificate verification (see module docs).
            .danger_accept_invalid_certs(false)
            .redirect(if net.max_redirects == 0 {
                reqwest::redirect::Policy::none()
            } else {
                reqwest::redirect::Policy::limited(net.max_redirects as usize)
            });

        if net.http1_only {
            builder = builder.http1_only();
        }

        match net.proxy_mode {
            ProxyMode::Off => {
                // `no_proxy()` with no argument disables proxy detection
                // entirely, including the environment/system proxy.
                builder = builder.no_proxy();
            }
            ProxyMode::System => {
                // reqwest picks up the Windows registry / environment proxy.
            }
            ProxyMode::Custom => {
                if net.proxy_url.trim().is_empty() {
                    return Err(AppError::Proxy("no proxy address configured".into()));
                }
                let no_proxy = if net.no_proxy.trim().is_empty() {
                    None
                } else {
                    Some(reqwest::NoProxy::from_string(&net.no_proxy))
                };
                let proxy = reqwest::Proxy::all(net.proxy_url.trim())
                    .map_err(|e| AppError::Proxy(e.to_string()))?;
                builder = match no_proxy {
                    Some(no_proxy) => builder.proxy(proxy.no_proxy(no_proxy)),
                    None => builder.proxy(proxy),
                };
            }
        }

        let client = builder
            .build()
            .map_err(|e| AppError::Server(format!("could not initialise the HTTP client: {e}")))?;

        Ok(HttpClient {
            client,
            user_agent: net.user_agent.clone(),
            logger,
            stall_timeout: if net.stall_timeout_ms == 0 {
                None
            } else {
                Some(Duration::from_millis(net.stall_timeout_ms))
            },
        })
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn user_agent(&self) -> &str {
        &self.user_agent
    }

    pub fn stall_timeout(&self) -> Option<Duration> {
        self.stall_timeout
    }

    pub fn logger(&self) -> &Logger {
        &self.logger
    }

    /// Sends a GET and returns the response, mapping transport failures onto
    /// typed [`AppError`]s (timeouts, DNS, TLS, resets).
    pub async fn get(
        &self,
        url: &Url,
        range: Option<(u64, u64)>,
        if_range: Option<&str>,
        auth: Option<&str>,
    ) -> Result<Response> {
        let (clean, url_auth) = prepare_url(url);
        let mut request = self
            .client
            .get(clean)
            .header(ACCEPT, "*/*")
            // Explicitly refuse transparent compression: byte ranges and
            // Content-Length only make sense for the identity encoding.
            .header(ACCEPT_ENCODING, "identity");

        if let Some((start, end)) = range {
            request = request.header(RANGE, range_header(start, end));
        }
        if let Some(validator) = if_range {
            // Only continue when the resource is unchanged; the server answers
            // 200 (full body) instead of 206 when the validator no longer
            // matches, which is exactly the signal we need to restart cleanly.
            request = request.header(IF_RANGE, validator);
        }
        if let Some(auth) = auth.or(url_auth.as_deref()) {
            request = request.header(AUTHORIZATION, auth);
        }

        let started = Instant::now();
        let response = request.send().await?;
        self.logger.debug(
            Category::Http,
            None,
            format!(
                "{} {} -> {} in {}ms",
                if range.is_some() { "GET(range)" } else { "GET" },
                crate::logging::redact_url(clean.as_str()),
                response.status().as_u16(),
                started.elapsed().as_millis()
            ),
        );
        Ok(response)
    }

    /// Capability probe: one tiny ranged request that yields the metadata needed
    /// to pick a strategy. Only the headers of that one-byte response are used.
    pub async fn probe(&self, url: &Url) -> Result<ResourceMeta> {
        let started = Instant::now();
        let response = self.get(url, Some((0, 0)), None, None).await?;
        let status = response.status();
        let final_url = response.url().clone();
        let headers = response.headers().clone();
        // The body is dropped on purpose: it is either one byte (206) or, when a
        // server ignores the Range header, the beginning of the file, which we
        // will request again as a normal download. Nothing is written to disk
        // before the strategy is known.
        drop(response);

        if status.is_client_error() || status.is_server_error() {
            return Err(AppError::http(
                status.as_u16(),
                status.canonical_reason().unwrap_or(""),
                parse_retry_after(&headers),
            ));
        }
        if !status.is_success() {
            return Err(AppError::Server(format!(
                "unexpected HTTP status {} while probing",
                status.as_u16()
            )));
        }

        let content_range = headers
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_content_range);

        let content_length = headers
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok())
            .or_else(|| content_range.and_then(|cr| cr.total));

        let ranged = status == StatusCode::PARTIAL_CONTENT;
        let claims_ranges = headers
            .get(ACCEPT_RANGES)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("bytes") || v.eq_ignore_ascii_case("items"))
            .unwrap_or(false);

        // Proof before fragmentation.
        //
        // * `206` + a well-formed `Content-Range` is proof.
        // * A server that answers `200` to `bytes=0-0` while claiming
        //   `Accept-Ranges: bytes` is *claiming* support; we verify that claim
        //   with one extra request at a non-zero offset, because sending an
        //   ignored `Range` header to a fragmented worker would produce silent
        //   file corruption (every worker would download from byte 0).
        let accepts_ranges = if ranged {
            true
        } else if claims_ranges && content_length.unwrap_or(0) > 1 {
            self.verify_range_support(url, &headers, content_length).await
        } else {
            false
        };

        let filename = headers
            .get(CONTENT_DISPOSITION)
            .and_then(|v| v.to_str().ok())
            .and_then(filename_from_content_disposition)
            .or_else(|| filename_from_url(&final_url))
            .unwrap_or_else(|| "download".to_string());

        let elapsed = started.elapsed();

        Ok(ResourceMeta {
            final_url: final_url.to_string(),
            filename,
            content_length,
            accepts_ranges,
            etag: headers.get(ETAG).and_then(|v| v.to_str().ok()).map(|s| s.to_string()),
            last_modified: headers
                .get(LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string()),
            content_type: headers
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string()),
            changed_remote: false,
            probed_size_bytes: 1,
            probe_elapsed_ms: elapsed.as_millis() as u64,
            http_status: status.as_u16(),
        })
    }

    /// Second, cheap confirmation of range support using a mid-file offset.
    async fn verify_range_support(&self, url: &Url, headers: &HeaderMap, total: Option<u64>) -> bool {
        let offset = match total {
            Some(total) if total > 2 => (total / 2).min(16 * 1024 * 1024),
            _ => 1,
        };
        let validator = headers.get(ETAG).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
        let response = match self.get(url, Some((offset, offset)), validator.as_deref(), None).await {
            Ok(response) => response,
            Err(e) => {
                self.logger.warn(
                    Category::Connection,
                    None,
                    format!("range verification request failed: {}", e.log_line()),
                );
                return false;
            }
        };
        if response.status() != StatusCode::PARTIAL_CONTENT {
            self.logger.info(
                Category::Connection,
                None,
                format!(
                    "server claims Accept-Ranges but answered {} to a ranged request; using a single connection",
                    response.status().as_u16()
                ),
            );
            return false;
        }
        headers_match_offset(&response.headers().clone(), offset)
    }

    /// HEAD-free existence check used by "retry failed download" to give a
    /// precise error (404 vs 403 vs offline) before touching the disk.
    pub async fn check_available(&self, url: &Url) -> Result<u16> {
        let response = self.get(url, Some((0, 0)), None, None).await?;
        let status = response.status().as_u16();
        drop(response);
        Ok(status)
    }
}

fn headers_match_offset(headers: &HeaderMap, offset: u64) -> bool {
    headers
        .get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_content_range)
        .map(|cr| cr.start == offset)
        .unwrap_or(false)
}

/// Builds the `If-Range` validator from stored metadata.
pub fn if_range_validator(etag: Option<&str>, last_modified: Option<&str>) -> Option<String> {
    if let Some(etag) = etag.filter(|e| !e.trim().is_empty()) {
        return Some(etag.to_string());
    }
    last_modified
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.to_string())
}

/// Reads `Accept-Ranges` from a response (used by the worker for the
/// fall-back decision when a ranged request is answered with `200`).
pub fn response_accepts_ranges(headers: &HeaderMap) -> bool {
    headers
        .get(ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("bytes"))
        .unwrap_or(false)
}

/// Guarantees a header value is valid UTF-8 ASCII-safe text before storing it.
pub fn header_to_string(value: Option<&HeaderValue>) -> Option<String> {
    value.and_then(|v| v.to_str().ok()).map(|s| s.to_string())
}

/// Truncates a server-supplied reason phrase so it cannot flood the UI.
pub fn trim_reason(status: StatusCode, reason: Option<&str>) -> String {
    reason
        .unwrap_or_else(|| status.canonical_reason().unwrap_or(""))
        .chars()
        .take(120)
        .collect()
}

/// Maps a transport error onto our taxonomy, keeping the useful detail.
pub fn classify_request_error(err: reqwest::Error) -> AppError {
    AppError::from(err)
}

/// Error used when a server answers a ranged request with a full body and the
/// download cannot be continued as a single stream.
pub fn range_unsupported(detail: impl Into<String>) -> AppError {
    AppError::RangeUnsupported(detail.into())
}

/// Marker used by the retry manager to recognise a "server said no" situation.
pub fn is_permanent_range_failure(err: &AppError) -> bool {
    err.code() == code::RANGE_UNSUPPORTED
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_urls() {
        assert!(validate_url("https://example.com/file.zip").is_ok());
        assert!(validate_url("http://example.com:8080/a/b?c=d").is_ok());
        assert!(validate_url("  https://example.com/x  ").is_ok());

        assert!(validate_url("").is_err());
        assert!(validate_url("example.com/file.zip").is_err());
        assert!(validate_url("ftp://example.com/f").is_err());
        assert!(validate_url("file:///C:/f.zip").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
        assert!(matches!(
            validate_url("ftp://example.com/f"),
            Err(AppError::UnsupportedScheme(_))
        ));
        let long = format!("https://example.com/{}", "a".repeat(MAX_URL_LEN));
        assert!(validate_url(&long).is_err());
    }

    #[test]
    fn strips_fragment_and_keeps_query() {
        let url = validate_url("https://example.com/f.zip?a=1#frag").unwrap();
        assert_eq!(url.as_str(), "https://example.com/f.zip?a=1");
    }

    #[test]
    fn splits_credentials_out_of_the_url() {
        let url = validate_url("https://user:pa%24%24@example.com/f.zip").unwrap();
        let (clean, auth) = prepare_url(&url);
        assert_eq!(clean.as_str(), "https://example.com/f.zip");
        let auth = auth.unwrap();
        assert!(auth.starts_with("Basic "));
        // base64("user:pa$$")
        assert_eq!(auth, "Basic dXNlcjpwYSQk");
    }

    #[test]
    fn parses_content_range() {
        let cr = parse_content_range("bytes 0-1023/4096").unwrap();
        assert_eq!((cr.start, cr.end, cr.total), (0, 1023, Some(4096)));
        assert_eq!(cr.len(), 1024);

        let open = parse_content_range("bytes 500-999/*").unwrap();
        assert_eq!((open.start, open.end, open.total), (500, 999, None));

        assert!(parse_content_range("bytes */4096").is_none());
        assert!(parse_content_range("bytes 999-1/4096").is_none());
        assert!(parse_content_range("items 0-1/2").is_none());
    }

    #[test]
    fn parses_content_disposition() {
        assert_eq!(
            filename_from_content_disposition("attachment; filename=\"report 2024.pdf\""),
            Some("report 2024.pdf".to_string())
        );
        assert_eq!(
            filename_from_content_disposition("attachment; filename=plain.zip"),
            Some("plain.zip".to_string())
        );
        assert_eq!(
            filename_from_content_disposition("attachment; filename*=UTF-8''caf%C3%A9%20men%C3%BC.txt"),
            Some("café menü.txt".to_string())
        );
        // Escaped quote inside a quoted string must not truncate the name.
        assert_eq!(
            filename_from_content_disposition("attachment; filename=\"we\\\\\"ird.zip\""),
            Some("we\\\"ird.zip".to_string())
        );
        assert_eq!(filename_from_content_disposition("inline"), None);
    }

    #[test]
    fn parses_filename_from_url() {
        let url = validate_url("https://example.com/a/b/My%20File.zip?dl=1").unwrap();
        assert_eq!(filename_from_url(&url), Some("My File.zip".to_string()));
        let root = validate_url("https://example.com/").unwrap();
        assert_eq!(filename_from_url(&root), None);
    }

    #[test]
    fn range_header_format() {
        assert_eq!(range_header(0, 0), "bytes=0-0");
        assert_eq!(range_header(1024, 2047), "bytes=1024-2047");
    }

    #[test]
    fn if_range_prefers_etag() {
        assert_eq!(if_range_validator(Some("\"v1\""), Some("Wed, 21 Oct 2015 07:28:00 GMT")), Some("\"v1\"".into()));
        assert_eq!(if_range_validator(None, Some("Wed, 21 Oct 2015 07:28:00 GMT")), Some("Wed, 21 Oct 2015 07:28:00 GMT".into()));
        assert_eq!(if_range_validator(None, None), None);
    }
}
