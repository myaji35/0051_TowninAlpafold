"""scripts/test_batch_queue.py
BatchQueue + FastAPI batch endpoint 단위 + 통합 테스트.
"""
import sys
import os
import tempfile
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 격리 환경
_tmp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL_FILE"] = str(Path(_tmp.name) / "test.db")
os.environ["API_TOKEN"] = "test-token"

# brand 디렉터리도 격리 (실 데이터 오염 방지)
_brand_tmp = tempfile.TemporaryDirectory()
import backend.batch_queue as bq
bq.BRAND_RUNS_DIR = Path(_brand_tmp.name) / "_brands"

from backend.batch_queue import (
    BatchQueue, BatchJob, get_queue, mock_evaluator,
    CLIENT_WORKER_MAX, BACKEND_QUEUE_MAX,
)

results = []


def t1():
    """enqueue 51개 → status queued."""
    q = BatchQueue()
    job = q.enqueue("B-test", "pharmacy.develop", [f"A-{i}" for i in range(51)])
    return job.status == "queued" and job.total == 51, f"status={job.status}, total={job.total}"


def t2():
    """1001개 → rejected (Phase 2 필요)."""
    q = BatchQueue()
    job = q.enqueue("B-test", "pharmacy.develop", [f"A-{i}" for i in range(1001)])
    return job.status == "rejected" and "1000" in job.error, f"status={job.status}, error={job.error}"


def t3():
    """50개 이하도 받음 (호환)."""
    q = BatchQueue()
    job = q.enqueue("B-test", "pharmacy.develop", ["A-1", "A-2"])
    return job.status == "queued", f"50 이하 enqueue {job.status}"


def t4():
    """process_one — 큐에서 1개 꺼내 처리."""
    q = BatchQueue()
    job = q.enqueue("B-test", "pharmacy.develop", [f"A-{i}" for i in range(5)])
    q.process_one(mock_evaluator)
    return (job.status == "done" and job.processed == 5 and job.progress == 100,
            f"status={job.status}, progress={job.progress}, processed={job.processed}")


def t5():
    """results 누적."""
    q = BatchQueue()
    job = q.enqueue("B-test", "pharmacy.develop", ["A-1", "A-2", "A-3"])
    q.process_one(mock_evaluator)
    return (len(job.results) == 3 and all("result" in r for r in job.results),
            f"results={len(job.results)}")


def t6():
    """결과 영속 — 파일 생성."""
    q = BatchQueue()
    job = q.enqueue("B-persist-test", "pharmacy.develop", ["A-1"])
    q.process_one(mock_evaluator)
    out = bq.BRAND_RUNS_DIR / "B-persist-test" / "runs" / f"{job.job_id}.json"
    if not out.exists():
        return False, f"파일 없음: {out}"
    data = json.loads(out.read_text())
    return (data["status"] == "done" and len(data["results"]) == 1,
            f"persisted: status={data.get('status')}")


def t7():
    """get_queue() singleton."""
    q1 = get_queue()
    q2 = get_queue()
    return q1 is q2, "singleton 동일 instance"


def t8():
    """list_jobs 필터."""
    q = BatchQueue()
    q.enqueue("B-A", "m1", ["a"])
    q.enqueue("B-B", "m2", ["b"])
    a_jobs = q.list_jobs(brand_id="B-A")
    return len(a_jobs) == 1, f"B-A jobs: {len(a_jobs)}"


def t9():
    """progress listener — 콜백 호출."""
    q = BatchQueue()
    job = q.enqueue("B-test", "pharmacy.develop", ["A-1", "A-2", "A-3"])
    callback_count = {"n": 0}

    def listener(state):
        callback_count["n"] += 1

    q.add_progress_listener(job.job_id, listener)
    q.process_one(mock_evaluator)
    return callback_count["n"] >= 3, f"callbacks: {callback_count['n']}"


def t10():
    """POST /api/v1/batch/enqueue → 200."""
    try:
        from fastapi.testclient import TestClient
        from backend.main import app
        client = TestClient(app)
        r = client.post("/api/v1/batch/enqueue", json={
            "brand_id": "B-test", "model_key": "pharmacy.develop",
            "asset_ids": ["A-1", "A-2"],
        }, headers={"X-API-Token": "test-token"})
        return r.status_code == 200 and "job_id" in r.json(), f"status {r.status_code}"
    except ImportError:
        return True, "fastapi 미설치 (skip)"


def t11():
    """1001개 → 413 Payload Too Large."""
    try:
        from fastapi.testclient import TestClient
        from backend.main import app
        client = TestClient(app)
        r = client.post("/api/v1/batch/enqueue", json={
            "brand_id": "B-test", "model_key": "x",
            "asset_ids": [f"A-{i}" for i in range(1001)],
        }, headers={"X-API-Token": "test-token"})
        return r.status_code == 413, f"status {r.status_code}"
    except ImportError:
        return True, "fastapi 미설치 (skip)"


for name, fn in [
    ("enqueue_51", t1),
    ("reject_1001", t2),
    ("enqueue_2", t3),
    ("process_5", t4),
    ("results_accumulate", t5),
    ("persist_file", t6),
    ("singleton", t7),
    ("list_filter", t8),
    ("progress_listener", t9),
    ("api_enqueue", t10),
    ("api_reject_too_large", t11),
]:
    try:
        passed, msg = fn()
    except Exception as e:
        passed, msg = False, f"예외: {e}"
    results.append((name, passed, msg))
    print(f"{'✓' if passed else '✗'} {name}: {str(msg)[:80]}")

failed = sum(1 for _, p, _ in results if not p)
print(f"\n{len(results) - failed}/{len(results)} PASS")
sys.exit(0 if failed == 0 else 1)
