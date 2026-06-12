"""backend/npl_auction_rates.py
NPL 낙찰가율 행렬 (V1) — 지역×담보유형별 동적 낙찰가율.
참조: docs/npl-professional-valuation.md §2.1

고정 0.82 → 물건 특성(지역권역 × 담보유형)으로 차등.
초기값은 공개 경매 통계(대법원/민간) 기반 현실적 추정. 분기 갱신 대상.
JS 동기화: utils/npl-auction-rates.js (동일 값 유지 — drift 금지).
"""

# 시군구 코드 앞 2자리 → 권역 (수도권/광역시/지방)
_METRO = {"11", "28", "41"}          # 서울, 인천, 경기 = 수도권
_METROPOLITAN = {"26", "27", "29", "30", "31", "36"}  # 부산/대구/광주/대전/울산/세종

# 권역 × 담보유형 기준 낙찰가율 (p50 중앙값)
# 출처: 공개 경매 낙찰가율 통계 기반 추정 (수도권 아파트 高, 지방 토지 低)
BASE_RATE = {
    "capital": {"apt": 0.86, "officetel": 0.78, "commercial": 0.68, "land": 0.70},
    "metro":   {"apt": 0.80, "officetel": 0.72, "commercial": 0.62, "land": 0.64},
    "local":   {"apt": 0.74, "officetel": 0.65, "commercial": 0.55, "land": 0.58},
}
# p10/p90은 p50 대비 비율 (변동성 — 토지/상가가 아파트보다 변동 큼)
_SPREAD = {
    "apt":        {"p10": 0.83, "p90": 1.12},
    "officetel":  {"p10": 0.80, "p90": 1.15},
    "commercial": {"p10": 0.72, "p90": 1.22},
    "land":       {"p10": 0.70, "p90": 1.28},
}


def region_tier(region_code):
    """시군구코드 → 권역. None/미상은 local(보수)."""
    if not region_code:
        return "local"
    p = str(region_code)[:2]
    if p in _METRO:
        return "capital"
    if p in _METROPOLITAN:
        return "metro"
    return "local"


def auction_rate(region_code, collateral_type):
    """지역×유형 낙찰가율 cone {p10,p50,p90}. 미상 유형은 apt 기본."""
    tier = region_tier(region_code)
    ct = collateral_type if collateral_type in _SPREAD else "apt"
    p50 = BASE_RATE[tier].get(ct, BASE_RATE[tier]["apt"])
    sp = _SPREAD[ct]
    return {"p10": round(p50 * sp["p10"], 4), "p50": p50, "p90": round(p50 * sp["p90"], 4)}
