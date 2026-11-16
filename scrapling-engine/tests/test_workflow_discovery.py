from __future__ import annotations

import pytest

from app.workflow_worker import WorkflowWorker


class _Nodes:
    def __init__(self, values: list[str]) -> None:
        self.values = values

    def getall(self) -> list[str]:
        return self.values


class _Title:
    def get(self) -> str:
        return "Test page"


class _Page:
    def __init__(self, url: str, links: list[str]) -> None:
        self.url = url
        self.links = links
        self.headers = {"content-type": "text/html; charset=utf-8"}
        self.status = 200

    def css(self, selector: str) -> _Nodes:
        if selector == "a::attr(href)":
            return _Nodes(self.links)
        return _Nodes([])

    def css_first(self, selector: str) -> _Title:
        return _Title()

    def get_all_text(self, strip: bool = True) -> str:
        return "A discovered public page"


@pytest.mark.asyncio
async def test_discover_site_links_is_bounded_and_stays_on_seed_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = "https://93.184.216.34/"
    child = "https://93.184.216.34/child"
    pages = {
        seed: _Page(
            seed,
            ["/child#section", "https://example.net/outside", "javascript:alert(1)"],
        ),
        child: _Page(child, ["/third"]),
    }
    fetched: list[str] = []

    def fetch(url: str, timeout: float) -> _Page:
        fetched.append(url)
        return pages[url]

    async def no_wait(seconds: float) -> None:
        return None

    monkeypatch.setattr("app.workflow_worker.ensure_robots_allowed", lambda *a, **k: None)
    monkeypatch.setattr("app.workflow_worker.ScraplingAdapter.fetch_page", fetch)
    monkeypatch.setattr("app.workflow_worker.asyncio.sleep", no_wait)

    worker = WorkflowWorker("postgresql://unused", "test-worker")
    result = await worker._discover_site_links(
        {"urls": [seed], "max_pages": 2, "max_depth": 2}
    )

    assert fetched == [seed, child]
    assert result["count"] == 2
    assert result["scope"] == "same_origin_only"
    assert result["visited_count"] == 2
    assert [item["url"] for item in result["items"]] == [seed, child]


@pytest.mark.asyncio
async def test_worker_tests_ai_generated_rule_on_fetched_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = "https://93.184.216.34/catalog"

    class RulePage:
        url = seed
        body = b"<html><article class='movie-card'>Movie A</article></html>"

        def get_all_text(self, strip: bool = True) -> str:
            return "Movie A"

    class FakePlanner:
        model = "test-model"

        def __init__(self, *_args: object) -> None:
            pass

        async def generate_extraction_rule(
            self,
            _goal: str,
            _url: str,
            _html: str,
        ):
            from app.supervisor import ExtractionRule

            return ExtractionRule(
                mode="css",
                selector=".movie-card",
                rationale="Stable movie card class.",
            )

    monkeypatch.setattr("app.workflow_worker.ensure_robots_allowed", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.workflow_worker.ScraplingAdapter.fetch_page",
        lambda *_args, **_kwargs: RulePage(),
    )
    monkeypatch.setattr(
        "app.workflow_worker.ScraplingAdapter.extract",
        lambda *_args, **_kwargs: {"text": ["Movie A", "Movie B"], "count": 2},
    )
    monkeypatch.setattr("app.workflow_worker.SupervisorClient", FakePlanner)

    worker = WorkflowWorker("postgresql://unused", "test-worker")
    monkeypatch.setattr(
        worker.rules,
        "save_tested_rule",
        lambda **_kwargs: "rule-test-id",
    )
    result = await worker._generate_extraction_rule(
        {"page_url": seed, "goal": "Extract movie titles"}
    )

    assert result["test_passed"] is True
    assert result["rule_id"] == "rule-test-id"
    assert result["rule_status"] == "active"
    assert result["selector"] == ".movie-card"
    assert result["match_count"] == 2
    assert result["verification_level"] == "live_page_selector_test"
