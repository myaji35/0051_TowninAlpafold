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
import statistics
from pathlib import Path

import joblib
import numpy as np
import shap

ROOT = Path(__file__).parent
# ISS-217: REVERSE_WHATIF_DATA 환경변수로 데이터 파일 오버라이드 가능
_data_env = os.environ.get("REVERSE_WHATIF_DATA")
SIMULA = Path(_data_env) if _data_env else ROOT / "simula_data_real.json"
CAUSAL = ROOT / "causal.json"

LAYERS = ["biz_count", "biz_cafe", "visitors_total", "tx_volume", "land_price"]
LAYER_KO = {
    "biz_count": "소상공",
    "biz_cafe": "카페",
    "visitors_total": "유동",
    "tx_volume": "거래",
    "land_price": "지가",
}
CONTROLLABLE_LAYERS = {"biz_count", "biz_cafe", "visitors_total"}


def trend_slope(values):
    if len(values) < 12:
        return 0.0
    last12 = values[-12:]
    n = len(last12)
    mean_y = statistics.mean(last12)
    if mean_y == 0:
        return 0.0
    mean_x = (n - 1) / 2
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(range(n), last12))
    den = sum((x - mean_x) ** 2 for x in range(n))
    if den == 0:
        return 0.0
    return (num / den) / mean_y


def avg_granger_lag(causal, dong_code):
    info = causal.get("dongs", {}).get(dong_code, {})
    grangers = info.get("granger", [])
    if not grangers:
        return 0
    return statistics.mean(g.get("lag", 0) for g in grangers)


def build_X(target: str):
    """simula_data_real.json + causal.json 에서 X 행렬 전체 재구성.
    ISS-209 leakage fix: target 레이어 평균/추세는 X에서 제외.
    ISS-216: tx_per_visitor는 tx_volume+visitors_total 둘 다 제외, tx_delta_6m은 tx_volume 제외.
    """
    # ISS-216: 제외 레이어 결정 (pkl bundle의 feature_names와 일치해야 함)
    if target == "tx_per_visitor":
        exclude_layers = {"tx_volume", "visitors_total"}
    elif target == "tx_delta_6m":
        exclude_layers = {"tx_volume"}
    else:
        exclude_layers = {target}

    simula = json.loads(SIMULA.read_text())
    causal_data = json.loads(CAUSAL.read_text()) if CAUSAL.exists() else {"dongs": {}}

    rows = []
    for d in simula["dongs"]:
        code = d.get("code", "")
        layers = d.get("layers", {})

        # Y 유효성 확인 (존재하는 행만)
        if target == "tx_per_visitor":
            tx_s = layers.get("tx_volume", [])
            vis_s = layers.get("visitors_total", [])
            if len(tx_s) < 12 or len(vis_s) < 12:
                continue
            y_scalar = statistics.mean([t / v if v > 0 else 0 for t, v in zip(tx_s, vis_s)])
        elif target == "tx_delta_6m":
            tx_s = layers.get("tx_volume", [])
            if len(tx_s) < 12:
                continue
            y_scalar = statistics.mean(tx_s[-6:]) - statistics.mean(tx_s[-12:-6])
        else:
            y_raw = layers.get(target, [])
            if len(y_raw) < 12:
                continue
            y_scalar = statistics.mean(y_raw)
        if y_scalar == 0:
            continue

        feat = []
        for L in LAYERS:
            if L in exclude_layers:
                continue  # leakage 제외
            vals = layers.get(L, [])
            if len(vals) < 12:
                feat.append(0.0)
                feat.append(0.0)
            else:
                feat.append(statistics.mean(vals) / 1e6)
                feat.append(trend_slope(vals))
        feat.append(avg_granger_lag(causal_data, code))

        if any(v != v for v in feat):  # NaN guard
            continue

        rows.append(feat)

    return np.array(rows, dtype=float)


def analyze(target: str) -> dict:
    # ISS-216: suffix 매핑 확장
    suffix = {"tx_volume": "tx", "visitors_total": "vis",
               "tx_per_visitor": "tpv", "tx_delta_6m": "tdelta"}[target]
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

    suffix = {"tx_volume": "tx", "visitors_total": "vis",
               "tx_per_visitor": "tpv", "tx_delta_6m": "tdelta"}[args.target]
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
