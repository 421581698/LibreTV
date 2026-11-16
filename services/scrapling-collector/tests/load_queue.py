from __future__ import annotations

import argparse
import json
import tempfile
import time
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import registry_queue as queue


def run(target: int, workers: int) -> dict:
    if target < 1 or target > 10000:
        raise ValueError("target must be between 1 and 10000")
    if workers < 1 or workers > 64:
        raise ValueError("workers must be between 1 and 64")

    with tempfile.TemporaryDirectory(prefix="libretv-queue-load-") as temp_dir:
        queue.DB_PATH = Path(temp_dir) / "load.sqlite3"
        queue.initialize()

        enqueue_started = time.perf_counter()
        submitted_ids = set()
        for index in range(target):
            job = queue.submit_job(
                "crawl",
                {
                    "url": f"https://example.invalid/load/{index}",
                    "mode": "http",
                    "limit": 1,
                    "load_test": True,
                },
                f"load-test:{target}:{index}",
            )
            submitted_ids.add(job["id"])
        enqueue_seconds = time.perf_counter() - enqueue_started

        claim_started = time.perf_counter()

        def claim_until_empty(worker_index: int) -> list[str]:
            claimed = []
            worker_id = f"load-worker-{worker_index}"
            while True:
                job = queue.claim_job(worker_id, lease_seconds=900)
                if job is None:
                    return claimed
                claimed.append(job["id"])

        with ThreadPoolExecutor(max_workers=workers) as executor:
            claimed_groups = list(executor.map(claim_until_empty, range(workers)))
        claim_seconds = time.perf_counter() - claim_started

        claimed_ids = [job_id for group in claimed_groups for job_id in group]
        with queue.connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS total,COUNT(DISTINCT idempotency_key) AS unique_keys FROM collector_jobs"
            ).fetchone()
            running = connection.execute(
                "SELECT COUNT(*) AS total FROM collector_jobs WHERE status='running'"
            ).fetchone()["total"]

        result = {
            "target": target,
            "workers": workers,
            "submitted": len(submitted_ids),
            "claimed": len(claimed_ids),
            "unique_claims": len(set(claimed_ids)),
            "database_rows": row["total"],
            "unique_idempotency_keys": row["unique_keys"],
            "running_after_claim": running,
            "enqueue_seconds": round(enqueue_seconds, 3),
            "claim_seconds": round(claim_seconds, 3),
            "total_seconds": round(enqueue_seconds + claim_seconds, 3),
            "enqueue_jobs_per_second": round(target / enqueue_seconds, 2) if enqueue_seconds else None,
            "claim_jobs_per_second": round(target / claim_seconds, 2) if claim_seconds else None,
        }
        if (
            result["submitted"] != target
            or result["claimed"] != target
            or result["unique_claims"] != target
            or result["database_rows"] != target
            or result["unique_idempotency_keys"] != target
            or result["running_after_claim"] != target
        ):
            raise AssertionError(json.dumps(result, sort_keys=True))
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Isolated durable queue load test; no network requests are made.")
    parser.add_argument("--target", type=int, default=10000)
    parser.add_argument("--workers", type=int, default=12)
    args = parser.parse_args()
    print(json.dumps(run(args.target, args.workers), sort_keys=True))
