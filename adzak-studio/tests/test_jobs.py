import threading
import time

from adzak.core.jobs import Job, JobCancelled, JobQueue, JobStatus, run_blocking


def test_job_success_and_progress():
    seen = []

    def work(report, cancel):
        report(0.25, "quarter")
        report(0.75, "three quarters")
        return 42

    job = Job(fn=work, title="demo", on_progress=lambda j: seen.append(j.progress))
    result = run_blocking(job)
    assert result.ok and result.value == 42
    assert job.status == JobStatus.DONE
    assert job.progress == 1.0
    assert 0.25 in seen


def test_job_failure_is_reported_not_hidden():
    def boom(report, cancel):
        raise ValueError("kaboom")

    job = Job(fn=boom, title="bad")
    result = run_blocking(job)
    assert not result.ok
    assert "kaboom" in result.error
    assert job.status == JobStatus.FAILED


def test_job_cancel():
    started = threading.Event()

    def slow(report, cancel):
        started.set()
        while not cancel.is_set():
            time.sleep(0.01)
        raise JobCancelled("x")

    job = Job(fn=slow, title="slow")
    q = JobQueue(max_workers=1)
    q.submit(job)
    started.wait(2)
    job.cancel()
    deadline = time.time() + 3
    while job.status not in (JobStatus.CANCELLED, JobStatus.DONE, JobStatus.FAILED) \
            and time.time() < deadline:
        time.sleep(0.02)
    assert job.status == JobStatus.CANCELLED
    q.shutdown()


def test_queue_runs_all():
    q = JobQueue(max_workers=2)
    results = []
    done = threading.Event()
    remaining = [5]
    lock = threading.Lock()

    def work(report, cancel, i):
        return i * 2

    for i in range(5):
        def fin(job):
            with lock:
                results.append(job.result.value)
                remaining[0] -= 1
                if remaining[0] == 0:
                    done.set()
        q.submit(Job(fn=work, args=(i,), title=f"t{i}", on_finished=fin))
    assert done.wait(5)
    assert sorted(results) == [0, 2, 4, 6, 8]
    q.shutdown()
