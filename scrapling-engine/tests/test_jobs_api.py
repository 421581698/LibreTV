from __future__ import annotations

from fastapi.testclient import TestClient

from app import main
from app.job_store import JobStore


def _use_test_store(monkeypatch, tmp_path) -> JobStore:
    store = JobStore(str(tmp_path / "jobs.sqlite3"))
    store.initialize()
    monkeypatch.setattr(main, "job_store", store)
    monkeypatch.setattr(main, "validate_public_http_url", lambda url: url)
    monkeypatch.setattr(main, "_schedule_job", lambda task_id: None)
    monkeypatch.setattr(main.settings, "crawl_data_dir", str(tmp_path / "crawls"))
    return store


def test_job_api_persists_and_rejects_task_id_seed_mismatch(monkeypatch, tmp_path) -> None:
    store = _use_test_store(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/v1/jobs",
        json={"task_id": "job_api_01", "urls": ["https://example.com/"]},
    )
    assert response.status_code == 202
    assert response.json()["job"]["status"] == "queued"

    status = client.get("/v1/jobs/job_api_01")
    assert status.status_code == 200
    assert status.json()["job"]["seeds"] == ["https://example.com/"]

    mismatch = client.post(
        "/v1/jobs",
        json={"task_id": "job_api_01", "urls": ["https://different.example/"]},
    )
    assert mismatch.status_code == 409
    assert store.get("job_api_01") is not None


def test_job_pause_and_resume_controls(monkeypatch, tmp_path) -> None:
    store = _use_test_store(monkeypatch, tmp_path)
    client = TestClient(main.app)
    checkpoint = tmp_path / "crawls" / "job_api_02"
    checkpoint.mkdir(parents=True)
    (checkpoint / "checkpoint.bin").write_bytes(b"checkpoint")

    assert store.create(
        "job_api_02",
        ["https://example.com/"],
        str(checkpoint),
    )
    store.update("job_api_02", "running")

    class FakeSpider:
        paused = False

        def pause(self) -> None:
            self.paused = True

    spider = FakeSpider()
    monkeypatch.setitem(main._active_spiders, "job_api_02", spider)

    pause = client.post("/v1/jobs/job_api_02/pause")
    assert pause.status_code == 200
    assert spider.paused is True
    assert store.get("job_api_02")["status"] == "pausing"

    store.update("job_api_02", "paused")
    resume = client.post("/v1/jobs/job_api_02/resume")
    assert resume.status_code == 202
    assert store.get("job_api_02")["status"] == "queued"
