#!/usr/bin/env python3
"""scripts/seed_npl_mock.py
NPL 포트폴리오 목업 시드 — 기획자 괴리 최소화용 '현실적' 데이터.

무작위가 아니라 실제 한국 NPL 시장 분포를 반영:
  - 지역: 수도권 집중 (서울/경기/인천 ~62%), 광역시, 지방
  - 담보유형: 아파트 최다(~55%), 오피스텔/상가/토지
  - 가격대: 담보유형·지역별 현실적 분포
  - 권리관계: 선순위/세금/보증금이 실제처럼 일부 물건에 집중
  - 등급: very_high~low가 자연스러운 분포 (전부 우량 아님)

사용:
  python3 scripts/seed_npl_mock.py --count 5000          # DB 직접 시드
  python3 scripts/seed_npl_mock.py --count 5000 --csv out.csv   # CSV 출력
"""
import sys
import os
import json
import argparse
import random
import datetime as _dt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── 실 시군구 (코드 5자리 기반, 현실 비중 가중치) ──
# (지역명, 시군구코드, 평균 담보가 만원, 출현 가중치)
REGIONS = [
    # 서울 (고가, 높은 비중)
    ("서울 강남구", "11680", 95000, 8), ("서울 송파구", "11710", 75000, 7),
    ("서울 노원구", "11350", 48000, 6), ("서울 강서구", "11500", 52000, 6),
    ("서울 관악구", "11620", 46000, 5),
    # 경기 (최다 비중)
    ("경기 수원시", "41110", 55000, 9), ("경기 성남시", "41130", 68000, 7),
    ("경기 고양시", "41280", 50000, 7), ("경기 용인시", "41460", 58000, 7),
    ("경기 의정부시", "41150", 42000, 6), ("경기 부천시", "41190", 45000, 6),
    # 인천
    ("인천 미추홀구", "28177", 38000, 5), ("인천 서구", "28260", 42000, 5),
    # 광역시
    ("부산 해운대구", "26350", 52000, 6), ("부산 부산진구", "26230", 40000, 5),
    ("대구 수성구", "27260", 48000, 4), ("대전 유성구", "30200", 44000, 4),
    ("광주 광산구", "29200", 36000, 3),
    # 지방
    ("강원 춘천시", "51110", 30000, 2), ("충북 청주시", "43110", 33000, 3),
    ("전북 전주시", "52110", 31000, 3), ("경남 창원시", "48120", 38000, 4),
]

# (담보유형, 가중치, 가격 배율, 낙찰 안정성)
COLLATERAL = [
    ("apt", 55, 1.0), ("officetel", 18, 0.7), ("commercial", 15, 0.85), ("land", 12, 1.3),
]


def _weighted_choice(items, wi):
    """items에서 가중치 인덱스 wi 기준 가중 선택."""
    total = sum(it[wi] for it in items)
    r = random.uniform(0, total)
    acc = 0
    for it in items:
        acc += it[wi]
        if r <= acc:
            return it
    return items[-1]


# 시군구별 실제 동(洞) 이름 (주소 현실성)
DONG_BY_REGION = {
    "11680": ["역삼동", "삼성동", "대치동", "논현동"], "11710": ["잠실동", "방이동", "문정동", "가락동"],
    "11350": ["상계동", "중계동", "하계동"], "11500": ["화곡동", "등촌동", "염창동"],
    "11620": ["봉천동", "신림동", "남현동"], "41110": ["영통동", "권선동", "인계동"],
    "41130": ["정자동", "서현동", "분당동"], "41280": ["행신동", "화정동", "주엽동"],
    "41460": ["기흥동", "수지동", "죽전동"], "41150": ["금오동", "민락동", "신곡동"],
    "41190": ["중동", "상동", "송내동"], "28177": ["주안동", "용현동", "학익동"],
    "28260": ["청라동", "검단동", "가정동"], "26350": ["우동", "중동", "좌동"],
    "26230": ["부전동", "양정동", "전포동"], "27260": ["범어동", "황금동", "수성동"],
    "30200": ["봉명동", "노은동", "관평동"], "29200": ["수완동", "하남동", "월계동"],
    "51110": ["석사동", "퇴계동", "후평동"], "43110": ["복대동", "가경동", "분평동"],
    "52110": ["효자동", "서신동", "송천동"], "48120": ["상남동", "용호동", "중앙동"],
}


def gen_asset(idx: int) -> dict:
    region = _weighted_choice(REGIONS, 3)          # REGIONS 가중치 = idx 3
    name, rcode, base_price, _ = region
    ctype = _weighted_choice(COLLATERAL, 1)        # COLLATERAL 가중치 = idx 1
    ct_name, _, price_mult = ctype

    # 매수/매도 비율 7:3 (매수 평가가 주력)
    eval_type = "buy" if random.random() < 0.7 else "sell"
    # 담보가 = 지역 base × 유형배율 × 개체 변동(0.5~1.8)
    appraisal = round(base_price * price_mult * random.uniform(0.5, 1.8))
    dong = random.choice(DONG_BY_REGION.get(rcode, ["중앙동"]))
    addr = f"{name} {dong} {random.randint(1, 999)}-{random.randint(1, 99)}"

    a = {
        "id": f"NPL-MOCK-{idx:06d}",
        "portfolio_id": "PF-DEMO-2026",
        "eval_type": eval_type,
        "address": addr.replace("  ", " "),
        "collateral_type": ct_name,
        "region_code": rcode,
        "source": "csv",
    }

    if eval_type == "buy":
        # 청구액 ≈ 감정가 0.6~0.95, 매수가 = 순회수 기대의 60~95% (등급 분산 유도)
        claim = round(appraisal * random.uniform(0.6, 0.95))
        # 권리관계: 40% 물건은 선순위 있음, 일부는 과중(저등급 유도)
        has_senior = random.random() < 0.4
        senior = round(appraisal * random.uniform(0.05, 0.6)) if has_senior else 0
        net_p50 = appraisal * 0.82 - senior
        # 매수가를 net 대비 비율로 → IRR 분산 (우량~부실 자연 분포)
        # 0.6~1.05: 낮을수록 고수익. 4단계 grade가 고르게 나오도록 조정.
        buy_ratio = random.uniform(0.60, 1.05)
        buy_price = round(max(1000, net_p50 * buy_ratio))
        a.update({
            "claim": claim, "buy_price": buy_price, "appraisal": appraisal,
            "senior": senior,
            "tax": round(appraisal * random.uniform(0, 0.02)) if random.random() < 0.5 else 0,
            "deposit": round(appraisal * random.uniform(0, 0.1)) if random.random() < 0.3 else 0,
            "has_opposing_power": random.random() < 0.5,
            "has_seizure": random.random() < 0.15,
        })
    else:
        book_value = appraisal
        # 시장호가 = 장부가 0.4~0.85
        a.update({
            "book_value": book_value,
            "market_quote": round(book_value * random.uniform(0.4, 0.85)),
            "provision_rate": round(random.uniform(10, 70)),
            "carrying_monthly": round(book_value * random.uniform(0.003, 0.012)),
        })
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=5000)
    ap.add_argument("--csv", help="CSV 출력 경로 (생략 시 DB 직접 시드)")
    ap.add_argument("--seed", type=int, default=20260612)
    args = ap.parse_args()
    random.seed(args.seed)

    assets = [gen_asset(i) for i in range(1, args.count + 1)]

    if args.csv:
        import csv
        cols = ["id", "portfolio_id", "eval_type", "address", "collateral_type", "region_code",
                "claim", "buy_price", "appraisal", "senior", "tax", "deposit",
                "book_value", "market_quote", "provision_rate", "carrying_monthly", "source"]
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for a in assets:
                w.writerow({k: a.get(k, "") for k in cols})
        print(f"✓ CSV {args.count}건 → {args.csv}")
        return

    # DB 직접 시드 (빠름 — scorer 직접 호출)
    from backend.db import init_db, _connect
    from backend import npl_scorer
    init_db()
    conn = _connect()
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    raw_keys = ("claim", "buy_price", "appraisal", "senior", "tax", "deposit",
                "book_value", "market_quote", "provision_rate", "carrying_monthly")
    ok = 0
    grade_dist = {}
    for a in assets:
        res = npl_scorer.evaluate(a)
        if res is None:
            continue
        raw = {k: a[k] for k in raw_keys if k in a}
        conn.execute(
            """INSERT OR REPLACE INTO npl_assets
               (id,portfolio_id,eval_type,address,collateral_type,region_code,
                score_irr,score_npv,grade,recovery_p10,recovery_p50,recovery_p90,
                confidence,raw_input,source,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (a["id"], a["portfolio_id"], res["eval_type"], a["address"],
             a["collateral_type"], a["region_code"],
             res.get("score_irr"), res.get("score_npv"), res["grade"],
             res["recovery_p10"], res["recovery_p50"], res["recovery_p90"],
             res["confidence"], json.dumps(raw, ensure_ascii=False),
             a["source"], now, now))
        grade_dist[res["grade"]] = grade_dist.get(res["grade"], 0) + 1
        ok += 1
    conn.commit()
    conn.close()
    print(f"✓ DB 시드 {ok}건 완료")
    print(f"  등급 분포: {grade_dist}")


if __name__ == "__main__":
    main()
