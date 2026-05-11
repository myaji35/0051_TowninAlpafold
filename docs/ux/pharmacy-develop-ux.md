# 약국 점포개발 평가 — UX 스펙

> 작성: ux-harness (Harness `UX_DESIGN_PHARMACY_DEVELOP-001`)
> 일자: 2026-05-04
> 부모: `USER_STORY_PHARMACY_DEVELOP-001` — `docs/stories/pharmacy-develop.md`
> 자식 코드 이슈: `GENERATE_CODE_PHARMACY_DEVELOP_UI-001`
> 페르소나: 약국 본사 신규점포 개발담당자

---

## A. 화면 골격 (와이어프레임 텍스트 — 1440 기준)

```
┌──────────────────────────────────────────────────────────────────┐
│ 헤더: [홈] > [약국 ▾] > 점포개발                                 │
├──────────────────────────────────────────────────────────────────┤
│ ┌─ 좌 (60%) 입력 폼 ─────────────────┐ ┌─ 우 (40%) 결과 카드 ──┐ │
│ │                                    │ │                        │ │
│ │ 후보 주소 *                         │ │  [빈 상태 또는 결과]   │ │
│ │ [예: 의정부시 금오동 123-45        ] │ │                        │ │
│ │                                    │ │  ┌──── 결과 카드 ────┐  │ │
│ │ 평형 (선택)           [      ] 평  │ │  │▌ 87점 — 추천     │  │ │
│ │ 월 임대가 (선택)     [      ] 만원 │ │  │  pLDDT mid        │  │ │
│ │ 기대 처방건수/일 (선택)[    ] 건   │ │  │  ──────────────   │  │ │
│ │                                    │ │  │ Top 드라이버 (3)  │  │ │
│ │  ┌──────────────────────────┐      │ │  │ + 반경 의원 12개  │  │ │
│ │  │ ▶  평가 실행             │      │ │  │ + 60대 비중 18%   │  │ │
│ │  └──────────────────────────┘      │ │  │ - 경쟁약국 5개    │  │ │
│ │    ↑ primary CTA 1개               │ │  │                   │  │ │
│ │                                    │ │  │ [Decide에서 보기] │  │ │
│ │ "후보 주소를 입력하면              │ │  │  ↑ secondary 텍스트│  │ │
│ │  적합도 평가가 시작됩니다"          │ │  └───────────────────┘  │ │
│ └────────────────────────────────────┘ └────────────────────────┘ │
│                                                                    │
│ ── 비교 — 유사한 동의 적합도 ──────────────────────────────────── │
│  순위 │ 동        │ 적합도 │ grade │ 평균 처방건수 │ pLDDT 색상  │
│   1   │ 의정부1동  │  84점  │ mid   │ 65건/일      │ ■ #5BC0EB   │
│   2   │ 가능동     │  79점  │ mid   │ 58건/일      │ ■ #5BC0EB   │
│   3   │ 장암동     │  72점  │ mid   │ 51건/일      │ ■ #5BC0EB   │
│   4   │ 신곡1동    │  65점  │ low   │ 44건/일      │ ■ #FED766   │
│   5   │ 흥선동     │  61점  │ low   │ 39건/일      │ ■ #FED766   │
└────────────────────────────────────────────────────────────────────┘
```

---

## B. 컴포넌트 트리

```
<PharmacyDevelopScreen>
  ├── <Breadcrumb path={['홈', '약국', '점포개발']} />
  └── <TwoColumnLayout left={60} right={40}>
        ├── [좌 60%] <DevelopForm>
        │     ├── <AddressAutocomplete required placeholder="예: 의정부시 금오동 123-45" />
        │     ├── <NumberField label="평형" optional unit="평" />
        │     ├── <NumberField label="월 임대가" optional unit="만원" />
        │     ├── <NumberField label="기대 처방건수/일" optional unit="건" />
        │     ├── <PrimaryButton bg="#00529B">평가 실행</PrimaryButton>  ← 단일 primary CTA
        │     └── <BodyCopy>후보 주소를 입력하면 적합도 평가가 시작됩니다</BodyCopy>
        │
        └── [우 40%] <ResultCard>
              ├── [빈 상태] <EmptyState
              │              message="후보 주소를 입력하면 적합도 평가가 시작됩니다"
              │              illustration="none" />        ← anti_pattern: 일러스트 금지
              └── [결과 상태]
                    ├── <ScoreBadge value={87} grade="mid"
                    │              borderColor="#5BC0EB"    ← plddt_mid 70-89
                    │              gradeLabel="추천" />
                    ├── <TopDriversList
                    │      positive={[{feature:"반경 500m 의원수", contrib:+18},
                    │                 {feature:"60대 비중", contrib:+12}]}
                    │      negative={[{feature:"경쟁약국수", contrib:-9}]}
                    │      maxItems={3} />
                    ├── <TrustNote text="본 점수는 통계적 추정입니다. 임대 조건과 입지는 별도 검토하세요." />
                    └── <SecondaryLinkButton onClick="switchMode('decide')">
                          Decide 모드에서 cone 보기
                        </SecondaryLinkButton>              ← secondary (CTA 카운트 제외)

<ComparableDongTable rows={5} columns={[동명, 적합도, grade, 평균처방건수, pLDDT]} />
```

---

## C. 인터랙션 명세

| 트리거 | 결과 |
|---|---|
| Address 입력 (타이핑) | 200ms debounce 후 후보 5개 드롭다운 표시 |
| 드롭다운에서 주소 선택 | 입력 필드 채움 + CTA 활성화 |
| 평가 실행 클릭 | 버튼 loading 상태("평가 중…") + 결과 카드 skeleton |
| 결과 도착 (3초 이내) | 카드 fade-in 250ms ease-out (그라디언트 X) |
| 잘못된 주소 입력 | 폼 하단 inline 에러 `#C9485B` + CTA 비활성 해제(재시도 가능) |
| Decide 링크 클릭 | `switchMode('decide')` + URL `?mode=decide&ctx=pharmacy.develop&address=<encoded>` + 해당 동 자동 선택 + scroll to cone |
| 비교 매물 행 클릭 | 해당 동을 입력 폼 주소 필드에 자동 채움 → CTA 활성 |
| 결과 상태에서 재입력 | CTA 텍스트 "재평가" 로 변경, 이전 결과 카드 유지 |

---

## D. 상태 매트릭스

| 상태 | 폼 | 결과 카드 | 비교 매물 테이블 |
|---|---|---|---|
| INITIAL | 빈 입력 + CTA disabled | 빈 상태 안내 1줄 | 비표시 |
| TYPING | 주소 입력 중 + CTA enabled (주소 값 있으면) | 빈 상태 유지 | 비표시 |
| SUBMITTING | 입력 잠금(readOnly) + CTA "평가 중…"(loading) | skeleton 애니메이션 | 비표시 |
| SUCCESS | 입력 유지 + CTA "재평가" | 결과 카드 fade-in | Top 5 표시 |
| ERROR | 입력 유지 + inline 에러 메시지 | 빈 상태 + "주소를 찾을 수 없습니다. 다시 입력해 주세요." | 비표시 |
| ADDRESS_NOT_FOUND | 주소 입력 필드 강조 테두리 `#C9485B` | 빈 상태 | 비표시 |

---

## E. 접근성

- **키보드 탭 순서**: 주소 입력 → 평형 → 임대가 → 처방건수 → CTA(평가 실행) → (결과 후) Decide 링크 → 비교 매물 첫 행 → 비교 매물 이후 행
- **ARIA**:
  - 결과 카드 컨테이너: `role="region" aria-label="점포개발 평가 결과" aria-live="polite"`
  - 평가 실행 중: `aria-busy="true"` on 결과 카드
  - 에러: `role="alert"` on inline 에러 메시지
- **색맹 대응**: pLDDT 색상은 단독 의미 전달 금지 — 항상 텍스트 라벨 동반
  - high: "적극 추천 (high)" + 색상
  - mid: "추천 (mid)" + 색상
  - low: "신중 검토 (low)" + 색상
  - poor: "비추천 (poor)" + 색상 + 추가 경고 라벨
- **최소 클릭 영역**: 44×44px — CTA, 비교 매물 행, Decide 링크
- **포커스 링**: `outline: 2px solid #5BC0EB` (brand accent)

---

## F. 반응형

| 뷰포트 | 레이아웃 | 변경 사항 |
|---|---|---|
| 1440px (기본) | 좌 60% / 우 40% 2열 분할 | 위 와이어프레임 기준 |
| 1920px | 동일 비율, 컨테이너 `max-width: 1440px` 중앙 정렬 | 여백 확대 |
| 2560px | 동일 비율, 컨테이너 `max-width: 1680px`, input height 52px | 밀도 유지 |
| < 1100px (브라우저 축소) | 세로 stack: 입력 폼 → 결과 카드 → 비교 매물 | 1열 전환 |

---

## G. 마이크로 카피 (emotional_tone: 과학적·신뢰·절제·투명)

| 위치 | 카피 |
|---|---|
| 빈 상태 | "후보 주소를 입력하면 적합도 평가가 시작됩니다" |
| 주소 placeholder | "예: 의정부시 금오동 123-45" |
| CTA (기본) | "평가 실행" |
| CTA (loading) | "평가 중…" |
| CTA (재평가) | "재평가" |
| 결과 카드 헤더 | "{score}점 — {grade_label}" 예: "87점 — 추천" |
| Decide 링크 | "Decide 모드에서 cone 보기" |
| 잘못된 주소 에러 | "주소를 찾을 수 없습니다. 동/구/시 단위로 다시 입력해 주세요." |
| 신뢰도 안내 | "본 점수는 통계적 추정입니다. 임대 조건과 입지는 별도 검토하세요." |
| 비교 매물 섹션 헤더 | "비교 — 유사한 동의 적합도" |
| 비교 매물 빈 상태 | "비교 가능한 동을 찾는 중입니다." |
| low grade 추가 안내 | "근거 검토를 권장합니다" |

**금지 카피** (anti_patterns — 과장 표현): "최고의 / 절대 / 완벽한 / 강력 추천 / 최적"

---

## H. brand-dna 자가 검증

| 항목 | 값 | 적용 위치 |
|---|---|---|
| hero_color | `#00529B` | CTA "평가 실행" 배경, 결과 카드 score 큰 숫자 색 |
| plddt_high ≥ 90 | `#00529B` | 결과 카드 좌측 보더 4px, grade 배지 배경 |
| plddt_mid 70–89 | `#5BC0EB` | 결과 카드 좌측 보더 4px, grade 배지 배경 |
| plddt_low 50–69 | `#FED766` | 결과 카드 좌측 보더 4px, grade 배지 배경 |
| plddt_poor < 50 | `#C9485B` | 결과 카드 좌측 보더 4px, grade 배지 배경 + 추가 경고 라벨 |
| primary_action_per_screen | MUST_EXIST | "평가 실행" 1개. Decide 링크는 secondary 텍스트 링크 (CTA 카운트 제외) |
| anti_pattern: 그라디언트/네온/일러스트 | 0건 | 카드 색은 solid border만, 일러스트 없음 |
| anti_pattern: 단일 점추정 | 0건 | 신뢰도 안내 문구 + Decide cone deep-link 동반 필수 |
| anti_pattern: 데이터 출처 없는 단정 카피 | 0건 | 모든 점수에 "통계적 추정" 고지 + Decide 보조 |
| anti_pattern: pLDDT 색 임의 변경 | 0건 | 4색 (#00529B / #5BC0EB / #FED766 / #C9485B) 외 금지 |
| anti_pattern: CTA 2개 이상/0개 | 0건 | 정확히 1개: "평가 실행" |
| emotional_tone | 과학적·신뢰·절제·투명 | 위 G절 카피 일관 적용 |
| illustration_style | none | 빈 상태: 텍스트 1줄만, 아이콘 없음 |

---

## I. 자식 GENERATE_CODE 이슈에 전달할 spec 요약 (구현 가이드)

### 대상 이슈
`GENERATE_CODE_PHARMACY_DEVELOP_UI-001`

### 파일 목표
- `components/pharmacy-develop.js` (신규) — 컴포넌트 전체
- `index.html` (surgical: `[약국 ▾]` 드롭다운에 "점포개발" 항목 추가만)
- `css/pharmacy.css` (신규) — pLDDT 보더/배지/카드 스타일

### 상태 관리
- 앱 전반 패턴 따름 — `app.js`의 `selectedDong` 패턴 참조 (useState 불필요, vanilla 상태)
- 화면 상태: `INITIAL | TYPING | SUBMITTING | SUCCESS | ERROR | ADDRESS_NOT_FOUND`

### 점수 계산 인터페이스
```js
// viz/plugins/pharmacy-scorer.js (GENERATE_CODE_PHARMACY_DEVELOP_SCORER-001 산출)
import { computePharmacyDevelopScore } from '../viz/plugins/pharmacy-scorer.js';

const result = computePharmacyDevelopScore({
  address: "의정부시 금오동",      // 필수
  area_pyeong: null,              // 선택
  rent_monthly_krw: null,         // 선택
  expected_rx_per_day: null       // 선택
});
// → { score, grade, top_drivers[3], comparable_dongs[≤5], cone_link, trace }
```

### Decide deep-link
```js
// 기존 app.js line ~325의 switchMode() 활용
switchMode('decide');
// URL 파라미터: ?mode=decide&ctx=pharmacy.develop&address=<encodeURIComponent(address)>
// Decide 도착 시 해당 동 자동 선택 + "← 약국 점포개발 평가로 돌아가기" 복귀 링크 표시
```

### CSS 클래스 네이밍 (pharmacy.css)
```css
.pharmacy-develop-screen       /* 최상위 컨테이너 */
.pharmacy-form                 /* 좌 60% 입력 폼 */
.pharmacy-result-card          /* 우 40% 결과 카드 */
.pharmacy-result-card--high    /* plddt_high: border-left: 4px solid #00529B */
.pharmacy-result-card--mid     /* plddt_mid: border-left: 4px solid #5BC0EB */
.pharmacy-result-card--low     /* plddt_low: border-left: 4px solid #FED766 */
.pharmacy-result-card--poor    /* plddt_poor: border-left: 4px solid #C9485B */
.pharmacy-score-badge          /* 큰 숫자: color: #00529B, font-size: 3rem */
.pharmacy-driver-positive      /* Top 강점: color: #5BC0EB */
.pharmacy-driver-negative      /* Top 약점: color: #C9485B */
.pharmacy-comparable-table     /* 하단 전폭 비교 테이블 */
.pharmacy-trust-note           /* 신뢰도 안내: color: #A4B0C0, font-size: 0.75rem */
.pharmacy-cta                  /* 평가 실행 버튼: background: #00529B */
.pharmacy-decide-link          /* Decide 링크: color: #5BC0EB, text-decoration: underline */
```

### 와이어프레임 참조
- 이 문서 A절 + `docs/stories/pharmacy-develop.md` F절

### 스코프 잠금 (surgical)
- 이번 이슈에서 건드리는 파일: `components/pharmacy-develop.js`, `css/pharmacy.css`, `index.html` (드롭다운 1항목만)
- `app.js` 수정 최소화 — `switchMode()` 호출 및 `pharmacy.develop` 모드 진입점 등록만

---

## 자가 검증 체크리스트

- [x] primary CTA 정확히 1개 ("평가 실행") — Decide 링크는 secondary 텍스트 링크
- [x] anti_patterns 5종 0건
  - [x] 단일 점추정 단독 표시 없음 (신뢰도 안내 + Decide cone 동반)
  - [x] pLDDT 색상 4종 외 임의 색 없음
  - [x] 그라디언트/네온/AI슬롭 일러스트 0건
  - [x] 데이터 출처 없는 단정 카피 0건 ("통계적 추정" 고지 필수)
  - [x] CTA 정확히 1개 (2개 이상/0개 금지)
- [x] hero_color `#00529B` 정확한 위치 적용 (CTA 배경, score 숫자)
- [x] emotional_tone 단어 선택 일관 (과학적·신뢰·절제·투명, "최고/완벽/강력" 금지)
- [x] 모든 수치/추정에 출처 또는 신뢰도 라벨 동반 구조 (trust_note 필수)
- [x] 상태 매트릭스 6행 (INITIAL/TYPING/SUBMITTING/SUCCESS/ERROR/ADDRESS_NOT_FOUND)
- [x] 접근성: aria-live polite + 색맹 대응 텍스트 라벨 동반
- [x] 자식 이슈 `GENERATE_CODE_PHARMACY_DEVELOP_UI-001` spec 첨부 완료
