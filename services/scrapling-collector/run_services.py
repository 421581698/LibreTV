from __future__ import annotations

import os
import signal
import subprocess
import sys
import time


def main() -> int:
    port = os.environ.get("PORT", "10000")
    api = subprocess.Popen([
        sys.executable, "-m", "uvicorn", "app:app",
        "--host", "0.0.0.0", "--port", port, "--workers", "1",
    ])
    worker = subprocess.Popen([sys.executable, "worker.py"])
    processes = (api, worker)
    try:
        while all(process.poll() is None for process in processes):
            time.sleep(1)
        return next((process.returncode or 1 for process in processes if process.poll() is not None), 1)
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
