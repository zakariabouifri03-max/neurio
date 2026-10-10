"""ADZAK CREATIVE STUDIO — all-in-one AI creative suite for Windows.

Package layout
--------------
- adzak.core      : Qt-free foundations (settings, i18n, projects, ffmpeg, jobs, undo)
- adzak.services  : media services (timeline, image ops, converter, audio, subtitles…)
- adzak.ai        : AI capability registry, provider clients, secure key storage
- adzak.ui        : PySide6 interface (main window + one panel per studio)

The core/services layers deliberately avoid Qt imports so they can be unit-tested
headlessly and reused from scripts or CLI tools.
"""

__version__ = "1.0.0"
APP_NAME = "ADZAK CREATIVE STUDIO"
APP_ID = "adzak-creative-studio"
