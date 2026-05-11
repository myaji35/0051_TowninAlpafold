# TowninAlpafold — 데이터 자산 SaaS 통합 기획안 v1

**기록일**: 2026-05-04
**세션 누적 결정**: 사용자 발화 7건 + 자율 합성
**대표 발화**: "harness, 이러한 기획안을 종합해서 다시 보고해줘 → 옵션1 → 그냥 해봐"

---

## 1. 비전 한 줄

> **"전국 3,500개 읍면동의 데이터를 자기 운영(self-driving) 방식으로 점진 누적하고, 매 변동을 블로그로 공개해 시장 신뢰·SEO·영업·협력을 동시 확보하는 데이터 SaaS 운영 모델."**

---

## 2. 사용자 발화 누적 (이번 세션)

| # | 사용자 의도 | 핵심 메시지 |
|---|---|---|
| ① | "갤러리 12카드 시뮬레이션이 보이려면 어떤 데이터가 축적되어야 하나" | 갤러리 12카드 = 진짜 데이터 백킹 필요 |
| ② | "점진적으로 어떻게 운영하는 게 좋을까" | 단계 누적 + 슬라이스 단위 운영 |
| ③ | "코딩이 아니라 서비스 입장에서 보여주자" | 자산 관점 보드 (지역/완성도/예정) |
| ④ | "광역시/시군구/읍면동 단위로 보여주자" | 3단계 행정 위계 드릴다운 |
| ⑤ | "0018_blog로 공유하면 관심 받겠다" | 블로그 결합 = 마케팅 + SEO + 영업 |
| ⑥ | "API 키, 셋팅일, 난이도, 크롤링 주기 메타로 자동 굴러가게" | 데이터셋 = 자기 운영 단위 |
| ⑦ | "신규 등록 → 지역 현황 자동 수정·공시" | 단일 입력 → 캐스케이드 자동 갱신 |

---

## 3. 시스템 핵심 — 3 파일 + 4 컴포넌트

### 3개 파일 (단일 진실 원본)

| 파일 | 책임 | 갱신 주체 |
|---|---|---|
| `data_raw/_registry/datasets.json` | 데이터셋 운영 메타 (API 키 / 주기 / 난이도 / 범위 / 자격증명) | 사용자 (등록 폼) |
| `data_raw/_progress/manifest.json` | 광역시→시군구→읍면동 위계 + 완성도 + 데이터셋별 누적 | ETL 자동 |
| `0018_blog/_publish_queue.json` | 발행 대기 + 발행 로그 + 변동 트리거 | 블로그 cron 자동 |

### 4개 컴포넌트

| 컴포넌트 | 역할 | 위치 |
|---|---|---|
| 데이터셋 등록 폼 | 새 데이터셋 메타 입력 + 즉시 검증 실행 | Data Studio "데이터셋" 탭 |
| ETL 스케줄러 | datasets.json 읽고 cron 실행 + 결과 기록 | `etl_scheduler.py` (단일 스크립트) |
| Manifest 자동 재계산 | ETL 결과 → 동/시군구/광역시 % 캐스케이드 갱신 | `recalculate_manifest_after_etl()` |
| 블로그 발행 큐 | 변동 동을 패턴 A/B/C 글로 자동 큐잉 | 0018_blog cron + 사람 검토 게이트 |

---

## 4. 데이터 흐름 — 단일 입력 → 5단 자동 캐스케이드

```
[사용자 등록 1회]
      ↓
[datasets.json 추가]
      ↓ (다음 cron)
[ETL Scheduler 실행]
      ↓
[manifest.json 자동 재계산 — 동 % → 시군구 % → 광역시 % → 갤러리 카드 가용성]
      ↓
[Data Studio 보드 즉시 갱신] + [0018_blog 발행 큐 자동 추가]
      ↓
[블로그 발행 → SEO 인덱싱 → 외부 가시화]
```

→ 사용자 입력 1회 = 1시간 후 시스템 전체 + 외부 SEO까지 갱신.

---

## 5. 데이터셋 자기 운영 메타 스키마

```json
{
  "key": "kosis_living_pop",
  "ko": "생활인구",
  "source_org": "KOSIS",
  "credentials": {
    "type": "api_key",
    "env_var": "KOSIS_API_KEY",
    "obtain_url": "https://kosis.kr/...",
    "registered_at": "2026-04-15",
    "expires_at": "2027-04-15",
    "rate_limit": "5,000 req/day"
  },
  "difficulty": {
    "level": "easy",
    "hours_estimated": 4,
    "blockers": []
  },
  "schedule": {
    "frequency": "monthly",
    "cron": "0 9 5 * *",
    "next_run_at": "2026-06-05T09:00:00",
    "last_run_status": "success",
    "consecutive_failures": 0
  },
  "scope": {
    "geo_unit": "읍면동",
    "current_dongs_covered": 38,
    "target_dongs": 3500,
    "current_months_covered": 60
  },
  "quality": {
    "schema_path": "data_raw/kosis_living_pop/schema.json",
    "data_marker_default": "real"
  },
  "ops": {
    "alert_on_failure": true,
    "max_retries": 3
  }
}
```

---

## 6. 행정 위계 보드 — 4 레벨 드릴다운

- Level 1: 광역시 17개 + 도
- Level 2: 시군구 약 250개
- Level 3: 읍면동 약 3,500개
- Level 4: 동별 데이터셋 상세

자동 집계: 동 % → 시군구 % → 광역시 %.

---

## 7. 블로그 결합 (0018_blog) — 자동 발행 모델

### 발행 패턴
- A (동별): 동 첫 70% 도달 또는 +5%p 변동 → 자동
- B (시군구·광역시 종합): 매월 1일 → 사람 5분 검토
- C (도메인 인사이트): 분기 → 사람 큐레이션

### 룰
- completion_pct ≥ 70 + real_pct ≥ 50 → 발행 적격
- 마커 표시 의무: ●실 / ○합성 / ◐추정
- 출처 표기 의무: 글 하단 자동
- deep-link 포함: TowninAlpafold 콘솔로 직접 진입

### 효과 예측
| 시점 | 글 수 | 월 방문 | 인바운드 | 데이터 협력 |
|---|---|---|---|---|
| 1개월 | 30 | 100 | 0 | 0 |
| 3개월 | 100 | 1,000 | 1~2 | 0~1 |
| 6개월 | 300+ | 5,000 | 5~10 | 1~2 |
| 1년 | 1,000+ | 30,000 | 20+ | 5+ |

---

## 8. 점진 구축 로드맵 (12주 → 1년)

| Phase | 기간 | 목표 |
|---|---|---|
| 0 | Week 0 | 게이트웨이 1셀 (의정부 금오동 × KOSIS × 2024-12) |
| 1 | Week 1-3 | 공공 OD 5종 × 1동 |
| 2 | Week 4-6 | 30개 동 수평 확장 |
| 3 | Week 7-9 | 변수 깊이 5종 추가 |
| 4 | Week 10-12 | 유료/협력 데이터 (BC카드, HIRA) |
| 5 | Q3-Q4 | 전국 확장 (130 → 500 → 3,500) |

### KPI 누적
| 지표 | 1개월 | 3개월 | 6개월 | 1년 |
|---|---|---|---|---|
| 데이터셋 수 | 5 | 7 | 10 | 15+ |
| 동 커버 | 30 | 100 | 500 | 2,000+ |
| 실데이터 비중 | 45% | 60% | 70% | 80%+ |
| 갤러리 카드 가용성 | 4/12 | 9/12 | 11/12 | 12/12 |
| 블로그 글 수 | 30 | 100 | 300+ | 1,000+ |

---

## 9. 안전 장치 (무인 운영 신뢰)

| 장치 | 작동 |
|---|---|
| 자격증명 만료 알림 | expires_at 30일 전 자동 |
| rate limit throttle | 80% 도달 시 다음 cron 연기 |
| 3회 연속 실패 → 일시 정지 | frequency: blocked 자동 |
| schema drift 알림 | quarantine + 검토 대기 |
| 데이터 마커 강제 | 모든 레코드 ●/○/◐ |
| 변동 폭 임계 | +20%p 이상 → 사람 검토 |
| 블로그 발행 게이트 | 85% 미만 → 사람 검토 |
| 수동 일시 정지 토글 | UI 토글로 ETL OFF |

---

## 10. 사용자 운영 시간 — 주 약 30~45분

| 활동 | 빈도 | 시간 |
|---|---|---|
| 새 데이터셋 등록 | 주 1~2건 | 10분/건 |
| API 키 발급 + .env | 데이터셋당 1회 | 10분 |
| 보드 검토 | 주 1회 | 5분 |
| 블로그 발행 큐 검토 | 주 1회 | 10분 |
| 분기 도메인 인사이트 글 | 분기 1회 | 2시간 |

---

## 11. 등록할 자식 이슈 트리 (17개)

```
DATA_SAAS_MASTER_PLAN-001 (FEATURE_PLAN, P1)
├── 인프라 트랙 (5)
│   ├── DATASET_REGISTRY_SCHEMA-001
│   ├── ETL_SCHEDULER_ENGINE-001
│   ├── MANIFEST_V2_HIERARCHY-001
│   ├── ADMIN_HIERARCHY_MASTER-001
│   └── DATA_QUALITY_GATE-001
├── UI 트랙 (3)
│   ├── DATA_STUDIO_DATASET_MENU-001
│   ├── DATA_ASSETS_BOARD_HIERARCHY-001
│   └── DATA_BUILDUP_FEED-001
├── 첫 5개 데이터셋 (Phase 1)
│   ├── ETL_KOSIS_LIVING_POP-001
│   ├── ETL_LOCALDATA_BIZ-001
│   ├── ETL_NTS_BIZREG-001
│   ├── ETL_MOLIT_LANDPRICE-001
│   └── ETL_VWORLD_GEOJSON-001
└── 블로그 결합 (4) + 운영 트랙 (2 — 협상/KPI/알림)
    ├── BLOG_INTEGRATION_PLAN-001
    ├── BLOG_TEMPLATE_3KIND-001
    ├── BLOG_PUBLISH_QUEUE-001
    ├── BLOG_FIRST_POST_YEOKSAM1-001
    ├── DATA_PARTNERSHIP_NEGOTIATION-001 (HIRA + BC카드)
    └── DATA_SAAS_KPI_TRACKING-001
```

---

## 12. 다음 1주 실행 (사용자 컨펌 후)

### 코딩 작업 (총 ~600줄)
1. `data_raw/_registry/datasets.json` 스키마 + 5개 빈 자리
2. `data_raw/_master/admin_hierarchy.json` (VWorld 1회 추출)
3. `etl_scheduler.py` 단일 스크립트
4. `recalculate_manifest_after_etl()`
5. Data Studio "데이터셋" 탭 + 등록 폼

### 사용자 작업 (~30분)
1. KOSIS API 키 발급 (10분)
2. .env 등록 (5분)
3. 등록 폼 입력 (5분)
4. 첫 데이터셋 즉시 실행 → 결과 확인 (10분)

### 검증 기준
- 의정부 금오동 × KOSIS 한 셀 자동 ETL 작동
- Data Studio 데이터셋 표 + 등록 폼 작동
- manifest.json 자동 재계산
- 보드 변동 미니 피드 표시

---

## 13. 한 줄 결론

> datasets.json 1개 = 데이터 SaaS 운영 = 보드 자동 갱신 = 블로그 자동 발행 = 외부 영업·SEO·협력 자동 출구. 사람 손은 주 1시간 미만. 12주 후 갤러리 12 카드 75% 작동, 1년 후 전국 2,000동 + 블로그 1,000글.
