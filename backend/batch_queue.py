"""backend/batch_queue.py
Phase 1 — in-process FIFO 큐 + 결과 저장 + 진행률 SSE.

Phase 2 트리거: 동시 작업 5개+ OR 단일 1000+ → Redis/RQ 전환.
인터페이스 (enqueue / get_status / stream_progress)는 동일 유지.
"""
import json
import threading
import uuid
import datetime
from pathlib import Path
from typing import Optional, Callable
from collections import deque

ROOT = Path(__file__).resolve().parent.parent
BRAND_RUNS_DIR = ROOT / "data_raw" / "_brands"

# 자산 한도
CLIENT_WORKER_MAX = 50         # 50 이하 = 클라이언트 직접 처리 권장
BACKEND_QUEUE_MIN = 51         # 51 이상부터 백엔드 큐
BACKEND_QUEUE_MAX = 1000       # 1000 초과 = Phase 2 Redis 필수

# 동시 작업 한도
MAX_CONCURRENT_JOBS = 3        # 동시 진행 최대 (Phase 2 = N 워커)


class BatchJob:
    """단일 일괄 평가 작업."""
    def __init__(self, brand_id: str, model_key: str, asset_ids: list, period: str = "current"):
        self.job_id = f"job-{uuid.uuid4().hex[:12]}"
        self.brand_id = brand_id
        self.model_key = model_key
        self.asset_ids = asset_ids
        self.period = period
        self.status = "queued"   # queued | running | done | failed | rejected
        self.progress = 0        # 0~100
        self.processed = 0
        self.total = len(asset_ids)
        self.results = []        # per-asset results
        self.error = None
        self.created_at = datetime.datetime.now().isoformat()
        self.started_at = None
        self.finished_at = None
        self._progress_listeners = []  # SSE listeners

    def to_dict(self):
        return {
            "job_id": self.job_id,
            "brand_id": self.brand_id,
            "model_key": self.model_key,
            "status": self.status,
            "progress": self.progress,
            "processed": self.processed,
            "total": self.total,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class BatchQueue:
    """Phase 1 — single-process queue. Singleton."""
    def __init__(self):
        self._jobs = {}  # job_id → BatchJob
        self._queue = deque()  # FIFO
        self._lock = threading.Lock()
        self._workers_active = 0
        self._stop_event = threading.Event()

    def enqueue(self, brand_id: str, model_key: str, asset_ids: list,
                period: str = "current") -> BatchJob:
        """일괄 작업 등록. 자산 수에 따라 처리 경로 결정."""
        n = len(asset_ids)
        job = BatchJob(brand_id, model_key, asset_ids, period)
        if n > BACKEND_QUEUE_MAX:
            job.status = "rejected"
            job.error = f"자산 {n}개 > {BACKEND_QUEUE_MAX} (Phase 2 Redis 필요)"
            self._jobs[job.job_id] = job
            return job
        # 50 이하도 백엔드 큐 수용 (클라이언트 직접 처리 권장이나 호환)
        with self._lock:
            self._jobs[job.job_id] = job
            self._queue.append(job)
        return job

    def get(self, job_id: str) -> Optional[BatchJob]:
        return self._jobs.get(job_id)

    def list_jobs(self, brand_id: Optional[str] = None,
                  status: Optional[str] = None) -> list:
        items = list(self._jobs.values())
        if brand_id:
            items = [j for j in items if j.brand_id == brand_id]
        if status:
            items = [j for j in items if j.status == status]
        return [j.to_dict() for j in items]

    def process_one(self, evaluator: Callable):
        """큐에서 1개 꺼내 처리. evaluator(asset_id, model_key) → result dict."""
        with self._lock:
            if not self._queue or self._workers_active >= MAX_CONCURRENT_JOBS:
                return None
            job = self._queue.popleft()
            self._workers_active += 1
        try:
            self._run_job(job, evaluator)
        finally:
            with self._lock:
                self._workers_active -= 1

    def _run_job(self, job: BatchJob, evaluator: Callable):
        job.status = "running"
        job.started_at = datetime.datetime.now().isoformat()
        try:
            for idx, asset_id in enumerate(job.asset_ids):
                if self._stop_event.is_set():
                    job.status = "failed"
                    job.error = "stop signal"
                    return
                try:
                    result = evaluator(asset_id, job.model_key)
                    job.results.append({"asset_id": asset_id, "result": result})
                except Exception as e:
                    job.results.append({"asset_id": asset_id, "error": str(e)})
                job.processed = idx + 1
                job.progress = int((job.processed / job.total) * 100)
                for listener in list(job._progress_listeners):
                    try:
                        listener(job.to_dict())
                    except Exception:
                        pass
            job.status = "done"
            self._persist(job)
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
        finally:
            job.finished_at = datetime.datetime.now().isoformat()

    def _persist(self, job: BatchJob):
        """결과를 brand별 디렉터리에 영속."""
        brand_dir = BRAND_RUNS_DIR / job.brand_id / "runs"
        brand_dir.mkdir(parents=True, exist_ok=True)
        out = brand_dir / f"{job.job_id}.json"
        out.write_text(json.dumps({
            **job.to_dict(),
            "asset_ids": job.asset_ids,
            "results": job.results,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def add_progress_listener(self, job_id: str, listener: Callable):
        job = self._jobs.get(job_id)
        if job:
            job._progress_listeners.append(listener)

    def remove_progress_listener(self, job_id: str, listener: Callable):
        job = self._jobs.get(job_id)
        if job and listener in job._progress_listeners:
            job._progress_listeners.remove(listener)


# Singleton
_queue_instance = None
_queue_lock = threading.Lock()


def get_queue() -> BatchQueue:
    global _queue_instance
    with _queue_lock:
        if _queue_instance is None:
            _queue_instance = BatchQueue()
        return _queue_instance


def mock_evaluator(asset_id: str, model_key: str) -> dict:
    """테스트용 mock — 실제는 모델별 호출자 주입."""
    return {"asset_id": asset_id, "model_key": model_key,
            "score": 50 + hash(asset_id) % 50, "status": "evaluated"}
