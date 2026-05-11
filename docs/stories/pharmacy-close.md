# 약국 폐업평가 — User Story 명세서

> 작성: product-manager (Harness `USER_STORY_PHARMACY_CLOSE-001`)
> 일자: 2026-05-04
> 부모: `FEATURE_DOMAIN_MENU-001` · IA 문서: [`docs/domain-menu-ia.md`](../domain-menu-ia.md)
> 형제 모델: [`docs/stories/pharmacy-develop.md`](./pharmacy-develop.md) (구조 동일, 색 의미 반대 — H절 가드 참조)
> 브랜드 토큰: [`.claude/brand-dna.json`](../../.claude/brand-dna.json)
> 비파괴 원칙: 기존 4모드(Gallery/Explore/Analyze/Decide) + 6보조 모드 그대로. 상단 글로벌 네비 `[약국 ▾]` 드롭다운에 "폐업평가" 항목 1개를 추가하여 단일 화면을 신규로 만든다.

---

## A. 사용자 스토리 (Job-To-Be-Done)

### 메인 스토리
**As-a** 약국 본사 운영/회계 담당자
**I-want** 운영 중 점포의 폐업 위험도를 분기마다 0~100 점수로 측정하고, 유사 동의 Kaplan-Meier 생존곡선으로 12개월 생존확률 + 95% CI를 함께 보고
**So-that** 유지/관찰/철수 의사결정을 데이터로 정당화하고, 임대 갱신·폐점 손실을 최소화한다.

### 보조 스토리 (1차 스코프 IN)
- **B1.** As-a 운영담당자, I-want 결과 카드의 "Analyze에서 시계열 보기" 버튼으로 매출/처방 시계열 비교가 그려진 Analyze 모드로 한 번에 점프하기, So-that 동일 점포의 추세 변곡점을 직접 확인한다.
- **B2.** As-a 운영담당자, I-want 결과 카드 하단에서 유사 동(peer_dongs Top 5)의 KM 생존곡선과 우리 점포 곡선을 한 차트에 겹쳐 보기, So-that 동급 점포 대비 상대적 생존 전망을 가늠한다.

### 1차 스코프 OUT (다음 분기/별도 이슈)
| 기능 | 사유 | 후속 이슈 후보 |
|---|---|---|
| 점포개발 ↔ 폐업평가 동시 비교 화면 | 색 의미 반대(H절) → 인지 혼선. 단일 모델 흐름 안정 후 phase 2 | `USER_STORY_PHARMACY_DUAL_COMPARE-001` (P3) |
| ML 학습 가중치 자동 튜닝 | D절 1차 안 가중치 검증 후 진행 | `MODEL_PHARMACY_CLOSE_TUNE-001` (P2) |
| PDF 보고서 출력 | `report-pdf-builder` skill 별도 트랙 | `REPORT_PHARMACY_CLOSE_PDF-001` (P2) |
| 분기 자동 알림 (hazard_score 임계 초과 시 push) | 백엔드 storage + 알림 채널 도입 필요 → 본 프로젝트 정적 호스팅 정책과 충돌 | `INFRA_PHARMACY_ALERT-001` (P3, blocked by infra 결정) |
| 점포별 평가 이력(분기 30개 보관) | 백엔드 storage | `INFRA_PHARMACY_HISTORY-001` (P3) |
| CSV 매출 일괄 업로드 → 일괄 평가 보드 | 1차는 단일 점포만 | — |

> Karpathy #2 (Simplicity): 1차 스코프 = **단일 점포 평가 + 결과 카드 1개 + KM 곡선 + Analyze deep-link**. 그 외는 모두 후순위.

---

## B. Acceptance Criteria (Given-When-Then)

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | `store_id` 또는 `address` + `operating_months` 입력, CSV 매출 업로드(선택) | "평가 실행" CTA 클릭 | 3초 이내 결과 카드에 `hazard_score`(0~100 정수), `grade`(역방향 plddt 4단계), `top_drivers[3]`, `peer_dongs[≤5]`, `km_curve`, `action_recommendation ∈ {유지, 관찰, 철수}`이 렌더된다. |
| AC-2 | `hazard_score >= 70` (`grade = high` = 위험) | 결과 카드 렌더 | 좌측 보더 `#C9485B`, 등급 배지 "위험 (high)", `action_recommendation = "철수 검토"`, 상단 인라인 경고 1줄 "폐업 위험 임계 초과 — 데이터 검토 필수". |
| AC-3 | `30 <= hazard_score < 50` (`grade = low`) | 결과 카드 렌더 | 좌측 보더 `#5BC0EB`, 등급 라벨 "낮음 (low)", `action_recommendation = "유지"`, 상단 안내 없음. |
| AC-4 | 매출/처방 시계열 CSV 미업로드 + 외부 데이터도 부재 | "평가 실행" 클릭 | 결과 카드 상단에 회색 배지 "추정 모드 — 운영 데이터 부재 (낮은 신뢰도)" 노출 + `trace.confidence = "low"`. score는 자동계산 필드만으로 산출. |
| AC-5 | 결과 카드 노출 상태 | 카드 하단 KM 곡선 영역 렌더 | 우리 점포 + peer_dongs 5개의 12개월 생존확률 곡선, 각 곡선에 95% CI 음영(`stroke-opacity 0.18`). 컴포넌트는 `viz/plugins/km-curve.js` (UI_BENCHMARK_KM_CURVE-001 산출물) 재활용. |
| AC-6 | 결과 카드 노출 상태 | 카드 우측 보조 버튼 "Analyze에서 시계열 보기" 클릭 | `switchMode('analyze')` 호출되며 URL이 `?mode=analyze&ctx=pharmacy.close&store_id=<id>&section=benchmark` 로 갱신된다. Analyze 모드 도착 시 해당 동/점포의 매출·처방 시계열이 자동 활성, 상단 헤더에 "← 약국 폐업평가로 돌아가기" 복귀 링크 노출. |
| AC-7 | `operating_months < 6` (신규 점포) | "평가 실행" 클릭 | 결과 카드에 `hazard_score`는 표시하되, KM 곡선 영역은 "운영 6개월 미만 — 생존곡선 적용 보류" 안내 박스로 대체 + `trace.km_applied = false`. |

---

## C. 입력/출력 스키마

### 입력
- 인라인 요약: `store_id (필수 — 또는 address)`, `address (선택 — store_id 없을 때)`, `operating_months (필수, 정수 ≥ 1)`, `recent_sales_csv (선택, 12M 매출 시계열 CSV)`
- 자동 계산 (geo + 외부 데이터 기반):
  - 동 인구 감소율 (YoY)
  - 반경 500m 의원 폐업/이전 카운트 (12M)
  - 반경 500m 경쟁약국 신규 진입 카운트 (12M)
  - 동 평균 임대가 변동률 (YoY)
  - 유동인구 추세 (visitors_total slope)
- 상세 정의: [`docs/domain-menu-ia.md#b2-pharmacyclose--입력`](../domain-menu-ia.md#b2-pharmacyclose--입력)

### 출력
- 공통 필드: `score(=hazard_score)`, `grade`, `top_drivers[]`, `recommendation`, `trace` — [C.1 공통 출력 컨벤션](../domain-menu-ia.md#c1-공통-출력-컨벤션)
- 약국 폐업평가 추가: `hazard_score`, `km_curve`, `peer_dongs[]`, `recommendation.label ∈ {유지, 관찰, 철수}` — [C.2 모델별 추가 필드](../domain-menu-ia.md#c2-모델별-추가-필드)

---

## D. Hazard Score 계산 룰 (1차 안 — 가중치 표)

| 요인 | 가중치 | 방향 | 계산 방법 | 데이터 출처 |
|---|---:|:---:|---|---|
| 매출 12M YoY | 0.25 | 음(-) | YoY 감소 ↑ → hazard ↑ (선형, -50% 이상은 만점) | 입력 CSV (없으면 0 가정 + confidence=low) |
| 처방건수 12M YoY | 0.20 | 음(-) | 감소 ↑ → hazard ↑ | TBD: `ETL_PHARMACY_DATA-001` (HIRA 처방 데이터). 없으면 매출 추세로 대체 |
| 동 인구 YoY | 0.10 | 음(-) | 인구 감소 ↑ → hazard ↑ | `simula_data_real.json` |
| 반경 500m 의원 폐업/이전 카운트 (12M) | 0.15 | 양(+) | 카운트 → 분위 점수 (≥ 3 → 만점) | TBD: `ETL_PHARMACY_DATA-001` 결과. 미완성 시 동 단위 더미 |
| 반경 500m 경쟁약국 신규 진입 카운트 (12M) | 0.12 | 양(+) | 신규 진입 카운트 (≥ 2 → 만점) | TBD: `ETL_PHARMACY_DATA-001` (HIRA 약국). 미완성 시 0 가정 |
| 동 평균 임대가 YoY | 0.08 | 양(+) | 임대가 상승 → 마진 압박 → hazard ↑ | `simula_data_real.json` (없으면 0 가정) |
| 운영 개월수 (operating_months) | -0.10 | 음(-) | 오래 운영 = 안정 ↑ → hazard ↓ (60M에서 만점 보호) | 입력 |
| **합계** | **1.00** | | min-max 정규화 → 0~100 정수 | — |

> 1차 안. 후속 `MODEL_PHARMACY_CLOSE_TUNE-001`에서 ML 학습으로 가중치 교체 가능.
> top_drivers[3]는 위 요인 중 |contribution| 상위 3개를 SHAP-style로 노출 (positive=hazard 가중 / negative=hazard 완화).
> 결정성 보장: 동일 입력 → 동일 hazard_score (캐시 또는 deterministic compute).

---

## E. pLDDT 등급 매핑 — 역방향 (hazard는 높을수록 위험) ⚠

| hazard | grade | brand 토큰 | hex | 의미 라벨 | action_recommendation |
|---|---|---|---|---|---|
| < 30 | `very_low` | `plddt_high` | `#00529B` | 안전 | 유지 |
| 30 ~ 49 | `low` | `plddt_mid` | `#5BC0EB` | 낮음 | 유지 |
| 50 ~ 69 | `medium` | `plddt_low` | `#FED766` | 주의 | 관찰 |
| ≥ 70 | `high` | `plddt_poor` | `#C9485B` | 위험 | 철수 검토 |

> ⚠ **역매핑 주의**: 점포개발 score(`#00529B` = 좋음)와 폐업평가 hazard(`#C9485B` = 나쁨)는 같은 brand 팔레트를 쓰지만 **의미가 반대**. UI 구현 시 score → grade 변환 함수에서 hazard 영역은 색상을 역매핑한다. 자세한 충돌 방지 가드는 H절 참조.

> brand-dna `anti_patterns`: "AlphaFold pLDDT 색상 체계 임의 변경" — 위 4색 외 다른 색 금지.

---

## F. 화면 명세 (와이어프레임 텍스트)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [홈] > [약국 ▾] > 폐업평가                              (브레드크럼) │
├──────────────────────────────────────────────────────────────────────┤
│ ⓘ 위험도 — 높을수록 나쁨 (점포개발 적합도와 색 의미 반대)             │
├──────────────────────────────────────────────────────────────────────┤
│  [좌 50% — 입력 폼]                  │ [우 50% — 결과 카드]           │
│                                       │                                │
│  점포 ID *                            │  ┌─ 위험도 ──────────────┐    │
│  [_______________________________]    │  │ ▌ 78 / 100  위험 (high)│    │
│  (없으면 주소 입력)                   │  └────────────────────────┘    │
│                                       │                                │
│  주소 (선택 — store_id 없을 때)       │  [배지] 철수 검토              │
│  [_______________________________]    │                                │
│                                       │  Top 위험요인 (hazard 가중)    │
│  운영 개월수 *      [____] 개월       │  • 매출 12M YoY (-32%) (+22)   │
│  최근 매출 CSV (선택)                 │  • 인접 의원 폐업 2건 (+14)    │
│  [파일 선택...] (12M 매출/처방)       │  • 동 인구 YoY -3% (+8)        │
│                                       │                                │
│  ┌──────────────────────┐             │  Top 완화요인                  │
│  │  ▶ 평가 실행 (CTA)   │ ← primary   │  • 운영 87개월 (-9)            │
│  └──────────────────────┘             │                                │
│                                       │  ┌──────────────────────┐      │
│  (입력 안내: brand voice 톤)          │  │ Analyze에서 시계열 → │ 보조│
│  "점포 ID 또는 주소를 입력하면        │  └──────────────────────┘      │
│   운영 위험도 평가가 시작됩니다."     │                                │
├──────────────────────────────────────────────────────────────────────┤
│  [전폭] Kaplan-Meier 생존곡선 (12개월) — UI_BENCHMARK_KM_CURVE-001    │
│   ─── 우리 점포 (실선)                                                │
│   ┄┄┄ 유사군 동 5개 (점선, 95% CI 음영)                                │
│                                                                        │
│  [표] 유사 동 peer_dongs Top 5 (동명 / 12M 생존확률 / 폐업 카운트)    │
└──────────────────────────────────────────────────────────────────────┘
```

### 명세 요약
- **상단**: 브레드크럼 `홈 > 약국 ▾ > 폐업평가`. 컨텍스트 배지(`pharmacy.close`).
- **상단 가드 라벨**: 화면 폭 전체에 회색 1줄 "위험도 — 높을수록 나쁨 (점포개발 적합도와 색 의미 반대)" 고정. (H절 색 충돌 가드)
- **좌 50%**: 입력 폼. `store_id` 또는 `address` 중 하나 필수, `operating_months` 필수, CSV 선택. 화면당 primary CTA 1개 = "평가 실행". (`primary_action_per_screen: MUST_EXIST`)
- **우 50%**: 결과 카드. 큰 hazard_score 숫자 + 좌측 보더 색상 + 등급 배지 + action_recommendation 배지(아웃라인). Top 위험요인/완화요인 각 ≤ 3개. 보조 버튼 "Analyze에서 시계열 보기" (secondary, outline).
- **하단 전폭**: KM 생존곡선 (재활용 컴포넌트 마운트 슬롯) + peer_dongs 테이블.
- **빈 상태(평가 전)**: 우 50% 영역에 "점포 ID 또는 주소를 입력하면 운영 위험도 평가가 시작됩니다" 1줄 안내 (brand_voice: 분석가의 절제). 일러스트 없음 (anti-pattern).
- **추정 모드 (CSV 미업로드)**: 우 50% 상단에 회색 배지 "추정 모드 — 운영 데이터 부재 (낮은 신뢰도)" (AC-4).
- **신규 점포 (operating_months < 6)**: KM 영역을 "운영 6개월 미만 — 생존곡선 적용 보류" 박스로 대체 (AC-7).

### Brand 자가 검증 (UI 자식 이슈에서 적용)
- [ ] hero_color는 "평가 실행" CTA 배경에 사용. (단, hazard 결과 카드 자체의 강조색은 grade에 따라 `plddt_poor` 등으로 결정)
- [ ] Top 위험/완화 요인 색상은 plddt 4색 또는 `text_secondary` 톤만 사용. 무지개/그라디언트 금지.
- [ ] CTA는 화면당 정확히 1개 (보조 버튼은 outline/ghost로 시각 weight 차별).
- [ ] 0.5초 룰: hazard 숫자 → 등급 라벨 → action_recommendation → 다음 액션(Analyze에서 시계열) 좌→우→하 시선 흐름.
- [ ] 일러스트/3D/네온 없음.
- [ ] H절 색 충돌 가드 라벨 노출 확인.

---

## G. 분해 — 자식 이슈 (5개)

모두 BLOCKED, `depends_on = USER_STORY_PHARMACY_CLOSE-001`. 본 USER_STORY 완료(이 명세서 작성) 시 일괄 READY.

### G.1 `GENERATE_CODE_PHARMACY_CLOSE_UI-001` (P1, agent-harness, sonnet)
- 범위: 입력 폼 + 결과 카드 + KM 곡선 마운트 슬롯 + Analyze deep-link 트리거.
- files:
  - `components/pharmacy-close.js` (신규) — 컴포넌트
  - `index.html` (surgical: `[약국 ▾]` 드롭다운에 "폐업평가" 항목 추가만)
  - `css/pharmacy.css` (점포개발과 공유 — 신규/공통화)
- hazard 계산은 자리만 잡고 `compute_pharmacy_hazard_score()` 함수 import (G.2에서 구현).
- KM 곡선 영역은 빈 컨테이너만 마운트 (G.3에서 데이터 어댑터 + 렌더 연결).

### G.2 `GENERATE_CODE_PHARMACY_CLOSE_HAZARD-001` (P1, agent-harness, sonnet)
- 범위: hazard 점수 계산 룰(D절) + peer_dongs + top_drivers 계산.
- files:
  - `viz/plugins/pharmacy-hazard.js` (신규) — 가중치/계산 로직
- 데이터: `simula_data_real.json` 동 단위 + Mock 매출/처방 시계열 (ETL_PHARMACY_DATA-001 완료 전까지). 외부 의원/약국 카운트는 더미.
- 결정성 보장: 동일 입력 → 동일 hazard_score.
- `parallel_with: ETL_PHARMACY_DATA-001` (더미 모드로 우선 동작 → 완료 후 실데이터 교체 follow-up).

### G.3 `INTEGRATE_KM_CURVE_PHARMACY_CLOSE-001` (P1, agent-harness, sonnet)
- 범위: UI_BENCHMARK_KM_CURVE-001 산출 컴포넌트(`viz/plugins/km-curve.js`)를 폐업평가 결과 카드 하단에 마운트 + 데이터 어댑터.
- files:
  - `viz/plugins/km-curve.js` (재활용 — UI_BENCHMARK_KM_CURVE-001 산출물 그대로 사용)
  - `components/pharmacy-close.js` (G.1 산출물에 KM 슬롯 연결만 — surgical)
- 어댑터: 폐업 점포 시계열 → KM 컴포넌트 prop schema(`{ series: [{label, points: [{t, survival, ci_low, ci_high}]}] }`) 매핑.
- depends_on: `UI_BENCHMARK_KM_CURVE-001` (해당 이슈 완료 후 진행) + `GENERATE_CODE_PHARMACY_CLOSE_UI-001` (G.1 마운트 슬롯).

### G.4 `RUN_TESTS_PHARMACY_CLOSE-001` (P1, test-harness, sonnet)
- 범위:
  - **단위 테스트**: D절 가중치 합 = 1.0 검증, 경계값 테스트(hazard 0/29/30/49/50/69/70/100), 4단계 grade 매핑 모두 발생, top_drivers 정렬, 역매핑 정상성 (hazard high → action="철수 검토").
  - **캐릭터 저니 (Playwright)** — 페르소나: 약국 본사 운영/회계 담당자
    | 스텝 | 행동 | 기대 결과 | 스크린샷 |
    |---|---|---|---|
    | 1 | 페이지 로드 | 글로벌 네비에 `[약국 ▾]` 노출 | `/tmp/journey-pharmacy-close-1.png` |
    | 2 | `[약국 ▾]` → "폐업평가" 클릭 | URL `?mode=pharmacy.close`, 입력 폼 + 빈 상태 결과 카드 + 상단 색 충돌 가드 라벨 표시 | `/tmp/journey-pharmacy-close-2.png` |
    | 3 | store_id "store-001" (또는 주소 "성수1가1동") + operating_months 60 입력 | 폼 valid 상태, CTA 활성 | `/tmp/journey-pharmacy-close-3.png` |
    | 4 | "평가 실행" 클릭 | 3초 이내 결과 카드 (hazard_score/grade/action) + KM 곡선 영역 렌더 | `/tmp/journey-pharmacy-close-4.png` |
    | 5 | "Analyze에서 시계열 보기" 클릭 | `?mode=analyze&ctx=pharmacy.close&store_id=...&section=benchmark` 도달 | `/tmp/journey-pharmacy-close-5.png` |

### G.5 `BIZ_VALIDATE_PHARMACY_CLOSE-001` (P2, biz-validator, sonnet)
- 범위: 시나리오 갭 검증.
  - **4단계 grade 발생 시나리오**: 4개 점포 샘플 (very_low / low / medium / high 각 1)
  - **엣지 케이스**:
    1. 매출/처방 0 (폐업 직전 상태) → hazard_score 만점 부근 + action="철수 검토"
    2. 신규 점포 (operating_months = 3) → KM 적용 보류 박스 노출 (AC-7)
    3. 인구 급증 동 (역설적 안전) → hazard 완화 요인에 인구 YoY 양수 표시
    4. CSV 미업로드 (운영 데이터 부재) → 추정 모드 배지 + confidence=low (AC-4)
    5. store_id/address 둘 다 미입력 → 폼 validation 에러
- 결과: BIZ_FIX P0 자동 spawn (CRITICAL 갭 발견 시).

---

## H. 색상 의미 충돌 방지 가드 (필수)

같은 약국 카테고리 내에서 두 모델의 색 의미가 반대다. 인지 혼선 방지를 위해 다음을 강제한다:

| 모델 | score 의미 | high 색 | 라벨 |
|---|---|---|---|
| 점포개발 (`pharmacy.develop`) | 높을수록 **좋음** | `#00529B` 파랑 (적극 추천) | "적합도 — 높을수록 좋음" |
| 폐업평가 (`pharmacy.close`) | 높을수록 **나쁨** (hazard) | `#C9485B` 빨강 (위험) | "위험도 — 높을수록 나쁨" |

### 가드 룰
1. **결과 카드 상단 라벨 텍스트 강제 노출**: 위 표의 라벨 문구를 회색 1줄 배지로 화면 상단 고정. 아이콘(ⓘ) + 텍스트. 사용자가 dismiss 불가 (1차 스코프).
2. **동일 화면 좌우 비교 금지 (1차 스코프)**: 점포개발 + 폐업평가 결과를 한 화면에 동시 표시하는 UI는 1차 스코프 OUT. 대신 둘 다 별도 화면에서 단독으로만 노출. (후속 `USER_STORY_PHARMACY_DUAL_COMPARE-001` 별도 phase)
3. **score → grade 변환 함수 분리**: `pharmacy-develop.js`와 `pharmacy-close.js`는 각자의 grade 매핑 함수를 가지며 공유하지 않는다. 공통 유틸 추출 금지 (혼동 방지). hazard 측은 변환 시 색상을 명시적으로 역매핑.
4. **action_recommendation 배지 색**: hazard 색과 동일한 색을 쓰지 않는다 (배지가 너무 강조됨). 배지는 outline 스타일 + `text_secondary` 톤으로 처리하여 "주체는 점수, 액션은 보조"의 위계 유지.
5. **테스트 강제**: G.4 RUN_TESTS의 캐릭터 저니 스텝 2에서 "상단 색 충돌 가드 라벨 표시" 명시적 assert.

---

## I. 의존성 / 병렬

| 이슈 | 의존 | 병렬 |
|---|---|---|
| G.1 UI | USER_STORY (this) | G.2 hazard와 병렬 (interface 계약 = `compute_pharmacy_hazard_score(input) → output schema C.1+C.2`) |
| G.2 HAZARD | USER_STORY (this) | G.1 UI와 병렬. `parallel_with: ETL_PHARMACY_DATA-001` (더미 모드) |
| G.3 INTEGRATE_KM | G.1 + `UI_BENCHMARK_KM_CURVE-001` 둘 다 완료 | — |
| G.4 RUN_TESTS | G.1 + G.2 + G.3 모두 완료 | — |
| G.5 BIZ_VALIDATE | G.2 완료 | G.4와 병렬 |
| `ETL_PHARMACY_DATA-001` | (이미 READY) | G.2와 병렬. 완료 시 더미 → 실데이터 교체 follow-up. |
| `UI_BENCHMARK_KM_CURVE-001` | (현재 BLOCKED) | G.3의 직접 의존성. 해당 이슈 완료 전엔 G.3 BLOCKED 유지. |

---

## J. 마무리 체크리스트 (product-manager 자가 검증)

- [x] `docs/stories/pharmacy-close.md` 생성 (이 파일).
- [x] 1차 스코프 OUT 표 명시 (Karpathy #2 Simplicity).
- [x] AC 7개 Given-When-Then.
- [x] hazard 가중치 합 = 1.00.
- [x] pLDDT 색상 4단계 brand-dna에서 인용 + **역매핑 명시**.
- [x] 자식 이슈 5개 분해 (UI / Hazard / KM 통합 / Test / Biz).
- [x] ETL_PHARMACY_DATA-001 의존성 + 더미 fallback 명시 ("TBD" 표기).
- [x] UI_BENCHMARK_KM_CURVE-001 재활용 명시 (G.3).
- [x] H절 색 충돌 가드 (점포개발 vs 폐업평가) 명시.
- [x] code 파일 직접 수정 없음 (Karpathy #3 Surgical) — 본 이슈에서 만진 파일은 docs/와 registry.json만.
- [x] 형제 문서 `pharmacy-develop.md` 비수정 (구조만 모방).
