"""backend/db.py
SQLite 연결 + 스키마 초기화.

DB 위치: backend/data/towninalpafold.db
환경변수 DATABASE_URL_FILE 로 경로 override 가능.
"""
import sqlite3
import os
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.environ.get("DATABASE_URL_FILE", str(DB_DIR / "towninalpafold.db")))


def _connect():
    # check_same_thread=False: FastAPI는 sync 핸들러를 threadpool에서 실행하므로 필요
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    """스키마 초기화 — datasets 테이블 1개 (Phase 1)."""
    conn = _connect()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS datasets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        ko TEXT NOT NULL,
        source_org TEXT NOT NULL,
        credentials TEXT DEFAULT '{}',
        schedule TEXT DEFAULT '{}',
        scope TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_datasets_key ON datasets(key);
    """)
    conn.commit()
    conn.close()


def get_db():
    """FastAPI dependency injection — 요청마다 새 connection."""
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


# 모델 클래스 (간단한 dataclass-like)
class Dataset:
    """SQLite row → dict-like 접근. SQLAlchemy 도입 시 ORM 모델로 교체."""
    pass
