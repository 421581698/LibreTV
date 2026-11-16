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

@pytest.mark.asyncio
async def test_connect_proxy_tunnels_tls_bytes_to_pinned_peer(monkeypatch):
    from app import egress_proxy

    async def echo(reader, writer):
        payload = await reader.readexactly(16)
        writer.write(payload)
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    target_server = await asyncio.start_server(echo, "127.0.0.1", 0)
    target_port = target_server.sockets[0].getsockname()[1]

    async def fake_open_pinned_connection(host, port):
        assert host == "example.com"
        assert port == 443
        return await asyncio.open_connection("127.0.0.1", target_port) + (
            ipaddress.ip_address("93.184.216.34"),
        )

    monkeypatch.setattr(egress_proxy, "open_pinned_connection", fake_open_pinned_connection)
    proxy_server = await asyncio.start_server(egress_proxy.handle_client, "127.0.0.1", 0)
    proxy_port = proxy_server.sockets[0].getsockname()[1]
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", proxy_port)
        writer.write(
            b"CONNECT example.com:443 HTTP/1.1\r\n"
            b"Host: example.com:443\r\n\r\n"
        )
        await writer.drain()
        response = await reader.readuntil(b"\r\n\r\n")
        assert response.startswith(b"HTTP/1.1 200")
        writer.write(b"tls-client-hello")
        await writer.drain()
        assert await asyncio.wait_for(reader.readexactly(16), timeout=3) == b"tls-client-hello"
        writer.close()
        await writer.wait_closed()
    finally:
        proxy_server.close()
        target_server.close()
        await proxy_server.wait_closed()
        await target_server.wait_closed()


@pytest.mark.asyncio
async def test_http_proxy_rewrites_absolute_target_and_closes_connection(monkeypatch):
    from app import egress_proxy

    observed = {}

    async def target(reader, writer):
        observed["request"] = await reader.readuntil(b"\r\n\r\n")
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    target_server = await asyncio.start_server(target, "127.0.0.1", 0)
    target_port = target_server.sockets[0].getsockname()[1]

    async def fake_open_pinned_connection(host, port):
        assert host == "example.com"
        assert port == 80
        return await asyncio.open_connection("127.0.0.1", target_port) + (
            ipaddress.ip_address("93.184.216.34"),
        )

    monkeypatch.setattr(egress_proxy, "open_pinned_connection", fake_open_pinned_connection)
    proxy_server = await asyncio.start_server(egress_proxy.handle_client, "127.0.0.1", 0)
    proxy_port = proxy_server.sockets[0].getsockname()[1]
    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", proxy_port)
        writer.write(
            b"GET http://example.com/catalog?q=1 HTTP/1.1\r\n"
            b"Host: example.com\r\n"
            b"Proxy-Connection: keep-alive\r\n\r\n"
        )
        await writer.drain()
        response = await reader.read()
        assert response.startswith(b"HTTP/1.1 200 OK")
        assert b"GET /catalog?q=1 HTTP/1.1" in observed["request"]
        assert b"Proxy-Connection" not in observed["request"]
        writer.close()
        await writer.wait_closed()
    finally:
        proxy_server.close()
        target_server.close()
        await proxy_server.wait_closed()
        await target_server.wait_closed()


@pytest.mark.asyncio
async def test_http_redirect_to_metadata_is_revalidated_by_proxy(monkeypatch):
    from scrapling.fetchers import Fetcher

    from app import egress_proxy

    async def redirect_to_metadata(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(
            b"HTTP/1.1 302 Found\r\n"
            b"Location: http://169.254.169.254/latest/meta-data/\r\n"
            b"Content-Length: 0\r\n"
            b"Connection: close\r\n\r\n"
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    target_server = await asyncio.start_server(
        redirect_to_metadata,
        "127.0.0.1",
        0,
    )
    target_port = target_server.sockets[0].getsockname()[1]
    real_resolve = egress_proxy.resolve_public_addresses

    async def fake_resolve(host, port):
        if host == "redirect.test":
            return [ipaddress.ip_address("127.0.0.1")]
        return await real_resolve(host, port)

    monkeypatch.setattr(egress_proxy, "resolve_public_addresses", fake_resolve)

    async def fake_open_pinned_connection(host, port):
        addresses = await egress_proxy.resolve_public_addresses(host, port)
        if host == "redirect.test":
            reader, writer = await asyncio.open_connection("127.0.0.1", target_port)
            return reader, writer, addresses[0]
        raise egress_proxy.EgressDenied("non-public redirect denied")

    monkeypatch.setattr(
        egress_proxy,
        "open_pinned_connection",
        fake_open_pinned_connection,
    )
    proxy_server = await asyncio.start_server(egress_proxy.handle_client, "127.0.0.1", 0)
    proxy_port = proxy_server.sockets[0].getsockname()[1]
    try:
        page = await asyncio.to_thread(
            Fetcher.get,
            "http://redirect.test/",
            timeout=5,
            follow_redirects=True,
            proxy=f"http://127.0.0.1:{proxy_port}",
            impersonate=None,
            stealthy_headers=False,
        )
        assert page.status == 403
    finally:
        proxy_server.close()
        target_server.close()
        await proxy_server.wait_closed()
        await target_server.wait_closed()



@pytest.mark.asyncio
async def test_public_ipv4_mapped_ipv6_literal_is_pinned_as_ipv4():
    addresses = await resolve_public_addresses("::ffff:93.184.216.34", 443)
    assert len(addresses) == 1
    assert addresses[0].version == 4
    assert str(addresses[0]) == "93.184.216.34"


@pytest.mark.asyncio
async def test_private_ipv4_mapped_ipv6_literal_is_rejected():
    with pytest.raises(EgressDenied):
        await resolve_public_addresses("::ffff:127.0.0.1", 443)



@pytest.mark.asyncio
@pytest.mark.parametrize("address", ["224.0.0.1", "240.0.0.1", "255.255.255.255"])
async def test_proxy_rejects_multicast_and_reserved_ip_literals(address: str):
    with pytest.raises(EgressDenied):
        await resolve_public_addresses(address, 443)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        [b"Transfer-Encoding: chunked"],
        [b"Content-Length: not-a-number"],
        [b"Content-Length: 1"],
        [b"MalformedHeaderWithoutColon"],
    ],
)
async def test_http_proxy_rejects_invalid_headers_before_opening_target(monkeypatch, headers):
    from app import egress_proxy

    async def unexpected_open(*args, **kwargs):
        raise AssertionError("Outbound socket opened before request validation")

    monkeypatch.setattr(egress_proxy, "open_pinned_connection", unexpected_open)
    with pytest.raises(EgressDenied):
        await egress_proxy._handle_http(
            "GET http://example.com/catalog HTTP/1.1",
            headers,
            object(),
            object(),
        )


@pytest.mark.asyncio
async def test_dns_rebinding_second_resolution_rejects_private_answer():
    answers = iter(
        [
            [_record("93.184.216.34")],
            [_record("169.254.169.254")],
        ]
    )

    async def resolver(host, port, type):
        return next(answers)

    first = await resolve_public_addresses(
        "rebind.example", 443, resolver=resolver
    )
    assert [str(address) for address in first] == ["93.184.216.34"]

    with pytest.raises(EgressDenied, match="Every resolved address"):
        await resolve_public_addresses(
            "rebind.example", 443, resolver=resolver
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target",
    [
        "https://example.com/",
        "ftp://example.com/file",
        "file:///etc/passwd",
        "http://example.com:8080/",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
    ],
)
async def test_http_proxy_rejects_unsupported_scheme_ports_and_private_targets(
    monkeypatch, target: str
):
    from app import egress_proxy

    async def unexpected_open(*args, **kwargs):
        raise AssertionError("Outbound socket opened for a denied target")

    monkeypatch.setattr(
        egress_proxy, "open_pinned_connection", unexpected_open
    )
    with pytest.raises(EgressDenied):
        await egress_proxy._handle_http(
            f"GET {target} HTTP/1.1",
            [],
            object(),
            object(),
        )
