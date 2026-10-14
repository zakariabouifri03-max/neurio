import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit


def validate_url(url: str) -> str:
    url = url.strip()
    p = urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Enter a direct HTTP(S) URL without embedded credentials.")
    if any(ord(c) < 32 for c in url):
        raise ValueError("URL contains control characters")
    return url


def persistable_url(url: str) -> str:
    p = urlsplit(url)
    return "" if p.query or p.fragment or p.username or p.password else url


def safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")[:180]
    if not name or name in (".", ".."):
        name = "download.bin"
    if name.split(".")[0].upper() in {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        name = "_" + name
    return name


def sync_file(f):
    f.flush()
    os.fsync(f.fileno())


def check_space(temp: Path, destination: Path, size: int | None):
    destination.mkdir(parents=True, exist_ok=True)
    temp.mkdir(parents=True, exist_ok=True)
    if size is None:
        return
    # Chunk files plus assembled output coexist until publication.
    same = temp.stat().st_dev == destination.stat().st_dev
    if shutil.disk_usage(destination).free < size * (2 if same else 1):
        raise OSError(
            "Insufficient disk space (chunks and output require up to twice the file size)"
        )
    if not same and shutil.disk_usage(temp).free < size:
        raise OSError("Insufficient temporary disk space")


def publish_no_replace(source: Path, destination: Path):
    """Atomic no-clobber publication; both paths must be on the destination volume."""
    if os.name == "nt":
        os.rename(source, destination)  # Windows rename fails if destination exists.
    else:
        os.link(
            source, destination
        )  # Atomic and fails with EEXIST; never replaces user files.
        source.unlink()


def remove_owned(root: Path, download_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", download_id):
        raise ValueError("Invalid temporary directory ID")
    path = root / download_id
    if path.is_symlink() or path.resolve().parent != root.resolve():
        raise ValueError("Unsafe temporary path")
    if path.exists():
        shutil.rmtree(path)
