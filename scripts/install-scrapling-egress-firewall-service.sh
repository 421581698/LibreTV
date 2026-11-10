#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is required for automatic firewall re-application." >&2
  exit 1
fi
if ! command -v iptables >/dev/null 2>&1; then
  echo "iptables is required; configure an equivalent persistent DOCKER-USER policy." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to validate the collector CIDR." >&2
  exit 1
fi
if ! iptables -w -nL DOCKER-USER >/dev/null 2>&1; then
  echo "Start Docker and create the collector Compose network before installing this unit." >&2
  exit 1
fi

COLLECTOR_CIDR="${COLLECTOR_CIDR:-172.30.60.10/32}"
python3 -c 'import ipaddress,sys; ipaddress.ip_network(sys.argv[1], strict=False)' "$COLLECTOR_CIDR"
install -D -m 0755 scripts/scrapling-egress-firewall.sh /usr/local/sbin/libretv-scrapling-egress-firewall

cat >/etc/systemd/system/libretv-scrapling-egress-firewall.service <<UNIT
[Unit]
Description=LibreTV Scrapling Collector Docker egress firewall
Requires=docker.service
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=COLLECTOR_CIDR=${COLLECTOR_CIDR}
ExecStart=/usr/local/sbin/libretv-scrapling-egress-firewall

[Install]
WantedBy=docker.service
UNIT

systemctl daemon-reload
systemctl enable --now libretv-scrapling-egress-firewall.service
systemctl --no-pager --full status libretv-scrapling-egress-firewall.service
iptables -w -C DOCKER-USER -s "$COLLECTOR_CIDR" -j LIBRETV-SCRAPLING-EGRESS
iptables -w -C INPUT -s "$COLLECTOR_CIDR" -j DROP
echo "Persistent firewall unit installed and enforcement hooks verified for $COLLECTOR_CIDR."
