"""scripts/test_etl_infra.py
ETL 인프라 4종 단위 smoke test.
실행: python3 scripts/test_etl_infra.py
종료 코드: 0 통과 / 1 실패
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.etl_lock import acquire_lock, LockBusyError
from utils.etl_retry import with_retry, RetryExhausted
from utils.rate_tracker import RateTracker
from utils.schema_validator import compute_schema_hash, validate_or_quarantine

results = []


# Test 1: 동일 데이터셋 lock 충돌
def t1():
    with acquire_lock("test_ds_lock"):
        try:
            with acquire_lock("test_ds_lock"):
                return False, "두 번째 acquire가 실패해야 함"
        except LockBusyError:
            pass
    return True, "lock 충돌 정상 차단"


# Test 2: retry decorator — 3회 시도 후 성공
def t2():
    counter = {"n": 0}

    @with_retry(max_attempts=3, backoff_seconds=[0, 0])
    def flaky():
        counter["n"] += 1
        if counter["n"] < 3:
            raise RuntimeError("fail")
        return "ok"

    result = flaky()
    return result == "ok" and counter["n"] == 3, f"retry 3회 후 성공 (실제: {counter['n']}회)"


# Test 3: retry exhausted
def t3():
    @with_retry(max_attempts=2, backoff_seconds=[0])
    def always_fail():
        raise RuntimeError("never works")

    try:
        always_fail()
        return False, "RetryExhausted 발생 안 함"
    except RetryExhausted:
        return True, "RetryExhausted 정상"


# Test 4: rate tracker throttle
def t4():
    rt = RateTracker("test_throttle", daily_limit=10, throttle_pct=0.8)
    for _ in range(8):
        rt.record_call()
    return rt.should_throttle(), "80% 도달 시 throttle=True"


# Test 5: schema hash 동일 키 → 동일 hash
def t5():
    h1 = compute_schema_hash({"a": 1, "b": "x"})
    h2 = compute_schema_hash({"b": "y", "a": 99})
    return h1 == h2, f"동일 키 → 동일 hash ({h1[:8]})"


# Test 6: schema drift quarantine
def t6():
    rec = {"foo": 1, "bar": "x"}
    expected = compute_schema_hash({"foo": 1, "bar": "x"})
    ok, _ = validate_or_quarantine(rec, expected, "test_drift_pass")
    bad_rec = {"different": "structure"}
    ok2, _ = validate_or_quarantine(bad_rec, expected, "test_drift_fail")
    return ok and not ok2, "정상 PASS, drift 시 quarantine"


for name, fn in [("lock", t1), ("retry_ok", t2), ("retry_exhausted", t3),
                 ("rate_throttle", t4), ("schema_hash", t5), ("schema_drift", t6)]:
    try:
        passed, msg = fn()
    except Exception as e:
        passed, msg = False, f"예외: {e}"
    results.append((name, passed, msg))
    print(f"{'✓' if passed else '✗'} {name}: {msg}")

failed = sum(1 for _, p, _ in results if not p)
print(f"\n{len(results) - failed}/{len(results)} PASS")
sys.exit(0 if failed == 0 else 1)
