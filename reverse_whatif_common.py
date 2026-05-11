#!/usr/bin/env python3
"""
ISS-225 — Reverse What-If 공통 유틸리티
4개 파일(train/explain/counterfactual/optimize)에서 중복 정의된 함수/상수를 추출.

순환 import 금지: 이 모듈은 다른 reverse_whatif_*.py 를 import 하지 않는다.
"""
import json
import os
import statistics
from pathlib import Path

# ── 공통 상수 ─────────────────────────────────────────────────────────────────

LAYERS = ["biz_count", "biz_cafe", "visitors_total", "tx_volume", "land_price"]
LAYER_KO = {
    "biz_count": "소상공",
    "biz_cafe": "카페",
    "visitors_total": "유동",
    "tx_volume": "거래",
    "land_price": "지가",
}

# ── 기초 통계 헬퍼 ────────────────────────────────────────────────────────────


def trend_slope(values):
    """간단한 선형 회귀 기울기 (마지막 12개월, 정규화된 값)."""
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
    return (num / den) / mean_y  # 비율 스케일


def avg_granger_lag(causal, dong_code):
    """동 코드로 Granger 트리플렛 평균 lag (없으면 0)."""
    info = causal.get("dongs", {}).get(dong_code, {})
    grangers = info.get("granger", [])
    if not grangers:
        return 0
    return statistics.mean(g.get("lag", 0) for g in grangers)


# ── 타깃별 매핑 헬퍼 ──────────────────────────────────────────────────────────


def _target_suffix(target: str) -> str:
    """target → pkl suffix 매핑 (tx/vis/tpv/tdelta)."""
    return {"tx_volume": "tx", "visitors_total": "vis",
            "tx_per_visitor": "tpv", "tx_delta_6m": "tdelta"}[target]


def _exclude_layers_for_target(target: str) -> set:
    """target별 X에서 제외할 레이어 집합 (leakage 방지)."""
    if target == "tx_per_visitor":
        return {"tx_volume", "visitors_total"}
    elif target == "tx_delta_6m":
        return {"tx_volume"}
    return {target}  # 기존 타깃: Y 원본 레이어만 제외


def _y_scalar_for_target(layers: dict, target: str):
    """target별 Y 스칼라 산출. 유효하지 않으면 None 반환."""
    if target == "tx_per_visitor":
        tx_s = layers.get("tx_volume", [])
        vis_s = layers.get("visitors_total", [])
        if len(tx_s) < 12 or len(vis_s) < 12:
            return None
        ratios = [t / v if v > 0 else 0 for t, v in zip(tx_s, vis_s)]
        return statistics.mean(ratios)
    elif target == "tx_delta_6m":
        tx_s = layers.get("tx_volume", [])
        if len(tx_s) < 12:
            return None
        return statistics.mean(tx_s[-6:]) - statistics.mean(tx_s[-12:-6])
    else:
        y_raw = layers.get(target, [])
        if len(y_raw) < 12:
            return None
        return statistics.mean(y_raw)


# ── 특성 벡터 빌더 ────────────────────────────────────────────────────────────


def build_feat_row(d: dict, causal_data: dict, target=None):
    """단일 동(dict)의 X 특성 벡터 반환.
    ISS-209 leakage fix: target 레이어 평균/추세 제외.
    ISS-216: tx_per_visitor/tx_delta_6m 신규 exclude_layers 지원.
    NaN 포함 시 None 반환.
    """
    exclude_layers = _exclude_layers_for_target(target) if target else set()
    layers = d.get("layers", {})
    feat = []
    for L in LAYERS:
        if L in exclude_layers:
            continue
        vals = layers.get(L, [])
        if len(vals) < 12:
            feat.append(0.0)
            feat.append(0.0)
        else:
            feat.append(statistics.mean(vals) / 1e6)
            feat.append(trend_slope(vals))
    feat.append(avg_granger_lag(causal_data, d.get("code", "")))
    if any(v != v for v in feat):  # NaN guard
        return None
    return feat


def build_X(simula_data: dict, target: str, causal_data: dict):
    """전체 동에서 X 행 목록과 Y 목록을 반환.

    반환: (rows: list[list[float]], y_vals: list[float])
    - 신규 타깃(tx_per_visitor/tx_delta_6m)은 비율/차이값이므로 /1e6 스케일 없음.
    - 기존 타깃은 Y /1e6 스케일 적용.
    """
    rows, y_vals = [], []
    for d in simula_data["dongs"]:
        layers = d.get("layers", {})
        y_scalar = _y_scalar_for_target(layers, target)
        if y_scalar is None or y_scalar == 0:
            continue
        feat = build_feat_row(d, causal_data, target=target)
        if feat is None:
            continue
        rows.append(feat)
        if target in ("tx_per_visitor", "tx_delta_6m"):
            y_vals.append(y_scalar)
        else:
            y_vals.append(y_scalar / 1e6)
    return rows, y_vals


# ── 데이터 로드 헬퍼 ──────────────────────────────────────────────────────────


def load_simula_and_causal(data_path=None):
    """simula JSON + causal JSON 로드.

    data_path: simula 파일 경로 (str/Path). None 이면 REVERSE_WHATIF_DATA 환경변수 →
    없으면 스크립트 루트의 simula_data_real.json 사용.
    """
    root = Path(__file__).parent
    _data_env = os.environ.get("REVERSE_WHATIF_DATA")
    if data_path is not None:
        simula_path = Path(data_path)
    elif _data_env:
        simula_path = Path(_data_env)
    else:
        simula_path = root / "simula_data_real.json"

    causal_path = root / "causal.json"
    simula = json.loads(simula_path.read_text())
    causal_data = json.loads(causal_path.read_text()) if causal_path.exists() else {"dongs": {}}
    return simula, causal_data
