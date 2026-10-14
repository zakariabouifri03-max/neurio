import hashlib
from app.models import CHUNK_SIZE
from .local_range_server import range_server


def test_ten_concurrent_and_immediate_replacement(make_engine, db):
    data = b"".join(bytes([i]) * CHUNK_SIZE for i in range(13)) + b"final-tail"
    with range_server(
        data, require_ten=True, delays={0: 0.02, **{i: 0.35 for i in range(1, 10)}}
    ) as server:
        progress = []
        engine = make_engine(
            server, hashlib.sha256(data).hexdigest(), lambda _, p: progress.append(p)
        )
        engine.run()
        assert db.get(engine.identifier)["status"] == "completed"
        assert engine.destination.read_bytes() == data
        assert server.peak == 10
        assert engine.scheduler.max_submitted == 10
        start_next = next(
            t for event, idx, t in server.events if event == "start" and idx == 10
        )
        end_slow = min(
            t for event, idx, t in server.events if event == "end" and 1 <= idx < 10
        )
        assert start_next < end_slow
        assert all(0 <= p["downloaded"] <= len(data) for p in progress)
        assert progress[-1]["downloaded"] == len(data)
        assert all(v == 1 for v in server.calls.values())
        print(
            f"Observed peak requests: {server.peak}; maximum submitted tasks: {engine.scheduler.max_submitted}"
        )


def test_zero_byte(make_engine, db):
    with range_server(b"") as server:
        e = make_engine(server)
        e.run()
        assert e.destination.read_bytes() == b""
        assert db.get(e.identifier)["chunks"] == 0
