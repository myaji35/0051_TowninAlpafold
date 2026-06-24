"""backend/npl_scorer.py
NPL 평가 로직 — JS scorer(viz/plugins/npl-buy-scorer.js, npl-sell-scorer.js)의 서버 포팅.

5만 건 일괄 평가를 위해 서버에서 동일 로직 수행 → 결과를 npl_assets에 캐시.
JS와 동일 가정(낙찰가율/할인율)을 유지 — 두 곳이 갈라지면 안 됨(drift 금지).
가정 변경 시 양쪽(JS + 본 파일)을 함께 수정할 것.

보정계수 (auction_correction.json):
  실 경매결과 백테스트 완료 시 backend/data/auction_correction.json이 생성된다.
  파일이 없으면 보정 없이 기존 동작(하위호환). 파일 있으면 rate에 보정 곱하기.
  ⚠ 보정계수는 실데이터 백테스트로만 산출 — npl_backtest.run_real_backtest() 전용.
"""
from __future__ import annotations

import json
import os

from backend.npl_auction_rates import auction_rate
from backend.npl_rights import analyze_rights
from backend.npl_building_ledger import compute_confidence

# ── 실데이터 보정계수 로드 헬퍼 (세션당 1회 캐시) ──────────────────────────────
_CORRECTION_PATH = os.path.join(
    os.path.dirname(__file__), "data", "auction_correction.json"
)
_correction_cache: dict | None = None  # None = 미확인, {} = 파일 없음
_correction_loaded = False


def _load_correction() -> dict | None:
    """
    backend/data/auction_correction.json 로드 (캐시).

    ⚠ 실데이터 백테스트 보정계수 전용.
      파일 없으면 None 반환 → 보정 미적용(기존 동작 유지).
      파일 있어도 source != "real_backtest"이면 무시.

    Returns:
        보정계수 dict 또는 None (보정 없음)
    """
    global _correction_cache, _correction_loaded
    if _correction_loaded:
        return _correction_cache
    _correction_loaded = True
    if not os.path.exists(_CORRECTION_PATH):
        _correction_cache = None
        return None
    try:
        with open(_CORRECTION_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if data.get("source") != "real_backtest":
            _correction_cache = None  # 합성 보정계수 무시
        else:
            _correction_cache = data
    except (json.JSONDecodeError, OSError):
        _correction_cache = None
    return _correction_cache


def _correction_factor(region_code: str | None, collateral_type: str | None) -> float:
    """
    지역×담보유형 보정계수 반환. 세그먼트 우선, 없으면 전역, 없으면 1.0.

    Args:
        region_code:      시군구코드
        collateral_type:  담보유형

    Returns:
        보정 곱하기 계수 (기본 1.0 = 보정 없음)
    """
    from backend.npl_auction_rates import region_tier
    corr = _load_correction()
    if not corr:
        return 1.0

    # 세그먼트: collateral_type 우선 (지역 세그먼트는 tier 단위)
    by_ct = corr.get("by_collateral_type", {})
    ct = collateral_type or "apt"
    if ct in by_ct:
        return float(by_ct[ct])

    by_tier = corr.get("by_region_tier", {})
    tier = region_tier(region_code)
    if tier in by_tier:
        return float(by_tier[tier])

    return float(corr.get("global_correction", 1.0))

# ── 매수 평가 가정 (npl-buy-scorer.js와 동일) ──
# V1: 고정 낙찰가율 → 지역×유형 동적 행렬(npl_auction_rates). fallback만 상수 유지.
AUCTION_RATE_FALLBACK = {"p10": 0.68, "p50": 0.82, "p90": 0.95}
DEFAULT_RECOVERY_MONTHS = 12

# ── 매도 평가 가정 (npl-sell-scorer.js와 동일) ──
ANNUAL_DISCOUNT = 0.08
SELL_COST_RATE = 0.02
HOLD_HORIZONS = [6, 12, 24]
RECOVERY_RATE = {"p10": 0.55, "p50": 0.78, "p90": 1.05}


def _num(v):
    try:
        f = float(v)
        return 0.0 if f != f else f  # NaN guard
    except (TypeError, ValueError):
        return 0.0


def _clamp01(x):
    return max(0.0, min(1.0, x))


def _irr_to_grade(irr: float) -> str:
    if irr >= 0.25:
        return "very_high"
    if irr >= 0.15:
        return "high"
    if irr >= 0.05:
        return "medium"
    return "low"


def evaluate_buy(inp: dict) -> dict | None:
    """매수 평가 — 회수 cone + 권리관계 차감 + IRR. None = 필수값 부족."""
    claim = _num(inp.get("claim"))
    buy_price = _num(inp.get("buy_price"))
    if claim <= 0 or buy_price <= 0:
        return None
    appraisal = _num(inp.get("appraisal")) or claim * 1.2

    # V1: 지역×담보유형 동적 낙찰가율
    rate = auction_rate(inp.get("region_code"), inp.get("collateral_type"))
    # ── 실데이터 보정계수 적용 (파일 없으면 1.0 = 보정 없음, 하위호환) ──────────
    cf = _correction_factor(inp.get("region_code"), inp.get("collateral_type"))
    rate = {k: rate[k] * cf for k in ("p10", "p50", "p90")}
    # V4: 정밀 권리분석 (소액임차 최우선변제 + 조세 + 배당순위 + 회수기간 보정)
    rights = analyze_rights(inp)
    deduction = rights["total_deduction"]
    months = rights["recovery_months_adj"]
    net = {k: max(0.0, appraisal * rate[k] - deduction) for k in ("p10", "p50", "p90")}

    recovered = net["p50"]
    if buy_price <= 0 or recovered <= 0:
        irr = -1.0
    else:
        years = months / 12 if months else 1
        irr = (recovered / buy_price) ** (1 / years) - 1 if years > 0 else recovered / buy_price - 1

    grade = _irr_to_grade(irr)
    return {
        "eval_type": "buy",
        "score_irr": round(irr, 4),
        "grade": grade,
        "recovery_p10": round(net["p10"]),
        "recovery_p50": round(net["p50"]),
        "recovery_p90": round(net["p90"]),
        "confidence": compute_confidence(
            base=0.60,
            has_building=bool(inp.get("has_building")),
            has_realprice3=bool(inp.get("has_realprice3")),
            has_registry=bool(inp.get("has_registry")),
            has_defect=bool(inp.get("has_defect")),
        ),
        "seniority_warning": deduction >= claim * 0.9,
        "rights": rights,
        # 보정 투명성: 실데이터 보정 적용 여부 + 계수
        "correction_applied": cf != 1.0,
        "correction_factor": round(cf, 4),
    }


def evaluate_sell(inp: dict) -> dict | None:
    """매도 평가 — 즉시매각 NPV vs 보유 cone + 추천. None = 필수값 부족."""
    book_value = _num(inp.get("book_value"))
    market_quote = _num(inp.get("market_quote"))
    if book_value <= 0 and market_quote <= 0:
        return None

    base = book_value or market_quote
    provision = _clamp01(_num(inp.get("provision_rate")) / 100)
    carrying = _num(inp.get("carrying_monthly"))
    uplift = 1 + provision * 0.3

    def _npv(fv, months):
        return fv / ((1 + ANNUAL_DISCOUNT) ** (months / 12))

    cone = {}
    for m in HOLD_HORIZONS:
        gross = {
            "p10": base * RECOVERY_RATE["p10"],
            "p50": base * RECOVERY_RATE["p50"] * uplift,
            "p90": base * RECOVERY_RATE["p90"] * uplift,
        }
        hc = carrying * m
        cone[m] = {k: round(_npv(max(0.0, gross[k] - hc), m)) for k in ("p10", "p50", "p90")}

    sell_now = round(market_quote * (1 - SELL_COST_RATE))
    hold_p50_max = max(cone[h]["p50"] for h in HOLD_HORIZONS)
    gap = (sell_now - hold_p50_max) / hold_p50_max if hold_p50_max > 0 else 0
    if sell_now >= hold_p50_max and gap >= 0.20:
        grade = "very_high"
    elif sell_now >= hold_p50_max and gap >= 0:
        grade = "high"
    elif cone[24]["p10"] >= sell_now * 1.2:
        grade = "low"
    else:
        grade = "medium"

    return {
        "eval_type": "sell",
        "score_npv": sell_now,
        "grade": grade,
        "recovery_p10": cone[12]["p10"],
        "recovery_p50": cone[12]["p50"],
        "recovery_p90": cone[12]["p90"],
        "confidence": compute_confidence(
            base=0.58,
            has_building=bool(inp.get("has_building")),
            has_realprice3=bool(inp.get("has_realprice3")),
            has_registry=bool(inp.get("has_registry")),
            has_defect=bool(inp.get("has_defect")),
        ),
    }


def evaluate(inp: dict) -> dict | None:
    """eval_type에 따라 매수/매도 평가 디스패치."""
    et = (inp.get("eval_type") or "buy").lower()
    return evaluate_sell(inp) if et == "sell" else evaluate_buy(inp)
