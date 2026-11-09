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
    assert "spider_jobs" in body["planned"]


def test_fetch_rejects_localhost_before_network_request() -> None:
    response = client.post("/v1/fetch", json={"url": "http://127.0.0.1/"})
    assert response.status_code == 400
