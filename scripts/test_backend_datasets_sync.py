"""scripts/test_backend_datasets_sync.py
BACKEND_DATASETS_SYNC-001 — file-first 정책 검증 (6개 테스트).

실행:
  python scripts/test_backend_datasets_sync.py

의존: httpx (이미 requirements.txt에 있음), uvicorn
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx

# ─── 경로 설정 ───
ROOT = Path(__file__).resolve().parent.parent
DATASETS_FILE = ROOT / "data_raw" / "_registry" / "datasets.json"
BACKUP_FILE = ROOT / "data_raw" / "_registry" / "datasets.json.bak"
DB_PATH = ROOT / "backend" / "data" / "towninalpafold.db"

BASE_URL = "http://127.0.0.1:18765"
TOKEN = os.environ.get("API_TOKEN", "dev-token-change-me")
HEADERS = {"X-API-Token": TOKEN}

_server_proc: subprocess.Popen | None = None


# ─── 서버 생명주기 ───

def _start_server():
    global _server_proc
    env = {**os.environ, "API_TOKEN": TOKEN}
    _server_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--host", "127.0.0.1", "--port", "18765", "--log-level", "error"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # 준비 대기 (최대 5초)
    for _ in range(50):
        try:
            httpx.get(f"{BASE_URL}/health", timeout=0.5)
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("Backend did not start in time")


def _stop_server():
    if _server_proc:
        _server_proc.terminate()
        _server_proc.wait(timeout=5)


# ─── 데이터 백업/복원 ───

def _backup():
    shutil.copy2(str(DATASETS_FILE), str(BACKUP_FILE))
    # DB datasets 행도 백업 (초기 상태 저장)
    conn = sqlite3.connect(str(DB_PATH))
    rows = conn.execute("SELECT key FROM datasets").fetchall()
    conn.close()
    return [r[0] for r in rows]


def _restore(original_db_keys: list[str]):
    shutil.copy2(str(BACKUP_FILE), str(DATASETS_FILE))
    # DB: 테스트 중 추가된 key 삭제
    conn = sqlite3.connect(str(DB_PATH))
    current = [r[0] for r in conn.execute("SELECT key FROM datasets").fetchall()]
    for key in current:
        if key not in original_db_keys:
            conn.execute("DELETE FROM datasets WHERE key = ?", (key,))
    conn.commit()
    conn.close()
    BACKUP_FILE.unlink(missing_ok=True)


# ─── 테스트 함수 ───

RESULTS: list[tuple[str, bool, str]] = []


def _assert(name: str, cond: bool, msg: str = ""):
    RESULTS.append((name, cond, msg))
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f" — {msg}" if msg else ""))


def test_get_returns_file_5_seeds():
    """GET /api/v1/datasets → 파일의 5건 반환 (file-first)."""
    r = httpx.get(f"{BASE_URL}/api/v1/datasets", headers=HEADERS)
    assert r.status_code == 200, f"status={r.status_code}"
    items = r.json()
    _assert(
        "test_get_returns_file_5_seeds",
        len(items) == 5,
        f"got {len(items)} items, expected 5",
    )


def test_post_adds_to_file():
    """POST 1건 → datasets.json에 append됨."""
    payload = {
        "key": "test_sync_file_001",
        "ko": "테스트 파일 동기화",
        "source_org": "TestOrg",
        "credentials": {},
        "schedule": {},
        "scope": {},
    }
    r = httpx.post(f"{BASE_URL}/api/v1/datasets", headers=HEADERS, json=payload)
    _assert("test_post_adds_to_file[status]", r.status_code == 201, f"status={r.status_code}")

    # 파일 직접 확인
    with open(DATASETS_FILE, encoding="utf-8") as f:
        data = json.load(f)
    keys = [d["key"] for d in data["datasets"]]
    _assert(
        "test_post_adds_to_file[file_check]",
        "test_sync_file_001" in keys,
        f"keys={keys}",
    )


def test_post_adds_to_db():
    """POST 1건 → SQLite에도 insert됨."""
    payload = {
        "key": "test_sync_db_001",
        "ko": "테스트 DB 동기화",
        "source_org": "TestOrg",
        "credentials": {},
        "schedule": {},
        "scope": {},
    }
    r = httpx.post(f"{BASE_URL}/api/v1/datasets", headers=HEADERS, json=payload)
    _assert("test_post_adds_to_db[status]", r.status_code == 201, f"status={r.status_code}")

    conn = sqlite3.connect(str(DB_PATH))
    row = conn.execute(
        "SELECT key FROM datasets WHERE key = ?", ("test_sync_db_001",)
    ).fetchone()
    conn.close()
    _assert(
        "test_post_adds_to_db[db_check]",
        row is not None,
        "key not found in SQLite",
    )


def test_drift_detected():
    """DB에만 추가 행 삽입 후 GET → X-Sync-Drift: true 헤더 확인."""
    # 파일은 건드리지 않고 DB에만 직접 insert
    conn = sqlite3.connect(str(DB_PATH))
    import datetime
    now = datetime.datetime.now().isoformat()
    conn.execute(
        """INSERT OR IGNORE INTO datasets (key, ko, source_org, credentials, schedule, scope, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        ("test_drift_only_db", "드리프트 테스트", "DriftOrg", "{}", "{}", "{}", now),
    )
    conn.commit()
    conn.close()

    r = httpx.get(f"{BASE_URL}/api/v1/datasets", headers=HEADERS)
    drift_header = r.headers.get("x-sync-drift", "false")
    _assert(
        "test_drift_detected",
        drift_header.lower() == "true",
        f"X-Sync-Drift={drift_header}",
    )

    # 정리: DB에서 drift 행 제거
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("DELETE FROM datasets WHERE key = ?", ("test_drift_only_db",))
    conn.commit()
    conn.close()


def test_concurrent_post_serialized():
    """2회 동시 POST → 파일에 2건 모두 보존 (락 직렬화 검증)."""
    payloads = [
        {"key": "test_concurrent_a", "ko": "동시성 A", "source_org": "ConcA",
         "credentials": {}, "schedule": {}, "scope": {}},
        {"key": "test_concurrent_b", "ko": "동시성 B", "source_org": "ConcB",
         "credentials": {}, "schedule": {}, "scope": {}},
    ]
    results = []

    def _post(p):
        r = httpx.post(f"{BASE_URL}/api/v1/datasets", headers=HEADERS, json=p, timeout=10)
        results.append(r.status_code)

    threads = [threading.Thread(target=_post, args=(p,)) for p in payloads]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    with open(DATASETS_FILE, encoding="utf-8") as f:
        data = json.load(f)
    keys = {d["key"] for d in data["datasets"]}

    both_ok = all(s == 201 for s in results)
    both_in_file = {"test_concurrent_a", "test_concurrent_b"}.issubset(keys)
    _assert(
        "test_concurrent_post_serialized",
        both_ok and both_in_file,
        f"status={results}, in_file={{'a' in keys: {'test_concurrent_a' in keys}, 'b' in keys: {'test_concurrent_b' in keys}}}",
    )


def test_post_invalid_schema_400():
    """required 필드 누락 → 400 또는 422."""
    payload = {"ko": "필드 누락", "source_org": "X"}  # key 없음
    r = httpx.post(f"{BASE_URL}/api/v1/datasets", headers=HEADERS, json=payload)
    _assert(
        "test_post_invalid_schema_400",
        r.status_code in (400, 422),
        f"status={r.status_code}",
    )


# ─── 메인 ───

def main():
    print("=== BACKEND_DATASETS_SYNC-001 테스트 시작 ===\n")

    # 서버를 먼저 띄워야 DB(init_db)가 생성됨
    _start_server()
    original_db_keys = _backup()

    try:
        tests = [
            test_get_returns_file_5_seeds,
            test_post_adds_to_file,
            test_post_adds_to_db,
            test_drift_detected,
            test_concurrent_post_serialized,
            test_post_invalid_schema_400,
        ]
        for fn in tests:
            print(f"\n[RUN] {fn.__name__}")
            try:
                fn()
            except Exception as exc:
                _assert(fn.__name__, False, f"Exception: {exc}")
    finally:
        _stop_server()
        _restore(original_db_keys)
        print("\n[원본 복원 완료]")

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print(f"\n=== 결과: {passed}/{total} PASS ===")
    if passed < total:
        print("\n실패 항목:")
        for name, ok, msg in RESULTS:
            if not ok:
                print(f"  FAIL {name}: {msg}")
        sys.exit(1)


if __name__ == "__main__":
    main()
