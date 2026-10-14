import re
from datetime import datetime, timezone
from email.message import Message
from email.utils import parsedate_to_datetime
from urllib.parse import unquote, urlsplit

import httpx

from .file_utils import safe_filename, validate_url
from .models import InvalidResponse, RemoteChanged, RemoteInfo, TransientError

CONTENT_RANGE = re.compile(r"bytes (\d+)-(\d+)/(\d+)")


def client(settings):
    return httpx.Client(
        follow_redirects=True,
        max_redirects=10,
        trust_env=False,
        timeout=httpx.Timeout(settings.read_timeout, connect=settings.connect_timeout),
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=10),
        headers={"Accept-Encoding": "identity", "User-Agent": "UltraDownload/1.0"},
    )


def retry_after(value: str) -> float:
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            return max(
                0.0,
                (
                    parsedate_to_datetime(value) - datetime.now(timezone.utc)
                ).total_seconds(),
            )
        except (ValueError, TypeError, OverflowError):
            return 0.0


def check_status(response):
    status = response.status_code
    if status == 429 or status in (500, 502, 503, 504):
        delay = retry_after(response.headers.get("Retry-After", ""))
        raise TransientError(
            f"Server returned HTTP {status}", delay or (1.0 if status == 429 else 0.0)
        )
    if status >= 400:
        # Do not put response URLs (possibly signed) into errors or logs.
        raise InvalidResponse(
            f"Server returned HTTP {status}; check access or replace an expired link"
        )


def identity(response):
    if response.headers.get("Content-Encoding", "identity").lower() != "identity":
        raise InvalidResponse(
            "Server returned an encoded representation instead of original bytes"
        )


def validate_range(response, start: int, end: int, size: int):
    check_status(response)
    identity(response)
    if response.status_code != 206:
        raise InvalidResponse(
            "Server ignored Range; a full response is not a valid chunk"
        )
    match = CONTENT_RANGE.fullmatch(response.headers.get("Content-Range", ""))
    if not match or tuple(map(int, match.groups())) != (start, end, size):
        raise InvalidResponse("Content-Range does not match the requested bytes")
    length = response.headers.get("Content-Length")
    if length is not None and (not length.isdigit() or int(length) != end - start + 1):
        raise InvalidResponse("Incorrect range Content-Length")


def check_validator(info: RemoteInfo, response):
    if (
        info.etag
        and response.headers.get("ETag")
        and info.etag != response.headers["ETag"]
    ):
        raise RemoteChanged("Remote ETag changed; restart as a new download")
    if (
        (not info.etag or info.etag.startswith("W/"))
        and info.modified
        and response.headers.get("Last-Modified")
        and info.modified != response.headers["Last-Modified"]
    ):
        raise RemoteChanged(
            "Remote modification date changed; restart as a new download"
        )


def compare_remote(saved: RemoteInfo, current: RemoteInfo):
    if saved.size != current.size or saved.ranges != current.ranges:
        raise RemoteChanged(
            "Remote size or range behavior changed; restart as a new download"
        )
    if saved.etag and saved.etag != current.etag:
        raise RemoteChanged(
            "Remote ETag changed or disappeared; restart as a new download"
        )
    if (
        (not saved.etag or saved.etag.startswith("W/"))
        and saved.modified
        and saved.modified != current.modified
    ):
        raise RemoteChanged(
            "Remote modification date changed; restart as a new download"
        )


def inspect_url(url, settings) -> RemoteInfo:
    url = validate_url(url)
    with client(settings) as c:
        headers = {}
        with c.stream("HEAD", url) as r:
            if r.status_code not in (405, 501):
                check_status(r)
                if r.status_code == 200:
                    headers = dict(r.headers)
        # Always verify actual behavior. Never buffer a full ignored-Range response.
        with c.stream("GET", url, headers={"Range": "bytes=0-0"}) as r:
            resolved = str(r.url)
            if r.status_code == 416 and r.headers.get("Content-Range") == "bytes */0":
                return RemoteInfo(
                    url,
                    resolved,
                    _filename(r.headers, headers, resolved),
                    0,
                    True,
                    r.headers.get("ETag", headers.get("etag", "")),
                    r.headers.get("Last-Modified", headers.get("last-modified", "")),
                )
            check_status(r)
            identity(r)
            ranges = r.status_code == 206
            if ranges:
                match = CONTENT_RANGE.fullmatch(r.headers.get("Content-Range", ""))
                if (
                    not match
                    or tuple(map(int, match.groups()[:2])) != (0, 0)
                    or int(match[3]) < 1
                ):
                    raise InvalidResponse("Invalid range probe response")
                size = int(match[3])
                validate_range(r, 0, 0, size)
                count = 0
                for data in r.iter_raw(1024):
                    count += len(data)
                    if count > 1:
                        raise InvalidResponse("Range probe returned too many bytes")
                if count != 1:
                    raise InvalidResponse("Range probe was truncated")
            elif r.status_code == 200:
                length = r.headers.get("Content-Length")
                size = int(length) if length and length.isdigit() else None
            else:
                raise InvalidResponse(f"Unexpected inspection HTTP {r.status_code}")
            return RemoteInfo(
                url,
                resolved,
                _filename(r.headers, headers, resolved),
                size,
                ranges,
                r.headers.get("ETag", headers.get("etag", "")),
                r.headers.get("Last-Modified", headers.get("last-modified", "")),
                ""
                if ranges
                else "Server ignored byte ranges. Single-stream transfers restart after pause.",
            )


def _filename(headers, fallback, url):
    message = Message()
    message["Content-Disposition"] = headers.get(
        "Content-Disposition", fallback.get("content-disposition", "")
    )
    return safe_filename(
        message.get_filename()
        or unquote(urlsplit(url).path.rsplit("/", 1)[-1])
        or "download.bin"
    )
