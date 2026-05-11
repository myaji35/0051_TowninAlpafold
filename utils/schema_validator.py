"""utils/schema_validator.py
ETL 결과 schema drift 감지 — 예상 hash 와 비교.

사용:
    from utils.schema_validator import compute_schema_hash, validate_or_quarantine
    rec = {"adm_cd": "...", "year": 2026, ...}
    expected_hash = "abc123..."  # datasets.json의 quality.expected_schema_hash
    ok, actual = validate_or_quarantine(rec, expected_hash, dataset_key="kosis_living_pop")
"""
import json
import hashlib
import datetime
from pathlib import Path

QUARANTINE_DIR = Path("data_raw/_quarantine")
QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)


def compute_schema_hash(record: dict) -> str:
    """레코드의 키 구조 (값 무시)로 hash. 동일 키 셋이면 동일 hash."""
    keys = _extract_key_structure(record)
    blob = json.dumps(keys, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _extract_key_structure(obj, depth=0, max_depth=3):
    """중첩 객체의 key set 추출 (값은 type만)."""
    if depth >= max_depth:
        return type(obj).__name__
    if isinstance(obj, dict):
        return {k: _extract_key_structure(v, depth + 1, max_depth) for k, v in sorted(obj.items())}
    if isinstance(obj, list):
        return [_extract_key_structure(obj[0], depth + 1, max_depth)] if obj else []
    return type(obj).__name__


def validate_or_quarantine(record: dict, expected_hash: str, dataset_key: str):
    """schema 일치 검증. 불일치 시 quarantine 디렉터리로 격리.

    Returns (is_valid: bool, actual_hash: str)
    """
    actual_hash = compute_schema_hash(record)
    if expected_hash and actual_hash != expected_hash:
        ds_dir = QUARANTINE_DIR / dataset_key
        ds_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        out = ds_dir / f"drift_{ts}_{actual_hash}.json"
        out.write_text(json.dumps(
            {"expected_hash": expected_hash, "actual_hash": actual_hash, "record": record},
            ensure_ascii=False, indent=2,
        ))
        return False, actual_hash
    return True, actual_hash
