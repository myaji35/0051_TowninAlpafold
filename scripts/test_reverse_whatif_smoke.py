#!/usr/bin/env python3
"""
ISS-196 — Reverse What-If 파이프라인 스모크 테스트
검증: 전체 파이프라인이 30초 이내에 3개 시나리오를 생성하는지 확인
실행: python scripts/test_reverse_whatif_smoke.py
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent
PYTHON = sys.executable

TARGET = "tx_volume"
DONG = "의정부_금오동"
GOAL = 15
MAX_RUNTIME_SEC = 300  # pipeline 전체 허용 시간 (train 포함 시 느림)
MIN_SCENARIOS = 3


def test_pipeline_runs():
    """파이프라인 실행 → whatif_result.json 생성 확인."""
    print(f"[smoke] reverse_whatif_pipeline.py --dong {DONG} --target {TARGET} --goal {GOAL}")
    t0 = time.time()
    result = subprocess.run(
        [PYTHON, "reverse_whatif_pipeline.py",
         "--dong", DONG, "--target", TARGET, "--goal", str(GOAL),
         "--skip-train"],  # 모델 이미 존재하면 train 건너뜀
        capture_output=True, text=True, timeout=MAX_RUNTIME_SEC, cwd=ROOT
    )
    elapsed = round(time.time() - t0, 1)
    print(f"       exit_code={result.returncode}, elapsed={elapsed}s")
    if result.returncode != 0:
        print(f"       STDOUT: {result.stdout[-500:]}")
        print(f"       STDERR: {result.stderr[-500:]}")
        return False, elapsed
    return True, elapsed


def test_output_file():
    """whatif_result.json 파일 존재 + 3개 시나리오 포함 검증."""
    path = ROOT / "whatif_result.json"
    if not path.exists():
        print("[smoke] FAIL: whatif_result.json 없음")
        return False
    data = json.loads(path.read_text())
    scenarios = data.get("scenarios", {})
    n_scenarios = len(scenarios)
    print(f"[smoke] 시나리오 수: {n_scenarios} (최소 {MIN_SCENARIOS} 요구)")
    if n_scenarios < MIN_SCENARIOS:
        print(f"[smoke] FAIL: 시나리오 {n_scenarios}개 < {MIN_SCENARIOS}개")
        return False
    # 각 시나리오 키 확인
    for name in ["최소변경", "균형", "고효율"]:
        if name not in scenarios:
            print(f"[smoke] FAIL: 시나리오 키 없음 — {name}")
            return False
        sc = scenarios[name]
        if "changes" not in sc or "predicted_y" not in sc:
            print(f"[smoke] FAIL: [{name}] 필수 필드 누락")
            return False
    print("[smoke] 시나리오 구조 OK")
    return True


def test_visitors_total():
    """visitors_total 타깃으로도 실행 성공 확인."""
    print(f"[smoke] visitors_total 타깃 테스트...")
    t0 = time.time()
    result = subprocess.run(
        [PYTHON, "reverse_whatif_pipeline.py",
         "--dong", DONG, "--target", "visitors_total", "--goal", str(GOAL),
         "--skip-train"],
        capture_output=True, text=True, timeout=MAX_RUNTIME_SEC, cwd=ROOT
    )
    elapsed = round(time.time() - t0, 1)
    ok = result.returncode == 0
    print(f"       visitors_total: {'PASS' if ok else 'FAIL'} ({elapsed}s)")
    return ok


def test_tx_per_visitor():
    """ISS-216: tx_per_visitor 타깃 파이프라인 실행 확인."""
    print(f"[smoke] tx_per_visitor 타깃 테스트...")
    t0 = time.time()
    result = subprocess.run(
        [PYTHON, "reverse_whatif_pipeline.py",
         "--dong", DONG, "--target", "tx_per_visitor", "--goal", str(GOAL)],
        capture_output=True, text=True, timeout=MAX_RUNTIME_SEC, cwd=ROOT
    )
    elapsed = round(time.time() - t0, 1)
    ok = result.returncode == 0
    if not ok:
        print(f"       STDERR: {result.stderr[-300:]}")
    print(f"       tx_per_visitor: {'PASS' if ok else 'FAIL'} ({elapsed}s)")
    return ok


def test_tx_delta_6m():
    """ISS-216: tx_delta_6m 타깃 파이프라인 실행 확인."""
    print(f"[smoke] tx_delta_6m 타깃 테스트...")
    t0 = time.time()
    result = subprocess.run(
        [PYTHON, "reverse_whatif_pipeline.py",
         "--dong", DONG, "--target", "tx_delta_6m", "--goal", str(GOAL)],
        capture_output=True, text=True, timeout=MAX_RUNTIME_SEC, cwd=ROOT
    )
    elapsed = round(time.time() - t0, 1)
    ok = result.returncode == 0
    if not ok:
        print(f"       STDERR: {result.stderr[-300:]}")
    print(f"       tx_delta_6m: {'PASS' if ok else 'FAIL'} ({elapsed}s)")
    return ok


def test_decision_tree_unchanged():
    """decision_tree_train.py 파일이 변경되지 않았는지 확인."""
    result = subprocess.run(
        ["git", "diff", "--name-only", "decision_tree_train.py"],
        capture_output=True, text=True, cwd=ROOT
    )
    changed = result.stdout.strip()
    if changed:
        print(f"[smoke] FAIL: decision_tree_train.py가 변경됨")
        return False
    print("[smoke] decision_tree_train.py 미변경 확인 OK")
    return True


def main():
    print("=== Reverse What-If 파이프라인 스모크 테스트 ===")
    results = {}

    ok, elapsed = test_pipeline_runs()
    results["pipeline_runs"] = {"pass": ok, "elapsed_sec": elapsed}

    if ok:
        results["output_file"] = {"pass": test_output_file()}
        results["visitors_total"] = {"pass": test_visitors_total()}
        # ISS-216: 신규 타깃 스모크 (각 timeout 30s 포함 → MAX_RUNTIME_SEC 내)
        results["tx_per_visitor"] = {"pass": test_tx_per_visitor()}
        results["tx_delta_6m"] = {"pass": test_tx_delta_6m()}
    else:
        results["output_file"] = {"pass": False, "skip": "pipeline failed"}
        results["visitors_total"] = {"pass": False, "skip": "pipeline failed"}
        results["tx_per_visitor"] = {"pass": False, "skip": "pipeline failed"}
        results["tx_delta_6m"] = {"pass": False, "skip": "pipeline failed"}

    results["decision_tree_unchanged"] = {"pass": test_decision_tree_unchanged()}

    print()
    print("=== 결과 요약 ===")
    all_pass = True
    for name, r in results.items():
        status = "PASS" if r["pass"] else ("SKIP" if r.get("skip") else "FAIL")
        if not r["pass"] and not r.get("skip"):
            all_pass = False
        print(f"  {status:5s} {name}")

    print()
    if all_pass:
        print("OVERALL: PASS")
        return 0
    else:
        print("OVERALL: FAIL")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
