from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    api_key: SecretStr | None = Field(
        default=None,
        validation_alias="SCRAPLING_API_KEY",
        min_length=32,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    port: int = Field(default=8787, ge=1, le=65535)
    log_level: str = "INFO"
    request_timeout_seconds: float = Field(default=25.0, gt=0, le=300)
    max_response_bytes: int = Field(default=5 * 1024 * 1024, gt=0, le=100 * 1024 * 1024)
    crawl_data_dir: str = "./crawl_data"
    job_database_path: str = Field(
        default="./crawl_data/jobs.sqlite3",
        validation_alias="CRAWL_JOB_DATABASE_PATH",
    )
    default_user_agent: str = (
        "LibreTV-Scrapling-Engine/0.1 "
        "(+respectful public resource discovery)"
    )

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")


settings = Settings()
