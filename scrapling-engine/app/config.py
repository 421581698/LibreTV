import ipaddress

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def validate_bind_security(host: str, api_key: SecretStr | None) -> None:
    if api_key is None and not is_loopback_host(host):
        raise RuntimeError(
            "SCRAPLING_API_KEY is required when the service binds to a non-loopback host."
        )


class Settings(BaseSettings):
    host: str = Field(default="127.0.0.1", validation_alias="HOST")
    api_key: SecretStr | None = Field(
        default=None,
        validation_alias="SCRAPLING_API_KEY",
        min_length=32,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    port: int = Field(default=8787, ge=1, le=65535, validation_alias="PORT")
    log_level: str = "INFO"
    request_timeout_seconds: float = Field(default=25.0, gt=0, le=300)
    max_response_bytes: int = Field(default=5 * 1024 * 1024, gt=0, le=100 * 1024 * 1024)
    crawl_data_dir: str = "./crawl_data"
    job_database_path: str = Field(
        default="./crawl_data/jobs.sqlite3",
        validation_alias="CRAWL_JOB_DATABASE_PATH",
    )
    database_url: str | None = Field(default=None, validation_alias="DATABASE_URL")
    egress_proxy_url: str | None = Field(default=None, validation_alias="SCRAPLING_EGRESS_PROXY")
    supervisor_api_base: str = Field(
        default="https://api.openai.com/v1",
        validation_alias="SUPERVISOR_API_BASE",
    )
    supervisor_api_key: SecretStr | None = Field(
        default=None,
        validation_alias="SUPERVISOR_API_KEY",
    )
    supervisor_model: str = Field(default="", validation_alias="SUPERVISOR_MODEL")
    supervisor_timeout_seconds: float = Field(
        default=45.0,
        gt=0,
        le=120,
        validation_alias="SUPERVISOR_TIMEOUT_SECONDS",
    )
    default_user_agent: str = (
        "LibreTV-Scrapling-Engine/0.1 "
        "(+respectful public resource discovery)"
    )

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")


settings = Settings()
