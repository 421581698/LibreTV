from __future__ import annotations

import json
import subprocess

import pytest

from app.ffprobe_analyzer import MediaProbeError, analyze_local_media_file


def _media_file(tmp_path):
    root = tmp_path / "probe"
    root.mkdir()
    media = root / "sample.mp4"
    media.write_bytes(b"fake-media")
    return root, media


def test_probe_reports_encoded_dimensions_but_not_native_4k(tmp_path, monkeypatch):
    root, media = _media_file(tmp_path)
    monkeypatch.setenv("MEDIA_PROBE_ROOT", str(root))
    payload = {
        "format": {"format_name": "mov,mp4", "duration": "120.5", "size": "1024", "bit_rate": "9000000"},
        "streams": [{
            "codec_type": "video", "codec_name": "hevc", "profile": "Main 10",
            "width": 3840, "height": 2160, "pix_fmt": "yuv420p10le",
            "avg_frame_rate": "60000/1001", "color_transfer": "smpte2084",
            "color_primaries": "bt2020", "color_space": "bt2020nc",
            "bit_rate": "8000000", "side_data_list": [{"side_data_type": "Mastering display metadata"}],
        }],
    }

    def fake_run(command, **kwargs):
        assert command[0] == "ffprobe"
        assert "-protocol_whitelist" in command
        assert command[-1] == str(media)
        assert kwargs["shell"] is False
        assert kwargs["timeout"] <= 60
        return subprocess.CompletedProcess(command, 0, json.dumps(payload).encode(), b"")

    monkeypatch.setattr(subprocess, "run", fake_run)
    report = analyze_local_media_file(media)
    assert report["is_4k_bitstream"] is True
    assert report["hdr_bitstream_claim"] is True
    assert report["video"]["frame_rate_fps"] == pytest.approx(59.94, rel=1e-3)
    assert report["native_4k_verified"] is False
    assert report["verification_level"] == "local_bitstream_probe"


def test_probe_rejects_paths_outside_probe_root(tmp_path, monkeypatch):
    root, _ = _media_file(tmp_path)
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"data")
    monkeypatch.setenv("MEDIA_PROBE_ROOT", str(root))
    with pytest.raises(MediaProbeError, match="inside MEDIA_PROBE_ROOT"):
        analyze_local_media_file(outside)


def test_probe_rejects_symlink(tmp_path, monkeypatch):
    root, media = _media_file(tmp_path)
    link = root / "linked.mp4"
    link.symlink_to(media)
    monkeypatch.setenv("MEDIA_PROBE_ROOT", str(root))
    with pytest.raises(MediaProbeError, match="Symbolic links"):
        analyze_local_media_file(link)


def test_probe_timeout_is_bounded(tmp_path, monkeypatch):
    root, media = _media_file(tmp_path)
    monkeypatch.setenv("MEDIA_PROBE_ROOT", str(root))
    with pytest.raises(MediaProbeError, match="between 1 and 60"):
        analyze_local_media_file(media, timeout_seconds=120)


def test_probe_handles_timeout_and_missing_binary(tmp_path, monkeypatch):
    root, media = _media_file(tmp_path)
    monkeypatch.setenv("MEDIA_PROBE_ROOT", str(root))

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("ffprobe", 20)

    monkeypatch.setattr(subprocess, "run", timeout)
    with pytest.raises(MediaProbeError, match="timed out"):
        analyze_local_media_file(media)

    def missing(*args, **kwargs):
        raise FileNotFoundError()

    monkeypatch.setattr(subprocess, "run", missing)
    with pytest.raises(MediaProbeError, match="not installed"):
        analyze_local_media_file(media)


def test_probe_rejects_empty_or_invalid_stream_report(tmp_path, monkeypatch):
    root, media = _media_file(tmp_path)
    monkeypatch.setenv("MEDIA_PROBE_ROOT", str(root))
    monkeypatch.setattr(
        subprocess, "run",
        lambda command, **kwargs: subprocess.CompletedProcess(command, 0, b'{"streams":[]}', b""),
    )
    with pytest.raises(MediaProbeError, match="no readable streams"):
        analyze_local_media_file(media)
