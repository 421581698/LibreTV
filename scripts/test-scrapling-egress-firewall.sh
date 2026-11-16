#!/usr/bin/env bash
set -euo pipefail

IMAGE="${COLLECTOR_TEST_IMAGE:-libretv-scrapling-collector:ci}"
NETWORK="libretv-scrapling-firewall-test"
APP_IP="172.30.60.2"
COLLECTOR_IP="172.30.60.10"
WORKER_IP="172.30.60.11"
COLLECTOR_CIDR="172.30.60.0/24"
TARGET_IP="172.30.60.13"
GATEWAY_IP="172.30.60.1"
CHAIN="LIBRETV-SCRAPLING-EGRESS"
MARKER_DIR="$(mktemp -d /tmp/libretv-scrapling-egress-proof.XXXXXX)"
HOST_SERVER_PID=""

cleanup() {
  if [[ -n "$HOST_SERVER_PID" ]]; then kill "$HOST_SERVER_PID" >/dev/null 2>&1 || true; fi
  docker rm -f scrapling-firewall-target scrapling-firewall-api >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  sudo iptables -w -D DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN" >/dev/null 2>&1 || true
  sudo iptables -w -D FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN" >/dev/null 2>&1 || true
  sudo iptables -w -D INPUT -s "$COLLECTOR_CIDR" -j DROP >/dev/null 2>&1 || true
  sudo iptables -w -F "$CHAIN" >/dev/null 2>&1 || true
  sudo iptables -w -X "$CHAIN" >/dev/null 2>&1 || true
  rm -rf "$MARKER_DIR"
}
trap cleanup EXIT

docker info >/dev/null
docker image inspect "$IMAGE" >/dev/null
docker network create --driver bridge --subnet 172.30.60.0/24 "$NETWORK" >/dev/null

docker run -d --name scrapling-firewall-target \
  --network "$NETWORK" --ip "$TARGET_IP" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint python "$IMAGE" -m http.server 8001 --bind 0.0.0.0 >/dev/null

docker run -d --name scrapling-firewall-api \
  --network "$NETWORK" --ip "$COLLECTOR_IP" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint python "$IMAGE" -m http.server 8000 --bind 0.0.0.0 >/dev/null

python3 -m http.server 18080 --bind 0.0.0.0 >/tmp/scrapling-firewall-host.log 2>&1 &
HOST_SERVER_PID=$!

probe_container() {
  local source_ip="$1"
  local target="$2"
  docker run --rm --network "$NETWORK" --ip "$source_ip" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint python "$IMAGE" -c \
    "import urllib.request; urllib.request.urlopen('http://$target', timeout=3).read(32)"
}

ready=0
for attempt in $(seq 1 30); do
  if probe_container "$APP_IP" "$COLLECTOR_IP:8000" >/dev/null 2>&1 \
    && probe_container "$WORKER_IP" "$TARGET_IP:8001" >/dev/null 2>&1 \
    && curl --fail --silent http://127.0.0.1:18080/ >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Firewall test fixtures did not become reachable before rules were installed." >&2
  exit 1
fi

# Confirm the app-to-API flow, worker-to-private-peer flow, and host service
# are reachable before enforcement so the negative checks prove filtering.
probe_container "$APP_IP" "$COLLECTOR_IP:8000"
probe_container "$WORKER_IP" "$TARGET_IP:8001"
probe_container "$APP_IP" "$GATEWAY_IP:18080"

sudo env COLLECTOR_CIDR="$COLLECTOR_CIDR" LIBRETV_APP_IP="$APP_IP" SCRAPLING_API_IP="$COLLECTOR_IP" SCRAPLING_EGRESS_MARKER_DIR="$MARKER_DIR" bash scripts/scrapling-egress-firewall.sh
python3 - "$MARKER_DIR/confirmed.json" "$COLLECTOR_CIDR" "$APP_IP" "$COLLECTOR_IP" <<'PY'
import json
import sys
from pathlib import Path

marker = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert marker["policy_version"] == 1
assert marker["boot_id"] == Path("/proc/sys/kernel/random/boot_id").read_text().strip()
assert marker["collector_cidr"] == sys.argv[2]
assert marker["app_ip"] == sys.argv[3]
assert marker["api_ip"] == sys.argv[4]
assert marker["api_port"] == "8000"
print("PASS: current-boot firewall proof marker matches the enforced policy.")
PY
sudo iptables -w -C DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN"
sudo iptables -w -C FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN"
sudo iptables -w -C INPUT -s "$COLLECTOR_CIDR" -j DROP

# The LibreTV app keeps its one explicitly permitted Collector API connection.
probe_container "$APP_IP" "$COLLECTOR_IP:8000"

if probe_container "$WORKER_IP" "$TARGET_IP:8001" >/dev/null 2>&1; then
  echo "FAIL: worker reached a private-network peer after firewall installation." >&2
  exit 1
fi
if probe_container "$APP_IP" "$TARGET_IP:8001" >/dev/null 2>&1; then
  echo "FAIL: app reached an unrelated private-network peer after firewall installation." >&2
  exit 1
fi
if probe_container "$COLLECTOR_IP" "$TARGET_IP:8001" >/dev/null 2>&1; then
  echo "FAIL: Collector API reached an unrelated private-network peer after firewall installation." >&2
  exit 1
fi
if probe_container "$COLLECTOR_IP" "$GATEWAY_IP:18080" >/dev/null 2>&1; then
  echo "FAIL: Collector API reached a host-local service after firewall installation." >&2
  exit 1
fi
if probe_container "$WORKER_IP" "$GATEWAY_IP:18080" >/dev/null 2>&1; then
  echo "FAIL: worker reached a host-local service after firewall installation." >&2
  exit 1
fi
if probe_container "$APP_IP" "$GATEWAY_IP:18080" >/dev/null 2>&1; then
  echo "FAIL: app reached a host-local service after firewall installation." >&2
  exit 1
fi
if probe_container "$WORKER_IP" "$COLLECTOR_IP:8000" >/dev/null 2>&1; then
  echo "FAIL: worker initiated an unexpected connection to the Collector API." >&2
  exit 1
fi

echo "PASS: live iptables test preserved app-to-API access and blocked other private/host traffic."
