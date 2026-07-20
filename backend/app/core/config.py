from pydantic import BaseModel
import os

class Settings(BaseModel):
    eodhd_api_key: str = os.getenv("EODHD_API_KEY", "")
    database_path: str = os.getenv("DATABASE_PATH", "/app/data/sqlite/setup_miner.db")
    cache_dir: str = os.getenv("CACHE_DIR", "/app/data/cache")
    backup_dir: str = os.getenv("BACKUP_DIR", "/app/data/backups")

settings = Settings()
