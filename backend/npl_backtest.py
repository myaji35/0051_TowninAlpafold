"""backend/npl_backtest.py
NPL 평가엔진 백테스트 프레임워크 — 예측(recovery_p50, IRR)과 실제 회수결과의 수렴 검증.

⚠ 중요 — 데이터 현황:
  현재(2026-06) portfolio_demo.json 80건에는 실제 낙찰가/회수결과(ground truth)가 없음.
  예측값(output)만 존재하므로 진짜 out-of-sample 검증은 실 경매결과 입수 후 가능.

  이 파일은:
  1. 실데이터 도착 시 즉시 작동하는 백테스트 엔진 코드
  2. 합성 ground truth로 프레임워크 자체의 정확성 검증 (make_ground_truth)

  ⚠ make_ground_truth() 결과는 "프레임워크 검증용 합성 ground truth"이다.
    실 경매결과와 무관하며, 실데이터 백테스트 통과로 해석하면 안 됨.
    실데이터 백테스트는 보유 7.7조 리스트 중 경매완료분 입수 후 수행한다.

실행:
  python -m backend.npl_backtest            # 기본 2000건 합성 검증
  python -m backend.npl_backtest --n 500 --seed 7
"""
from __future__ import annotations

import argparse
import math
import random
from typing import Optional

from backend.npl_batch_score import generate_synthetic
from backend.npl_scorer import evaluate_buy
from backend.npl_auction_rates import auction_rate, region_tier


# ── 합성 ground truth 노이즈 파라미터 ──────────────────────────────────────────
# 실제 경매 시장에서 낙찰가율은 모델 예측 주변에 분포하되, 일부 극단 케이스 존재.
# 표준편차(NOISE_STD)를 0으로 설정하면 예측=실제 → MAE≈0 sanity check에 활용.
_DEFAULT_NOISE_STD = 0.08   # 낙찰가율 표준편차 (±8%p) — 현실 시장 변동성 반영
_CRASH_PROB = 0.05          # 5% 확률로 p10 이하 하락 (부동산 하락 시나리오)
_CRASH_SEVERITY = 0.75      # 하락 시 실제 = 예측 p10 × 0.75


def make_ground_truth(
    items: list[dict],
    scored: list[dict],
    seed: int = 0,
    noise_std: float = _DEFAULT_NOISE_STD,
) -> list[dict]:
    """
    각 물건에 actual_recovery, actual_auction_rate를 합성 부여.

    ⚠ 이 함수가 생성하는 ground truth는 프레임워크 검증용 합성 데이터임.
      실제 경매 낙찰 결과와 무관. 실데이터 백테스트는 실 경매결과 입수 후 수행.

    합성 방법:
      - 기본: 예측 낙찰가율(p50) 주변에 정규 노이즈(noise_std) 부여
      - crash_prob 확률로 p10 이하 극단 하락 (부동산 하락 시나리오 모사)
      - noise_std=0이면 actual_auction_rate = 예측 p50 → sanity check용

    Args:
        items:      generate_synthetic 결과 (입력 dict)
        scored:     evaluate_buy 결과 (예측 dict)
        seed:       난수 시드
        noise_std:  낙찰가율 노이즈 표준편차 (0=완벽예측 sanity)

    Returns:
        actuals: List[dict] — 각 건에 actual_auction_rate, actual_recovery, gt_source 포함.
    """
    rng = random.Random(seed)
    actuals = []

    for item, pred in zip(items, scored):
        if pred is None or pred.get("grade") == "error":
            actuals.append({"id": item.get("id"), "skip": True})
            continue

        # 예측 낙찰가율 cone
        rate = auction_rate(item.get("region_code"), item.get("collateral_type"))
        appraisal = float(item.get("appraisal") or (item.get("claim", 0) * 1.2))

        if noise_std == 0.0:
            # sanity 모드: 완벽 예측 (noise 없음)
            actual_rate = rate["p50"]
        else:
            # 현실 노이즈 적용
            is_crash = rng.random() < _CRASH_PROB
            if is_crash:
                # 부동산 하락 시나리오: p10 이하 극단값
                actual_rate = rate["p10"] * _CRASH_SEVERITY * rng.uniform(0.85, 1.0)
            else:
                # 정규분포 노이즈
                noise = rng.gauss(0, noise_std)
                actual_rate = rate["p50"] + noise
                actual_rate = max(0.30, min(1.30, actual_rate))  # 0.3~1.3 범위 제한

        # 권리관계 차감 (예측과 동일 로직 — 실데이터에서는 실제 권리관계 정보 사용)
        deduction = pred.get("rights", {}).get("total_deduction", 0) if isinstance(
            pred.get("rights"), dict
        ) else 0
        actual_recovery = max(0.0, appraisal * actual_rate - deduction)

        actuals.append({
            "id": item.get("id"),
            "actual_auction_rate": round(actual_rate, 4),
            "actual_recovery": round(actual_recovery),
            "predicted_p10": pred.get("recovery_p10", 0),
            "predicted_p50": pred.get("recovery_p50", 0),
            "predicted_p90": pred.get("recovery_p90", 0),
            "region_tier": region_tier(item.get("region_code")),
            "collateral_type": item.get("collateral_type", "apt"),
            "gt_source": "synthetic",  # ⚠ 합성 ground truth — 실데이터 아님
            "skip": False,
        })

    return actuals


def backtest(actuals: list[dict]) -> dict:
    """
    오차지표 산출 — 예측 recovery_p50 vs actual_recovery.

    지표:
      - MAE  : 평균 절대 오차 (만원)
      - RMSE : 제곱근 평균 제곱 오차 (만원)
      - bias : 평균 (예측 - 실제) — 양수=낙관편향, 음수=비관편향
      - MAE_pct : MAE / 평균(actual_recovery) × 100 (상대 오차%)
      - 담보유형별 / 지역권역별 오차 분해

    Args:
        actuals: make_ground_truth 반환 리스트

    Returns:
        오차지표 dict
    """
    valid = [a for a in actuals if not a.get("skip")]
    n = len(valid)
    if n == 0:
        return {"error": "유효 데이터 없음", "n": 0}

    errors = [a["predicted_p50"] - a["actual_recovery"] for a in valid]
    abs_errors = [abs(e) for e in errors]

    mae = sum(abs_errors) / n
    rmse = math.sqrt(sum(e**2 for e in errors) / n)
    bias = sum(errors) / n
    avg_actual = sum(a["actual_recovery"] for a in valid) / n
    mae_pct = (mae / avg_actual * 100) if avg_actual > 0 else float("nan")

    # ── 담보유형별 분해 ──────────────────────────────────────────────────────
    by_type: dict[str, list[float]] = {}
    for a in valid:
        ct = a.get("collateral_type", "unknown")
        by_type.setdefault(ct, []).append(abs(a["predicted_p50"] - a["actual_recovery"]))
    type_mae = {ct: round(sum(v) / len(v)) for ct, v in by_type.items()}

    # ── 지역권역별 분해 ──────────────────────────────────────────────────────
    by_region: dict[str, list[float]] = {}
    for a in valid:
        tier = a.get("region_tier", "unknown")
        by_region.setdefault(tier, []).append(abs(a["predicted_p50"] - a["actual_recovery"]))
    region_mae = {tier: round(sum(v) / len(v)) for tier, v in by_region.items()}

    return {
        "n": n,
        "mae": round(mae),
        "rmse": round(rmse),
        "bias": round(bias),
        "mae_pct": round(mae_pct, 2),
        "avg_actual_recovery": round(avg_actual),
        "by_collateral_type": type_mae,
        "by_region_tier": region_mae,
    }


def coverage_calibration(actuals: list[dict]) -> dict:
    """
    p10~p90 구간이 실제값을 얼마나 커버하는지 (신뢰구간 신뢰성).

    잘 보정된 모델: 실제값이 p10~p90 구간 안에 들어오는 비율 ≈ 80%.
    p50 기준 위/아래 분포도 측정 (과대평가 편향 감지).

    Args:
        actuals: make_ground_truth 반환 리스트

    Returns:
        coverage_rate, above_p50_rate, below_p10_rate 등
    """
    valid = [a for a in actuals if not a.get("skip")]
    n = len(valid)
    if n == 0:
        return {"error": "유효 데이터 없음", "n": 0}

    in_band = sum(
        1 for a in valid
        if a["predicted_p10"] <= a["actual_recovery"] <= a["predicted_p90"]
    )
    above_p50 = sum(1 for a in valid if a["actual_recovery"] > a["predicted_p50"])
    below_p10 = sum(1 for a in valid if a["actual_recovery"] < a["predicted_p10"])
    above_p90 = sum(1 for a in valid if a["actual_recovery"] > a["predicted_p90"])

    return {
        "n": n,
        "coverage_rate": round(in_band / n * 100, 1),    # 목표: ≈ 80%
        "above_p50_rate": round(above_p50 / n * 100, 1),  # 이상적: ≈ 50%
        "below_p10_rate": round(below_p10 / n * 100, 1),  # 이상적: ≈ 10%
        "above_p90_rate": round(above_p90 / n * 100, 1),  # 이상적: ≈ 10%
        "in_band_count": in_band,
        "note": (
            "coverage_rate ≈ 80%이면 p10~p90 구간이 잘 보정됨. "
            "크게 낮으면 구간이 너무 좁거나 편향. 실데이터 도착 시 재측정 필수."
        ),
    }


def derive_correction(actuals: list[dict]) -> dict:
    """
    체계적 편향 발견 시 보정계수 산출.

    예: 모델이 지방 토지를 +15% 과대평가 → 보정계수 0.85.
    실데이터 도착 전 합성 검증에서 의도적 편향 주입 테스트에 활용.

    Args:
        actuals: make_ground_truth 반환 리스트

    Returns:
        전체 보정계수 + 담보유형별 × 지역별 보정 행렬
    """
    valid = [a for a in actuals if not a.get("skip") and a["actual_recovery"] > 0]
    n = len(valid)
    if n == 0:
        return {"error": "유효 데이터 없음", "n": 0}

    # 전체 보정계수: avg(actual / predicted_p50)
    ratios = [a["actual_recovery"] / a["predicted_p50"]
              for a in valid if a["predicted_p50"] > 0]
    if not ratios:
        return {"error": "predicted_p50 모두 0", "n": n}

    global_correction = round(sum(ratios) / len(ratios), 4)

    # 담보유형별 보정계수
    by_type: dict[str, list[float]] = {}
    for a in valid:
        if a["predicted_p50"] > 0:
            ct = a.get("collateral_type", "unknown")
            by_type.setdefault(ct, []).append(a["actual_recovery"] / a["predicted_p50"])
    type_correction = {ct: round(sum(v) / len(v), 4) for ct, v in by_type.items()}

    # 지역별 보정계수
    by_region: dict[str, list[float]] = {}
    for a in valid:
        if a["predicted_p50"] > 0:
            tier = a.get("region_tier", "unknown")
            by_region.setdefault(tier, []).append(
                a["actual_recovery"] / a["predicted_p50"]
            )
    region_correction = {t: round(sum(v) / len(v), 4) for t, v in by_region.items()}

    bias_direction = (
        "낙관편향 (모델 과대평가)" if global_correction < 0.97
        else "비관편향 (모델 과소평가)" if global_correction > 1.03
        else "균형 (편향 없음)"
    )

    return {
        "n": len(ratios),
        "global_correction": global_correction,
        "bias_direction": bias_direction,
        "by_collateral_type": type_correction,
        "by_region_tier": region_correction,
        "interpretation": (
            f"global_correction={global_correction}이면 예측값에 "
            f"{global_correction}을 곱해 편향 보정 가능. "
            "1.0에 가까울수록 모델 편향 없음."
        ),
    }


def run(
    n: int = 2000,
    seed: int = 42,
    noise_std: float = _DEFAULT_NOISE_STD,
) -> dict:
    """
    합성 ground truth로 백테스트 프레임워크 전체 실행.

    ⚠ 합성 ground truth 사용 — 실데이터 백테스트 결과 아님.
      실데이터 백테스트는 실 경매낙찰 결과(actual_auction_rate, actual_recovery)
      컬럼을 포함한 CSV/JSON 입수 후 backtest() 직접 호출로 수행.

    Args:
        n:          합성 자산 건수
        seed:       난수 시드 (재현성)
        noise_std:  낙찰가율 노이즈 표준편차 (0=완벽예측 sanity)

    Returns:
        {meta, error_metrics, calibration, correction, gt_source}
    """
    # 1. 합성 입력 생성
    items = generate_synthetic(n=n, seed=seed)

    # 2. 평가엔진 예측
    scored = []
    for item in items:
        result = evaluate_buy(item)
        scored.append(result if result is not None else {"grade": "error"})

    valid_count = sum(1 for s in scored if s and s.get("grade") != "error")

    # 3. 합성 ground truth 생성
    actuals = make_ground_truth(items, scored, seed=seed, noise_std=noise_std)

    # 4. 오차지표
    err = backtest(actuals)

    # 5. 구간 보정
    cal = coverage_calibration(actuals)

    # 6. 보정계수
    cor = derive_correction(actuals)

    report = {
        "meta": {
            "gt_source": "synthetic",  # ⚠ 합성 ground truth — 실데이터 아님
            "n_input": n,
            "n_valid": valid_count,
            "noise_std": noise_std,
            "seed": seed,
            "warning": (
                "프레임워크 검증용 합성 ground truth 사용. "
                "실데이터 백테스트는 실 경매결과 입수 후 수행."
            ),
        },
        "error_metrics": err,
        "calibration": cal,
        "correction": cor,
    }

    _print_report(report)
    return report


def _print_report(r: dict) -> None:
    """콘솔 출력 — 핵심 수치만."""
    m = r["meta"]
    e = r["error_metrics"]
    c = r["calibration"]
    cor = r["correction"]

    print(f"\n{'='*60}")
    print(f"NPL 백테스트 결과  [{m['gt_source'].upper()}]  n={m['n_valid']}")
    print(f"{'='*60}")
    print(f"⚠  {m['warning']}")
    print(f"\n── 오차지표 (예측 p50 vs actual) ──")
    print(f"  MAE     : {e.get('mae', 'N/A'):>10,} 만원")
    print(f"  RMSE    : {e.get('rmse', 'N/A'):>10,} 만원")
    print(f"  bias    : {e.get('bias', 'N/A'):>+10,} 만원  (양수=낙관편향)")
    print(f"  MAE_pct : {e.get('mae_pct', 'N/A'):>9}%")
    print(f"\n── 구간 보정 (p10~p90 커버리지) ──")
    print(f"  coverage_rate : {c.get('coverage_rate', 'N/A')}%  (목표 ≈ 80%)")
    print(f"  above_p50     : {c.get('above_p50_rate', 'N/A')}%  (이상적 ≈ 50%)")
    print(f"  below_p10     : {c.get('below_p10_rate', 'N/A')}%  (이상적 ≈ 10%)")
    print(f"\n── 보정계수 ──")
    print(f"  global : {cor.get('global_correction', 'N/A')}  → {cor.get('bias_direction', '')}")
    if "by_collateral_type" in cor:
        print(f"  담보유형별: {cor['by_collateral_type']}")
    if "by_region_tier" in cor:
        print(f"  지역권역별: {cor['by_region_tier']}")


# ── CLI ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NPL 백테스트 프레임워크")
    parser.add_argument("--n", type=int, default=2000, help="건수 (기본: 2,000)")
    parser.add_argument("--seed", type=int, default=42, help="난수 시드")
    parser.add_argument("--noise-std", type=float, default=_DEFAULT_NOISE_STD,
                        help="낙찰가율 노이즈 σ (0=sanity, 기본 0.08)")
    args = parser.parse_args()
    run(n=args.n, seed=args.seed, noise_std=args.noise_std)
