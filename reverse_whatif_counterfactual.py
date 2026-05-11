#!/usr/bin/env python3
"""
ISS-194 — DiCE Counterfactual 시나리오 생성
입력: reverse_whatif_model_{tx|vis}.pkl (ISS-192 산출), simula_data_real.json
출력: whatif_scenarios_tx.json / whatif_scenarios_vis.json
방법: dice-ml 0.12 genetic 방식 (1차 시도) -> 타임아웃/수렴 실패 시 scipy 최적화 fallback
시나리오: 최소변경 / 균형 / 고효율 (각각 변경 특성/제약 다름)
"""
import argparse
import json
import statistics
import threading
from pathlib import Path

import dice_ml
import joblib
import numpy as np
import pandas as pd
from scipy.optimize import minimize

ROOT = Path(__file__).parent
SIMULA = ROOT / "simula_data_real.json"
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

SCENARIO_MAX_DELTA = {"최소변경": 0.20, "균형": 0.50, "고효율": 1.50}


def get_ctrl_features(feat_names, controllable_mask):
    """ISS-209: bundle의 controllable_mask 기반 동적 추출."""
    return [feat_names[i] for i, c in enumerate(controllable_mask) if c]


def get_scenario_features(ctrl_feats, feat_names, controllable_mask):
    """ISS-209: 시나리오별 vary 특성 동적 구성."""
    ctrl_trend = [
        feat_names[i] for i, c in enumerate(controllable_mask)
        if not c and i > 0 and controllable_mask[i - 1]
    ]
    return {
        "최소변경": ctrl_feats,
        "균형":     ctrl_feats,
        "고효율":   ctrl_feats + ctrl_trend,
    }


def trend_slope(values):
    if len(values) < 12:
        return 0.0
    last12 = values[-12:]
    n = len(last12)
    xs = list(range(n))
    mean_y = statistics.mean(last12)
    if mean_y == 0:
        return 0.0
    mean_x = (n - 1) / 2
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, last12))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0:
        return 0.0
    return (num / den) / mean_y


def avg_granger_lag(causal, dong_code):
    info = causal.get("dongs", {}).get(dong_code, {})
    grangers = info.get("granger", [])
    if not grangers:
        return 0
    return statistics.mean(g.get("lag", 0) for g in grangers)


def build_feat_row(d, causal_data, target=None):
    """ISS-209 leakage fix: target 레이어 평균/추세를 X에서 제외."""
    layers = d.get("layers", {})
    feat = []
    for L in LAYERS:
        if L == target:
            continue  # leakage 제외
        vals = layers.get(L, [])
        if len(vals) < 12:
            feat.append(0.0)
            feat.append(0.0)
        else:
            feat.append(statistics.mean(vals) / 1e6)
            feat.append(trend_slope(vals))
    feat.append(avg_granger_lag(causal_data, d.get("code", "")))
    if any(v != v for v in feat):
        return None
    return feat


def build_X_all(simula, causal_data, target):
    rows, y_vals = [], []
    for d in simula["dongs"]:
        layers = d.get("layers", {})
        y_raw = layers.get(target, [])
        if len(y_raw) < 12:
            continue
        y_scalar = statistics.mean(y_raw)
        if y_scalar == 0:
            continue
        feat = build_feat_row(d, causal_data, target=target)  # ISS-209: leakage 제외
        if feat is None:
            continue
        rows.append(feat)
        y_vals.append(y_scalar / 1e6)
    return rows, y_vals


def normalize_dong_name(raw):
    return raw.replace("_", " ").strip()


def find_dong(simula, dong_name):
    for d in simula["dongs"]:
        if d["name"] == dong_name:
            return d
    norm = dong_name.replace(" ", "").replace("_", "")
    for d in simula["dongs"]:
        if d["name"].replace(" ", "").replace("_", "") == norm:
            return d
    for d in simula["dongs"]:
        if norm in d["name"].replace(" ", "").replace("_", ""):
            return d
    return None


class _TimeoutError(Exception):
    pass


def _dice_genetic(exp, query, desired_range, features_to_vary, permitted_range,
                  timeout_sec=30, **kwargs):
    kwargs.setdefault("posthoc_sparsity_param", 0)
    kwargs.setdefault("maxiterations", 200)
    result = [None]
    err = [None]

    def run():
        try:
            result[0] = exp.generate_counterfactuals(
                query, total_CFs=1, desired_range=desired_range,
                features_to_vary=features_to_vary,
                permitted_range=permitted_range, **kwargs)
        except Exception as e:
            err[0] = e

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(timeout=timeout_sec)
    if t.is_alive():
        return None, _TimeoutError(f"DiCE timed out after {timeout_sec}s")
    if err[0]:
        return None, err[0]
    return result[0], None


def _parse_dice_cf(cf, label, strategy, X_dong_raw, feat_names, model, scaler, current_y, target_y,
                   ctrl_features=None):
    if cf is None:
        return None
    ex = cf.cf_examples_list[0]
    if ex.final_cfs_df is None or ex.final_cfs_df.empty:
        return None
    new_x = ex.final_cfs_df[feat_names].values[0]
    # ISS-209: ctrl_features를 동적 인자로 받아 하드코딩 제거
    effective_ctrl = ctrl_features if ctrl_features is not None else [f for f in feat_names if "평균" in f]
    changes = {}
    for f in effective_ctrl:
        if f in feat_names:
            idx = feat_names.index(f)
            delta_scaled = float(new_x[idx]) - float(X_dong_raw[idx])
            changes[f] = round(delta_scaled * 1e6, 4)
    if all(abs(v) < 0.01 for v in changes.values()):
        return None
    pred_y = float(model.predict(scaler.transform([new_x]))[0])
    achievement = (pred_y - current_y) / (target_y - current_y) * 100 if target_y != current_y else 100.0
    return {
        "label": label, "strategy": strategy, "method": "dice_genetic",
        "changes": changes, "predicted_y": round(pred_y * 1e6, 4),
        "achievement_pct": round(float(achievement), 2),
    }


def _scipy_counterfactual(X_dong_raw, feat_names, model, scaler, target_y,
                          vary_features, max_delta, sparsity_penalty):
    """Nelder-Mead gradient-free 최적화 (RF 모델은 gradient 없음)."""
    x0 = np.array(X_dong_raw, dtype=float)
    vary_idx = [feat_names.index(f) for f in vary_features if f in feat_names]
    lo_bounds = np.array([
        (max(0.0, x0[i] * (1 - max_delta)) if i in vary_idx else x0[i])
        for i in range(len(x0))
    ])
    hi_bounds = np.array([
        (x0[i] * (1 + max_delta) if (i in vary_idx and x0[i] > 0) else (1e-6 if i in vary_idx else x0[i]))
        for i in range(len(x0))
    ])

    def clip(x):
        return np.clip(x, lo_bounds, hi_bounds)

    def objective(x_free):
        # x_free는 vary_idx 위치의 값만 (나머지는 x0 고정)
        x = x0.copy()
        for j, idx in enumerate(vary_idx):
            x[idx] = x_free[j]
        x = clip(x)
        pred = float(model.predict(scaler.transform([x]))[0])
        gap = max(0.0, target_y - pred) * 1000
        proximity = float(np.sum((x[vary_idx] - x0[vary_idx]) ** 2))
        changed = float(np.sum(np.abs(x[vary_idx] - x0[vary_idx]) > 1e-10 * (np.abs(x0[vary_idx]) + 1e-12)))
        return gap + proximity + sparsity_penalty * changed

    x_free0 = x0[vary_idx]
    res = minimize(objective, x_free0, method="Nelder-Mead",
                   options={"maxiter": 2000, "xatol": 1e-10, "fatol": 1e-12, "adaptive": True})

    x_result = x0.copy()
    for j, idx in enumerate(vary_idx):
        x_result[idx] = res.x[j]
    return clip(x_result)


def _make_scenario_from_scipy(X_new, X_orig, feat_names, model, scaler, current_y, target_y,
                               label, strategy, ctrl_features=None, vary_features=None):
    # changes는 항상 ctrl_features(평균 단위 /1e6 스케일) 기준으로만 기록.
    # 추세 특성은 단위리스(normalized)라 1e6 역변환이 불가 → changes 제외.
    # optimize의 _scipy_reverify는 changes 키로 reverify_features를 결정하므로
    # ctrl_features 기반으로만 기록해야 교차검증 일관성 유지됨.
    effective_ctrl = ctrl_features if ctrl_features is not None else [f for f in feat_names if "평균" in f]
    changes = {}
    for f in effective_ctrl:
        if f in feat_names:
            idx = feat_names.index(f)
            delta_scaled = float(X_new[idx]) - float(X_orig[idx])
            if abs(delta_scaled) > 1e-12:
                changes[f] = round(delta_scaled * 1e6, 4)
    # predicted_y: ctrl_features 변화만 적용한 예측 (추세 제외 → optimize diff 일관성)
    import numpy as np
    X_ctrl_only = np.array(X_orig, dtype=float)
    for f, delta_real in changes.items():
        if f in feat_names:
            idx = feat_names.index(f)
            X_ctrl_only[idx] += delta_real / 1e6
    pred_y = float(model.predict(scaler.transform([X_ctrl_only]))[0])
    achievement = (pred_y - current_y) / (target_y - current_y) * 100 if target_y != current_y else 100.0
    low_sensitivity = len(changes) == 0 and achievement < 5.0
    result = {
        "label": label, "strategy": strategy, "method": "scipy_fallback",
        "changes": changes, "predicted_y": round(pred_y * 1e6, 4),
        "achievement_pct": round(float(achievement), 2),
    }
    if low_sensitivity:
        result["note"] = "ctrl_features가 모델 출력에 미치는 영향이 작습니다 (feature_importance < 10%)"
    return result


def run(dong_name, target, goal):
    import time
    t0 = time.time()

    dong_name = normalize_dong_name(dong_name)
    simula = json.loads(SIMULA.read_text())
    causal_data = json.loads(CAUSAL.read_text()) if CAUSAL.exists() else {"dongs": {}}

    dong_dict = find_dong(simula, dong_name)
    if dong_dict is None:
        dong_dict = simula["dongs"][0]
        print(f"[경고] '{dong_name}' 동을 찾지 못했습니다. 첫 번째 동 '{dong_dict['name']}'으로 대체합니다.")
        dong_name = dong_dict["name"]

    print(f"[{target}] 대상 동: {dong_dict['name']} (code={dong_dict.get('code', '')})")

    suffix = "tx" if target == "tx_volume" else "vis"
    bundle = joblib.load(ROOT / f"reverse_whatif_model_{suffix}.pkl")
    model = bundle["model"]
    scaler = bundle["scaler"]
    feat_names = bundle["feature_names"]
    ctrl_mask = bundle["controllable_mask"]

    # ISS-209: controllable_mask 기반 동적 추출
    ctrl_features = get_ctrl_features(feat_names, ctrl_mask)
    scenario_features = get_scenario_features(ctrl_features, feat_names, ctrl_mask)
    print(f"[{target}] 통제 가능 특성 ({len(ctrl_features)}개): {ctrl_features}")

    X_dong_raw = build_feat_row(dong_dict, causal_data, target=target)  # ISS-209: leakage 제외
    if X_dong_raw is None:
        raise ValueError("동 특성 빌드 실패 (NaN)")

    X_dong_np = np.array(X_dong_raw, dtype=float)
    current_y = float(model.predict(scaler.transform([X_dong_raw]))[0])
    target_y = current_y * (1 + goal / 100)
    desired_range = [target_y, target_y * 1.30]

    print(f"[{target}] current_y={current_y * 1e6:.2f}  target_y={target_y * 1e6:.2f}  goal={goal}%")

    X_all_raw, y_all = build_X_all(simula, causal_data, target)
    df_train = pd.DataFrame(X_all_raw, columns=feat_names)
    df_train["y"] = y_all

    d_obj = dice_ml.Data(dataframe=df_train, continuous_features=feat_names, outcome_name="y")
    m_obj = dice_ml.Model(model=model, backend="sklearn", model_type="regressor")
    exp = dice_ml.Dice(d_obj, m_obj, method="genetic")
    query = pd.DataFrame([X_dong_raw], columns=feat_names)

    # ISS-209: scenario_features 동적 구성
    scenario_configs = [
        ("최소변경", "minimum_change", {
            "features": scenario_features["최소변경"],
            "max_delta": SCENARIO_MAX_DELTA["최소변경"],
            "dice_kwargs": {"sparsity_weight": 2.0, "proximity_weight": 2.0, "diversity_weight": 1.0},
            "scipy_sparsity": 0.5,
        }),
        ("균형", "balanced", {
            "features": scenario_features["균형"],
            "max_delta": SCENARIO_MAX_DELTA["균형"],
            "dice_kwargs": {"sparsity_weight": 1.0, "proximity_weight": 1.0, "diversity_weight": 1.0},
            "scipy_sparsity": 0.2,
        }),
        ("고효율", "high_efficiency", {
            "features": scenario_features["고효율"],
            "max_delta": SCENARIO_MAX_DELTA["고효율"],
            "dice_kwargs": {"sparsity_weight": 0.2, "proximity_weight": 0.5, "diversity_weight": 2.0},
            "scipy_sparsity": 0.0,
        }),
    ]

    scenarios = {}
    for label, strategy, cfg in scenario_configs:
        print(f"  [{label}] DiCE genetic 시도...", end="", flush=True)

        permitted_range = {}
        for f in cfg["features"]:
            if f in feat_names:
                idx = feat_names.index(f)
                orig_val = float(X_dong_np[idx])
                md = cfg["max_delta"]
                lo = max(0.0, orig_val * (1 - md))
                hi = orig_val * (1 + md) if orig_val > 0 else 1e-6
                permitted_range[f] = [lo, hi]

        cf, dice_err = _dice_genetic(
            exp, query, desired_range,
            features_to_vary=cfg["features"],
            permitted_range=permitted_range,
            timeout_sec=30,
            **cfg["dice_kwargs"],
        )

        scenario_dict = None
        if dice_err is None:
            scenario_dict = _parse_dice_cf(
                cf, label, strategy,
                X_dong_raw, feat_names, model, scaler, current_y, target_y,
                ctrl_features=ctrl_features,
            )

        if scenario_dict is None:
            print(f" fallback->scipy", end="", flush=True)
            X_new = _scipy_counterfactual(
                X_dong_raw, feat_names, model, scaler, target_y,
                vary_features=cfg["features"],
                max_delta=cfg["max_delta"],
                sparsity_penalty=cfg["scipy_sparsity"],
            )
            scenario_dict = _make_scenario_from_scipy(
                X_new, X_dong_raw, feat_names, model, scaler, current_y, target_y,
                label, strategy, ctrl_features=ctrl_features,
                vary_features=cfg["features"],
            )

        print(f" 완료 (achievement={scenario_dict.get('achievement_pct', 'N/A')}%)")
        scenarios[label] = scenario_dict

    runtime = round(time.time() - t0, 1)

    out = {
        "dong": dong_dict["name"],
        "target": target,
        "goal_pct": goal,
        "current_y": round(current_y * 1e6, 4),
        "target_y": round(target_y * 1e6, 4),
        "scenarios": scenarios,
    }
    out_path = ROOT / f"whatif_scenarios_{suffix}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"[{target}] ✓ {out_path.name} 저장 (runtime {runtime}s)")
    return runtime


def main():
    parser = argparse.ArgumentParser(description="DiCE Counterfactual 시나리오 생성")
    parser.add_argument("--dong", required=True)
    parser.add_argument("--target", required=True, choices=["tx_volume", "visitors_total"])
    parser.add_argument("--goal", type=float, default=15)
    args = parser.parse_args()
    run(args.dong, args.target, args.goal)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
