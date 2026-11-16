#!/usr/bin/env bash
set -euo pipefail

# Apply host-level Docker egress filtering to every container on the isolated
# Scrapling network (API and worker), not just the API's static address.
# Run on the Docker host as root after creating the Compose network.
# Override COLLECTOR_CIDR if SCRAPLING_NETWORK_SUBNET is changed.
COLLECTOR_CIDR="${COLLECTOR_CIDR:-172.30.60.0/24}"
CHAIN="LIBRETV-SCRAPLING-EGRESS"
LIBRETV_APP_IP="${LIBRETV_APP_IP:-172.30.60.2}"
SCRAPLING_API_IP="${SCRAPLING_API_IP:-172.30.60.10}"
SCRAPLING_API_PORT="${SCRAPLING_API_PORT:-8000}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (for example: sudo $0)" >&2
  exit 1
fi
if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables is required; configure equivalent DOCKER-USER rules with your host firewall." >&2
  exit 1
fi
if ! iptables -w -nL DOCKER-USER >/dev/null 2>&1; then
  echo "Docker DOCKER-USER chain is unavailable. Start Docker with its iptables firewall integration enabled." >&2
  exit 1
fi
# Same-bridge container traffic can bypass the FORWARD chain unless bridge
# netfilter is enabled. Require this kernel hook so DOCKER-USER also sees
# container-to-container packets on the isolated collector bridge.
if [[ ! -e /proc/sys/net/bridge/bridge-nf-call-iptables ]]; then
  modprobe br_netfilter
fi
if [[ ! -e /proc/sys/net/bridge/bridge-nf-call-iptables ]]; then
  echo "br_netfilter is unavailable; refusing to claim complete Docker egress filtering." >&2
  exit 1
fi
sysctl -w net.bridge.bridge-nf-call-iptables=1 >/dev/null
if [[ "$(cat /proc/sys/net/bridge/bridge-nf-call-iptables)" != "1" ]]; then
  echo "Could not enable bridge netfilter for Docker traffic." >&2
  exit 1
fi

iptables -w -N "$CHAIN" 2>/dev/null || true
iptables -w -F "$CHAIN"

# Keep the app's one required connection to the authenticated Collector API.
# Only the LibreTV app may initiate TCP connections to the API port; replies
# from the API to that app are allowed only for established/related sessions.
iptables -w -A "$CHAIN" -s "$LIBRETV_APP_IP/32" -d "$SCRAPLING_API_IP/32" -p tcp --dport "$SCRAPLING_API_PORT" -m conntrack --ctstate NEW,ESTABLISHED -j RETURN
iptables -w -A "$CHAIN" -s "$SCRAPLING_API_IP/32" -d "$LIBRETV_APP_IP/32" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN

# Deny loopback, private, carrier-grade NAT, link-local, documentation,
# benchmarking, multicast, and reserved IPv4 destinations.
for cidr in \
  0.0.0.0/8 \
  10.0.0.0/8 \
  100.64.0.0/10 \
  127.0.0.0/8 \
  169.254.0.0/16 \
  172.16.0.0/12 \
  192.0.0.0/24 \
  192.0.2.0/24 \
  192.88.99.0/24 \
  192.168.0.0/16 \
  198.18.0.0/15 \
  198.51.100.0/24 \
  203.0.113.0/24 \
  224.0.0.0/4 \
  240.0.0.0/4
do
  iptables -w -A "$CHAIN" -d "$cidr" -j DROP
done

# Permit replies to collector-initiated public connections, then let Docker's
# normal forwarding policy handle all other public destinations.
# Keep this after the destination deny rules so pre-existing conntrack entries
# cannot bypass newly installed private/reserved-network blocks.
iptables -w -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -w -A "$CHAIN" -j RETURN

# Replace any previous jump for this collector source without disturbing
# unrelated DOCKER-USER rules.
while iptables -w -C DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN" 2>/dev/null; do
  iptables -w -D DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN"
done
iptables -w -I DOCKER-USER 1 -s "$COLLECTOR_CIDR" -j "$CHAIN"

# Same-bridge traffic may be accepted by Docker's bridge rules without
# traversing DOCKER-USER on every supported host/kernel combination. Add a
# source-scoped FORWARD hook as defense in depth so private destinations are
# checked before Docker's per-bridge ACCEPT rules.
while iptables -w -C FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN" 2>/dev/null; do
  iptables -w -D FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN"
done
iptables -w -I FORWARD 1 -s "$COLLECTOR_CIDR" -j "$CHAIN"

# DOCKER-USER/FORWARD only see forwarded packets. Block direct access from the
# collector to host-local services as well (bridge gateway / host interfaces).
while iptables -w -C INPUT -s "$COLLECTOR_CIDR" -j DROP 2>/dev/null; do
  iptables -w -D INPUT -s "$COLLECTOR_CIDR" -j DROP
done
iptables -w -I INPUT 1 -s "$COLLECTOR_CIDR" -j DROP

# Fail the installer if either enforcement hook is not actually present.
iptables -w -C DOCKER-USER -s "$COLLECTOR_CIDR" -j "$CHAIN"
iptables -w -C FORWARD -s "$COLLECTOR_CIDR" -j "$CHAIN"
iptables -w -C INPUT -s "$COLLECTOR_CIDR" -j DROP

echo "Verified IPv4 egress restrictions for Scrapling collector $COLLECTOR_CIDR."
echo "Only LibreTV app -> Collector API TCP/$SCRAPLING_API_PORT is allowed inside the private subnet; other private/reserved destinations are blocked."
echo "IPv6 is disabled in the collector container by docker-compose.yml."
echo "To remove these rules: iptables -D DOCKER-USER -s $COLLECTOR_CIDR -j $CHAIN; iptables -D FORWARD -s $COLLECTOR_CIDR -j $CHAIN; iptables -D INPUT -s $COLLECTOR_CIDR -j DROP; iptables -F $CHAIN; iptables -X $CHAIN"
