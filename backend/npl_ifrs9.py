"""backend/npl_ifrs9.py
IFRS9 / K-IFRS 1109 NPL POCI 손상모델 — Stage 전이 + 충당금 환입 + 자본 회전율.
utils/npl-ifrs9.js와 동일 로직 (drift 금지). 동일 입력 → 동일 출력 보장.

⚠️  T2 주의: 회계정책 확정(Stage 임계값, EIR 산출 방식, 충당금 적용 범위)은
    외부 회계법인 감사/검토 후 확정 필요. 본 코드는 계산 로직만 제공.

참조: IFRS 9 §B5.4.7 (credit-adjusted EIR), §5.4.1 (POCI interest income),
      K-IFRS 1109 §AG6~AG8 (기대신용손실 측정)
"""
from __future__ import annotations

import math

# ── Stage 전이 임계값 (회수 진척률 기준) ─────────────────────────────────────
# ⚠️  T2: 아래 상수는 시범값. 회계자문으로 확정 필요.
STAGE_THRESHOLD_S2 = 0.33   # progress ≥ 이 값이면 Stage3 → Stage2 전이
STAGE_THRESHOLD_S1 = 0.75   # progress ≥ 이 값이면 Stage2 → Stage1 전이


def compute_eir(purchase_price: float, expected_recovery: float, months: int) -> float:
    """신용조정 유효이자율(credit-adjusted EIR) — 연율.

    취득가(purchase_price) = 기대회수현금흐름 / (1+EIR)^years 를 만족하는 할인율.
    NPL 단일 만기 일시 회수 가정으로 단순화:
        EIR = (expected_recovery / purchase_price)^(12/months) - 1

    반환: 연율 소수 (예: 0.135 = 13.5%)
    """
    if purchase_price <= 0 or expected_recovery <= 0 or months <= 0:
        return 0.0
    years = months / 12.0
    return (expected_recovery / purchase_price) ** (1.0 / years) - 1.0


def interest_income(carrying_amount: float, eir: float, months: int) -> float:
    """기간 이자수익 인식 (IFRS 9 §5.4.1).

    POCI 기간 이자수익 = 기초 장부가 × EIR × (months/12)
    반환: 만원 단위 금액
    """
    if carrying_amount <= 0 or months <= 0:
        return 0.0
    return carrying_amount * eir * (months / 12.0)


def classify_stage(recovery_progress: float, confidence: float) -> str:
    """Stage 분류 (NPL → 회수 진행 → 정상화).

    recovery_progress: 0~1 (실회수액 / 기대회수액)
    confidence: 0~1 (회수 자신감 — 낮으면 stage 보수 유지)

    Stage3: 취득 시 손상 (progress 낮거나 confidence 낮음)
    Stage2: 회수 진행 중 (신용위험 일부 개선)
    Stage1: 정상화 / 토큰 매각 단계

    ⚠️  T2: STAGE_THRESHOLD_S2 / STAGE_THRESHOLD_S1 값은 회계자문으로 확정 필요.
    """
    p = max(0.0, min(1.0, recovery_progress))
    c = max(0.0, min(1.0, confidence))
    # confidence 가중 진척률 — 자신감 낮으면 보수적 stage 유지
    effective = p * (0.5 + 0.5 * c)
    if effective >= STAGE_THRESHOLD_S1:
        return "stage1"
    if effective >= STAGE_THRESHOLD_S2:
        return "stage2"
    return "stage3"


def provision_reversal(prev_ecl: float, carrying_amount: float, expected_recovery_pv: float) -> float:
    """충당금 환입액 계산 (IFRS 9 §5.5.8 기대신용손실 변동분).

    current_ecl = max(0, 장부가 - 기대회수 현재가치)
    환입액 = max(0, prev_ecl - current_ecl)  → 신용위험 개선 시 환입
    반환: 만원 단위 환입액 (0 이상)
    """
    current_ecl = max(0.0, carrying_amount - expected_recovery_pv)
    return max(0.0, prev_ecl - current_ecl)


def capital_turnover(recovery_months: int, early_exit_ratio: float) -> float:
    """연 자본 회전율 시뮬레이션.

    RWA 토큰 발행으로 회수 완료 전 자본 조기 회수 효과 반영.
    effective_holding_months = recovery_months × (1 - early_exit_ratio)
    turnover = 12 / effective_holding_months

    early_exit_ratio: 0~1 (토큰화로 앞당겨진 비율. 예: 0.4 = 40% 조기 회수)
    반환: 연 회전율 (예: 1.6)
    """
    ratio = max(0.0, min(0.95, early_exit_ratio))   # 100% 조기 탈출은 비현실적 — 상한 95%
    effective = recovery_months * (1.0 - ratio)
    if effective <= 0:
        return 0.0
    return 12.0 / effective


def simulate_poci(
    purchase_price: float,
    expected_recovery: float,
    months: int,
    early_exit_ratio: float = 0.4,
    recovery_progress: float = 0.0,
    confidence: float = 0.5,
    prev_ecl: float = 0.0,
) -> dict:
    """POCI 종합 시뮬레이션 — 위 함수를 묶어 한 번에 반환.

    반환: {
        eir, interest_income_period, stage,
        current_ecl, provision_reversal,
        turnover, effective_holding_months,
        stage_thresholds (참고용)
    }
    """
    eir = compute_eir(purchase_price, expected_recovery, months)
    inc = interest_income(purchase_price, eir, months)
    stage = classify_stage(recovery_progress, confidence)

    # 기대회수 현재가치 = purchase_price × (1+eir)^(months/12) 역산 → expected_recovery 사용
    # (단순화: EIR 시점 기준 현재가치 = expected_recovery / (1+eir)^(months/12))
    years = months / 12.0
    expected_recovery_pv = expected_recovery / ((1.0 + eir) ** years) if eir > -1 else 0.0

    current_ecl = max(0.0, purchase_price - expected_recovery_pv)
    reversal = provision_reversal(prev_ecl, purchase_price, expected_recovery_pv)

    ratio = max(0.0, min(0.95, early_exit_ratio))
    effective_months = months * (1.0 - ratio)
    turnover = capital_turnover(months, early_exit_ratio)

    return {
        "eir": round(eir, 6),
        "interest_income_period": round(inc, 0),
        "stage": stage,
        "current_ecl": round(current_ecl, 0),
        "provision_reversal": round(reversal, 0),
        "turnover": round(turnover, 4),
        "effective_holding_months": round(effective_months, 2),
        "stage_thresholds": {
            "s2": STAGE_THRESHOLD_S2,
            "s1": STAGE_THRESHOLD_S1,
            "note": "T2: 회계자문으로 확정 필요",
        },
    }
