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

    def test_candidate_validation_fails_closed_before_database_lookup(self):
        with patch.dict(os.environ, {"SCRAPLING_EGRESS_FIREWALL_CONFIRMED": ""}):
            with patch.object(collector, "require_token"):
                with self.assertRaises(collector.HTTPException) as error:
                    collector.validate_candidate("candidate-does-not-exist")
            self.assertEqual(error.exception.status_code, 503)

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
        with patch.object(collector.socket, "socket", return_value=fake_socket), \\
             patch.object(collector.socket, "getaddrinfo", side_effect=AssertionError("DNS lookup after pinning")):
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
        ]), patch.object(collector, "PinnedHTTPSConnection", Connection):
            result = collector.probe_direct_media("https://media.example/movie.mp4")
        self.assertTrue(result["reachable"])
        self.assertEqual(result["http_status"], 206)
        self.assertTrue(result["range_supported"])
        self.assertEqual(Connection.last_request[0], "GET")
        self.assertEqual(Connection.last_request[2]["Range"], "bytes=0-0")

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


if __name__ == "__main__":
    unittest.main()
