import threading
import pytest
from app.assembler import assemble, BadChunk
from app.models import CHUNK_SIZE
from .local_range_server import range_server


@pytest.mark.parametrize("damage", ["missing", "short", "same-size"])
def test_corrupt_chunk_cannot_assemble(make_engine, db, tmp_path, damage):
    with range_server(b"a" * (CHUNK_SIZE + 5)) as server:
        e = make_engine(server)
        e.run()
        part = e.chunks / "00000000.part"
        if damage == "missing":
            part.unlink()
        else:
            part.write_bytes(b"b" * (CHUNK_SIZE if damage == "same-size" else 1))
        with pytest.raises(BadChunk) as exc:
            assemble(
                db,
                e.identifier,
                e.chunks,
                tmp_path / "merge.tmp",
                len(server.data),
                "",
                threading.Event(),
            )
        assert exc.value.index == 0
