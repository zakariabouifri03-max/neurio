"""End-to-end API tests for the Anywear backend."""

from __future__ import annotations

import time
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


def img_bytes(w=256, h=384, color=(180, 160, 170)) -> bytes:
    out = BytesIO()
    Image.new("RGB", (w, h), color).save(out, "PNG")
    return out.getvalue()


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import app.config as config
    import app.db as db
    import app.services.storage as storage
    from app.main import settings

    tmp = tmp_path_factory.mktemp("data")
    old = settings.data_dir
    settings.data_dir = tmp
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.results_dir.mkdir(parents=True, exist_ok=True)
    db.init_db(settings.db_path)
    c = TestClient(app)
    yield c
    settings.data_dir = old


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["dev_mode"] is True


def test_upload_valid(client):
    r = client.post(
        "/api/upload",
        files={"file": ("p.png", img_bytes(), "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["file_id"]
    r2 = client.get(body["url"])
    assert r2.status_code == 200


def test_upload_rejects_bad_type(client):
    r = client.post("/api/upload", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 415


def test_upload_rejects_corrupt(client):
    r = client.post("/api/upload", files={"file": ("x.png", b"not a real png", "image/png")})
    assert r.status_code == 422


def test_tryon_end_to_end(client):
    person = client.post("/api/upload", files={"file": ("p.png", img_bytes(), "image/png")}).json()
    garment = client.post("/api/upload", files={"file": ("g.png", img_bytes(w=300, h=300, color=(20, 80, 160)), "image/png")}).json()

    r = client.post(
        "/api/tryon",
        files={
            "person": ("p.png", img_bytes(), "image/png"),
            "garment": ("g.png", img_bytes(w=300, h=300, color=(20, 80, 160)), "image/png"),
        },
        data={"category": "dress"},
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]

    status = None
    for _ in range(100):
        s = client.get(f"/api/jobs/{job_id}").json()
        if s["status"] in ("succeeded", "failed"):
            status = s
            break
        time.sleep(0.1)
    assert status and status["status"] == "succeeded", status
    assert status["result_url"]
    img = client.get(status["result_url"])
    assert img.status_code == 200
    assert img.content[:3] == b"\xff\xd8\xff"  # JPEG magic


def test_tryon_garment_url(client, monkeypatch):
    # Serves a garment image via /api/files from a previous upload
    garment = client.post("/api/upload", files={"file": ("g.png", img_bytes(w=300, h=300, color=(10, 90, 30)), "image/png")}).json()
    # TestClient is not a real HTTP server, so simulate the server-side fetch.
    import app.services.jobs as jobs

    monkeypatch.setattr(
        jobs, "fetch_garment", lambda url: img_bytes(w=300, h=300, color=(10, 90, 30)) if url else None
    )
    r = client.post(
        "/api/tryon",
        files={"person": ("p.png", img_bytes(), "image/png")},
        data={"category": "shirt", "garment_url": "http://testserver" + garment["url"]},
    )
    assert r.status_code == 200
    job_id = r.json()["job_id"]
    for _ in range(100):
        s = client.get(f"/api/jobs/{job_id}").json()
        if s["status"] in ("succeeded", "failed"):
            assert s["status"] == "succeeded", s
            return
        time.sleep(0.1)
    pytest.fail("job did not finish")


def test_tryon_requires_garment(client):
    r = client.post("/api/tryon", files={"person": ("p.png", img_bytes(), "image/png")})
    assert r.status_code == 400


def test_history_and_delete(client):
    r = client.post(
        "/api/tryon",
        files={
            "person": ("p.png", img_bytes(), "image/png"),
            "garment": ("g.png", img_bytes(w=300, h=300, color=(180, 30, 30)), "image/png"),
        },
        data={"category": "jacket"},
    )
    job_id = r.json()["job_id"]
    for _ in range(100):
        s = client.get(f"/api/jobs/{job_id}").json()
        if s["status"] == "succeeded":
            break
        time.sleep(0.1)

    h = client.get("/api/history").json()
    assert len(h) >= 1
    item = h[0]
    assert item["result_url"]
    d = client.delete(f"/api/history/{item['id']}")
    assert d.status_code == 200
    assert client.delete(f"/api/history/{item['id']}").status_code == 404
