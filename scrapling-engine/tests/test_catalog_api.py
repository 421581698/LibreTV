from fastapi.testclient import TestClient

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


def test_catalog_sync_endpoint_calls_official_importer(monkeypatch) -> None:
    async def fake_sync(store):
        return {
            "snapshot_id": "fixture",
            "source_count": 25,
            "entry_count": 4,
            "link_count": 5,
            "unique_domain_count": 5,
            "source_files": 25,
        }

    monkeypatch.setattr(main, "sync_fmhy_catalog", fake_sync)
    response = TestClient(main.app).post("/v1/catalog/fmhy/sync")

    assert response.status_code == 200
    assert response.json()["source_files"] == 25
