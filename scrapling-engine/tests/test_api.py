from unittest.mock import Mock

import pytest
from cssselect.parser import SelectorSyntaxError
from fastapi.testclient import TestClient
from lxml.etree import XPathError

from app.main import app
from app.scraper import ScraplingAdapter

client = TestClient(app)


def test_health_reports_phase_one() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["engine"] == "scrapling"
    assert response.json()["phase"] == "1"


def test_capabilities_distinguish_planned_features() -> None:
    response = client.get("/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert "http_fetch" in body["implemented"]
    assert "xpath_extraction" in body["implemented"]
    assert "recursive_link_crawling" in body["planned"]


def test_fetch_rejects_localhost_before_network_request() -> None:
    response = client.post("/v1/fetch", json={"url": "http://127.0.0.1/"})
    assert response.status_code == 400


def test_fetch_requires_selector_for_structured_modes() -> None:
    response = client.post(
        "/v1/fetch",
        json={"url": "https://example.com/", "mode": "css"},
    )
    assert response.status_code == 422


def test_fetch_uses_adapter_and_returns_extraction(monkeypatch) -> None:
    page = Mock()
    monkeypatch.setattr(
        "app.main.validate_public_http_url",
        lambda url: url,
    )
    monkeypatch.setattr(
        "app.main.ensure_robots_allowed",
        lambda url, timeout: None,
    )
    monkeypatch.setattr(
        "app.main.ScraplingAdapter.fetch_page",
        lambda url, timeout: page,
    )
    monkeypatch.setattr(
        "app.main.ScraplingAdapter.extract",
        lambda page, selector, mode, adaptive_action=None: {
            "title": "fixture",
            "text": ["real adapter fixture"],
        },
    )
    response = client.post(
        "/v1/fetch",
        json={"url": "https://example.com/", "mode": "css", "selector": "h1"},
    )
    assert response.status_code == 200
    assert response.json()["result"]["title"] == "fixture"


def test_adapter_extracts_css_and_metadata() -> None:
    heading = Mock()
    heading.get_all_text.return_value = "Example heading"
    title = Mock()
    title.get.return_value = "Example title"
    page = Mock()
    page.get_all_text.return_value = "Example heading body"
    page.css.return_value = [heading]
    page.css_first.return_value = title
    page.status = 200
    page.url = "https://example.com/"
    page.markdown.return_value = "# Example"

    result = ScraplingAdapter.extract(page, "h1", "css")

    assert result["text"] == ["Example heading"]
    assert result["title"] == "Example title"
    assert result["markdown"] == "# Example"
    assert result["status"] == 200


def test_adapter_supports_xpath_and_regex() -> None:
    node = Mock()
    node.get_all_text.return_value = "Chapter 12"
    page = Mock()
    page.get_all_text.return_value = "Chapter 12 and Chapter 13"
    page.xpath.return_value = [node]
    page.css_first.return_value = None
    page.markdown.return_value = None

    xpath_result = ScraplingAdapter.extract(page, "//h2", "xpath")
    regex_result = ScraplingAdapter.extract(page, r"Chapter (\d+)", "regex")

    assert xpath_result["text"] == ["Chapter 12"]
    assert regex_result["text"] == ["12", "13"]
    assert regex_result["count"] == 2


def test_spider_rejects_private_seed_urls() -> None:
    response = client.post(
        "/v1/spider",
        json={"urls": ["http://127.0.0.1/"]},
    )
    assert response.status_code == 400


def test_spider_runs_validated_seed_urls(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.main.validate_public_http_url",
        lambda url: url,
    )
    monkeypatch.setattr(
        "app.main.ScraplingSpiderAdapter.crawl",
        lambda urls, crawldir=None: {
            "items": [{"url": urls[0], "title": "fixture"}],
            "completed": True,
            "paused": False,
            "stats": {"requests_count": 1},
        },
    )

    response = client.post(
        "/v1/spider",
        json={"urls": ["https://example.com/", "https://example.com/"]},
    )

    assert response.status_code == 200
    assert response.json()["result"]["stats"]["requests_count"] == 1
    assert len(response.json()["result"]["items"]) == 1


def test_spider_task_id_enables_checkpoint_directory(monkeypatch, tmp_path) -> None:
    captured = {}
    monkeypatch.setattr(
        "app.main.validate_public_http_url",
        lambda url: url,
    )
    monkeypatch.setattr("app.main.settings.crawl_data_dir", str(tmp_path))

    def fake_crawl(urls, crawldir=None):
        captured["urls"] = urls
        captured["crawldir"] = crawldir
        return {
            "items": [],
            "completed": True,
            "paused": False,
            "stats": {"requests_count": 0},
        }

    monkeypatch.setattr("app.main.ScraplingSpiderAdapter.crawl", fake_crawl)
    response = client.post(
        "/v1/spider",
        json={"urls": ["https://example.com/"], "task_id": "weekly_scan_01"},
    )

    assert response.status_code == 200
    assert response.json()["checkpoint_enabled"] is True
    assert captured["crawldir"] == tmp_path / "weekly_scan_01"
    assert captured["crawldir"].is_dir()
    assert (captured["crawldir"] / "libretv-manifest.json").is_file()

    mismatch = client.post(
        "/v1/spider",
        json={"urls": ["https://different.example/"], "task_id": "weekly_scan_01"},
    )
    assert mismatch.status_code == 409


def test_spider_rejects_unsafe_task_id() -> None:
    response = client.post(
        "/v1/spider",
        json={"urls": ["https://example.com/"], "task_id": "../escape"},
    )
    assert response.status_code == 422



def test_fetch_requires_action_for_adaptive_modes() -> None:
    response = client.post(
        "/v1/fetch",
        json={
            "url": "https://example.com/",
            "mode": "adaptive_css",
            "selector": ".headline",
        },
    )
    assert response.status_code == 422


def test_adapter_supports_adaptive_css_save_and_relocate() -> None:
    heading = Mock()
    heading.get_all_text.return_value = "Saved heading"
    page = Mock()
    page.get_all_text.return_value = "Saved heading"
    page.css.return_value = [heading]
    page.css_first.return_value = None
    page.markdown.return_value = None

    saved = ScraplingAdapter.extract(
        page,
        ".headline",
        "adaptive_css",
        adaptive_action="save",
    )
    page.css.assert_called_with(".headline", auto_save=True)
    assert saved["text"] == ["Saved heading"]

    relocated = ScraplingAdapter.extract(
        page,
        ".headline",
        "adaptive_css",
        adaptive_action="relocate",
    )
    page.css.assert_called_with(".headline", adaptive=True)
    assert relocated["adaptive_action"] == "relocate"



def test_adapter_supports_adaptive_xpath_relocation() -> None:
    node = Mock()
    node.get_all_text.return_value = "Adaptive result"
    page = Mock()
    page.get_all_text.return_value = "Adaptive result"
    page.xpath.return_value = [node]
    page.css_first.return_value = None
    page.markdown.return_value = None

    result = ScraplingAdapter.extract(
        page,
        "//h2",
        "adaptive_xpath",
        adaptive_action="relocate",
    )

    page.xpath.assert_called_with("//h2", adaptive=True)
    assert result["text"] == ["Adaptive result"]



def test_adapter_converts_invalid_css_and_xpath_to_validation_errors() -> None:
    page = Mock()
    page.get_all_text.return_value = "fixture"
    page.css.side_effect = SelectorSyntaxError("bad css")
    page.xpath.side_effect = XPathError("bad xpath")

    with pytest.raises(ValueError, match="Invalid CSS selector"):
        ScraplingAdapter.extract(page, "???", "css")
    with pytest.raises(ValueError, match="Invalid XPath expression"):
        ScraplingAdapter.extract(page, "//*[", "xpath")
