import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault("SCRAPLING_API_TOKEN", "collector-test-token")
sys.path.insert(0, os.path.dirname(__file__))

import app


class FakeSelector:
    def __init__(self, values):
        self.values = values

    def getall(self):
        return self.values


class FakeAnchor:
    def __init__(self, href, title):
        self.attrib = {"href": href}
        self.title = title

    def css(self, selector):
        if selector == "::text":
            return FakeSelector([self.title])
        return FakeSelector([])


class FakePage:
    def css(self, selector):
        if selector == "a":
            return [
                FakeAnchor("https://stream.example/watch", "Stream Example"),
                FakeAnchor("https://fmhy.net/video", "FMHY self link"),
                FakeAnchor("javascript:void(0)", "Invalid link"),
            ]
        return FakeSelector([])


class CollectorSecurityTests(unittest.TestCase):
    def test_rejects_non_https_urls(self):
        with self.assertRaises(Exception):
            app.public_https_url("http://example.com")

    def test_rejects_private_ip_targets(self):
        with patch("app.socket.getaddrinfo", return_value=[(None, None, None, None, ("127.0.0.1", 443))]):
            with self.assertRaises(Exception):
                app.public_https_url("https://private.example")

    def test_accepts_public_https_target(self):
        with patch("app.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 443))]):
            url, host = app.public_https_url("https://public.example/watch")
        self.assertEqual(url, "https://public.example/watch")
        self.assertEqual(host, "public.example")

    def test_requires_bearer_token(self):
        with self.assertRaises(Exception):
            app.require_token("Bearer wrong-token")
        app.require_token(f"Bearer {app.TOKEN}")

    def test_fmhy_discovery_only_returns_external_https_sites(self):
        with patch.object(app.Fetcher, "get", return_value=FakePage()):
            sites = app.discover_sites()
        self.assertEqual(len(sites), 1)
        self.assertEqual(sites[0]["host"], "stream.example")
        self.assertEqual(app._discovered_hosts, {"stream.example"})


if __name__ == "__main__":
    unittest.main()
