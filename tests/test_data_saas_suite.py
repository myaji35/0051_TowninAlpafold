"""tests/test_data_saas_suite.py
기존 4개 stdlib 테스트를 pytest 진입점으로 통합.
각 스크립트를 subprocess로 실행하여 결과를 pytest PASS/FAIL로 변환.
새 의존성 없음 — stdlib subprocess 만 사용.
"""
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"


def _run(script: str) -> tuple[int, str]:
    """스크립트를 현재 Python 인터프리터로 실행하고 (exit_code, output) 반환."""
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / script)],
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
    )
    output = result.stdout + result.stderr
    return result.returncode, output


def test_etl_infra():
    """ETL 인프라 4종 smoke test (6건) — utils/etl_lock, retry, rate, schema."""
    code, output = _run("test_etl_infra.py")
    print(output)
    assert code == 0, f"test_etl_infra.py 실패:\n{output}"


def test_manifest_repo():
    """ManifestRepo JSON/SQLite/Postgres stub + env 라우팅 (7건)."""
    code, output = _run("test_manifest_repo.py")
    print(output)
    assert code == 0, f"test_manifest_repo.py 실패:\n{output}"


def test_model_review_queue():
    """ModelReviewQueue 상태 전이 + 목록 필터 (9건)."""
    code, output = _run("test_model_review_queue.py")
    print(output)
    assert code == 0, f"test_model_review_queue.py 실패:\n{output}"


def test_batch_queue():
    """BatchQueue enqueue/process/persist/API (11건)."""
    code, output = _run("test_batch_queue.py")
    print(output)
    assert code == 0, f"test_batch_queue.py 실패:\n{output}"
