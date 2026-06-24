"""backend/npl_fund_report.py
NPL 펀드 단위 IR 리포트 계산 엔진 — LP(출자자) 대상.

주요 기능:
  - fund_fees()          : 운용보수 + 성과보수(carry) + LP 순수익 산정
  - monte_carlo_recovery(): 몬테카를로 10,000회 시뮬레이션 → 펀드 회수 분포
  - fund_summary()       : 위 두 함수 묶어 IR 리포트용 종합 결과 반환

⚠ 단순화 가정 (LP에 명시 필요):
  - carry: 유럽식 수익 기준. catch-up 조항 미적용 (보수적 단순화).
    정밀 carry는 실제 LP계약서의 waterfall 조항에 따라 달라진다.
  - 몬테카를로(correlation=False): 물건 간 독립 가정 (지역/담보 상관관계 미반영).
    실제 부동산 포트폴리오는 동일 지역 집중 시 상관이 높아진다.
  - 몬테카를로(correlation=True): 지역·담보 기반 Cholesky 상관 샘플링.
    rho 정책값 — 실데이터 백테스트로 보정 가능(T2).
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


def _triangular_u(u: float, lo: float, mode: float, hi: float) -> float:
    """삼각분포 역변환 — 외부 uniform u[0,1)를 받아 샘플 반환 (상관샘플링용)."""
    if hi <= lo:
        return mode
    u = max(0.0, min(1.0 - 1e-15, u))  # 수치 안전 클램프
    fc = (mode - lo) / (hi - lo)
    if u < fc:
        return lo + math.sqrt(u * (hi - lo) * (mode - lo))
    else:
        return hi - math.sqrt((1.0 - u) * (hi - lo) * (hi - mode))


def _phi(z: float) -> float:
    """표준정규 CDF Φ(z) — math.erf 기반 (numpy 없이)."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def cholesky(matrix: list[list[float]]) -> list[list[float]]:
    """
    순수 python Cholesky 분해 — L 반환 (L·Lᵀ = matrix).

    행렬이 양정치(PD)가 아닌 경우:
      1) 대각에 작은 jitter(1e-8)를 더해 재시도
      2) 그래도 실패하면 단위행렬(독립) 폴백 + 경고 출력

    Args:
        matrix: N×N 실수 대칭 행렬 (리스트of리스트)

    Returns:
        L: 하한삼각 리스트of리스트. 폴백 시 단위행렬.
    """
    n = len(matrix)
    # 작업 복사본
    A = [row[:] for row in matrix]

    def _try_chol(m: list[list[float]]) -> list[list[float]] | None:
        L = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(i + 1):
                s = sum(L[i][k] * L[j][k] for k in range(j))
                if i == j:
                    val = m[i][i] - s
                    if val < 0.0:
                        return None
                    L[i][j] = math.sqrt(val)
                else:
                    if L[j][j] == 0.0:
                        return None
                    L[i][j] = (m[i][j] - s) / L[j][j]
        return L

    L = _try_chol(A)
    if L is not None:
        return L

    # jitter 추가 후 재시도
    jitter = 1e-8
    A_jit = [row[:] for row in matrix]
    for i in range(n):
        A_jit[i][i] += jitter
    L = _try_chol(A_jit)
    if L is not None:
        return L

    # 폴백: 단위행렬 (독립 가정)
    print("[cholesky] ⚠ 비양정치 행렬 — 독립(단위행렬)으로 폴백")
    return [[1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]


# 상관계수 정책값 — 실데이터 백테스트로 보정 가능(T2)
_RHO_SAME_REGION = 0.50      # 같은 지역코드(region_code)만 동일
_RHO_SAME_COLLATERAL = 0.30  # 같은 담보유형(collateral_type)만 동일
_RHO_BOTH = 0.65             # 지역+담보 모두 동일


def build_correlation(
    items: list[dict],
    same_region_rho: float = _RHO_SAME_REGION,
    same_collateral_rho: float = _RHO_SAME_COLLATERAL,
    both_rho: float = _RHO_BOTH,
) -> list[list[float]]:
    """
    지역코드·담보유형 기반 N×N 상관행렬 생성.

    rho 정책값 (실데이터 백테스트로 보정 가능 — T2):
      same_region_rho    = 0.50  (같은 지역코드)
      same_collateral_rho= 0.30  (같은 담보유형)
      both_rho           = 0.65  (지역+담보 모두 동일)
      무관               = 0.00
      대각               = 1.00

    Args:
        items: region_code, collateral_type 포함 물건 리스트

    Returns:
        N×N 상관행렬 (대칭, 대각=1)
    """
    n = len(items)
    mat = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                mat[i][j] = 1.0
                continue
            ri = str(items[i].get("region_code") or "")
            rj = str(items[j].get("region_code") or "")
            ci = str(items[i].get("collateral_type") or "")
            cj = str(items[j].get("collateral_type") or "")
            same_r = ri and ri == rj
            same_c = ci and ci == cj
            if same_r and same_c:
                mat[i][j] = both_rho
            elif same_r:
                mat[i][j] = same_region_rho
            elif same_c:
                mat[i][j] = same_collateral_rho
            # else: 0.0 (무관)
    return mat


def monte_carlo_recovery(
    items: list[dict],
    n_sims: int = 10000,
    seed: int = 42,
    correlation: bool = False,
) -> dict:
    """
    몬테카를로 시뮬레이션 — 펀드 전체 회수 분포 추정.

    ⚠ 가정:
      - correlation=False(기본): 물건 간 독립 가정.
      - correlation=True: 지역·담보 기반 Cholesky 상관 샘플링.
        rho 정책값 — 실데이터 백테스트로 보정 가능(T2).
        집중포트폴리오(같은 지역/담보)에서 독립 대비 분포 폭이 넓어진다.
      - 각 물건: 삼각분포(lo=p10×0.5, mode=p50, hi=p90×1.3) 샘플링.
      - 꼬리 확장(lo×0.5, hi×1.3)으로 극단 시나리오 반영.

    Args:
        items       : recovery_p10/p50/p90 포함 물건 리스트
        n_sims      : 시뮬레이션 횟수 (기본 10,000)
        seed        : 재현성 시드
        correlation : True면 지역·담보 상관 반영 (기본 False — 기존 독립 동작)

    Returns:
        {n_items, n_sims, p5/p25/p50/p75/p95, loss_prob,
         mean, std, correlated, assumptions}
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
    n_assets = len(params)
    sim_totals: list[float] = []

    if correlation and n_assets > 1:
        # ── 상관 샘플링 경로 ────────────────────────────────────────────────
        # 1) N×N 상관행렬 → Cholesky 분해
        corr_mat = build_correlation(valid)
        L = cholesky(corr_mat)  # L·Lᵀ = corr_mat (폴백 시 단위행렬)

        sqrt2 = math.sqrt(2.0)

        for _ in range(n_sims):
            # 2) iid 표준정규 N개 생성
            z_ind = [rng.gauss(0.0, 1.0) for _ in range(n_assets)]

            # 3) L 곱해 상관 정규 벡터 생성 (z_corr = L · z_ind)
            z_corr = [
                sum(L[i][k] * z_ind[k] for k in range(i + 1))
                for i in range(n_assets)
            ]

            # 4) 정규 CDF로 [0,1) uniform 변환 → 삼각분포 역변환
            total = 0.0
            for i, (lo, mode, hi) in enumerate(params):
                u = _phi(z_corr[i])
                total += _triangular_u(u, lo, mode, hi)
            sim_totals.append(total)
    else:
        # ── 독립 샘플링 경로 (기존 동작 그대로) ────────────────────────────
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

    if correlation and n_assets > 1:
        assumptions = (
            f"지역·담보 Cholesky 상관 샘플링. "
            f"rho={_RHO_SAME_REGION}(같은지역)/{_RHO_SAME_COLLATERAL}(같은담보)/"
            f"{_RHO_BOTH}(둘다) — 실데이터 백테스트로 보정 가능(T2). "
            "삼각분포 근사(꼬리=p10×0.5~p90×1.3). 원금은 p50 합산의 75% 근사."
        )
    else:
        assumptions = (
            "물건간 독립 가정. 삼각분포 근사(꼬리=p10×0.5~p90×1.3). "
            "원금은 p50 합산의 75% 근사. 실제 상관관계 반영 시 분포 폭 달라짐."
        )

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
        "correlated": correlation and n_assets > 1,
        "assumptions": assumptions,
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
        correlation: bool = Field(
            False,
            description=(
                "True면 지역·담보 Cholesky 상관 샘플링 (집중포트폴리오 리스크 현실화). "
                "False(기본)면 물건간 독립 가정."
            ),
        )

    @router.post("/monte-carlo", summary="펀드 회수분포 몬테카를로 (정밀)")
    def fund_monte_carlo(payload: MonteCarloIn):
        """프론트 JS 간이판(5000회·물건간 독립)보다 정밀한 백엔드 시뮬레이션(10000회).
        correlation=True 시 지역·담보 Cholesky 상관 반영 — 집중포트폴리오 리스크 현실화."""
        return monte_carlo_recovery(
            payload.items,
            n_sims=payload.n_sims,
            seed=payload.seed,
            correlation=payload.correlation,
        )
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
    verdict = "OK" if abs(check - recovered) < 1 else "FAIL"
    print(f"합계검증   : 보수+carry+LP = {check:,} 만원 (총회수 {recovered:,}) → {verdict}")
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
