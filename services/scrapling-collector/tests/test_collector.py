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

    def test_browser_request_guard_blocks_private_and_non_https_requests(self):
        class Request:
            def __init__(self, url):
                self.url = url

        class Route:
            def __init__(self, url):
                self.request = Request(url)
                self.aborted = False
                self.continued = False

            def abort(self):
                self.aborted = True

            def continue_(self):
                self.continued = True

        class Page:
            def route(self, pattern, handler):
                self.pattern = pattern
                self.handler = handler

        page = Page()
        collector.install_browser_request_guard(page)
        self.assertEqual(page.pattern, "**/*")

        private_route = Route("https://internal.example/admin")
        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("10.0.0.8", 443))
        ]):
            page.handler(private_route)
        self.assertTrue(private_route.aborted)
        self.assertFalse(private_route.continued)

        http_route = Route("http://public.example/video")
        page.handler(http_route)
        self.assertTrue(http_route.aborted)

    def test_browser_request_guard_allows_public_https_requests(self):
        class Request:
            url = "https://media.example/video/master.m3u8"

        class Route:
            request = Request()
            continued = False
            aborted = False

            def abort(self):
                self.aborted = True

            def continue_(self):
                self.continued = True

        class Page:
            def route(self, pattern, handler):
                self.handler = handler

        page = Page()
        collector.install_browser_request_guard(page)
        route = Route()
        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]):
            page.handler(route)
        self.assertTrue(route.continued)
        self.assertFalse(route.aborted)

    def test_direct_media_probe_uses_range_and_accepts_media_response(self):
        class Response:
            status = 206

            def getheaders(self):
                return [
                    ("Content-Type", "video/mp4"),
                    ("Content-Length", "1024"),
                    ("Content-Range", "bytes 0-0/1024"),
                ]

            def close(self):
                pass

        class Connection:
            last_request = None

            def __init__(self, *args, **kwargs):
                pass

            def request(self, method, target, headers):
                Connection.last_request = (method, target, headers)

            def getresponse(self):
                return Response()

            def close(self):
                pass

        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]), patch.object(collector.http.client, "HTTPSConnection", Connection):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertTrue(result["reachable"])
        self.assertEqual(result["http_status"], 206)
        self.assertTrue(result["range_supported"])
        self.assertEqual(Connection.last_request[0], "GET")
        self.assertEqual(Connection.last_request[2]["Range"], "bytes=0-0")

    def test_direct_media_probe_rejects_private_redirect(self):
        class Response:
            status = 302

            def getheaders(self):
                return [("Location", "http://127.0.0.1/admin")]

            def close(self):
                pass

        class Connection:
            def __init__(self, *args, **kwargs):
                pass

            def request(self, *args, **kwargs):
                pass

            def getresponse(self):
                return Response()

            def close(self):
                pass

        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]), patch.object(collector.http.client, "HTTPSConnection", Connection):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["error"], "unsafe_or_invalid_redirect_target")

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
