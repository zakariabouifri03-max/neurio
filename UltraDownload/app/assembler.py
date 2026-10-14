import hashlib
from pathlib import Path
from .file_utils import sync_file
from .integrity import verify_checksum
from .models import DownloadError, Stopped


class BadChunk(DownloadError):
    def __init__(self, index):
        super().__init__(
            f"Chunk {index} is missing or corrupt; retry will preserve valid chunks"
        )
        self.index = index


def assemble(db, identifier, chunk_dir, output, expected_size, expected_hash, stop):
    """Never publish here; caller persists publication intent before atomic rename."""
    digest = hashlib.sha256()
    total = 0
    with open(output, "wb") as target:
        for row in db.iter_chunks(identifier):
            if stop.is_set():
                raise Stopped()
            path = chunk_dir / f"{row['idx']:08d}.part"
            if (
                row["status"] != "complete"
                or not path.is_file()
                or path.stat().st_size != row["expected"]
            ):
                raise BadChunk(row["idx"])
            chunk_digest = hashlib.sha256()
            with path.open("rb") as source:
                while data := source.read(256 * 1024):
                    if stop.is_set():
                        raise Stopped()
                    target.write(data)
                    digest.update(data)
                    chunk_digest.update(data)
                    total += len(data)
            if chunk_digest.hexdigest() != row["sha256"]:
                raise BadChunk(row["idx"])
        sync_file(target)
    if total != expected_size or Path(output).stat().st_size != expected_size:
        raise DownloadError("Assembled file size does not match Content-Length")
    result = digest.hexdigest()
    verify_checksum(result, expected_hash)
    return result
