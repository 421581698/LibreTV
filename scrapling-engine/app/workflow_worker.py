from __future__ import annotations

import argparse
import asyncio
import logging
import socket
import uuid
from dataclasses import asdict
from typing import Any, Awaitable, Callable

from app.config import settings
from app.security import validate_public_http_url
from app.spider import ScraplingSpiderAdapter
from app.workflow_store import PostgresWorkflowStore

logger = logging.getLogger("libretv.scrapling.workflow_worker")
NodeHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class WorkflowWorker:
    """Executes durable DAG nodes with independent leases and retryable failures."""

    def __init__(
        self,
        database_url: str,
        worker_id: str,
        lease_seconds: int = 60,
        poll_seconds: float = 2.0,
    ) -> None:
        if lease_seconds < 15:
            raise ValueError("lease_seconds must be at least 15")
        if poll_seconds <= 0:
            raise ValueError("poll_seconds must be positive")
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds
        self.poll_seconds = poll_seconds
        self.store = PostgresWorkflowStore(database_url)
        self.handlers: dict[str, NodeHandler] = {
            "validate_public_urls": self._validate_public_urls,
            "crawl_seed_urls": self._crawl_seed_urls,
        }

    @staticmethod
    def _dependency_urls(payload: dict[str, Any]) -> list[str]:
        dependencies = payload.get("dependencies", {})
        for result in dependencies.values():
            if isinstance(result, dict) and isinstance(result.get("urls"), list):
                return result["urls"]
        return []

    async def _validate_public_urls(self, payload: dict[str, Any]) -> dict[str, Any]:
        urls = payload.get("urls") or self._dependency_urls(payload)
        if not isinstance(urls, list) or not urls or len(urls) > 20:
            raise ValueError("validate_public_urls requires 1 to 20 URLs")
        safe_urls = list(dict.fromkeys(validate_public_http_url(url) for url in urls))
        return {"urls": safe_urls, "validated_count": len(safe_urls)}

    async def _crawl_seed_urls(self, payload: dict[str, Any]) -> dict[str, Any]:
        urls = payload.get("urls") or self._dependency_urls(payload)
        if not isinstance(urls, list) or not urls or len(urls) > 20:
            raise ValueError("crawl_seed_urls requires 1 to 20 URLs")
        safe_urls = list(dict.fromkeys(validate_public_http_url(url) for url in urls))
        spider = ScraplingSpiderAdapter.create(safe_urls)
        items: list[dict[str, Any]] = []
        async for item in spider.stream():
            items.append(item)
        return {
            "items": items,
            "stats": asdict(spider.stats),
            "count": len(items),
        }

    async def _heartbeat(
        self,
        workflow_id: str,
        node_id: str,
        stop: asyncio.Event,
        lost: asyncio.Event,
    ) -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.lease_seconds / 3)
                return
            except TimeoutError:
                owned = await asyncio.to_thread(
                    self.store.heartbeat_node,
                    workflow_id,
                    node_id,
                    self.worker_id,
                    self.lease_seconds,
                )
                if not owned:
                    lost.set()
                    return

    async def process_once(self) -> bool:
        node = await asyncio.to_thread(
            self.store.claim_ready_node, self.worker_id, self.lease_seconds
        )
        if node is None:
            return False

        workflow_id = node["workflow_id"]
        node_id = node["node_id"]
        stop = asyncio.Event()
        lost = asyncio.Event()
        heartbeat = asyncio.create_task(
            self._heartbeat(workflow_id, node_id, stop, lost)
        )
        try:
            handler = self.handlers.get(node["node_type"])
            if handler is None:
                raise ValueError(f"Unsupported workflow node type: {node['node_type']}")
            payload = dict(node["input"])
            payload["dependencies"] = node.get("dependencies", {})
            result = await handler(payload)
            if lost.is_set():
                logger.warning("Workflow lease lost for %s/%s", workflow_id, node_id)
                return True
            completed = await asyncio.to_thread(
                self.store.complete_node,
                workflow_id,
                node_id,
                self.worker_id,
                result,
            )
            if not completed:
                logger.warning("Workflow completion fenced for %s/%s", workflow_id, node_id)
        except Exception as exc:
            logger.exception("Workflow node failed: %s/%s", workflow_id, node_id)
            if not lost.is_set():
                await asyncio.to_thread(
                    self.store.fail_node,
                    workflow_id,
                    node_id,
                    self.worker_id,
                    f"{type(exc).__name__}: {str(exc)[:400]}",
                    10,
                )
        finally:
            stop.set()
            await heartbeat
        return True

    async def run_forever(self) -> None:
        self.store.initialize()
        logger.info("Workflow worker %s started", self.worker_id)
        while True:
            processed = await self.process_once()
            if not processed:
                await asyncio.sleep(self.poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="LibreTV durable DAG workflow worker")
    parser.add_argument(
        "--worker-id",
        default=f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}",
    )
    parser.add_argument("--lease-seconds", type=int, default=60)
    parser.add_argument("--poll-seconds", type=float, default=2.0)
    args = parser.parse_args()
    if not settings.database_url:
        parser.error("DATABASE_URL is required for the workflow worker")
    logging.basicConfig(level=settings.log_level.upper())
    worker = WorkflowWorker(
        settings.database_url,
        args.worker_id,
        lease_seconds=args.lease_seconds,
        poll_seconds=args.poll_seconds,
    )
    asyncio.run(worker.run_forever())


if __name__ == "__main__":
    main()
