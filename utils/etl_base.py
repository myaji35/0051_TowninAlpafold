"""ETL 공통 헬퍼 — Phase 1.5 base 추출.

5개 ETL의 중복 로직을 추출한다. 각 ETL의 fetch 로직·상수는 개별 파일에 유지.

공개 함수:
    transform_cell(dataset_key, adm_cd, adm_nm, period, raw, dry_run) -> dict
    save_cell(rec, output_dir, adm_cd, period) -> Path
    update_manifest(adm_cd, dataset_key, months_covered, months_total, marker, fetched_at)
    update_dataset_schedule(dataset_key, status, fetched_at) -> str | None
"""

import fcntl
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "data_raw/_registry/datasets.json"

_FREQ_DAYS = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90}


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


def update_dataset_schedule(
    dataset_key: str,
    status: str,
    fetched_at: str,
) -> str | None:
    """datasets.json의 schedule.last_run_at + last_run_status + next_run_at 갱신.

    ETL 직접 호출(스케줄러 우회)에서도 카드 UI에 즉시 반영되도록 추가된 hook.
    LOCK_EX로 동시 쓰기 안전. 실패 시 경고 문자열 반환.
    """
    try:
        with open(REGISTRY_PATH, "r+", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                payload = json.loads(f.read())
                changed = False
                for ds in payload.get("datasets", []):
                    if ds.get("key") != dataset_key:
                        continue
                    sched = ds.setdefault("schedule", {})
                    sched["last_run_at"] = fetched_at
                    sched["last_run_status"] = status
                    if status == "success":
                        sched["consecutive_failures"] = 0
                        freq = sched.get("frequency", "monthly")
                        if freq != "once":
                            days = _FREQ_DAYS.get(freq, 30)
                            try:
                                base = datetime.fromisoformat(fetched_at)
                            except Exception:
                                base = datetime.now(timezone.utc)
                            sched["next_run_at"] = (base + timedelta(days=days)).isoformat()
                    elif status == "failure":
                        sched["consecutive_failures"] = sched.get("consecutive_failures", 0) + 1
                    changed = True
                    break
                if changed:
                    f.seek(0)
                    f.truncate()
                    f.write(json.dumps(payload, ensure_ascii=False, indent=2))
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        return None
    except Exception as e:
        return str(e)
