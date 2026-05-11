#!/usr/bin/env python3
"""
ISS-192 — Reverse What-If 모델 학습
입력 : simula_data_real.json + causal.json
X    : 11개 특성 (decision_tree_train.py와 동일 정의)
Y    : tx_volume 또는 visitors_total (동별 60개월 평균, 스칼라)
출력 :
  reverse_whatif_model_tx.pkl    -- tx_volume 타깃
  reverse_whatif_model_vis.pkl   -- visitors_total 타깃
  reverse_whatif_feature_matrix.json -- X/Y 행렬 메타
검증 : R² >= 0.70
"""
import argparse
import json
import statistics
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).parent
SIMULA = ROOT / "simula_data_real.json"
CAUSAL = ROOT / "causal.json"

# --- decision_tree_train.py 와 동일 정의 ---
LAYERS = ["biz_count", "biz_cafe", "visitors_total", "tx_volume", "land_price"]
LAYER_KO = {
    "biz_count": "소상공",
    "biz_cafe": "카페",
    "visitors_total": "유동",
    "tx_volume": "거래",
    "land_price": "지가",
}

# 통제 가능 특성 집합 (LAYER_KO 이름 기준)
CONTROLLABLE_LAYERS = {"biz_count", "biz_cafe", "visitors_total"}


def trend_slope(values):
    """간단한 선형 회귀 기울기 (마지막 12개월) — 정규화된 값."""
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
    slope = num / den
    return slope / mean_y  # 비율 스케일


def avg_granger_lag(causal, dong_code):
    """동 코드로 Granger 트리플렛 평균 lag (없으면 0)."""
    info = causal.get("dongs", {}).get(dong_code, {})
    grangers = info.get("granger", [])
    if not grangers:
        return 0
    return statistics.mean(g.get("lag", 0) for g in grangers)


def build_matrix(simula, causal_data, target):
    """X 행렬(11열) + Y 벡터 + 메타 구성."""
    feat_names = []
    controllable_mask = []

    # 특성명/통제가능 마스크 구성 (11개)
    for L in LAYERS:
        ko = LAYER_KO[L]
        feat_names.append(f"{ko}_평균")
        controllable_mask.append(L in CONTROLLABLE_LAYERS)
        feat_names.append(f"{ko}_추세")
        controllable_mask.append(False)  # 추세는 간접 통제
    feat_names.append("인과_lag평균")
    controllable_mask.append(False)

    rows, y_vals, dong_codes, dong_names = [], [], [], []

    for d in simula["dongs"]:
        name = d["name"]
        code = d.get("code", "")
        layers = d.get("layers", {})

        # Y: 타깃 레이어 60개월 평균
        y_raw = layers.get(target, [])
        if len(y_raw) < 12:
            continue
        y_scalar = statistics.mean(y_raw)
        if y_scalar == 0:
            continue

        feat = []
        valid = True
        for L in LAYERS:
            vals = layers.get(L, [])
            if len(vals) < 12:
                feat.append(0.0)
                feat.append(0.0)
            else:
                feat.append(statistics.mean(vals) / 1e6)
                feat.append(trend_slope(vals))

        # Granger lag — causal.json은 dong code 키 사용
        feat.append(avg_granger_lag(causal_data, code))

        # NaN/0 체크
        if any(v != v for v in feat):  # NaN guard
            continue

        rows.append(feat)
        y_vals.append(y_scalar / 1e6)  # 동일 스케일 다운
        dong_codes.append(code)
        dong_names.append(name)

    return rows, y_vals, feat_names, controllable_mask, dong_codes, dong_names


def train(target: str):
    simula = json.loads(SIMULA.read_text())
    causal_data = json.loads(CAUSAL.read_text()) if CAUSAL.exists() else {"dongs": {}}

    rows, y_vals, feat_names, controllable_mask, dong_codes, dong_names = build_matrix(
        simula, causal_data, target
    )

    n_rows = len(rows)
    n_feat = len(feat_names)
    print(f"[{target}] 학습 데이터: {n_rows}개 동 × {n_feat}개 특성")

    # StandardScaler 적용
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(rows)

    # RandomForestRegressor 학습
    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=8,
        random_state=42,
    )
    model.fit(X_scaled, y_vals)

    r2 = r2_score(y_vals, model.predict(X_scaled))
    print(f"[{target}] R² (train): {r2:.4f}")

    if r2 < 0.70:
        print(f"[{target}] ⚠️  R² {r2:.4f} < 0.70 — 임계값 미달")

    # pkl 저장 (모델 + 스케일러 + 메타 dict)
    suffix = "tx" if target == "tx_volume" else "vis"
    pkl_path = ROOT / f"reverse_whatif_model_{suffix}.pkl"
    joblib.dump(
        {
            "model": model,
            "scaler": scaler,
            "feature_names": feat_names,
            "controllable_mask": controllable_mask,
            "r2_train": round(r2, 6),
            "target": target,
        },
        pkl_path,
    )
    print(f"[{target}] ✓ {pkl_path.name} 저장")

    return r2, n_rows, feat_names, controllable_mask, dong_codes, rows, y_vals


def main():
    parser = argparse.ArgumentParser(description="Reverse What-If RF 모델 학습")
    parser.add_argument(
        "--target",
        required=True,
        choices=["tx_volume", "visitors_total"],
        help="회귀 타깃 레이어",
    )
    args = parser.parse_args()

    r2, n_rows, feat_names, controllable_mask, dong_codes, rows, y_vals = train(args.target)

    # feature_matrix.json — 두 번째 실행 시 병합
    matrix_path = ROOT / "reverse_whatif_feature_matrix.json"
    matrix = json.loads(matrix_path.read_text()) if matrix_path.exists() else {}

    suffix = "tx" if args.target == "tx_volume" else "vis"
    controllable_indices = [i for i, c in enumerate(controllable_mask) if c]

    matrix[args.target] = {
        "feature_names": feat_names,
        "controllable_mask": controllable_mask,
        "controllable_indices": controllable_indices,
        "controllable_features": [feat_names[i] for i in controllable_indices],
        "n_rows": n_rows,
        "n_features": len(feat_names),
        "r2_train": round(r2, 6),
        "target": args.target,
        "pkl_file": f"reverse_whatif_model_{suffix}.pkl",
        "dong_codes": dong_codes,
        "X_sample_first3": [rows[i] for i in range(min(3, n_rows))],
        "Y_sample_first3": [round(y, 6) for y in y_vals[:3]],
    }

    matrix_path.write_text(json.dumps(matrix, ensure_ascii=False, indent=2))
    print(f"[{args.target}] ✓ {matrix_path.name} 저장")

    return 0 if r2 >= 0.70 else 1


if __name__ == "__main__":
    raise SystemExit(main())
