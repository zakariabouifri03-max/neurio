"""API-key storage.

On Windows, keys are encrypted with DPAPI (``crypt32.CryptProtectData``),
bound to the current user account.  On other platforms we fall back to an
obfuscation layer (XOR + base64) so keys never sit in plain text in the
SQLite settings DB — and we clearly document that this is obfuscation, not
strong encryption.  Keys are never written to logs (the logging layer also
redacts secret-like strings defensively).
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from ..core import paths

_FALLBACK_KEY = b"adzak-local-obfuscation-v1"  # not a secret — documented fallback


def _dpapi_protect(data: bytes) -> bytes | None:
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [("cbData", wintypes.DWORD),
                        ("pbData", ctypes.POINTER(ctypes.c_char))]

        blob_in = DATA_BLOB(len(data), ctypes.create_string_buffer(data, len(data)))
        blob_out = DATA_BLOB()
        if ctypes.windll.crypt32.CryptProtectData(
                ctypes.byref(blob_in), None, None, None, None, 0,
                ctypes.byref(blob_out)):
            out = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
            return out
    except Exception:
        return None
    return None


def _dpapi_unprotect(data: bytes) -> bytes | None:
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [("cbData", wintypes.DWORD),
                        ("pbData", ctypes.POINTER(ctypes.c_char))]

        blob_in = DATA_BLOB(len(data), ctypes.create_string_buffer(data, len(data)))
        blob_out = DATA_BLOB()
        if ctypes.windll.crypt32.CryptUnprotectData(
                ctypes.byref(blob_in), None, None, None, None, 0,
                ctypes.byref(blob_out)):
            out = ctypes.string_at(blob_out.pbData, blob_out.cbData)
            ctypes.windll.kernel32.LocalFree(blob_out.pbData)
            return out
    except Exception:
        return None
    return None


def _obfuscate(data: bytes) -> bytes:
    out = bytes(b ^ _FALLBACK_KEY[i % len(_FALLBACK_KEY)] for i, b in enumerate(data))
    return base64.b64encode(out)


def _deobfuscate(data: bytes) -> bytes:
    raw = base64.b64decode(data)
    return bytes(b ^ _FALLBACK_KEY[i % len(_FALLBACK_KEY)] for i, b in enumerate(raw))


class KeyStore:
    """Stores provider keys in a small JSON file with OS-level protection."""

    def __init__(self, path: Path | None = None):
        self.path = path or (paths.app_data_dir() / "secrets.json")

    def _load(self) -> dict:
        if self.path.exists():
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return {}
        return {}

    def _save(self, data: dict) -> None:
        self.path.write_text(json.dumps(data), encoding="utf-8")
        if sys.platform != "win32":
            try:
                self.path.chmod(0o600)
            except OSError:
                pass

    def set_key(self, provider: str, api_key: str) -> None:
        data = self._load()
        raw = api_key.encode("utf-8")
        protected = _dpapi_protect(raw)
        if protected is not None:
            data[provider] = {"method": "dpapi",
                              "blob": base64.b64encode(protected).decode()}
        else:
            data[provider] = {"method": "obfuscation",
                              "blob": _obfuscate(raw).decode()}
        self._save(data)

    def get_key(self, provider: str) -> str | None:
        entry = self._load().get(provider)
        if not entry:
            return None
        blob_b64 = entry.get("blob", "")
        if entry.get("method") == "dpapi":
            raw = _dpapi_unprotect(base64.b64decode(blob_b64))
        else:
            raw = _deobfuscate(blob_b64.encode("ascii"))
        return raw.decode("utf-8") if raw else None

    def delete_key(self, provider: str) -> None:
        data = self._load()
        data.pop(provider, None)
        self._save(data)

    def providers_with_keys(self) -> list[str]:
        return sorted(self._load().keys())
