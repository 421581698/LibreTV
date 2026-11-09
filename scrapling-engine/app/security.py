from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit


class UnsafeTargetError(ValueError):
    pass


def validate_public_http_url(url: str) -> str:
    """Reject non-HTTP URLs and destinations that resolve to non-public IPs."""
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeTargetError("Only absolute public HTTP(S) URLs are allowed.")
    if parsed.username or parsed.password:
        raise UnsafeTargetError("Credentials in target URLs are not allowed.")
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost"):
        raise UnsafeTargetError("Localhost targets are not allowed.")

    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            records = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        except socket.gaierror as exc:
            raise UnsafeTargetError("Target host could not be resolved.") from exc
        addresses = {ipaddress.ip_address(record[4][0]) for record in records}

    if not addresses or any(
        not address.is_global or address.is_private or address.is_loopback
        or address.is_link_local or address.is_reserved or address.is_multicast
        for address in addresses
    ):
        raise UnsafeTargetError("Private, local, reserved or non-public targets are not allowed.")
    return url
