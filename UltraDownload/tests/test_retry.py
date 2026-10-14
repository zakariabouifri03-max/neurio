import pytest
from app.models import CHUNK_SIZE
from .local_range_server import range_server


@pytest.mark.parametrize(
    "options",
    [{"failures": {0: [503, 500]}}, {"truncations": {0: 2}}, {"failures": {0: [429]}}],
)
def test_transient_retry(make_engine, db, options):
    with range_server(b"a" * CHUNK_SIZE, **options) as server:
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert e.destination.read_bytes() == server.data
        assert server.calls[0] > 1
        if options.get("failures") == {0: [429]}:
            starts = [t for event, _, t in server.events if event == "start"]
            assert starts[1] - starts[0] >= 0.1


def test_permanent_error_not_retried(make_engine, db):
    with range_server(b"a" * CHUNK_SIZE, failures={0: [404]}) as server:
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert server.calls[0] == 1
        assert not e.destination.exists()


def test_bounded_retry_budget(make_engine, db, settings):
    settings.retries = 2
    with range_server(b"a" * CHUNK_SIZE, failures={0: [503] * 10}) as server:
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert server.calls[0] == 3


def test_server_connection_limit_429(make_engine, db, settings):
    settings.retries = 8
    with range_server(b"a" * CHUNK_SIZE * 12, limit=3, delay=0.025) as server:
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "completed"
        assert e.destination.read_bytes() == server.data
        assert any(count > 1 for count in server.calls.values())


def test_read_timeout_is_bounded(make_engine, db, settings):
    settings.read_timeout = 0.05
    settings.retries = 1
    with range_server(b"a" * CHUNK_SIZE, delay=0.25) as server:
        e = make_engine(server)
        e.run()
        assert db.get(e.identifier)["status"] == "failed"
        assert not e.destination.exists()
        assert db.rows(e.identifier)[0]["retries"] == 2
