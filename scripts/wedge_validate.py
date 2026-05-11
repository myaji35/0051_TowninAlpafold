#!/usr/bin/env python3
"""
ISS-226 — Wedge 검증 CLI
목적: simula 학습 모델로 wedge 실데이터(의정부 금오동) 4타깃 검증
      CEO 우려(시뮬 R² 0.92 신뢰성) 검증

방법: 옵션 B — 모델은 simula_data_real.json으로 학습,
      예측 입력(X)만 wedge_data_geumo.json에서 빌드.
      단일 동(N=1) 학습 실패 방지.

사용:
  .venv/bin/python scripts/wedge_validate.py \\
      --wedge wedge_data_geumo.json \\
      --dong "의정부 금오동" \\
      --goal 15

산출:
  wedge_data_validation_geumo.json
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

import joblib
import numpy as np
from scipy.optimize import minimize
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import r2_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).parent.parent
SIMULA_PATH = ROOT / "simula_data_real.json"
CAUSAL_PATH = ROOT / "causal.json"

LAYERS = ["biz_count", "biz_cafe", "visitors_total", "tx_volume", "land_price"]
LAYER_KO = {
    "biz_count": "소상공",
    "biz_cafe": "카페",
    "visitors_total": "유동",
    "tx_volume": "거래",
    "land_price": "지가",
}
CONTROLLABLE_LAYERS = {"biz_count", "biz_cafe", "visitors_total"}
TARGETS = ["tx_volume", "visitors_total", "tx_per_visitor", "tx_delta_6m"]
SUFFIX_MAP = {"tx_volume": "tx", "visitors_total": "vis",
              "tx_per_visitor": "tpv", "tx_delta_6m": "tdelta"}


# ─────────────────────────── 공통 유틸 ───────────────────────────

def trend_slope(values):
    """마지막 12개월 선형 추세 기울기 (정규화)."""
    if len(values) < 12:
        return 0.0
    last12 = values[-12:]
    n = len(last12)
    mean_y = statistics.mean(last12)
    if mean_y == 0:
        return 0.0
    mean_x = (n - 1) / 2
    num = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(last12))
    den = sum((i - mean_x) ** 2 for i in range(n))
    return (num / den) / mean_y if den != 0 else 0.0


def avg_granger_lag(causal_data, dong_code):
    info = causal_data.get("dongs", {}).get(str(dong_code), {})
    grangers = info.get("granger", [])
    return statistics.mean(g.get("lag", 0) for g in grangers) if grangers else 0


def exclude_layers_for_target(target):
    if target == "tx_per_visitor":
        return {"tx_volume", "visitors_total"}
    elif target == "tx_delta_6m":
        return {"tx_volume"}
    return {target}


def build_feat_row(d, causal_data, target):
    """동 dict → X 피처 행 (leakage 제외)."""
    exclude = exclude_layers_for_target(target)
    layers = d.get("layers", {})
    feat = []
    for L in LAYERS:
        if L in exclude:
            continue
        vals = layers.get(L, [])
        if len(vals) < 12:
            feat.extend([0.0, 0.0])
        else:
            feat.append(statistics.mean(vals) / 1e6)
            feat.append(trend_slope(vals))
    feat.append(avg_granger_lag(causal_data, d.get("code", "")))
    if any(v != v for v in feat):  # NaN guard
        return None
    return feat


def y_scalar(d, target):
    """동 dict → Y 스칼라 (타깃별 산출)."""
    layers = d.get("layers", {})
    if target == "tx_per_visitor":
        tx = layers.get("tx_volume", [])
        vis = layers.get("visitors_total", [])
        if len(tx) < 12 or len(vis) < 12:
            return None
        return statistics.mean(t / v if v > 0 else 0 for t, v in zip(tx, vis))
    elif target == "tx_delta_6m":
        tx = layers.get("tx_volume", [])
        if len(tx) < 12:
            return None
        return statistics.mean(tx[-6:]) - statistics.mean(tx[-12:-6])
    else:
        raw = layers.get(target, [])
        if len(raw) < 12:
            return None
        return statistics.mean(raw)


def y_scale_factor(target):
    """신규 타깃(비율/차이)은 1.0, 기존 타깃은 1/1e6."""
    return 1.0 if target in ("tx_per_visitor", "tx_delta_6m") else 1 / 1e6


# ─────────────────────────── 모델 학습 ───────────────────────────

def train_simula_model(target, simula, causal_data):
    """simula_data_real.json으로 RF 모델 학습. ISS-226 검증 전용 (pkl 덮어쓰기 없음)."""
    suffix = SUFFIX_MAP[target]
    pkl_path = ROOT / f"reverse_whatif_model_{suffix}.pkl"

    # 기존 pkl 유효성 확인 (feature_importance 모두 0이면 손상)
    if pkl_path.exists():
        bundle = joblib.load(pkl_path)
        importances = bundle["model"].feature_importances_
        if importances.sum() > 0:
            print(f"  [{target}] 기존 pkl 로드 (R²={bundle['r2_train']:.4f})")
            return bundle

    # 재학습 필요 (tx_volume 모델은 N=1 wedge 학습으로 손상됨)
    print(f"  [{target}] pkl 손상 또는 없음 → simula 재학습 중...", end="", flush=True)
    exclude = exclude_layers_for_target(target)
    rows, y_vals, feat_names, ctrl_mask = [], [], None, None

    for d in simula["dongs"]:
        y = y_scalar(d, target)
        if y is None or y == 0:
            continue
        feat = build_feat_row(d, causal_data, target)
        if feat is None:
            continue
        rows.append(feat)
        scale_f = y_scale_factor(target)
        y_vals.append(y * scale_f if scale_f != 1 / 1e6 else y / 1e6)

        if feat_names is None:
            # feature_names / controllable_mask 구성
            _fnames, _cmask = [], []
            for L in LAYERS:
                if L in exclude:
                    continue
                ko = LAYER_KO[L]
                _fnames.extend([f"{ko}_평균", f"{ko}_추세"])
                _cmask.extend([L in CONTROLLABLE_LAYERS, False])
            _fnames.append("인과_lag평균")
            _cmask.append(False)
            feat_names = _fnames
            ctrl_mask = _cmask

    scaler = StandardScaler()
    X = scaler.fit_transform(rows)
    model = RandomForestRegressor(n_estimators=100, max_depth=8, random_state=42)
    model.fit(X, y_vals)
    r2 = r2_score(y_vals, model.predict(X))
    print(f" 완료 (N={len(rows)}, R²={r2:.4f})")

    bundle = {
        "model": model,
        "scaler": scaler,
        "feature_names": feat_names,
        "controllable_mask": ctrl_mask,
        "r2_train": round(r2, 6),
        "target": target,
    }
    return bundle


# ─────────────────────────── OOD 측정 ───────────────────────────

def ood_distance(X_wedge_raw, simula, causal_data, target):
    """Wedge X가 simula 학습 분포에서 얼마나 벗어나는지 측정.
    지표: 정규화된 피처별 범위 이탈 비율 (0=분포 안, >0=외삽).
    """
    simula_rows = []
    for d in simula["dongs"]:
        y = y_scalar(d, target)
        if y is None or y == 0:
            continue
        feat = build_feat_row(d, causal_data, target)
        if feat is None:
            continue
        simula_rows.append(feat)

    if not simula_rows:
        return 1.0, "simula 행렬 없음"

    arr = np.array(simula_rows)
    w = np.array(X_wedge_raw)

    n_out_of_range = 0
    n_total = len(w)
    for i in range(n_total):
        col_min = arr[:, i].min()
        col_max = arr[:, i].max()
        if w[i] < col_min or w[i] > col_max:
            n_out_of_range += 1

    ood_ratio = n_out_of_range / n_total
    status = "OOD" if ood_ratio > 0.3 else ("경계" if ood_ratio > 0 else "분포 내")
    return ood_ratio, status


# ─────────────────────────── 시나리오 생성 (scipy) ───────────────────────────

def run_scipy_scenarios(X_wedge_raw, feat_names, ctrl_mask, model, scaler,
                        current_y, target_y_val, y_display_scale):
    """3개 시나리오 (최소변경/균형/고효율) scipy 최적화."""
    ctrl_idx = [i for i, c in enumerate(ctrl_mask) if c]
    X0 = np.array(X_wedge_raw)

    scenario_configs = [
        ("최소변경", 0.20, 0.5),
        ("균형",    0.50, 0.2),
        ("고효율",  1.50, 0.0),
    ]

    results = {}
    for label, max_delta, sparsity in scenario_configs:
        lo = np.array([max(0.0, X0[i] * (1 - max_delta)) if i in ctrl_idx else X0[i]
                       for i in range(len(X0))])
        hi = np.array([X0[i] * (1 + max_delta) if (i in ctrl_idx and X0[i] > 0) else
                       (1e-6 if i in ctrl_idx else X0[i])
                       for i in range(len(X0))])

        def clip(x):
            return np.clip(x, lo, hi)

        def objective(x_free):
            x = X0.copy()
            for j, idx in enumerate(ctrl_idx):
                x[idx] = x_free[j]
            x = clip(x)
            pred = float(model.predict(scaler.transform([x]))[0])
            gap = max(0.0, target_y_val - pred) * 1000
            prox = float(np.sum((x[ctrl_idx] - X0[ctrl_idx]) ** 2))
            return gap + prox + sparsity * float(
                np.sum(np.abs(x[ctrl_idx] - X0[ctrl_idx]) > 1e-10 * (np.abs(X0[ctrl_idx]) + 1e-12))
            )

        opt = minimize(objective, X0[ctrl_idx], method="Nelder-Mead",
                       options={"maxiter": 2000, "xatol": 1e-10, "fatol": 1e-12, "adaptive": True})

        X_new = X0.copy()
        for j, idx in enumerate(ctrl_idx):
            X_new[idx] = opt.x[j]
        X_new = clip(X_new)

        # ctrl_only 예측 (추세 변화 제외)
        X_ctrl = X0.copy()
        ctrl_feats = [feat_names[i] for i in ctrl_idx]
        changes = {}
        for i in ctrl_idx:
            delta = float(X_new[i]) - float(X0[i])
            if abs(delta) > 1e-12:
                X_ctrl[i] += delta
                changes[feat_names[i]] = round(delta * 1e6, 4)

        pred_new = float(model.predict(scaler.transform([X_ctrl]))[0])
        achievement = ((pred_new - current_y) / (target_y_val - current_y) * 100
                       if target_y_val != current_y else 100.0)

        results[label] = {
            "method": "scipy_fallback",
            "max_delta": max_delta,
            "changes": changes,
            "predicted_y": round(pred_new * y_display_scale, 6),
            "achievement_pct": round(float(achievement), 2),
            "verified": float(achievement) >= 90.0,
        }

    return results


# ─────────────────────────── 메인 검증 루프 ───────────────────────────

def validate_all(wedge_path: Path, dong_name: str, goal_pct: float):
    print(f"[ISS-226 wedge 검증] 동={dong_name}, goal={goal_pct}%")
    print(f"  simula: {SIMULA_PATH.name}")
    print(f"  wedge:  {wedge_path.name}")
    print()

    simula = json.loads(SIMULA_PATH.read_text())
    causal_data = json.loads(CAUSAL_PATH.read_text()) if CAUSAL_PATH.exists() else {"dongs": {}}
    wedge_data = json.loads(wedge_path.read_text())

    # wedge 동 찾기
    norm = dong_name.replace(" ", "").replace("_", "")
    wedge_dong = None
    for d in wedge_data.get("dongs", []):
        if d["name"].replace(" ", "").replace("_", "") == norm:
            wedge_dong = d
            break
    if wedge_dong is None:
        print(f"[오류] '{dong_name}' 동을 wedge 파일에서 찾지 못했습니다.")
        sys.exit(1)

    print(f"  wedge 동: {wedge_dong['name']} (code={wedge_dong.get('code','')})")

    # simula 학습 분포에서 가장 유사한 동 찾기 (참고용)
    wl = wedge_dong["layers"]
    w_biz = statistics.mean(wl.get("biz_count", [0] * 12))
    w_vis = statistics.mean(wl.get("visitors_total", [0] * 12))
    w_cafe = statistics.mean(wl.get("biz_cafe", [0] * 12))
    dists = []
    for d in simula["dongs"]:
        l = d.get("layers", {})
        if len(l.get("biz_count", [])) < 12:
            continue
        s_biz = statistics.mean(l["biz_count"])
        s_vis = statistics.mean(l.get("visitors_total", [0] * 12))
        s_cafe = statistics.mean(l.get("biz_cafe", [0] * 12))
        dist = (abs(s_biz - w_biz) / (w_biz + 1) +
                abs(s_vis - w_vis) / (w_vis + 1) +
                abs(s_cafe - w_cafe) / (w_cafe + 1))
        dists.append((dist, d["name"]))
    dists.sort()
    nearest_simula_dong = dists[0][1] if dists else "N/A"
    nearest_dist = dists[0][0] if dists else 999

    results_by_target = {}
    comparison_with_simula = {}

    for target in TARGETS:
        suffix = SUFFIX_MAP[target]
        print(f"── [{target}] 검증 시작 ──")

        # 1. simula 모델 로드/재학습
        bundle = train_simula_model(target, simula, causal_data)
        model = bundle["model"]
        scaler = bundle["scaler"]
        feat_names = bundle["feature_names"]
        ctrl_mask = bundle["controllable_mask"]
        r2_simula = bundle["r2_train"]

        # 2. wedge X 빌드
        X_wedge_raw = build_feat_row(wedge_dong, causal_data, target)
        if X_wedge_raw is None:
            print(f"  [오류] wedge X 빌드 실패 (NaN)")
            results_by_target[target] = {"error": "wedge X build failed"}
            continue

        # 3. OOD 측정
        ood_ratio, ood_status = ood_distance(X_wedge_raw, simula, causal_data, target)
        print(f"  OOD: {ood_status} (이탈 피처 비율={ood_ratio:.0%})")

        # 4. wedge Y 실제값 계산
        y_actual_wedge = y_scalar(wedge_dong, target)

        # 5. 모델 예측
        y_disp_scale = 1.0 if target in ("tx_per_visitor", "tx_delta_6m") else 1e6
        current_y = float(model.predict(scaler.transform([X_wedge_raw]))[0])
        target_y_val = current_y * (1 + goal_pct / 100)

        baseline_y_display = round(current_y * y_disp_scale, 6)
        target_y_display = round(target_y_val * y_disp_scale, 6)
        print(f"  baseline_y(모델예측)={baseline_y_display}  target_y={target_y_display}")
        if y_actual_wedge is not None:
            print(f"  실제wedge_Y={round(y_actual_wedge, 6)}")

        # 6. 시나리오 생성 (scipy)
        scenarios = run_scipy_scenarios(
            X_wedge_raw, feat_names, ctrl_mask, model, scaler,
            current_y, target_y_val, y_disp_scale
        )

        achievements = [sc["achievement_pct"] for sc in scenarios.values()]
        achievement_avg = round(statistics.mean(achievements), 2)
        all_verified = all(sc["verified"] for sc in scenarios.values())

        print(f"  achievement: {[f'{a:.1f}%' for a in achievements]} → avg={achievement_avg:.1f}%")
        print(f"  all_verified={all_verified}")
        if not all_verified:
            if ood_ratio > 0.3:
                reason = f"OOD({ood_ratio:.0%} 피처 이탈): wedge X가 simula 학습 분포 밖"
            else:
                reason = "RF 외삽 한계: 통제 가능 변수 변화에 모델 무감응"
            print(f"  미달 사유: {reason}")
        print()

        results_by_target[target] = {
            "baseline_y": baseline_y_display,
            "target_y": target_y_display,
            "actual_wedge_y": round(y_actual_wedge, 6) if y_actual_wedge is not None else None,
            "ood_ratio": round(ood_ratio, 3),
            "ood_status": ood_status,
            "scenarios": scenarios,
            "all_verified": all_verified,
            "achievement_avg": achievement_avg,
            "verified_reason": (None if all_verified else
                                (f"OOD({ood_ratio:.0%} 피처 이탈)" if ood_ratio > 0.3
                                 else "RF 외삽 한계")),
        }

        comparison_with_simula[target] = {
            "simula_r2_train": r2_simula,
            "wedge_predict_method": "simula_model_predict",
            "ood_ratio": round(ood_ratio, 3),
            "ood_status": ood_status,
            "achievement_wedge": achievement_avg,
            "nearest_simula_dong": nearest_simula_dong,
            "nearest_simula_dist": round(nearest_dist, 4),
            "note": ("simula R²는 simula 내부 분포 기준. wedge 동이 OOD 구간에 있어 예측 신뢰도 낮음."
                     if ood_ratio > 0.3 else
                     "wedge 동이 simula 분포 근접. 예측 참고 가능."),
        }

    # CEO 우려 결론
    ceo_verdict = "confirmed"  # 기본값: R² 0.92 우려 확인됨
    all_ood = all(results_by_target[t].get("ood_ratio", 1) > 0.3
                  for t in TARGETS if "error" not in results_by_target.get(t, {}))
    any_verified = any(results_by_target[t].get("all_verified", False)
                       for t in TARGETS if "error" not in results_by_target.get(t, {}))

    if not all_ood and any_verified:
        ceo_verdict = "resolved"
    elif all_ood:
        ceo_verdict = "confirmed"  # OOD로 인해 예측 불가 → R² 신뢰성 우려 타당

    output = {
        "dong": dong_name,
        "goal_pct": goal_pct,
        "tx_volume_source": wedge_data.get("_meta", {}).get("tx_volume_source", "proxy:business_count_change"),
        "nearest_simula_dong": nearest_simula_dong,
        "nearest_simula_dist": round(nearest_dist, 4),
        "ceo_concern_verdict": ceo_verdict,
        "results_by_target": results_by_target,
        "comparison_with_simula": comparison_with_simula,
        "limitations": [
            "N=1 동: 의정부 금오동 단일 동만 wedge로 검증",
            "proxy tx_volume: 실제 카드매출 API 없음, biz_count 변화량으로 대리",
            "60개월 합성 시계열: 앵커값 기반 모의 생성 (localdata_biz/kosis_living_pop/molit_landprice 모두 synthetic)",
            "OOD 외삽: wedge 동 규모(biz_count~268, visitors~18,508)가 simula 학습 분포 최소값(biz_count~309, visitors~17,234) 경계 또는 이하",
            "simula R² 0.92는 simula 내부 분포(130개 동, 서울/수도권 대규모) 기준 측정값",
        ],
        "next_steps": [
            "실제 카드매출/거래 API 연결 (공공 데이터 포털 BC카드/삼성카드 Open API)",
            "다중 동 wedge 확대: 의정부시 전 동(약 19개) + 인근 도시",
            "소규모 도시 simula 재학습: 기존 simula는 서울 규모, 읍면동 수준 분포 추가 필요",
        ],
    }

    out_path = ROOT / "wedge_data_validation_geumo.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
    print(f"[완료] {out_path.name} 저장")

    # 요약 출력
    print()
    print("═══ 검증 결과 요약 ═══")
    print(f"CEO 우려(R² 0.92 신뢰성): {ceo_verdict}")
    for t in TARGETS:
        r = results_by_target.get(t, {})
        if "error" in r:
            print(f"  {t}: 오류")
        else:
            print(f"  {t}: achievement_avg={r.get('achievement_avg','N/A')}%  "
                  f"OOD={r.get('ood_status','?')}  verified={r.get('all_verified','?')}")

    return output


def main():
    parser = argparse.ArgumentParser(description="ISS-226 Wedge 검증")
    parser.add_argument("--wedge", default="wedge_data_geumo.json",
                        help="wedge 데이터 파일 경로")
    parser.add_argument("--dong", default="의정부 금오동",
                        help="검증 대상 동 이름")
    parser.add_argument("--goal", type=float, default=15.0,
                        help="목표 증가율 %% (기본: 15)")
    args = parser.parse_args()

    wedge_path = Path(args.wedge)
    if not wedge_path.is_absolute():
        wedge_path = ROOT / wedge_path
    if not wedge_path.exists():
        print(f"[오류] wedge 파일 없음: {wedge_path}")
        sys.exit(1)

    validate_all(wedge_path, args.dong, args.goal)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
