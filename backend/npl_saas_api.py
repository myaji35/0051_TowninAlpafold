"""backend/npl_saas_api.py
NPL 평가 SaaS API — 멀티테넌트 키 발급·인증·과금·데이터 환류.

외부 고객사(NPL투자사·저축은행·AMC·법무법인)에 V1·V4 평가엔진을 API로 제공.

엔드포인트:
  POST   /saas/v1/tenants            테넌트 발급 (관리자)
  POST   /saas/v1/evaluate           매수/매도 평가 (테넌트 인증 필수)
  GET    /saas/v1/usage              본인 사용량 조회 (테넌트 인증 필수)
  GET    /saas/v1/billing            월간 청구 요약 (테넌트 인증 필수)

설계 근거: docs/npl-saas-design.md
보안:
  - API 키 평문 저장 금지 — SHA-256 해시 후 저장 (평문은 발급 시 1회만 반환)
  - 테넌트 격리 — require_tenant가 테넌트 ID를 반환, 엔드포인트는 이를 WHERE 조건으로 사용
  - 관리자 엔드포인트는 별도 ADMIN_SECRET으로 보호 (main.py의 API_TOKEN과 독립)

범위 외 (T2):
  - 결제 PG 연동 (카드/계좌이체) — 외부 PG사 계약 필요
  - 데이터 환류 약관 — 법무 검토 후 opt-in 동의 수집
  - 외부 SLA (99.9% uptime 보장) — 인프라 확정 후
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import secrets
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from backend.db import get_db
from backend import npl_scorer

router = APIRouter(prefix="/saas/v1", tags=["saas"])

# 관리자 시크릿 — 테넌트 발급 전용. API_TOKEN과 분리.
ADMIN_SECRET = os.environ.get("SAAS_ADMIN_SECRET", "saas-admin-dev-secret")

# ─── 과금 플랜 ──────────────────────────────────────────────────────────────
# Simplicity: 딕셔너리 한 곳에서 관리. 새 플랜은 이것만 수정.
PLANS: dict[str, dict] = {
    "free": {
        "monthly_limit": 100,        # 월 최대 평가 건수
        "price_per_unit": 0,         # 건당 과금 없음
        "monthly_fee": 0,            # 구독료 (원)
        "description": "무료 체험 — 월 100건",
    },
    "pro": {
        "monthly_limit": 5000,
        "price_per_unit": 500,       # 건당 500원
        "monthly_fee": 150_000,      # 월 구독 기본료 150,000원
        "description": "프로 — 월 5,000건 + 건당 500원",
    },
    "enterprise": {
        "monthly_limit": 0,          # 0 = 무제한
        "price_per_unit": 200,       # 협의 단가 예시
        "monthly_fee": 2_000_000,    # 월 2,000,000원 (별도 협약)
        "description": "엔터프라이즈 — 무제한 + 건당 200원",
    },
}


# ─── DDL ────────────────────────────────────────────────────────────────────

SAAS_DDL = """
-- 테넌트(고객사) 원장
CREATE TABLE IF NOT EXISTS saas_tenant (
    id          TEXT PRIMARY KEY,           -- TNT-xxxxxxxx
    name        TEXT NOT NULL UNIQUE,       -- 고객사명
    api_key_hash TEXT NOT NULL UNIQUE,      -- SHA-256(평문키). 평문 미저장.
    plan        TEXT NOT NULL DEFAULT 'free',
    status      TEXT NOT NULL DEFAULT 'active',  -- active|suspended|closed
    opt_in_data_contribution INTEGER NOT NULL DEFAULT 0,  -- 데이터 환류 동의 (0/1)
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_saas_tenant_key ON saas_tenant(api_key_hash);

-- 사용량·과금 원장 (불변 추가 전용)
CREATE TABLE IF NOT EXISTS saas_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   TEXT NOT NULL REFERENCES saas_tenant(id),
    endpoint    TEXT NOT NULL,
    billed_units INTEGER NOT NULL DEFAULT 1,
    cost        REAL NOT NULL DEFAULT 0,
    ts          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_usage_tenant ON saas_usage(tenant_id, ts);

-- 환류 데이터 기여 추적 (opt-in 동의 테넌트만)
-- 실제 데이터 저장 X — 익명 해시로 기여 이력만 기록 (개인정보·영업비밀 보호)
CREATE TABLE IF NOT EXISTS saas_data_contribution (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id   TEXT NOT NULL REFERENCES saas_tenant(id),
    asset_hash  TEXT NOT NULL,  -- SHA-256(region+collateral+claim 등 비식별 필드). 원본 없음.
    eval_type   TEXT,
    contributed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saas_contrib_tenant ON saas_data_contribution(tenant_id);
"""


def _init_saas_tables(conn: sqlite3.Connection):
    """SaaS 전용 테이블 초기화. init_db()와 독립적으로 호출 가능."""
    conn.executescript(SAAS_DDL)
    conn.commit()


def _ensure_tables(db):
    """엔드포인트 첫 호출 시 테이블이 없으면 생성. (lifespan hook 없이도 동작)"""
    _init_saas_tables(db)


# ─── 헬퍼 ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return _dt.datetime.utcnow().isoformat() + "Z"


def _month_prefix() -> str:
    """현재 연월 — 과금 집계 키. 예: '2026-06'"""
    return _dt.datetime.utcnow().strftime("%Y-%m")


def _hash_key(plain: str) -> str:
    return hashlib.sha256(plain.encode()).hexdigest()


def _gen_tenant_id() -> str:
    return "TNT-" + secrets.token_hex(6).upper()


def _gen_api_key() -> str:
    return "sk-npl-" + secrets.token_urlsafe(32)


def _asset_hash(inp: dict) -> str:
    """평가 입력에서 비식별 필드만 추출 → SHA-256. 원본 데이터 미보관."""
    sig = json.dumps({
        k: inp.get(k)
        for k in ("region_code", "collateral_type", "eval_type")
        if inp.get(k)
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(sig.encode()).hexdigest()[:32]


# ─── 인증 ────────────────────────────────────────────────────────────────────

def require_tenant(x_api_key: Optional[str] = Header(None), db=Depends(get_db)):
    """테넌트별 API 키 인증. 키 해시 매칭 → tenant row 반환.
    기존 require_token(main.py)과 완전 독립 — 내부 백오피스 ≠ 외부 SaaS.
    """
    _ensure_tables(db)
    if not x_api_key:
        raise HTTPException(401, "X-Api-Key 헤더가 없습니다")
    key_hash = _hash_key(x_api_key)
    row = db.execute(
        "SELECT * FROM saas_tenant WHERE api_key_hash=? AND status='active'",
        (key_hash,),
    ).fetchone()
    if not row:
        raise HTTPException(401, "유효하지 않은 API 키이거나 비활성 테넌트입니다")
    return dict(row)


def require_admin(x_admin_secret: Optional[str] = Header(None)):
    """관리자 전용 엔드포인트 보호."""
    if not x_admin_secret or x_admin_secret != ADMIN_SECRET:
        raise HTTPException(403, "관리자 인증 실패")


# ─── 과금 로직 ───────────────────────────────────────────────────────────────

def _month_usage(db, tenant_id: str, month: str | None = None) -> int:
    """해당 테넌트의 이번 달(또는 지정 월) 총 사용 건수."""
    m = month or _month_prefix()
    row = db.execute(
        "SELECT COALESCE(SUM(billed_units),0) c FROM saas_usage WHERE tenant_id=? AND ts LIKE ?",
        (tenant_id, f"{m}%"),
    ).fetchone()
    return int(row[0])


def record_usage(db, tenant: dict, endpoint: str, units: int = 1) -> dict:
    """사용량 기록 + 플랜 한도 체크. 한도 초과 시 HTTPException 429 발생.
    반환: {"ok": True, "cost": <float>}
    """
    plan = PLANS.get(tenant["plan"], PLANS["free"])
    limit = plan["monthly_limit"]

    if limit > 0:  # 0 = 무제한
        current = _month_usage(db, tenant["id"])
        if current + units > limit:
            raise HTTPException(
                429,
                f"월간 한도 초과 ({current}/{limit}건). 플랜 업그레이드가 필요합니다.",
            )

    cost = plan["price_per_unit"] * units
    db.execute(
        "INSERT INTO saas_usage (tenant_id, endpoint, billed_units, cost, ts) VALUES (?,?,?,?,?)",
        (tenant["id"], endpoint, units, cost, _now()),
    )
    db.commit()
    return {"ok": True, "cost": cost}


def billing_summary(db, tenant_id: str, month: str | None = None) -> dict:
    """월간 청구 요약 — 건수 + 금액 집계."""
    m = month or _month_prefix()
    plan_name = (
        db.execute("SELECT plan FROM saas_tenant WHERE id=?", (tenant_id,)).fetchone() or {}
    )
    plan_name = plan_name[0] if plan_name else "free"
    plan = PLANS.get(plan_name, PLANS["free"])

    row = db.execute(
        "SELECT COALESCE(SUM(billed_units),0) units, COALESCE(SUM(cost),0) cost "
        "FROM saas_usage WHERE tenant_id=? AND ts LIKE ?",
        (tenant_id, f"{m}%"),
    ).fetchone()
    total_units = int(row[0])
    usage_cost = float(row[1])
    total_cost = plan["monthly_fee"] + usage_cost

    return {
        "month": m,
        "plan": plan_name,
        "monthly_fee": plan["monthly_fee"],
        "billed_units": total_units,
        "usage_cost": usage_cost,
        "total_cost": total_cost,
        "limit": plan["monthly_limit"],
        "remaining": max(0, plan["monthly_limit"] - total_units) if plan["monthly_limit"] > 0 else None,
    }


# ─── 데이터 환류 ──────────────────────────────────────────────────────────────

def _record_contribution(db, tenant: dict, inp: dict, eval_type: str):
    """opt-in 동의 테넌트의 평가 데이터 기여 기록.
    실제 데이터 저장 없음 — 비식별 해시만 기록.
    T2: 약관 동의 없이 기여 기록 금지 (opt_in_data_contribution=1 확인).
    """
    if not tenant.get("opt_in_data_contribution"):
        return  # 동의 없으면 기록 생략
    ah = _asset_hash({**inp, "eval_type": eval_type})
    db.execute(
        "INSERT INTO saas_data_contribution (tenant_id, asset_hash, eval_type, contributed_at) VALUES (?,?,?,?)",
        (tenant["id"], ah, eval_type, _now()),
    )
    # commit은 record_usage와 함께 호출되므로 여기서는 생략 (caller가 commit)


# ─── Pydantic 스키마 ─────────────────────────────────────────────────────────

class TenantCreateIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="고객사명")
    plan: str = Field("free", pattern=r"^(free|pro|enterprise)$")
    opt_in_data_contribution: bool = Field(False, description="데이터 환류 동의 여부 (약관 동의 필수 — T2)")


class EvaluateIn(BaseModel):
    eval_type: str = Field("buy", pattern=r"^(buy|sell)$")
    # 매수 평가 필드
    claim: Optional[float] = None
    buy_price: Optional[float] = None
    appraisal: Optional[float] = None
    senior: Optional[float] = None
    tax: Optional[float] = None
    deposit: Optional[float] = None
    region_code: Optional[str] = None
    collateral_type: Optional[str] = None
    # 매도 평가 필드
    book_value: Optional[float] = None
    market_quote: Optional[float] = None
    provision_rate: Optional[float] = None
    carrying_monthly: Optional[float] = None
    # 건물대장/실거래/등기 보유 여부 → 신뢰도 가중치
    has_building: Optional[bool] = None
    has_realprice3: Optional[bool] = None
    has_registry: Optional[bool] = None
    has_defect: Optional[bool] = None


# ─── 엔드포인트 ──────────────────────────────────────────────────────────────

@router.post("/tenants", status_code=201)
def create_tenant(
    payload: TenantCreateIn,
    _=Depends(require_admin),
    db=Depends(get_db),
):
    """테넌트 발급 (관리자 전용).
    반환: api_key 평문 (이 응답 이후 다시 조회 불가 — 안전 보관 필수).
    """
    _ensure_tables(db)
    plain_key = _gen_api_key()
    key_hash = _hash_key(plain_key)
    tid = _gen_tenant_id()
    now = _now()

    existing = db.execute(
        "SELECT id FROM saas_tenant WHERE name=?", (payload.name,)
    ).fetchone()
    if existing:
        raise HTTPException(409, f"이미 존재하는 테넌트명: {payload.name}")

    db.execute(
        """INSERT INTO saas_tenant
               (id, name, api_key_hash, plan, status, opt_in_data_contribution, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (tid, payload.name, key_hash, payload.plan, "active",
         1 if payload.opt_in_data_contribution else 0, now, now),
    )
    db.commit()

    return {
        "tenant_id": tid,
        "name": payload.name,
        "plan": payload.plan,
        "api_key": plain_key,  # ← 평문 1회 반환. 이후 조회 불가.
        "warning": "이 키는 다시 조회할 수 없습니다. 즉시 안전한 곳에 저장하세요.",
        "opt_in_data_contribution": payload.opt_in_data_contribution,
        "created_at": now,
    }


@router.post("/tenants/{tenant_id}/rotate-key", summary="API 키 재발급 (관리자)")
def rotate_api_key(tenant_id: str, _=Depends(require_admin), db=Depends(get_db)):
    """기존 키를 무효화하고 새 키 발급. 키 유출 시 대응.
    반환: 새 api_key 평문 (1회만). 기존 키는 즉시 인증 실패.
    """
    _ensure_tables(db)
    row = db.execute("SELECT id, name FROM saas_tenant WHERE id=?", (tenant_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"테넌트 없음: {tenant_id}")
    new_key = _gen_api_key()
    new_hash = _hash_key(new_key)
    now = _now()
    db.execute(
        "UPDATE saas_tenant SET api_key_hash=?, updated_at=? WHERE id=?",
        (new_hash, now, tenant_id),
    )
    db.commit()
    return {
        "tenant_id": tenant_id,
        "name": row["name"],
        "api_key": new_key,  # ← 새 평문 1회 반환
        "warning": "기존 키는 즉시 무효화됨. 새 키를 안전하게 보관하세요.",
        "rotated_at": now,
    }


@router.delete("/tenants/{tenant_id}", summary="테넌트 비활성화/revoke (관리자)")
def revoke_tenant(tenant_id: str, _=Depends(require_admin), db=Depends(get_db)):
    """테넌트 비활성화 — 키 즉시 무효화(require_tenant가 status='active'만 통과).
    soft delete: 사용량 원장(saas_usage) 보존, 상태만 revoked로 전환.
    """
    _ensure_tables(db)
    row = db.execute("SELECT id FROM saas_tenant WHERE id=?", (tenant_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"테넌트 없음: {tenant_id}")
    now = _now()
    db.execute(
        "UPDATE saas_tenant SET status='revoked', updated_at=? WHERE id=?",
        (now, tenant_id),
    )
    db.commit()
    return {"tenant_id": tenant_id, "status": "revoked", "revoked_at": now}


@router.post("/evaluate")
def saas_evaluate(
    payload: EvaluateIn,
    tenant: dict = Depends(require_tenant),
    db=Depends(get_db),
):
    """NPL 매수/매도 평가 — 건당 과금.
    내부적으로 npl_scorer.evaluate_buy / evaluate_sell 호출.
    테넌트 격리: 결과 기록이나 데이터는 테넌트별로 독립 집계됨.
    데이터 환류: opt-in 동의 테넌트만 비식별 기여 기록.
    """
    inp = payload.model_dump(exclude_none=True)
    result = npl_scorer.evaluate(inp)
    if result is None:
        raise HTTPException(
            422,
            "평가에 필요한 필수값이 부족합니다. "
            "매수: claim + buy_price / 매도: book_value 또는 market_quote",
        )

    # 사용량 기록 + 과금 (한도 초과 시 429)
    usage = record_usage(db, tenant, endpoint="evaluate", units=1)

    # 데이터 환류 기여 기록 (opt-in만)
    _record_contribution(db, tenant, inp, result["eval_type"])
    if tenant.get("opt_in_data_contribution"):
        db.commit()  # contribution 함께 commit

    return {
        "tenant_id": tenant["id"],
        **result,
        "cost": usage["cost"],
    }


@router.get("/usage")
def saas_usage(
    month: Optional[str] = None,
    tenant: dict = Depends(require_tenant),
    db=Depends(get_db),
):
    """본인 테넌트 사용량 조회 (테넌트 격리 — 타 테넌트 데이터 차단).
    month 파라미터 없으면 이번 달. 형식: YYYY-MM
    """
    _ensure_tables(db)
    m = month or _month_prefix()
    rows = db.execute(
        "SELECT endpoint, billed_units, cost, ts FROM saas_usage "
        "WHERE tenant_id=? AND ts LIKE ? ORDER BY ts DESC LIMIT 200",
        (tenant["id"], f"{m}%"),
    ).fetchall()
    total_units = sum(r["billed_units"] for r in rows)
    total_cost = sum(r["cost"] for r in rows)
    return {
        "tenant_id": tenant["id"],
        "month": m,
        "total_units": total_units,
        "total_cost": total_cost,
        "records": [dict(r) for r in rows],
    }


@router.get("/billing")
def saas_billing(
    month: Optional[str] = None,
    tenant: dict = Depends(require_tenant),
    db=Depends(get_db),
):
    """월간 청구 요약 — 구독료 + 건당 과금 합산."""
    _ensure_tables(db)
    return billing_summary(db, tenant["id"], month)
