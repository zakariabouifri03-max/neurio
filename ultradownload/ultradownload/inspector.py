"""Step A — inspect a URL before downloading.

The inspector never downloads the file body: it uses an HTTP ``HEAD``
when the server allows it, otherwise a streaming ``GET`` with
``Range: bytes=0-0`` (or an immediately-closed plain ``GET``) and reads
at most one byte.  It discovers:

* final URL after legitimate redirects,
* filename (Content-Disposition → URL path → fallback),
* total size, content type, ETag / Last-Modified,
* whether the server honours byte-range requests,

and translates network failures into friendly, machine-readable error
kinds (``dns``, ``timeout``, ``http404``, …).  Sensitive headers are
never included in error messages or logs.
"""

from __future__ import annotations

import logging
import posixpath
import re
import urllib.parse
from typing import Dict, Optional

import requests

from .models import ProbeResult, RangeSupport
from .utils import redact_url, sanitize_filename

log = logging.getLogger(__name__)

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UltraDownload/1.0 "
    "(+https://github.com/zakariabouifri03-max/neurio)"
)

#: Probe reads at most this many body bytes (defensive; normally 0-1).
MAX_PROBE_BODY_BYTES = 64


class UrlValidationError(ValueError):
    """Raised for URLs the application must refuse (with a clear reason)."""


def validate_url(url: str) -> str:
    """Validate and normalise a user-supplied URL.

    Only ``http`` and ``https`` are accepted.  Raises
    :class:`UrlValidationError` with a message suitable for the GUI.
    """
    if not url or not url.strip():
        raise UrlValidationError("Please enter a download URL.")
    url = url.strip()
    if re.search(r"\s", url):
        raise UrlValidationError("The URL contains spaces. Please check for typos.")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", url):
        # Be forgiving: prepend https:// when the scheme is missing.
        if re.match(r"^(www\.)?[\w\-.]+\.[a-zA-Z]{2,}(:\d+)?(/|$)", url):
            url = "https://" + url
        else:
            raise UrlValidationError(
                "That does not look like a URL. "
                "It should start with http:// or https://"
            )
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme.lower() not in ("http", "https"):
        raise UrlValidationError(
            f"Unsupported protocol '{parsed.scheme}'. Only http:// and https:// "
            "direct download links are supported."
        )
    host = parsed.hostname
    if not host:
        raise UrlValidationError("The URL has no host name.")
    if not re.match(r"^[a-zA-Z0-9\-.]+$", host) and not host.startswith("["):
        raise UrlValidationError(f"Invalid host name '{host}'.")
    return urllib.parse.urlunsplit(parsed)


def _filename_from_headers(resp: requests.Response) -> str:
    """Extract a filename from Content-Disposition (RFC 6266, best effort)."""
    cd = resp.headers.get("Content-Disposition", "")
    if not cd:
        return ""
    # filename*=UTF-8''encoded  (RFC 5987) takes precedence
    m = re.search(r"filename\*\s*=\s*([\w\-]+)'[^']*'([^;]+)", cd, re.IGNORECASE)
    if m:
        try:
            return urllib.parse.unquote(m.group(2).strip().strip('"'),
                                        encoding=m.group(1) or "utf-8",
                                        errors="replace")
        except (LookupError, ValueError):
            pass
    m = re.search(r'filename\s*=\s*"?([^";]+)"?', cd, re.IGNORECASE)
    if m:
        try:
            return urllib.parse.unquote(m.group(1).strip(), errors="replace")
        except Exception:
            return m.group(1).strip()
    return ""


def _filename_from_url(url: str) -> str:
    path = urllib.parse.urlsplit(url).path
    name = posixpath.basename(path)
    try:
        name = urllib.parse.unquote(name, errors="replace")
    except Exception:  # pragma: no cover - defensive
        pass
    return name


def guess_filename(resp: Optional[requests.Response], url: str) -> str:
    """Best sanitized filename guess from a response and/or URL."""
    name = ""
    if resp is not None:
        name = _filename_from_headers(resp)
    if not name:
        name = _filename_from_url(url)
    return sanitize_filename(name) if name else "download"


def _safe_int(value: Optional[str], default: int = -1) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _classify_request_exception(exc: requests.RequestException,
                                url: str) -> ProbeResult:
    text = str(exc).lower()
    kind, msg = "network", "Network error while contacting the server."
    if isinstance(exc, requests.exceptions.ConnectTimeout) or (
            isinstance(exc, requests.exceptions.Timeout)):
        kind, msg = "timeout", (
            "The server did not respond in time. Try again, or increase the "
            "connection timeout in Settings."
        )
    elif isinstance(exc, requests.exceptions.ReadTimeout):
        kind, msg = "timeout", "The server stopped responding while reading."
    elif isinstance(exc, requests.exceptions.TooManyRedirects):
        kind, msg = "redirects", "Too many redirects — the link may be broken."
    elif isinstance(exc, requests.exceptions.SSLError):
        kind, msg = "ssl", "TLS/SSL error — the server certificate could not be verified."
    elif isinstance(exc, requests.exceptions.ConnectionError):
        if "nameresolution" in text or "name or service not known" in text \
                or "getaddrinfo" in text or "failed to resolve" in text \
                or "nodename nor servname" in text:
            kind, msg = "dns", (
                "Could not resolve the host name. Check the URL and your "
                "internet connection."
            )
        elif "connection refused" in text or "actively refused" in text:
            kind, msg = "refused", "The server refused the connection."
        elif "connection aborted" in text or "connection reset" in text \
                or "remotedisconnected" in text:
            kind, msg = "reset", "The server closed the connection unexpectedly."
        else:
            kind, msg = "connection", f"Could not connect to the server. ({exc.__class__.__name__})"
    elif isinstance(exc, requests.exceptions.InvalidURL):
        kind, msg = "invalid_url", "The URL is malformed."
    return ProbeResult(ok=False, url=url, error=msg, error_kind=kind)


def _http_error_probe(status: int, url: str) -> ProbeResult:
    messages = {
        401: ("auth", "The server requires authentication (HTTP 401). "
                      "Add the required Authorization header or cookies."),
        403: ("forbidden", "Access denied (HTTP 403). The link may be expired, "
                           "region-locked, or require authentication."),
        404: ("http404", "File not found (HTTP 404). Check the URL for typos."),
        410: ("gone", "This link is no longer available (HTTP 410 Gone)."),
        429: ("ratelimit", "The server is rate-limiting requests (HTTP 429). "
                           "Please wait and try again."),
        451: ("blocked", "Unavailable for legal reasons (HTTP 451)."),
    }
    if status in messages:
        kind, msg = messages[status]
        return ProbeResult(ok=False, url=url, status_code=status,
                           error=msg, error_kind=kind)
    if 500 <= status <= 599:
        return ProbeResult(ok=False, url=url, status_code=status,
                           error=f"Server error (HTTP {status}). Try again later.",
                           error_kind="server")
    return ProbeResult(ok=False, url=url, status_code=status,
                       error=f"Unexpected server response (HTTP {status}).",
                       error_kind="http")


def probe_url(url: str,
              headers: Optional[Dict[str, str]] = None,
              connect_timeout: float = 15.0,
              read_timeout: float = 30.0,
              session: Optional[requests.Session] = None,
              user_agent: str = DEFAULT_USER_AGENT) -> ProbeResult:
    """Inspect ``url`` cheaply and report size / name / range support.

    Never downloads more than :data:`MAX_PROBE_BODY_BYTES` bytes.
    """
    try:
        url = validate_url(url)
    except UrlValidationError as exc:
        return ProbeResult(ok=False, url=url or "", error=str(exc),
                           error_kind="invalid_url")

    sess = session or requests.Session()
    own_session = session is None
    base_headers = {"User-Agent": user_agent, "Accept": "*/*"}
    base_headers.update(headers or {})
    timeout = (connect_timeout, read_timeout)
    log.info("Probing %s", redact_url(url))

    try:
        # --- Attempt 1: HEAD ------------------------------------------------
        size = -1
        content_type = ""
        etag = ""
        last_modified = ""
        accept_ranges = ""
        final_url = url
        status = 0
        redirects = 0
        head_ok = False
        try:
            head = sess.head(url, headers=base_headers, timeout=timeout,
                             allow_redirects=True)
            status = head.status_code
            final_url = head.url or url
            redirects = len(head.history)
            if status == 200:
                head_ok = True
                size = _safe_int(head.headers.get("Content-Length"), -1)
                content_type = head.headers.get("Content-Type", "")
                etag = head.headers.get("ETag", "")
                last_modified = head.headers.get("Last-Modified", "")
                accept_ranges = head.headers.get("Accept-Ranges", "").lower()
            elif status in (405, 501, 400, 403, 429) or 500 <= status <= 599:
                head_ok = False   # many servers reject HEAD; try GET probe
            else:
                res = _http_error_probe(status, url)
                res.final_url = final_url
                res.redirect_count = redirects
                return res
        except requests.RequestException:
            head_ok = False       # fall through to GET probe

        if head_ok and size >= 0 and accept_ranges in ("bytes", "none"):
            # HEAD gave us everything we need.
            support = RangeSupport.YES if accept_ranges == "bytes" else RangeSupport.NO
            if size == 0:
                # Zero-byte file: no GET probe can tell us more.
                return ProbeResult(ok=True, url=url, final_url=final_url,
                                   status_code=status, filename=guess_filename(None, final_url),
                                   total_size=0, content_type=content_type,
                                   range_support=support, etag=etag,
                                   last_modified=last_modified,
                                   redirect_count=redirects)
            if support == RangeSupport.YES:
                # Confirm with a 1-byte ranged GET (cheap and decisive).
                confirm = _ranged_get_probe(sess, final_url, base_headers,
                                            timeout,
                                            extra_redirects=redirects)
                if confirm is not None:
                    return confirm
            return ProbeResult(
                ok=True, url=url, final_url=final_url, status_code=status,
                filename=guess_filename(None, final_url), total_size=size,
                content_type=content_type, range_support=support, etag=etag,
                last_modified=last_modified, redirect_count=redirects)

        # --- Attempt 2: streaming GET with Range: bytes=0-0 ------------------
        probe = _ranged_get_probe(sess, url, base_headers, timeout)
        if probe is not None:
            return probe

        # --- Attempt 3: plain streaming GET (headers only, body discarded) ---
        get = sess.get(url, headers=base_headers, timeout=timeout,
                       stream=True, allow_redirects=True)
        try:
            status = get.status_code
            final_url = get.url or url
            redirects = len(get.history)
            if status != 200:
                res = _http_error_probe(status, url)
                res.final_url = final_url
                res.redirect_count = redirects
                return res
            size = _safe_int(get.headers.get("Content-Length"), -1)
            content_type = get.headers.get("Content-Type", "")
            etag = get.headers.get("ETag", "")
            last_modified = get.headers.get("Last-Modified", "")
            return ProbeResult(
                ok=True, url=url, final_url=final_url, status_code=status,
                filename=guess_filename(get, final_url), total_size=size,
                content_type=content_type, range_support=RangeSupport.NO,
                etag=etag, last_modified=last_modified,
                redirect_count=redirects)
        finally:
            get.close()
    except requests.RequestException as exc:
        log.warning("Probe failed for %s: %s", redact_url(url), exc.__class__.__name__)
        return _classify_request_exception(exc, url)
    finally:
        if own_session:
            try:
                sess.close()
            except Exception:  # pragma: no cover
                pass


def _ranged_get_probe(sess: requests.Session, url: str,
                      headers: Dict[str, str],
                      timeout,
                      extra_redirects: int = 0) -> Optional[ProbeResult]:
    """One-byte ranged GET probe.

    Returns a :class:`ProbeResult` when the probe produced a definitive
    answer (206 / 416 / clear error), or ``None`` when the caller should
    fall back to a plain GET probe (server rejected the Range request).
    """
    probe_headers = dict(headers)
    probe_headers["Range"] = "bytes=0-0"
    try:
        resp = sess.get(url, headers=probe_headers, timeout=timeout,
                        stream=True, allow_redirects=True)
    except requests.RequestException as exc:
        result = _classify_request_exception(exc, url)
        return result
    try:
        status = resp.status_code
        final_url = resp.url or url
        redirects = len(resp.history) + extra_redirects
        if status == 206:
            cr = resp.headers.get("Content-Range", "")
            m = re.match(r"bytes\s+(\d+)-(\d+)/(\d+|\*)", cr or "", re.IGNORECASE)
            if not m:
                return ProbeResult(
                    ok=False, url=url, status_code=status,
                    error="Server sent a 206 response with an invalid or "
                          "missing Content-Range header.",
                    error_kind="bad_range", final_url=final_url,
                    redirect_count=redirects)
            total = m.group(3)
            size = -1 if total == "*" else int(total)
            if size == 0:
                size = -1
            return ProbeResult(
                ok=True, url=url, final_url=final_url, status_code=status,
                filename=guess_filename(resp, final_url), total_size=size,
                content_type=resp.headers.get("Content-Type", ""),
                range_support=RangeSupport.YES,
                etag=resp.headers.get("ETag", ""),
                last_modified=resp.headers.get("Last-Modified", ""),
                redirect_count=redirects)
        if status == 200:
            length = _safe_int(resp.headers.get("Content-Length"), -1)
            if length == 0:
                # Empty file served as 200 for any range.
                return ProbeResult(
                    ok=True, url=url, final_url=final_url, status_code=status,
                    filename=guess_filename(resp, final_url), total_size=0,
                    content_type=resp.headers.get("Content-Type", ""),
                    range_support=RangeSupport.NO,
                    etag=resp.headers.get("ETag", ""),
                    last_modified=resp.headers.get("Last-Modified", ""),
                    redirect_count=redirects)
            if length == 1:
                # Cannot distinguish "honoured 0-0" from "ignored range"
                # for a 1-byte file; treat as range-capable but let the
                # engine verify Content-Range strictly.
                return ProbeResult(
                    ok=True, url=url, final_url=final_url, status_code=status,
                    filename=guess_filename(resp, final_url), total_size=1,
                    content_type=resp.headers.get("Content-Type", ""),
                    range_support=RangeSupport.UNKNOWN,
                    etag=resp.headers.get("ETag", ""),
                    last_modified=resp.headers.get("Last-Modified", ""),
                    redirect_count=redirects)
            # Server ignored the Range header and offered the full body.
            return ProbeResult(
                ok=True, url=url, final_url=final_url, status_code=status,
                filename=guess_filename(resp, final_url), total_size=length,
                content_type=resp.headers.get("Content-Type", ""),
                range_support=RangeSupport.NO,
                etag=resp.headers.get("ETag", ""),
                last_modified=resp.headers.get("Last-Modified", ""),
                redirect_count=redirects)
        if status == 416:
            # bytes=0-0 unsatisfiable ⇒ the file is empty.
            return ProbeResult(
                ok=True, url=url, final_url=final_url, status_code=status,
                filename=guess_filename(None, final_url), total_size=0,
                content_type=resp.headers.get("Content-Type", ""),
                range_support=RangeSupport.YES,
                redirect_count=redirects)
        if status in (400, 405, 412, 501):
            resp.close()
            return None  # range probe not meaningful; caller falls back
        result = _http_error_probe(status, url)
        result.final_url = final_url
        result.redirect_count = redirects
        return result
    finally:
        try:
            resp.close()
        except Exception:  # pragma: no cover
            pass
