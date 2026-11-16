from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from app.workflow_worker import WorkflowWorker


class _CandidateStore:
    def __init__(self, candidates: dict[str, dict[str, Any]]) -> None:
        self.candidates = candidates
        self.saved: list[tuple[str, dict[str, Any]]] = []

    def get_candidate(self, candidate_id: str) -> dict[str, Any] | None:
        return self.candidates.get(candidate_id)

    def save_quality_report(self, candidate_id: str, report: dict[str, Any]) -> bool:
        self.saved.append((candidate_id, report))
        return True


def test_probe_media_candidates_downloads_and_probes_direct_file_candidate(
    tmp_path: Path,
    monkeypatch,
) -> None:
    worker = WorkflowWorker.__new__(WorkflowWorker)
    worker.candidates = _CandidateStore(
        {
            "file-1": {
                "candidate_id": "file-1",
                "media_type": "file",
                "media_url": "https://93.184.216.34/video.mp4",
            }
        }
    )
    staged = tmp_path / "download.media"
    staged.write_bytes(b"media")

    async def fake_download(url, staging, *, proxy, max_bytes):
        assert url == "https://93.184.216.34/video.mp4"
        assert Path(staging) == tmp_path
        assert max_bytes > 0
        return staged

    def fake_probe(path, *, timeout_seconds):
        assert path == staged
        assert timeout_seconds == 20
        return {
            "video": {"width": 3840, "height": 2160},
            "is_4k_bitstream": True,
            "hdr_bitstream_claim": True,
            "native_4k_verified": False,
            "verification_level": "local_bitstream_probe",
        }

    monkeypatch.setenv("MEDIA_PROBE_STAGING", str(tmp_path))
    monkeypatch.setattr("app.workflow_worker.download_candidate_media", fake_download)
    monkeypatch.setattr("app.workflow_worker.probe_media_file", fake_probe)

    result = asyncio.run(
        worker._probe_media_candidates(
            {"dependencies": {"register": {"candidate_ids": ["file-1"]}}}
        )
    )

    assert result["count"] == 1
    assert result["reports"][0] == {
        "candidate_id": "file-1",
        "status": "probed",
        "width": 3840,
        "height": 2160,
        "is_4k_bitstream": True,
        "hdr_bitstream_claim": True,
        "native_4k_verified": False,
        "verification_level": "local_bitstream_probe",
    }
    assert len(worker.candidates.saved) == 1
    assert not staged.exists()


def test_probe_media_candidates_keeps_manifest_candidates_on_manifest_path() -> None:
    worker = WorkflowWorker.__new__(WorkflowWorker)
    worker.candidates = _CandidateStore(
        {
            "hls-1": {
                "candidate_id": "hls-1",
                "media_type": "hls",
                "media_url": "https://93.184.216.34/master.m3u8",
            }
        }
    )

    result = asyncio.run(worker._probe_media_candidates({"candidate_ids": ["hls-1"]}))

    assert result["reports"] == [
        {
            "candidate_id": "hls-1",
            "status": "manifest_candidate",
            "verification_level": "manifest_analysis_required",
        }
    ]
    assert worker.candidates.saved == []


def test_probe_media_candidates_caps_batch_and_reports_overflow() -> None:
    worker = WorkflowWorker.__new__(WorkflowWorker)
    candidate_ids = [f"candidate-{index}" for index in range(21)]
    worker.candidates = _CandidateStore(
        {
            candidate_id: {
                "candidate_id": candidate_id,
                "media_type": "hls",
                "media_url": "https://93.184.216.34/master.m3u8",
            }
            for candidate_id in candidate_ids
        }
    )

    result = asyncio.run(
        worker._probe_media_candidates({"candidate_ids": candidate_ids})
    )

    assert result["count"] == 20
    assert result["skipped_count"] == 1
    assert len(result["reports"]) == 20
    assert all(item["status"] == "manifest_candidate" for item in result["reports"])
