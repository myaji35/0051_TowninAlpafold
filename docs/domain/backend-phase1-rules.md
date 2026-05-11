# Backend Phase 1 — 도메인 규칙 명세

분석 기준: 2026-05-04  
범위: `backend/main.py` / `backend/db.py` / `backend/batch_queue.py` / `backend/.env.example`

---

## 1. 도메인 규칙

| # | 규칙 | 코드 위치 | 위반 시 영향 |
|---|------|-----------|------------|
| R-01 | 데이터셋 `key`는 전역 UNIQUE. 중복 등록 즉시 실패 | `db.py:30` (UNIQUE NOT NULL), `main.py:142` INSERT | HTTP 400 반환, 기존 row 보존 |
| R-02 | `key` 형식: 소문자 알파벳 시작 + 소문자·숫자·`_` 조합 (`^[a-z][a-z0-9_]+$`) | `main.py:73` (Pydantic Field pattern) | HTTP 422 반환, 등록 거부 |
| R-03 | 모든 보호 엔드포인트는 `X-API-Token` 헤더 필수. `/health`만 예외 | `main.py:63-67` (`require_token` Depends) | HTTP 401 반환 |
| R-04 | `API_TOKEN` 환경변수 미설정 시 기본값 `"dev-token-change-me"` 로 기동 — 프로덕션 보안 위험 | `main.py:34` | 기본값 노출 시 인증 무의미 |
| R-05 | 자산 수 > 1000인 배치는 즉시 `rejected`. Phase 2 Redis 필요 | `batch_queue.py:76-79` | HTTP 413 반환, job은 저장되나 처리 안 됨 |
| R-06 | 동시 처리 중인 배치 작업은 최대 3개. 초과 enqueue는 큐에 대기 | `batch_queue.py:24`, `process_one:102` | 추가 작업은 큐잉만, 즉시 처리 없음 |
| R-07 | 배치 결과는 `data_raw/_brands/{brand_id}/runs/{job_id}.json` 에 영속. 삭제/만료 정책 없음 | `batch_queue.py:141-150` | 디스크 누적 무한 증가 |
| R-08 | 배치 큐 상태는 in-process 메모리 한정. 프로세스 재시작 시 모든 큐·진행 상태 소멸 | `batch_queue.py:64-69` | 재시작 후 jobs 조회 불가 (done만 파일로 복구 가능) |
| R-09 | `datasets` 테이블에 `updated_at` 컬럼 존재하나 갱신 로직 없음. UPDATE 엔드포인트 미존재 | `db.py:37`, `main.py` (PUT 없음) | 등록 후 수정 불가 — 삭제 후 재등록만 가능 |
| R-10 | CORS는 `localhost:3051`과 `towninalpafold.*.nip.io` 만 허용 | `main.py:54-58` | 다른 오리진 프리플라이트 실패 |

---

## 2. 역할별 시나리오

### admin (시스템 전체 관리자)

**S-A1: 데이터셋 등록**
1. `POST /api/v1/datasets` — `X-API-Token` 헤더 포함
2. `key`: `^[a-z][a-z0-9_]+$` 형식 필수
3. 중복 key면 400. 성공 시 `id` + `created_at` 반환
4. `GET /api/v1/datasets` 로 등록 확인

**S-A2: 토큰 확인 / 변경 (현재 제한)**
1. `API_TOKEN` 환경변수를 `.env` 에서 직접 수정
2. 프로세스 재시작 필요 — 엔드포인트 없음 (CRITICAL GAP C-01)
3. 변경 이력 없음 (audit log 없음)

**S-A3: 배치 큐 모니터**
1. `GET /api/v1/batch/jobs` — 전체 또는 `brand_id`/`status` 필터
2. `GET /api/v1/batch/jobs/{job_id}` — 단일 작업 상태
3. `GET /api/v1/batch/jobs/{job_id}/events` — SSE 진행률 스트림
4. 큐 길이·대기열 전체 상태 조회 API 없음 (MAJOR GAP)

---

### operator (배치 평가 실행 담당자)

**S-O1: 배치 enqueue**
1. `POST /api/v1/batch/enqueue` — `brand_id`, `model_key`, `asset_ids[]`, `period` 전송
2. `asset_ids` 0개면 `total=0`으로 큐에 등록됨 — 빈 작업 허용 (엣지 케이스 E-04)
3. 1~1000개: 정상 큐잉, `job_id` 반환
4. 1001개+: 즉시 413

**S-O2: 결과 확인**
1. `GET /api/v1/batch/jobs/{job_id}` — `status`, `progress`, `processed/total` 확인
2. `status: done` 이후 per-asset 결과는 API 미노출 — 파일에만 저장 (MAJOR GAP)
3. SSE 종료 후 결과 재조회 방법 없음

**S-O3: 실패 재시도**
1. `status: failed` 확인 후 동일 payload로 재 enqueue
2. 자동 재시도 로직 없음 — 수동 재호출 필요 (C-02)
3. stop signal로 실패한 작업은 파일 미저장 (line 118-120)

---

### guest (읽기 전용 / 외부 모니터링)

**S-G1: 헬스 확인**
1. `GET /health` — 토큰 없이 접근 가능
2. `{"status":"ok","version":"0.1.0-phase1","db":"sqlite","manifest_backend":"json"}` 반환
3. DB 연결 실패 시 500 (헬스 체크 자체는 DB 호출 없음 — 실제 연결 검증 없는 정적 응답)

**S-G2: 쓰기 차단 검증**
1. `POST /api/v1/datasets` — 토큰 없이 → HTTP 401
2. `POST /api/v1/batch/enqueue` — 토큰 없이 → HTTP 401
3. `/api/v1/*` 전체 — 토큰 없이 모두 401 반환 (R-03 준수)

---

## 3. CRITICAL 갭

| ID | 갭 설명 | 등급 | 다음 이슈 제안 |
|----|---------|------|--------------|
| C-01 | **토큰 회전 엔드포인트 없음**. 프로세스 재시작 없이 토큰 갱신 불가. 유출 시 즉각 대응 수단 없음 | P0 | `FIX_BUG: POST /api/v1/auth/rotate-token` 또는 Phase 2 JWT 연계 |
| C-02 | **배치 실패 자동 재시도 없음**. 네트워크 일시 오류·평가기 예외 시 수동 재enqueue 필요 | P1 | `FEATURE_PLAN: 지수 백오프 재시도 (최대 3회)` |
| C-03 | **audit log 없음**. 데이터셋 등록·배치 실행 이력을 추적할 수단 없음. 규정 준수·디버깅 불가 | P1 | `FEATURE_PLAN: 요청별 audit 로그 (파일 or DB 테이블)` |
| C-04 | **배치 결과 per-asset API 미노출**. `done` 상태에서 `results[]`를 API로 조회할 방법 없음. 파일 직접 접근만 가능 | P1 | `FIX_BUG: GET /api/v1/batch/jobs/{job_id}/results` 추가 |
| C-05 | **datasets UPDATE/DELETE 없음**. 등록 후 수정·삭제 불가. `updated_at` 컬럼도 빈 채 방치 | P2 | `FEATURE_PLAN: PUT/DELETE /api/v1/datasets/{id}` |
| C-06 | **헬스 체크 실제 DB 연결 미검증**. `/health`는 DB 없이도 200 반환 → 장애 탐지 불가 | P2 | `FIX_BUG: health에 SELECT 1 probe 추가` |
| C-07 | **배치 결과 retention 정책 없음**. `data_raw/_brands/` 파일 무한 누적. 디스크 고갈 위험 | P2 | `FEATURE_PLAN: 30일 TTL or 수동 purge API` |

---

## 4. 엣지 케이스

| ID | 케이스 | 현재 동작 | 위험도 |
|----|--------|----------|-------|
| E-01 | **동시 등록 race condition** — 두 요청이 동시에 같은 `key` POST | SQLite UNIQUE 제약으로 한쪽이 400 반환. WAL 모드라 쓰기 직렬화됨. 안전. | LOW |
| E-02 | **중복 key** — 이미 존재하는 `key` 재등록 | `sqlite3.IntegrityError` 잡혀 HTTP 400 반환. 기존 row 보존. | LOW |
| E-03 | **asset 정확히 1000개** — 한도 경계값 | `n > 1000` 조건이므로 1000개는 정상 큐잉됨 (`batch_queue.py:76`). | LOW |
| E-04 | **빈 asset_ids (`[]`)** — 0개 배치 enqueue | `total=0`, `progress=100`(루프 미진입), `status=done` 즉시. 파일 저장됨. 클라이언트 혼란 가능. | MEDIUM |
| E-05 | **API_TOKEN 환경변수 미설정** — 기본값 `"dev-token-change-me"` 사용 | 서버 기동은 정상. 헤더에 기본값 전송 시 인증 통과 → 프로덕션 보안 사고 위험 | HIGH |

---

## 5. 다음 검증 권고

BIZ_VALIDATE / SCENARIO_PLAY 호출 시 아래 시나리오 ID를 payload에 포함할 것:

| 시나리오 ID | 유형 | 검증 포인트 |
|------------|------|------------|
| `S-A1` | 정상 플로우 | 데이터셋 등록 → 목록 조회 일치 |
| `S-A2` | CRITICAL GAP | 토큰 미변경 시 프로덕션 노출 재현 |
| `S-O1` | 경계값 | asset_ids 1000개 정상 / 1001개 413 |
| `S-O2` | CRITICAL GAP | done 후 results API 조회 불가 확인 |
| `S-O3` | 재시도 | 실패 작업 수동 재enqueue 성공 확인 |
| `S-G2` | 보안 | 토큰 없이 전 엔드포인트 401 확인 |
| `E-04` | 엣지 | 빈 asset_ids 큐잉 후 즉시 done 상태 검증 |
| `E-05` | 보안 | 기본 토큰 노출 시 인증 통과 재현 |
