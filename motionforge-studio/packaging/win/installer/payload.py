"""Placeholder for the embedded application payload.

``tools/build_win_installer.py`` rewrites this module with the real bytes of the
portable build before the installer executable is compiled::

    PAYLOAD_ZIP = b"PK\\x03\\x04..."

Keep the module tiny - it is imported by the installer at start up.
"""
from __future__ import annotations

PAYLOAD_ZIP = b""
PAYLOAD_NAME = "MotionForge-Studio-portable.zip"
