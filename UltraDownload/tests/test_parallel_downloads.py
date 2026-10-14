from pathlib import Path
from app.download_engine import DownloadEngine


def test_ten_real_connections_and_immediate_replacement(server, setup_download):
    server.delay = .15
    server.slow_first = .7
    db, d, settings = setup_download(server)
    updates = []
    engine = DownloadEngine(db, d, settings, callback=updates.append)
    engine.run()
    assert d.status == "completed", d.error
    assert Path(d.destination).read_bytes() == server.data
    assert server.peak == 10
    starts = {index: t for event, index, t, _ in server.events if event == "start"}
    ends = {index: t for event, index, t, _ in server.events if event == "end"}
    assert starts[10] < ends[0], "Scheduler must not wait for an entire batch"
    assert starts[10]-min(ends.values()) < .3
    assert len(starts) == d.count
    assert max(s["percent"] for s in updates) <= 100
    assert updates[-1]["downloaded"] == len(server.data)
    assert updates[-1]["completed"] == d.count


def test_global_connection_budget_across_files(server, setup_download):
    import threading
    db1, d1, settings = setup_download(server, global_connections=6)
    db2, d2, _ = setup_download(server)
    server.delay = .1
    slots = threading.BoundedSemaphore(6)
    engines = [DownloadEngine(db1, d1, settings, slots), DownloadEngine(db2, d2, settings, slots)]
    threads = [threading.Thread(target=e.run) for e in engines]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(15)
        assert not thread.is_alive()
    assert d1.status == d2.status == 'completed'
    assert server.peak == 6


def test_server_connection_limit_is_respected_with_retry(server, setup_download):
    server.limit, server.delay = 3, .025
    db, d, settings = setup_download(server, retries=10, retry_delay=.05)
    DownloadEngine(db, d, settings).run()
    assert d.status == 'completed', d.error
    assert server.peak <= 3
    assert any(event == 'reject' for event, *_ in server.events)
