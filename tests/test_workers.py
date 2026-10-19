from novacut.workers import Worker, _ACTIVE_WORKERS


def test_cancelled_worker_suppresses_late_error_and_releases_reference():
    def fail_after_cancel(*_args):
        raise RuntimeError("cancelled network request")

    worker = Worker(fail_after_cancel)
    errors = []
    finished = []
    worker.signals.error.connect(errors.append)
    worker.signals.finished.connect(lambda: finished.append(True))
    worker.cancel()

    worker.run()

    assert not errors
    assert finished == [True]
    assert worker not in _ACTIVE_WORKERS
