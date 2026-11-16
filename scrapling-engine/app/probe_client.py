from __future__ import annotations

import json
import os
import shutil
import stat
import time
import uuid
from pathlib import Path
from typing import Any

MAX_MEDIA_FILE_BYTES = 2 * 1024 * 1024 * 1024


class MediaProbeError(ValueError):
    """The isolated media probe did not return a valid report."""


def probe_media_file(
    local_path: str | Path,
    *,
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    if not 1 <= timeout_seconds <= 60:
        raise MediaProbeError("Probe timeout must be between 1 and 60 seconds")
    source = Path(local_path)
    if source.is_symlink():
        raise MediaProbeError("Symbolic links are not accepted for media probing")
    try:
        resolved = source.resolve(strict=True)
        metadata = resolved.stat()
    except OSError as exc:
        raise MediaProbeError("Media file cannot be inspected") from exc
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size <= 0:
        raise MediaProbeError("Only non-empty regular media files can be probed")
    if metadata.st_size > MAX_MEDIA_FILE_BYTES:
        raise MediaProbeError("Media file exceeds the 2 GiB probe limit")

    inbox = Path(os.environ.get("MEDIA_PROBE_INBOX", "/probe/inbox"))
    outbox = Path(os.environ.get("MEDIA_PROBE_OUTBOX", "/probe/outbox"))
    if not inbox.is_dir() or not outbox.is_dir():
        raise MediaProbeError("Isolated media probe sidecar is not mounted")
    job_id = uuid.uuid4().hex
    media_path = inbox / f"{job_id}.media"
    request_path = inbox / f"{job_id}.json"
    request_tmp = inbox / f".{job_id}.request.tmp"
    result_path = outbox / f"{job_id}.json"

    try:
        # Publish the request last so the sidecar never observes a partial media file.
        shutil.copyfile(resolved, media_path)
        request = {
            "job_id": job_id,
            "filename": media_path.name,
            "timeout_seconds": timeout_seconds,
        }
        request_tmp.write_text(
            json.dumps(request, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(request_tmp, request_path)

        deadline = time.monotonic() + timeout_seconds + 20
        while time.monotonic() < deadline:
            if result_path.is_file() and not result_path.is_symlink():
                try:
                    payload = json.loads(result_path.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                    raise MediaProbeError("Probe sidecar returned an invalid response") from exc
                if not isinstance(payload, dict) or not isinstance(payload.get("ok"), bool):
                    raise MediaProbeError("Probe sidecar returned an invalid response")
                if not payload["ok"]:
                    message = payload.get("message")
                    raise MediaProbeError(
                        str(message)[:300] if isinstance(message, str) else "Media probe failed"
                    )
                report = payload.get("report")
                if not isinstance(report, dict) or not isinstance(report.get("video"), dict):
                    raise MediaProbeError("Probe sidecar returned an incomplete report")
                return report
            time.sleep(0.2)
        raise MediaProbeError("Timed out waiting for isolated media probe sidecar")
    finally:
        for path in (request_tmp, request_path, media_path, result_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
