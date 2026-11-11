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

    def test_crawl_batch_defaults_to_250_and_requires_at_least_101(self):
        request = collector.CrawlRequest(url="https://catalog.example/")
        self.assertEqual(request.limit, 250)
        with self.assertRaises(Exception):
            collector.CrawlRequest(url="https://catalog.example/", limit=100)
        accepted = collector.CrawlRequest(url="https://catalog.example/", limit=101)
        self.assertEqual(accepted.limit, 101)

    def test_crawl_egress_gate_fails_closed_until_firewall_is_confirmed(self):
        with patch.dict(os.environ, {"SCRAPLING_EGRESS_FIREWALL_CONFIRMED": ""}):
            with self.assertRaises(collector.HTTPException) as error:
                collector.require_egress_firewall()
            self.assertEqual(error.exception.status_code, 503)
        with patch.dict(os.environ, {"SCRAPLING_EGRESS_FIREWALL_CONFIRMED": "1"}):
            collector.require_egress_firewall()

    def test_crawl_endpoint_path_fails_closed_before_network_access(self):
        with patch.dict(os.environ, {"SCRAPLING_EGRESS_FIREWALL_CONFIRMED": ""}):
            with self.assertRaises(collector.HTTPException) as error:
                collector.crawl_site(collector.CrawlRequest(url="https://example.com"))
            self.assertEqual(error.exception.status_code, 503)

    def test_discovery_endpoint_fails_closed_before_network_access(self):
        with patch.dict(os.environ, {"SCRAPLING_EGRESS_FIREWALL_CONFIRMED": ""}):
            with patch.object(collector, "require_token"), patch.object(collector, "discover_sites") as discover_sites:
                with self.assertRaises(collector.HTTPException) as error:
                    collector.discover("Bearer test")
        self.assertEqual(error.exception.status_code, 503)
        discover_sites.assert_not_called()

    def test_candidate_validation_fails_closed_before_database_lookup(self):
        with patch.dict(os.environ, {"SCRAPLING_EGRESS_FIREWALL_CONFIRMED": ""}):
            with patch.object(collector, "require_token"):
                with self.assertRaises(collector.HTTPException) as error:
                    collector.validate_candidate("candidate-does-not-exist")
            self.assertEqual(error.exception.status_code, 503)

    def test_playback_evidence_is_persisted_only_after_public_media_preflight(self):
        task_id = "a" * 32
        candidate_id = "b" * 32
        now = 1_800_000_000
        validation = {
            "reachable": True,
            "media_format": "progressive",
            "access": {"access_state": "PUBLIC"},
        }
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://media.example/movie.mp4", "media.example", "completed", "http", now, now),
            )
            connection.execute(
                """INSERT INTO candidates
                   (id,task_id,url,host,kind,title,status,created_at,access_state,validation)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (candidate_id, task_id, "https://media.example/movie.mp4", "media.example",
                 "direct-media", "Test movie", "validated", now, "PUBLIC",
                 collector.json.dumps(validation)),
            )
        with patch.object(collector, "require_token"):
            result = collector.record_playback_evidence(
                candidate_id,
                collector.PlaybackEvidence(
                    media_type="mp4", observed_seconds=5, progressed_seconds=3.2
                ),
                "Bearer test",
            )
        self.assertEqual(result["playback_verification"]["state"], "PLAYER_CONFIRMED")
        with collector.db() as connection:
            stored = connection.execute(
                "SELECT playback_verification FROM candidates WHERE id=?", (candidate_id,)
            ).fetchone()["playback_verification"]
        self.assertEqual(collector.json.loads(stored)["media_type"], "mp4")
        with collector.db() as connection:
            sample = connection.execute(
                "SELECT host,sample_source,decoded_width,decoded_height FROM playback_quality_samples"
            ).fetchone()
        self.assertEqual(sample["host"], "media.example")
        self.assertEqual(sample["sample_source"], "collector_preview")
        self.assertEqual(sample["decoded_width"], 0)

    def test_general_playback_sample_only_records_fmhy_discovered_hosts(self):
        now = 1_800_000_000
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO sites(host,title,url,directory,discovered_at) VALUES(?,?,?,?,?)",
                ("media.example", "Media", "https://media.example", "FMHY / Movies", now),
            )
        payload = collector.PlaybackSampleEvidence(
            host="media.example", media_type="hls", observed_seconds=5,
            progressed_seconds=4, decoded_width=1920, decoded_height=1080,
            selected_rendition_height=1080, selected_rendition_bitrate_kbps=5000,
        )
        with patch.object(collector, "require_token"):
            result = collector.record_general_playback_sample(payload, "Bearer test")
            ignored = collector.record_general_playback_sample(
                payload.copy(update={"host": "not-listed.example"}), "Bearer test"
            )
        self.assertTrue(result["recorded"])
        self.assertFalse(ignored["recorded"])
        with collector.db() as connection:
            samples = connection.execute(
                "SELECT host,sample_source,decoded_height FROM playback_quality_samples"
            ).fetchall()
        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0]["host"], "media.example")
        self.assertEqual(samples[0]["sample_source"], "player")
        self.assertEqual(samples[0]["decoded_height"], 1080)

    def test_playback_evidence_rejects_candidates_without_preflight(self):
        task_id = "c" * 32
        candidate_id = "d" * 32
        now = 1_800_000_000
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://media.example/movie.mp4", "media.example", "completed", "http", now, now),
            )
            connection.execute(
                """INSERT INTO candidates
                   (id,task_id,url,host,kind,title,status,created_at,access_state,validation)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (candidate_id, task_id, "https://media.example/movie.mp4", "media.example",
                 "direct-media", "Test movie", "pending", now, "PUBLIC",
                 collector.json.dumps({"reachable": True, "access": {"access_state": "PUBLIC"}})),
            )
        with patch.object(collector, "require_token"):
            with self.assertRaises(collector.HTTPException) as error:
                collector.record_playback_evidence(
                    candidate_id,
                    collector.PlaybackEvidence(
                        media_type="mp4", observed_seconds=5, progressed_seconds=3.2
                    ),
                    "Bearer test",
                )
        self.assertEqual(error.exception.status_code, 409)

    def test_page_fingerprint_detects_first_change_and_skips_unchanged_content(self):
        first = collector.record_page_fingerprint("catalog.example", "https://catalog.example/movies", b"<html>one</html>")
        unchanged = collector.record_page_fingerprint("catalog.example", "https://catalog.example/movies", b"<html>one</html>")
        changed = collector.record_page_fingerprint("catalog.example", "https://catalog.example/movies", b"<html>two</html>")
        self.assertTrue(first)
        self.assertFalse(unchanged)
        self.assertTrue(changed)
        with collector.db() as connection:
            row = connection.execute(
                "SELECT visit_count FROM crawl_page_fingerprints WHERE host=?",
                ("catalog.example",),
            ).fetchone()
        self.assertEqual(row["visit_count"], 3)

    def test_fingerprint_change_check_does_not_commit_before_extraction(self):
        changed = collector.page_fingerprint_changed(
            "catalog.example", "https://catalog.example/movies", b"<html>new</html>"
        )
        self.assertTrue(changed)
        with collector.db() as connection:
            row = connection.execute(
                "SELECT fingerprint FROM crawl_page_fingerprints WHERE host=?",
                ("catalog.example",),
            ).fetchone()
        self.assertIsNone(row)
        collector.record_page_fingerprint(
            "catalog.example", "https://catalog.example/movies", b"<html>new</html>"
        )
        self.assertFalse(collector.page_fingerprint_changed(
            "catalog.example", "https://catalog.example/movies", b"<html>new</html>"
        ))

    def test_spider_http_session_uses_safe_redirect_policy(self):
        captured = {}

        class Manager:
            def add(self, session_id, session, default=False, lazy=False):
                captured["session_id"] = session_id
                captured["session"] = session

        with patch.object(collector, "FetcherSession") as fetcher_session:
            collector.SiteSpider().configure_sessions(Manager())
        self.assertGreaterEqual(fetcher_session.call_count, 1)
        self.assertTrue(all(call.kwargs == {"follow_redirects": "safe"} for call in fetcher_session.call_args_list))
        self.assertEqual(captured["session_id"], "default")
        self.assertIs(captured["session"], fetcher_session.return_value)

    def test_run_spider_deduplicates_candidates_and_respects_result_limit(self):
        items = [
            {"url": "https://catalog.example/a.mp4", "kind": "direct-media", "host": "catalog.example"},
            {"url": "https://catalog.example/a.mp4", "kind": "direct-media", "host": "catalog.example"},
            {"url": "https://catalog.example/b.m3u8", "kind": "direct-media", "host": "catalog.example"},
        ]
        with patch.object(collector.SiteSpider, "start", return_value=type("Result", (), {"items": items})()):
            result = collector.run_spider("https://catalog.example/start", limit=5)
        self.assertEqual(len(result), 2)
        self.assertEqual([item["url"] for item in result], ["https://catalog.example/a.mp4", "https://catalog.example/b.m3u8"])

    def test_browser_capture_installs_request_guard_and_deduplicates_network_candidates(self):
        page = object()
        http_candidate = {"url": "https://media.example/a.mp4", "kind": "direct-media", "host": "media.example"}
        duplicate = dict(http_candidate)
        api_candidate = {"url": "https://catalog.example/api.php/provide/vod", "kind": "cms-api-candidate", "host": "catalog.example"}
        class FakeSession:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def fetch(self, url, **kwargs):
                self.fetch_args = (url, kwargs)
                return page
        session = FakeSession()
        with (
            patch.object(collector, "StealthySession", return_value=session),
            patch.object(collector, "extract_candidates", return_value=[http_candidate]),
            patch.object(collector, "captured_api_candidates", return_value=[duplicate, api_candidate]),
        ):
            captured_page, candidates, diagnostics = collector.run_browser_capture("https://catalog.example/", 5)
        self.assertIs(captured_page, page)
        self.assertIn("final_url", diagnostics)
        self.assertIn("captured_request_count", diagnostics)
        self.assertEqual([item["url"] for item in candidates], [http_candidate["url"], api_candidate["url"]])
        self.assertTrue(session.fetch_args[1]["network_idle"])
        self.assertIs(session.fetch_args[1]["page_setup"], collector.install_browser_request_guard)

    def test_retry_endpoint_replays_stored_url_and_mode_with_bounded_limit(self):
        task_id = "c" * 32
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://catalog.example/start", "catalog.example", "failed", "http", 1, 1),
            )
        expected = {"task_id": "d" * 32, "status": "completed"}
        with patch.object(collector, "require_token"), patch.object(collector, "crawl_site", return_value=expected) as crawl:
            result = collector.retry_task(task_id, "Bearer test")
        self.assertEqual(result, expected)
        request = crawl.call_args.args[0]
        self.assertEqual(str(request.url), "https://catalog.example/start")
        self.assertEqual(request.mode, "http")
        self.assertEqual(request.limit, collector.MAX_CANDIDATES)

    def test_retry_endpoint_rejects_non_retryable_task_state(self):
        task_id = "e" * 32
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://catalog.example/start", "catalog.example", "completed", "http", 1, 1),
            )
        with patch.object(collector, "require_token"), patch.object(collector, "crawl_site") as crawl:
            with self.assertRaises(collector.HTTPException) as error:
                collector.retry_task(task_id, "Bearer test")
        self.assertEqual(error.exception.status_code, 409)
        crawl.assert_not_called()

    def test_access_state_classifies_auth_subscription_and_drm_signals(self):
        self.assertEqual(
            collector.classify_access_state(401)["access_state"], "AUTH_REQUIRED"
        )
        self.assertEqual(
            collector.classify_access_state(402)["access_state"], "SUBSCRIPTION_REQUIRED"
        )
        challenge = collector.classify_access_state(
            403, {"content-type": "text/html"},
            "<html>Checking your browser before accessing this site. cf-chl-123</html>",
        )
        self.assertEqual(challenge["access_state"], "CHALLENGE")
        drm = collector.classify_access_state(
            200, {"content-type": "application/vnd.apple.mpegurl"},
            "#EXTM3U\\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\\\"skd://asset\\\"",
        )
        self.assertEqual(drm["access_state"], "DRM_PROTECTED")
        self.assertIn("FairPlay", drm["drm_systems"])

    def test_access_state_defaults_to_public_without_protection_signals(self):
        result = collector.classify_access_state(200, {"content-type": "video/mp4"}, "", "https://media.example/movie.mp4")
        self.assertEqual(result["access_state"], "PUBLIC")

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

    def test_http_candidate_extractor_finds_public_player_attributes_and_inline_config(self):
        class Element:
            def __init__(self, attrib=None, text=""):
                self.attrib = attrib or {}
                self.text = text

        class Title:
            def get(self):
                return "Public movie catalogue"

        class Page:
            url = "https://catalog.example/watch/123"

            def css(self, selector, **kwargs):
                if selector == "title::text":
                    return Title()
                if selector == "[data-src], [data-url], [data-play], [content], [data-config], [data-player]":
                    return [
                        Element({"data-src": "https://cdn.example/movie/master.m3u8"}),
                        Element({"data-src": "/movie/relative.m3u8"}),
                        Element({"data-config": '{"url":"https://cdn.example/movie/backup.mp4"}'}),
                    ]
                if selector == "script":
                    return [Element(text='const player = { file: "/movie/inline.m3u8" };')]
                return []

        found = collector.extract_candidates(Page(), Page.url, 20)
        urls = {item["url"] for item in found}
        self.assertIn("https://cdn.example/movie/master.m3u8", urls)
        self.assertIn("https://cdn.example/movie/backup.mp4", urls)
        self.assertIn("https://catalog.example/movie/inline.m3u8", urls)
        self.assertIn("https://catalog.example/movie/relative.m3u8", urls)
        self.assertEqual({item["host"] for item in found}, {"cdn.example", "catalog.example"})

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
    def test_public_https_url_blocks_private_ip_literal_without_dns(self, getaddrinfo):
        with self.assertRaises(collector.HTTPException):
            collector.public_https_url("https://127.0.0.1/private")
        getaddrinfo.assert_not_called()

    @patch.object(collector.socket, "getaddrinfo")
    def test_public_https_url_blocks_private_dns(self, getaddrinfo):
        getaddrinfo.return_value = [(None, None, None, None, ("127.0.0.1", 443))]
        with self.assertRaises(collector.HTTPException):
            collector.public_https_url("https://internal.example/")

    def test_resolver_rejects_mixed_public_and_private_dns_answers(self):
        answers = [
            (None, None, None, None, ("8.8.8.8", 443)),
            (None, None, None, None, ("10.0.0.7", 443)),
        ]
        with patch.object(collector.socket, "getaddrinfo", return_value=answers):
            with self.assertRaises(collector.HTTPException):
                collector.resolve_public_addresses("mixed.example")

    def test_pinned_https_connection_connects_ip_without_dns_and_keeps_tls_hostname(self):
        class FakeSocket:
            def __init__(self):
                self.connected = None
                self.timeout = None
                self.closed = False

            def settimeout(self, value):
                self.timeout = value

            def connect(self, address):
                self.connected = address

            def close(self):
                self.closed = True

        fake_socket = FakeSocket()
        tls_socket = object()
        context = unittest.mock.Mock()
        context.wrap_socket.return_value = tls_socket
        connection = collector.PinnedHTTPSConnection(
            "media.example", "8.8.8.8", timeout=5, context=context
        )
        with patch.object(collector.socket, "socket", return_value=fake_socket), patch.object(collector.socket, "getaddrinfo", side_effect=AssertionError("DNS lookup after pinning")):
            connection.connect()
        self.assertEqual(fake_socket.connected, ("8.8.8.8", 443))
        context.wrap_socket.assert_called_once_with(fake_socket, server_hostname="media.example")
        self.assertIs(connection.sock, tls_socket)

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
                    ("Content-Range", "bytes 0-1023/1024"),
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
        ]), patch.object(collector, "PinnedHTTPSConnection", Connection):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertTrue(result["reachable"])
        self.assertEqual(result["http_status"], 206)
        self.assertTrue(result["range_supported"])
        self.assertEqual(Connection.last_request[0], "GET")
        self.assertEqual(Connection.last_request[2]["Range"], "bytes=0-1048575")

    def test_hls_probe_fetches_full_bounded_manifest_without_range(self):
        class Response:
            status = 200

            def getheaders(self):
                return [("Content-Type", "application/vnd.apple.mpegurl")]

            def read(self, size):
                self.read_size = size
                return b"#EXTM3U\n#EXTINF:5,\nsegment.ts\n"

            def close(self):
                pass

        class Connection:
            last_headers = None

            def __init__(self, *args, **kwargs):
                pass

            def request(self, method, target, headers):
                Connection.last_headers = headers

            def getresponse(self):
                return Response()

            def close(self):
                pass

        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]), patch.object(collector, "PinnedHTTPSConnection", Connection):
            result = collector.probe_direct_media("https://media.example/master.m3u8")
        self.assertTrue(result["reachable"])
        self.assertEqual(result["media_format"], "hls")
        self.assertNotIn("Range", Connection.last_headers)

    def test_direct_media_probe_rejects_dns_rebinding_redirect_before_second_connection(self):
        class Response:
            status = 302
            def getheaders(self):
                return [("Location", "https://internal.example/admin")]
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
        public = [(None, None, None, None, ("8.8.8.8", 443))]
        private = [(None, None, None, None, ("10.0.0.7", 443))]
        with (
            patch.object(collector.socket, "getaddrinfo", side_effect=[public, public, private]),
            patch.object(collector, "PinnedHTTPSConnection", side_effect=Connection) as connection,
        ):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["error"], "unsafe_or_invalid_redirect_target")
        connection.assert_called_once()

    def test_direct_media_probe_rejects_dns_change_between_validation_and_connect(self):
        public = [(None, None, None, None, ("8.8.8.8", 443))]
        private = [(None, None, None, None, ("127.0.0.1", 443))]
        with (
            patch.object(collector.socket, "getaddrinfo", side_effect=[public, private]),
            patch.object(collector, "PinnedHTTPSConnection") as connection,
        ):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["error"], "unsafe_or_invalid_redirect_target")
        connection.assert_not_called()

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
        ]), patch.object(collector, "PinnedHTTPSConnection", Connection):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["error"], "unsafe_or_invalid_redirect_target")

    def test_hls_master_playlist_extracts_resolutions_and_bandwidth(self):
        body = b"""#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720
720/index.m3u8
"""
        result = collector.parse_hls_manifest(body)
        self.assertTrue(result["manifest_valid"])
        self.assertTrue(result["is_master_playlist"])
        self.assertEqual(result["variant_count"], 2)
        self.assertEqual(result["variants"][0]["height"], 1080)
        self.assertEqual(result["variants"][0]["bandwidth"], 2800000)

    def test_hls_parser_keeps_variant_uri_and_encryption_metadata_only(self):
        body = b"""#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
video/1080.m3u8
#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/secret"
#EXTINF:6,
segment-1.ts
"""
        result = collector.parse_hls_manifest(body)
        self.assertEqual(result["variants"][0]["uri"], "video/1080.m3u8")
        self.assertEqual(result["variants"][0]["codecs"], "avc1.640028,mp4a.40.2")
        self.assertTrue(result["encrypted"])
        self.assertTrue(result["key_uri_present"])
        self.assertNotIn("secret", str(result))
        self.assertEqual(result["segment_uris"], ["segment-1.ts"])

    def test_hls_reference_validation_resolves_and_rejects_unsafe_urls(self):
        manifest = {
            "variants": [{"uri": "../master/720.m3u8", "height": 720}],
            "variant_count": 1,
            "segment_uris": ["segments/1.ts", "http://127.0.0.1/admin"],
            "segment_count": 2,
        }
        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]):
            result = collector.validate_manifest_references(
                manifest, "https://media.example/hls/index.m3u8"
            )
        self.assertEqual(result["variants"][0]["uri"], "https://media.example/master/720.m3u8")
        self.assertEqual(result["segment_uris"], ["https://media.example/hls/segments/1.ts"])
        self.assertEqual(result["rejected_reference_count"], 1)

    def test_hls_media_playlist_counts_segments_and_duration(self):
        body = b"""#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:5.5,
segment-1.ts
#EXTINF:4.5,
segment-2.ts
#EXT-X-ENDLIST
"""
        result = collector.parse_hls_manifest(body)
        self.assertTrue(result["manifest_valid"])
        self.assertFalse(result["is_master_playlist"])
        self.assertEqual(result["segment_count"], 2)
        self.assertEqual(result["duration_seconds"], 10.0)

    def test_mpd_manifest_extracts_representation_quality(self):
        body = b"""<?xml version="1.0"?>
<MPD type="static"><Period><AdaptationSet>
<Representation id="v1080" width="1920" height="1080" bandwidth="5000000" codecs="avc1"/>
</AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body)
        self.assertTrue(result["manifest_valid"])
        self.assertEqual(result["manifest_type"], "dash")
        self.assertEqual(result["representations"][0]["height"], 1080)
        self.assertEqual(result["representations"][0]["bandwidth"], 5000000)

    def test_mpd_manifest_rejects_empty_periods_without_representations(self):
        result = collector.parse_mpd_manifest(
            b"<MPD><Period><AdaptationSet/></Period></MPD>",
            "https://cdn.example/manifest.mpd",
        )
        self.assertFalse(result["manifest_valid"])
        self.assertEqual(result["manifest_error"], "missing_representations")

    def test_mpd_manifest_rejects_doctype_and_entities(self):
        body = b"""<!DOCTYPE MPD [<!ENTITY x "expanded">]>
<MPD><Period><AdaptationSet><Representation id="&x;"/></AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/manifest.mpd")
        self.assertFalse(result["manifest_valid"])
        self.assertEqual(result["manifest_error"], "doctype_or_entity_blocked")

    def test_hls_master_tree_rejects_empty_media_playlist(self):
        root = {"variants": [{"uri": "https://media.example/empty.m3u8"}]}
        empty_playlist = {
            "reachable": True,
            "media_format": "hls",
            "manifest_valid": True,
            "is_master_playlist": False,
            "segment_uris": [],
            "segment_count": 0,
        }
        with patch.object(collector, "public_https_url", return_value=("https://media.example/empty.m3u8", "media.example")), \
             patch.object(collector, "throttle"), \
             patch.object(collector, "probe_direct_media", return_value=empty_playlist):
            result = collector.probe_hls_variant_tree(root, max_requests=2)
        self.assertEqual(result["reachable_leaf_count"], 0)
        self.assertTrue(result["results"][0]["empty_media_playlist"])
        self.assertFalse(result["results"][0]["leaf_reachable"])

    def test_dash_duration_and_template_expansion_are_bounded(self):
        self.assertIsNone(collector.parse_iso8601_duration_seconds("P"))
        self.assertIsNone(collector.parse_iso8601_duration_seconds("PT"))
        self.assertEqual(collector.parse_iso8601_duration_seconds("P1DT2H3M4S"), 93784)
        expanded = collector.expand_dash_template(
            "$/$RepresentationID$/$Bandwidth$/$Number%05d$/$Time%0999999999d$",
            {"id": "v1", "bandwidth": 800000}, 7, 12,
        )
        self.assertEqual(expanded, "$/v1/800000/00007/" + ("0" * 18) + "12")

    def test_mpd_manifest_resolves_base_url_and_segment_template(self):
        body = b"""<MPD type="static">
<BaseURL>https://cdn.example/root/</BaseURL>
<Period><AdaptationSet>
<SegmentTemplate media="video/$RepresentationID$/$Number$.m4s"
 initialization="init/$RepresentationID$.mp4" startNumber="1"/>
<Representation id="v1080" width="1920" height="1080" bandwidth="5000000"/>
</AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://origin.example/manifest.mpd")
        self.assertTrue(result["manifest_valid"])
        self.assertEqual(result["representations"][0]["base_url"], "https://cdn.example/root/")
        self.assertEqual(
            result["representations"][0]["segment_template"]["media"],
            "https://cdn.example/root/video/$RepresentationID$/$Number$.m4s",
        )
        self.assertEqual(
            result["representations"][0]["segment_template"]["initialization"],
            "https://cdn.example/root/init/$RepresentationID$.mp4",
        )

    def test_mpd_segment_timeline_expands_bounded_static_segments(self):
        body = b"""<MPD type="static" mediaPresentationDuration="PT12S">
<Period><AdaptationSet><SegmentTemplate timescale="1" startNumber="7"
 media="video/$RepresentationID$/$Number%03d$-$Time$.m4s">
<SegmentTimeline><S t="0" d="4" r="2"/></SegmentTimeline>
</SegmentTemplate><Representation id="v1" bandwidth="900000"/></AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/manifest.mpd")
        timeline = result["representations"][0]["segment_timeline"]
        self.assertEqual([item["number"] for item in timeline], [7, 8, 9])
        self.assertEqual([item["time"] for item in timeline], [0, 4, 8])
        self.assertEqual(timeline[1]["url"], "https://cdn.example/video/v1/008-4.m4s")
        self.assertFalse(result["representations"][0]["segment_timeline_truncated"])

    def test_mpd_negative_repeat_uses_each_period_duration_boundary(self):
        body = b"""<MPD type="static" mediaPresentationDuration="PT20S"><Period start="PT0S">
<AdaptationSet><SegmentTemplate timescale="1" media="p1-$Number$-$Time$.m4s">
<SegmentTimeline><S t="0" d="4" r="-1"/></SegmentTimeline></SegmentTemplate>
<Representation id="v1"/></AdaptationSet></Period><Period start="PT10S"><AdaptationSet>
<SegmentTemplate timescale="1" media="p2-$Number$-$Time$.m4s">
<SegmentTimeline><S t="0" d="4" r="-1"/></SegmentTimeline></SegmentTemplate>
<Representation id="v2"/></AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/manifest.mpd")
        self.assertEqual(len(result["representations"][0]["segment_timeline"]), 3)
        self.assertEqual(len(result["representations"][1]["segment_timeline"]), 3)
        self.assertEqual(
            [item["time"] for item in result["representations"][1]["segment_timeline"]],
            [0, 4, 8],
        )

    def test_mpd_negative_repeat_stops_at_next_explicit_time(self):
        body = b"""<MPD type="static"><Period><AdaptationSet>
<SegmentTemplate timescale="1" media="segment-$Number$-$Time$.m4s">
<SegmentTimeline><S t="0" d="4" r="-1"/><S t="12" d="4"/></SegmentTimeline>
</SegmentTemplate><Representation id="v1"/></AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/manifest.mpd")
        timeline = result["representations"][0]["segment_timeline"]
        self.assertEqual([item["time"] for item in timeline], [0, 4, 8, 12])
        self.assertEqual([item["number"] for item in timeline], [1, 2, 3, 4])
        self.assertFalse(result["representations"][0]["segment_timeline_truncated"])

    def test_static_mpd_negative_repeat_without_duration_emits_no_guessed_urls(self):
        body = b"""<MPD type="static"><Period><AdaptationSet>
<SegmentTemplate timescale="1" media="segment-$Number$-$Time$.m4s">
<SegmentTimeline><S t="0" d="4" r="-1"/></SegmentTimeline>
</SegmentTemplate><Representation id="v1"/></AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/manifest.mpd")
        representation = result["representations"][0]
        self.assertEqual(representation["segment_timeline"], [])
        self.assertTrue(representation["timeline_requires_duration_boundary"])
        self.assertTrue(representation["segment_timeline_truncated"])

    def test_dash_duration_rejects_non_finite_and_zero_boundaries(self):
        self.assertIsNone(collector.parse_iso8601_duration_seconds("P" + ("9" * 400) + "D"))
        self.assertEqual(collector.parse_iso8601_duration_seconds("PT0S"), 0)

    def test_dynamic_mpd_defers_negative_repeat_until_live_edge_is_known(self):
        body = b"""<MPD type="dynamic" availabilityStartTime="2026-01-01T00:00:00Z"
 minimumUpdatePeriod="PT5S" timeShiftBufferDepth="PT12S"
 suggestedPresentationDelay="PT3S">
<Period><AdaptationSet><SegmentTemplate timescale="1" startNumber="1"
 media="live/$Number$-$Time$.m4s">
<SegmentTimeline><S t="100" d="4" r="-1"/></SegmentTimeline>
</SegmentTemplate><Representation id="live1" bandwidth="1000000"/></AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/live.mpd")
        timeline = result["representations"][0]["segment_timeline"]
        self.assertTrue(result["dynamic"])
        self.assertEqual(result["dynamic_metadata"]["minimum_update_period_seconds"], 5.0)
        self.assertEqual(result["dynamic_metadata"]["time_shift_buffer_depth_seconds"], 12.0)
        self.assertEqual(len(timeline), 0)
        self.assertTrue(result["representations"][0]["timeline_requires_live_edge"])
        self.assertTrue(result["representations"][0]["segment_timeline_truncated"])

    def test_mpd_segment_timeline_inherits_from_period_and_checks_urls(self):
        body = b"""<MPD type="static"><Period>
<SegmentTemplate timescale="1" media="segments/$Number$.m4s">
<SegmentTimeline><S t="0" d="5" r="1"/></SegmentTimeline></SegmentTemplate>
<AdaptationSet><Representation id="v1"/></AdaptationSet>
</Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/manifest.mpd")
        self.assertEqual(len(result["representations"][0]["segment_timeline"]), 2)
        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]):
            checked = collector.validate_manifest_references(result, "https://cdn.example/manifest.mpd")
        self.assertEqual(len(checked["representations"][0]["segment_timeline"]), 2)
        self.assertEqual(checked["rejected_reference_count"], 0)

    def test_mpd_manifest_extracts_segment_list_urls(self):
        body = b"""<MPD><Period><AdaptationSet>
<SegmentList><Initialization sourceURL="init.mp4"/>
<SegmentURL media="chunk-1.m4s"/><SegmentURL media="chunk-2.m4s"/></SegmentList>
<Representation id="v1" bandwidth="1000000"/>
</AdaptationSet></Period></MPD>"""
        result = collector.parse_mpd_manifest(body, "https://cdn.example/path/manifest.mpd")
        self.assertEqual(
            result["representations"][0]["segment_list"],
            [
                "https://cdn.example/path/init.mp4",
                "https://cdn.example/path/chunk-1.m4s",
                "https://cdn.example/path/chunk-2.m4s",
            ],
        )

    def test_mpd_reference_validation_rejects_private_base_and_keeps_public_template(self):
        manifest = {
            "manifest_valid": True,
            "manifest_type": "dash",
            "representations": [
                {
                    "id": "v1",
                    "base_url": "https://cdn.example/root/",
                    "segment_template": {"media": "https://cdn.example/root/$Number$.m4s"},
                    "segment_list": [],
                },
                {
                    "id": "v2",
                    "base_url": "https://127.0.0.1/private/",
                    "segment_template": {},
                    "segment_list": [],
                },
            ],
        }
        with patch.object(collector.socket, "getaddrinfo", return_value=[
            (None, None, None, None, ("8.8.8.8", 443))
        ]):
            result = collector.validate_manifest_references(manifest, "https://origin.example/manifest.mpd")
        self.assertEqual(result["representation_count"], 1)
        self.assertEqual(result["representations"][0]["id"], "v1")
        self.assertEqual(result["rejected_reference_count"], 1)

    def test_hls_master_variant_tree_checks_variant_and_segment_with_budget(self):
        root = {"variants": [{"uri": "https://media.example/variant.m3u8", "height": 1080}]}
        media_playlist = {
            "reachable": True,
            "media_format": "hls",
            "manifest_valid": True,
            "is_master_playlist": False,
            "segment_uris": ["https://media.example/segment-1.ts"],
            "segment_count": 1,
        }
        with patch.object(collector, "public_https_url", return_value=("https://media.example/variant.m3u8", "media.example")), \
             patch.object(collector, "throttle"), \
             patch.object(collector, "probe_direct_media", return_value=media_playlist) as probe, \
             patch.object(collector, "probe_hls_segments", return_value={
                 "sampled": 1, "reachable": 1, "failed": 0, "results": [{"reachable": True}]
             }) as segment_probe:
            result = collector.probe_hls_variant_tree(root, max_requests=2)
        self.assertEqual(result["reachable_leaf_count"], 1)
        self.assertEqual(result["request_count"], 2)
        self.assertEqual(probe.call_count, 1)
        segment_probe.assert_called_once()

    def test_hls_master_variant_tree_enforces_depth_limit(self):
        root = {"variants": [{"uri": "https://media.example/nested-master.m3u8"}]}
        nested_master = {
            "reachable": True,
            "media_format": "hls",
            "manifest_valid": True,
            "is_master_playlist": True,
            "variants": [{"uri": "https://media.example/deeper.m3u8"}],
        }
        with patch.object(collector, "public_https_url", return_value=("https://media.example/nested-master.m3u8", "media.example")), \
             patch.object(collector, "throttle"), \
             patch.object(collector, "probe_direct_media", return_value=nested_master) as probe:
            result = collector.probe_hls_variant_tree(root, max_depth=0, max_requests=4)
        self.assertEqual(result["reachable_leaf_count"], 0)
        self.assertTrue(result["results"][0]["depth_limit_reached"])
        probe.assert_called_once()

    def test_hls_segment_probe_samples_only_bounded_number(self):
        urls = [f"https://media.example/segment-{i}.ts" for i in range(8)]
        with patch.object(collector, "public_https_url", return_value=(urls[0], "media.example")), patch.object(collector, "throttle"), patch.object(collector, "probe_direct_media", return_value={"reachable": True, "http_status": 206, "content_type": "video/mp2t"}) as probe:
            result = collector.probe_hls_segments(urls, max_segments=2)
        self.assertEqual(result["sampled"], 2)
        self.assertEqual(result["reachable"], 2)
        self.assertEqual(probe.call_count, 2)

    def test_invalid_manifest_is_rejected(self):
        self.assertFalse(collector.parse_hls_manifest(b"not a playlist")["manifest_valid"])
        self.assertFalse(collector.parse_mpd_manifest(b"<not-mpd/>")["manifest_valid"])

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



    def test_candidate_schema_migrates_legacy_rows_without_marking_public(self):
        import sqlite3
        legacy_path = Path(self.temp.name) / "legacy.sqlite3"
        connection = sqlite3.connect(legacy_path)
        connection.executescript("""
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY, url TEXT NOT NULL, host TEXT NOT NULL,
              status TEXT NOT NULL, mode TEXT NOT NULL, created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL, error TEXT, result_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE candidates (
              id TEXT PRIMARY KEY, task_id TEXT NOT NULL, url TEXT NOT NULL,
              host TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
              validation TEXT
            );
            INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at)
              VALUES('legacy-task','https://catalog.example','catalog.example','completed','http',1,1);
            INSERT INTO candidates(id,task_id,url,host,kind,created_at)
              VALUES('legacy-candidate','legacy-task','https://media.example/movie.mp4','media.example','direct-media',1);
        """)
        connection.commit()
        connection.close()
        previous_path = collector.DB_PATH
        try:
            collector.DB_PATH = legacy_path
            collector.init_db()
            with collector.db() as migrated:
                row = migrated.execute(
                    "SELECT collected_by,access_state,probe_evidence,media_identity,quality_evidence "
                    "FROM candidates WHERE id='legacy-candidate'"
                ).fetchone()
            self.assertEqual(row["collected_by"], "[]")
            self.assertEqual(row["access_state"], "ACCESS_UNKNOWN")
            self.assertEqual(row["probe_evidence"], "{}")
            self.assertEqual(row["media_identity"], "{}")
            self.assertEqual(row["quality_evidence"], "{}")
        finally:
            collector.DB_PATH = previous_path

    def test_media_identity_uses_structured_metadata_and_keeps_ambiguous_types_unknown(self):
        identity = collector.infer_media_identity(
            "Example Series S02E03 2024 1080p",
            "https://cdn.example/video.m3u8",
            {
                "title": "Example Series S02E03 2024 1080p",
                "media_type_hint": "anime",
                "identity_source": "schema_org",
                "year_hint": 2024,
                "season_hint": 2,
                "episode_hint": 3,
                "episode_title": "Episode 3",
                "description": "A public metadata description",
            },
        )
        self.assertEqual(identity["title_hint"], "Example Series")
        self.assertEqual(identity["media_type"], "anime")
        self.assertEqual(identity["year_hint"], 2024)
        self.assertEqual(identity["season_hint"], 2)
        self.assertEqual(identity["episode_hint"], 3)
        self.assertEqual(identity["episode_title"], "Episode 3")
        self.assertEqual(identity["match_confidence"], "structured_metadata")
        ambiguous = collector.infer_media_identity(
            "Watch now", "https://cdn.example/stream.m3u8"
        )
        self.assertEqual(ambiguous["media_type"], "unknown")
        self.assertEqual(ambiguous["match_confidence"], "hint_only")

    def test_registry_links_structured_episode_to_canonical_series(self):
        base_identity = {
            "title_hint": "Example Anime",
            "year_hint": 2024,
            "media_type": "anime",
            "match_confidence": "structured_metadata",
            "identity_source": "schema_org",
            "entity_key": "not-used-for-series-key",
            "poster": "https://images.example/poster.jpg",
        }
        first = {
            "id": "a" * 32, "url": "https://cdn.example/episode-1.m3u8",
            "host": "cdn.example", "kind": "direct-media", "title": "Example Anime",
            "media_identity": {**base_identity, "season_hint": 1, "episode_hint": 1},
            "page_metadata": {"identity_source": "schema_org"},
        }
        second = {
            "id": "b" * 32, "url": "https://cdn.example/episode-2.m3u8",
            "host": "cdn.example", "kind": "direct-media", "title": "Example Anime",
            "media_identity": {**base_identity, "season_hint": 1, "episode_hint": 2},
            "page_metadata": {"identity_source": "schema_org"},
        }
        collector.registry_store.register_discovered_candidate(first)
        collector.registry_store.register_discovered_candidate(second)
        with collector.registry_store.connect() as connection:
            movies = connection.execute("SELECT id,title,year,metadata FROM registry_movies").fetchall()
            episodes = connection.execute("SELECT movie_id,season,episode FROM registry_episodes ORDER BY episode").fetchall()
        self.assertEqual(len(movies), 1)
        self.assertEqual(movies[0]["title"], "Example Anime")
        self.assertEqual(len(episodes), 2)
        self.assertEqual(episodes[0]["movie_id"], episodes[1]["movie_id"])
        self.assertEqual([row["episode"] for row in episodes], [1, 2])

        collector.registry_store.sync_candidate_validation(
            first["id"],
            {"reachable": True, "access": {"access_state": "PUBLIC"}, "media_format": "hls"},
            "validated",
        )
        collector.registry_store.register_candidate_playback(first["id"], {
            "media_type": "hls", "decoded_width": 1920, "decoded_height": 1080,
            "observed_seconds": 8, "progressed_seconds": 7,
        })
        with collector.registry_store.connect() as connection:
            resource = connection.execute(
                "SELECT movie_id,metadata,playback_state FROM registry_resources WHERE candidate_id=?",
                (first["id"],),
            ).fetchone()
        self.assertIsNotNone(resource["movie_id"])
        self.assertEqual(resource["playback_state"], "PLAYER_CONFIRMED")
        self.assertEqual(collector.json.loads(resource["metadata"])["media_identity"]["title_hint"], "Example Anime")

    def test_candidate_merge_persists_provenance_identity_and_unknown_access(self):
        candidate = collector.normalize_candidate({
            "url": "https://media.example/Example.Movie.2024.S02E03.1080p.m3u8",
            "host": "media.example",
            "kind": "direct-media",
            "title": "Example Movie 2024 S02E03",
            "collected_by": ["spider", "browser", "unknown"],
        })
        self.assertEqual(candidate["access_state"], "ACCESS_UNKNOWN")
        self.assertEqual(candidate["collected_by"], ["spider", "browser"])
        self.assertEqual(candidate["media_identity"]["year_hint"], 2024)
        self.assertEqual(candidate["media_identity"]["season_hint"], 2)
        self.assertEqual(candidate["media_identity"]["episode_hint"], 3)
        self.assertEqual(candidate["media_identity"]["match_confidence"], "hint_only")
        self.assertEqual(candidate["media_identity"]["quality_hint"], "1080p")
        self.assertEqual(candidate["media_identity"]["entity_key"] is not None, True)
        self.assertEqual(candidate["media_identity"]["version_key"] is not None, True)
        self.assertEqual(candidate["quality_evidence"]["quality_rank"], 1080)
        self.assertEqual(candidate["quality_evidence"]["quality_rank_source"], "filename_hint")

    def test_task_candidate_endpoint_decodes_persisted_evidence(self):
        task_id = "f" * 32
        candidate_id = "e" * 32
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://catalog.example", "catalog.example", "completed", "http", 1, 1),
            )
            connection.execute(
                """INSERT INTO candidates
                   (id,task_id,url,host,kind,title,created_at,collected_by,access_state,
                    media_identity,quality_evidence,probe_evidence)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (candidate_id, task_id, "https://media.example/movie.m3u8", "media.example",
                 "direct-media", "Movie", 1, '["spider","browser"]', "ACCESS_UNKNOWN",
                 '{"title_hint":"Movie","match_confidence":"hint_only"}',
                 '{"evidence_scope":"manifest_metadata_only"}', '{"http_status":null}'),
            )
        with patch.object(collector, "require_token"):
            result = collector.task_candidates(task_id, "Bearer test")
        item = result["candidates"][0]
        self.assertEqual(item["collected_by"], ["spider", "browser"])
        self.assertEqual(item["access_state"], "ACCESS_UNKNOWN")
        self.assertEqual(item["media_identity"]["title_hint"], "Movie")
        self.assertEqual(item["quality_evidence"]["evidence_scope"], "manifest_metadata_only")
        self.assertEqual(item["probe_evidence"]["http_status"], None)

    def test_quality_evidence_never_claims_decode_or_visual_verification(self):
        evidence = collector.build_quality_evidence({
            "manifest": {"variants": [{"width": 1920, "height": 1080}]}
        })
        self.assertEqual(evidence["declared_resolutions"][0]["height"], 1080)
        self.assertFalse(evidence["decode_verified"])
        self.assertFalse(evidence["visual_quality_verified"])
        self.assertIsNone(evidence["observed_container_resolution"])


    def test_frontier_prioritizes_pagination_and_catalogue_pages(self):
        self.assertGreater(
            collector.frontier_link_priority("https://catalog.example/page=2", "Next"),
            collector.frontier_link_priority("https://catalog.example/movie/123", "Movie"),
        )
        self.assertGreater(
            collector.frontier_link_priority("https://catalog.example/movie/123", "Movie"),
            collector.frontier_link_priority("https://catalog.example/about", "About"),
        )
        self.assertIsNone(collector.frontier_link_priority("https://cdn.example/movie.m3u8", "Stream"))
        self.assertIsNone(collector.frontier_link_priority("https://catalog.example:8443/movie/123", "Movie"))

    def test_fmhy_category_discovery_only_returns_fmhy_owned_pages(self):
        class Anchor:
            def __init__(self, href, text):
                self.attrib = {"href": href}
                self._text = text
            def css(self, selector):
                value = self._text
                return type("Selection", (), {"getall": lambda selection: [value]})()
        class Page:
            def css(self, selector):
                if selector == "a":
                    return [Anchor("/video/anime", "Anime"), Anchor("/video/movies", "Movies"),
                            Anchor("https://untrusted.example/video", "External video"),
                            Anchor("/about", "About")]
                return type("Selection", (), {"get": lambda self: ""})()
        result = collector.fmhy_category_pages_from_page(Page())
        self.assertEqual(result, ["https://fmhy.net/video/anime", "https://fmhy.net/video/movies"])


    def test_hls_aes_encryption_is_not_misclassified_as_drm(self):
        result = collector.classify_access_state(
            200,
            {"content-type": "application/vnd.apple.mpegurl"},
            '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        )
        self.assertEqual(result["access_state"], "ENCRYPTED_STREAM")
        self.assertEqual(result["drm_systems"], [])
        self.assertEqual(result["encryption_methods"], ["AES-128"])

    def test_hls_fairplay_signal_remains_drm_protected(self):
        result = collector.classify_access_state(
            200,
            {"content-type": "application/vnd.apple.mpegurl"},
            '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd://asset"',
        )
        self.assertEqual(result["access_state"], "DRM_PROTECTED")
        self.assertIn("FairPlay", result["drm_systems"])

    def test_hls_keyformat_fairplay_is_detected_without_retaining_key_uri(self):
        manifest = collector.parse_hls_manifest(
            b'#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd://private-key-reference"'
        )
        self.assertEqual(manifest["key_formats"], ["com.apple.streamingkeydelivery"])
        self.assertNotIn("private-key-reference", str(manifest))
        access = collector.classify_access_state(
            200, {"content-type": "application/vnd.apple.mpegurl"},
            "#EXT-X-KEY:KEYFORMAT=com.apple.streamingkeydelivery",
        )
        self.assertEqual(access["access_state"], "DRM_PROTECTED")


    def test_hls_method_none_is_not_classified_as_encrypted(self):
        result = collector.classify_access_state(
            200,
            {"content-type": "application/vnd.apple.mpegurl"},
            "#EXT-X-KEY:METHOD=NONE",
        )
        self.assertEqual(result["access_state"], "PUBLIC")
        manifest = collector.parse_hls_manifest(
            b'#EXTM3U\n#EXT-X-KEY:METHOD=NONE,KEYFORMAT="identity"'
        )
        self.assertEqual(manifest["key_formats"], [])
        self.assertFalse(manifest["encrypted"])


    def test_mp4_tkhd_dimensions_are_parsed_from_bounded_moov_box(self):
        def box(kind, payload):
            return (len(payload) + 8).to_bytes(4, "big") + kind + payload
        tkhd = bytearray(84)
        tkhd[0] = 0
        tkhd[76:80] = (1920 << 16).to_bytes(4, "big")
        tkhd[80:84] = (1080 << 16).to_bytes(4, "big")
        sample = box(b"ftyp", b"isom0000") + box(b"moov", box(b"trak", box(b"tkhd", bytes(tkhd))))
        self.assertEqual(
            collector.parse_mp4_container_dimensions(sample),
            {"width": 1920, "height": 1080, "source": "mp4_tkhd"},
        )

    def test_webm_ebml_video_dimensions_are_parsed(self):
        def element(element_id, payload):
            return element_id + bytes([0x80 | len(payload)]) + payload
        pixel_width = element(bytes([0xB0]), (1920).to_bytes(2, "big"))
        pixel_height = element(bytes([0xBA]), (1080).to_bytes(2, "big"))
        video = element(bytes([0xE0]), pixel_width + pixel_height)
        track = element(bytes([0xAE]), video)
        tracks = element(bytes([0x16, 0x54, 0xAE, 0x6B]), track)
        segment = element(bytes([0x18, 0x53, 0x80, 0x67]), tracks)
        self.assertEqual(
            collector.parse_webm_container_dimensions(segment),
            {"width": 1920, "height": 1080, "source": "webm_ebml_video"},
        )

    def test_observed_container_resolution_outranks_declared_manifest_hint(self):
        evidence = collector.rank_quality_evidence(
            {
                "best_declared_resolution": {"width": 1280, "height": 720},
                "observed_container_resolution": {"width": 1920, "height": 1080},
            },
            {"quality_hint": "2160p"},
        )
        self.assertEqual(evidence["quality_rank"], 1080)
        self.assertEqual(evidence["quality_rank_source"], "container_observed")

    def test_fmhy_video_directory_extracts_unique_external_sites(self):
        class TextNode:
            def __init__(self, value):
                self.value = value
            def getall(self):
                return [self.value]

        class Anchor:
            def __init__(self, href, label):
                self.attrib = {"href": href}
                self.label = label
            def css(self, selector):
                return TextNode(self.label)

        class Page:
            def css(self, selector, **kwargs):
                if selector == "a":
                    return [
                        Anchor("https://loc.gov/collections/film-and-video/", "Library of Congress"),
                        Anchor("https://loc.gov/item/another", "Library of Congress duplicate"),
                        Anchor("https://fmhy.net/video", "FMHY internal"),
                        Anchor("https://tubi.tv/category/movies", "Tubi"),
                        Anchor("https://independent-catalog.example/movies", "Independent public catalogue"),
                        Anchor("http://insecure.example", "Insecure"),
                    ]
                return []

        sites = collector.fmhy_sites_from_page(Page())
        self.assertEqual([site["host"] for site in sites], ["loc.gov", "tubi.tv", "independent-catalog.example"])
        self.assertTrue(all(site["directory"].startswith("FMHY / video") for site in sites))
        self.assertFalse(any(site["host"] == "insecure.example" for site in sites))



    def test_cms_api_shape_requires_actual_vod_fields_not_any_json_list(self):
        valid = {
            "code": 1,
            "msg": "ok",
            "list": [{"vod_id": 12, "vod_name": "Example Movie", "vod_pic": "https://img.example/poster.jpg"}],
        }
        generic = {"list": [{"id": 12, "name": "Not a CMS record"}]}
        self.assertEqual(collector.extract_cms_api_list(valid), valid["list"])
        self.assertIsNone(collector.extract_cms_api_list(generic))
        self.assertIsNone(collector.extract_cms_api_list({"data": {"items": []}}))

    def test_captured_browser_network_identifies_cms_api_by_response_shape(self):
        class CapturedResponse:
            url = "https://catalog.example/api/vod/list"
            status = 200
            headers = {"content-type": "application/json"}
            body = b'{"code":1,"msg":"ok","list":[{"vod_id":1,"vod_name":"Example"}]}'

        class Network:
            def search(self, limit=None):
                return [CapturedResponse()]

        class Session:
            network = Network()

        candidates = collector.captured_api_candidates(Session(), "https://catalog.example/", 10)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["kind"], "cms-api-candidate")
        self.assertEqual(candidates[0]["access_state"], "PUBLIC")

    def test_cms_source_root_removes_per_request_query_and_fragment(self):
        self.assertEqual(
            collector.cms_source_root("https://catalog.example/api.php/provide/vod/?ac=list&page=1#x"),
            "https://catalog.example/api.php/provide/vod/",
        )

    def test_validate_candidate_accepts_real_cms_vod_json_without_requiring_content_type_header(self):
        candidate_id = "f" * 32
        task_id = "1" * 32
        with collector.db() as connection:
            connection.execute(
                "INSERT INTO tasks(id,url,host,status,mode,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, "https://catalog.example/", "catalog.example", "completed", "auto", 1, 1),
            )
            connection.execute(
                "INSERT INTO candidates(id,task_id,url,host,kind,title,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
                (candidate_id, task_id,
                 "https://catalog.example/api.php/provide/vod/?ac=list&page=1",
                 "catalog.example", "cms-api-candidate", "Catalog", "pending", 1),
            )

        class Page:
            status = 200
            headers = {"content-type": "text/plain"}
            body = b'{"code":1,"msg":"ok","page":1,"list":[{"vod_id":7,"vod_name":"Example Movie"}]}'

        with (
            patch.object(collector, "require_token"),
            patch.object(collector, "require_egress_firewall"),
            patch.object(collector, "public_https_url", return_value=(
                "https://catalog.example/api.php/provide/vod/?ac=list&page=1", "catalog.example"
            )),
            patch.object(collector, "throttle"),
            patch.object(collector.Fetcher, "get", return_value=Page()),
        ):
            result = collector.validate_candidate(candidate_id)

        self.assertTrue(result["validation"]["cms_shape"])
        self.assertEqual(result["validation"]["sample_count"], 1)
        self.assertEqual(
            result["validation"]["source_url"],
            "https://catalog.example/api.php/provide/vod/",
        )
        with collector.db() as connection:
            stored = connection.execute(
                "SELECT status FROM candidates WHERE id=?", (candidate_id,)
            ).fetchone()
        self.assertEqual(stored["status"], "validated")


if __name__ == "__main__":
    unittest.main()
