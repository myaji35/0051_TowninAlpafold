"""backend/npl_real_price.py
NPL 실거래가 보정 (V3) — 감정가 신뢰도 판정 + 국토부 실거래가 API 연동.
참조: docs/npl-professional-valuation.md §2.3

⚠️  T2 주의: 국토부 실거래가 API는 data.go.kr 인증키(DATA_GO_KR_KEY_REALPRICE 또는
    DATA_GO_KR_KEY) 필요. 키 없으면 confidence_delta=0, status="not_linked" 반환.
    가짜 실거래 데이터 반환 절대 금지.

JS 동기화: utils/npl-real-price.js (동일 로직 — drift 금지).
"""
from __future__ import annotations

import os
import statistics
import urllib.parse
import urllib.request
import json

# ── 감정가 신뢰도 판정 기준 (docs §2.3) ──────────────────────────────────────
TRUST_BAND = 0.15            # 감정가 ±15% 이내 → 신뢰
OVERVALUE_THRESHOLD = 0.85   # 실거래 中위가 < 감정가×0.85 → 과대평가 의심
OVERVALUE_FACTOR = 0.92      # 과대평가 시 보수 보정 계수 (8% 하향)
OVERVALUE_CONFIDENCE_DELTA = -0.10  # 과대평가 의심 시 confidence 차감

MIN_TRADES_FOR_BONUS = 3     # 실거래 3건 이상이어야 confidence +0.15 가산

# 국토부 실거래가 API (data.go.kr)
_REALPRICE_URL = (
    "http://apis.data.go.kr/1613000/RTMSDataSvcAptTrade"
    "/getRTMSDataSvcAptTrade"
)


# ── 공개 API ───────────────────────────────────────────────────────────────────

def price_confidence(appraisal: float, recent_trades: list[float] | None) -> dict:
    """감정가 vs 실거래 中위가 신뢰도 판정.

    인자:
        appraisal       float       감정가 (만원)
        recent_trades   list[float] 최근 실거래가 목록 (만원). None 또는 빈 목록 = 미연동.

    반환:
        median_trade    float | None    실거래 中위가
        trust_ratio     float | None    中위가 / 감정가
        factor          float           보정 계수 (곱셈) — 과대평가 시 < 1.0
        confidence_delta float          confidence 가산/차감
        verdict         str             "trusted" | "overvalued" | "insufficient"
        flags           list
        status          str             "linked" | "not_linked"
    """
    if not recent_trades or appraisal <= 0:
        return {
            "median_trade": None,
            "trust_ratio": None,
            "factor": 1.0,
            "confidence_delta": 0.0,
            "verdict": "insufficient",
            "flags": [],
            "status": "not_linked",
            "note": "실거래가 미연동 (DATA_GO_KR_KEY 필요 — T2)",
        }

    median = statistics.median(recent_trades)
    ratio = median / appraisal
    flags = []

    has_enough = len(recent_trades) >= MIN_TRADES_FOR_BONUS

    lower = 1 - TRUST_BAND
    upper = 1 + TRUST_BAND

    if ratio < OVERVALUE_THRESHOLD:
        # 과대평가 의심 — 보수 보정
        factor = OVERVALUE_FACTOR
        confidence_delta = OVERVALUE_CONFIDENCE_DELTA + (0.15 if has_enough else 0.0)
        verdict = "overvalued"
        flags.append(
            f"⚠️ 감정가 과대평가 의심 — 실거래 中위가({int(median):,}만) < 감정가×0.85"
        )
        flags.append(f"보수 보정 계수 ×{OVERVALUE_FACTOR} 적용")
    elif lower <= ratio <= upper:
        # 감정가 신뢰
        factor = 1.0
        confidence_delta = 0.15 if has_enough else 0.05
        verdict = "trusted"
        flags.append(
            f"감정가 신뢰 — 실거래 中위가/감정가 = {ratio:.2%} (±15% 이내)"
        )
    else:
        # 고가 실거래 (실거래 > 감정가+15%) — 상향 보정 없이 신뢰
        factor = 1.0
        confidence_delta = 0.10 if has_enough else 0.0
        verdict = "trusted"
        flags.append(
            f"실거래가 감정가 상회 — 비율 {ratio:.2%}"
        )

    if has_enough:
        flags.append(f"실거래 {len(recent_trades)}건 확인 — confidence +0.15 기준 충족")
    else:
        flags.append(f"실거래 {len(recent_trades)}건 (3건 미만 — confidence 보너스 불완전)")

    return {
        "median_trade": round(median, 0),
        "trust_ratio": round(ratio, 4),
        "factor": factor,
        "confidence_delta": round(confidence_delta, 4),
        "verdict": verdict,
        "flags": flags,
        "status": "linked",
        "trade_count": len(recent_trades),
    }


def fetch_real_prices(
    lawdcd: str,
    deal_ymd: str,
    api_key: str | None = None,
) -> list[float] | None:
    """국토부 실거래가 공개 API 호출 → 거래가 목록(만원) 반환.

    ⚠️  키 없으면 None 반환 — 실API 호출 안 함.

    인자:
        lawdcd      법정동 코드 (5자리). 예: "11110"(서울 종로구)
        deal_ymd    거래년월 (YYYYMM). 예: "202312"
        api_key     인증키. 없으면 환경변수 DATA_GO_KR_KEY_REALPRICE 또는 DATA_GO_KR_KEY

    반환: 거래가 float list 또는 None(키 없음/오류)
    """
    key = (
        api_key
        or os.environ.get("DATA_GO_KR_KEY_REALPRICE")
        or os.environ.get("DATA_GO_KR_KEY")
    )
    if not key:
        return None  # 키 없음 — 호출 안 함

    params = urllib.parse.urlencode({
        "serviceKey": key,
        "LAWD_CD": lawdcd,
        "DEAL_YMD": deal_ymd,
        "numOfRows": 50,
        "pageNo": 1,
    })
    url = f"{_REALPRICE_URL}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            raw = resp.read().decode()
        # 국토부 실거래 API는 XML 반환
        import re
        amounts = re.findall(r"<dealAmount>([^<]+)</dealAmount>", raw)
        prices = []
        for a in amounts:
            try:
                prices.append(float(a.replace(",", "").strip()))
            except ValueError:
                continue
        return prices if prices else None
    except Exception:  # noqa: BLE001
        return None
