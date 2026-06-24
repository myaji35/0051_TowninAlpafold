"""backend/npl_fund_report.py
NPL 펀드 단위 IR 리포트 계산 엔진 — LP(출자자) 대상.

주요 기능:
  - fund_fees()          : 운용보수 + 성과보수(carry) + LP 순수익 산정
  - monte_carlo_recovery(): 몬테카를로 10,000회 시뮬레이션 → 펀드 회수 분포
  - fund_summary()       : 위 두 함수 묶어 IR 리포트용 종합 결과 반환

⚠ 단순화 가정 (LP에 명시 필요):
  - carry: 유럽식 수익 기준. catch-up 조항 미적용 (보수적 단순화).
    정밀 carry는 실제 LP계약서의 waterfall 조항에 따라 달라진다.
  - 몬테카를로: 물건 간 독립 가정 (지역/담보 상관관계 미반영).
    실제 부동산 포트폴리오는 동일 지역 집중 시 상관이 높아진다.
  - 각 물건 회수는 삼각분포(p10, p50, p90)로 근사 샘플링.
    삼각분포 최솟값=p10×0.5, 최댓값=p90×1.3 으로 꼬리 반영.
  - IRR 추정: 간이 공식 (현금흐름 정밀 모델 아님).
    정밀 IRR은 투자 시점별 현금흐름 및 회수 스케줄 필요.
"""
from __future__ import annotations

import math
import random
from typing import Optional


# ── 운용보수 / 성과보수 산정 ─────────────────────────────────────────────────

def fund_fees(
    committed_capital: float,
    total_recovered: float,
    fund_years: float,
    mgmt_rate: float = 0.02,
    carry_rate: float = 0.20,
    hurdle_rate: float = 0.08,
) -> dict:
    """
    펀드 수수료 구조 산정 (단순화 버전).

    ⚠ 단순화: catch-up 조항 미적용. LP계약서의 실제 waterfall과 다를 수 있음.

    운용보수 = committed_capital × mgmt_rate × fund_years
    hurdle_threshold = committed_capital × (1 + hurdle_rate)^fund_years
    carry 대상 = max(0, total_recovered - hurdle_threshold - management_fee)
    carry = carry_대상 × carry_rate
    LP 순수익 = total_recovered - management_fee - carry

    Args:
        committed_capital : 약정총액 (만원)
        total_recovered   : 총회수 예상액 (만원, p50 사용 권장)
        fund_years        : 펀드 운용 기간 (년)
        mgmt_rate         : 연 운용보수율 (기본 2%)
        carry_rate        : 성과보수율 (기본 20%)
        hurdle_rate        : 연 기준수익률 (기본 8%)

    Returns:
        {management_fee, hurdle_threshold, carry_base, carry,
         lp_net, gp_total, lp_moic, lp_net_irr_approx, formula_note}
    """
    # 운용보수
    management_fee = committed_capital * mgmt_rate * fund_years

    # hurdle threshold (복리)
    hurdle_threshold = committed_capital * ((1 + hurdle_rate) ** fund_years)

    # carry 산정 기준: hurdle 초과분에서 운용보수 차감 후 carry 적용
    carry_base = max(0.0, total_recovered - hurdle_threshold - management_fee)
    carry = carry_base * carry_rate

    # LP 순수익
    lp_net = total_recovered - management_fee - carry

    # LP MoIC (투자원금 대비 배수)
    lp_moic = lp_net / committed_capital if committed_capital > 0 else 0.0

    # 간이 IRR 추정: (lp_net / committed_capital)^(1/years) - 1
    # ⚠ 간이 공식 — 실제 IRR은 현금흐름 타이밍에 따라 달라짐
    if committed_capital > 0 and lp_moic > 0 and fund_years > 0:
        lp_irr_approx = (lp_moic ** (1.0 / fund_years)) - 1.0
    else:
        lp_irr_approx = 0.0

    return {
        "committed_capital": round(committed_capital),
        "total_recovered": round(total_recovered),
        "management_fee": round(management_fee),
        "hurdle_threshold": round(hurdle_threshold),
        "carry_base": round(carry_base),
        "carry": round(carry),
        "lp_net": round(lp_net),
        "gp_total": round(management_fee + carry),
        "lp_moic": round(lp_moic, 3),
        "lp_net_irr_approx": round(lp_irr_approx, 4),
        "formula_note": (
            "단순화: catch-up 미적용. hurdle 초과분에 carry 적용. "
            "IRR은 간이 공식(연복리근사). 실제 LP계약 waterfall과 다를 수 있음."
        ),
    }


# ── 몬테카를로 회수 분포 ─────────────────────────────────────────────────────

def _triangular(rng: random.Random, lo: float, mode: float, hi: float) -> float:
    """삼각분포 샘플러 (표준 변환법)."""
    if hi <= lo:
        return mode
    u = rng.random()
    fc = (mode - lo) / (hi - lo)
    if u < fc:
        return lo + math.sqrt(u * (hi - lo) * (mode - lo))
    else:
        return hi - math.sqrt((1.0 - u) * (hi - lo) * (hi - mode))


def monte_carlo_recovery(
    items: list[dict],
    n_sims: int = 10000,
    seed: int = 42,
) -> dict:
    """
    몬테카를로 시뮬레이션 — 펀드 전체 회수 분포 추정.

    ⚠ 가정:
      - 물건 간 독립 가정 (지역/담보유형 상관관계 미반영). 집중투자 시 실제 분산이 더 좁음.
      - 각 물건: 삼각분포(lo=p10×0.5, mode=p50, hi=p90×1.3) 샘플링.
      - 꼬리 확장(lo×0.5, hi×1.3)으로 극단 시나리오 반영.

    Args:
        items  : recovery_p10/p50/p90 포함 물건 리스트
        n_sims : 시뮬레이션 횟수 (기본 10,000)
        seed   : 재현성 시드

    Returns:
        {n_items, n_sims, p5/p25/p50/p75/p95, loss_prob,
         mean, std, assumptions}
    """
    valid = [
        it for it in items
        if (it.get("recovery_p10") or 0) > 0
        or (it.get("recovery_p50") or 0) > 0
        or (it.get("recovery_p90") or 0) > 0
    ]
    if not valid:
        return {"error": "유효 물건 없음", "n_items": 0}

    # 각 물건의 삼각분포 파라미터 사전 계산
    params = []
    for it in valid:
        p10 = float(it.get("recovery_p10") or it.get("recovery_p50", 0) * 0.7)
        p50 = float(it.get("recovery_p50") or 0)
        p90 = float(it.get("recovery_p90") or p50 * 1.3)
        lo = max(0.0, p10 * 0.5)   # 꼬리 확장 (극단 하락)
        hi = p90 * 1.3              # 꼬리 확장 (극단 상승)
        mode = max(lo, min(p50, hi))
        params.append((lo, mode, hi))

    # 원금 = p50 합산 (손실확률 기준)
    principal = sum(float(it.get("recovery_p50") or 0) for it in valid) * 0.75
    # 약정가격(투자원금)이 없으므로 p50의 75%를 매입가 근사값으로 사용
    # 실제 사용 시 fundConfig.committed_capital로 대체 권장

    rng = random.Random(seed)
    sim_totals: list[float] = []

    for _ in range(n_sims):
        total = sum(_triangular(rng, lo, mode, hi) for lo, mode, hi in params)
        sim_totals.append(total)

    sim_totals.sort()
    n = len(sim_totals)

    def pct_val(p: float) -> float:
        idx = min(n - 1, int(p / 100 * n))
        return sim_totals[idx]

    loss_count = sum(1 for v in sim_totals if v < principal)
    mean = sum(sim_totals) / n
    variance = sum((v - mean) ** 2 for v in sim_totals) / n
    std = math.sqrt(variance)

    return {
        "n_items": len(valid),
        "n_sims": n_sims,
        "p5": round(pct_val(5)),
        "p25": round(pct_val(25)),
        "p50": round(pct_val(50)),
        "p75": round(pct_val(75)),
        "p95": round(pct_val(95)),
        "mean": round(mean),
        "std": round(std),
        "loss_prob": round(loss_count / n, 4),
        "principal_proxy": round(principal),
        "assumptions": (
            "물건간 독립 가정. 삼각분포 근사(꼬리=p10×0.5~p90×1.3). "
            "원금은 p50 합산의 75% 근사. 실제 상관관계 반영 시 분포 폭 달라짐."
        ),
    }


# ── 펀드 종합 요약 ────────────────────────────────────────────────────────────

def fund_summary(
    items: list[dict],
    config: dict,
) -> dict:
    """
    펀드 단위 IR 리포트 데이터 종합.

    Args:
        items : recovery_p10/p50/p90 포함 물건 리스트
        config: {
            committed_capital: float (만원),
            fund_years: float (운용 기간, 년),
            mgmt_rate: float (기본 0.02),
            carry_rate: float (기본 0.20),
            hurdle_rate: float (기본 0.08),
            gp_name: str (운용사명, 선택),
            fund_name: str (펀드명, 선택),
            n_sims: int (몬테카를로 횟수, 기본 10000),
            seed: int (기본 42),
        }

    Returns:
        {fees (p10/p50/p90 시나리오), mc_distribution, portfolio_summary, meta}
    """
    committed = float(config.get("committed_capital", 0))
    fund_years = float(config.get("fund_years", 3))
    mgmt_rate = float(config.get("mgmt_rate", 0.02))
    carry_rate = float(config.get("carry_rate", 0.20))
    hurdle_rate = float(config.get("hurdle_rate", 0.08))
    n_sims = int(config.get("n_sims", 10000))
    seed = int(config.get("seed", 42))

    # 회수 cone (물건별 p10/p50/p90 합산)
    cone = {"p10": 0.0, "p50": 0.0, "p90": 0.0}
    for it in items:
        cone["p10"] += float(it.get("recovery_p10") or 0)
        cone["p50"] += float(it.get("recovery_p50") or 0)
        cone["p90"] += float(it.get("recovery_p90") or 0)

    # 시나리오별 수수료 (p10/p50/p90)
    fees_p10 = fund_fees(committed, cone["p10"], fund_years, mgmt_rate, carry_rate, hurdle_rate)
    fees_p50 = fund_fees(committed, cone["p50"], fund_years, mgmt_rate, carry_rate, hurdle_rate)
    fees_p90 = fund_fees(committed, cone["p90"], fund_years, mgmt_rate, carry_rate, hurdle_rate)

    # 몬테카를로
    mc = monte_carlo_recovery(items, n_sims=n_sims, seed=seed)

    # 포트폴리오 구성 요약
    grade_dist: dict[str, int] = {}
    ct_dist: dict[str, int] = {}
    conf_sum = 0.0
    for it in items:
        g = it.get("grade", "unknown")
        grade_dist[g] = grade_dist.get(g, 0) + 1
        ct = it.get("collateral_type", "unknown")
        ct_dist[ct] = ct_dist.get(ct, 0) + 1
        conf_sum += float(it.get("confidence") or 0)

    n_items = len(items)

    return {
        "meta": {
            "fund_name": config.get("fund_name", "NPL 펀드"),
            "gp_name": config.get("gp_name", "운용사(GP)"),
            "n_items": n_items,
            "committed_capital": round(committed),
            "fund_years": fund_years,
            "mgmt_rate": mgmt_rate,
            "carry_rate": carry_rate,
            "hurdle_rate": hurdle_rate,
        },
        "recovery_cone": {
            "p10": round(cone["p10"]),
            "p50": round(cone["p50"]),
            "p90": round(cone["p90"]),
        },
        "fees": {
            "scenario_p10": fees_p10,
            "scenario_p50": fees_p50,
            "scenario_p90": fees_p90,
        },
        "mc_distribution": mc,
        "portfolio_summary": {
            "n_items": n_items,
            "avg_confidence": round(conf_sum / n_items, 3) if n_items else 0,
            "grade_distribution": grade_dist,
            "collateral_distribution": ct_dist,
        },
    }


# ── FastAPI 라우터 (몬테카를로 정밀값 — JS 간이판 대체) ────────────────────────
try:
    from fastapi import APIRouter
    from pydantic import BaseModel, Field

    router = APIRouter(prefix="/api/v1/fund", tags=["fund"])

    class MonteCarloIn(BaseModel):
        items: list[dict] = Field(..., description="recovery_p10/p50/p90 포함 물건 리스트")
        n_sims: int = Field(10000, ge=1000, le=100000)
        seed: int = 42

    @router.post("/monte-carlo", summary="펀드 회수분포 몬테카를로 (정밀)")
    def fund_monte_carlo(payload: MonteCarloIn):
        """프론트 JS 간이판(5000회·물건간 독립)보다 정밀한 백엔드 시뮬레이션(10000회).
        물건간 독립 가정은 동일하나 표본 수가 많아 분포 추정이 안정적."""
        return monte_carlo_recovery(payload.items, n_sims=payload.n_sims, seed=payload.seed)
except ImportError:
    router = None  # FastAPI 미설치 환경(순수 계산 테스트)에서는 라우터 생략


# ── 검증용 CLI ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # sanity: 약정 100억(=1000000만원), 회수 130억, mgmt 2%, carry 20%, hurdle 8%, 3년
    committed = 1_000_000  # 100억 (만원)
    recovered = 1_300_000  # 130억 (만원)

    fees = fund_fees(
        committed_capital=committed,
        total_recovered=recovered,
        fund_years=3,
        mgmt_rate=0.02,
        carry_rate=0.20,
        hurdle_rate=0.08,
    )

    print("\n=== 수수료 산정 sanity ===")
    print(f"약정총액   : {fees['committed_capital']:>12,} 만원")
    print(f"총회수     : {fees['total_recovered']:>12,} 만원")
    print(f"운용보수   : {fees['management_fee']:>12,} 만원")
    print(f"hurdle기준 : {fees['hurdle_threshold']:>12,} 만원")
    print(f"carry기준  : {fees['carry_base']:>12,} 만원")
    print(f"성과보수   : {fees['carry']:>12,} 만원")
    print(f"LP 순수익  : {fees['lp_net']:>12,} 만원")
    check = fees["management_fee"] + fees["carry"] + fees["lp_net"]
    print(f"합계검증   : 보수+carry+LP = {check:,} 만원 (총회수 {recovered:,}) → {'OK' if abs(check-recovered)<1 else 'FAIL'}")
    print(f"LP MoIC    : {fees['lp_moic']:.3f}배")
    print(f"LP IRR(간이): {fees['lp_net_irr_approx']*100:.2f}%")
    print(f"주의: {fees['formula_note']}")

    # 몬테카를로 sanity (단순 목업 80건)
    import json, os
    demo_path = os.path.join(os.path.dirname(__file__), "../data_raw/_npl/portfolio_demo.json")
    try:
        with open(demo_path) as f:
            demo = json.load(f)
        items = demo.get("items", [])
        mc = monte_carlo_recovery(items, n_sims=10000, seed=42)
        print("\n=== 몬테카를로 sanity (80건, 10,000회) ===")
        print(f"물건 수    : {mc['n_items']}")
        print(f"p5 / p25 / p50 / p75 / p95 : "
              f"{mc['p5']:,} / {mc['p25']:,} / {mc['p50']:,} / {mc['p75']:,} / {mc['p95']:,}")
        print(f"손실확률   : {mc['loss_prob']*100:.1f}%")
        print(f"평균 / 표준편차 : {mc['mean']:,} / {mc['std']:,}")
        order_ok = mc['p5'] < mc['p25'] < mc['p50'] < mc['p75'] < mc['p95']
        loss_ok = 0 <= mc['loss_prob'] <= 1
        print(f"분포 순서  : {'OK' if order_ok else 'FAIL'}")
        print(f"손실확률 범위: {'OK' if loss_ok else 'FAIL'}")
        print(f"가정: {mc['assumptions']}")
    except FileNotFoundError:
        print("\n[SKIP] portfolio_demo.json 없음 — 몬테카를로 sanity 스킵")
