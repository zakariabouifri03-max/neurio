"""URL inspection: filename, size, MIME type and Range capability detection.

Never downloads the whole file: a HEAD request is preferred; when servers
refuse HEAD (or return useless headers) a *probe* GET with ``Range: bytes=0-0``
is used and closed after reading at most a few kilobytes.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import requests

from ..utils import filename_from_headers, filename_from_url, sanitize_filename
from .errors import InvalidURLError, PermanentHTTPError, TransientHTTPError, InspectError

log = logging.getLogger("ultradownload.inspector")

__all__ = ["URLInfo", "inspect_url", "validate_url"]

PROBE_READ_LIMIT = 8192  # max bytes read during a fallback probe GET


@dataclass
class URLInfo:
    url: str                      # final URL after redirects
    filename: str
    size: int | None              # None when the server does not say
    mime_type: str | None
    supports_ranges: bool
    accept_ranges: str | None = None
    etag: str | None = None
    last_modified: str | None = None
    server: str | None = None
    notes: list[str] = field(default_factory=list)


def validate_url(url: str) -> str:
    """Return a normalized URL or raise :class:`InvalidURLError`."""
    if not url or not url.strip():
        raise InvalidURLError("Please enter a URL.")
    url = url.strip()
    parsed = requests.utils.urlparse(url)
    if parsed.scheme.lower() not in ("http", "https"):
        raise InvalidURLError("Only http:// and https:// URLs are supported.")
    if not parsed.netloc:
        raise InvalidURLError("The URL is missing a host name.")
    return url


def _int_or_none(value: str | None) -> int | None:
    try:
        n = int(value)  # type: ignore[arg-type]
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def _error_from_status(url: str, status: int, reason: str) -> Exception:
    msg = f"Server returned HTTP {status} ({reason}) for {url}"
    if status in (401, 403):
        return PermanentHTTPError(
            f"Access denied (HTTP {status}). The file may need authentication "
            "or the link may have expired.", status)
    if status in (404, 410):
        return PermanentHTTPError(f"The file was not found (HTTP {status}).", status)
    if status == 429:
        return TransientHTTPError("The server is rate limiting requests (HTTP 429).", status)
    if status >= 500:
        return TransientHTTPError(f"The server failed (HTTP {status}).", status)
    return PermanentHTTPError(msg, status)


def inspect_url(
    url: str,
    session: requests.Session | None = None,
    timeout: tuple[float, float] = (10.0, 30.0),
    extra_headers: dict | None = None,
) -> URLInfo:
    """Inspect *url* without downloading it."""
    url = validate_url(url)
    own_session = session is None
    session = session or requests.Session()
    headers = dict(extra_headers or {})
    try:
        return _inspect(url, session, timeout, headers)
    finally:
        if own_session:
            session.close()


def _inspect(url: str, session: requests.Session, timeout, headers: dict) -> URLInfo:
    resp = None
    used_probe = False
    notes: list[str] = []

    try:
        resp = session.head(url, allow_redirects=True, timeout=timeout, headers=headers)
        if resp.status_code >= 400:
            resp = None  # fall back to a probe GET below
    except requests.RequestException as exc:
        log.debug("HEAD failed (%s), falling back to probe GET", exc)
        resp = None

    if resp is not None:
        size = _int_or_none(resp.headers.get("Content-Length"))
        accept = resp.headers.get("Accept-Ranges")
        # Some servers answer HEAD with Accept-Ranges but no useful size; if the
        # response looks empty/unhelpful, confirm with a 1-byte probe.
        if size is None and accept is None:
            resp = None

    if resp is None:
        used_probe = True
        probe_headers = dict(headers)
        probe_headers["Range"] = "bytes=0-0"
        try:
            resp = session.get(url, allow_redirects=True, timeout=timeout,
                               headers=probe_headers, stream=True)
        except requests.RequestException as exc:
            raise InspectError(f"Could not contact the server: {exc}") from exc
        try:
            if resp.status_code >= 400:
                raise _error_from_status(str(resp.url), resp.status_code, resp.reason)
            # Read a tiny bounded amount then abort — never the whole file.
            for _chunk in resp.iter_content(PROBE_READ_LIMIT):
                break
        finally:
            resp.close()

    # Snapshot everything we need before the connection is released.
    status = resp.status_code
    final_url = str(resp.url)
    hdrs = dict(resp.headers)
    try:
        resp.close()
    except requests.RequestException:
        pass
    if status >= 400:
        raise _error_from_status(final_url, status, resp.reason)

    size = _int_or_none(hdrs.get("Content-Length"))
    supports_ranges = False
    accept = hdrs.get("Accept-Ranges")

    if status == 206:
        # A 206 to our probe proves ranges work; Content-Range carries the size.
        supports_ranges = True
        cr = hdrs.get("Content-Range", "")
        if "/" in cr and cr.rsplit("/", 1)[1].strip() not in ("*", ""):
            size = _int_or_none(cr.rsplit("/", 1)[1].strip())
    else:
        if accept and accept.lower().strip() == "bytes":
            supports_ranges = True
        elif used_probe:
            notes.append("Server ignored the Range probe; parallel parts are disabled.")
        if used_probe and size is None and hdrs.get("Transfer-Encoding", "").lower() == "chunked":
            notes.append("Server did not report a file size (chunked transfer).")

    disposition = hdrs.get("Content-Disposition")
    filename = filename_from_headers(disposition) or filename_from_url(final_url) or "download.bin"
    filename = sanitize_filename(filename)

    info = URLInfo(
        url=final_url,
        filename=filename,
        size=size,
        mime_type=hdrs.get("Content-Type"),
        supports_ranges=supports_ranges,
        accept_ranges=accept,
        etag=hdrs.get("ETag"),
        last_modified=hdrs.get("Last-Modified"),
        server=hdrs.get("Server"),
        notes=notes,
    )
    log.debug("inspected %s -> size=%s ranges=%s name=%s",
              final_url, info.size, info.supports_ranges, info.filename)
    return info
