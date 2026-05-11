"""backend/main.py
TowninAlpafold Data SaaS 백오피스 API (Phase 1).

실행:
  uvicorn backend.main:app --reload --port 8000

인증:
  헤더 'X-API-Token: <env API_TOKEN>' 모든 보호 endpoint에 필수.
"""
import os
import sys
import json as _json
import datetime as _dt
import uuid
import asyncio
import fcntl
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional, List

# 프로젝트 루트를 sys.path에 추가 (utils 임포트용)
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException, Header, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.db import init_db, get_db
from backend.batch_queue import get_queue, mock_evaluator
from backend.whatif_api import router as whatif_router
from utils.manifest_repo import get_manifest_repo
from utils.model_review_queue import list_queue

API_TOKEN = os.environ.get("API_TOKEN", "dev-token-change-me")
APP_VERSION = "0.1.0-phase1"

# datasets.json 단일 진실 원본 경로
DATASETS_FILE = ROOT / "data_raw" / "_registry" / "datasets.json"


# ─── file-first 헬퍼 ───

def _load_datasets_file() -> list:
    """datasets.json에서 datasets 배열을 읽어 반환. 파일 없으면 []."""
    if not DATASETS_FILE.exists():
        return []
    with open(DATASETS_FILE, "r", encoding="utf-8") as f:
        data = _json.load(f)
    return data.get("datasets", [])


def _append_to_datasets_file(entry: dict) -> None:
    """datasets.json에 항목 1개를 원자적으로 append (LOCK_EX 직렬화)."""
    DATASETS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATASETS_FILE, "r+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            data = _json.load(f)
            datasets = data.get("datasets", [])
            datasets.append(entry)
            data["datasets"] = datasets
            f.seek(0)
            _json.dump(data, f, ensure_ascii=False, indent=2)
            f.truncate()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _remove_last_from_datasets_file(key: str) -> None:
    """POST 롤백: datasets.json에서 key 일치 항목 마지막 1건 제거."""
    if not DATASETS_FILE.exists():
        return
    with open(DATASETS_FILE, "r+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            data = _json.load(f)
            datasets = data.get("datasets", [])
            # 마지막 일치 항목만 제거
            for i in range(len(datasets) - 1, -1, -1):
                if datasets[i].get("key") == key:
                    datasets.pop(i)
                    break
            data["datasets"] = datasets
            f.seek(0)
            _json.dump(data, f, ensure_ascii=False, indent=2)
            f.truncate()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB 초기화."""
    init_db()
    yield


app = FastAPI(
    title="TowninAlpafold Data SaaS Backoffice",
    version=APP_VERSION,
    lifespan=lifespan,
)

# ISS-219: Reverse What-If 라우터 마운트
app.include_router(whatif_router)

# CORS — 정적 사이트(:3051) + Vultr 도메인 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3051",
        "https://towninalpafold.*.nip.io",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["X-API-Token", "Content-Type"],
)


def require_token(x_api_token: Optional[str] = Header(None)):
    """단일 토큰 인증 (Phase 1). Phase 2 = JWT."""
    if not x_api_token or x_api_token != API_TOKEN:
        raise HTTPException(401, "Invalid or missing X-API-Token")
    return True


# ─── Pydantic 스키마 ───

class DatasetIn(BaseModel):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]+$")
    ko: str
    source_org: str
    credentials: dict = {}
    schedule: dict = {}
    scope: dict = {}


class DatasetOut(BaseModel):
    id: int
    key: str
    ko: str
    source_org: str
    credentials: dict = {}
    schedule: dict = {}
    scope: dict = {}
    created_at: str
    # 파일-first 응답에만 포함되는 추가 필드 (DB에 없음)
    quality: dict = {}
    ops: dict = {}
    difficulty: dict = {}


class HealthOut(BaseModel):
    status: str
    version: str
    db: str
    manifest_backend: str


class BatchJobIn(BaseModel):
    brand_id: str
    model_key: str
    asset_ids: List[str]
    period: str = "current"


class BatchJobOut(BaseModel):
    job_id: str
    status: str = "queued"
    asset_count: int


# ─── Endpoints ───

@app.get("/health", response_model=HealthOut)
def health():
    """헬스 체크 — 인증 불필요."""
    return HealthOut(
        status="ok",
        version=APP_VERSION,
        db="sqlite",
        manifest_backend=os.environ.get("MANIFEST_BACKEND", "json"),
    )


@app.get("/api/v1/datasets")
def list_datasets(_=Depends(require_token), db=Depends(get_db)):
    """file-first: datasets.json 우선 반환. DB 카운트와 다르면 X-Sync-Drift: true 헤더."""
    file_items = _load_datasets_file()
    db_count = db.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]

    drift = len(file_items) != db_count
    result = []
    for idx, item in enumerate(file_items):
        result.append(DatasetOut(
            id=idx,  # 파일에는 id 없음 → 인덱스 대체
            key=item.get("key", ""),
            ko=item.get("ko", ""),
            source_org=item.get("source_org", ""),
            credentials=item.get("credentials", {}),
            schedule=item.get("schedule", {}),
            scope=item.get("scope", {}),
            quality=item.get("quality", {}),
            ops=item.get("ops", {}),
            difficulty=item.get("difficulty", {}),
            created_at=item.get("created_at", ""),
        ))

    headers = {}
    if drift:
        headers["X-Sync-Drift"] = "true"
    return JSONResponse(
        content=[r.model_dump() for r in result],
        headers=headers,
    )


@app.post("/api/v1/datasets", response_model=DatasetOut, status_code=201)
def register_dataset(payload: DatasetIn, _=Depends(require_token), db=Depends(get_db)):
    """file-first POST: 1) datasets.json append 2) SQLite insert. 한쪽 실패 시 롤백."""
    now = _dt.datetime.now().isoformat()
    entry = {
        "key": payload.key,
        "ko": payload.ko,
        "source_org": payload.source_org,
        "credentials": payload.credentials,
        "schedule": payload.schedule,
        "scope": payload.scope,
        "created_at": now,
    }

    # 1) 파일 먼저 append
    try:
        _append_to_datasets_file(entry)
    except Exception as e:
        raise HTTPException(500, f"File write failed: {e}")

    # 2) SQLite insert — 실패 시 파일 롤백
    try:
        cursor = db.execute(
            """INSERT INTO datasets (key, ko, source_org, credentials, schedule, scope, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (payload.key, payload.ko, payload.source_org,
             _json.dumps(payload.credentials, ensure_ascii=False),
             _json.dumps(payload.schedule, ensure_ascii=False),
             _json.dumps(payload.scope, ensure_ascii=False),
             now)
        )
        db.commit()
    except Exception as e:
        _remove_last_from_datasets_file(payload.key)  # 파일 롤백
        raise HTTPException(400, f"DB insert failed (file rolled back): {e}")

    return DatasetOut(
        id=cursor.lastrowid,
        key=payload.key,
        ko=payload.ko,
        source_org=payload.source_org,
        credentials=payload.credentials,
        schedule=payload.schedule,
        scope=payload.scope,
        created_at=now,
    )


@app.get("/api/v1/manifest/dong/{adm_cd}")
def get_dong_completion(adm_cd: str, _=Depends(require_token)):
    repo = get_manifest_repo()
    pct = repo.get_dong_completion(adm_cd)
    if pct is None:
        raise HTTPException(404, f"Dong {adm_cd} not in manifest")
    return {"adm_cd": adm_cd, "completion_pct": pct}


@app.post("/api/v1/batch/enqueue", response_model=BatchJobOut)
def batch_enqueue(payload: BatchJobIn, bg: BackgroundTasks, _=Depends(require_token)):
    """일괄 평가 큐 등록 (Phase 1 — in-process FIFO)."""
    q = get_queue()
    job = q.enqueue(payload.brand_id, payload.model_key, payload.asset_ids, payload.period)
    if job.status == "rejected":
        raise HTTPException(413, job.error)
    bg.add_task(q.process_one, mock_evaluator)
    return BatchJobOut(job_id=job.job_id, status=job.status, asset_count=len(payload.asset_ids))


@app.get("/api/v1/batch/jobs")
def list_batch_jobs(brand_id: Optional[str] = None, status: Optional[str] = None,
                    _=Depends(require_token)):
    """일괄 작업 목록 조회."""
    q = get_queue()
    return {"items": q.list_jobs(brand_id, status)}


@app.get("/api/v1/batch/jobs/{job_id}")
def get_batch_job(job_id: str, _=Depends(require_token)):
    """단일 작업 상태 조회."""
    q = get_queue()
    job = q.get(job_id)
    if not job:
        raise HTTPException(404, f"Job not found: {job_id}")
    return job.to_dict()


@app.get("/api/v1/batch/jobs/{job_id}/events")
async def stream_batch_progress(job_id: str, _=Depends(require_token)):
    """SSE — 진행률 스트림. 5초 polling fallback 클라이언트는 GET /jobs/{job_id}."""
    q = get_queue()
    job = q.get(job_id)
    if not job:
        raise HTTPException(404, f"Job not found: {job_id}")

    async def gen():
        while True:
            yield f"data: {_json.dumps(job.to_dict(), ensure_ascii=False)}\n\n"
            if job.status in ("done", "failed", "rejected"):
                break
            await asyncio.sleep(1)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/v1/models/review-queue")
def get_review_queue(status: Optional[str] = None, _=Depends(require_token)):
    items = list_queue(status)
    return {"count": len(items), "items": items}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
