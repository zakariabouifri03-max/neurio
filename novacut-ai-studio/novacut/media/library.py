"""Media library: import, probe (with SQLite cache), relink and cleanup."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

from ..core.constants import MEDIA_EXTENSIONS
from ..core.ffmpeg import probe, MediaMetadata
from ..core.logging_setup import get_logger
from ..models.media import MediaItem, kind_for_path, quick_hash
from . import cache

log = get_logger("library")


class ImportResult:
    def __init__(self) -> None:
        self.added: list[MediaItem] = []
        self.unsupported: list[str] = []
        self.missing: list[str] = []

    @property
    def ok(self) -> bool:
        return not self.unsupported and not self.missing


class MediaLibrary:
    """Operates on the media dictionary owned by a Project."""

    def __init__(self, project) -> None:
        self.project = project

    # ------------------------------------------------------------- import
    def import_paths(self, paths: Iterable[str | Path],
                     progress=None) -> ImportResult:
        result = ImportResult()
        paths = list(paths)
        for i, raw in enumerate(paths):
            p = Path(raw)
            if progress:
                progress(i / max(1, len(paths)), f"Importing {p.name}")
            if not p.exists():
                result.missing.append(str(p))
                continue
            if p.suffix.lower() not in MEDIA_EXTENSIONS:
                result.unsupported.append(str(p))
                continue
            item = self._import_one(p)
            if item is not None:
                result.added.append(item)
        if progress:
            progress(1.0, "Import complete")
        return result

    def _import_one(self, p: Path) -> Optional[MediaItem]:
        # Re-use an already imported file (identity by resolved path/hash).
        for existing in self.project.media.values():
            try:
                if Path(existing.path).resolve() == p.resolve():
                    return existing
            except OSError:
                continue
        cached = cache.get_cached_metadata(str(p))
        if cached:
            metadata = MediaMetadata(**cached)
        else:
            metadata = probe(str(p))
            cache.store_metadata(str(p), quick_hash(p), metadata.to_dict())
        item = MediaItem.from_path(p, metadata)
        if item.kind == "unknown":
            log.warning("Unsupported file type: %s", p)
            return None
        return self.project.add_media(item)

    # ------------------------------------------------------------ relink
    def relink(self, media_id: str, new_path: str | Path) -> bool:
        item = self.project.media.get(media_id)
        if item is None or not Path(new_path).exists():
            return False
        p = Path(new_path)
        item.path = str(p)
        item.name = p.stem
        item.kind = kind_for_path(p)
        item.apply_metadata(probe(str(p)))
        item.file_hash = quick_hash(p)
        item.missing = False
        item.proxy_path = item.thumbnail_path = item.waveform_path = ""
        self.project.touch()
        return True

    def relink_folder(self, folder: str | Path) -> int:
        """Point every missing item at a same-named file inside *folder*."""
        folder = Path(folder)
        fixed = 0
        index = {p.name: p for p in folder.rglob("*") if p.is_file()}
        for item in self.project.media.values():
            if not item.missing:
                continue
            match = index.get(Path(item.path).name)
            if match and self.relink(item.id, match):
                fixed += 1
        return fixed

    # ------------------------------------------------------------ cleanup
    def remove_unused(self) -> list[str]:
        used = self.project.media_used_by_timeline()
        removed = [mid for mid in list(self.project.media) if mid not in used]
        for mid in removed:
            self.project.remove_media(mid)
        return removed

    def missing_items(self) -> list[MediaItem]:
        return [m for m in self.project.media.values() if m.missing]
