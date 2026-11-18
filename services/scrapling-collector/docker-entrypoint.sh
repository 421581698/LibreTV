#!/bin/sh
set -eu

# Render mounts persistent disks after the image is built, which can replace
# the image's original /data ownership. Fix the mounted volume, then drop
# privileges before starting the collector.
mkdir -p /data
chown -R collector:collector /data

if [ "${SCRAPLING_RUN_WORKER:-0}" = "1" ]; then
  # Render's single persistent disk cannot be mounted by two services. Run the
  # API and its durable queue worker in this same container so both share the
  # exact same SQLite database.
  (
    while :; do
      gosu collector python /app/worker.py --worker-id "${SCRAPLING_WORKER_ID:-render-collector-worker}" || true
      sleep 5
    done
  ) &
  worker_supervisor_pid=$!

  gosu collector "$@" &
  api_pid=$!
  terminate() {
    kill "$api_pid" "$worker_supervisor_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
    wait "$worker_supervisor_pid" 2>/dev/null || true
  }
  trap terminate INT TERM
  set +e
  wait "$api_pid"
  api_status=$?
  set -e
  terminate
  exit "$api_status"
fi

exec gosu collector "$@"
