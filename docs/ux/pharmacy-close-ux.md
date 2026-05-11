# 약국 폐업평가 — UX 스펙

> 작성: ux-harness (Harness `UX_DESIGN_PHARMACY_CLOSE-001`)
> 일자: 2026-05-04
> 부모: `USER_STORY_PHARMACY_CLOSE-001` — `docs/stories/pharmacy-close.md`
> 자식 코드 이슈: `GENERATE_CODE_PHARMACY_CLOSE_UI-001`
> 페르소나: 약국 본사 운영/회계 담당자
> 형제 참조: `docs/ux/pharmacy-develop-ux.md` (동일 9섹션 A~I 구조 — 톤/레이아웃 모방, 차이점만 명시)

---

## A. 화면 골격 (와이어프레임 텍스트 — 1440 기준)

> 점포개발과의 차이: **KM 생존곡선이 하단 전폭** / 좌우 50%:50% / 상단 색 충돌 가드 라벨 고정

```
┌─────────────────────────────────────────────────────────────────────┐
│ 헤더: [홈] > [약국 ▾] > 폐업평가                                    │
├─────────────────────────────────────────────────────────────────────┤
│ ⓘ 위험도 — 높을수록 나쁨 (점포개발 적합도와 색 의미 반대)             │
├──────────────────────────────────────┬──────────────────────────────┤
│  [좌 50% — 입력 폼]                  │  [우 50% — Hazard 결과 카드]  │
│                                      │                               │
│  점포 ID *                           │  [빈 상태]                    │
│  [_______________________________]   │  "점포를 선택하면             │
│  (없으면 주소 입력)                  │   폐업 위험도 평가가          │
│                                      │   시작됩니다"                 │
│  주소 (선택 — store_id 없을 때)      │                               │
│  [_______________________________]   │  ─── 결과 (SUBMITTING 후) ─── │
│                                      │  ┌─ 위험도 ────────────────┐  │
│  운영 개월수 *   [____] 개월         │  │ ▌ 73점   위험 (high)     │  │
│                                      │  │   위험도 — 높을수록 나쁨  │  │
│  매출 CSV (선택, 12M 시계열)         │  │ ─────────────────────    │  │
│  [파일 선택...]                      │  │ [배지] 철수 검토          │  │
│  (미업로드 시 추정 모드 안내)        │  │                           │  │
│                                      │  │ Top 위험요인              │  │
│  ┌──────────────────────────┐        │  │ + 매출 YoY -22% (+22)    │  │
│  │  ▶ 평가 실행             │        │  │ + 인접 의원 폐업 2건(+14) │  │
│  └──────────────────────────┘        │  │ + 동 인구 -3% (+8)       │  │
│    ↑ primary CTA 1개                 │  │                           │  │
│                                      │  │ Top 완화요인              │  │
│  "점포 ID 또는 주소를 입력하면       │  │ - 운영 96개월 (-9)        │  │
│   운영 위험도 평가가 시작됩니다."    │  │                           │  │
│                                      │  │ [Analyze에서 시계열 보기] │  │
│                                      │  │  ↑ secondary outline 버튼 │  │
│                                      │  └───────────────────────────┘  │
├──────────────────────────────────────┴──────────────────────────────┤
│  [전폭] Kaplan-Meier 생존곡선 (12개월) — UI_BENCHMARK_KM_CURVE-001  │
│                                                                       │
│  1.0  ●─\                                                            │
│          \─\─                                                         │
│  0.5        \──\─── (95% CI 음영, stroke-opacity 0.18)               │
│  0.0         ─────────────────────────────                           │
│           0    3    6    9    12 (months)                            │
│  ─── 우리 점포 (실선)  ┄┄┄ 유사군 5개 (점선 + CI 음영)              │
│                                                                       │
│  [표] 유사 동 peer_dongs Top 5                                        │
│  순위 │ 동명      │ 12M 생존확률 │ 폐업 카운트 │ hazard grade        │
│   1   │ 의정부1동  │   68%        │    2건      │ ■ medium #FED766    │
│   2   │ 가능동     │   72%        │    1건      │ ■ medium #FED766    │
│   3   │ 장암동     │   81%        │    0건      │ ■ low    #5BC0EB    │
│   4   │ 신곡1동    │   55%        │    4건      │ ■ high   #C9485B    │
│   5   │ 흥선동     │   49%        │    5건      │ ■ high   #C9485B    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## B. 컴포넌트 트리

```
<PharmacyCloseScreen>
  ├── <Breadcrumb path={['홈', '약국', '폐업평가']} />
  ├── <ColorGuardBanner>                                   ← 색 충돌 가드 (항상 표시, dismiss 불가)
  │     "ⓘ 위험도 — 높을수록 나쁨 (점포개발 적합도와 색 의미 반대)"
  │   </ColorGuardBanner>
  └── <TwoColumnLayout left={50} right={50}>
        ├── [좌 50%] <CloseForm>
        │     ├── <StoreIdField required placeholder="예: store-001" />
        │     ├── <AddressField optional placeholder="예: 의정부시 금오동" hint="점포 ID 없을 때 입력" />
        │     ├── <NumberField label="운영 개월수" required unit="개월" min={1} />
        │     ├── <FileUpload
        │     │       label="매출 CSV (선택)"
        │     │       accept=".csv"
        │     │       hint="미업로드 시 추정 모드 — 낮은 신뢰도로 진행됩니다" />
        │     ├── <PrimaryButton bg="#00529B">평가 실행</PrimaryButton>  ← 단일 primary CTA
        │     └── <BodyCopy>점포 ID 또는 주소를 입력하면 운영 위험도 평가가 시작됩니다</BodyCopy>
        │
        └── [우 50%] <HazardCard>
              ├── [빈 상태] <EmptyState
              │              message="점포를 선택하면 폐업 위험도 평가가 시작됩니다"
              │              illustration="none" />         ← anti_pattern: 일러스트 금지
              ├── [추정 모드] <EstimateModeBadge
              │               label="추정 모드 — 운영 데이터 부재 (낮은 신뢰도)"
              │               color="#A4B0C0" />            ← CSV 미업로드 시 상단 표시
              └── [결과 상태]
                    ├── <HazardScoreBadge
                    │      value={73}
                    │      grade="high"
                    │      borderColor="#C9485B"            ← plddt_poor: hazard ≥ 70
                    │      gradeLabel="위험 (high)"
                    │      warningLabel="위험도 — 높을수록 나쁨" />
                    ├── <ActionBadge
                    │      label="철수 검토"
                    │      style="outline"
                    │      color="text_secondary" />        ← outline: 주체는 점수, 액션은 보조
                    ├── <TopDriversList
                    │      positive={[
                    │        { feature: "매출 12M YoY -22%", contrib: +22 },
                    │        { feature: "인접 의원 폐업 2건", contrib: +14 },
                    │        { feature: "동 인구 YoY -3%", contrib: +8 }
                    │      ]}
                    │      negative={[
                    │        { feature: "운영 96개월", contrib: -9 }
                    │      ]}
                    │      maxItems={3} />
                    ├── <TrustNote
                    │      text="본 점수는 통계적 추정입니다. 실제 운영 데이터와 현장 조건을 함께 검토하세요." />
                    └── <SecondaryOutlineButton onClick="switchMode('analyze')">
                          Analyze에서 시계열 보기
                        </SecondaryOutlineButton>            ← secondary (CTA 카운트 제외)

<KMCurveChart                                               ← 하단 전폭, UI_BENCHMARK_KM_CURVE-001 재활용
    series={[
      { label: "우리 점포", lineStyle: "solid", points: [...] },
      { label: "유사 동 5개", lineStyle: "dashed", points: [...] }
    ]}
    showCI={true}
    ciOpacity={0.18}
    xLabel="months"
    yLabel="생존 확률" />

<PeerDongTable rows={5} columns={['동명', '12M 생존확률', '폐업 카운트', 'grade']} />
```

---

## C. 인터랙션 명세

| 트리거 | 결과 |
|---|---|
| store_id 입력 (타이핑) | 200ms debounce → 후보 5개 드롭다운 표시 |
| 드롭다운에서 선택 | 입력 필드 채움 + operating_months CTA 활성화 조건 체크 |
| CSV 미업로드로 제출 | 결과 카드 상단에 EstimateModeBadge 노출 + `trace.confidence="low"` |
| 평가 실행 클릭 | 버튼 loading("평가 중…") + HazardCard skeleton + KM 영역 skeleton |
| 결과 도착 (3초 이내) | 카드 fade-in 250ms ease-out (그라디언트 X) |
| hazard ≥ 70 | 카드 좌측 보더 `#C9485B` + ActionBadge "철수 검토" + 경고 인라인 1줄 |
| hazard 50-69 | 카드 좌측 보더 `#FED766` + ActionBadge "관찰 — 3개월 후 재평가" |
| hazard 30-49 | 카드 좌측 보더 `#5BC0EB` + ActionBadge "유지" |
| hazard < 30 | 카드 좌측 보더 `#00529B` + ActionBadge "유지" |
| Analyze 버튼 클릭 | `switchMode('analyze')` + URL `?mode=analyze&ctx=pharmacy.close&store_id=<id>&section=benchmark` |
| KM 곡선 hover (t 지점) | 툴팁: t=N개월, 생존확률 X%, 95% CI [lo, hi] |
| 유사군 행 클릭 | 해당 동을 KM 곡선에 점선 강조 (비교 오버레이) |
| operating_months < 6 | KM 영역을 안내 박스로 대체: "운영 6개월 미만 — 생존곡선 적용 보류" |
| 결과 상태에서 재입력 | CTA 텍스트 "재평가"로 변경, 이전 결과 카드 유지 |
| 잘못된 store_id/주소 | 폼 inline 에러 `#C9485B` + CTA 재활성 유지 |

---

## D. 상태 매트릭스 (6행)

| 상태 | 입력 폼 | Hazard 카드 | KM 곡선 | 유사군 테이블 |
|---|---|---|---|---|
| INITIAL | 빈 입력 + CTA disabled | EmptyState 1줄 안내 | 비표시 | 비표시 |
| TYPING | store_id/주소 입력 + CTA enabled (store_id OR address AND operating_months 있으면) | EmptyState 유지 | 비표시 | 비표시 |
| SUBMITTING | 입력 잠금(readOnly) + CTA "평가 중…"(loading) | skeleton 애니메이션 | skeleton | 비표시 |
| SUCCESS_FULL | 입력 유지 + CTA "재평가" | HazardCard + drivers + Analyze 링크 | 실선+점선+CI 음영 | Top 5 |
| SUCCESS_ESTIMATE | 입력 유지 + CTA "재평가" | HazardCard + EstimateModeBadge + 신뢰도↓ | 곡선 점선(추정 표시) | Top 5 |
| ERROR | 입력 유지 + inline 에러 | EmptyState + "점포 ID 또는 주소를 찾을 수 없습니다" | 비표시 | 비표시 |

---

## E. 접근성

- **키보드 탭 순서**: store_id → address(선택) → operating_months → CSV 업로드 → CTA(평가 실행) → (결과 후) Analyze 링크 → KM 곡선 영역(focusable, 좌우 화살표로 t 탐색) → 유사군 첫 행 → 이후 행
- **ARIA**:
  - 색 충돌 가드 배너: `role="banner" aria-label="위험도 해석 안내"` (항상 visible)
  - 결과 카드: `role="region" aria-label="폐업 위험도 평가 결과" aria-live="polite"`
  - 평가 중: `aria-busy="true"` on HazardCard
  - KM 곡선: `role="img" aria-label="유사 동 5개의 12개월 생존 곡선, 우리 점포 p50 추정 64%"` (스크린리더 요약)
  - 에러: `role="alert"` on inline 에러 메시지
- **색맹 대응**: hazard grade는 색 단독 의미 전달 금지 — 반드시 텍스트 라벨 동반
  - high: "위험 (high)" + `#C9485B` 보더
  - medium: "주의 (medium)" + `#FED766` 보더
  - low: "낮음 (low)" + `#5BC0EB` 보더
  - very_low: "안전 (very_low)" + `#00529B` 보더
- **최소 클릭 영역**: 44×44px — CTA, Analyze 링크, 유사군 행, KM hover 영역
- **포커스 링**: `outline: 2px solid #5BC0EB` (brand accent)

---

## F. 반응형

| 뷰포트 | 레이아웃 | 변경 사항 |
|---|---|---|
| 1440px (기본) | 좌 50% / 우 50% 2열 + 하단 전폭 KM | 위 와이어프레임 기준 |
| 1920px | 동일 비율, `max-width: 1440px` 중앙 정렬 | 여백 확대 |
| 2560px | 동일 비율, `max-width: 1680px`, KM height 320 → 400px | 밀도 유지 |
| < 1100px | 세로 stack: 색 충돌 가드 → 입력 폼 → Hazard 카드 → KM → 유사군 | 1열 전환 |

---

## G. 마이크로 카피 (절제 + 분석가 톤 — 점포개발보다 무거운 무게감)

| 위치 | 카피 |
|---|---|
| 색 충돌 가드 배너 | "ⓘ 위험도 — 높을수록 나쁨 (점포개발 적합도와 색 의미 반대)" |
| 빈 상태 | "점포를 선택하면 폐업 위험도 평가가 시작됩니다" |
| store_id placeholder | "예: store-001" |
| address placeholder | "예: 의정부시 금오동" |
| CTA (기본) | "평가 실행" |
| CTA (loading) | "평가 중…" |
| CTA (재평가) | "재평가" |
| 결과 카드 헤더 | "{hazard_score}점 — {grade_label} (위험도)" 예: "73점 — 위험 (high)" |
| action 배지 (hazard ≥ 70) | "철수 검토" |
| action 배지 (50-69) | "관찰 — 3개월 후 재평가" |
| action 배지 (< 50) | "유지" |
| Analyze 링크 | "Analyze에서 시계열 보기" |
| CSV 미업로드 배지 | "추정 모드 — 운영 데이터 부재 (낮은 신뢰도)" |
| 신뢰도 안내 | "본 점수는 통계적 추정입니다. 실제 운영 데이터와 현장 조건을 함께 검토하세요." |
| KM 영역 안내 | "유사 동 5개의 12개월 생존 확률 (95% CI 음영)" |
| operating_months < 6 | "운영 6개월 미만 — 생존곡선 적용 보류" |
| hazard ≥ 70 인라인 경고 | "폐업 위험 임계 초과 — 데이터 검토 필수" |
| 잘못된 주소 에러 | "점포 ID 또는 주소를 찾을 수 없습니다. 동/구/시 단위로 다시 입력해 주세요." |

**금지 카피** (anti_patterns — 과장/단정): "위험천만 / 즉시 폐업 / 망함 / 최악 / 절대"

---

## H. brand-dna 자가 검증 + 색 의미 충돌 가드 (중요)

| 항목 | 값 | 적용 위치 |
|---|---|---|
| hero_color | `#00529B` | CTA "평가 실행" 배경, "유지" action 배지 border |
| plddt_poor → hazard ≥ 70 | `#C9485B` | 결과 카드 좌측 보더 4px (역매핑) |
| plddt_low → hazard 50-69 | `#FED766` | 결과 카드 좌측 보더 4px (역매핑) |
| plddt_mid → hazard 30-49 | `#5BC0EB` | 결과 카드 좌측 보더 4px (역매핑) |
| plddt_high → hazard < 30 | `#00529B` | 결과 카드 좌측 보더 4px (역매핑) |
| primary_action_per_screen | MUST_EXIST | "평가 실행" 1개. Analyze 링크는 secondary outline (CTA 카운트 제외) |
| anti_pattern: 그라디언트 | 0건 | 카드 색은 solid border만 |
| anti_pattern: 단일 점추정 단독 | 0건 | TrustNote + Analyze deep-link 동반 필수 |
| anti_pattern: 출처 없는 단정 카피 | 0건 | 모든 점수에 "통계적 추정" 고지 |
| anti_pattern: pLDDT 색 임의 변경 | 0건 | 4색 외 금지 |
| anti_pattern: CTA 2개 이상/0개 | 0건 | 정확히 1개 |

### 색 충돌 가드 (필수 — 점포개발 vs 폐업평가)

| 모델 | score 의미 | high 색 | 라벨 |
|---|---|---|---|
| 점포개발 (`pharmacy.develop`) | 높을수록 **좋음** (적합도) | `#00529B` 파랑 | "적합도 — 높을수록 좋음" |
| 폐업평가 (`pharmacy.close`) | 높을수록 **나쁨** (hazard) | `#C9485B` 빨강 | "위험도 — 높을수록 나쁨" |

**가드 구현 규칙**:
1. 색 충돌 가드 배너(`ColorGuardBanner`) — 화면 상단 항상 고정, dismiss 불가 (1차 스코프)
2. `pharmacy-close.js`는 자체 `hazardToGrade()` 함수 보유 — `pharmacy-develop.js`와 공유 금지 (혼동 방지)
3. grade 변환 시 색상 역매핑 명시: hazard high → `plddt_poor #C9485B` (점포개발과 반대)
4. action_recommendation 배지: outline 스타일 + `text_secondary` 톤 (hazard 색 배경 금지)
5. 동일 화면에 점포개발 + 폐업평가 결과 동시 표시 금지 (1차 스코프 OUT)

---

## I. 자식 GENERATE_CODE 이슈에 전달할 spec 요약 (구현 가이드)

### 대상 이슈
`GENERATE_CODE_PHARMACY_CLOSE_UI-001`
`ux_spec_doc: "docs/ux/pharmacy-close-ux.md"`

### 파일 목표
- `components/pharmacy-close.js` (신규) — 컴포넌트 전체 (입력 폼 + Hazard 카드 + KM 마운트 슬롯 + Analyze deep-link)
- `index.html` (surgical: `[약국 ▾]` 드롭다운에 "폐업평가" 항목 1개 추가만)
- `css/pharmacy.css` (점포개발과 공유 확장 — 폐업평가 전용 클래스 추가)

### 상태 관리
- 앱 전반 패턴 따름 — `app.js`의 vanilla 상태 패턴 참조 (useState 불필요)
- 화면 상태: `INITIAL | TYPING | SUBMITTING | SUCCESS_FULL | SUCCESS_ESTIMATE | ERROR`

### Hazard 계산 인터페이스
```js
// viz/plugins/pharmacy-hazard.js (GENERATE_CODE_PHARMACY_CLOSE_HAZARD-001 산출)
import { computePharmacyHazardScore } from '../viz/plugins/pharmacy-hazard.js';

const result = computePharmacyHazardScore({
  store_id: "store-001",         // 필수 (또는 address)
  address: null,                  // 선택 — store_id 없을 때
  operating_months: 96,           // 필수
  recent_sales_csv: null          // 선택 — 미입력 시 confidence=low
});
// → { hazard_score, grade, top_drivers[3], peer_dongs[≤5], km_curve, action_recommendation, trace }
```

### hazardToGrade 역매핑 함수 (반드시 분리 구현)
```js
// pharmacy-close.js 내부 전용 — pharmacy-develop.js와 공유 금지
function hazardToGrade(hazard_score) {
  if (hazard_score >= 70) return { grade: 'high',     color: '#C9485B', label: '위험 (high)',   action: '철수 검토' };
  if (hazard_score >= 50) return { grade: 'medium',   color: '#FED766', label: '주의 (medium)', action: '관찰 — 3개월 후 재평가' };
  if (hazard_score >= 30) return { grade: 'low',      color: '#5BC0EB', label: '낮음 (low)',    action: '유지' };
  return                         { grade: 'very_low', color: '#00529B', label: '안전 (very_low)', action: '유지' };
}
// ⚠ 점포개발의 scoreToGrade()와 방향 반대 — 절대 병합 금지
```

### KM 곡선 어댑터 (INTEGRATE_KM_CURVE_PHARMACY_CLOSE-001 선행 의존)
```js
// UI_BENCHMARK_KM_CURVE-001 산출 컴포넌트 재활용
// KM 컴포넌트 prop schema:
// { series: [{ label, lineStyle, points: [{ t, survival, ci_low, ci_high }] }] }
// operating_months < 6 → KM 영역 비표시 + 안내 박스 대체 (AC-7)
```

### Analyze deep-link
```js
// 기존 app.js switchMode() 활용
switchMode('analyze');
// URL: ?mode=analyze&ctx=pharmacy.close&store_id=<encodeURIComponent(store_id)>&section=benchmark
// Analyze 도착 시 해당 동/점포 매출·처방 시계열 자동 활성
// 상단 헤더: "← 약국 폐업평가로 돌아가기" 복귀 링크
```

### CSS 클래스 네이밍 (pharmacy.css 추가분)
```css
/* 폐업평가 전용 클래스 (점포개발 클래스와 prefix 혼용 — close- 접두 사용) */
.pharmacy-close-screen          /* 최상위 컨테이너 */
.pharmacy-close-form            /* 좌 50% 입력 폼 */
.pharmacy-close-guard-banner    /* 색 충돌 가드 배너: background: #F5F7FA; border-left: 4px solid #A4B0C0 */
.pharmacy-close-result-card     /* 우 50% Hazard 카드 */
.pharmacy-close-card--high      /* border-left: 4px solid #C9485B */
.pharmacy-close-card--medium    /* border-left: 4px solid #FED766 */
.pharmacy-close-card--low       /* border-left: 4px solid #5BC0EB */
.pharmacy-close-card--very-low  /* border-left: 4px solid #00529B */
.pharmacy-close-hazard-score    /* 큰 숫자: font-size: 3rem, color: 해당 grade 색 */
.pharmacy-close-action-badge    /* outline 스타일: border: 1px solid #A4B0C0; color: #4A5568 */
.pharmacy-close-driver-risk     /* Top 위험요인: color: #C9485B */
.pharmacy-close-driver-safe     /* Top 완화요인: color: #5BC0EB */
.pharmacy-close-km-container    /* 하단 전폭 KM 곡선 컨테이너: width: 100% */
.pharmacy-close-peer-table      /* 유사 동 테이블 */
.pharmacy-close-trust-note      /* 신뢰도 안내: color: #A4B0C0; font-size: 0.75rem */
.pharmacy-close-cta             /* 평가 실행 버튼: background: #00529B */
.pharmacy-close-analyze-link    /* Analyze 링크: border: 1px solid #5BC0EB; color: #5BC0EB (outline) */
.pharmacy-close-estimate-badge  /* 추정 모드 배지: background: #F5F7FA; color: #A4B0C0 */
```

### 스코프 잠금 (Surgical)
- 이번 이슈에서 건드리는 파일: `components/pharmacy-close.js`, `css/pharmacy.css` (추가만), `index.html` (드롭다운 1항목만)
- `app.js` 수정 최소화 — `switchMode()` 호출 및 `pharmacy.close` 모드 진입점 등록만

---

## J. 자가 검증 체크리스트

- [x] primary CTA 정확히 1개 ("평가 실행") — Analyze 링크는 secondary outline 버튼
- [x] anti_patterns 5종 0건
  - [x] 단일 점추정 단독 표시 없음 (TrustNote + Analyze deep-link 동반)
  - [x] pLDDT 4색 외 임의 색 없음 (역매핑 명시)
  - [x] 그라디언트/네온/AI슬롭 일러스트 0건
  - [x] 데이터 출처 없는 단정 카피 0건 ("통계적 추정" 고지 필수)
  - [x] CTA 정확히 1개
- [x] 색 충돌 가드 라벨 명시 ("위험도 — 높을수록 나쁨") — ColorGuardBanner 항상 노출
- [x] hazard 4단계 grade 역매핑 명확 (high→poor→#C9485B, medium→low→#FED766 등)
- [x] KM 곡선 95% CI 음영 표기 (stroke-opacity 0.18)
- [x] CSV 미업로드 fallback 안내 (EstimateModeBadge + confidence=low)
- [x] operating_months < 6 KM 적용 보류 처리 (AC-7)
- [x] hazardToGrade() 함수 분리 명시 (pharmacy-develop.js와 공유 금지)
- [x] hero_color `#00529B` CTA 배경 적용
- [x] 상태 매트릭스 6행 (INITIAL/TYPING/SUBMITTING/SUCCESS_FULL/SUCCESS_ESTIMATE/ERROR)
- [x] 접근성: aria-live polite + KM role="img" + 색맹 대응 텍스트 라벨
- [x] 자식 이슈 `GENERATE_CODE_PHARMACY_CLOSE_UI-001` spec 첨부 완료
