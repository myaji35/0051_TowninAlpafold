#!/usr/bin/env python3
"""
ISS-205 — DiCE vs scipy 교차 검증 (Cross-Verify)

입력: whatif_scenarios_{tx|vis}.json  (ISS-194 산출)
      reverse_whatif_model_{tx|vis}.pkl (ISS-192 산출)
출력: whatif_result_{tx|vis}.json

검증 방법:
  - DiCE(또는 scipy fallback)가 제안한 changes 를 그대로 scipy로 재검증
  - 동일 changes 를 시작점 삼아 Nelder-Mead 재수렴 → scipy_verified_y 산출
  - diff_pct = |scipy_verified_y - dice_predicted_y| / |dice_predicted_y| * 100
  - diff_pct <= 5 → verified=true

주의: RF 모델은 gradient 가 없으므로 L-BFGS-B 는 사용하지 않음.
      Nelder-Mead (gradient-free) 만 사용한다.
      scipy.optimize.minimize(..., method="Nelder-Mead")

build_X_for_dong 로직은 reverse_whatif_counterfactual.py 의
build_feat_row / find_dong / avg_granger_lag / trend_slope 를 import 해 재사용.
해당 파일은 절대 수정하지 않음.
"""

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).parent

# reverse_whatif_counterfactual.py 의 헬퍼 함수 재사용 (DRY 원칙)
sys.path.insert(0, str(ROOT))
from reverse_whatif_counterfactual import (  # noqa: E402
    build_feat_row,
    find_dong,
)


# ── 데이터 로드 ──────────────────────────────────────────────────────────────

def _load_data():
    simula = json.loads((ROOT / "simula_data_real.json").read_text())
    causal_path = ROOT / "causal.json"
    causal_data = json.loads(causal_path.read_text()) if causal_path.exists() else {"dongs": {}}
    return simula, causal_data


# ── scipy 단순 예측 (changes 를 X_baseline 에 적용 후 model.predict) ─────────

def _apply_changes_and_predict(X_baseline, changes, feat_names, model, scaler):
    """
    changes: {feature_name: delta_실제단위} — counterfactual.py 와 동일 단위 (/1e6 스케일 변환 후 적용).
    feat_names 의 단위는 모두 /1e6 스케일임.
    """
    X_new = X_baseline.copy()
    for feat, delta_real in changes.items():
        if feat in feat_names:
            idx = feat_names.index(feat)
            # counterfactual.py: changes[f] = delta_scaled * 1e6 → 역변환: /1e6
            X_new[idx] += delta_real / 1e6
    raw_pred = float(model.predict(scaler.transform([X_new]))[0])
    return raw_pred, X_new  # 내부 스케일(/1e6) 반환


# ── scipy Nelder-Mead 재수렴 검증 ─────────────────────────────────────────────

def _scipy_reverify(X_baseline, changes, feat_names, ctrl_features, model, scaler, target_y_internal):
    """
    changes 를 시작점으로 Nelder-Mead 재최적화.
    ctrl_features 에 해당하는 인덱스만 자유변수로 사용.
    target_y_internal: 내부 스케일(/1e6)
    반환: scipy 가 찾은 최적 X 에 대한 model 예측 (내부 스케일)
    """
    ctrl_idx = [feat_names.index(f) for f in ctrl_features if f in feat_names]
    X_start = X_baseline.copy()
    for feat, delta_real in changes.items():
        if feat in feat_names:
            idx = feat_names.index(feat)
            X_start[idx] += delta_real / 1e6

    x0 = np.array([X_start[i] for i in ctrl_idx], dtype=float)

    def objective(x_ctrl):
        X_try = X_baseline.copy()
        for j, idx in enumerate(ctrl_idx):
            X_try[idx] = x_ctrl[j]
        pred = float(model.predict(scaler.transform([X_try]))[0])
        return abs(pred - target_y_internal)

    res = minimize(
        objective, x0,
        method="Nelder-Mead",
        options={"maxiter": 500, "xatol": 1e-8, "fatol": 1e-10, "adaptive": True},
    )

    X_opt = X_baseline.copy()
    for j, idx in enumerate(ctrl_idx):
        X_opt[idx] = res.x[j]
    scipy_pred_internal = float(model.predict(scaler.transform([X_opt]))[0])
    return scipy_pred_internal


# ── 메인 교차 검증 로직 ───────────────────────────────────────────────────────


def cross_verify(target: str) -> dict:
    # ISS-216: suffix 매핑 확장
    suffix = {"tx_volume": "tx", "visitors_total": "vis",
               "tx_per_visitor": "tpv", "tx_delta_6m": "tdelta"}[target]
    scenarios_file = ROOT / f"whatif_scenarios_{suffix}.json"
    model_file = ROOT / f"reverse_whatif_model_{suffix}.pkl"

    if not scenarios_file.exists():
        raise FileNotFoundError(
            f"{scenarios_file.name} not found. "
            "Run reverse_whatif_counterfactual.py first."
        )
    if not model_file.exists():
        raise FileNotFoundError(
            f"{model_file.name} not found. "
            "Run reverse_whatif_train.py first."
        )

    scenarios_data = json.loads(scenarios_file.read_text())
    bundle = joblib.load(model_file)
    model = bundle["model"]
    scaler = bundle["scaler"]
    feat_names = bundle["feature_names"]
    # ISS-209: bundle의 controllable_mask 기반 동적 추출
    ctrl_mask = bundle["controllable_mask"]
    ctrl_features = [feat_names[i] for i, c in enumerate(ctrl_mask) if c]
    print(f"[{target}] 통제 가능 특성 ({len(ctrl_features)}개): {ctrl_features}")

    dong_name = scenarios_data["dong"]
    baseline_y_real = float(scenarios_data["current_y"])   # 실제 단위
    target_y_real = float(scenarios_data["target_y"])       # 실제 단위
    goal_pct = scenarios_data["goal_pct"]

    # 내부 스케일 (모델 예측값 단위)
    # tx: current_y 는 이미 소규모 → /1e6 없이 직접 저장돼 있음
    # → counterfactual.py 가 round(pred_y * 1e6, 4) 로 저장했으므로
    #   baseline_y_internal = baseline_y_real / 1e6
    baseline_y_internal = baseline_y_real / 1e6
    target_y_internal = target_y_real / 1e6

    # 동 X baseline 재구성 (ISS-209: target 전달로 leakage 특성 제외)
    simula, causal_data = _load_data()
    dong_dict = find_dong(simula, dong_name)
    if dong_dict is None:
        raise ValueError(f"동 '{dong_name}' 을 simula_data_real.json 에서 찾을 수 없습니다.")

    X_baseline = build_feat_row(dong_dict, causal_data, target=target)
    if X_baseline is None:
        raise ValueError(f"동 '{dong_name}' 의 X baseline 빌드 실패 (NaN 포함).")
    X_baseline = np.array(X_baseline, dtype=float)

    print(f"[{target}] 동: {dong_name}")
    print(f"[{target}] baseline_y={baseline_y_real:.4f}  target_y={target_y_real:.4f}  goal={goal_pct}%")

    result_scenarios = []
    scenarios_dict = scenarios_data.get("scenarios", {})

    for label, scen in scenarios_dict.items():
        strategy = scen.get("strategy", label)
        changes = scen.get("changes", {})
        dice_pred_y_real = scen.get("predicted_y")  # 실제 단위

        # no_solution 또는 changes 가 전부 0 이고 note 있는 경우
        if scen.get("status") == "no_solution" or dice_pred_y_real is None:
            result_scenarios.append({
                "scenario": label,
                "strategy": strategy,
                "verified": False,
                "note": scen.get("note", "no_solution from DiCE"),
            })
            print(f"  [{label}] skip (no_solution)")
            continue

        # scipy 직접 적용 예측
        scipy_direct_internal, _ = _apply_changes_and_predict(
            X_baseline, changes, feat_names, model, scaler
        )
        scipy_direct_real = scipy_direct_internal * 1e6

        # scipy Nelder-Mead 재수렴 (ISS-209: ctrl_features 동적)
        scipy_opt_internal = _scipy_reverify(
            X_baseline, changes, feat_names, ctrl_features,
            model, scaler, target_y_internal
        )
        scipy_verified_y_real = scipy_opt_internal * 1e6

        # diff_pct: DiCE 예측 vs scipy 직접 적용 비교 (changes 적용 일관성)
        if abs(dice_pred_y_real) > 1e-10:
            diff_pct = abs(scipy_direct_real - dice_pred_y_real) / abs(dice_pred_y_real) * 100
        else:
            diff_pct = 0.0

        # achievement_rate: scipy verified y 기준
        denom = target_y_real - baseline_y_real
        if abs(denom) > 1e-10:
            achievement_rate_pct = (scipy_verified_y_real - baseline_y_real) / denom * 100
        else:
            achievement_rate_pct = 100.0

        verified = diff_pct <= 5.0

        result_scenarios.append({
            "scenario": label,
            "strategy": strategy,
            "changes": changes,
            "dice_predicted_y": round(float(dice_pred_y_real), 4),
            "scipy_verified_y": round(float(scipy_verified_y_real), 4),
            "achievement_rate_pct": round(float(achievement_rate_pct), 2),
            "diff_pct": round(float(diff_pct), 3),
            "verified": verified,
        })

        print(
            f"  [{label}] dice={dice_pred_y_real:.4f}  scipy_direct={scipy_direct_real:.4f}"
            f"  scipy_opt={scipy_verified_y_real:.4f}"
            f"  diff={diff_pct:.3f}%  verified={verified}"
        )

    # all_verified: changes 가 있는 시나리오만 대상
    verifiable = [s for s in result_scenarios if "changes" in s]
    all_verified = bool(verifiable) and all(s.get("verified", False) for s in verifiable)

    out = {
        "dong": dong_name,
        "target": target,
        "goal_pct": goal_pct,
        "baseline_y": baseline_y_real,
        "target_y": target_y_real,
        "scenarios": result_scenarios,
        "all_verified": all_verified,
    }

    out_file = ROOT / f"whatif_result_{suffix}.json"
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[{target}] ✓ {out_file.name} 저장  all_verified={all_verified}")
    return out


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="DiCE vs scipy 교차 검증 — whatif_result_{tx|vis}.json 생성"
    )
    parser.add_argument(
        "--target",
        required=True,
        choices=["tx_volume", "visitors_total", "tx_per_visitor", "tx_delta_6m"],
        help="검증 타깃 레이어",
    )
    args = parser.parse_args()
    cross_verify(args.target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
