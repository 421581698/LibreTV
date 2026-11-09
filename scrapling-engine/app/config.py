from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8787
    log_level: str = "INFO"
    request_timeout_seconds: float = 25.0
    max_response_bytes: int = 5 * 1024 * 1024
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
