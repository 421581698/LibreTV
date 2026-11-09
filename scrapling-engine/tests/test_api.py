from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.main import app
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
    assert "spider_jobs" in body["planned"]


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
