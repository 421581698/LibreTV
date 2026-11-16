from __future__ import annotations

import asyncio
import ipaddress
import socket

import pytest

from app.egress_proxy import (
    EgressDenied,
    open_pinned_connection,
    resolve_public_addresses,
)


def _record(address: str):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    sockaddr = (address, 443, 0, 0) if family == socket.AF_INET6 else (address, 443)
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)


@pytest.mark.asyncio
async def test_resolver_accepts_public_addresses_and_returns_all_records():
    async def resolver(host, port, type):
        assert host == "public.example"
        assert port == 443
        assert type == socket.SOCK_STREAM
        return [_record("93.184.216.34"), _record("2606:2800:220:1:248:1893:25c8:1946")]

    addresses = await resolve_public_addresses("public.example", 443, resolver=resolver)
    assert [str(address) for address in addresses] == [
        "93.184.216.34",
        "2606:2800:220:1:248:1893:25c8:1946",
    ]


@pytest.mark.asyncio
async def test_resolver_rejects_mixed_public_and_private_answers():
    async def resolver(host, port, type):
        return [_record("93.184.216.34"), _record("10.0.0.8")]

    with pytest.raises(EgressDenied, match="Every resolved address"):
        await resolve_public_addresses("rebinding.example", 443, resolver=resolver)


@pytest.mark.asyncio
async def test_resolver_rejects_metadata_and_local_names():
    with pytest.raises(EgressDenied):
        await resolve_public_addresses("169.254.169.254", 443)
    with pytest.raises(EgressDenied):
        await resolve_public_addresses("metadata.local", 443)


@pytest.mark.asyncio
async def test_open_connection_uses_pinned_ip_not_hostname(monkeypatch):
    pinned = ["93.184.216.34"]
    observed = {}

    async def fake_resolve(host, port):
        assert host == "public.example"
        assert port == 443
        return [ipaddress.ip_address(pinned[0])]

    async def fake_open_connection(host, port):
        observed["host"] = host
        observed["port"] = port
        return object(), object()

    monkeypatch.setattr("app.egress_proxy.resolve_public_addresses", fake_resolve)
    monkeypatch.setattr(asyncio, "open_connection", fake_open_connection)
    _reader, _writer, address = await open_pinned_connection("public.example", 443)
    assert observed == {"host": "93.184.216.34", "port": 443}
    assert str(address) == "93.184.216.34"
