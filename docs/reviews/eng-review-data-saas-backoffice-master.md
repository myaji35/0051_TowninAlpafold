# Eng Review — DATA_SAAS_BACKOFFICE_MASTER-001 (데이터 SaaS 백오피스 통합 마스터)

> 작성: plan-eng-reviewer (Harness DATA_SAAS_BACKOFFICE_ENG_REVIEW-001)
> 일자: 2026-05-04
> 검토 대상: `docs/plans/data-saas-backoffice-master-plan.md` (399줄, v2)
> 시선: Engineering Lead — 아키텍처/데이터 흐름/엣지/테스트/성능/보안/비용/의존성
> 형제 검토: `ceo-review-data-saas-backoffice-master.md`(전략/시장/wedge/사업/블로그) — 영역 분리. 본 문서는 실행/아키텍처만.

---

## A. 아키텍처 평가 — 점수 6.5/10

### 평가
"5 파일(datasets/models/brands/manifest/blog) + 3 카탈로그" 책임 분리 자체는 깔끔하다. 단일 진실 원본을 JSON 파일로 두고, 그 중 2개(manifest, publish_queue)는 자동 결과물이라는 모델은 Karpathy #2 Simplicity와 결이 맞는다.

문제는 **상호 참조 무결성**. 마스터 문서 §3에서 5 파일은 각자 독립으로 그려졌지만 실제로는 다음과 같은 외래키 관계를 갖는다:

```
catalog.json[*].data_dependencies[]  ──FK──▶  datasets.json[*].key
brands/catalog.json[*].primary_models[] ──FK──▶  catalog.json[*].key
manifest.json.dongs[*].sgg_code     ──FK──▶  admin_hierarchy.json
manifest.json.datasets[*].key       ──FK──▶  datasets.json[*].key
catalog.json[*].ui_component        ──FK──▶  components/<key>.js (파일 존재성)
catalog.json[*].scorer              ──FK──▶  viz/plugins/<key>-scorer.js
```

마스터 문서 §10 "안전 장치"에 "모델 등록 자동 검증 = 의존 데이터셋 존재 확인 + 가중치 합 1.00" 1줄만 있고 **나머지 5개 외래키 검증은 누락**. 한 번이라도 깨지면 일괄 보고서 PDF 렌더링 중간에 `TypeError: cannot read property 'ko' of undefined`로 죽는 경로가 다수.

`MANIFEST_V2_HIERARCHY-001`과 `ADMIN_HIERARCHY_MASTER-001`이 분리 자식 이슈인데, 두 파일 사이의 FK 검증 자체가 어느 이슈에도 명시되지 않음.

### 권고
1. 신규 자식 이슈 `DATA_SAAS_FK_VALIDATOR-001` (P0) — `scripts/validate_catalogs.py` 단일 스크립트(~120줄). 5개 FK 모두 검증 + CI/pre-commit hook 등록.
2. 모든 등록 폼 submit 직후, ETL run 전, manifest 재계산 전, PDF 렌더 전 — 4개 게이트에서 `validate_catalogs.py` 자동 호출. 실패 시 작업 중단.
3. JSON Schema (`data_raw/_registry/schemas/*.schema.json`) 5개 파일 추가. 등록 폼 클라이언트 검증 + ETL 시 `jsonschema` 라이브러리로 재검증.

---

## B. 정적 사이트 vs 백엔드 결정 시점

### 평가
현재 `index.html` + `app.js`(5353줄) + Python http.server. 마스터 문서는 "어느 시점부터 백엔드가 필수인가"를 침묵한다. 자식 35개 이슈 중 백엔드를 가정하는 것이 다수:

| 이슈 | 백엔드 필요성 |
|---|---|
| `EVAL_MODELS_REGISTRATION_FORM-001` | 폼 submit → catalog.json 편집 = git commit or POST API |
| `BRAND_ASSETS_REGISTRY-001` | CSV 업로드 + 파싱 + brands/B-001/assets.csv 저장 |
| `BATCH_RUNNER_ENGINE-001` | 자산 N개 병렬 평가 — 메인 스레드 차단 위험 |
| `PDF_RENDERER_INTEGRATION-001` | wkhtmltopdf/Playwright 서버 호출 |
| `BLOG_PUBLISH_QUEUE-001` | cron으로 0018_blog 발행 |
| `DATA_OPS_ALERTS-001` | 만료/실패/throttle 메일/슬랙 알림 발송 |
| `DATA_SAAS_KPI_TRACKING-001` | 주간 자동 보고 → 어디로 보내나 |

이 중 **클라이언트 only로 풀 수 있는 것은 0개**. 등록 폼은 git workflow로 우회 가능하지만 사용자가 "주 1시간으로 운영"하는 시나리오에 git CLI를 끼우면 곧바로 운영 부담이 폭발한다.

### 권고
**Phase 1(Week 1-3)부터 백엔드 도입**. 다만 풀스택 프레임워크는 과잉이다:

- **권고 스택**: FastAPI(~500줄) + SQLite + Vultr 2GB($12/월). PostgreSQL은 manifest 단일 파일 한계 도달 시(아래 I 절) 전환.
- **이유**:
  - cron + ETL Python 스크립트 호스팅 자연
  - 등록 폼 POST API 필수
  - PDF 생성 서버 호출 자연
  - 정적 사이트는 그대로 두고 `/api/*`만 추가 (surgical)
- **신규 자식 이슈 권고**: `BACKEND_API_SKELETON-001` (P0, Week 1) — FastAPI 라우터 + datasets/models/brands CRUD + 인증 1레이어.
- **비용**: 월 $12 (Vultr) + $0 (SQLite) + $0 (자체 호스팅 PDF) = **$12/월** Phase 1.

---

## C. 데이터 흐름 — 집계 룰 결정 필요

### 평가
마스터 문서 §4 "manifest.json 자동 재계산"의 흐름도는 그려졌지만 **집계 공식이 모호**:

```
동 % = ?
시군구 % = ?
광역시 % = ?
```

가능한 해석 5가지:
1. 단순 평균 (15 데이터셋의 cell-level 평균)
2. 가중 평균 (데이터셋 중요도 가중)
3. 인구 가중 (시군구→광역시 시 인구 비례)
4. 시간 가중 (최근 ETL일수록 가중)
5. min(전체 데이터셋의 최소값) — 가장 약한 데이터가 병목

각각 사용자 보드의 "완성도 60%"가 의미하는 바가 다르다. 영업 자료(트랙 3 PDF)에서 "본 동 데이터 75% 확보" 표기가 정의 없으면 신뢰성 훼손.

### 권고
`MANIFEST_V2_HIERARCHY-001` 자식 이슈 spec에 다음 명시:

```python
# 동 %: 데이터셋별 cell-coverage 평균
dong_pct = mean([ds.coverage_at(dong_code) for ds in active_datasets])

# 시군구 %: 동의 인구 가중 평균
sgg_pct = sum(dong.pop * dong.pct for dong in dongs_in_sgg) / sum(dong.pop for ...)

# 광역시 %: 시군구의 인구 가중 평균 (재귀)
metro_pct = sum(sgg.pop * sgg.pct for sgg in sggs) / sum(sgg.pop ...)
```

인구 가중은 `admin_hierarchy.json`에 인구 필드 필수 추가 → `ADMIN_HIERARCHY_MASTER-001` payload에 인구 컬럼 명시 추가.

---

## D. ETL 자동화 보강 필요

### 평가
`ETL_SCHEDULER_ENGINE-001`이 "cron 1줄 + etl_scheduler.py 단일 스크립트(~150줄)"라고 §16 명시. 이 규모는 좋으나 마스터 문서 §10 "안전 장치"의 다음 4개가 코드/이슈 어디에도 명시 없음:

1. **Lockfile** — 같은 데이터셋 중복 실행 방지. cron 1분 지연 + 직전 실행 미완료 시 충돌.
2. **Exponential backoff** (§10에 단어만 있음) — 1차 실패 5분, 2차 15분, 3차 1시간, 4차 정지.
3. **Rate limit 추적** (§10 80% throttle 단어만) — 공공 API는 일일/시간 한도 다양. 실시간 카운터 + manifest에 기록.
4. **Schema drift quarantine** (§10에 단어만) — 응답 필드 변경 시 격리 + 사람 검토 큐.

`etl_pharmacy.py`(기존)와 `etl_uijeongbu.py`(기존) 코드를 보면 이런 인프라 없이 시도/실패 로깅 정도만 있음. 5개 신규 ETL이 모두 같은 인프라를 재구현하면 코드 중복 + 동작 불일치.

### 권고
**신규 자식 이슈 `ETL_INFRA_RELIABILITY-001`** (P0, 트랙 1 인프라):
- `utils/etl_lock.py` — fcntl 또는 `data_raw/_locks/<dataset_key>.lock` 파일 잠금
- `utils/etl_retry.py` — `@with_retry(max=3, backoff='exponential')` 데코레이터
- `utils/rate_tracker.py` — 데이터셋별 시간/일 호출 수 → manifest에 기록
- `utils/schema_validator.py` — `expected_schema_hash` 비교 + 변경 시 quarantine

5개 ETL 이슈는 이 인프라를 import만. 단위 테스트 1세트만 두면 5개 모두 신뢰 확보.

---

## E. 모델 자동 스캐폴딩 위험

### 평가
`EVAL_MODELS_AUTO_SCAFFOLD-001`은 "새 모델 등록 시 components/<key>.js + viz/plugins/<key>-scorer.js를 pharmacy 패턴 복사 후 agent-harness 자동 호출 → LLM이 도메인별 점수 공식 채움"이라는 가정. **3가지 위험**:

1. **검증 게이트 누구**. LLM이 잘못된 가중치(합≠1.00)를 넣으면 마스터 §10의 "가중치 합 1.00 검증"이 어디서 작동하는지 불명. 자동 스캐폴딩 중 검증 실패 시 어떻게 롤백?
2. **LLM 비용 추적 누락**. 모델 1건 등록 = scaffold + scorer + spec_doc 자동 생성 ≈ Opus 호출 5~10회 ≈ $5~$10. 1년 20모델 = $100~$200. `opus_budget_state`에 항목 추가 필요.
3. **사람 리뷰 게이트 부재**. 자동 생성된 점수 공식을 도메인 전문가(약사/감정평가사) 리뷰 없이 catalog.json에 즉시 등록되면 잘못된 평가가 영업 PDF로 직행. CRITICAL.

### 권고
`EVAL_MODELS_AUTO_SCAFFOLD-001` payload 보강:
1. 자동 생성 결과는 `catalog.json[*].status="DRAFT"`로만 등록. `status="PUBLISHED"`는 사람 리뷰 후 수동 전환.
2. 가중치 합 1.00 검증을 scaffold 직후 자동 실행 → 실패 시 issue auto-rollback.
3. `opus_budget_state.scaffold_cost_per_model_usd` 필드 추가, 마스터 spawn 전 예산 체크.
4. **신규 자식 이슈 `MODEL_REVIEW_QUEUE-001`** (P1) — 등록된 DRAFT 모델 리뷰 UI(반려/승인/주석).

---

## F. 일괄 평가 성능 — 현실적 한계 검증

### 평가
가격 모델 §7에서 Enterprise=1,000개 자산. `BATCH_RUNNER_ENGINE-001`은 "자산 N개 병렬 평가"라고만 명시. 현재 정적 사이트 + 클라이언트 JS로 1,000개를 어떻게 처리할지 침묵.

- **메인 스레드 차단**: 점포 1개 평가 = 추산 100~500ms (KM curve + Monte Carlo 등). 1,000개 직렬 = 100~500초 (유저 브라우저 정지).
- **메모리**: 점포 1개 결과 = ~50KB (raw + scored + visualization 데이터). 1,000개 = 50MB 클라이언트 메모리.
- **네트워크**: 평가 시 도메인 데이터 fetch가 점포마다면 1,000 requests.
- **진행률 UI**: polling? SSE? WebSocket? 명시 없음.

§10 안전 장치 "일괄 실행 100개+ → 백그라운드 + 진행률 알림"은 단어만. 실제 구현 패턴 필요.

### 권고
`BATCH_RUNNER_ENGINE-001` payload 분기:
- **자산 50개 이하**: 클라이언트 + Web Worker로 병렬 실행 + Promise.all (동시 4개).
- **자산 51~1,000개**: 백엔드 작업 큐. **권고 스택**: FastAPI + Celery + Redis 또는 가벼운 RQ. (백엔드 Phase 1 결정 시 자연 통합)
- **진행률**: SSE(`/api/batch/<id>/events`). 5초 polling fallback.
- **결과 저장**: `data_raw/_brands/B-001/runs/<run_id>.json` (자산별 스코어 + 메타).

**신규 자식 이슈 `BATCH_QUEUE_INFRA-001`** (P1, 트랙 3 인프라).

---

## G. PDF 생성 인프라 — 자체 vs 클라우드

### 평가
계산:
- 100페이지 PDF × Enterprise 5곳 × 매월 분기 갱신 = 월 ~5~10회 생성
- wkhtmltopdf 100페이지 = 30초~2분 (CSS 복잡도에 따라)
- 월 CPU = 2.5시간 ~ 20시간

자체(Vultr 2GB)로 충분히 처리 가능. wkhtmltopdf는 메모리 ~500MB 사용 — 동시 1~2개 한도.

클라우드(DocRaptor 등) = $19/월 125페이지 무료 + $0.01/페이지. 월 5,000페이지(Enterprise 5곳 × 100페이지 × 월 갱신 + 분기 비교) = $50/월.

### 권고
- **Phase 1~2**: 자체 wkhtmltopdf. `report-pdf-builder` skill 활용(이미 프로젝트 룰).
- **Phase 3+ (Enterprise 3곳 이상 도달)**: 동시 생성 부하 시 클라우드 검토.
- `PDF_RENDERER_INTEGRATION-001` payload에 "Phase 1=wkhtmltopdf 단일 큐" 명시.
- 동시 PDF 생성 1개 한정 lockfile (작업 큐로 직렬화). 백엔드 RQ 잡으로 자연 처리.

---

## H. API 키 보안

### 평가
마스터 §15 "API 키 노출 = env var only, .env .gitignore" 1줄. 실제 운영 시나리오:
- 사용자가 등록 폼에서 KOSIS API 키 입력 → 어디로 가나?
- (a) 폼 제출 시 사용자가 직접 .env 편집 (셸 작업 = 운영 부담 폭발)
- (b) 폼 → POST /api/datasets → 서버가 .env 갱신 (서버 평문 보관 = 위험)
- (c) Secrets Manager (AWS Secrets Manager / HashiCorp Vault / SOPS) — 정석

### 권고
**Phase 1(MVP)**: 옵션 (b) + 다만 `.env` 파일은 OS 파일 권한 600 + 백엔드 프로세스 user 전용. 평문이지만 SSH 접근 못하면 노출 불가.

**Phase 2(Enterprise 첫 계약)**: SOPS + age 키. `.env.encrypted` git 커밋 가능. 키 회전 자동.

**Phase 3(다고객 SaaS화)**: AWS Secrets Manager. 비용 $0.40/secret/월 × 데이터셋 수 = 월 $5~$10.

`DATASET_REGISTRY_SCHEMA-001` payload에 `credentials.storage_strategy: "env_var" | "sops" | "aws_secrets_manager"` enum 추가.

---

## I. manifest.json 단일 파일 동시성 — **🚨 BLOCKER 1**

### 평가
**가장 큰 아키텍처 우려.** ETL 5종이 동시 실행되면 `manifest.json` 동시 쓰기 → 데이터 손실. 1만 동 × 15 데이터셋 시 manifest.json 추산:
- 동 1만개 × 15 dataset coverage cell + 시군구 250개 + 광역시 17개
- ≈ 150,000 row × 평균 100 byte = **15MB JSON**

매 ETL 종료 시 15MB 전체 read → in-memory 수정 → 전체 write. 5개 ETL 동시 = race condition + 디스크 I/O 폭발.

설계 한계:
- JSON 단일 파일은 100동 × 5데이터셋 (Phase 0~1)은 OK.
- 1,000동 × 10 데이터셋 부터 명백한 병목. 매 갱신 100ms~500ms.
- 3,500동 × 15 데이터셋(목표)에서는 명백히 깨짐.

### 권고
**3단계 전환 전략**:

| Phase | 저장소 | 임계 |
|---|---|---|
| Phase 0~1 (월 1~3) | manifest.json + 파일 잠금(fcntl) | 100동 × 5종 |
| Phase 2~3 (월 3~9) | SQLite + manifest_cache.json (read-side) | 1,000동 × 10종 |
| Phase 4+ (월 9+) | PostgreSQL | 3,500동 × 15종+ |

**신규 자식 이슈 `MANIFEST_STORAGE_MIGRATION-001`** (P1, 트랙 1 인프라):
- 단계 0: fcntl lockfile (Week 1, 즉시)
- 단계 1: SQLite 마이그레이션 (Phase 2 진입 시)
- 단계 2: PostgreSQL 마이그레이션 (Phase 4)

API/UI 코드는 `manifest_repo.get_dong_pct(code)` 같은 추상 인터페이스로 분리 → 저장소 교체 시 호출자 영향 0.

---

## J. 테스트 + 회귀 인프라

### 평가
마스터 문서 35개 자식 이슈 중 **테스트 인프라 이슈 0개**. 기존 `verify_*.mjs` 9개 파일이 있지만 모두 viz/UI 회귀에 한정. 추가 필요:

1. **ETL 5종 단위 테스트** — mock API 응답 + 정상/실패/throttle/schema drift 4시나리오
2. **manifest 재계산 회귀** — 100동 × 5데이터셋 픽스처 → 캐스케이드 결과 골든 비교
3. **일괄 실행 E2E** — 100개 자산 픽스처 → 결과 카운트/스코어 분포 확인
4. **PDF 보고서 시각 회귀** — 표지/카드/매트릭스 페이지 스크린샷 diff
5. **카탈로그 등록 폼 E2E** — Playwright 신규/수정/삭제 + FK 검증 trigger

### 권고
**신규 자식 이슈 `TEST_INFRA_DATA_SAAS-001`** (P1, 트랙 1 운영):
- pytest + pytest-asyncio (백엔드)
- Playwright 기존 인프라 활용 (UI/E2E)
- GitHub Actions CI 1워크플로 (push 시 ETL 단위 + manifest 회귀 자동)

---

## K. 의존성 그래프 — Critical Path 분석

### 평가
"35 자식 이슈 16~24주 트랙 병렬 가능"은 **약한 가설**. 실제 의존성:

```
[트랙 1 인프라: 5개]
DATASET_REGISTRY_SCHEMA  → 트랙 1 ETL 5종 / 트랙 2 모델 등록
ADMIN_HIERARCHY_MASTER   → MANIFEST_V2_HIERARCHY → 트랙 1 ETL / 트랙 4 블로그
ETL_SCHEDULER_ENGINE     → 트랙 1 ETL 5종 / 트랙 1 보드
DATA_QUALITY_GATE        → 모든 ETL → 모든 보고서

[트랙 2: 모델 카탈로그]
EVAL_MODELS_CATALOG_SCHEMA  → AUTO_SCAFFOLD / REGISTRATION_FORM / 트랙 3 BATCH

[트랙 3: 일괄 보고서]
BRAND_CATALOG_SCHEMA → BRAND_ASSETS_REGISTRY → BATCH_RUNNER_ENGINE → REPORT_TEMPLATE
                                              ↑
                                       (트랙 2 catalog 완성 필수)

[트랙 4: 블로그]
BLOG_INTEGRATION_PLAN → BLOG_TEMPLATE → BLOG_PUBLISH_QUEUE
                          ↑
                  (manifest 갱신이 발행 트리거)
```

**Critical Path = 트랙 1 인프라 (5개) → 트랙 1 ETL 5종 → manifest 재계산 → 트랙 2 catalog → 트랙 3 batch → PDF**

진짜 병렬 가능 항목:
- 트랙 1 인프라 5개끼리 일부 병렬
- 트랙 1 ETL 5종 끼리 병렬 (인프라 완성 후)
- 트랙 4 블로그 4개 (manifest 안정 후)

**직렬 강제 항목**:
- 트랙 3은 트랙 2 catalog 완성 후에만 의미. 즉 트랙 2/3는 본질 직렬.
- 트랙 4는 manifest 신뢰성 확보 후. 트랙 1 거의 끝나야 가능.

→ "16~24주 트랙 병렬"은 사실상 **트랙 1이 critical path = 12~16주 점유** + 트랙 2/3는 그 후 8~12주.

### 권고
- 마스터 §13 마일스톤 "1개월 = 트랙 1 5종 + 트랙 2 약국 2 + 트랙 3 시연 5점포"는 낙관. 트랙 1 인프라 5개만 1개월이 빠듯.
- **현실적 1개월 목표**: 트랙 1 인프라 5개 + ETL 1종(KOSIS) + 트랙 2 catalog schema + 약국 2 카드 진입.
- **현실적 3개월**: 트랙 1 ETL 5종 + manifest 캐스케이드 + 트랙 2 약국 4 + 트랙 3 1브랜드 시연.

---

## L. 비용 추정 보강

### 평가
마스터 문서 비용 명시 누락. 실제 추정:

| 항목 | Phase 1 (월) | Phase 2 (월) | Phase 3 (월) |
|---|---|---|---|
| Vultr 2GB | $12 | $12 | $24 (4GB 업그레이드) |
| DB | $0 (SQLite) | $0 (SQLite) | $15 (PostgreSQL managed) |
| PDF 생성 | $0 (자체) | $0 (자체) | $50 (DocRaptor) |
| Secrets 관리 | $0 (.env) | $0 (SOPS) | $10 (AWS SM) |
| LLM 자동 스캐폴딩 | $0 (모델 없음) | $20 (월 4모델) | $40 (월 8모델) |
| 공공 API | $0 | $0 | $30 (HIRA 진입 시) |
| 모니터링 (Sentry/UptimeRobot) | $0 | $9 | $26 |
| **합계** | **$12** | **$41** | **$195** |

추가:
- 도메인 + SSL = 연 $20 (Cloudflare로 우회 가능)
- 백업 (S3) = 월 $1~$5

### 권고
- 마스터 문서 §15 또는 §17에 인프라 비용 표 추가.
- `DATA_SAAS_KPI_TRACKING-001` payload에 `monthly_infra_cost_usd` KPI 추가.
- Enterprise 1곳 = 월 200만원 ≈ $1,500. **인프라 비용 < 매출의 15%** 안전.

---

## M. BLOCKER + 권고 우선순위

### BLOCKER (출시 전 반드시 해결) — 3개

| # | BLOCKER | 영향 | 신규 이슈 |
|---|---|---|---|
| 1 | **manifest.json 단일 파일 동시성/확장성** | 1,000동 도달 시 시스템 마비 | `MANIFEST_STORAGE_MIGRATION-001` (P1) |
| 2 | **외래키 무결성 검증 부재** | 5개 FK 깨짐 → PDF/UI 런타임 죽음 | `DATA_SAAS_FK_VALIDATOR-001` (P0) |
| 3 | **ETL 인프라 보강 4종 누락** (lock/retry/rate/schema-drift) | 5개 ETL 모두 신뢰 불가 | `ETL_INFRA_RELIABILITY-001` (P0) |

### 권고 (출시 전 강력 권장) — 4개

| # | 권고 | 신규 이슈 |
|---|---|---|
| 4 | 백엔드 도입 Phase 1부터 | `BACKEND_API_SKELETON-001` (P0) |
| 5 | 모델 DRAFT/PUBLISHED 게이트 + 리뷰 큐 | `MODEL_REVIEW_QUEUE-001` (P1) |
| 6 | 일괄 실행 백엔드 큐 인프라 | `BATCH_QUEUE_INFRA-001` (P1) |
| 7 | 테스트 인프라 5종 | `TEST_INFRA_DATA_SAAS-001` (P1) |

### 권고 (Phase 2 진입 시 검토) — 3개
- 집계 룰 명세 (B/C/I 절) → `MANIFEST_V2_HIERARCHY-001` payload 보강
- API 키 보관 SOPS 전환 → `DATASET_REGISTRY_SCHEMA-001` payload 보강
- PDF 클라우드 전환 임계 = Enterprise 3곳

---

## N. 최종 결정

### **REVISE** — 마스터 문서 보강 후 GO

근거:
- 책임 분리/카탈로그 모델 자체는 healthy (점수 6.5/10)
- 단 출시 전 BLOCKER 3개 + 권고 4개 = **신규 자식 이슈 7개 추가** 필요
- 특히 **manifest 단일 파일 한계**(BLOCKER 1)는 1,000동 도달 시 명백 마비. 미리 추상화하면 비용 0.

### 다음 사이클 액션 (5개)

| # | 액션 | 담당 에이전트 | 우선순위 |
|---|---|---|---|
| 1 | `DATA_SAAS_FK_VALIDATOR-001` 생성 → 즉시 구현 | agent-harness | P0 |
| 2 | `ETL_INFRA_RELIABILITY-001` 생성 → ETL 5종 spawn 전 선행 | agent-harness | P0 |
| 3 | `MANIFEST_STORAGE_MIGRATION-001` 생성 → 단계 0(fcntl) 즉시 / SQLite/PG는 Phase 2/4 | agent-harness | P1 |
| 4 | 마스터 문서 §13 마일스톤 보정(현실적 1/3개월 목표) | product-manager (plan-harness:product) | P1 |
| 5 | 마스터 문서 §15 또는 §17에 인프라 비용 표 추가 + §10에 FK 검증 게이트 명시 | product-manager (plan-harness:product) | P2 |

→ 5개 액션 완료 후 `DATA_SAAS_BACKOFFICE_MASTER-001` re-review → APPROVE 가능.

---

## 부록 — 코드 라인 인용

- `app.js:8` `let currentMode = 'gallery';` — 단일 모드 디스패처. 백엔드 도입 시 API 클라이언트 분리 필요.
- `app.js:80-98` `loadData()` 단일 fetch + simula 폴백. 5 데이터셋 동시 로딩 시 race 가능.
- `etl_pharmacy.py` (기존) — lock/retry/rate-tracking 인프라 부재. 5개 신규 ETL이 답습할 위험.
- `viz/plugins/pharmacy-scorer.js` (기존) — 모델 자동 스캐폴딩 시 패턴 복사 원본. 가중치 합 1.00 자가 검증 코드 없음.
- `data_raw/pharmacy/sample.json` — 단일 도메인 sample 패턴. 신규 모델 등록 시 동일 패턴 자동 생성 필요.
