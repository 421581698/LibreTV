from app.catalog_store import CatalogStore
from app.fmhy_catalog import parse_fmhy_markdown


def test_catalog_store_persists_snapshot_entries_and_domain_index(tmp_path) -> None:
    store = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    store.initialize()
    entries = parse_fmhy_markdown(
        "video.md",
        "* 🌟 [Example](https://example.com/) or [Mirror](https://mirror.example/) - Movies\\n",
    )
    result = store.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="fixture", source_count=1,
    )
    assert result["entry_count"] == 1
    assert result["link_count"] == 2
    assert result["unique_domain_count"] == 2
    snapshot = store.latest_snapshot()
    assert snapshot is not None
    listed = store.list_entries(snapshot_id=result["snapshot_id"])
    assert listed[0]["title"] == "Example"
    assert len(listed[0]["links"]) == 2
    domains = store.list_domains(snapshot_id=result["snapshot_id"])
    assert {item["domain"] for item in domains} == {"example.com", "mirror.example"}


def test_catalog_store_hides_unsafe_entries_by_default(tmp_path) -> None:
    store = CatalogStore(str(tmp_path / "catalog.sqlite3"))
    store.initialize()
    entries = parse_fmhy_markdown("unsafe.md", "* [Unsafe](https://unsafe.example/) - flagged\\n")
    result = store.import_snapshot(
        entries, source_repository="fmhy/edit", source_branch="main",
        source_revision="fixture", source_count=1,
    )
    assert store.list_entries(snapshot_id=result["snapshot_id"]) == []
    assert len(store.list_entries(snapshot_id=result["snapshot_id"], include_unsafe=True)) == 1
