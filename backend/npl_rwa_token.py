"""backend/npl_rwa_token.py
NPL→RWA 토큰화 발행원장 — SPC 비히클 + 토큰 발행 + 투자자 지분 원장 + 분배 워터폴.

참조: docs/npl-rwa-tokenization.md (설계 문서)
제도 근거: 2026.1.15 전자증권법·자본시장법 개정안 — 분산원장 전자등록계좌부 인정, STO 제도권 편입.

범위:
  - 발행원장 스키마 (spc_vehicle / token_issue / token_holding)
  - 기초자산 pool 집계 → 토큰 단가·예상수익률 산출
  - 분배 워터폴 계산 (원금 → 수익 우선 순위)
  - FastAPI 라우터 최소 4개 엔드포인트

범위 외(추후/외부):
  - 온체인 컨트랙트(Solidity) 연동
  - 실제 결제·청약 시스템 연동
  - KYC/AML 검증 (T2: 금융당국 기준 — 외부 자문 필요)
  - 발행인 계좌관리기관 등록 (T2: 금융위 심사)
"""
from __future__ import annotations

import datetime as _dt
import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.db import get_db

router = APIRouter(prefix="/api/v1/rwa", tags=["rwa"])


# ─── DDL (init_rwa_db 호출 시 생성) ─────────────────────────────────────────

RWA_DDL = """
-- ① 유동화 비히클 (SPC): NPL 채권을 양도받는 법적 주체
CREATE TABLE IF NOT EXISTS spc_vehicle (
    id              TEXT PRIMARY KEY,           -- SPC-xxxxxxxx
    name            TEXT NOT NULL,              -- 법인명 (예: "알파폴드 1호 유동화전문(유)")
    reg_number      TEXT,                       -- 법인등록번호 (T2: SPC 설립 완료 후)
    trust_type      TEXT NOT NULL DEFAULT 'spc', -- 'spc'|'trust' (신탁 구조 선택)
    servicer        TEXT,                       -- 채권 회수 대리인 (AMC명)
    issuer_account_manager TEXT,                -- 발행인 계좌관리기관 (T2: 금융위 지정 필요)
    status          TEXT NOT NULL DEFAULT 'draft', -- draft|active|closed
    created_at      TEXT NOT NULL,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_spc_status ON spc_vehicle(status);

-- ② 토큰 발행 (STO): SPC 위에 발행되는 수익증권/투자계약증권
CREATE TABLE IF NOT EXISTS token_issue (
    id              TEXT PRIMARY KEY,           -- TKN-xxxxxxxx
    spc_id          TEXT NOT NULL REFERENCES spc_vehicle(id),
    token_name      TEXT NOT NULL,              -- 토큰 명칭
    security_type   TEXT NOT NULL DEFAULT 'revenue_share',
                                                -- 'revenue_share'(수익증권) | 'investment_contract'(투자계약증권)
    total_tokens    INTEGER NOT NULL,           -- 총 발행 토큰 수
    price_per_token REAL NOT NULL,              -- 1토큰당 발행가 (원)
    min_subscription INTEGER NOT NULL DEFAULT 1, -- 최소 청약 단위 (토큰 수)
    pool_asset_ids  TEXT NOT NULL DEFAULT '[]', -- JSON array of npl_assets.id (기초자산 풀)
    pool_total_claim REAL,                      -- 기초자산 풀 채권합 (원)
    pool_recovery_p50 REAL,                     -- 풀 회수 중앙값 합산 (원)
    pool_recovery_p10 REAL,                     -- 풀 회수 하단 (원)
    pool_recovery_p90 REAL,                     -- 풀 회수 상단 (원)
    expected_irr    REAL,                       -- 예상 IRR (소수, 예: 0.18 = 18%)
    issue_date      TEXT,                       -- 실제 발행일 (T2: 증권신고서 제출 후)
    maturity_date   TEXT,                       -- 만기일
    status          TEXT NOT NULL DEFAULT 'draft', -- draft|open|closed|redeemed
    created_at      TEXT NOT NULL,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tki_spc    ON token_issue(spc_id);
CREATE INDEX IF NOT EXISTS idx_tki_status ON token_issue(status);

-- ③ 투자자 지분 원장 (조각화 지분 기록)
CREATE TABLE IF NOT EXISTS token_holding (
    id              TEXT PRIMARY KEY,           -- HLD-xxxxxxxx
    issue_id        TEXT NOT NULL REFERENCES token_issue(id),
    investor_id     TEXT NOT NULL,              -- 투자자 식별자 (KYC 완료 후 DID 또는 내부 ID)
    qty             INTEGER NOT NULL CHECK(qty > 0), -- 보유 토큰 수
    purchase_price  REAL NOT NULL,              -- 취득 단가 (원)
    -- 분배 누적
    distributed_total REAL NOT NULL DEFAULT 0, -- 누적 수취 분배금 (원)
    subscribed_at   TEXT NOT NULL,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_hld_issue    ON token_holding(issue_id);
CREATE INDEX IF NOT EXISTS idx_hld_investor ON token_holding(investor_id);

-- ④ 분배 이력 (회수 이벤트별 워터폴 결과 기록)
CREATE TABLE IF NOT EXISTS distribution_event (
    id              TEXT PRIMARY KEY,           -- DST-xxxxxxxx
    issue_id        TEXT NOT NULL REFERENCES token_issue(id),
    recovered_amount REAL NOT NULL,             -- 이번 회수금 (원)
    principal_repaid REAL NOT NULL,             -- 이 중 원금 상환분
    yield_paid      REAL NOT NULL,              -- 이 중 수익 지급분
    per_token_amount REAL NOT NULL,             -- 토큰 1개당 분배액
    distributed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dst_issue ON distribution_event(issue_id);
"""


def init_rwa_db():
    """RWA 테이블 초기화 — main.py 또는 단독 실행 시 호출."""
    import sqlite3, os
    from pathlib import Path
    DB_DIR = Path(__file__).resolve().parent / "data"
    DB_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = Path(os.environ.get("DATABASE_URL_FILE", str(DB_DIR / "towninalpafold.db")))
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(RWA_DDL)
    conn.commit()
    conn.close()


# ─── 헬퍼 ────────────────────────────────────────────────────────────────────

def _now() -> str:
    return _dt.datetime.utcnow().isoformat() + "Z"


def _gen_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


# ─── 핵심 비즈니스 로직 ───────────────────────────────────────────────────────

def _aggregate_pool(db, asset_ids: list[str]) -> dict:
    """기초자산 풀의 회수 cone 합산 + 채권 합계."""
    if not asset_ids:
        return {"total_claim": 0, "p10": 0, "p50": 0, "p90": 0, "count": 0}

    placeholders = ",".join("?" * len(asset_ids))
    rows = db.execute(
        f"SELECT raw_input, recovery_p10, recovery_p50, recovery_p90 "
        f"FROM npl_assets WHERE id IN ({placeholders})",
        asset_ids,
    ).fetchall()

    total_claim, p10, p50, p90 = 0.0, 0.0, 0.0, 0.0
    for r in rows:
        raw = json.loads(r["raw_input"] or "{}")
        total_claim += float(raw.get("claim") or 0)
        p10 += float(r["recovery_p10"] or 0)
        p50 += float(r["recovery_p50"] or 0)
        p90 += float(r["recovery_p90"] or 0)

    return {"total_claim": total_claim, "p10": p10, "p50": p50, "p90": p90, "count": len(rows)}


def create_token_issue(
    db,
    spc_id: str,
    asset_ids: list[str],
    total_tokens: int,
    price_per_token: float,
    token_name: str,
    security_type: str = "revenue_share",
    min_subscription: int = 1,
    maturity_date: str | None = None,
) -> dict:
    """토큰 발행 생성.

    발행 단가 공식:
      - price_per_token: 발행자가 설정 (시장 가격 결정)
      - expected_irr = (pool_recovery_p50 - total_issue_size) / total_issue_size
        여기서 total_issue_size = total_tokens × price_per_token
    """
    # SPC 존재 확인
    spc = db.execute("SELECT id FROM spc_vehicle WHERE id=?", (spc_id,)).fetchone()
    if not spc:
        raise ValueError(f"SPC 없음: {spc_id}")

    if total_tokens <= 0 or price_per_token <= 0:
        raise ValueError("total_tokens, price_per_token는 양수여야 함")

    pool = _aggregate_pool(db, asset_ids)
    total_issue_size = total_tokens * price_per_token

    # 예상 IRR: 풀 회수 중앙값 기준 (원금 보전 후 수익률)
    expected_irr = (pool["p50"] - total_issue_size) / total_issue_size if total_issue_size > 0 else 0.0

    issue_id = _gen_id("TKN")
    now = _now()
    db.execute(
        """INSERT INTO token_issue
           (id, spc_id, token_name, security_type, total_tokens, price_per_token,
            min_subscription, pool_asset_ids, pool_total_claim, pool_recovery_p50,
            pool_recovery_p10, pool_recovery_p90, expected_irr, maturity_date,
            status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (issue_id, spc_id, token_name, security_type, total_tokens, price_per_token,
         min_subscription, json.dumps(asset_ids), pool["total_claim"],
         pool["p50"], pool["p10"], pool["p90"], expected_irr,
         maturity_date, "draft", now, now),
    )
    db.commit()

    return {
        "id": issue_id,
        "spc_id": spc_id,
        "token_name": token_name,
        "total_tokens": total_tokens,
        "price_per_token": price_per_token,
        "total_issue_size": total_issue_size,
        "pool": pool,
        "expected_irr": round(expected_irr, 4),
        "status": "draft",
    }


def record_holding(db, issue_id: str, investor_id: str, qty: int) -> dict:
    """투자자 지분 원장 기록.

    검증:
      - 발행 존재 확인
      - 잔여 토큰 충분 여부 (total_tokens - 기발행 qty)
      - 최소 청약 단위 준수
    """
    issue = db.execute("SELECT * FROM token_issue WHERE id=?", (issue_id,)).fetchone()
    if not issue:
        raise ValueError(f"토큰 발행 없음: {issue_id}")
    if issue["status"] not in ("draft", "open"):
        raise ValueError(f"청약 불가 상태: {issue['status']}")
    if qty < issue["min_subscription"]:
        raise ValueError(f"최소 청약 단위 미달: {issue['min_subscription']} 이상")

    # 잔여 토큰 계산
    already_subscribed = db.execute(
        "SELECT COALESCE(SUM(qty),0) s FROM token_holding WHERE issue_id=?", (issue_id,)
    ).fetchone()["s"]
    remaining = issue["total_tokens"] - already_subscribed
    if qty > remaining:
        raise ValueError(f"잔여 토큰 부족: 잔여 {remaining}개 < 요청 {qty}개")

    hld_id = _gen_id("HLD")
    now = _now()
    db.execute(
        """INSERT INTO token_holding
           (id, issue_id, investor_id, qty, purchase_price, distributed_total, subscribed_at, updated_at)
           VALUES (?,?,?,?,?,0,?,?)""",
        (hld_id, issue_id, investor_id, qty, issue["price_per_token"], now, now),
    )
    db.commit()

    return {
        "holding_id": hld_id,
        "issue_id": issue_id,
        "investor_id": investor_id,
        "qty": qty,
        "purchase_price": issue["price_per_token"],
        "total_invested": qty * issue["price_per_token"],
    }


def distribution_waterfall(db, issue_id: str, recovered_amount: float) -> dict:
    """회수 분배 워터폴.

    워터폴 순서 (원금 우선):
      1단계 — 원금 상환: recovered_amount 중 미상환 원금 먼저 차감
      2단계 — 수익 지급: 원금 전액 상환 후 잔액을 수익으로 배분
      3단계 — 토큰 보유 비율에 따라 분배 (qty / total_subscribed)

    반환: 투자자별 분배액(시뮬레이션, DB 갱신 선택)
    """
    issue = db.execute("SELECT * FROM token_issue WHERE id=?", (issue_id,)).fetchone()
    if not issue:
        raise ValueError(f"토큰 발행 없음: {issue_id}")

    holdings = db.execute(
        "SELECT * FROM token_holding WHERE issue_id=?", (issue_id,)
    ).fetchall()
    if not holdings:
        raise ValueError("투자자 없음 — 청약 먼저 필요")

    total_subscribed = sum(h["qty"] for h in holdings)
    total_invested = total_subscribed * issue["price_per_token"]  # 총 원금

    # 누적 분배 이력에서 이미 지급된 원금 계산
    total_distributed_so_far = db.execute(
        "SELECT COALESCE(SUM(recovered_amount),0) s FROM distribution_event WHERE issue_id=?",
        (issue_id,),
    ).fetchone()["s"]
    principal_remaining = max(0.0, total_invested - total_distributed_so_far)

    # 워터폴 계산
    principal_repaid = min(recovered_amount, principal_remaining)
    yield_paid = max(0.0, recovered_amount - principal_repaid)
    per_token_amount = recovered_amount / total_subscribed if total_subscribed > 0 else 0.0

    # 투자자별 분배 시뮬레이션
    investor_distributions = []
    dist_check = 0.0
    for h in holdings:
        ratio = h["qty"] / total_subscribed
        amount = round(recovered_amount * ratio, 2)
        dist_check += amount
        investor_distributions.append({
            "investor_id": h["investor_id"],
            "holding_id": h["id"],
            "qty": h["qty"],
            "ratio": round(ratio, 6),
            "distribution_amount": amount,
        })

    # 반올림 잔차 보정 (첫 투자자에 귀속)
    diff = round(recovered_amount - dist_check, 2)
    if investor_distributions and diff != 0:
        investor_distributions[0]["distribution_amount"] += diff

    # 분배 이벤트 기록
    dst_id = _gen_id("DST")
    now = _now()
    db.execute(
        """INSERT INTO distribution_event
           (id, issue_id, recovered_amount, principal_repaid, yield_paid,
            per_token_amount, distributed_at)
           VALUES (?,?,?,?,?,?,?)""",
        (dst_id, issue_id, recovered_amount, principal_repaid, yield_paid, per_token_amount, now),
    )
    # 보유자별 distributed_total 갱신
    for iv in investor_distributions:
        db.execute(
            "UPDATE token_holding SET distributed_total = distributed_total + ?, updated_at=? WHERE id=?",
            (iv["distribution_amount"], now, iv["holding_id"]),
        )
    db.commit()

    return {
        "event_id": dst_id,
        "issue_id": issue_id,
        "recovered_amount": recovered_amount,
        "waterfall": {
            "principal_repaid": principal_repaid,
            "yield_paid": yield_paid,
            "per_token_amount": round(per_token_amount, 4),
        },
        "investor_distributions": investor_distributions,
        "sanity": {
            "total_subscribed_tokens": total_subscribed,
            "distribution_sum": sum(iv["distribution_amount"] for iv in investor_distributions),
            "equals_recovered": abs(
                sum(iv["distribution_amount"] for iv in investor_distributions) - recovered_amount
            ) < 0.01,
        },
    }


# ─── Pydantic 스키마 ──────────────────────────────────────────────────────────

class SpcIn(BaseModel):
    name: str
    reg_number: Optional[str] = None
    trust_type: str = Field("spc", pattern=r"^(spc|trust)$")
    servicer: Optional[str] = None
    issuer_account_manager: Optional[str] = None  # T2: 금융위 지정 계좌관리기관


class TokenIssueIn(BaseModel):
    spc_id: str
    token_name: str
    security_type: str = Field("revenue_share", pattern=r"^(revenue_share|investment_contract)$")
    total_tokens: int = Field(..., gt=0)
    price_per_token: float = Field(..., gt=0)
    min_subscription: int = Field(1, ge=1)
    asset_ids: list[str] = Field(default_factory=list)
    maturity_date: Optional[str] = None


class HoldingIn(BaseModel):
    investor_id: str
    qty: int = Field(..., gt=0)


class DistributionIn(BaseModel):
    recovered_amount: float = Field(..., gt=0)


# ─── FastAPI 엔드포인트 ───────────────────────────────────────────────────────

@router.post("/spc", status_code=201, summary="SPC 비히클 생성")
def create_spc(payload: SpcIn, db=Depends(get_db)):
    """유동화 비히클(SPC) 등록.
    주의: 실제 SPC 설립(법인등기)은 T2 — 법무법인 + 금융당국 승인 필요.
    이 엔드포인트는 내부 원장 등록 전용.
    """
    spc_id = _gen_id("SPC")
    now = _now()
    db.execute(
        """INSERT INTO spc_vehicle
           (id, name, reg_number, trust_type, servicer, issuer_account_manager,
            status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (spc_id, payload.name, payload.reg_number, payload.trust_type,
         payload.servicer, payload.issuer_account_manager, "draft", now, now),
    )
    db.commit()
    return {"id": spc_id, "name": payload.name, "status": "draft"}


@router.post("/issues", status_code=201, summary="토큰 발행 생성")
def issue_token(payload: TokenIssueIn, db=Depends(get_db)):
    """기초자산 풀 집계 + 토큰 발행 초안 생성.
    실제 증권 발행(증권신고서 제출, 공모)은 T2 — 금융당국 인가 필요.
    """
    try:
        return create_token_issue(
            db,
            spc_id=payload.spc_id,
            asset_ids=payload.asset_ids,
            total_tokens=payload.total_tokens,
            price_per_token=payload.price_per_token,
            token_name=payload.token_name,
            security_type=payload.security_type,
            min_subscription=payload.min_subscription,
            maturity_date=payload.maturity_date,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/issues/{issue_id}", summary="발행 상세 조회")
def get_issue(issue_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM token_issue WHERE id=?", (issue_id,)).fetchone()
    if not row:
        raise HTTPException(404, "발행 없음")
    d = dict(row)
    d["pool_asset_ids"] = json.loads(d.get("pool_asset_ids") or "[]")

    subscribed = db.execute(
        "SELECT COALESCE(SUM(qty),0) s FROM token_holding WHERE issue_id=?", (issue_id,)
    ).fetchone()["s"]
    d["subscribed_tokens"] = subscribed
    d["remaining_tokens"] = d["total_tokens"] - subscribed
    return d


@router.post("/issues/{issue_id}/holdings", status_code=201, summary="청약/지분 기록")
def subscribe(issue_id: str, payload: HoldingIn, db=Depends(get_db)):
    """투자자 청약 — 지분 원장에 기록.
    실제 청약(자금 수취, KYC 확인)은 T2 — 증권사 유통 채널 + KYC/AML 시스템 필요.
    """
    try:
        return record_holding(db, issue_id, payload.investor_id, payload.qty)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/issues/{issue_id}/distributions", status_code=201, summary="분배 시뮬레이션/실행")
def distribute(issue_id: str, payload: DistributionIn, db=Depends(get_db)):
    """회수금 입금 → 워터폴 분배 계산 + 원장 기록.
    실제 분배금 지급(계좌이체)은 T2 — 발행인 계좌관리기관 시스템 연동 필요.
    """
    try:
        return distribution_waterfall(db, issue_id, payload.recovered_amount)
    except ValueError as e:
        raise HTTPException(422, str(e))
