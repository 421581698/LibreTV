from __future__ import annotations

from unittest.mock import Mock

import pytest

from app.scraper import ScraplingAdapter


def test_fetch_page_applies_user_agent_and_rejects_oversized_response(
    monkeypatch,
) -> None:
    page = Mock()
    page.headers = {"content-length": "11"}
    page.body = b"hello world"
    captured = {}

    def fake_get(url, **kwargs):
        captured.update(kwargs)
        return page

    monkeypatch.setattr("app.scraper.Fetcher.get", fake_get)
    monkeypatch.setattr("app.scraper.settings.max_response_bytes", 10)

    with pytest.raises(ValueError, match="size limit"):
        ScraplingAdapter.fetch_page("https://example.com/")

    assert captured["follow_redirects"] == "safe"
    assert captured["headers"]["User-Agent"]
