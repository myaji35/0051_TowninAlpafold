# TowninAlpafold — 데이터 SaaS 백오피스 통합 마스터 플랜 v2

**기록일**: 2026-05-04
**대표 발화 누적**: 8건 (데이터 누적 → 보드 → 위계 → 블로그 → 셀프 운영 → 카탈로그 → 일괄 보고서 → 통합)
**대체 문서**: `data-assets-saas-master-plan.md` v1 (이 v2가 흡수)

---

## 0. 비전 한 줄

> **"전국 3,500 읍면동 데이터를 자기 운영(self-driving)으로 누적하고, 도메인 평가모델 카탈로그로 셀프서비스화하며, 고객사별 일괄 보고서로 매출화하는 완전한 B2B 데이터 SaaS 백오피스."**

세 트랙이 한 백오피스의 세 측면 — 분리 운영 X, **하나로 결합된 가치 사슬**.

> **v2.1 검토 결과 반영 (2026-05-04 결정)**
> CEO+Eng 검토 모두 REVISE → 사용자 결정 b: **35→10 자식 트리로 축소 등록**.
> CEO 권고 3 (wedge/user_hunt/false_promises) + Eng 안전망 7 (FK/ETL/manifest/backend/review/batch/test).
> 나머지 25개 이슈는 **Phase 0 검증 후 단계적 등록** (Wave 회고 패턴).
> 근거: docs/reviews/ceo-review + eng-review.

---

## 1. 가치 사슬 그림

```
┌─────────────────────────────────────────────────────────────────┐
│                  Data Studio (백오피스)                            │
├──────────────────┬──────────────────┬──────────────────────────┤
│ 트랙 1            │ 트랙 2            │ 트랙 3                   │
│ 데이터셋 카탈로그  │ 평가모델 카탈로그  │ 브랜드 + 일괄 보고서      │
│ datasets.json    │ catalog.json     │ brands/ + 일괄 실행       │
│ ───────────────  │ ───────────────  │ ──────────────────       │
│ 5종+ 누적 운영    │ 약국·NPL·요식업…  │ 온누리약국 100점포 ...    │
│ cron 자동 ETL     │ N개 모델 카탈로그 │ 일괄→PDF→영업              │
│ + 데이터셋 등록    │ + 모델 등록       │ + 브랜드 등록              │
└────────┬─────────┴────────┬─────────┴────────┬─────────────────┘
         │                  │                  │
         └──── manifest ────┴──── 변동 자동 갱신┘
                            ↓
                   ┌────────────────────┐
                   │ 0018_blog 자동 발행  │
                   │ ● SEO + 영업 자료    │
                   │ ● 데이터 협력 유인   │
                   └────────────────────┘
```

→ 한 사용자가 등록 1회 = 데이터 누적 + 모델 가용성 + 보고서 + 블로그 + SEO.

---

## 2. 사용자 발화 누적 (8건 → 1 모델로 합성)

| # | 발화 | 시스템 결정 |
|---|---|---|
| ① | 갤러리 카드 시뮬레이션 = 어떤 데이터가 필요? | 데이터셋 카탈로그 필요 |
| ② | 점진 운영 어떻게? | 단계 누적 + 슬라이스 |
| ③ | 코딩 아니라 서비스 입장 | 자산 관점 보드 |
| ④ | 광역시/시군구/읍면동 단위 | 3 레벨 위계 드릴다운 |
| ⑤ | 0018_blog로 공유 | 블로그 결합 = 마케팅+SEO+영업 |
| ⑥ | API 키/주기/난이도 메타로 자동 | 데이터셋 = 자기 운영 단위 |
| ⑦ | 신규 등록 → 자동 캐스케이드 | 단일 입력 → 5단 자동 |
| ⑧ | A브랜드 일괄 보고서 + 평가모델 분리 | 카탈로그 + 일괄 보고서 트랙 |

---

## 3. 시스템 핵심 — 5 파일 + 3 카탈로그

### 5 파일 (단일 진실 원본)

| 파일 | 책임 | 갱신 주체 |
|---|---|---|
| `data_raw/_registry/datasets.json` | 데이터셋 운영 메타 | 사용자 (등록 폼) |
| `data_raw/_models/catalog.json` | 평가모델 카탈로그 | 사용자 (등록 폼) |
| `data_raw/_brands/catalog.json` | 브랜드(고객사) 카탈로그 | 사용자 (영업/등록) |
| `data_raw/_progress/manifest.json` | 위계 + 완성도 + 카드 가용성 | ETL 자동 |
| `0018_blog/_publish_queue.json` | 발행 큐 + 로그 | 블로그 cron 자동 |

→ 사용자는 3개(datasets/models/brands)만 입력. 나머지 2개는 자동 결과물.

---

## 4. 데이터 흐름 — 3 카탈로그 → 1 manifest → 외부 가시화

```
[등록] datasets.json         [등록] catalog.json         [등록] brands/catalog.json
       ↓                            ↓                            ↓
[ETL Scheduler 자동]         [모델 자동 스캐폴딩]         [브랜드 자산 등록]
       ↓                            ↓                            ↓
       └────────────────┬───────────────────────────────────────┘
                        ↓
              [manifest.json 자동 재계산]
              ├ 동/시군구/광역시 % 캐스케이드
              ├ 데이터셋별 진척
              ├ 모델별 가용성 (real_data_pct)
              └ 브랜드별 자산 평가 결과
                        ↓
              ┌─────────┴─────────┐
              ↓                   ↓
      [Data Studio 보드]   [블로그 발행 큐 자동]
       3 카탈로그 한자리       SEO + 영업
              ↓                   ↓
        [단건 평가]         [일괄 보고서 PDF]
        (분석 도구)          (사업 도구)
```

→ **단일 입력 = 5단 자동 + 외부 가시화**. 사람 손 = 등록 + 검토 + 큐레이션.

---

## 5. 트랙 1 — 데이터셋 카탈로그 (자기 운영)

### 데이터셋 메타 스키마 (요약)
```json
{
  "key": "kosis_living_pop", "ko": "생활인구", "source_org": "KOSIS",
  "credentials": {"type":"api_key","env_var":"KOSIS_API_KEY","expires_at":"2027-04-15"},
  "difficulty": {"level":"easy","hours_estimated":4},
  "schedule": {"frequency":"monthly","cron":"0 9 5 * *","next_run_at":"...","consecutive_failures":0},
  "scope": {"current_dongs_covered":38,"target_dongs":3500},
  "quality": {"data_marker_default":"real"},
  "ops": {"alert_on_failure":true,"max_retries":3}
}
```

### 점진 누적 로드맵
| Phase | 기간 | 목표 |
|---|---|---|
| 0 | Week 0 | 의정부 금오동 × KOSIS × 1셀 게이트웨이 |
| 1 | Week 1-3 | 공공 OD 5종 × 1동 |
| 2 | Week 4-6 | 30개 동 수평 확장 |
| 3 | Week 7-9 | 변수 깊이 5종 추가 |
| 4 | Week 10-12 | 유료/협력 (BC카드, HIRA) |
| 5 | Q3-Q4 | 전국 130 → 500 → 3,500 |

### 자식 이슈 (5)
- DATASET_REGISTRY_SCHEMA-001
- ETL_SCHEDULER_ENGINE-001
- MANIFEST_V2_HIERARCHY-001
- ADMIN_HIERARCHY_MASTER-001
- DATA_QUALITY_GATE-001

### Phase 1 첫 5개 데이터셋 (5)
- ETL_KOSIS_LIVING_POP-001
- ETL_LOCALDATA_BIZ-001
- ETL_NTS_BIZREG-001
- ETL_MOLIT_LANDPRICE-001
- ETL_VWORLD_GEOJSON-001

### UI (3)
- DATA_STUDIO_DATASET_MENU-001
- DATA_ASSETS_BOARD_HIERARCHY-001 (광역시/시군구/동 4 레벨)
- DATA_BUILDUP_FEED-001 (변동 미니 피드)

---

## 6. 트랙 2 — 평가모델 카탈로그 (셀프 등록)

### 모델 메타 스키마 (요약)
```json
{
  "key": "pharmacy.develop", "ko": "약국 점포개발", "category": "약국",
  "persona": "약국 본사 개발담당자",
  "data_dependencies": ["kosis_living_pop","nts_biz_register","molit_landprice","localdata_cafe","etl_pharmacy_data"],
  "data_completeness": {"required_pct":70,"current_pct":55,"ready_dongs":12},
  "ui_component":"components/pharmacy-develop.js",
  "scorer":"viz/plugins/pharmacy-scorer.js",
  "spec_doc":"docs/stories/pharmacy-develop.md",
  "deep_link_to":"decide", "demo_addresses":["의정부시 금오동",...],
  "ops":{"usage_count_lifetime":0}
}
```

### 헤더 변경
- Before: `[약국·점포개발][약국·폐업평가]` (헤더 직붙)
- After: `[평가모델 ▾]` 1개 진입점 + 카탈로그 그리드 화면
- 즐겨찾기는 사용자 핀 가능 (개인화)

### 도메인 모델 후보 (1년 내 10개+)
약국 2 / NPL 2 / 요식업 1 / 카페 창업 1 / 병원 개원 1 / 학원 1 / 임대수익 1 / 부동산 매수 1

### 자식 이슈 (8)
- EVAL_MODELS_CATALOG_SCHEMA-001
- EVAL_MODELS_HEADER_REORG-001
- EVAL_MODELS_ROUTING_REWIRE-001
- EVAL_MODELS_CATALOG_GRID-001
- EVAL_MODELS_REGISTRATION_FORM-001
- EVAL_MODELS_FAVORITES-001
- EVAL_MODELS_AUTO_SCAFFOLD-001
- EVAL_MODELS_USAGE_TRACKING-001

---

## 7. 트랙 3 — 브랜드 + 일괄 보고서 (B2B 영업)

### 브랜드 메타 스키마 (요약)
```json
{
  "brand_id":"B-001","name":"온누리약국","industry":"약국",
  "scale":"본사 + 100개 점포",
  "primary_models":["pharmacy.develop","pharmacy.close"],
  "report_template":"pharmacy_quarterly",
  "subscription_tier":"enterprise"
}
```

### 자산(asset) 등록
`data_raw/_brands/B-001/assets.csv` — 점포 N개 (CSV 또는 API 업로드)

### 일괄 실행 + PDF
- batch-runner.js — 자산 N개 병렬 평가
- PDF 보고서: 표지 + 종합 + 자산별 카드 + 액션 매트릭스 + 부록
- 분기 비교 (이전 보고서 diff)

### 가격 모델 (사업)
| 등급 | 월 | 일괄 | 자산 한도 |
|---|---|---|---|
| Free | 0 | 단건만 | — |
| Pro | 30만원 | 분기 1회 | 50개 |
| Enterprise | 200만원 | 무제한 | 1,000개 |
| Partner | 협의 | 커스텀 | 무제한 |

→ 본사 5곳 = 연 1.2억 매출 잠재.

### 자식 이슈 (10)
- BRAND_CATALOG_SCHEMA-001
- BRAND_ASSETS_REGISTRY-001
- BATCH_RUNNER_ENGINE-001
- BATCH_RUNS_HISTORY-001
- EVAL_MODEL_BATCH_BUTTON-001
- BATCH_INPUT_FORM-001
- BATCH_PROGRESS_RESULT_UI-001
- REPORT_TEMPLATE_PHARMACY_QUARTERLY-001
- PDF_RENDERER_INTEGRATION-001 (report-pdf-builder skill 활용)
- REPORT_HISTORY_AND_DIFF-001

---

## 8. 트랙 4 — 블로그 결합 (0018_blog)

### 발행 패턴 3종
| 패턴 | 트리거 | 사람 손 |
|---|---|---|
| A (동별) | 동 첫 70% 또는 +5%p | 자동 (85%+) / 검토 (70-85%) |
| B (종합) | 매월 1일 | 5분 검토 |
| C (인사이트) | 분기 | 사람 큐레이션 |

### 자식 이슈 (4)
- BLOG_INTEGRATION_PLAN-001
- BLOG_TEMPLATE_3KIND-001
- BLOG_PUBLISH_QUEUE-001
- BLOG_FIRST_POST_YEOKSAM1-001

---

## 9. 운영 + KPI 트랙 (3)

### 자식 이슈 (3)
- DATA_PARTNERSHIP_NEGOTIATION-001 (HIRA + BC카드 협상)
- DATA_SAAS_KPI_TRACKING-001 (주간 자동 보고)
- DATA_OPS_ALERTS-001 (만료/실패/throttle 알림)

---

## 10. 안전 장치 (모든 트랙 공통)

| 장치 | 작동 |
|---|---|
| 자격증명 만료 알림 | expires_at 30일 전 |
| rate limit throttle | 80% 도달 시 cron 연기 |
| 3회 연속 실패 → 일시 정지 | frequency=blocked 자동 |
| schema drift quarantine | 알림 + 검토 대기 |
| 데이터 마커 강제 | ●실/○합성/◐추정 모든 레코드 |
| 변동 폭 +20%p 임계 | 사람 검토 게이트 |
| 블로그 85% 미만 | 사람 검토 후 발행 |
| 모델 등록 자동 검증 | 의존 데이터셋 존재 확인 + 가중치 합 1.00 |
| 일괄 실행 100개+ | 백그라운드 + 진행률 알림 |
| PDF 보고서 마커 표시 | 모든 페이지 푸터 자동 |

---

## 11. 사용자 운영 시간 — 주 약 1시간

| 활동 | 빈도 | 시간 |
|---|---|---|
| 데이터셋 등록 | 주 1~2건 | 10분/건 |
| 모델 등록 | 월 1~2건 | 20분/건 |
| 브랜드 등록 + 자산 업로드 | 신규 계약 시 | 30분/건 |
| 보드 검토 | 주 1회 | 5분 |
| 블로그 발행 큐 검토 | 주 1회 | 10분 |
| 일괄 보고서 검토 | 분기 | 30분/브랜드 |
| 분기 도메인 인사이트 글 | 분기 | 2시간 |
| 데이터 협력 협상 | 월 1회 | 1~2시간 |

→ **주 1시간 내외로 SaaS 백오피스 + 영업 활동**.

---

## 12. 자식 이슈 트리 (Phase 0~1 등록 10 / Deferred 25)

```
DATA_SAAS_BACKOFFICE_MASTER-001 (FEATURE_PLAN, P1)
│
├── 트랙 wedge — CEO 권고 3 (사용자 검증 게이트)
│   ├── DATA_SAAS_BACKOFFICE_BLOCKER_WEDGE-001 (P0)
│   │   └── 자식 트리 35→10 결정 자체 / wedge 방향 확정
│   ├── DATA_SAAS_BACKOFFICE_BLOCKER_USER_HUNT-001 (P0)  ← critical path 시작
│   │   └── 약국 본사 1곳 미팅 게이트 (30분)
│   └── DATA_SAAS_BACKOFFICE_BLOCKER_FALSE_PROMISES-001 (P1)
│       └── 거짓 약속 수정 (주1h/연1.2억/30k방문 재산정)
│
└── 트랙 안전망 — Eng 권고 7
    ├── DATA_SAAS_FK_VALIDATOR-001 (P0)
    │   └── 외래키 무결성 (datasets ↔ manifest ↔ brands FK 검증)
    ├── ETL_INFRA_RELIABILITY-001 (P0)
    │   └── lock+retry+rate+drift 4종 안전망
    ├── BACKEND_API_SKELETON-001 (P0)  ← FK+ETL 완료 후
    │   └── FastAPI+SQLite Phase 1 스켈레톤
    ├── MANIFEST_STORAGE_MIGRATION-001 (P1)  ← BACKEND 완료 후
    │   └── fcntl→SQLite→PG 3단계 마이그레이션
    ├── MODEL_REVIEW_QUEUE-001 (P1)  ← BACKEND 완료 후
    │   └── 모델 자동 스캐폴딩 DRAFT 게이트
    ├── BATCH_QUEUE_INFRA-001 (P1)  ← BACKEND 완료 후
    │   └── 일괄 평가 백엔드 큐 (51~1000 자산)
    └── TEST_INFRA_DATA_SAAS-001 (P1)  ← 독립 실행 가능
        └── 5종 테스트 인프라
```

**Phase 0~1 등록: 10 자식 이슈 (안전망 + 사용자 검증 게이트)**
**Deferred: 25 이슈 — Phase 0 검증(본사 미팅 + KOSIS 1셀) + WAVE_RETROSPECTIVE 후 단계 등록**

critical path: `USER_HUNT → WEDGE → FK_VALIDATOR + ETL_RELIABILITY → BACKEND_API_SKELETON → (MANIFEST / MODEL_REVIEW / BATCH) 병렬`

---

## 13. 통합 마일스톤 (반기)

| 시점 | 트랙 1 | 트랙 2 | 트랙 3 | 트랙 4 | KPI |
|---|---|---|---|---|---|
| **Phase 0** | **(안전망 7 완료)** | **(대기)** | **(대기)** | **(대기)** | **본사 1곳 미팅 + KOSIS 1셀** |
| 1개월 | 데이터셋 5종 / 30동 | 약국 2 카탈로그 진입 | 시연 5점포 일괄 | 첫 글 30개 | 갤러리 4/12 |
| 3개월 | 7종 / 100동 | 모델 6개 (요식업+카페+병원) | 시연 브랜드 + Pro 1곳 | 100글 / 1k 방문 | 갤러리 9/12 |
| 6개월 | 10종 / 500동 | 모델 10개 | Enterprise 1곳 (월 200만원) | 300글 / 5k 방문 | 갤러리 11/12 |
| 1년 | 15종+ / 2,000동 | 모델 20개+ | Enterprise 5곳 (연 1.2억) | 1,000글+ / 30k | 갤러리 12/12 |

---

## 14. Karpathy 4원칙 적용

| 원칙 | 적용 |
|---|---|
| #1 Think Before Coding | 8개 발화를 1개 통합 모델로 합성 후 등록 |
| #2 Simplicity | 5 파일 + 3 카탈로그 = 시스템 전체. Airflow/Celery 도입 X |
| #3 Surgical | 기존 4모드 비파괴, Data Studio 1탭 추가, 헤더 1버튼 교체 |
| #4 Goal-Driven | KPI 5개 + 마일스톤 4분기 — 매주 자동 측정 |

---

## 15. 리스크 (통합) + 완화

| 리스크 | 완화 |
|---|---|
| 합성 데이터 진짜처럼 노출 | 모든 페이지/PDF/블로그에 ●/○/◐ 마커 강제 |
| ETL 자동화 실패 누적 | 3회 연속 실패 자동 정지 |
| 모델 가중치 도메인 위배 | brand-dna anti_patterns + 명세 D절 명시 + 사람 검토 |
| 일괄 실행 PDF 100페이지+ 비용 | 사용 한도 (Pro 50, Enterprise 1,000) + 백그라운드 |
| 유료 데이터 비용 부담 | Phase 4 진입 전 Wave 1 사용자 확보 검증 |
| 블로그 자동 SEO 페널티 | 자동 70% / 검토 20% / 수동 큐레이션 10% 비율 |
| 개인정보 노출 | 동 단위 집계만, 점포 단위 절대 미공개, PDF 워터마크 |
| API 키 노출 | env var only, .env .gitignore, 만료 자동 알림 |

---

## 16. 다음 1주 실행 (v2.1 — 안전망 우선)

### 코딩 작업 (~400줄, 안전망 7 우선)
1. FK 무결성 검증기 (`fk_validator.py`, ~80줄)
2. ETL lock+retry+rate+drift 4종 패치 (~120줄)
3. FastAPI+SQLite Phase 1 스켈레톤 (`backend/main.py`, ~150줄)
4. 5종 테스트 인프라 (`tests/`, ~100줄)

*나머지 400줄(트랙 1+2 UI) → Phase 0 게이트 통과 후 등록*

### 사용자 작업 (~45분)
1. KOSIS API 키 발급 + `.env` (15분)
2. **약국 본사 1곳 컨택 30분** (USER_HUNT 게이트)

### 검증
- 의정부 금오동 × KOSIS 한 셀 자동 ETL
- FK 검증 통과 + ETL retry 작동
- 본사 컨택 결과 → WEDGE 방향 확정

---

## 17. 한 줄 결론

> **3 카탈로그 + manifest 1개 + 블로그 1개 = 35 자식 이슈 = 16~24주 로드맵**.
> 사람 손 주 1시간으로 데이터 누적 + 모델 셀프서비스 + B2B 일괄 보고서 + SEO 영업까지.
> 1년 후 갤러리 12/12 + 모델 20개+ + Enterprise 5곳 (연 1.2억 잠재).

---

## 18. 다음 단계 (이 문서 컨펌 후)

1. 부모 이슈 1건 등록 (`DATA_SAAS_BACKOFFICE_MASTER-001`)
2. CEO/Eng 검토 자동 디스패치 (plan-ceo-reviewer + plan-eng-reviewer, opus)
3. 검토 결과 보고
4. **사용자 컨펌 게이트** — 35 자식 이슈 등록 GO/NO-GO
5. 통과 시 자동 Phase 0부터 디스패치

---

## 19. v2.1 결정 로그

**결정일**: 2026-05-04

### 사용자 결정
- **A-마스터 방향**: b — CEO+Eng 통합 (35→10 자식 트리)
- **B-T2 BUDGET**: C — sonnet 강등 허용

### Phase 0~1 등록 이슈 (10개)

| 트랙 | 이슈 ID | 우선순위 | 역할 |
|---|---|---|---|
| wedge | DATA_SAAS_BACKOFFICE_BLOCKER_WEDGE-001 | P0 | wedge 방향 확정 |
| wedge | DATA_SAAS_BACKOFFICE_BLOCKER_USER_HUNT-001 | P0 | 본사 미팅 게이트 |
| wedge | DATA_SAAS_BACKOFFICE_BLOCKER_FALSE_PROMISES-001 | P1 | 거짓 약속 수정 |
| 안전망 | DATA_SAAS_FK_VALIDATOR-001 | P0 | FK 무결성 |
| 안전망 | ETL_INFRA_RELIABILITY-001 | P0 | ETL 4종 |
| 안전망 | BACKEND_API_SKELETON-001 | P0 | FastAPI 스켈레톤 |
| 안전망 | MANIFEST_STORAGE_MIGRATION-001 | P1 | fcntl→SQLite→PG |
| 안전망 | MODEL_REVIEW_QUEUE-001 | P1 | DRAFT 게이트 |
| 안전망 | BATCH_QUEUE_INFRA-001 | P1 | 일괄 큐 |
| 안전망 | TEST_INFRA_DATA_SAAS-001 | P1 | 5종 테스트 |

### Deferred 이슈 (25개)
트랙 1 데이터셋(13) + 트랙 2 모델 카탈로그(8) + 트랙 4 블로그(4) 중 Phase 0~1 미포함 분.
**등록 조건**: Phase 0 게이트(본사 1곳 미팅 + KOSIS 1셀 검증) 통과 + WAVE_RETROSPECTIVE 후.

### critical path
`USER_HUNT → WEDGE → FK_VALIDATOR + ETL_RELIABILITY → BACKEND_API_SKELETON → (MANIFEST / MODEL_REVIEW / BATCH) 병렬`

### 다음 사용자 액션
**약국 본사 1곳 컨택 30분** (USER_HUNT 이슈) — 이 결과가 wedge 방향 및 나머지 25개 이슈 등록 여부를 결정함.

### 다음 자동 디스패치 예측
USER_HUNT/USER_BLOCKER는 사용자 직접 작업이므로 자동 디스패치 제외.
`DATA_SAAS_FK_VALIDATOR-001 (P0)` 및 `ETL_INFRA_RELIABILITY-001 (P0)` 가 agent-harness로 자동 디스패치.
