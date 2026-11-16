from __future__ import annotations

import json
import os
import selectors
import signal
import stat
import subprocess
import time
from pathlib import Path
from typing import Any

DEFAULT_PROBE_ROOT = Path("/tmp/libretv-media-probe")
MAX_MEDIA_FILE_BYTES = 2 * 1024 * 1024 * 1024
MAX_PROBE_OUTPUT_BYTES = 1024 * 1024
PROBE_TIMEOUT_SECONDS = 20


class MediaProbeError(ValueError):
    """A local media file could not be safely or reliably probed."""


def _probe_root() -> Path:
    root = Path(os.environ.get("MEDIA_PROBE_ROOT", str(DEFAULT_PROBE_ROOT)))
    if root.is_symlink():
        raise MediaProbeError("The media probe root cannot be a symbolic link")
    if not root.exists():
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not root.is_dir():
        raise MediaProbeError("The media probe root must be a directory")
    return root.resolve(strict=True)


def _safe_media_path(path: str | Path) -> Path:
    candidate = Path(path)
    if candidate.is_symlink():
        raise MediaProbeError("Symbolic links are not accepted for media probing")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(_probe_root())
    except (OSError, ValueError) as exc:
        raise MediaProbeError("Media file must exist inside MEDIA_PROBE_ROOT") from exc
    try:
        metadata = resolved.stat()
    except OSError as exc:
        raise MediaProbeError("Media file cannot be inspected") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise MediaProbeError("Only regular local media files can be probed")
    if metadata.st_size <= 0:
        raise MediaProbeError("Media file is empty")
    if metadata.st_size > MAX_MEDIA_FILE_BYTES:
        raise MediaProbeError("Media file exceeds the 2 GiB probe limit")
    return resolved


def _ratio(value: Any) -> float | None:
    if not isinstance(value, str) or "/" not in value:
        return None
    numerator, denominator = value.split("/", 1)
    try:
        divisor = float(denominator)
        return float(numerator) / divisor if divisor else None
    except ValueError:
        return None


def analyze_local_media_file(
    path: str | Path,
    *,
    timeout_seconds: int = PROBE_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Probe a previously downloaded local file; ffprobe is never given a network URL."""
    if not 1 <= timeout_seconds <= 60:
        raise MediaProbeError("Probe timeout must be between 1 and 60 seconds")
    media_path = _safe_media_path(path)
    command = [
        "ffprobe",
        "-v", "error",
        "-protocol_whitelist", "file,pipe",
        "-max_alloc", str(64 * 1024 * 1024),
        "-probesize", str(10 * 1024 * 1024),
        "-analyzeduration", str(10 * 1000 * 1000),
        "-show_entries",
        "format=format_name,duration,size,bit_rate:"
        "stream=index,codec_type,codec_name,profile,width,height,pix_fmt,"
        "avg_frame_rate,r_frame_rate,bit_rate,color_range,color_space,"
        "color_transfer,color_primaries,bits_per_raw_sample:"
        "stream_side_data=side_data_type",
        "-of", "json",
        str(media_path),
    ]
    stdout = bytearray()
    stderr = bytearray()
    deadline = time.monotonic() + timeout_seconds
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            shell=False,
            cwd=str(_probe_root()),
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C"},
            close_fds=True,
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        raise MediaProbeError("ffprobe is not installed in the worker image") from exc

    assert process.stdout is not None and process.stderr is not None
    streams = {process.stdout: (stdout, MAX_PROBE_OUTPUT_BYTES, "stdout"),
               process.stderr: (stderr, 64 * 1024, "stderr")}
    selector = selectors.DefaultSelector()
    try:
        for stream in streams:
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise MediaProbeError("Media probe timed out")
            for key, _ in selector.select(min(remaining, 0.25)):
                stream = key.fileobj
                chunk = os.read(stream.fileno(), 64 * 1024)
                if not chunk:
                    selector.unregister(stream)
                    stream.close()
                    continue
                buffer, limit, label = streams[stream]
                if len(buffer) + len(chunk) > limit:
                    raise MediaProbeError(
                        "ffprobe output exceeds the 1 MiB limit"
                        if label == "stdout"
                        else "ffprobe diagnostics exceed the 64 KiB limit"
                    )
                buffer.extend(chunk)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise MediaProbeError("Media probe timed out")
        return_code = process.wait(timeout=remaining)
    except (subprocess.TimeoutExpired, TimeoutError) as exc:
        raise MediaProbeError("Media probe timed out") from exc
    except BaseException:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait()
        raise
    finally:
        selector.close()
        for stream in (process.stdout, process.stderr):
            if not stream.closed:
                stream.close()
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()

    if return_code != 0:
        raise MediaProbeError("ffprobe could not parse the local media file")
    try:
        payload = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MediaProbeError("ffprobe returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise MediaProbeError("ffprobe returned an invalid report")
    streams = payload.get("streams")
    if not isinstance(streams, list) or not streams:
        raise MediaProbeError("Media file contains no readable streams")

    video = next(
        (
            stream
            for stream in streams
            if isinstance(stream, dict) and stream.get("codec_type") == "video"
        ),
        None,
    )
    if video is None:
        raise MediaProbeError("Media file contains no video stream")
    width = video.get("width") if isinstance(video.get("width"), int) else None
    height = video.get("height") if isinstance(video.get("height"), int) else None
    transfer = str(video.get("color_transfer") or "").lower()
    hdr = transfer in {"smpte2084", "arib-std-b67"}
    side_data = video.get("side_data_list")
    side_data_types = [
        item.get("side_data_type")
        for item in side_data or []
        if isinstance(item, dict) and isinstance(item.get("side_data_type"), str)
    ]
    format_info = payload.get("format")
    format_info = format_info if isinstance(format_info, dict) else {}
    is_4k = bool(width and height and width >= 3840 and height >= 2160)
    return {
        "container": format_info.get("format_name"),
        "duration_seconds": _safe_float(format_info.get("duration")),
        "file_size_bytes": _safe_int(format_info.get("size")) or media_path.stat().st_size,
        "container_bitrate_bps": _safe_int(format_info.get("bit_rate")),
        "video": {
            "codec": video.get("codec_name"),
            "profile": video.get("profile"),
            "width": width,
            "height": height,
            "pixel_format": video.get("pix_fmt"),
            "frame_rate_fps": (
                _ratio(video.get("avg_frame_rate"))
                or _ratio(video.get("r_frame_rate"))
            ),
            "bitrate_bps": _safe_int(video.get("bit_rate")),
            "color_range": video.get("color_range"),
            "color_space": video.get("color_space"),
            "color_transfer": video.get("color_transfer"),
            "color_primaries": video.get("color_primaries"),
            "bits_per_raw_sample": _safe_int(video.get("bits_per_raw_sample")),
            "side_data_types": side_data_types,
        },
        "resolution_verified": True,
        "is_4k_bitstream": is_4k,
        "hdr_bitstream_claim": hdr,
        "native_4k_verified": False,
        "upscaled_4k": "unknown",
        "verification_level": "local_bitstream_probe",
        "limitations": [
            (
                "ffprobe reads encoded stream dimensions and metadata; it cannot prove "
                "the source was natively captured or mastered at 4K."
            ),
            (
                "HDR classification is based on stream color metadata and may still "
                "be missing or incorrect."
            ),
            "This probe does not decode frames or perform visual quality analysis.",
        ],
    }


def _safe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
