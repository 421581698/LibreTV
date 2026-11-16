import pytest
from pydantic import SecretStr

from app.config import is_loopback_host, validate_bind_security


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "localhost"])
def test_loopback_hosts_do_not_require_api_key(host: str) -> None:
    assert is_loopback_host(host)
    validate_bind_security(host, None)


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.0.2.10", "crawler.internal"])
def test_non_loopback_hosts_require_api_key(host: str) -> None:
    assert not is_loopback_host(host)
    with pytest.raises(RuntimeError, match="SCRAPLING_API_KEY is required"):
        validate_bind_security(host, None)


def test_non_loopback_host_accepts_configured_api_key() -> None:
    validate_bind_security("0.0.0.0", SecretStr("x" * 32))
