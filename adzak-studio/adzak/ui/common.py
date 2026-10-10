"""Shared Qt helpers: file dialogs, message boxes, path-to-Qt conversions."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtWidgets import QFileDialog, QMessageBox, QWidget

from ..core.i18n import tr
from ..core.log import get_logger

log = get_logger("ui")

VIDEO_FILTER = "Video (*.mp4 *.mov *.mkv *.avi *.webm *.m4v);;All files (*)"
AUDIO_FILTER = "Audio (*.mp3 *.wav *.aac *.m4a *.flac *.ogg *.opus);;All files (*)"
IMAGE_FILTER = "Images (*.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff *.gif);;All files (*)"
MEDIA_FILTER = ("Media (*.mp4 *.mov *.mkv *.avi *.webm *.m4v *.mp3 *.wav *.aac *.m4a *.flac *.ogg *.opus "
                "*.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff *.gif);;All files (*)")


def open_files(parent: QWidget, title: str, flt: str = MEDIA_FILTER) -> list[str]:
    files, _ = QFileDialog.getOpenFileNames(parent, title, "", flt)
    return files


def open_file(parent: QWidget, title: str, flt: str = MEDIA_FILTER) -> str:
    f, _ = QFileDialog.getOpenFileName(parent, title, "", flt)
    return f


def save_file(parent: QWidget, title: str, default: str, flt: str) -> str:
    f, _ = QFileDialog.getSaveFileName(parent, title, default, flt)
    return f


def info(parent: QWidget, message: str, title: str = "") -> None:
    QMessageBox.information(parent, title or tr("done"), message)


def error(parent: QWidget, message: str) -> None:
    QMessageBox.warning(parent, tr("error"), message)


def is_media(path: str) -> bool:
    return Path(path).suffix.lower() in {
        ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mp3", ".wav", ".aac", ".m4a", ".flac",
        ".ogg", ".opus", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}


def kind_for(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext in {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}:
        return "video"
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}:
        return "image"
    return "audio"
