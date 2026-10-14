import hashlib
import re


def sha256_file(path, stop=None):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        while data := stream.read(256 * 1024):
            if stop and stop.is_set():
                from .http_client import Interrupted
                raise Interrupted()
            digest.update(data)
    return digest.hexdigest()


def validate_checksum(value):
    value = value.strip().lower()
    if value and not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Expected SHA-256 must contain exactly 64 hexadecimal characters")
    return value


def compare_checksum(actual, expected):
    if expected and actual.lower() != expected.lower():
        raise ValueError("SHA-256 mismatch. File was NOT published; verify the checksum and source")
