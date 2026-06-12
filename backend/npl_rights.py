"""backend/npl_rights.py
NPL 권리관계 정밀 분석 (V4) — 소액임차 최우선변제 + 조세채권 + 배당 우선순위.
참조: docs/npl-professional-valuation.md §2.4

기존: senior + tax + deposit 단순 합산 차감.
V4: 실제 배당 순위 반영 —
  1순위 소액임차 최우선변제 (지역별 한도, 근저당보다 앞섬)
  2순위 당해세/조세채권 (최우선)
  3순위 선순위 근저당
  4순위 일반 임차보증금 (대항력 있을 때만)

소액임차 한도: 주택임대차보호법 시행령 기준 (2023.02 개정). 지역권역별.
JS 동기화: utils/npl-rights.js (동일 값 — drift 금지).
"""
from __future__ import annotations

from backend.npl_auction_rates import region_tier

# 소액임차인 최우선변제 (주임법 시행령, 2023.02~). 권역별 {보증금 상한, 최우선변제 한도} 만원.
# capital=서울, metro=과밀억제권역/광역시, local=그 외 (단순화: 3구간)
SMALL_LEASE = {
    "capital": {"deposit_cap": 16500, "priority_cap": 5500},   # 서울
    "metro":   {"deposit_cap": 14500, "priority_cap": 4800},   # 과밀억제·광역시
    "local":   {"deposit_cap": 8500,  "priority_cap": 2800},   # 그 외
}


def _num(v):
    try:
        f = float(v)
        return 0.0 if f != f else f
    except (TypeError, ValueError):
        return 0.0


def analyze_rights(inp):
    """
    배당 순위 반영 권리관계 분석.
    입력: region_code, senior(근저당), tax(조세/당해세), deposit(임차보증금),
          has_opposing_power(대항력 여부, 기본 True), recovery_months
    반환: { total_deduction, breakdown[], small_lease_priority, recovery_months_adj, flags[] }
    """
    tier = region_tier(inp.get("region_code"))
    senior = _num(inp.get("senior"))
    tax = _num(inp.get("tax"))
    deposit = _num(inp.get("deposit"))
    has_op = inp.get("has_opposing_power", True)
    months = _num(inp.get("recovery_months")) or 12

    breakdown = []
    flags = []

    # 1순위: 소액임차 최우선변제 — 보증금이 권역 상한 이하일 때 한도 내 최우선
    small = SMALL_LEASE[tier]
    small_lease_priority = 0.0
    if deposit > 0 and deposit <= small["deposit_cap"]:
        small_lease_priority = min(deposit, small["priority_cap"])
        breakdown.append({"rank": 1, "name": "소액임차 최우선변제", "amount": round(small_lease_priority),
                          "note": f"{tier} 한도 {small['priority_cap']}만"})
        flags.append("소액임차 최우선변제 적용 (근저당보다 우선)")

    # 2순위: 조세채권/당해세 — 최우선
    if tax > 0:
        breakdown.append({"rank": 2, "name": "조세채권(당해세)", "amount": round(tax), "note": "법정기일 최우선"})

    # 3순위: 선순위 근저당
    if senior > 0:
        breakdown.append({"rank": 3, "name": "선순위 근저당", "amount": round(senior), "note": "설정 순위"})

    # 4순위: 일반 임차보증금 잔액 (대항력 있고, 최우선변제 초과분)
    remaining_deposit = deposit - small_lease_priority
    if remaining_deposit > 0:
        if has_op:
            breakdown.append({"rank": 4, "name": "임차보증금 잔액(대항력)", "amount": round(remaining_deposit),
                              "note": "대항력 — 매수인 인수"})
            flags.append("대항력 있는 임차인 — 보증금 잔액 인수 위험")
        else:
            breakdown.append({"rank": 4, "name": "임차보증금 잔액(대항력 없음)", "amount": 0,
                              "note": "대항력 없음 — 소멸"})

    # 총 차감 = 회수액에서 우선 변제되는 합 (대항력 없는 보증금 잔액은 제외)
    total_deduction = small_lease_priority + tax + senior + (remaining_deposit if has_op else 0)

    # 회수기간 보정: 가압류/가처분/대항력 임차인 → 명도 지연
    months_adj = months
    if inp.get("has_seizure"):
        months_adj += 6
        flags.append("가압류/가처분 등재 — 회수 지연 +6개월")
    if has_op and remaining_deposit > 0:
        months_adj += 3
        flags.append("명도 지연 가능 (대항력 임차인) +3개월")

    return {
        "total_deduction": round(total_deduction),
        "breakdown": breakdown,
        "small_lease_priority": round(small_lease_priority),
        "recovery_months_adj": months_adj,
        "flags": flags,
    }
