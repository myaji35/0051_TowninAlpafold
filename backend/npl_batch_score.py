"""backend/npl_batch_score.py
NPL 포트폴리오 일괄 평가 배치 파이프라인 — 7.7조/2.5만건 규모 검증 포함.

용도:
  1. 임의 규모 CSV/JSON 입력을 V1(낙찰가율) + V4(권리분석) 엔진으로 일괄 평가
  2. 실데이터 도착 전 파이프라인 검증용 합성 데이터 생성 (2.5만건 기준)

⚠ 합성 데이터 주의: generate_synthetic() 결과는 통계 분포 기반 가상 데이터.
  실제 NPL 포트폴리오 데이터와 다름. 실데이터 주입 방법은 하단 ## 실데이터 주입 참조.

실행:
  python -m backend.npl_batch_score          # 기본 2.5만건 / 7.7조 검증
  python -m backend.npl_batch_score --n 1000 --db /tmp/test.db  # 소규모 테스트
"""
from __future__ import annotations

import argparse
import json
import random
import sqlite3
import time
import uuid
import datetime as _dt
from pathlib import Path
from typing import Optional

from backend.npl_scorer import evaluate_buy
from backend.npl_auction_rates import _METRO, _METROPOLITAN

# ── 합성 데이터 지역 분포 (수도권 50% / 광역시 30% / 지방 20%) ──
# region_code 앞 2자리 기준으로 권역 결정 (npl_auction_rates.py 동일 규칙)
_REGION_POOL = {
    "capital": [
        "11010", "11020", "11030", "11110", "11140",  # 서울 (11)
        "41110", "41130", "41150", "41170", "41190",  # 경기 (41)
        "28010", "28140", "28177",                    # 인천 (28)
    ],
    "metro": [
        "26010", "26110", "26140", "26170",           # 부산 (26)
        "27010", "27200", "27140",                    # 대구 (27)
        "29010",                                       # 광주 (29)
        "30010",                                       # 대전 (30)
        "31010",                                       # 울산 (31)
    ],
    "local": [
        "42010", "43010", "44010", "45010",           # 강원/충북/충남/전북
        "46010", "47010", "48010", "50010",           # 전남/경북/경남/제주
    ],
}

# 담보유형 분포 (아파트 55% / 오피스텔 20% / 상가 15% / 토지 10%)
_COLLATERAL_TYPES = ["apt", "officetel", "commercial", "land"]
_COLLATERAL_WEIGHTS = [0.55, 0.20, 0.15, 0.10]

# 수도권/광역시/지방 비율 가중치
_REGION_TIER_WEIGHTS = {"capital": 0.50, "metro": 0.30, "local": 0.20}


def _now():
    return _dt.datetime.utcnow().isoformat() + "Z"


def _gen_id(i: int) -> str:
    """배치 내 유일 ID 생성."""
    return f"NPL-BATCH-{i:07d}"


def generate_synthetic(n: int = 25000, total_opb_krw: float = 7_700_000_000_000,
                       seed: int = 42) -> list[dict]:
    """
    합성 NPL 자산 리스트 생성 — 실데이터 도착 전 파이프라인 검증용.

    Args:
        n: 건수 (기본 25,000)
        total_opb_krw: 목표 총 OPB 원화 (기본 7.7조)
        seed: 난수 시드 (재현성 보장)

    Returns:
        합성 자산 dict 리스트. 각 건에 source="synthetic" 명시.

    ⚠ 실데이터와 무관한 통계 기반 가상 데이터임.
    """
    rng = random.Random(seed)

    # 건당 평균 OPB = total / n ≈ 3.08억. 로그정규분포로 변동성 부여.
    avg_opb = total_opb_krw / n  # ≈ 308,000,000원
    # 단위: 만원 (scorer 내부 단위 — portfolio_demo.json 참조)
    avg_opb_man = avg_opb / 10_000  # ≈ 30,800만원

    # 지역 티어별 풀 구성 (가중 샘플링)
    tier_list = list(_REGION_TIER_WEIGHTS.keys())
    tier_weights = [_REGION_TIER_WEIGHTS[t] for t in tier_list]

    items = []
    for i in range(1, n + 1):
        # 지역 선택 (수도권/광역시/지방 가중)
        tier = rng.choices(tier_list, weights=tier_weights, k=1)[0]
        region_code = rng.choice(_REGION_POOL[tier])

        # 담보유형 선택
        collateral_type = rng.choices(_COLLATERAL_TYPES, weights=_COLLATERAL_WEIGHTS, k=1)[0]

        # OPB(claim) — 로그정규 분포: μ=log(avg), σ=0.7 → 큰 격차 반영
        # 평균이 목표 avg_opb_man이 되도록 μ 보정 (E[X]=exp(μ+σ²/2))
        sigma = 0.7
        mu = (avg_opb_man ** 0.95) * (1 / avg_opb_man ** (-0.05))  # 근사 보정
        # 간단 보정: log(avg) - σ²/2
        mu_log = (avg_opb_man * (1 / 2.718 ** (sigma ** 2 / 2)))
        claim = max(500, rng.lognormvariate(
            __import__('math').log(avg_opb_man) - sigma ** 2 / 2, sigma
        ))
        claim = round(claim)  # 만원 단위 정수

        # appraisal = claim × 1.05~1.35
        appraisal = round(claim * rng.uniform(1.05, 1.35))

        # buy_price = claim × 0.40~0.80 (NPL 할인 매입)
        buy_price = round(claim * rng.uniform(0.40, 0.80))

        # 권리관계 (일부 건에 임차/세금 부담)
        has_senior = rng.random() < 0.30
        senior = round(claim * rng.uniform(0.10, 0.30)) if has_senior else 0

        has_tax = rng.random() < 0.20
        tax = round(claim * rng.uniform(0.02, 0.08)) if has_tax else 0

        has_deposit = rng.random() < 0.35
        # 소액임차 한도 안팎 (capital=16500만, metro=14500만, local=8500만)
        dep_caps = {"capital": 16500, "metro": 14500, "local": 8500}
        dep_cap = dep_caps[tier]
        deposit = round(rng.uniform(500, dep_cap * 1.2)) if has_deposit else 0

        recovery_months = rng.choice([6, 12, 18, 24])

        item = {
            "id": _gen_id(i),
            "portfolio_id": "PF-SYNTHETIC-25K",
            "eval_type": "buy",          # 배치는 매수 평가 기준
            "collateral_type": collateral_type,
            "region_code": region_code,
            "claim": claim,
            "buy_price": buy_price,
            "appraisal": appraisal,
            "senior": senior,
            "tax": tax,
            "deposit": deposit,
            "recovery_months": recovery_months,
            "source": "synthetic",       # ⚠ 합성 데이터 — 실데이터 아님
        }
        items.append(item)

    return items


def score_batch(items: list[dict], progress_every: int = 1000) -> list[dict]:
    """
    일괄 매수 평가 — evaluate_buy 호출, 진행률 출력.

    Args:
        items: 자산 dict 리스트 (claim, buy_price, region_code, collateral_type 필수)
        progress_every: 진행률 출력 간격 (건)

    Returns:
        평가 결과 merged dict 리스트. 평가 실패 건은 grade="error" 부여.
    """
    scored = []
    total = len(items)
    t0 = time.time()

    for idx, item in enumerate(items, 1):
        result = evaluate_buy(item)
        if result is None:
            # 필수값 부족 — 파이프라인 중단 없이 오류 마킹
            merged = {**item, "grade": "error", "score_irr": None,
                      "recovery_p10": 0, "recovery_p50": 0, "recovery_p90": 0,
                      "confidence": 0.0}
        else:
            merged = {**item, **result}

        scored.append(merged)

        if idx % progress_every == 0 or idx == total:
            elapsed = time.time() - t0
            rate = idx / elapsed if elapsed > 0 else 0
            print(f"  [{idx:6d}/{total}] {elapsed:.1f}초 경과  "
                  f"({rate:.0f}건/초)  현재 등급: {merged.get('grade')}")

    return scored


def compute_priority(scored: list[dict]) -> list[dict]:
    """
    입찰 우선순위 부여 — is_not_recommended=False 건 우선, IRR 내림차순, 신뢰도 내림차순.

    Args:
        scored: score_batch 결과 리스트

    Returns:
        priority_rank(1=최우선) 컬럼이 추가된 동일 리스트 (in-place 변경 없이 새 key 추가).
    """
    def _sort_key(item):
        # 손실플래그 건은 후순위 (1 → 뒤, 0 → 앞)
        flagged = 1 if item.get("is_not_recommended") else 0
        irr = item.get("score_irr") or -999.0
        conf = item.get("confidence") or 0.0
        # (오름차순 정렬이므로 IRR/신뢰도는 음수 변환)
        return (flagged, -irr, -conf)

    ranked = sorted(scored, key=_sort_key)
    for rank, item in enumerate(ranked, 1):
        item["priority_rank"] = rank
    return ranked


def flag_loss(scored: list[dict]) -> list[dict]:
    """
    비추천(손실 예상) 자동 플래그 — 아래 조건 중 하나라도 해당하면 is_not_recommended=True.
      - score_irr < 0 (마이너스 IRR)
      - grade == "low" AND recovery_p50 < buy_price

    Args:
        scored: score_batch 결과 리스트 (in-place 수정)

    Returns:
        동일 리스트 (is_not_recommended 컬럼 추가됨).
    """
    for item in scored:
        irr = item.get("score_irr")
        grade = item.get("grade")
        p50 = item.get("recovery_p50") or 0
        buy = item.get("buy_price") or 0

        loss_irr = irr is not None and irr < 0
        loss_low = grade == "low" and p50 < buy
        item["is_not_recommended"] = bool(loss_irr or loss_low)

    return scored


def persist(scored: list[dict], db: sqlite3.Connection, batch_size: int = 500) -> int:
    """
    npl_assets 일괄 INSERT (executemany, 트랜잭션 분할).

    Args:
        scored: 평가 완료 dict 리스트
        db: sqlite3.Connection (init_db() 호출 후)
        batch_size: 트랜잭션 묶음 크기

    Returns:
        적재된 총 건수.
    """
    _RAW_KEYS = (
        "claim", "buy_price", "appraisal", "senior", "tax", "deposit",
        "recovery_months",
    )
    sql = """
        INSERT INTO npl_assets
            (id, portfolio_id, eval_type, address, collateral_type, region_code,
             score_irr, score_npv, grade, recovery_p10, recovery_p50, recovery_p90,
             confidence, raw_input, source, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            grade=excluded.grade, score_irr=excluded.score_irr,
            recovery_p10=excluded.recovery_p10, recovery_p50=excluded.recovery_p50,
            recovery_p90=excluded.recovery_p90, confidence=excluded.confidence,
            raw_input=excluded.raw_input, updated_at=excluded.updated_at
    """
    now = _now()
    total_inserted = 0

    # batch_size 단위로 트랜잭션 분할 — 메모리 및 잠금 최소화
    for chunk_start in range(0, len(scored), batch_size):
        chunk = scored[chunk_start: chunk_start + batch_size]
        rows = []
        for item in chunk:
            raw = {k: item.get(k) for k in _RAW_KEYS if item.get(k) is not None}
            rows.append((
                item.get("id") or f"NPL-AUTO-{uuid.uuid4().hex[:10].upper()}",
                item.get("portfolio_id"),
                item.get("eval_type", "buy"),
                item.get("address"),
                item.get("collateral_type"),
                item.get("region_code"),
                item.get("score_irr"),
                item.get("score_npv"),
                item.get("grade"),
                item.get("recovery_p10"),
                item.get("recovery_p50"),
                item.get("recovery_p90"),
                item.get("confidence"),
                json.dumps(raw, ensure_ascii=False),
                item.get("source", "batch"),
                now,
                now,
            ))
        db.executemany(sql, rows)
        db.commit()
        total_inserted += len(rows)

    return total_inserted


def grade_distribution(scored: list[dict]) -> dict:
    """
    등급 분포 집계.

    Returns:
        {very_high, high, medium, low, error, not_recommended, total}
    """
    dist = {"very_high": 0, "high": 0, "medium": 0, "low": 0, "error": 0}
    not_rec = 0
    for item in scored:
        g = item.get("grade", "error")
        dist[g] = dist.get(g, 0) + 1
        if item.get("is_not_recommended"):
            not_rec += 1

    dist["not_recommended"] = not_rec
    dist["total"] = len(scored)
    return dist


def run(n: int = 25000, total: float = 7_700_000_000_000,
        db_path: Optional[str] = None, seed: int = 42) -> dict:
    """
    배치 파이프라인 엔트리포인트.

    단계: 합성생성 → 평가 → 손실플래그 → 우선순위 → DB적재 → 집계 보고

    Args:
        n: 건수 (기본 25,000)
        total: 목표 총 OPB 원화 (기본 7.7조)
        db_path: SQLite DB 경로. None이면 임시 인메모리(:memory:) 사용.
        seed: 난수 시드

    Returns:
        집계 결과 dict (등급분포, OPB합계, 소요시간, 샘플 등)
    """
    t_start = time.time()
    print(f"\n{'='*60}")
    print(f"NPL 배치 파이프라인 — {n:,}건 / 목표 OPB {total/1e12:.1f}조원")
    print(f"{'='*60}")

    # 1단계: 합성 데이터 생성
    print(f"\n[1/5] 합성 데이터 생성 중 (seed={seed})...")
    items = generate_synthetic(n, total, seed)
    opb_sum_man = sum(item["claim"] for item in items)
    opb_sum_krw = opb_sum_man * 10_000
    print(f"  생성 완료: {len(items):,}건  OPB합계 {opb_sum_krw/1e12:.2f}조원 "
          f"({opb_sum_krw/total*100:.1f}% of 목표)")

    # 2단계: 일괄 평가
    print(f"\n[2/5] 일괄 평가 (evaluate_buy × {n:,}건)...")
    scored = score_batch(items, progress_every=5000)

    # 3단계: 손실 플래그
    print(f"\n[3/5] 손실 플래그 산출...")
    scored = flag_loss(scored)

    # 4단계: 우선순위 정렬
    print(f"\n[4/5] 입찰 우선순위 정렬...")
    scored = compute_priority(scored)

    # 5단계: DB 적재
    print(f"\n[5/5] DB 적재...")
    use_memory = db_path is None
    conn = sqlite3.connect(db_path or ":memory:")
    conn.execute("PRAGMA journal_mode = WAL")
    # 스키마 초기화 (npl_assets 테이블 보장)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS npl_assets (
            id              TEXT PRIMARY KEY,
            portfolio_id    TEXT,
            eval_type       TEXT NOT NULL,
            address         TEXT,
            collateral_type TEXT,
            region_code     TEXT,
            score_irr       REAL,
            score_npv       REAL,
            grade           TEXT,
            recovery_p10    REAL,
            recovery_p50    REAL,
            recovery_p90    REAL,
            confidence      REAL,
            raw_input       TEXT DEFAULT '{}',
            source          TEXT DEFAULT 'batch',
            created_at      TEXT NOT NULL,
            updated_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_npl_grade  ON npl_assets(grade);
        CREATE INDEX IF NOT EXISTS idx_npl_irr    ON npl_assets(score_irr);
    """)
    inserted = persist(scored, conn)
    print(f"  적재 완료: {inserted:,}건")

    # 집계
    dist = grade_distribution(scored)
    t_elapsed = time.time() - t_start

    # DB 검증 — COUNT + 백분위
    db_count = conn.execute("SELECT COUNT(*) FROM npl_assets").fetchone()[0]
    # 백분위: p10/p50/p90 IRR 분포
    irr_pct = conn.execute("""
        SELECT
            ROUND(AVG(CASE WHEN irr_rank <= total*0.10 THEN score_irr END), 4) AS p10,
            ROUND(AVG(CASE WHEN irr_rank <= total*0.50 THEN score_irr END), 4) AS p50,
            ROUND(AVG(CASE WHEN irr_rank <= total*0.90 THEN score_irr END), 4) AS p90
        FROM (
            SELECT score_irr,
                   ROW_NUMBER() OVER (ORDER BY score_irr) AS irr_rank,
                   COUNT(*) OVER () AS total
            FROM npl_assets
            WHERE score_irr IS NOT NULL
        )
    """).fetchone()

    # 우선순위 Top3 / Bottom3 (손실플래그 제외 기준 정렬은 priority_rank 기준)
    top3 = sorted(
        [s for s in scored if not s.get("is_not_recommended")],
        key=lambda x: x.get("priority_rank", 99999)
    )[:3]
    bottom3 = sorted(
        [s for s in scored if not s.get("is_not_recommended")],
        key=lambda x: x.get("priority_rank", 99999),
        reverse=True
    )[:3]

    if not use_memory:
        conn.close()

    # 최종 보고
    print(f"\n{'='*60}")
    print(f"최종 보고")
    print(f"{'='*60}")
    print(f"  총 건수    : {len(scored):,}건")
    print(f"  OPB 합계   : {opb_sum_krw/1e12:.2f}조원 (목표 대비 {opb_sum_krw/total*100:.1f}%)")
    print(f"  소요 시간  : {t_elapsed:.1f}초  ({len(scored)/t_elapsed:.0f}건/초)")
    print(f"\n  등급 분포:")
    print(f"    very_high : {dist['very_high']:,}건 ({dist['very_high']/n*100:.1f}%)")
    print(f"    high      : {dist['high']:,}건 ({dist['high']/n*100:.1f}%)")
    print(f"    medium    : {dist['medium']:,}건 ({dist['medium']/n*100:.1f}%)")
    print(f"    low       : {dist['low']:,}건 ({dist['low']/n*100:.1f}%)")
    print(f"    error     : {dist.get('error',0):,}건")
    print(f"    비추천    : {dist['not_recommended']:,}건")
    print(f"\n  DB COUNT   : {db_count:,}건")
    if irr_pct:
        print(f"  IRR 백분위 : p10={irr_pct[0]}  p50={irr_pct[1]}  p90={irr_pct[2]}")
    print(f"\n  우선순위 Top3 (비손실 기준):")
    for i, s in enumerate(top3, 1):
        print(f"    #{i}: {s['id']}  IRR={s.get('score_irr')}  grade={s.get('grade')}")
    print(f"\n  우선순위 Bottom3 (비손실 기준):")
    for i, s in enumerate(bottom3, 1):
        print(f"    #{i}: {s['id']}  IRR={s.get('score_irr')}  grade={s.get('grade')}")

    # 손실플래그 검증 — score_irr<0과의 일치율
    irr_neg_count = sum(1 for s in scored if (s.get("score_irr") or 0) < 0)
    flag_count = dist["not_recommended"]
    print(f"\n  손실플래그 : {flag_count:,}건")
    print(f"  score_irr<0: {irr_neg_count:,}건  (플래그 ⊇ irr<0 검증: "
          f"{'OK' if flag_count >= irr_neg_count else 'WARN'})")

    return {
        "total": len(scored),
        "opb_sum_krw": opb_sum_krw,
        "opb_ratio": opb_sum_krw / total,
        "elapsed_sec": t_elapsed,
        "grade_distribution": dist,
        "db_count": db_count,
        "irr_percentile": {"p10": irr_pct[0], "p50": irr_pct[1], "p90": irr_pct[2]}
        if irr_pct else None,
        "top3": [{"id": s["id"], "irr": s.get("score_irr"), "grade": s.get("grade"),
                  "rank": s.get("priority_rank")} for s in top3],
        "bottom3": [{"id": s["id"], "irr": s.get("score_irr"), "grade": s.get("grade"),
                     "rank": s.get("priority_rank")} for s in bottom3],
        "loss_flag_count": flag_count,
        "irr_neg_count": irr_neg_count,
        "flag_covers_irr_neg": flag_count >= irr_neg_count,
    }


# ── CLI 엔트리 ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NPL 배치 평가 파이프라인")
    parser.add_argument("--n", type=int, default=25000, help="건수 (기본: 25,000)")
    parser.add_argument("--total", type=float, default=7_700_000_000_000,
                        help="목표 총 OPB 원화 (기본: 7.7조)")
    parser.add_argument("--db", type=str, default=None,
                        help="SQLite DB 경로 (기본: :memory: 인메모리)")
    parser.add_argument("--seed", type=int, default=42, help="난수 시드 (기본: 42)")
    args = parser.parse_args()

    result = run(n=args.n, total=args.total, db_path=args.db, seed=args.seed)


# ── 실데이터 주입 시 필요한 것 (TODO) ─────────────────────────────────────
# 1. 실 CSV/JSON 파일 경로를 --input 옵션으로 전달하는 파서 추가
# 2. load_from_csv(path) / load_from_json(path) 함수 구현
#    - 컬럼명 매핑: 실데이터 컬럼명 → scorer 키(claim, buy_price, region_code 등)
# 3. source 필드를 "real_data" 또는 파일명으로 변경
# 4. portfolio_id를 실 포트폴리오 식별자로 교체
# 5. 실데이터 전처리: 결측치(claim=0, buy_price=0) 제거 또는 기본값 채우기
# 6. 적재 전 중복 ID 검출 및 upsert 정책 확인 (persist()의 ON CONFLICT 활용)
