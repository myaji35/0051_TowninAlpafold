#!/usr/bin/env python3
"""
ISS-196 — Reverse What-If 전체 파이프라인 CLI 오케스트레이터
4단계를 순서대로 실행:
  1. train   — RF 회귀 모델 학습 (ISS-192: reverse_whatif_train.py)
  2. explain — SHAP 특성 영향도 분석 (ISS-193: reverse_whatif_explain.py)
  3. whatif  — DiCE Counterfactual 시나리오 생성 (ISS-194: reverse_whatif_counterfactual.py)

사용:
  python reverse_whatif_pipeline.py --dong 의정부_금오동 --target tx_volume --goal 15
  python reverse_whatif_pipeline.py --dong 의정부_금오동 --target visitors_total --goal 15
산출:
  whatif_result.json — 세 단계 결과 통합
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
PYTHON = sys.executable


def run_step(label, cmd, timeout=120):
    """서브프로세스 실행 → (ok, elapsed, stdout, stderr)."""
    t0 = time.time()
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, cwd=ROOT
    )
    elapsed = round(time.time() - t0, 1)
    ok = result.returncode == 0
    return ok, elapsed, result.stdout, result.stderr


def main():
    parser = argparse.ArgumentParser(description="Reverse What-If 파이프라인")
    parser.add_argument("--dong", required=True, help="동 이름 (예: 의정부_금오동)")
    parser.add_argument(
        "--target", required=True, choices=["tx_volume", "visitors_total"]
    )
    parser.add_argument("--goal", type=float, default=15, help="목표 증가율 %%")
    parser.add_argument(
        "--skip-train", action="store_true", help="모델이 이미 존재하면 학습 단계 건너뜀"
    )
    args = parser.parse_args()

    suffix = "tx" if args.target == "tx_volume" else "vis"
    model_file = ROOT / f"reverse_whatif_model_{suffix}.pkl"

    steps = []
    pipeline_t0 = time.time()

    # ── Step 1: 학습 ──────────────────────────────────────────────
    if args.skip_train and model_file.exists():
        print(f"[1/3] train — 모델 존재, 건너뜁니다 ({model_file.name})")
        steps.append({"step": "train", "skipped": True})
    else:
        print(f"[1/3] train — {args.target} RF 모델 학습 중...", flush=True)
        ok, elapsed, stdout, stderr = run_step(
            "train",
            [PYTHON, "reverse_whatif_train.py", "--target", args.target],
            timeout=120,
        )
        status = "ok" if ok else "fail"
        print(f"       {status} ({elapsed}s)")
        if not ok:
            print(f"       STDERR: {stderr[-300:]}")
        steps.append({"step": "train", "status": status, "elapsed_sec": elapsed})
        if not ok:
            _save_and_exit(args, steps, pipeline_t0, error="train failed")

    # ── Step 2: SHAP 설명 ─────────────────────────────────────────
    print(f"[2/3] explain — SHAP 특성 영향도 분석 중...", flush=True)
    ok, elapsed, stdout, stderr = run_step(
        "explain",
        [PYTHON, "reverse_whatif_explain.py", "--target", args.target],
        timeout=180,
    )
    status = "ok" if ok else "fail"
    print(f"       {status} ({elapsed}s)")
    if not ok:
        print(f"       STDERR: {stderr[-300:]}")
    # explain은 실패해도 파이프라인 계속 진행 (선택적 단계)
    steps.append({"step": "explain", "status": status, "elapsed_sec": elapsed})

    # SHAP 결과 로드 (있으면)
    shap_summary = None
    shap_file = ROOT / f"shap_result_{suffix}.json"
    if shap_file.exists():
        try:
            shap_data = json.loads(shap_file.read_text())
            top3 = shap_data.get("feature_importance_mean_abs", [])[:3]
            shap_summary = {"top3_features": top3}
        except Exception:
            pass

    # ── Step 3: Counterfactual ────────────────────────────────────
    print(f"[3/3] whatif — DiCE Counterfactual 시나리오 생성 중...", flush=True)
    ok, elapsed, stdout, stderr = run_step(
        "whatif",
        [PYTHON, "reverse_whatif_counterfactual.py",
         "--dong", args.dong, "--target", args.target, "--goal", str(args.goal)],
        timeout=300,
    )
    status = "ok" if ok else "fail"
    print(f"       {status} ({elapsed}s)")
    if not ok:
        print(f"       STDERR: {stderr[-300:]}")
    steps.append({"step": "whatif", "status": status, "elapsed_sec": elapsed})

    # CF 결과 로드
    cf_data = None
    cf_file = ROOT / f"whatif_scenarios_{suffix}.json"
    if cf_file.exists():
        try:
            cf_data = json.loads(cf_file.read_text())
        except Exception:
            pass

    # ── 통합 결과 저장 ────────────────────────────────────────────
    total_elapsed = round(time.time() - pipeline_t0, 1)
    pipeline_ok = all(s.get("status") in ("ok", None) or s.get("skipped") for s in steps)

    result = {
        "dong": args.dong.replace("_", " "),
        "target": args.target,
        "goal_pct": args.goal,
        "pipeline_status": "ok" if pipeline_ok else "partial",
        "total_elapsed_sec": total_elapsed,
        "steps": steps,
    }

    if shap_summary:
        result["shap_summary"] = shap_summary
    if cf_data:
        result["scenarios"] = cf_data.get("scenarios", {})
        result["current_y"] = cf_data.get("current_y")
        result["target_y"] = cf_data.get("target_y")

    out_path = ROOT / "whatif_result.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))

    print()
    print(f"=== 파이프라인 완료 ({'OK' if pipeline_ok else 'PARTIAL'}) ===")
    print(f"총 소요: {total_elapsed}s")
    if cf_data:
        print(f"시나리오 수: {len(cf_data.get('scenarios', {}))}")
        for name, sc in cf_data.get("scenarios", {}).items():
            ach = sc.get("achievement_pct", "N/A")
            print(f"  [{name}] achievement={ach}%")
    print(f"결과 파일: {out_path.name}")
    return 0 if pipeline_ok else 1


def _save_and_exit(args, steps, pipeline_t0, error):
    total_elapsed = round(time.time() - pipeline_t0, 1)
    result = {
        "dong": args.dong.replace("_", " "),
        "target": args.target,
        "goal_pct": args.goal,
        "pipeline_status": "error",
        "error": error,
        "total_elapsed_sec": total_elapsed,
        "steps": steps,
    }
    out_path = ROOT / "whatif_result.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"[오류] {error}")
    sys.exit(1)


if __name__ == "__main__":
    raise SystemExit(main())
