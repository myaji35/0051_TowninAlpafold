"""ETL Scheduler 유닛 테스트 (stdlib only).

각 테스트는 임시 디렉터리에 datasets.json 복사본을 만들어 격리한다.
실행: python3 scripts/test_etl_scheduler.py
"""
import json
import importlib
import sys
import tempfile
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

SCHEDULER_MOD = "etl_scheduler"
REGISTRY_ORIG = PROJECT_ROOT / "data_raw/_registry/datasets.json"


# ---------------------------------------------------------------------------
# 픽스처 헬퍼
# ---------------------------------------------------------------------------

def make_temp_registry(base_dir: Path) -> Path:
    """임시 디렉터리에 registry 복사본 생성 후 경로 반환."""
    reg_dir = base_dir / "data_raw/_registry"
    reg_dir.mkdir(parents=True)
    dst = reg_dir / "datasets.json"
    shutil.copy(REGISTRY_ORIG, dst)
    return dst


def run_scheduler_subprocess(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    """etl_scheduler.py를 서브프로세스로 실행."""
    cmd = [sys.executable, str(PROJECT_ROOT / "etl_scheduler.py")] + args
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(cwd),
        env={
            **__import__("os").environ,
            "ETL_LOCK_DIR": str(cwd / "locks"),
        },
    )


# ---------------------------------------------------------------------------
# 테스트 함수
# ---------------------------------------------------------------------------

def test_module_loads():
    """etl_scheduler 모듈이 임포트 오류 없이 로드된다."""
    mod = importlib.import_module(SCHEDULER_MOD)
    assert hasattr(mod, "main"), "main() 함수 없음"
    assert hasattr(mod, "is_due"), "is_due() 함수 없음"
    assert hasattr(mod, "compute_next_run_at"), "compute_next_run_at() 없음"
    print("  PASS: 모듈 로드 성공")


def test_list_mode():
    """--list 실행 시 5개 데이터셋 행이 출력된다."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        make_temp_registry(tmp_path)
        proc = run_scheduler_subprocess(["--list"], cwd=tmp_path)
        assert proc.returncode == 0, f"returncode={proc.returncode}\n{proc.stderr}"
        lines = [l for l in proc.stdout.splitlines() if l.strip() and not l.startswith("KEY")]
        assert len(lines) == 5, f"기대 5행, 실제 {len(lines)}행\n{proc.stdout}"
    print("  PASS: --list 5개 출력 확인")


def test_dry_run_kosis():
    """--force kosis_living_pop --dry-run 실행 시 status=success.

    etl_scheduler.py의 REGISTRY_PATH는 __file__ 기준 절대경로로 고정돼 있어
    cwd와 무관하게 프로젝트 원본 datasets.json을 사용한다.
    따라서 여기서는 stdout 결과만 검증한다.
    """
    proc = run_scheduler_subprocess(
        ["--force", "kosis_living_pop", "--dry-run"], cwd=PROJECT_ROOT
    )
    assert proc.returncode == 0, f"returncode={proc.returncode}\n{proc.stderr}"
    output = json.loads(proc.stdout)
    results = output.get("results", [])
    assert len(results) == 1, "결과 1건 기대"
    assert results[0]["status"] == "success", f"status={results[0]}"
    assert results[0].get("marker") == "synthetic", "dry-run marker != synthetic"
    print("  PASS: dry-run kosis_living_pop → success (marker=synthetic)")


def test_blocked_other():
    """--force localdata_biz (모듈 미구현) → status=blocked 기록."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        reg_path = make_temp_registry(tmp_path)
        proc = run_scheduler_subprocess(
            ["--force", "localdata_biz", "--dry-run"], cwd=tmp_path
        )
        # blocked는 returncode 1 (all_ok=False) 또는 0 모두 허용 — 결과 내용만 검증
        output = json.loads(proc.stdout)
        results = output.get("results", [])
        assert len(results) == 1, "결과 1건 기대"
        assert results[0]["status"] == "blocked", f"status={results[0]}"
        assert "미구현" in results[0].get("reason", ""), "reason에 '미구현' 없음"
    print("  PASS: localdata_biz → blocked (ETL 모듈 미구현)")


def test_consecutive_failures_to_blocked():
    """failure 3회 누적 시 frequency가 'blocked'로 변경된다."""
    import etl_scheduler as sched_mod

    ds = {
        "key": "dummy",
        "schedule": {
            "frequency": "daily",
            "consecutive_failures": 2,
            "last_run_status": "pending",
        },
    }
    now = datetime.now(timezone.utc)
    result = {"status": "failure", "reason": "테스트 실패"}
    sched_mod.update_after_run(ds, result, now)

    assert ds["schedule"]["consecutive_failures"] == 3
    assert ds["schedule"]["frequency"] == "blocked", \
        f"3회 후에도 frequency={ds['schedule']['frequency']}"
    print("  PASS: 3회 연속 failure → frequency='blocked'")


def test_next_run_at_computed():
    """success 후 next_run_at이 현재보다 미래 시각으로 설정된다."""
    import etl_scheduler as sched_mod

    now = datetime.now(timezone.utc)
    ds = {
        "key": "dummy",
        "schedule": {"frequency": "monthly", "consecutive_failures": 0},
    }
    result = {"status": "success"}
    sched_mod.update_after_run(ds, result, now)

    nra_str = ds["schedule"].get("next_run_at")
    assert nra_str is not None, "next_run_at이 None"
    nra = datetime.fromisoformat(nra_str)
    # compute_next_run_at은 isoformat()으로 naive datetime 문자열을 반환한다.
    # now는 aware(UTC)이므로 naive로 변환 후 비교.
    now_naive = now.replace(tzinfo=None)
    nra_naive = nra.replace(tzinfo=None) if nra.tzinfo else nra
    assert nra_naive > now_naive, f"next_run_at({nra_naive})이 현재({now_naive})보다 과거"
    print("  PASS: success 후 next_run_at이 미래 시각으로 설정됨")


# ---------------------------------------------------------------------------
# 러너
# ---------------------------------------------------------------------------

TESTS = [
    test_module_loads,
    test_list_mode,
    test_dry_run_kosis,
    test_blocked_other,
    test_consecutive_failures_to_blocked,
    test_next_run_at_computed,
]


def main():
    passed = 0
    failed = 0
    for fn in TESTS:
        label = fn.__name__
        try:
            print(f"[{label}]")
            fn()
            passed += 1
        except Exception as e:
            print(f"  FAIL: {e}")
            failed += 1
    print(f"\n결과: {passed}/{len(TESTS)} 통과 {'✓' if failed == 0 else '✗'}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
