# Batch Queue — Phase 1 vs Phase 2 비교

## Phase 1 (현재) — In-Process FIFO + FastAPI BackgroundTasks

- 단일 프로세스, 메모리 큐 (deque)
- 동시 작업 한도: 3
- 자산 한도: 1000개 (1001+ rejected)
- 결과 저장: `data_raw/_brands/<brand_id>/runs/<job_id>.json`
- 진행률: SSE (StreamingResponse) + GET /jobs/{id} polling (5초 fallback)
- 외부 의존: 없음 (Python stdlib + FastAPI)

## Phase 2 트리거 (별도 이슈)

- 동시 일괄 평가 5개 이상
- 단일 작업 1000개 초과
- 서버 재시작 후 큐 복원 필요
- 멀티 호스트 분산

## Phase 2 — Redis + RQ

- redis 컨테이너 (Vultr 추가 ~$5/월)
- RQ worker 프로세스 분리
- 영속 큐 (Redis persistence)
- 인터페이스 (enqueue/get/list/SSE) Phase 1과 동일 — 호출 코드 변경 0

## 엔드포인트 목록

| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/v1/batch/enqueue` | 작업 등록 (1001+ → 413) |
| GET | `/api/v1/batch/jobs` | 목록 조회 (brand_id/status 필터) |
| GET | `/api/v1/batch/jobs/{job_id}` | 단일 작업 상태 |
| GET | `/api/v1/batch/jobs/{job_id}/events` | SSE 진행률 스트림 |
