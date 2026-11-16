#!/usr/bin/env bash
set -euo pipefail

IMAGE="${COLLECTOR_TEST_IMAGE:-libretv-scrapling-collector:ci}"
NETWORK="libretv-scrapling-firewall-test"
COLLECTOR_IP="172.30.60.10"
COLLECTOR_CIDR="172.30.60.0/24"
TARGET_IP="172.30.60.11"
GATEWAY_IP="172.30.60.1"
CHAIN="LIBRETV-SCRAPLING-EGRESS"
HOST_SERVER_PID=""

cleanup() {
  if [[ -n "$HOST_SERVER_PID" ]]; then kill "$HOST_SERVER_PID" >/dev/null 2>&1 || true; fi
  docker rm -f scrapling-firewall-target >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  sudo iptables -w -D DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN" >/dev/null 2>&1 || true
  sudo iptables -w -D FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN" >/dev/null 2>&1 || true
  sudo iptables -w -D INPUT -s "$COLLECTOR_CIDR" -j DROP >/dev/null 2>&1 || true
  sudo iptables -w -F "$CHAIN" >/dev/null 2>&1 || true
  sudo iptables -w -X "$CHAIN" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker info >/dev/null
docker image inspect "$IMAGE" >/dev/null
docker network create --driver bridge --subnet 172.30.60.0/24 "$NETWORK" >/dev/null

docker run -d --name scrapling-firewall-target \
  --network "$NETWORK" --ip "$TARGET_IP" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint python "$IMAGE" -m http.server 8000 --bind 0.0.0.0 >/dev/null

python3 -m http.server 18080 --bind 0.0.0.0 >/tmp/scrapling-firewall-host.log 2>&1 &
HOST_SERVER_PID=$!

probe_container() {
  local target="$1"
  docker run --rm --network "$NETWORK" --ip "$COLLECTOR_IP" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint python "$IMAGE" -c \
    "import urllib.request; urllib.request.urlopen('http://$target', timeout=3).read(32)"
}

ready=0
for attempt in $(seq 1 30); do
  if probe_container "$TARGET_IP:8000" >/dev/null 2>&1 && curl --fail --silent http://127.0.0.1:18080/ >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Firewall test fixtures did not become reachable before rules were installed." >&2
  exit 1
fi

# Prove both targets are reachable before enforcement, so a later failure is
# evidence of filtering rather than an absent service or route.
probe_container "$TARGET_IP:8000"
probe_container "$GATEWAY_IP:18080"

sudo env COLLECTOR_CIDR="$COLLECTOR_CIDR" bash scripts/scrapling-egress-firewall.sh
sudo iptables -w -C DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN"
sudo iptables -w -C FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN"
sudo iptables -w -C INPUT -s "$COLLECTOR_CIDR" -j DROP

if probe_container "$TARGET_IP:8000" >/dev/null 2>&1; then
  echo "FAIL: collector container reached a private-network peer after firewall installation." >&2
  exit 1
fi
if probe_container "$GATEWAY_IP:18080" >/dev/null 2>&1; then
  echo "FAIL: collector container reached a host-local service after firewall installation." >&2
  exit 1
fi

echo "PASS: live iptables test blocked collector-to-private-peer and collector-to-host traffic."
