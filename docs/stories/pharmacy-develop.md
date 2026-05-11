# 약국 점포개발 평가 — User Story 명세서

> 작성: product-manager (Harness `USER_STORY_PHARMACY_DEVELOP-001`)
> 일자: 2026-05-04
> 부모: `FEATURE_DOMAIN_MENU-001` · IA 문서: [`docs/domain-menu-ia.md`](../domain-menu-ia.md)
> 브랜드 토큰: [`.claude/brand-dna.json`](../../.claude/brand-dna.json)
> 비파괴 원칙: 기존 4모드(Gallery/Explore/Analyze/Decide) + 6보조 모드는 그대로 두고, 상단 글로벌 네비에 추가될 `[약국 ▾] → 점포개발` 메뉴의 한 화면을 신규로 만든다.

---

## A. 사용자 스토리 (Job-To-Be-Done)

### 메인 스토리
**As-a** 약국 본사 신규점포 개발담당자
**I-want** 후보 입지 주소 한 줄을 입력하면 0~100 적합도 점수 + pLDDT 신뢰도 등급 + Top 강점/약점 근거를 즉시 보고
**So-that** 임대 계약 결정 전에 데이터로 정당성을 확보하고, 본사 보고서에 근거를 그대로 옮길 수 있다.

### 보조 스토리 (1차 스코프 IN)
- **B1.** As-a 개발담당자, I-want 결과 카드의 "Decide에서 보기" 버튼으로 cone(p10/p50/p90)이 그려진 Decide 모드로 한 번에 점프하기, So-that 동일 후보지를 시간 축에서 다시 검증할 수 있다.
- **B2.** As-a 개발담당자, I-want 평가 결과 하단에서 비슷한 동(comparable_dongs Top 5)과 점수 비교를 보기, So-that 후보지의 상대적 매력도를 빠르게 가늠한다.

### 1차 스코프 OUT (다음 분기/별도 이슈)
| 기능 | 사유 | 후속 이슈 후보 |
|---|---|---|
| 후보지 즐겨찾기/즐겨찾기 비교 보드 | 단일 평가 흐름이 안정된 뒤에 다인 협업 기능으로 확장 | `USER_STORY_PHARMACY_DEVELOP_FAVORITES-001` (P3) |
| PDF 보고서 출력 | `report-pdf-builder` skill 별도 트랙 | `REPORT_PHARMACY_DEVELOP_PDF-001` (P2) |
| 평가 이력(과거 후보 30일 보관) | 백엔드 storage 도입 필요 → 본 프로젝트 정적 호스팅 정책과 충돌 | `INFRA_PHARMACY_HISTORY-001` (P3, blocked by infra 결정) |
| 다인 코멘트/리뷰 | 협업 모듈 → 별도 phase | — |
| ML 학습 가중치 자동 튜닝 | F절 1차 안 가중치 검증 후 진행 | `MODEL_PHARMACY_DEVELOP_TUNE-001` (P2) |

> Karpathy #2 (Simplicity): 1차 스코프 = **단일 주소 평가 + 결과 카드 1개 + Decide deep-link**. 그 외는 모두 후순위.

---

## B. Acceptance Criteria (Given-When-Then)

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | 후보 주소 (예: "의정부시 금오동")가 입력 폼에 채워지고 필수 검증 통과 | "평가 실행" CTA 클릭 | 3초 이내 결과 카드에 `score`(정수), `grade`(plddt 4단계 라벨), `top_drivers[3]`, `comparable_dongs[≤5]`, `cone_link` URL이 렌더된다. |
| AC-2 | `score >= 90` (`grade = high`) | 결과 카드 렌더 | 좌측 보더와 등급 배지가 brand-dna `plddt_high = #00529B`로 표시되고, 등급 라벨은 "적극 추천 (high)"으로 노출. |
| AC-3 | `50 <= score < 70` (`grade = low`) | 결과 카드 렌더 | 좌측 보더 `#FED766`, 등급 라벨 "신중 검토 (low)", 상단 인라인 안내 "근거 검토를 권장합니다" 1줄. |
| AC-4 | 입력 주소를 geocoding으로 매칭 실패 (`real_adm_cd` null) | "평가 실행" 클릭 | 폼 하단에 inline 에러 "주소를 찾을 수 없습니다. 동/구/시 단위로 다시 입력해 주세요" 표시 + CTA 비활성 해제(재시도 가능). 결과 카드 영역은 변경 없음. |
| AC-5 | 후보지 반경 500m 의원수 = 0 (처방원 부재) | 평가 실행 → 결과 카드 렌더 | `top_drivers`에 `{feature:"반경 500m 의원수", contribution:<0, direction:"negative"}`가 반드시 포함되고, "약점" 섹션 최상단에 표시. |
| AC-6 | 결과 카드 노출 상태 | 카드 우측 보조 버튼 "Decide에서 보기" 클릭 | `switchMode('decide')` 호출되며 URL이 `?mode=decide&ctx=pharmacy.develop&address=<encoded>` 로 갱신된다. Decide 모드 도착 시 해당 동이 자동 선택되고, 상단 헤더에 "← 약국 점포개발 평가로 돌아가기" 복귀 링크가 노출된다. |
| AC-7 | 동일한 주소로 평가 실행 2회 연속 | 두 번째 결과 렌더 | 동일한 `score` ± 0 (캐시 또는 결정성 보장). `trace.generated_at`은 갱신, `trace.model_version`은 동일. |

---

## C. 입력/출력 스키마

### 입력
- 인라인 요약: `address (필수)`, `area_pyeong`, `rent_monthly_krw`, `operator_capital_krw`, `expected_rx_per_day` (모두 선택)
- 자동 계산 (geo 기반): population, visitors_total, biz_count, transit_score, 60대 인구 비중, 평균 소득 분위, 반경 500m 의원수, 반경 500m 약국수
- 상세 정의: [`docs/domain-menu-ia.md#b1-pharmacydevelop--입력`](../domain-menu-ia.md#b1-pharmacydevelop--입력)

### 출력
- 공통 필드: `score`, `grade`, `top_drivers[]`, `cone`, `recommendation`, `trace` — [C.1 공통 출력 컨벤션](../domain-menu-ia.md#c1-공통-출력-컨벤션)
- 약국 점포개발 추가: `comparable_dongs[]`, `expected_rx_cone` — [C.2 모델별 추가 필드](../domain-menu-ia.md#c2-모델별-추가-필드)

---

## D. 점수 계산 룰 (1차 안 — 가중치 표)

| 요인 | 가중치 | 계산 방법 | 데이터 출처 |
|---|---:|---|---|
| 인구 밀도 | 0.18 | (동 인구 / 동 면적 km²) → 분위 0~100 점수 | `simula_data_real.json` |
| 60대 이상 인구 비중 | 0.15 | 노인 비중 ↑ → 점수 ↑ (병원 처방 수요 ∝ 노인) | `simula_data_real.json` |
| 반경 500m 의원수 | 0.20 | 의원 ≥ 5 → 만점, 0 → 0점 (선형) | TBD: `ETL_PHARMACY_DATA-001` 결과에 따름 (HIRA 의원 분포). 미완성 시 동 단위 `biz_count` 기반 더미. |
| 반경 500m 경쟁 약국수 | -0.18 | 경쟁 ↑ → 감점 (역가중) | TBD: `ETL_PHARMACY_DATA-001` (HIRA 약국 분포). 미완성 시 0 가정. |
| 평균 소득 분위 | 0.10 | 중상 분위(7~9분위) 최대점, 양 극단 감점 | `simula_data_real.json` |
| 임대료 (입력값) | -0.12 | 동 평균 임대료 대비 ratio (1.0 기준 ±) | 입력 `rent_monthly_krw` 미입력 시 중립 0점 |
| 유동인구 (출퇴근/생활) | 0.07 | `visitors_total` 분위 점수 | `simula_data_real.json` |
| **합계** | **1.00** | min-max 정규화 → 0~100 정수 | — |

> 1차 안. 후속 `MODEL_PHARMACY_DEVELOP_TUNE-001`에서 ML 학습으로 가중치 교체 가능.
> top_drivers[3]는 위 요인 중 |contribution| 상위 3개를 SHAP-style로 노출 (positive/negative direction 명시).

### D-1. 정규화 룰 (FIX_BUG_PHARMACY_SCORER_NORMALIZER-001 — 2026-05-04)

각 raw feature를 `[0,1]` 범위로 변환하는 룰. D절은 가중치만 정의했고 분모(만점 기준)가 누락되어 있었음. 본 절에서 명시. **`viz/plugins/pharmacy-scorer.js`의 `NORMALIZERS` 객체와 1:1 동기화**되어야 함:

| 요인 | 정규화 룰 | 만점 기준 | 도메인 근거 |
|---|---|---|---|
| `population_density` | `clamp01(v / 50)` | 50천명/km² | 서울 평균 ~25천명/km² 대비 2배 = 만점 |
| `elderly_ratio` | `clamp01(v / 0.30)` | 30% | 처방 수요 포화 분위 |
| `clinics_within_500m` | `clamp01(v / 50)` | 50개 | 강남 역삼1동(48개) 같은 초고밀 의원지구를 만점으로 — 외곽동 변별력 + 초밀집지 상한 동시 확보 |
| `competitor_pharmacies_within_500m` | `clamp01(v / 25)` | 25개 | 강남 역삼1동(24개) 같은 초포화지를 감점 만점으로 — 비례 분모 (clinics 50 / comp 25 = 2:1, "의원 2개당 약국 1개" 도메인 균형) |
| `income_quantile` | `1 - |v - 7.5| / 5` | 7.5분위 최적 (역U) | 너무 부유하면 OTC 약 적음, 너무 빈곤하면 마진 ↓ |
| `rent_ratio` | `clamp01(v / 2)` | 2.0배 | 동 평균의 2배까지 수용 |
| `visitors_total` | `clamp01(v / 1_000_000)` | 100만명/월 | 도심 평균 |

> **분모 변경 시 룰**: `viz/plugins/pharmacy-scorer.js`의 `NORMALIZERS`와 본 표를 **반드시 동시에** 갱신. 한쪽만 바꾸면 코드↔명세 drift 발생.

### D-2. 도메인 해석 — 왜 의정부 금오 (91) > 강남 역삼 (53)?

본 모델은 **단순 시장 크기**가 아닌 **신규 진입자 관점의 유효 시장 점유율 + 마진 가능성**을 측정한다:

| 측면 | 강남 역삼1동 | 의정부 금오동 |
|---|---|---|
| 의원 수 (수요) | 48개 (큰 시장) | 8개 (작은 시장) |
| 경쟁 약국 (공급) | 24개 | 2개 |
| 의원/약국 비율 | 2.0 (포화 직전) | 4.0 (저경쟁) |
| 임대료 (마진 압박) | 2.20배 | 0.40배 (5.5× 차이) |
| 60대 비중 (처방 수요 깊이) | 9% | 28% |

→ **1차 모델 가설**: "신규 진입자의 마진 + 경쟁 회피" 우선. 강남이 직관적 우위로 보이는 것은 **기존 운영자/대형 체인 관점** (시장 크기 우위 + 브랜드 파워로 포화 극복).

→ **Wave 2 권장 (`PHARMACY_SCORER_ML_PERSONA-001`)**: 약국 본사 실제 매출/생존 데이터로 가중치 ML 학습 + 페르소나 분리 (대형 체인 = 시장 크기 가중 ↑ vs 개인 약국 = 마진 가중 ↑) + 도시 코호트 분리 (도심/부도심/외곽).

---

## E. pLDDT 등급 매핑 (`brand-dna.json` 인용)

| score 구간 | grade | brand 토큰 | hex | 의미 라벨 |
|---|---|---|---|---|
| ≥ 90 | `high` | `plddt_high` | `#00529B` | 적극 추천 |
| 70 ~ 89 | `mid` | `plddt_mid` | `#5BC0EB` | 추천 |
| 50 ~ 69 | `low` | `plddt_low` | `#FED766` | 신중 검토 |
| < 50 | `poor` | `plddt_poor` | `#C9485B` | 비추천 |

> brand-dna `anti_patterns`: "AlphaFold pLDDT 색상 체계 임의 변경" — 위 4색 외 다른 색 금지.

---

## F. 화면 명세 (와이어프레임 텍스트)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [홈] > [약국 ▾] > 점포개발                              (브레드크럼) │
├──────────────────────────────────────────────────────────────────────┤
│  [좌 60% — 입력 폼]                  │ [우 40% — 결과 카드]           │
│                                       │                                │
│  주소 *                               │  ┌─ pLDDT 등급 ──────────┐    │
│  [_______________________________]    │  │ ▌ 87 / 100  추천 (mid) │    │
│  (autocomplete 지원, 빈값 시 비활성)  │  └────────────────────────┘    │
│                                       │                                │
│  평형 (선택)         [____] 평        │  Top 강점                      │
│  임대료 (선택)       [____] 만원/월   │  • 반경 500m 의원수 (+18)      │
│  운영자본 (선택)     [____] 만원      │  • 60대 비중 (+12)             │
│  기대 처방건수 (선택)[____] /일       │  • 인구 밀도 (+8)              │
│                                       │                                │
│  ┌──────────────────────┐             │  Top 약점                      │
│  │  ▶ 평가 실행 (CTA)   │ ← primary   │  • 경쟁 약국수 (-9)            │
│  └──────────────────────┘             │  • 임대료 ratio (-4)           │
│                                       │                                │
│  (입력 안내: brand voice 톤)          │  ┌──────────────────────┐      │
│  "후보 주소를 입력하면 적합도 평가가  │  │ Decide에서 보기 →    │ 보조│
│   시작됩니다."                        │  └──────────────────────┘      │
├──────────────────────────────────────────────────────────────────────┤
│  비교 매물 (comparable_dongs Top 5) — 표 (동명/score/grade/주요 차이) │
└──────────────────────────────────────────────────────────────────────┘
```

### 명세 요약
- **상단**: 브레드크럼 `홈 > 약국 ▾ > 점포개발`. 컨텍스트 배지(`pharmacy.develop`).
- **좌 60%**: 입력 폼. 주소만 필수. 나머지 4개 필드 선택. 화면당 primary CTA 1개 = "평가 실행". (`primary_action_per_screen: MUST_EXIST`)
- **우 40%**: 결과 카드. 큰 score 숫자 + 좌측 보더 색상으로 grade 즉각 식별. Top 강점/약점 각 ≤ 3개. 보조 버튼 "Decide에서 보기" (secondary, outline).
- **하단**: comparable_dongs 테이블. 빈 상태 시 "비교 가능한 동을 찾는 중입니다." (brand voice: 절제된 안내).
- **빈 상태(평가 전)**: 우 40% 영역에 "후보 주소를 입력하면 적합도 평가가 시작됩니다" 1줄 안내 (brand_voice: 분석가의 절제). 일러스트 없음 (anti-pattern).
- **에러 상태**: 주소 매칭 실패 inline 에러 + 폼 활성 유지 (AC-4).

### Brand 자가 검증 (UI 자식 이슈에서 적용)
- [ ] hero_color `#00529B`를 "평가 실행" CTA 배경에 사용.
- [ ] Top 강점/약점 색상은 `plddt_high`(긍정) / `plddt_poor`(부정) 또는 `text_secondary` 톤만 사용. 무지개/그라디언트 금지.
- [ ] CTA는 화면당 정확히 1개 (보조 버튼은 outline/ghost로 시각 weight 차별).
- [ ] 0.5초 룰: score 숫자 → 등급 라벨 → 다음 액션(Decide에서 보기) 이 좌→우→하 시선 흐름 안에 배치.
- [ ] 일러스트/3D/네온 없음.

---

## G. 분해 — 자식 이슈 (4개)

모두 BLOCKED, `depends_on = USER_STORY_PHARMACY_DEVELOP-001`. 본 USER_STORY 완료(이 명세서 작성) 시 일괄 READY.

### G.1 `GENERATE_CODE_PHARMACY_DEVELOP_UI-001` (P1, agent-harness, sonnet)
- 범위: 입력 폼 + 결과 카드 + Decide deep-link 트리거.
- files:
  - `components/pharmacy-develop.js` (신규) — 컴포넌트
  - `index.html` (surgical: `[약국 ▾]` 드롭다운에 "점포개발" 항목 추가만)
  - `css/pharmacy.css` (신규) — pLDDT 보더/배지/카드 스타일
- 점수 계산은 자리만 잡고 `compute_pharmacy_develop_score()` 함수 import (G.2에서 구현).

### G.2 `GENERATE_CODE_PHARMACY_DEVELOP_SCORER-001` (P1, agent-harness, sonnet)
- 범위: 점수 계산 룰(D절) + comparable_dongs + top_drivers 계산.
- files:
  - `viz/plugins/pharmacy-scorer.js` (신규) — 가중치/계산 로직
- 데이터: `simula_data_real.json` 동 단위 데이터 + 외부 의원/약국 더미. ETL_PHARMACY_DATA-001 완료 시 더미 → 실데이터 교체 (별도 follow-up 이슈).
- 결정성 보장: 동일 주소 입력 → 동일 score (AC-7).
- `parallel_with: ETL_PHARMACY_DATA-001` (더미 모드로 우선 동작).

### G.3 `RUN_TESTS_PHARMACY_DEVELOP-001` (P1, test-harness, sonnet)
- 범위:
  - **단위 테스트**: D절 가중치 합 = 1.0 검증, 경계값 테스트(score 0/49/50/69/70/89/90/100), grade 매핑 4분기 모두 발생, top_drivers 정렬.
  - **캐릭터 저니 (Playwright)** — 페르소나: 약국 본사 개발담당자
    | 스텝 | 행동 | 기대 결과 | 스크린샷 |
    |---|---|---|---|
    | 1 | 페이지 로드 | 글로벌 네비에 `[약국 ▾]` 노출 | `/tmp/journey-pharmacy-develop-1.png` |
    | 2 | `[약국 ▾]` → "점포개발" 클릭 | URL `?mode=pharmacy.develop`, 입력 폼 + 빈 상태 결과 카드 | `/tmp/journey-pharmacy-develop-2.png` |
    | 3 | 주소 입력 "의정부시 금오동" | 폼 valid 상태, CTA 활성 | `/tmp/journey-pharmacy-develop-3.png` |
    | 4 | "평가 실행" 클릭 | 3초 이내 결과 카드 렌더 (score/grade/top_drivers) | `/tmp/journey-pharmacy-develop-4.png` |
    | 5 | "Decide에서 보기" 클릭 | `?mode=decide&ctx=pharmacy.develop&address=...` 도달, 해당 동 자동 선택 | `/tmp/journey-pharmacy-develop-5.png` |

### G.4 `BIZ_VALIDATE_PHARMACY_DEVELOP-001` (P2, biz-validator, sonnet)
- 범위: 시나리오 갭 검증.
  - **4단계 grade 발생 시나리오**: 4개 주소 샘플 (high/mid/low/poor 각 1)
  - **엣지 케이스**:
    1. 반경 500m 의원수 = 0 → top_drivers에 negative 명시 (AC-5)
    2. 반경 500m 경쟁 약국수 = 0 → score 가산
    3. 임대료 미입력 → 중립 0점 적용 확인
    4. 동 매핑 실패 (경계 좌표/오타) → AC-4 에러 처리
- 결과: BIZ_FIX P0 자동 spawn (CRITICAL 갭 발견 시).

---

## H. 의존성 / 병렬

| 이슈 | 의존 | 병렬 |
|---|---|---|
| G.1 UI | USER_STORY (this) | G.2 scorer와 병렬 가능 (interface 계약 = `compute_pharmacy_develop_score(input) → output schema C.1+C.2`) |
| G.2 SCORER | USER_STORY (this) | G.1 UI와 병렬. `parallel_with: ETL_PHARMACY_DATA-001` (더미 모드) |
| G.3 RUN_TESTS | G.1 + G.2 둘 다 완료 | — |
| G.4 BIZ_VALIDATE | G.2 완료 | G.3와 병렬 |
| `ETL_PHARMACY_DATA-001` | (이미 READY) | G.2와 병렬. 완료 시 더미 → 실데이터 교체 follow-up. |

---

## I. 마무리 체크리스트 (product-manager 자가 검증)

- [x] `docs/stories/pharmacy-develop.md` 생성 (이 파일).
- [x] 1차 스코프 OUT 표 명시 (Karpathy #2 Simplicity).
- [x] AC 5~7개 (실제 7개) Given-When-Then.
- [x] 점수 계산 가중치 합 = 1.00.
- [x] pLDDT 색상 4단계 brand-dna에서 인용.
- [x] 자식 이슈 4개 분해 (UI/Scorer/Test/Biz).
- [x] ETL_PHARMACY_DATA-001 의존성 + 더미 fallback 명시 ("TBD" 표기).
- [x] code 파일 직접 수정 없음 (Karpathy #3 Surgical) — 본 이슈에서 만진 파일은 docs/와 registry.json만.
