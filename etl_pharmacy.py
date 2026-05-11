"""ETL_PHARMACY_DATA-001 — 약국 도메인 데이터 ETL 스켈레톤

상태: schema_only=True (외부 라이선스 결정 전)
출력: data_raw/pharmacy/clinic_distribution.json,
      pharmacy_distribution.json, prescription_volume.json, store_operations.json

실데이터 소스가 결정되면 fetch_*() 함수에 다운로드 로직 추가.
현재는 sample.json을 그대로 분리 출력 (Wave 1 fixture).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data_raw" / "pharmacy"
SCHEMA_PATH = DATA_DIR / "schema.json"
SAMPLE_PATH = DATA_DIR / "sample.json"


def load_schema() -> dict[str, Any]:
    with SCHEMA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def load_sample() -> dict[str, Any]:
    with SAMPLE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def fetch_clinic_distribution() -> list[dict[str, Any]]:
    """HIRA 의원 분포 — 라이선스 결정 후 실데이터 다운로드 추가.
    현재: sample fallback."""
    return load_sample()["clinic_distribution"]


def fetch_pharmacy_distribution() -> list[dict[str, Any]]:
    return load_sample()["pharmacy_distribution"]


def fetch_prescription_volume() -> list[dict[str, Any]]:
    return load_sample()["prescription_volume"]


def fetch_store_operations() -> list[dict[str, Any]]:
    return load_sample()["store_operations"]


def validate_record(record: dict[str, Any], dataset_key: str, schema: dict) -> list[str]:
    """간단한 필수 필드 + marker enum 검증. 본격 검증은 jsonschema 라이브러리 권장."""
    errors: list[str] = []
    ds_def = schema["datasets"][dataset_key]
    for req_field in ds_def.get("required", []):
        if req_field not in record:
            errors.append(f"missing required field: {req_field}")
    marker = record.get("marker")
    if marker and marker not in {"real", "synth", "estimate"}:
        errors.append(f"invalid marker: {marker}")
    return errors


def write_output(data: list[dict], filename: str) -> Path:
    out_path = DATA_DIR / filename
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return out_path


def run() -> int:
    schema = load_schema()
    fetchers = {
        "clinic_distribution":   fetch_clinic_distribution,
        "pharmacy_distribution": fetch_pharmacy_distribution,
        "prescription_volume":   fetch_prescription_volume,
        "store_operations":      fetch_store_operations,
    }
    total_errors = 0
    for key, fetcher in fetchers.items():
        records = fetcher()
        for rec in records:
            errs = validate_record(rec, key, schema)
            if errs:
                print(f"[{key}] {rec.get('adm_cd') or rec.get('store_id')}: {errs}", file=sys.stderr)
                total_errors += len(errs)
        out = write_output(records, f"{key}.json")
        print(f"[OK] {key}: {len(records)} records → {out.relative_to(ROOT)}")
    print(f"\nValidation errors: {total_errors}")
    return 0 if total_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
