from __future__ import annotations

import json
import sqlite3
from contextlib import closing
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.fmhy_catalog import CatalogEntry


class CatalogStore:
    """Persistent, versioned local index of FMHY entries and normalized domains."""

    def __init__(self, database_path: str) -> None:
        self.database_path = Path(database_path).expanduser().resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def initialize(self) -> None:
        with closing(self._connect()) as connection, connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS catalog_snapshots (
                    snapshot_id TEXT PRIMARY KEY, source_repository TEXT NOT NULL,
                    source_branch TEXT NOT NULL, source_revision TEXT NOT NULL,
                    imported_at TEXT NOT NULL, source_count INTEGER NOT NULL,
                    entry_count INTEGER NOT NULL, link_count INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS catalog_entries (
                    entry_id TEXT NOT NULL,
                    snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id),
                    title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
                    section_path TEXT NOT NULL, source_file TEXT NOT NULL,
                    source_line INTEGER NOT NULL, marker TEXT, safety_status TEXT NOT NULL,
                    raw_line TEXT NOT NULL, PRIMARY KEY (snapshot_id, entry_id)
                );
                CREATE TABLE IF NOT EXISTS catalog_domains (
                    domain TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS catalog_links (
                    link_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, entry_id TEXT NOT NULL,
                    label TEXT NOT NULL, original_url TEXT NOT NULL, canonical_url TEXT NOT NULL,
                    domain TEXT NOT NULL REFERENCES catalog_domains(domain), role TEXT NOT NULL,
                    is_primary INTEGER NOT NULL, link_order INTEGER NOT NULL,
                    PRIMARY KEY (snapshot_id, link_id),
                    FOREIGN KEY (snapshot_id, entry_id)
                      REFERENCES catalog_entries(snapshot_id, entry_id)
                );
                CREATE INDEX IF NOT EXISTS idx_catalog_entries_category
                  ON catalog_entries(snapshot_id, category);
                CREATE INDEX IF NOT EXISTS idx_catalog_links_domain
                  ON catalog_links(snapshot_id, domain);
            """)

    def import_snapshot(
        self, entries: list[CatalogEntry], *, source_repository: str,
        source_branch: str, source_revision: str, source_count: int,
    ) -> dict:
        snapshot_id = uuid.uuid4().hex
        imported_at = datetime.now(UTC).isoformat()
        link_count = sum(len(entry.links) for entry in entries)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT INTO catalog_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (snapshot_id, source_repository, source_branch, source_revision,
                 imported_at, source_count, len(entries), link_count),
            )
            for entry in entries:
                connection.execute(
                    "INSERT INTO catalog_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (entry.entry_id, snapshot_id, entry.title, entry.description,
                     entry.category, json.dumps(entry.section_path, ensure_ascii=False),
                     entry.source_file, entry.source_line, entry.marker,
                     entry.safety_status, entry.raw_line),
                )
                for link in entry.links:
                    connection.execute("""
                        INSERT INTO catalog_domains (domain, first_seen_at, last_seen_at)
                        VALUES (?, ?, ?)
                        ON CONFLICT(domain) DO UPDATE SET last_seen_at = excluded.last_seen_at
                    """, (link.domain, imported_at, imported_at))
                    link_id = f"{entry.entry_id}:{link.order}:{link.canonical_url}"
                    connection.execute(
                        "INSERT INTO catalog_links VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (link_id, snapshot_id, entry.entry_id, link.label,
                         link.original_url, link.canonical_url, link.domain,
                         link.role, int(link.is_primary), link.order),
                    )
        return {
            "snapshot_id": snapshot_id, "imported_at": imported_at,
            "source_count": source_count, "entry_count": len(entries),
            "link_count": link_count, "unique_domain_count": self.count_domains(snapshot_id),
        }

    def latest_snapshot(self) -> dict | None:
        with self._connect() as connection:
            row = connection.execute("""
                SELECT snapshot_id, source_repository, source_branch, source_revision,
                       imported_at, source_count, entry_count, link_count
                FROM catalog_snapshots ORDER BY imported_at DESC LIMIT 1
            """).fetchone()
        return dict(row) if row else None

    def count_domains(self, snapshot_id: str | None = None) -> int:
        with self._connect() as connection:
            if snapshot_id:
                row = connection.execute(
                    "SELECT COUNT(DISTINCT domain) AS total FROM catalog_links WHERE snapshot_id = ?",
                    (snapshot_id,),
                ).fetchone()
            else:
                row = connection.execute("SELECT COUNT(*) AS total FROM catalog_domains").fetchone()
        return int(row["total"])

    def list_entries(
        self, *, snapshot_id: str, category: str | None = None,
        query: str | None = None, limit: int = 50, offset: int = 0,
        include_unsafe: bool = False,
    ) -> list[dict]:
        clauses = ["e.snapshot_id = ?"]
        parameters: list[object] = [snapshot_id]
        if category:
            clauses.append("e.category = ?")
            parameters.append(category)
        if query:
            clauses.append("(e.title LIKE ? OR e.description LIKE ? OR l.domain LIKE ?)")
            needle = f"%{query}%"
            parameters.extend([needle, needle, needle])
        if not include_unsafe:
            clauses.append("e.safety_status != 'flagged_unsafe'")
        sql = f"""
            SELECT DISTINCT e.entry_id, e.title, e.description, e.category,
                e.section_path, e.source_file, e.source_line, e.marker, e.safety_status
            FROM catalog_entries e
            LEFT JOIN catalog_links l
              ON l.snapshot_id = e.snapshot_id AND l.entry_id = e.entry_id
            WHERE {" AND ".join(clauses)}
            ORDER BY e.category, e.source_file, e.source_line LIMIT ? OFFSET ?
        """
        parameters.extend([max(1, min(limit, 100)), max(0, offset)])
        with self._connect() as connection:
            rows = connection.execute(sql, parameters).fetchall()
            results = []
            for row in rows:
                item = dict(row)
                item["section_path"] = json.loads(item["section_path"])
                links = connection.execute("""
                    SELECT label, original_url, canonical_url, domain, role,
                           is_primary, link_order
                    FROM catalog_links WHERE snapshot_id = ? AND entry_id = ?
                    ORDER BY link_order
                """, (snapshot_id, item["entry_id"])).fetchall()
                item["links"] = [dict(link) for link in links]
                results.append(item)
        return results

    def list_domains(
        self, *, snapshot_id: str, query: str | None = None,
        limit: int = 100, offset: int = 0, include_unsafe: bool = False,
    ) -> list[dict]:
        clauses = ["l.snapshot_id = ?"]
        parameters: list[object] = [snapshot_id]
        if not include_unsafe:
            clauses.append("e.safety_status != 'flagged_unsafe'")
        if query:
            clauses.append("l.domain LIKE ?")
            parameters.append(f"%{query}%")
        sql = f"""
            SELECT l.domain, COUNT(DISTINCT l.entry_id) AS entry_count,
                   SUM(l.is_primary) AS primary_link_count,
                   GROUP_CONCAT(DISTINCT e.category) AS categories
            FROM catalog_links l
            JOIN catalog_entries e
              ON e.snapshot_id = l.snapshot_id AND e.entry_id = l.entry_id
            WHERE {" AND ".join(clauses)}
            GROUP BY l.domain ORDER BY primary_link_count DESC, l.domain
            LIMIT ? OFFSET ?
        """
        parameters.extend([max(1, min(limit, 500)), max(0, offset)])
        with self._connect() as connection:
            rows = connection.execute(sql, parameters).fetchall()
        return [dict(row) for row in rows]
