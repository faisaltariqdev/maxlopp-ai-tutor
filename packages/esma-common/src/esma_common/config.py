from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    service_name: str = "esma"
    host: str = "0.0.0.0"
    port: int = 8000
    users_url: str = "http://127.0.0.1:8001"
    catalog_url: str = "http://127.0.0.1:8002"
    orders_url: str = "http://127.0.0.1:8003"
