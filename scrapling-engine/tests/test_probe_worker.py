from __future__ import annotations

import json

from app import probe_worker


def test_probe_worker_processes_request_without_database_or_network_client(
    tmp_path,
    monkeypatch,
):
    staging = tmp_path / "staging"
    inbox = tmp_path / "inbox"
    outbox = tmp_path / "outbox"
    staging.mkdir()
    inbox.mkdir()
    outbox.mkdir()
    job_id = "a" * 32
    media = staging / f"{job_id}.media"
    media.write_bytes(b"media")
    request = inbox / f"{job_id}.json"
    request.write_text(
        json.dumps({
            "job_id": job_id,
            "filename": media.name,
            "timeout_seconds": 5,
        }),
        encoding="utf-8",
    )
    expected = {
        "video": {"width": 1920, "height": 1080},
        "is_4k_bitstream": False,
        "hdr_bitstream_claim": False,
        "native_4k_verified": False,
        "verification_level": "local_bitstream_probe",
    }
    monkeypatch.setattr(
        probe_worker,
        "analyze_local_media_file",
        lambda path, timeout_seconds: expected,
    )

    assert probe_worker.process_request(request, inbox, outbox, staging) is True
    result = json.loads((outbox / f"{job_id}.json").read_text())
    assert result == {"ok": True, "report": expected}


def test_probe_worker_rejects_path_traversal_filename(tmp_path, monkeypatch):
    staging = tmp_path / "staging"
    inbox = tmp_path / "inbox"
    outbox = tmp_path / "outbox"
    staging.mkdir()
    inbox.mkdir()
    outbox.mkdir()
    job_id = "b" * 32
    request = inbox / f"{job_id}.json"
    request.write_text(
        json.dumps({
            "job_id": job_id,
            "filename": "../../etc/passwd",
            "timeout_seconds": 5,
        }),
        encoding="utf-8",
    )
    called = False

    def unexpected_probe(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("unsafe path must not reach ffprobe")

    monkeypatch.setattr(probe_worker, "analyze_local_media_file", unexpected_probe)
    assert probe_worker.process_request(request, inbox, outbox, staging) is False
    assert called is False
    assert list(outbox.iterdir()) == []
