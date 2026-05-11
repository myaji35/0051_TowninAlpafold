"""validate_catalogs.py
5 파일 카탈로그 외래키 무결성 검증.
실행: python3 scripts/validate_catalogs.py
종료 코드: 0 통과 / 1 위반
4 게이트(form_submit / etl_run_pre / manifest_recalc_pre / pdf_render_pre)에서 호출.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY_DIR = ROOT / "data_raw" / "_registry"
MODELS_DIR = ROOT / "data_raw" / "_models"
BRANDS_DIR = ROOT / "data_raw" / "_brands"
PROGRESS_DIR = ROOT / "data_raw" / "_progress"
MASTER_DIR = ROOT / "data_raw" / "_master"


def safe_load(path: Path):
    """파일 없으면 None 반환 (Phase 0에서는 일부 파일 미존재)."""
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"_load_error": str(e)}


def validate():
    errors = []
    warnings = []

    # 5 카탈로그 로드 (없으면 빈 기본값)
    datasets = safe_load(REGISTRY_DIR / "datasets.json") or {"datasets": []}
    models = safe_load(MODELS_DIR / "catalog.json") or {"models": []}
    brands = safe_load(BRANDS_DIR / "catalog.json") or {"brands": []}
    manifest = safe_load(PROGRESS_DIR / "manifest.json") or {"regions": []}
    hierarchy = safe_load(MASTER_DIR / "admin_hierarchy.json") or {"sigungu": []}

    # _load_error 처리
    for name, obj in [("datasets", datasets), ("models", models), ("brands", brands),
                      ("manifest", manifest), ("hierarchy", hierarchy)]:
        if isinstance(obj, dict) and obj.get("_load_error"):
            errors.append({"file": name, "kind": "load_error", "msg": obj["_load_error"]})

    # 키 인덱스
    dataset_keys = {d["key"] for d in datasets.get("datasets", []) if "key" in d}
    model_keys = {m["key"] for m in models.get("models", []) if "key" in m}
    sgg_codes = {s["code"] for s in hierarchy.get("sigungu", []) if "code" in s} \
        if isinstance(hierarchy, dict) else set()

    # FK 1: 모델 → 데이터셋
    for m in models.get("models", []):
        for dep in m.get("data_dependencies", []):
            if dep not in dataset_keys:
                errors.append({
                    "fk": 1, "model": m.get("key"), "missing_dataset": dep,
                    "msg": f"모델 '{m.get('key')}' 의 data_dependencies '{dep}' 가 datasets.json 에 없음"
                })

    # FK 2: 브랜드 → 모델
    for b in brands.get("brands", []):
        for pm in b.get("primary_models", []):
            if pm not in model_keys:
                errors.append({
                    "fk": 2, "brand": b.get("brand_id"), "missing_model": pm,
                    "msg": f"브랜드 '{b.get('brand_id')}' 의 primary_models '{pm}' 가 catalog.json 에 없음"
                })

    # FK 3: manifest 시군구 sgg_code → hierarchy (sgg_codes 존재할 때만 검증)
    for region in manifest.get("regions", []):
        for sgg in region.get("sigungu", []):
            sgg_code = sgg.get("code")
            if sgg_codes and sgg_code and sgg_code not in sgg_codes:
                warnings.append({
                    "fk": 3, "region": region.get("name"), "sgg_code": sgg_code,
                    "msg": f"manifest 시군구 '{sgg_code}' 가 admin_hierarchy.json 에 없음"
                })

    # FK 4: manifest.datasets_summary → datasets.json
    for ds_summary in manifest.get("datasets_summary", []):
        if isinstance(ds_summary, dict) and ds_summary.get("key") \
                and ds_summary["key"] not in dataset_keys:
            errors.append({
                "fk": 4, "manifest_key": ds_summary["key"],
                "msg": f"manifest.datasets_summary 의 '{ds_summary['key']}' 가 datasets.json 에 없음"
            })

    # FK 5: 모델 ui_component / scorer 파일 존재
    for m in models.get("models", []):
        for field in ["ui_component", "scorer"]:
            path_str = m.get(field)
            if path_str:
                full = ROOT / path_str
                if not full.exists():
                    errors.append({
                        "fk": 5, "model": m.get("key"), "field": field, "path": path_str,
                        "msg": f"모델 '{m.get('key')}' 의 {field} 파일 '{path_str}' 부재"
                    })

    return {
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "errors": len(errors),
            "warnings": len(warnings),
            "datasets": len(dataset_keys),
            "models": len(model_keys),
            "brands": len(brands.get("brands", [])),
            "manifest_regions": len(manifest.get("regions", [])),
            "hierarchy_sgg": len(sgg_codes)
        }
    }


def main():
    result = validate()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
