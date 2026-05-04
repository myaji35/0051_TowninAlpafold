"""
DATASET_REGISTRY_SEED-001 검증 테스트
stdlib only — jsonschema 의존성 없음
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SCHEMA_PATH = ROOT / "data_raw/_registry/datasets.schema.json"
SEED_PATH = ROOT / "data_raw/_registry/datasets.json"

REQUIRED_TOP = ["key", "ko", "source_org", "credentials", "schedule", "scope", "quality", "ops", "difficulty"]
REQUIRED_CREDENTIALS = ["type", "env_var", "obtain_url", "registered_at", "expires_at", "rate_limit"]
REQUIRED_SCHEDULE = ["frequency", "cron", "next_run_at", "last_run_status", "consecutive_failures"]
REQUIRED_SCOPE = ["geo_unit", "current_dongs_covered", "target_dongs", "current_months_covered"]
REQUIRED_QUALITY = ["schema_path", "data_marker_default"]
REQUIRED_OPS = ["alert_on_failure", "max_retries"]
REQUIRED_DIFFICULTY = ["level", "hours_estimated", "blockers"]

passed = 0
failed = 0


def ok(name: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {name}")


def fail(name: str, reason: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {name} — {reason}")


# ── 1. test_schema_loads ──────────────────────────────────────────────────────
def test_schema_loads():
    try:
        data = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        assert "$schema" in data
        assert data.get("type") == "object"
        ok("test_schema_loads")
    except Exception as e:
        fail("test_schema_loads", str(e))


# ── 2. test_seed_loads ────────────────────────────────────────────────────────
def test_seed_loads():
    try:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        assert "datasets" in data
        ok("test_seed_loads")
    except Exception as e:
        fail("test_seed_loads", str(e))


# ── 3. test_seed_count ───────────────────────────────────────────────────────
def test_seed_count():
    try:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        count = len(data["datasets"])
        assert count == 5, f"expected 5, got {count}"
        ok("test_seed_count")
    except Exception as e:
        fail("test_seed_count", str(e))


# ── 4. test_unique_keys ──────────────────────────────────────────────────────
def test_unique_keys():
    try:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        keys = [d["key"] for d in data["datasets"]]
        assert len(keys) == len(set(keys)), f"중복 key 발견: {[k for k in keys if keys.count(k) > 1]}"
        ok("test_unique_keys")
    except Exception as e:
        fail("test_unique_keys", str(e))


# ── 5. test_all_unregistered ─────────────────────────────────────────────────
def test_all_unregistered():
    try:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        for d in data["datasets"]:
            val = d["credentials"]["registered_at"]
            assert val is None, f"key={d['key']} registered_at={val!r} (null 이어야 함)"
        ok("test_all_unregistered")
    except Exception as e:
        fail("test_all_unregistered", str(e))


# ── 6. test_required_fields ──────────────────────────────────────────────────
def test_required_fields():
    try:
        data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        checks = [
            ("top-level",   REQUIRED_TOP,         lambda d: d),
            ("credentials", REQUIRED_CREDENTIALS, lambda d: d["credentials"]),
            ("schedule",    REQUIRED_SCHEDULE,    lambda d: d["schedule"]),
            ("scope",       REQUIRED_SCOPE,       lambda d: d["scope"]),
            ("quality",     REQUIRED_QUALITY,     lambda d: d["quality"]),
            ("ops",         REQUIRED_OPS,         lambda d: d["ops"]),
            ("difficulty",  REQUIRED_DIFFICULTY,  lambda d: d["difficulty"]),
        ]
        for ds in data["datasets"]:
            for section, fields, accessor in checks:
                obj = accessor(ds)
                missing = [f for f in fields if f not in obj]
                assert not missing, f"key={ds['key']} [{section}] 누락 필드: {missing}"
        ok("test_required_fields")
    except Exception as e:
        fail("test_required_fields", str(e))


# ── runner ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("DATASET_REGISTRY_SEED-001 검증")
    print("=" * 55)
    test_schema_loads()
    test_seed_loads()
    test_seed_count()
    test_unique_keys()
    test_all_unregistered()
    test_required_fields()
    print("=" * 55)
    print(f"결과: {passed}/{passed + failed} PASS")
    print("=" * 55)
    sys.exit(0 if failed == 0 else 1)
