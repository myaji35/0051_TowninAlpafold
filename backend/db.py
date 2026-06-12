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
    """스키마 초기화 — datasets + npl_assets (NPL 5만 건 포트폴리오)."""
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

    -- NPL 물건 원장 (5만 건 규모). 참조: docs/npl-portfolio-architecture.md §2
    -- 설계 원칙: 평가 결과를 컬럼에 캐시 → 백분위/분포 집계를 인덱스로 ~ms.
    -- raw_input(JSON): CSV 컬럼이 클라이언트 확정 전이므로 원본 입력을 통째 보존
    --   → 스키마 변경 없이 추가 필드 흡수 (Karpathy #1 — 미확정값 가정 회피).
    CREATE TABLE IF NOT EXISTS npl_assets (
        id              TEXT PRIMARY KEY,
        portfolio_id    TEXT,
        eval_type       TEXT NOT NULL,          -- 'buy' | 'sell'
        address         TEXT,
        collateral_type TEXT,                   -- apt|officetel|land|commercial
        region_code     TEXT,                   -- 시군구 (동급 비교 키)
        score_irr       REAL,                   -- buy: IRR (소수)
        score_npv       REAL,                   -- sell: 즉시매각 NPV
        grade           TEXT,                   -- very_high|high|medium|low
        recovery_p10    REAL, recovery_p50 REAL, recovery_p90 REAL,
        confidence      REAL,
        raw_input       TEXT DEFAULT '{}',      -- JSON 원본 입력 (CSV 컬럼 흡수)
        source          TEXT DEFAULT 'manual',  -- manual|csv|api
        created_at      TEXT NOT NULL,
        updated_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_npl_grade  ON npl_assets(grade);
    CREATE INDEX IF NOT EXISTS idx_npl_peer   ON npl_assets(collateral_type, region_code);
    CREATE INDEX IF NOT EXISTS idx_npl_irr    ON npl_assets(score_irr);
    CREATE INDEX IF NOT EXISTS idx_npl_pf     ON npl_assets(portfolio_id);
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
