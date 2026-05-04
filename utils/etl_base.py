"""ETL 공통 헬퍼 — Phase 1.5 base 추출.

3개 ETL(kosis_living_pop, localdata_biz, nts_bizreg)의 중복 로직을 추출한다.
각 ETL의 fetch 로직·상수는 개별 파일에 그대로 유지된다.

공개 함수:
    transform_cell(dataset_key, adm_cd, adm_nm, period, raw, dry_run) -> dict
    save_cell(rec, output_dir, adm_cd, period) -> Path
    update_manifest(adm_cd, dataset_key, months_covered, months_total, marker, fetched_at)
"""

import json
from datetime import datetime, timezone
from pathlib import Path


def transform_cell(
    dataset_key: str,
    adm_cd: str,
    adm_nm: str,
    period: str,
    raw: list,
    dry_run: bool = False,
) -> dict:
    """API 응답 raw list → 표준 레코드 dict."""
    return {
        "dataset_key": dataset_key,
        "adm_cd": adm_cd,
        "adm_nm": adm_nm,
        "period": period,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "records": raw,
        "marker": "synthetic" if dry_run else "real",
    }


def save_cell(rec: dict, output_dir: Path, adm_cd: str, period: str) -> Path:
    """표준 레코드 dict → output_dir/adm_cd_period.json 저장."""
    output_dir.mkdir(parents=True, exist_ok=True)
    fp = output_dir / f"{adm_cd}_{period}.json"
    fp.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return fp


def update_manifest(
    adm_cd: str,
    dataset_key: str,
    months_covered: int,
    months_total: int,
    marker: str,
    fetched_at: str,
) -> str | None:
    """manifest 진척 갱신. 실패 시 경고 문자열 반환 (ETL 결과에 영향 없음)."""
    try:
        from utils.manifest_repo import JSONManifestRepo
        repo = JSONManifestRepo()
        repo.set_dataset_coverage(
            adm_cd=adm_cd,
            dataset_key=dataset_key,
            months_covered=months_covered,
            months_total=months_total,
            marker=marker,
            last_updated=fetched_at,
        )
        return None
    except Exception as e:
        return str(e)
