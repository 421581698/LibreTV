#!/usr/bin/env bash
set -euo pipefail

# Runtime acceptance for the opt-in crawler profile. This intentionally runs
# only on an isolated CI runner; it creates and removes its own Compose volumes.
: "${PASSWORD:?PASSWORD is required}"
: "${SCRAPLING_API_KEY:?SCRAPLING_API_KEY is required}"
: "${SCRAPLING_DB_PASSWORD:?SCRAPLING_DB_PASSWORD is required}"

compose=(docker compose --profile crawler)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" config --quiet
"${compose[@]}" up -d --build scrapling-postgres scrapling-engine scrapling-job-worker scrapling-workflow-worker

ready=0
for attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T scrapling-postgres pg_isready -U libretv_scrapling -d libretv_scrapling >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || { echo "PostgreSQL did not become ready"; exit 1; }

for service in scrapling-engine scrapling-job-worker scrapling-workflow-worker; do
  container=$("${compose[@]}" ps -q "$service")
  test -n "$container"

  running=$(docker inspect --format '{{.State.Running}}' "$container")
  [[ "$running" == "true" ]] || { echo "$service is not running"; docker logs "$container"; exit 1; }
  user=$(docker inspect --format '{{.Config.User}}' "$container")
  readonly=$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container")
  pids=$(docker inspect --format '{{.HostConfig.PidsLimit}}' "$container")
  memory=$(docker inspect --format '{{.HostConfig.Memory}}' "$container")
  nano_cpus=$(docker inspect --format '{{.HostConfig.NanoCpus}}' "$container")
  cap_drop=$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container")
  security_opt=$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$container")
  tmpfs=$(docker inspect --format '{{json .HostConfig.Tmpfs}}' "$container")

  [[ "$user" == "10001:10001" ]] || { echo "$service: unexpected user $user"; exit 1; }
  [[ "$readonly" == "true" ]] || { echo "$service: root filesystem is writable"; exit 1; }
  [[ "$pids" -gt 0 && "$pids" -le 128 ]] || { echo "$service: invalid PID limit $pids"; exit 1; }
  [[ "$memory" -gt 0 ]] || { echo "$service: memory limit is missing"; exit 1; }
  [[ "$nano_cpus" -gt 0 ]] || { echo "$service: CPU limit is missing"; exit 1; }
  grep -q '"ALL"' <<<"$cap_drop" || { echo "$service: CAP_DROP ALL is missing"; exit 1; }
  grep -q 'no-new-privileges' <<<"$security_opt" || { echo "$service: no-new-privileges is missing"; exit 1; }
  grep -q '/tmp' <<<"$tmpfs" || { echo "$service: /tmp tmpfs is missing"; exit 1; }
  grep -q 'noexec' <<<"$tmpfs" || { echo "$service: /tmp noexec is missing"; exit 1; }
  grep -q 'nosuid' <<<"$tmpfs" || { echo "$service: /tmp nosuid is missing"; exit 1; }
  grep -q 'nodev' <<<"$tmpfs" || { echo "$service: /tmp nodev is missing"; exit 1; }

  actual_uid=$("${compose[@]}" exec -T "$service" id -u)
  actual_gid=$("${compose[@]}" exec -T "$service" id -g)
  [[ "$actual_uid" == "10001" && "$actual_gid" == "10001" ]] || {
    echo "$service: runtime identity is $actual_uid:$actual_gid"
    exit 1
  }

  # The shared durable volume must be writable by the unprivileged process.
  "${compose[@]}" exec -T "$service" sh -ec 'f="/data/.runtime-acceptance-$$"; : > "$f"; rm "$f"'
  echo "$service: uid, read-only rootfs, tmpfs, resource limits and /data write passed"
done

echo "Crawler container runtime acceptance passed."
