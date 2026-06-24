"""backend/npl_api.py
NPL 포트폴리오 API — 5만 건 규모. 참조: docs/npl-portfolio-architecture.md §3

엔드포인트:
  POST   /api/v1/npl/assets               물건 1건 등록 (개별 입력)
  POST   /api/v1/npl/assets/import        CSV 일괄 (동기, 결과 즉시 반환)
  POST   /api/v1/npl/assets/import/stream CSV 일괄 + 진행률 SSE 스트림
  GET    /api/v1/npl/assets               목록 (페이지네이션 + 필터 + irr 구간)
  GET    /api/v1/npl/assets/{id}          단건 + 평가 상세
  GET    /api/v1/npl/assets/{id}/comparable   모집단 백분위 (객관성 ③)
  GET    /api/v1/npl/assets/{id}/report   단일 물건 리포트 데이터
  GET    /api/v1/npl/portfolio/summary    집계 (등급분포/총회수cone/평균신뢰도)
  GET    /api/v1/npl/portfolio/distribution   분포 히스토그램 (백분위 시각화)
  GET    /api/v1/npl/portfolio/report     포트폴리오 전체 리포트 데이터

인증: main.py의 require_token에 의존 (Depends 주입).
"""
from __future__ import annotations

import csv
import io
import json
import time
import datetime as _dt
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.db import get_db
from backend import npl_scorer

# ─── 인메모리 집계 캐시
# {cache_key: {"data":..., "ts":float, "version":(cnt, maxrowid)}}
# TTL 60초 + 자산 버전(COUNT+MAX rowid) 2중 무효화.
# 멀티프로세스: workers>1 이면 프로세스별 독립 캐시(공유X).
# 워커별 miss→fetch→store, TTL 내 수렴 — 허용된 stale.
_CACHE: dict = {}
_CACHE_TTL = 60  # 초


def _asset_version(db) -> tuple[int, int]:
    """(COUNT, MAX rowid) — 삽입/갱신 감지. 집계보다 저렴."""
    row = db.execute(
        "SELECT COUNT(*) cnt, COALESCE(MAX(rowid), 0) mxr "
        "FROM npl_assets"
    ).fetchone()
    return (row["cnt"], row["mxr"])


def _cache_get(key: str, db):
    """hit → (data, True), miss → (None, False)."""
    entry = _CACHE.get(key)
    if entry is None:
        return None, False
    if time.time() - entry["ts"] > _CACHE_TTL:
        return None, False
    if _asset_version(db) != entry["version"]:
        return None, False
    return entry["data"], True


def _cache_set(key: str, data, db):
    _CACHE[key] = {
        "data": data, "ts": time.time(),
        "version": _asset_version(db),
    }

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
    irr_min: Optional[float] = None,
    irr_max: Optional[float] = None,
):
    where, params = [], []
    for col, val in (("grade", grade), ("collateral_type", collateral_type),
                     ("region_code", region_code), ("portfolio_id", portfolio_id),
                     ("eval_type", eval_type)):
        if val:
            where.append(f"{col}=?")
            params.append(val)
    # IRR 구간 필터 (score_irr 인덱스 활용)
    if irr_min is not None:
        where.append("score_irr >= ?")
        params.append(irr_min)
    if irr_max is not None:
        where.append("score_irr <= ?")
        params.append(irr_max)
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
        "SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND collateral_type IS ? "
        f"AND region_code IS ? AND {metric} < ?",
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
    cache_key = f"summary:{portfolio_id}"
    cached, hit = _cache_get(cache_key, db)
    if hit:
        return {**cached, "_cache": {"hit": True, "ttl_sec": _CACHE_TTL}}

    where, params = (" WHERE portfolio_id=?", [portfolio_id]) if portfolio_id else ("", [])
    total = db.execute(f"SELECT COUNT(*) c FROM npl_assets{where}", params).fetchone()["c"]
    grades = {r["grade"]: r["c"] for r in db.execute(
        f"SELECT grade, COUNT(*) c FROM npl_assets{where} GROUP BY grade", params).fetchall()}
    agg = db.execute(
        f"""SELECT AVG(confidence) conf, SUM(recovery_p10) p10,
                   SUM(recovery_p50) p50, SUM(recovery_p90) p90 FROM npl_assets{where}""",
        params).fetchone()
    result = {
        "total": total,
        "grade_distribution": {g: grades.get(g, 0) for g in ("very_high", "high", "medium", "low")},
        "total_recovery_cone": {"p10": agg["p10"] or 0, "p50": agg["p50"] or 0, "p90": agg["p90"] or 0},
        "avg_confidence": round(agg["conf"], 3) if agg["conf"] else None,
    }
    _cache_set(cache_key, result, db)
    return {**result, "_cache": {"hit": False, "ttl_sec": _CACHE_TTL}}


@router.get("/portfolio/distribution")
def portfolio_distribution(db=Depends(get_db), metric: str = "irr", bins: int = 20):
    """분포 히스토그램 — 백분위 시각화용. metric=irr|npv."""
    cache_key = f"dist:{metric}:{bins}"
    cached, hit = _cache_get(cache_key, db)
    if hit:
        return {**cached, "_cache": {"hit": True, "ttl_sec": _CACHE_TTL}}

    col = "score_irr" if metric == "irr" else "score_npv"
    rows = db.execute(f"SELECT {col} v FROM npl_assets WHERE {col} IS NOT NULL").fetchall()
    vals = [r["v"] for r in rows]
    if not vals:
        return {"metric": metric, "bins": [], "count": 0, "_cache": {"hit": False, "ttl_sec": _CACHE_TTL}}
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1
    hist = [0] * bins
    for v in vals:
        idx = min(bins - 1, int((v - lo) / span * bins))
        hist[idx] += 1
    result = {
        "metric": metric, "count": len(vals), "min": lo, "max": hi,
        "bins": [{"lo": lo + span * i / bins, "hi": lo + span * (i + 1) / bins, "count": hist[i]}
                 for i in range(bins)],
    }
    _cache_set(cache_key, result, db)
    return {**result, "_cache": {"hit": False, "ttl_sec": _CACHE_TTL}}


@router.post("/assets/import/stream")
async def import_csv_stream(file: UploadFile = File(...), db=Depends(get_db)):
    """CSV 일괄 임포트 + 진행률 SSE 스트림.
    Accept: text/event-stream 으로 요청하면 행별 진행률을 스트리밍한다.
    각 이벤트: {"row": N, "total": M, "ok": K, "skipped": J, "done": false}
    마지막 이벤트: {"done": true, "imported": K, "skipped": J, "errors": [...]}
    """
    content = (await file.read()).decode("utf-8-sig")
    lines = list(csv.DictReader(io.StringIO(content)))
    total = len(lines)

    async def gen():
        ok, skipped, errors = 0, 0, []
        for i, row in enumerate(lines, 1):
            clean = {k: v for k, v in row.items() if v not in ("", None)}
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
            # 10행마다 또는 마지막 행에서 진행률 이벤트 발행
            if i % 10 == 0 or i == total:
                event = json.dumps(
                    {"row": i, "total": total, "ok": ok, "skipped": skipped, "done": False},
                    ensure_ascii=False,
                )
                yield f"data: {event}\n\n"
        # 완료 이벤트
        final = json.dumps(
            {"done": True, "imported": ok, "skipped": skipped, "errors": errors},
            ensure_ascii=False,
        )
        yield f"data: {final}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/assets/{asset_id}/report")
def asset_report(asset_id: str, db=Depends(get_db)):
    """단일 물건 리포트 데이터 — 평가 전체 + 백분위 + 입력 원본.
    report-pdf-builder 연동 시 이 엔드포인트가 데이터 소스.
    """
    row = db.execute("SELECT * FROM npl_assets WHERE id=?", (asset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "물건 없음")
    d = dict(row)
    d["raw_input"] = json.loads(d.get("raw_input") or "{}")

    # 백분위 (comparable 로직 인라인 — 별도 DB 호출 재사용)
    metric = "score_irr" if d["eval_type"] == "buy" else "score_npv"
    val = d[metric]
    if val is not None:
        total_all = db.execute(
            "SELECT COUNT(*) c FROM npl_assets WHERE eval_type=?", (d["eval_type"],)
        ).fetchone()["c"]
        below_all = db.execute(
            f"SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND {metric} < ?",
            (d["eval_type"], val),
        ).fetchone()["c"]
        pct_all = round(below_all / (total_all - 1) * 100) if total_all > 1 else 50

        peer_total = db.execute(
            "SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND collateral_type IS ? AND region_code IS ?",
            (d["eval_type"], d["collateral_type"], d["region_code"]),
        ).fetchone()["c"]
        peer_below = db.execute(
            "SELECT COUNT(*) c FROM npl_assets WHERE eval_type=? AND collateral_type IS ? "
            f"AND region_code IS ? AND {metric} < ?",
            (d["eval_type"], d["collateral_type"], d["region_code"], val),
        ).fetchone()["c"]
        pct_peer = round(peer_below / (peer_total - 1) * 100) if peer_total > 1 else None
        d["percentile"] = {
            "metric": metric, "percentile_all": pct_all, "total_all": total_all,
            "percentile_peer": pct_peer, "peer_total": peer_total,
        }
    else:
        d["percentile"] = None

    return d


@router.get("/portfolio/report")
def portfolio_report(db=Depends(get_db), portfolio_id: Optional[str] = None, top_n: int = 10):
    """포트폴리오 전체 리포트 데이터.
    summary + 분포 히스토그램 + Top/Bottom N + 신뢰도 분포.
    report-pdf-builder 연동 시 이 엔드포인트가 데이터 소스.
    """
    where, params = (" WHERE portfolio_id=?", [portfolio_id]) if portfolio_id else ("", [])

    # 집계
    total = db.execute(f"SELECT COUNT(*) c FROM npl_assets{where}", params).fetchone()["c"]
    grades = {r["grade"]: r["c"] for r in db.execute(
        f"SELECT grade, COUNT(*) c FROM npl_assets{where} GROUP BY grade", params,
    ).fetchall()}
    agg = db.execute(
        f"""SELECT AVG(confidence) conf, SUM(recovery_p10) p10,
                   SUM(recovery_p50) p50, SUM(recovery_p90) p90 FROM npl_assets{where}""",
        params,
    ).fetchone()

    # IRR 분포 (buy 물건만)
    irr_where = (where + " AND eval_type='buy'") if where else " WHERE eval_type='buy'"
    irr_params = params if where else []
    irr_rows = db.execute(
        f"SELECT score_irr v FROM npl_assets{irr_where} AND score_irr IS NOT NULL", irr_params,
    ).fetchall()
    irr_vals = [r["v"] for r in irr_rows]

    # Top/Bottom N (IRR 기준 buy)
    _cols = "SELECT id, address, grade, score_irr, confidence FROM npl_assets"
    top_rows = db.execute(
        f"{_cols}{irr_where} AND score_irr IS NOT NULL ORDER BY score_irr DESC LIMIT ?",
        irr_params + [top_n],
    ).fetchall()
    bottom_rows = db.execute(
        f"{_cols}{irr_where} AND score_irr IS NOT NULL ORDER BY score_irr ASC LIMIT ?",
        irr_params + [top_n],
    ).fetchall()

    # 낮은 신뢰도 물건 (추가실사 필요)
    low_conf_where = (where + " AND confidence < 0.5") if where else " WHERE confidence < 0.5"
    low_conf = db.execute(
        f"SELECT COUNT(*) c FROM npl_assets{low_conf_where}", params,
    ).fetchone()["c"]

    return {
        "generated_at": _now(),
        "portfolio_id": portfolio_id,
        "summary": {
            "total": total,
            "grade_distribution": {g: grades.get(g, 0) for g in ("very_high", "high", "medium", "low")},
            "total_recovery_cone": {
                "p10": agg["p10"] or 0, "p50": agg["p50"] or 0, "p90": agg["p90"] or 0,
            },
            "avg_confidence": round(agg["conf"], 3) if agg["conf"] else None,
            "low_confidence_count": low_conf,
        },
        "irr_distribution": {
            "count": len(irr_vals),
            "mean": round(sum(irr_vals) / len(irr_vals), 4) if irr_vals else None,
            "min": min(irr_vals) if irr_vals else None,
            "max": max(irr_vals) if irr_vals else None,
        },
        "top_assets": [dict(r) for r in top_rows],
        "bottom_assets": [dict(r) for r in bottom_rows],
    }
