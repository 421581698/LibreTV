from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from app.ffprobe_analyzer import MediaProbeError, analyze_local_media_file

logger = logging.getLogger("libretv.media_probe_worker")
_JOB_ID = re.compile(r"^[0-9a-f]{32}$")
POLL_SECONDS = 0.25
MAX_REQUEST_BYTES = 4096


def _directories() -> tuple[Path, Path]:
    inbox = Path(os.environ.get("MEDIA_PROBE_INBOX", "/probe/inbox"))
    outbox = Path(os.environ.get("MEDIA_PROBE_OUTBOX", "/probe/outbox"))
    inbox.mkdir(parents=True, exist_ok=True)
    outbox.mkdir(parents=True, exist_ok=True)
    return inbox, outbox


def _write_result(outbox: Path, job_id: str, result: dict[str, Any]) -> None:
    destination = outbox / f"{job_id}.json"
    temporary = outbox / f".{job_id}.tmp"
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    with temporary.open("x", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, destination)


def process_request(request_path: Path, inbox: Path, outbox: Path) -> bool:
    if request_path.is_symlink() or not request_path.is_file():
        return False
    if request_path.stat().st_size > MAX_REQUEST_BYTES:
        return False
    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        job_id = request.get("job_id")
        filename = request.get("filename")
        timeout_seconds = request.get("timeout_seconds", 20)
        if not isinstance(job_id, str) or not _JOB_ID.fullmatch(job_id):
            return False
        if filename != f"{job_id}.media":
            return False
        if (
            not isinstance(timeout_seconds, int)
            or isinstance(timeout_seconds, bool)
            or not 1 <= timeout_seconds <= 60
        ):
            raise ValueError("Invalid probe timeout")
        destination = outbox / f"{job_id}.json"
        if destination.exists():
            return True
        media_path = inbox / filename
        if media_path.is_symlink() or not media_path.is_file():
            raise MediaProbeError("Probe input is missing or is not a regular file")
        report = analyze_local_media_file(
            media_path,
            timeout_seconds=timeout_seconds,
        )
        _write_result(outbox, job_id, {"ok": True, "report": report})
    except Exception as exc:
        logger.warning("Media probe request failed: %s", type(exc).__name__)
        if isinstance(locals().get("job_id"), str) and _JOB_ID.fullmatch(job_id):
            try:
                _write_result(
                    outbox,
                    job_id,
                    {"ok": False, "error": type(exc).__name__, "message": str(exc)[:300]},
                )
            except FileExistsError:
                pass
    return True


def run_forever() -> None:
    inbox, outbox = _directories()
    logger.info("Isolated media probe worker started (network disabled by container)")
    while True:
        for request_path in sorted(inbox.glob("*.json")):
            try:
                process_request(request_path, inbox, outbox)
            except Exception:
                logger.exception("Unexpected media probe worker failure")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())
    run_forever()
