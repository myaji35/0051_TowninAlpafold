"""ETL Scheduler — datasets.json 순회 cron 실행기.

사용법:
    python3 etl_scheduler.py                # 도래한 cron만 실행
    python3 etl_scheduler.py --force <key>  # 강제 1건 실행
    python3 etl_scheduler.py --dry-run      # 모든 ETL을 dry_run으로
    python3 etl_scheduler.py --list         # 다음 실행 예정 목록만 출력

배포:
    OS crontab 또는 systemd timer가 매시간 이 스크립트 호출.
    예: 0 * * * * cd /path && python3 etl_scheduler.py >> logs/scheduler.log 2>&1
"""
import json
import sys
import importlib
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parent / "data_raw/_registry/datasets.json"

# 구현된 ETL 모듈 매핑. 없는 key는 "blocked"로 기록.
ETL_MODULE_MAP = {
    "kosis_living_pop": "etl.kosis_living_pop",
}

FREQUENCY_DAYS = {
    "daily": 1,
    "weekly": 7,
    "monthly": 30,
    "quarterly": 90,
}


# ---------------------------------------------------------------------------
# registry I/O
# ---------------------------------------------------------------------------

def load_registry() -> list:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))["datasets"]


def save_registry(datasets: list) -> None:
    REGISTRY_PATH.write_text(
        json.dumps({"datasets": datasets}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# 스케줄 판정
# ---------------------------------------------------------------------------

def is_due(ds: dict, now: datetime) -> bool:
    """next_run_at 없으면 즉시 도래 (최초 실행). once는 last_run_status 체크."""
    sched = ds.get("schedule", {})
    freq = sched.get("frequency", "monthly")
    if freq == "once" and sched.get("last_run_status") == "success":
        return False  # once 이미 성공 → 재실행 안 함
    nra = sched.get("next_run_at")
    if not nra:
        return True
    try:
        scheduled = datetime.fromisoformat(nra.replace("Z", "+00:00"))
        return now >= scheduled
    except (ValueError, TypeError):
        return True


def compute_next_run_at(frequency: str, now: datetime) -> str | None:
    """다음 실행 시각 계산 (단순 delta 방식, croniter 미사용)."""
    days = FREQUENCY_DAYS.get(frequency)
    if days is None:
        return None  # "once" 또는 "blocked"
    return (now + timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# ETL 실행
# ---------------------------------------------------------------------------

def run_one(ds: dict, dry_run: bool = False) -> dict:
    """단일 데이터셋 ETL 호출. 모듈 미구현 시 blocked 반환."""
    key = ds["key"]
    mod_name = ETL_MODULE_MAP.get(key)
    if not mod_name:
        return {"key": key, "status": "blocked", "reason": "ETL 모듈 미구현"}
    try:
        mod = importlib.import_module(mod_name)
        result = mod.run(dry_run=dry_run)
        return {"key": key, **result}
    except Exception as e:
        return {"key": key, "status": "failure", "reason": str(e)}


def update_after_run(ds: dict, result: dict, now: datetime) -> None:
    """실행 결과를 ds 딕셔너리에 인플레이스 반영 (save_registry가 이후에 저장)."""
    sched = ds.setdefault("schedule", {})
    status = result.get("status", "failure")
    sched["last_run_status"] = status
    sched["last_run_at"] = now.isoformat()

    if status == "success":
        sched["consecutive_failures"] = 0
        freq = sched.get("frequency", "monthly")
        sched["next_run_at"] = compute_next_run_at(freq, now)
    elif status in ("failure", "error"):
        sched["consecutive_failures"] = sched.get("consecutive_failures", 0) + 1
        if sched["consecutive_failures"] >= 3:
            sched["frequency"] = "blocked"  # 안전장치: 3회 연속 실패 → 자동 중단


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="ETL 스케줄러")
    parser.add_argument("--dry-run", action="store_true", help="실 API 호출 없이 mock 실행")
    parser.add_argument("--force", metavar="KEY", help="key 1건 강제 실행 (스케줄 무시)")
    parser.add_argument("--list", action="store_true", dest="list_mode", help="다음 실행 예정 목록 출력")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    datasets = load_registry()

    # --list: 현황 출력 후 종료
    if args.list_mode:
        print(f"{'KEY':<25} {'NEXT_RUN_AT':<32} {'FREQ':<12} {'LAST_STATUS'}")
        for ds in datasets:
            sched = ds.get("schedule", {})
            print(
                f"{ds['key']:<25} "
                f"{sched.get('next_run_at') or 'NOW (미설정)':<32} "
                f"{sched.get('frequency', '-'):<12} "
                f"{sched.get('last_run_status', '-')}"
            )
        return 0

    results = []
    changed = False

    for ds in datasets:
        key = ds["key"]
        sched = ds.get("schedule", {})

        # --force 지정 시 해당 key만
        if args.force and key != args.force:
            continue

        # blocked 항목은 force가 아니면 건너뜀
        if sched.get("frequency") == "blocked" and not args.force:
            results.append({"key": key, "status": "skipped", "reason": "blocked (3회 연속 실패)"})
            continue

        # 도래 판정
        if not args.force and not is_due(ds, now):
            continue

        result = run_one(ds, dry_run=args.dry_run)
        update_after_run(ds, result, now)
        results.append(result)
        changed = True

    if changed:
        save_registry(datasets)

    if not results:
        print(json.dumps({"executed": 0, "message": "도래한 ETL 없음"}, ensure_ascii=False))
        return 0

    print(json.dumps({"executed": len(results), "results": results}, ensure_ascii=False, indent=2))

    all_ok = all(r.get("status") in ("success", "skipped", "blocked") for r in results)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
