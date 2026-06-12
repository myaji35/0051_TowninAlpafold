"""backend/npl_api.py
NPL 포트폴리오 API — 5만 건 규모. 참조: docs/npl-portfolio-architecture.md §3

엔드포인트:
  POST   /api/v1/npl/assets               물건 1건 등록 (개별 입력)
  POST   /api/v1/npl/assets/import        CSV 일괄 (행별 평가)
  GET    /api/v1/npl/assets               목록 (페이지네이션 + 필터)
  GET    /api/v1/npl/assets/{id}          단건 + 평가 상세
  GET    /api/v1/npl/assets/{id}/comparable   모집단 백분위 (객관성 ③)
  GET    /api/v1/npl/portfolio/summary    집계 (등급분포/총회수cone/평균신뢰도)
  GET    /api/v1/npl/portfolio/distribution   분포 히스토그램 (백분위 시각화)

인증: main.py의 require_token에 의존 (Depends 주입).
"""
from __future__ import annotations

import csv
import io
import json
import datetime as _dt
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from pydantic import BaseModel, Field

from backend.db import get_db
from backend import npl_scorer

router = APIRouter(prefix="/api/v1/npl", tags=["npl"])

# 동급 비교 키로 쓰는 평가-무관 메타 + 원본 입력 컬럼
_RAW_KEYS = (
    "claim", "buy_price", "appraisal", "senior", "tax", "deposit",
    "book_value", "market_quote", "provision_rate", "carrying_monthly", "recovery_months",
)


def _now():
    return _dt.datetime.utcnow().isoformat() + "Z"


def _gen_id():
    return "NPL-" + uuid.uuid4().hex[:12].upper()


def _persist(db, asset: dict) -> dict:
    """입력 dict → 평가 → npl_assets upsert. 평가 실패(필수값 부족) 시 ValueError."""
    result = npl_scorer.evaluate(asset)
    if result is None:
        raise ValueError("필수값 부족 (매수: claim+buy_price / 매도: book_value or market_quote)")

    aid = asset.get("id") or _gen_id()
    raw = {k: asset.get(k) for k in _RAW_KEYS if asset.get(k) is not None}
    now = _now()
    db.execute(
        """INSERT INTO npl_assets
           (id, portfolio_id, eval_type, address, collateral_type, region_code,
            score_irr, score_npv, grade, recovery_p10, recovery_p50, recovery_p90,
            confidence, raw_input, source, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
            eval_type=excluded.eval_type, score_irr=excluded.score_irr,
            score_npv=excluded.score_npv, grade=excluded.grade,
            recovery_p10=excluded.recovery_p10, recovery_p50=excluded.recovery_p50,
            recovery_p90=excluded.recovery_p90, confidence=excluded.confidence,
            raw_input=excluded.raw_input, updated_at=excluded.updated_at""",
        (aid, asset.get("portfolio_id"), result["eval_type"], asset.get("address"),
         asset.get("collateral_type"), asset.get("region_code"),
         result.get("score_irr"), result.get("score_npv"), result["grade"],
         result["recovery_p10"], result["recovery_p50"], result["recovery_p90"],
         result["confidence"], json.dumps(raw, ensure_ascii=False),
         asset.get("source", "manual"), now, now),
    )
    db.commit()
    return {"id": aid, **result}


# ─── Pydantic ───

class NplAssetIn(BaseModel):
    id: Optional[str] = None
    portfolio_id: Optional[str] = None
    eval_type: str = Field("buy", pattern=r"^(buy|sell)$")
    address: Optional[str] = None
    collateral_type: Optional[str] = None
    region_code: Optional[str] = None
    # 평가 입력 (eval_type에 따라 일부만)
    claim: Optional[float] = None
    buy_price: Optional[float] = None
    appraisal: Optional[float] = None
    senior: Optional[float] = None
    tax: Optional[float] = None
    deposit: Optional[float] = None
    book_value: Optional[float] = None
    market_quote: Optional[float] = None
    provision_rate: Optional[float] = None
    carrying_monthly: Optional[float] = None
    source: str = "manual"


# ─── 엔드포인트 ───

@router.post("/assets", status_code=201)
def register_asset(payload: NplAssetIn, db=Depends(get_db)):
    try:
        return _persist(db, payload.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/assets/import")
async def import_csv(file: UploadFile = File(...), db=Depends(get_db)):
    """CSV 일괄 임포트. 헤더는 NplAssetIn 필드명. 행별 평가, 결측 행 skip."""
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    ok, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, 1):
        clean = {k: v for k, v in row.items() if v not in ("", None)}
        # 숫자 필드 형변환
        for k in _RAW_KEYS:
            if k in clean:
                try:
                    clean[k] = float(clean[k])
                except (ValueError, TypeError):
                    clean.pop(k)
        clean["source"] = "csv"
        try:
            _persist(db, clean)
            ok += 1
        except ValueError:
            skipped += 1
            if len(errors) < 20:
                errors.append({"row": i, "reason": "필수값 부족"})
    return {"imported": ok, "skipped": skipped, "errors": errors}


@router.get("/assets")
def list_assets(
    db=Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    grade: Optional[str] = None,
    collateral_type: Optional[str] = None,
    region_code: Optional[str] = None,
    portfolio_id: Optional[str] = None,
    eval_type: Optional[str] = None,
):
    where, params = [], []
    for col, val in (("grade", grade), ("collateral_type", collateral_type),
                     ("region_code", region_code), ("portfolio_id", portfolio_id),
                     ("eval_type", eval_type)):
        if val:
            where.append(f"{col}=?")
            params.append(val)
    wsql = (" WHERE " + " AND ".join(where)) if where else ""
    total = db.execute(f"SELECT COUNT(*) c FROM npl_assets{wsql}", params).fetchone()["c"]
    rows = db.execute(
        f"SELECT * FROM npl_assets{wsql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    ).fetchall()
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str, db=Depends(get_db)):
    row = db.execute("SELECT * FROM npl_assets WHERE id=?", (asset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "물건 없음")
    d = dict(row)
    d["raw_input"] = json.loads(d.get("raw_input") or "{}")
    return d


@router.get("/assets/{asset_id}/comparable")
def comparable(asset_id: str, db=Depends(get_db)):
    """객관성 ③ — 이 물건이 전체/동급 모집단에서 상위 몇 %인가."""
    row = db.execute("SELECT * FROM npl_assets WHERE id=?", (asset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "물건 없음")
    r = dict(row)
    metric = "score_irr" if r["eval_type"] == "buy" else "score_npv"
    val = r[metric]
    if val is None:
        return {"percentile_all": None, "percentile_peer": None}

    total_all = db.execute("SELECT COUNT(*) c FROM npl_assets WHERE eval_type=?", (r["eval_type"],)).fetchone()["c"]
    below_all = db.execute(
        f"SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND {metric} < ?",
        (r["eval_type"], val)).fetchone()["c"]
    pct_all = round(below_all / (total_all - 1) * 100) if total_all > 1 else 50

    peer_total = db.execute(
        "SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND collateral_type IS ? AND region_code IS ?",
        (r["eval_type"], r["collateral_type"], r["region_code"])).fetchone()["c"]
    peer_below = db.execute(
        f"SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND collateral_type IS ? AND region_code IS ? AND {metric} < ?",
        (r["eval_type"], r["collateral_type"], r["region_code"], val)).fetchone()["c"]
    pct_peer = round(peer_below / (peer_total - 1) * 100) if peer_total > 1 else None

    return {
        "metric": metric, "value": val,
        "percentile_all": pct_all, "total_all": total_all,
        "percentile_peer": pct_peer, "peer_total": peer_total,
        "peer_key": {"collateral_type": r["collateral_type"], "region_code": r["region_code"]},
    }


@router.get("/portfolio/summary")
def portfolio_summary(db=Depends(get_db), portfolio_id: Optional[str] = None):
    where, params = (" WHERE portfolio_id=?", [portfolio_id]) if portfolio_id else ("", [])
    total = db.execute(f"SELECT COUNT(*) c FROM npl_assets{where}", params).fetchone()["c"]
    grades = {r["grade"]: r["c"] for r in db.execute(
        f"SELECT grade, COUNT(*) c FROM npl_assets{where} GROUP BY grade", params).fetchall()}
    agg = db.execute(
        f"""SELECT AVG(confidence) conf, SUM(recovery_p10) p10,
                   SUM(recovery_p50) p50, SUM(recovery_p90) p90 FROM npl_assets{where}""",
        params).fetchone()
    return {
        "total": total,
        "grade_distribution": {g: grades.get(g, 0) for g in ("very_high", "high", "medium", "low")},
        "total_recovery_cone": {"p10": agg["p10"] or 0, "p50": agg["p50"] or 0, "p90": agg["p90"] or 0},
        "avg_confidence": round(agg["conf"], 3) if agg["conf"] else None,
    }


@router.get("/portfolio/distribution")
def portfolio_distribution(db=Depends(get_db), metric: str = "irr", bins: int = 20):
    """분포 히스토그램 — 백분위 시각화용. metric=irr|npv."""
    col = "score_irr" if metric == "irr" else "score_npv"
    rows = db.execute(f"SELECT {col} v FROM npl_assets WHERE {col} IS NOT NULL").fetchall()
    vals = [r["v"] for r in rows]
    if not vals:
        return {"metric": metric, "bins": [], "count": 0}
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1
    hist = [0] * bins
    for v in vals:
        idx = min(bins - 1, int((v - lo) / span * bins))
        hist[idx] += 1
    return {
        "metric": metric, "count": len(vals), "min": lo, "max": hi,
        "bins": [{"lo": lo + span * i / bins, "hi": lo + span * (i + 1) / bins, "count": hist[i]}
                 for i in range(bins)],
    }
