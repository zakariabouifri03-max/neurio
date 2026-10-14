from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from email.message import Message
from urllib.parse import urlsplit, unquote, urljoin
import re
import threading
import time
import httpx
from .models import Remote
from .file_utils import safe_filename


class Interrupted(Exception):
    pass


class ProtocolError(Exception):
    pass


class ResourceChanged(ProtocolError):
    pass


class TransferError(Exception):
    def __init__(self, message, retryable=False, delay=0):
        super().__init__(message)
        self.retryable, self.delay = retryable, delay


def validate_url(url):
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
            raise ValueError()
        _ = parts.port
        if any(ord(c) < 33 for c in url):
            raise ValueError()
    except ValueError:
        raise ValueError("Enter a direct HTTP(S) URL without embedded username/password") from None
    return url


def retry_after(value):
    try:
        return max(0, float(value))
    except (ValueError, TypeError):
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return 0


def check_status(response):
    code = response.status_code
    if code in (412, 416):
        raise ResourceChanged("Remote file changed or the requested range is no longer valid")
    if code >= 400:
        raise TransferError(f"Server returned HTTP {code}", code in (408, 429, 500, 502, 503, 504),
                            retry_after(response.headers.get("retry-after")))


class RateLimiter:
    """Shared paced reservations; bounded buffers, interruptible waits."""
    def __init__(self, rate=0):
        self.rate, self.next = rate, 0.0
        self.lock = threading.Lock()

    def consume(self, size, stop):
        if not self.rate:
            return
        # No long-lived reservations survive a pause; at most one buffer is burstable.
        while True:
            if stop.is_set():
                raise Interrupted()
            with self.lock:
                now = time.monotonic()
                delay = self.next - now
                if delay <= 0:
                    self.next = now + size / self.rate
                    return
            if stop.wait(min(delay, .1)):
                raise Interrupted()


class HTTPClient:
    def __init__(self, settings):
        self.client = httpx.Client(
            follow_redirects=True, max_redirects=10, trust_env=False,
            timeout=httpx.Timeout(settings.read_timeout, connect=settings.connect_timeout),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=10),
            headers={"Accept-Encoding": "identity", "User-Agent": "UltraDownload/1.0"},
            event_hooks={"response": [self.redirect_guard]})

    @staticmethod
    def redirect_guard(response):
        location = response.headers.get("location")
        if response.is_redirect and location:
            target = urljoin(str(response.url), location)
            validate_url(target)
            if response.url.scheme == "https" and urlsplit(target).scheme != "https":
                raise ProtocolError("Refusing HTTPS to HTTP redirect")

    def close(self):
        self.client.close()

    def inspect(self, url):
        validate_url(url)
        # HEAD is optional. A one-byte streaming probe is authoritative for ranges.
        headers = {}
        with self.client.stream("HEAD", url) as head:
            if head.status_code < 400:
                headers = dict(head.headers)
        with self.client.stream("GET", url, headers={"Range": "bytes=0-0"}) as r:
            final = str(r.url)
            validate_url(final)
            if urlsplit(url).scheme == "https" and urlsplit(final).scheme != "https":
                raise ProtocolError("Refusing HTTPS to HTTP redirect")
            if r.status_code == 416 and r.headers.get("content-range") == "bytes */0":
                size, ranges = 0, True
            else:
                check_status(r)
                if r.headers.get("content-encoding", "identity").lower() != "identity":
                    raise ProtocolError("Server ignored identity encoding; byte offsets are unsafe")
                if r.status_code == 206:
                    match = re.fullmatch(r"bytes 0-0/(\d+)", r.headers.get("content-range", ""))
                    if not match or int(match[1]) < 1:
                        raise ProtocolError("Invalid Content-Range during inspection")
                    size, ranges = int(match[1]), True
                    body = b""
                    for block in r.iter_raw(2):
                        body += block
                        if len(body) > 1:
                            raise ProtocolError("Invalid one-byte range probe body")
                    if len(body) != 1:
                        raise ProtocolError("Truncated range probe")
                elif r.status_code == 200:
                    length = r.headers.get("content-length")
                    size, ranges = (int(length) if length is not None else None), False
                else:
                    raise ProtocolError("Unsupported inspection response")
            headers.update(r.headers)
            if size is not None and size < 0:
                raise ProtocolError("Invalid file size")
            msg = Message()
            msg["Content-Disposition"] = headers.get("content-disposition", "")
            filename = msg.get_filename() or unquote(urlsplit(final).path.rsplit("/", 1)[-1]) or "download.bin"
            return Remote(final, safe_filename(filename), size, ranges,
                          headers.get("etag", ""), headers.get("last-modified", ""),
                          "" if ranges else "Server ignores byte ranges. Single-stream mode restarts incomplete transfers.")

    def stream(self, url, remote, start=None, end=None):
        headers = {}
        if start is not None:
            headers["Range"] = f"bytes={start}-{end}"
        if remote.etag and not remote.etag.startswith("W/"):
            headers["If-Match"] = remote.etag
            if start is not None:
                headers["If-Range"] = remote.etag
        elif remote.modified:
            headers["If-Unmodified-Since"] = remote.modified
            if start is not None:
                headers["If-Range"] = remote.modified
        return self.client.stream("GET", url, headers=headers)

    @staticmethod
    def validate_response(r, remote, start=None, end=None):
        check_status(r)
        if r.headers.get("content-encoding", "identity").lower() != "identity":
            raise ProtocolError("Encoded body cannot be mapped safely to file bytes")
        if remote.etag and r.headers.get("etag", remote.etag) != remote.etag:
            raise ResourceChanged("Remote ETag changed during download")
        if remote.modified and r.headers.get("last-modified", remote.modified) != remote.modified:
            raise ResourceChanged("Remote Last-Modified changed during download")
        if start is not None:
            if r.status_code != 206:
                raise ProtocolError("Server ignored a Range request; no response bytes were saved")
            if r.headers.get("content-range") != f"bytes {start}-{end}/{remote.size}":
                raise ProtocolError("Content-Range does not match requested bytes")
            length = r.headers.get("content-length")
            if length is not None and int(length) != end - start + 1:
                raise ProtocolError("Incorrect range Content-Length")
        elif r.status_code != 200:
            raise ProtocolError("Expected a full single-stream HTTP 200 response")
