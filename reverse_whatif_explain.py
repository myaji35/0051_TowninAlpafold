#!/usr/bin/env python3
"""
ISS-193 — Reverse What-If SHAP 특성 영향도 분석
입력 : reverse_whatif_model_{tx|vis}.pkl, simula_data_real.json, causal.json
출력 : shap_result_tx.json 또는 shap_result_vis.json
사용 :
  python reverse_whatif_explain.py --target tx_volume
  python reverse_whatif_explain.py --target visitors_total
"""
import argparse
import json
import os
from pathlib import Path

import joblib
import numpy as np
import shap

from reverse_whatif_common import (
    _target_suffix,
    build_X as _build_X_rows,
)

ROOT = Path(__file__).parent
# ISS-217: REVERSE_WHATIF_DATA 환경변수로 데이터 파일 오버라이드 가능
_data_env = os.environ.get("REVERSE_WHATIF_DATA")
SIMULA = Path(_data_env) if _data_env else ROOT / "simula_data_real.json"
CAUSAL = ROOT / "causal.json"

def build_X(target: str):
    """simula_data_real.json + causal.json 에서 X 행렬 전체 재구성 → numpy array.
    ISS-209 leakage fix: target 레이어 평균/추세는 X에서 제외.
    ISS-216: tx_per_visitor는 tx_volume+visitors_total 둘 다 제외, tx_delta_6m은 tx_volume 제외.
    """
    simula = json.loads(SIMULA.read_text())
    causal_data = json.loads(CAUSAL.read_text()) if CAUSAL.exists() else {"dongs": {}}
    rows, _ = _build_X_rows(simula, target, causal_data)
    return np.array(rows, dtype=float)


def analyze(target: str) -> dict:
    # ISS-216: suffix 매핑 확장
    suffix = _target_suffix(target)
    bundle = joblib.load(ROOT / f"reverse_whatif_model_{suffix}.pkl")
    model = bundle["model"]
    scaler = bundle["scaler"]
    feat_names = bundle["feature_names"]
    ctrl_mask = bundle["controllable_mask"]

    X_raw = build_X(target)
    print(f"[{target}] X 행렬: {X_raw.shape[0]}행 × {X_raw.shape[1]}열")

    X_scaled = scaler.transform(X_raw)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_scaled)  # (N, 11)

    mean_abs = np.abs(shap_values).mean(axis=0)
    mean_signed = shap_values.mean(axis=0)

    features = []
    for i, name in enumerate(feat_names):
        controllable = bool(ctrl_mask[i])
        features.append(
            {
                "name": name,
                "shap_mean_abs": round(float(mean_abs[i]), 6),
                "direction": 1 if mean_signed[i] >= 0 else -1,
                "controllable": controllable,
                "excluded": not controllable,
            }
        )

    features.sort(key=lambda x: x["shap_mean_abs"], reverse=True)

    controllable_features = [f["name"] for f in features if f["controllable"]]
    excluded_features = [f["name"] for f in features if f["excluded"]]
    ranked_controllable = [f for f in features if f["controllable"]]

    return {
        "target": target,
        "feature_importance": features,
        "controllable_features": controllable_features,
        "excluded_features": excluded_features,
        "ranked_controllable": ranked_controllable,
    }


def main():
    parser = argparse.ArgumentParser(description="Reverse What-If SHAP 분석")
    parser.add_argument(
        "--target",
        required=True,
        choices=["tx_volume", "visitors_total", "tx_per_visitor", "tx_delta_6m"],
    )
    args = parser.parse_args()

    result = analyze(args.target)

    suffix = _target_suffix(args.target)
    out_path = ROOT / f"shap_result_{suffix}.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"[{args.target}] ✓ {out_path.name} 저장")

    print(f"  통제 가능: {result['controllable_features']}")
    print(f"  제외(통제불가): {result['excluded_features']}")
    top = result["ranked_controllable"]
    if top:
        print(f"  top controllable: {top[0]['name']} (shap={top[0]['shap_mean_abs']:.4f}, dir={top[0]['direction']:+d})")


if __name__ == "__main__":
    main()
