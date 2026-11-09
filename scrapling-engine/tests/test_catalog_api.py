from fastapi.testclient import TestClient

import app.fmhy_catalog as fmhy_catalog
import app.main as main
from app.catalog_store import CatalogStore
from app.fmhy_catalog import parse_fmhy_markdown


def test_catalog_read_apis_return_entries_and_domains(tmp_path, monkeypatch) -> None:
    store = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    store.initialize()
    entries = parse_fmhy_markdown(
        "video.md",
        "* 🌟 [Example](https://example.com/) or [Mirror](https://mirror.example/) - Movies\\n",
    )
    store.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="fixture", source_count=1,
    )
    monkeypatch.setattr(main, "catalog_store", store)
    client = TestClient(main.app)

    response = client.get("/v1/catalog/entries?category=video")
    assert response.status_code == 200
    assert response.json()["entries"][0]["title"] == "Example"

    domains = client.get("/v1/catalog/domains")
    assert domains.status_code == 200
    assert {item["domain"] for item in domains.json()["domains"]} == {
        "example.com", "mirror.example",
    }
    categories = client.get("/v1/catalog/categories")
    assert categories.status_code == 200
    assert categories.json()["categories"][0]["category"] == "video"


def test_catalog_api_hides_unsafe_records_by_default(tmp_path, monkeypatch) -> None:
    store = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    store.initialize()
    entries = parse_fmhy_markdown("unsafe.md", "* [Unsafe](https://unsafe.example/) - flagged\\n")
    store.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="fixture", source_count=1,
    )
    monkeypatch.setattr(main, "catalog_store", store)
    client = TestClient(main.app)

    assert client.get("/v1/catalog/entries").json()["count"] == 0
    assert client.get("/v1/catalog/entries?include_unsafe=true").json()["count"] == 1


def test_catalog_sync_endpoint_imports_and_persists_official_source_data(
    tmp_path, monkeypatch,
) -> None:
    store = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    store.initialize()
    monkeypatch.setattr(main, "catalog_store", store)

    async def fake_fetch():
        return {
            "video.md": "* [Imported](https://imported.example/) - Movie index\\n",
        }, "a" * 40

    monkeypatch.setattr(fmhy_catalog, "fetch_official_fmhy_sources", fake_fetch)
    response = TestClient(main.app).post("/v1/catalog/fmhy/sync")

    assert response.status_code == 200
    assert response.json()["source_files"] == 1
    snapshot = store.latest_snapshot()
    assert snapshot is not None
    assert snapshot["source_revision"] == "a" * 40
    imported = store.list_entries(snapshot_id=snapshot["snapshot_id"])
    assert imported[0]["title"] == "Imported"


def test_failed_catalog_sync_keeps_previous_snapshot(tmp_path, monkeypatch) -> None:
    store = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    store.initialize()
    entries = parse_fmhy_markdown("video.md", "* [Existing](https://existing.example/)\\n")
    original = store.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="previous", source_count=1,
    )
    monkeypatch.setattr(main, "catalog_store", store)

    async def failing_fetch():
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(fmhy_catalog, "fetch_official_fmhy_sources", failing_fetch)
    response = TestClient(main.app).post("/v1/catalog/fmhy/sync")

    assert response.status_code == 502
    assert store.latest_snapshot()["snapshot_id"] == original["snapshot_id"]


def test_selected_fmhy_entry_creates_scrapling_job_with_provenance(
    tmp_path, monkeypatch,
) -> None:
    catalog = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    catalog.initialize()
    entries = parse_fmhy_markdown(
        "video.md",
        "* [Primary](https://primary.example/) or [Mirror](https://mirror.example/) - Movies\\n",
    )
    snapshot = catalog.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="fixture", source_count=1,
    )
    jobs = main.JobStore(str(tmp_path / "jobs.sqlite3"))
    jobs.initialize()
    monkeypatch.setattr(main, "catalog_store", catalog)
    monkeypatch.setattr(main, "job_store", jobs)
    monkeypatch.setattr(main, "_safe_seed_urls", lambda urls: urls)

    async def fake_create_job(request):
        jobs.create("catalog-test-job", request.urls, str(tmp_path / "checkpoint"))
        return {"ok": True, "job": jobs.get("catalog-test-job")}

    monkeypatch.setattr(main, "create_job", fake_create_job)
    response = TestClient(main.app).post(
        "/v1/catalog/crawl",
        json={"snapshot_id": snapshot["snapshot_id"], "entry_ids": [entries[0].entry_id]},
    )

    assert response.status_code == 202
    assert response.json()["seed_count"] == 1
    assert response.json()["job"]["seeds"] == ["https://primary.example/"]
    events = jobs.events_after("catalog-test-job", 0)
    selection = next(event for event in events if event["type"] == "catalog_selection")
    assert selection["payload"]["entries"][0]["source_file"] == "video.md"


def test_selected_unsafe_fmhy_entry_cannot_be_queued(tmp_path, monkeypatch) -> None:
    catalog = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    catalog.initialize()
    entries = parse_fmhy_markdown(
        "unsafe.md", "* [Unsafe](https://unsafe.example/) - Reported malicious\\n",
    )
    snapshot = catalog.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="fixture", source_count=1,
    )
    monkeypatch.setattr(main, "catalog_store", catalog)
    response = TestClient(main.app).post(
        "/v1/catalog/crawl",
        json={"snapshot_id": snapshot["snapshot_id"], "entry_ids": [entries[0].entry_id]},
    )

    assert response.status_code == 422


def test_job_discovery_api_returns_persisted_movie_pages_and_media_candidates(
    tmp_path, monkeypatch,
) -> None:
    jobs = main.JobStore(str(tmp_path / "jobs.sqlite3"))
    jobs.initialize()
    jobs.create("discovery-job", ["https://catalog.example/"], str(tmp_path / "checkpoint"))
    jobs.add_result(
        "discovery-job",
        {
            "url": "https://catalog.example/",
            "title": "Example Movie",
            "discovered_pages": [
                {
                    "url": "https://catalog.example/watch/123",
                    "role": "playback_page",
                    "label": "",
                },
            ],
            "media_candidates": [
                {
                    "url": "https://cdn.example/master.m3u8",
                    "media_type": "hls",
                    "discovered_via": "video_src",
                    "validation_status": "pending_fetch_validation",
                },
            ],
        },
    )
    monkeypatch.setattr(main, "job_store", jobs)

    response = TestClient(main.app).get("/v1/jobs/discovery-job/discovery")

    assert response.status_code == 200
    payload = response.json()
    assert payload["page_count"] == 1
    assert payload["media_candidate_count"] == 1
    assert payload["media_candidates"][0]["source_page_title"] == "Example Movie"
    assert payload["media_candidates"][0]["validation_status"] == "pending_fetch_validation"
