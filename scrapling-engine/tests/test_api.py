from unittest.mock import Mock

from fastapi.testclient import TestClient

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
        "app.main.ScraplingAdapter.fetch_page",
        lambda url, timeout: page,
    )
    monkeypatch.setattr(
        "app.main.ScraplingAdapter.extract",
        lambda page, selector, mode: {"title": "fixture", "text": ["real adapter fixture"]},
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
    regex_result = ScraplingAdapter.extract(page, r"Chapter (\\d+)", "regex")

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
        lambda urls: {
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
