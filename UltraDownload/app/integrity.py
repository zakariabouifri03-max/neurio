import hashlib
import re
from .models import DownloadError, Stopped


def validate_checksum(value):
    value = value.strip().lower()
    if value and not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(
            "Expected SHA-256 must contain exactly 64 hexadecimal characters"
        )
    return value


def sha256_file(path, stop=None):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while data := f.read(256 * 1024):
            if stop is not None and stop.is_set():
                raise Stopped()
            digest.update(data)
    return digest.hexdigest()


def verify_checksum(actual, expected):
    if expected and actual.lower() != expected.lower():
        raise DownloadError(
            "SHA-256 mismatch against supplied checksum; output was not published"
        )
