from __future__ import annotations

from app.media_discovery import extract_page_signals


class FakeSelectorList:
    def __init__(self, values: list[str]) -> None:
        self.values = values

    def getall(self) -> list[str]:
        return self.values


class FakePage:
    def __init__(self, values: dict[str, list[str]]) -> None:
        self.values = values

    def css(self, selector: str) -> FakeSelectorList:
        return FakeSelectorList(self.values.get(selector, []))


def test_extracts_title_poster_same_host_pages_and_hls_candidates() -> None:
    page = FakePage({
        "meta[property='og:title']::attr(content)": ["Example Movie"],
        "meta[property='og:image']::attr(content)": ["/images/poster.jpg"],
        "a::attr(href)": [
            "/movie/example-2026",
            "/watch/example-2026",
            "https://external.example/ignore",
            "javascript:alert(1)",
        ],
        "video::attr(src)": ["https://cdn.example:8443/hls/master.m3u8?token=public"],
        "script::text": ['const source = "https://cdn.example/movie/720p.mp4";'],
    })

    result = extract_page_signals(page, "https://catalog.example/")

    assert result["title"] == "Example Movie"
    assert result["poster_url"] == "https://catalog.example/images/poster.jpg"
    assert [item["role"] for item in result["discovered_pages"]] == [
        "detail_page", "playback_page",
    ]
    assert result["media_candidates"] == [
        {
            "url": "https://cdn.example:8443/hls/master.m3u8?token=public",
            "media_type": "hls",
            "discovered_via": "video_src",
            "validation_status": "pending_fetch_validation",
        },
        {
            "url": "https://cdn.example/movie/720p.mp4",
            "media_type": "mp4",
            "discovered_via": "inline_script",
            "validation_status": "pending_fetch_validation",
        },
    ]
    assert result["discovery_only"] is True


def test_rejects_private_addresses_and_non_http_schemes() -> None:
    page = FakePage({
        "video::attr(src)": [
            "http://127.0.0.1/private.m3u8",
            "http://[fd00::1]/private.mp4",
            "javascript:alert(1)",
            "data:video/mp4;base64,AAAA",
        ],
        "a::attr(href)": ["/detail", "http://localhost/admin"],
    })

    result = extract_page_signals(page, "https://catalog.example/")

    assert result["media_candidates"] == []
    assert result["discovered_pages"] == [
        {"url": "https://catalog.example/detail", "role": "detail_page", "label": ""},
    ]


def test_normalizes_default_and_alternate_ports_without_fragment() -> None:
    page = FakePage({
        "video::attr(src)": [
            "https://cdn.example:443/master.m3u8#player",
            "https://cdn.example:8443/master.m3u8",
        ],
    })

    result = extract_page_signals(page, "https://catalog.example/")

    assert [item["url"] for item in result["media_candidates"]] == [
        "https://cdn.example/master.m3u8",
        "https://cdn.example:8443/master.m3u8",
    ]
