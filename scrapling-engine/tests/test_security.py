import pytest

from app.security import UnsafeTargetError, validate_public_http_url


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://localhost/admin",
        "http://127.0.0.1/",
        "http://10.0.0.2/",
        "https://user:pass@example.com/",
    ],
)
def test_rejects_unsafe_targets(url: str) -> None:
    with pytest.raises(UnsafeTargetError):
        validate_public_http_url(url)


def test_rejects_non_http_scheme() -> None:
    with pytest.raises(UnsafeTargetError):
        validate_public_http_url("ftp://example.com/file")
