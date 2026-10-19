"""Preview frame server and cached thumbnail/waveform generation."""
import time
from pathlib import Path

import pytest
from PySide6.QtCore import QEventLoop, QTimer

from novacut.media import thumbnails
from novacut.models.enums import ClipKind
from novacut.models.media import MediaItem
from novacut.models.project import Project
from novacut.models.timeline import Clip
from novacut.playback.frame_server import FrameServer
from novacut.core.ffmpeg import probe


def _wait_signal(signal, timeout=20000):
    loop = QEventLoop()
    signal.connect(loop.quit)
    QTimer.singleShot(timeout, loop.quit)
    loop.exec()


def test_frame_server_emits_frames(qapp, media_factory):
    video = media_factory("pv.mp4", duration=2.0)
    project = Project.from_preset("landscape_720")
    item = MediaItem.from_path(video, probe(video))
    project.add_media(item)
    clip = Clip(kind=ClipKind.VIDEO.value, media_id=item.id, start=0.0,
                duration=1.5, source_in=0.0, source_duration=1.5)
    project.timeline.add_clip(clip, project.timeline.video_tracks()[0].id)

    server = FrameServer()
    server.set_project(project)
    server.set_quality(0.25)
    frames = []
    server.frameReady.connect(lambda img: frames.append(img))
    server.play(0.0)
    _wait_signal(server.endReached)
    server.stop()
    assert frames, "no preview frames were decoded"
    first = frames[0]
    assert first.width() > 0 and first.height() > 0
    assert len(frames) > 10  # ~1.5s worth of frames at project fps


def test_single_frame_seek(qapp, media_factory):
    video = media_factory("seek.mp4", duration=2.0)
    project = Project.from_preset("landscape_720")
    item = MediaItem.from_path(video, probe(video))
    project.add_media(item)
    clip = Clip(kind=ClipKind.VIDEO.value, media_id=item.id, start=0.0,
                duration=2.0, source_duration=2.0)
    project.timeline.add_clip(clip, project.timeline.video_tracks()[0].id)

    server = FrameServer()
    server.set_project(project)
    server.set_quality(0.25)
    frames = []
    server.frameReady.connect(lambda img: frames.append(img))
    server.seek(1.0)
    deadline = time.time() + 15
    while not frames and time.time() < deadline:
        qapp.processEvents()
        time.sleep(0.05)
    server.stop()
    assert frames


def test_thumbnail_and_waveform_cache(media_factory):
    video = media_factory("cache.mp4", duration=2.0)
    item = MediaItem.from_path(video, probe(video))
    thumb = thumbnails.thumbnail(item.path, 0.5, file_hash=item.file_hash)
    assert thumb and Path(thumb).exists()
    # Second call is served from cache.
    again = thumbnails.thumbnail(item.path, 0.5, file_hash=item.file_hash)
    assert again == thumb
    strip = thumbnails.thumbnail_strip(item.path, item.duration, 4,
                                       file_hash=item.file_hash)
    assert len(strip) == 4
    env = thumbnails.waveform(item.path, file_hash=item.file_hash, bins=64)
    assert env is not None and len(env) == 64
    assert 0.0 <= float(env.max()) <= 1.0
