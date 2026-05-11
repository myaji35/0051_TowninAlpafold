# NPL 매수평가 — UX 스펙

> 작성: ux-harness (Harness `UX_DESIGN_NPL_BUY-001`)
> 일자: 2026-05-04
> 부모: `USER_STORY_NPL_BUY-001` — `docs/stories/npl-buy.md`
> 자식 코드 이슈: `GENERATE_CODE_NPL_BUY_UI-001`
> 페르소나: NPL 매수 심사역

---

## A. 화면 골격 (와이어프레임 텍스트 — 1440 기준)

```
┌─────────────────────────────────────────────────────────────────┐
│ 헤더: [홈] > [NPL ▾] > 매수평가                                  │
├─────────────────────────────────────────────────────────────────┤
│ ┌─ 색 일관성 가드 라벨 (전폭, 고정) ─────────────────────────────┐│
│ │ ⓘ 수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)         ││
│ └────────────────────────────────────────────────────────────────┘│
│ ┌─ 좌 (50%) 입력 폼 ───────────────┐ ┌─ 우 (50%) 결과 카드 ─────┐│
│ │ 담보 부동산 주소 *                │ │ ┌── IRR 평가 카드 ───────┐││
│ │ [예: 의정부시 금오동 123-45]      │ │ │ ⓘ 수익성               │││
│ │                                  │ │ │ ▌ 18.4%                │││
│ │ 청구액 (만원) *    [          ]   │ │ │   IRR 매수 검토         │││
│ │ 후보 매수가 (만원) *[          ]  │ │ │   pLDDT mid ■          │││
│ │                                  │ │ │  ─────────────────────  │││
│ │ ── 권리관계 ──────────────────── │ │ │ Top Risks (≤3)         │││
│ │  선순위 채권 (만원) [          ]  │ │ │ ▸ 선순위 1억 — 잠식    │││
│ │  세금/공과금 (만원) [          ]  │ │ │ ▸ 임차 보증금 3천      │││
│ │  임차 보증금 (만원) [          ]  │ │ │ ▸ 낙찰가율 52%↓        │││
│ │                                  │ │ │                        │││
│ │ ┌──────────────────────────┐     │ │ │ [Decide에서 cone 보기] │││
│ │ │  ▶  평가 실행            │     │ │ │  ↑ secondary           │││
│ │ └──────────────────────────┘     │ │ └────────────────────────┘││
│ │   ↑ primary CTA 1개              │ └────────────────────────────┘│
│ └──────────────────────────────────┘                               │
│ ─── 시나리오 A/B/C 비교 (UI_SCENARIOS_3OPTION 컴포넌트) ──────────│
│  ┌─ A 보수 (×0.85) ─┐  ┌─ B 기본 (입력가) ─┐  ┌─ C 공격 (×1.15) ─┐│
│  │ 매수가:  25,500만 │  │ 매수가:  30,000만 │  │ 매수가:  34,500만 ││
│  │ IRR:     24.1%    │  │ IRR:     18.4%    │  │ IRR:      9.2%   ││
│  │ 회수p50: 35,000만 │  │ 회수p50: 35,000만 │  │ 회수p50: 35,000만││
│  │ grade:   적극매수 │  │ grade:   매수검토  │  │ grade:   신중검토││
│  │ ▓▓▓ cone p10-p90 │  │ ▓▓▓ cone p10-p90  │  │ ▓▓▓ cone p10-p90 ││
│  └───────────────────┘  └───────────────────┘  └──────────────────┘│
│ ─── 비교 — 인근 경매 낙찰가율 (참고용) ──────────────────────────│
│  # │ 물건            │ 낙찰가율 │ 경매일    │ 면적    │ 출처      │
│  1 │ 금오동 APT 104동 │  68%     │ 2026-03   │ 84㎡    │ 법원경매  │
│  2 │ …               │  …       │ …         │ …       │ …         │
└─────────────────────────────────────────────────────────────────┘
```

---

## B. 컴포넌트 트리

- `<NplBuyScreen>`
  - `<Breadcrumb path={['홈','NPL','매수평가']} />`
  - `<ColorConsistencyGuard label="수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)" />` ← 고정 상단 배너
  - `<TwoColumnLayout left={50} right={50}>`
    - `<NplBuyForm>`
      - `<AddressAutocomplete required placeholder="예: 의정부시 금오동 123-45 (담보 부동산)" />`
      - `<NumberField label="청구액" required unit="만원" />`
      - `<NumberField label="후보 매수가" required unit="만원" />`
      - `<Fieldset legend="권리관계">`
        - `<NumberField label="선순위 채권" optional unit="만원" />`
        - `<NumberField label="세금/공과금" optional unit="만원" />`
        - `<NumberField label="임차 보증금" optional unit="만원" />`
      - `<PrimaryButton disabled={!formValid}>평가 실행</PrimaryButton>` ← **단일 primary CTA**
    - `<IRRResultCard state={cardState}>`
      - 빈 상태: `<EmptyState message="채권 정보를 입력하면 IRR 평가가 시작됩니다" />`
      - 결과:
        - `<IRRBadge value={irr} grade={grade} plddtColor={gradeColor} />`
        - `<TopRisksList items={topRisks} maxCount={3} />`
        - `<SecondaryButton onClick={switchModeDecide}>Decide에서 cone 보기</SecondaryButton>`
  - `<ScenariosThreeOption data={scenariosData} />` ← UI_SCENARIOS_3OPTION-001 재활용 (하단 전폭)
  - `<AuctionRateTable rows={5} label="비교 — 인근 경매 낙찰가율 (참고용)" />`

---

## C. 인터랙션 명세

| 트리거 | 결과 |
|---|---|
| Address autocomplete 입력 | 200ms debounce → 5개 드롭다운 표시 |
| 청구액 또는 매수가 미입력 상태 | CTA `disabled` + helper "필수 항목입니다" |
| 권리관계 합계 ≥ 청구액 × 90% | inline 경고 "선순위 채권이 청구액의 90% 이상 — 회수 가능성 낮음" (노랑 border) |
| 평가 실행 버튼 클릭 | 버튼 loading 상태 + IRR 카드 skeleton + 시나리오 skeleton |
| 계산 완료 | IRR 카드 + Top Risks + 시나리오 A/B/C 표시 |
| 후보 매수가 값 변경 | 시나리오 A = 입력가 × 0.85, C = 입력가 × 1.15 자동 갱신 |
| 시나리오 A/B/C 카드 hover | cone p10/p50/p90 강조 (opacity 변화) |
| Decide 링크 클릭 | `switchMode('decide')` 호출 + 동(洞) 자동 매핑 + 시나리오 컴포넌트 활성 |
| IRR < 5% (음수 포함) | IRR 카드 빨강 border + "입찰 비추" 배지 표시 |
| IRR ≥ 25% | IRR 카드 파랑(#00529B) border + "적극 매수" 배지 표시 |

---

## D. 상태 매트릭스

| 상태 | 폼 | 색 가드 라벨 | IRR 카드 | 시나리오 | 경매 매물 |
|---|---|---|---|---|---|
| INITIAL | 빈 + CTA disabled | 표시 (항상) | 빈 상태 EmptyState | 비표시 | 비표시 |
| TYPING | CTA enabled (필수 충족 시) | 표시 | 빈 상태 EmptyState | 비표시 | 비표시 |
| SUBMITTING | 잠금 + loading | 표시 | skeleton | skeleton | 비표시 |
| SUCCESS | 유지 + "재평가" 보조 | 표시 | IRR + grade + risks | A/B/C + cone | Top 5 |
| WARNING_SENIORITY | 경고 inline 표시 | 표시 | IRR 빨강 + "잠식 위험" | A/B/C (대부분 음수) | Top 5 |
| ERROR | inline 에러 메시지 | 표시 | 빈 + 에러 안내 | 비표시 | 비표시 |

---

## E. 접근성

**키보드 탭 순서:**
담보 주소 → 청구액 → 후보 매수가 → 선순위 채권 → 세금/공과금 → 임차 보증금 → 평가 실행 CTA → (결과 후) Decide 링크 → 시나리오 A → B → C → 경매 매물 첫 행

**ARIA:**
- IRR 카드: `role="region"` `aria-label="IRR 평가 결과"` `aria-live="polite"`
- 시나리오 그룹: `role="group"` `aria-label="3가지 매수가 시나리오"`
- 색 가드 라벨: `role="note"` `aria-label="색상 의미 안내"`
- 권리관계 fieldset: `<legend>권리관계 (선택)</legend>`

**색맹 대응:**
IRR grade는 색 + 텍스트 라벨 병용:
- `#00529B` + "적극 매수" (≥25%)
- `#5BC0EB` + "매수 검토" (15-24%)
- `#FED766` + "신중 검토" (5-14%)
- `#C9485B` + "입찰 비추" (<5%)

**최소 클릭 영역:** 44×44px (모든 인터랙티브 요소)

---

## F. 반응형 브레이크포인트

| 뷰포트 | 레이아웃 |
|---|---|
| 1440px | 50/50 좌우 split + 시나리오 가로 3분할 + 경매 5행 |
| 1920px | max-width 1440px 유지 (중앙 정렬) |
| 2560px | max-width 1680px |
| < 1100px | 세로 stack: 가드 라벨 → 폼 → IRR 카드 → 시나리오 세로 → 경매 매물 |

---

## G. 마이크로 카피 (심사역 톤 — 절제)

| 위치 | 카피 |
|---|---|
| 색 가드 라벨 | "ⓘ 수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)" |
| 빈 상태 | "채권 정보를 입력하면 IRR 평가가 시작됩니다" |
| Address placeholder | "예: 의정부시 금오동 123-45 (담보 부동산)" |
| CTA 기본 | "평가 실행" |
| CTA 로딩 | "평가 중…" |
| CTA 재평가 | "재평가" |
| 결과 헤더 | "IRR {value}% — {grade_label}" (예: "IRR 18.4% — 매수 검토") |
| Action 배지 (≥25%) | "적극 매수" |
| Action 배지 (15-24%) | "매수 검토" |
| Action 배지 (5-14%) | "신중 검토" |
| Action 배지 (<5%) | "입찰 비추" |
| 잠식 경고 | "선순위 채권이 청구액의 90% 이상 — 회수 가능성 낮음" |
| Decide 링크 | "Decide에서 cone 보기" |
| 경매 매물 헤더 | "비교 — 인근 경매 낙찰가율 (참고용)" |
| 1차 스코프 외 자산 안내 | "1차 스코프는 부동산 담보 NPL만 지원됩니다" |

**금지 카피:** "확실한 / 보장된 / 손해 없음" — 금융 단정 표현 절대 금지

---

## H. brand-dna 자가 검증

| 항목 | 적용 |
|---|---|
| hero_color #00529B | CTA 배경, IRR 큰 숫자, grade=적극매수 카드 보더 |
| plddt high #00529B (IRR ≥25%) | 카드 보더 + "적극 매수" 배지 |
| plddt high #5BC0EB (IRR 15-24%) | 카드 보더 + "매수 검토" 배지 |
| plddt medium #FED766 (IRR 5-14%) | 카드 보더 + "신중 검토" 배지 |
| plddt low #C9485B (IRR <5%) | 카드 보더 + "입찰 비추" 경고 라벨 |
| primary_action_per_screen | "평가 실행" 1개만 — 검증 완료 |
| anti_pattern: 단일 점추정 | 시나리오 A/B/C cone(p10/p50/p90) 동반 — 위반 없음 |
| anti_pattern: pLDDT 색 임의 변경 | 4색 팔레트 그대로 사용 — 위반 없음 |
| anti_pattern: 그라디언트/네온 | 0건 — 위반 없음 |
| anti_pattern: 출처 없는 단정 카피 | 경매 매물 "참고용" 명시, 금지 카피 목록 적용 — 위반 없음 |
| anti_pattern: CTA 2개 이상/0개 | primary 1개 + secondary(Decide) 구분 — 위반 없음 |

**글로벌 색 일관성 명시:**
NPL 매수평가는 IRR↑ = 좋음 = 파랑. 형제 폐업평가(hazard↑ = 나쁨 = 빨강)와 의미가 반대이나 글로벌 룰("좋음=파랑, 나쁨=빨강") 일관 적용. 상단 고정 라벨 "수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)"으로 맥락 명시.

---

## I. 자식 GENERATE_CODE 이슈 스펙

### GENERATE_CODE_NPL_BUY_UI-001
```
파일: components/npl-buy.js (신규)
CSS:  css/npl.css (신규 — 매수/매도 공유 예정)
index.html: surgical — [NPL ▾] 드롭다운 신규 생성 + '매수평가' 항목 추가
UX 스펙: docs/ux/npl-buy-ux.md (이 문서)
색 가드 라벨: "수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)" 고정 노출
brand_tokens: hero_color #00529B, plddt 4단계 팔레트
primary CTA: "평가 실행" 1개
```

### GENERATE_CODE_NPL_BUY_RECOVERY-001
```
파일: viz/plugins/npl-recovery.js (신규)
인터페이스: compute_npl_buy_recovery(input) → {expected_recovery_cone, irr_estimate, scenarios[A,B,C], top_risks[≤3], grade, recommendation, trace}
시나리오 A: candidate_bid × 0.85, 시나리오 B: candidate_bid × 1.00, 시나리오 C: candidate_bid × 1.15
```

### INTEGRATE_SCENARIOS_NPL_BUY-001
```
파일: viz/plugins/scenarios-3option.js (재활용 — UI_SCENARIOS_3OPTION-001)
어댑터: candidate_bid_krw → [{label, bid, recovery, irr, grade} × 3]
마운트: components/npl-buy.js 하단 슬롯 surgical 연결
```

---

## J. 자가 검증 체크리스트

- [x] primary CTA 1개 ("평가 실행")
- [x] anti_patterns 5종 0건 (위반 없음)
- [x] 글로벌 색 일관성 명시 (상단 고정 가드 라벨 + H섹션 설명)
- [x] IRR 4단계 grade 매핑 (≥25% / 15-24% / 5-14% / <5%)
- [x] 권리관계 잠식 경고 인터랙션 (C섹션 — 합계 ≥ 청구액 90%)
- [x] 시나리오 A/B/C 자동 ±15% 룰 (A=×0.85, B=×1.00, C=×1.15)
- [x] 상태 매트릭스 6행 (INITIAL/TYPING/SUBMITTING/SUCCESS/WARNING_SENIORITY/ERROR)
- [x] 접근성 탭 순서 + ARIA role 명시
- [x] 반응형 4구간 (1440/1920/2560/<1100)
- [x] 색맹 대응 (색 + 텍스트 라벨 병용)
