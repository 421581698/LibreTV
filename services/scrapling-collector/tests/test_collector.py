import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SCRAPLING_API_TOKEN", "collector-test-token")
os.environ.setdefault("SCRAPLING_DB_PATH", str(Path(tempfile.gettempdir()) / "libretv-scrapling-tests.sqlite3"))

import app as collector


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        collector.DB_PATH = Path(self.temp.name) / "collector.sqlite3"
        collector.init_db()

    def tearDown(self):
        self.temp.cleanup()

    def test_classifies_direct_media(self):
        self.assertEqual(
            collector.classify_url("https://media.example/video/master.m3u8"),
            ("direct-media", "media.example"),
        )

    def test_classifies_cms_api(self):
        self.assertEqual(
            collector.classify_url("https://catalog.example/api.php/provide/vod"),
            ("cms-api-candidate", "catalog.example"),
        )

    def test_rejects_non_https_and_credentials(self):
        self.assertIsNone(collector.classify_url("http://media.example/movie.mp4"))
        self.assertIsNone(collector.classify_url("https://user:pass@media.example/movie.mp4"))

    def test_public_https_url_rejects_malformed_port(self):
        with self.assertRaises(collector.HTTPException) as error:
            collector.public_https_url("https://media.example:not-a-port/watch")
        self.assertEqual(error.exception.status_code, 400)

    @patch.object(collector.socket, "getaddrinfo")
    def test_public_https_url_rejects_nonstandard_port(self, getaddrinfo):
        with self.assertRaises(collector.HTTPException) as error:
            collector.public_https_url("https://media.example:8443/watch")
        self.assertEqual(error.exception.status_code, 400)
        getaddrinfo.assert_not_called()

    @patch.object(collector.socket, "getaddrinfo")
    def test_public_https_url_accepts_public_dns(self, getaddrinfo):
        getaddrinfo.return_value = [(None, None, None, None, ("8.8.8.8", 443))]
        url, host = collector.public_https_url("https://media.example/watch")
        self.assertEqual(url, "https://media.example/watch")
        self.assertEqual(host, "media.example")

    @patch.object(collector.socket, "getaddrinfo")
    def test_public_https_url_blocks_private_dns(self, getaddrinfo):
        getaddrinfo.return_value = [(None, None, None, None, ("127.0.0.1", 443))]
        with self.assertRaises(collector.HTTPException):
            collector.public_https_url("https://internal.example/")

    def test_authorization_is_constant_time_checked(self):
        collector.require_token(f"Bearer {collector.TOKEN}")
        with self.assertRaises(collector.HTTPException):
            collector.require_token("Bearer wrong-token")

    def test_task_and_candidate_records_persist(self):
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                ("a" * 32, "https://catalog.example", "catalog.example", "completed", "http", 1, 1),
            )
            connection.execute(
                """INSERT INTO candidates(id,task_id,url,host,kind,title,status,created_at)
                   VALUES(?,?,?,?,?,?,?,?)""",
                ("b" * 32, "a" * 32, "https://catalog.example/api.php/provide/vod",
                 "catalog.example", "cms-api-candidate", "Catalog", "pending", 1),
            )
        with collector.db() as connection:
            task = connection.execute("SELECT status FROM tasks WHERE id=?", ("a" * 32,)).fetchone()
            candidate = connection.execute("SELECT kind FROM candidates WHERE id=?", ("b" * 32,)).fetchone()
        self.assertEqual(task["status"], "completed")
        self.assertEqual(candidate["kind"], "cms-api-candidate")


if __name__ == "__main__":
    unittest.main()
