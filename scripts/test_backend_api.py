"""scripts/test_backend_api.py
FastAPI 앱 단위 + 통합 smoke test (TestClient 사용).
실행: python3 scripts/test_backend_api.py
"""
import sys
import os
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 테스트용 격리 DB
_tmpdir = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL_FILE"] = str(Path(_tmpdir.name) / "test.db")
os.environ["API_TOKEN"] = "test-token-secret"

try:
    from fastapi.testclient import TestClient
except ImportError:
    print("fastapi 미설치 — pip install -r backend/requirements.txt")
    sys.exit(2)

from backend.main import app

HEADERS = {"X-API-Token": "test-token-secret"}

results = []


def run_all(client):
    def t1():
        """health — 인증 불필요."""
        r = client.get("/health")
        return r.status_code == 200 and r.json()["status"] == "ok", r.json()

    def t2():
        """인증 실패 — 토큰 없으면 401."""
        r = client.get("/api/v1/datasets")
        return r.status_code == 401, f"status {r.status_code}"

    def t3():
        """인증 통과 — 빈 datasets 리스트."""
        r = client.get("/api/v1/datasets", headers=HEADERS)
        return r.status_code == 200 and r.json() == [], f"got {r.json()}"

    def t4():
        """datasets 등록."""
        payload = {
            "key": "kosis_living_pop",
            "ko": "생활인구",
            "source_org": "KOSIS",
            "credentials": {"type": "api_key", "env_var": "KOSIS_API_KEY"},
            "schedule": {"frequency": "monthly", "cron": "0 9 5 * *"},
            "scope": {"target_dongs": 3500},
        }
        r = client.post("/api/v1/datasets", json=payload, headers=HEADERS)
        return r.status_code == 200 and r.json()["key"] == "kosis_living_pop", r.json()

    def t5():
        """등록 후 list."""
        r = client.get("/api/v1/datasets", headers=HEADERS)
        return r.status_code == 200 and len(r.json()) >= 1, f"count={len(r.json())}"

    def t6():
        """key 중복 등록 — 400."""
        payload = {"key": "kosis_living_pop", "ko": "중복", "source_org": "X"}
        r = client.post("/api/v1/datasets", json=payload, headers=HEADERS)
        return r.status_code in (400, 409, 500), f"status {r.status_code}"

    def t7():
        """잘못된 key 형식 — 422."""
        payload = {"key": "Invalid Key With Space", "ko": "x", "source_org": "x"}
        r = client.post("/api/v1/datasets", json=payload, headers=HEADERS)
        return r.status_code == 422, f"status {r.status_code}"

    def t8():
        """batch enqueue stub."""
        payload = {
            "brand_id": "B-001",
            "model_key": "pharmacy.develop",
            "asset_ids": ["A-001", "A-002", "A-003"],
        }
        r = client.post("/api/v1/batch/enqueue", json=payload, headers=HEADERS)
        return r.status_code == 200 and r.json()["asset_count"] == 3, r.json()

    def t9():
        """models review-queue (빈 큐)."""
        r = client.get("/api/v1/models/review-queue", headers=HEADERS)
        return r.status_code == 200 and "items" in r.json(), r.json()

    for name, fn in [
        ("health", t1),
        ("auth_required", t2),
        ("empty_list", t3),
        ("register_ok", t4),
        ("list_after_register", t5),
        ("duplicate_key_blocked", t6),
        ("bad_key_format_422", t7),
        ("batch_enqueue_stub", t8),
        ("review_queue_endpoint", t9),
    ]:
        try:
            passed, msg = fn()
        except Exception as e:
            passed, msg = False, f"예외: {e}"
        results.append((name, passed, msg))
        print(f"{'PASS' if passed else 'FAIL'} {name}: {str(msg)[:80]}")


# lifespan(startup/shutdown) 활성화를 위해 with 컨텍스트 사용
with TestClient(app) as client:
    run_all(client)

failed = sum(1 for _, p, _ in results if not p)
print(f"\n{len(results)-failed}/{len(results)} PASS")
sys.exit(0 if failed == 0 else 1)
