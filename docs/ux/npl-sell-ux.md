# NPL 매도평가 UX 설계서

> 작성: ux-harness (`UX_DESIGN_NPL_SELL-001`)
> 일자: 2026-05-04
> 부모 스토리: `USER_STORY_NPL_SELL-001` → `docs/stories/npl-sell.md`
> IA 참조: `docs/domain-menu-ia.md`
> 형제 UX 문서: `pharmacy-develop-ux.md`, `pharmacy-develop-ux.md`, `npl-buy-ux.md` (동일 9섹션 구조)
> 재활용 컴포넌트: `UI_RECOMMENDATION_TRACE-001` (SHAP + Decision Tree 통합)
> 브랜드 토큰: `#00529B` hero, plddt 4단계, primary CTA 1개, anti_patterns 5종
> 라운드: **4/4 UX_DESIGN 라운드 완료**

---

## A. 화면 골격 (1440px 기준)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 글로벌 헤더: [홈] > [NPL ▾] > 매도평가                                      │
│                                                                             │
│ ⚠ 매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)     │
│   (결과 카드 상단 컨텍스트 라벨 — 항상 노출)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌─ 좌 패널 50% 입력 폼 ──────────────────┐ ┌─ 우 패널 50% 결과 카드 ───┐   │
│ │                                        │ │                          │   │
│ │  포트폴리오 ID 또는 단건 채권 검색 *   │ │ [INITIAL 상태]           │   │
│ │  [포트폴리오 ID 또는 단건 채권 검색]▼  │ │  채권을 선택하면          │   │
│ │                                        │ │  매각 vs 보유 비교가      │   │
│ │  보유 개월수 *        [     ]          │ │  시작됩니다              │   │
│ │                                        │ │                          │   │
│ │  충당금률 (%) *       [ 0~100 ]        │ │ [SUCCESS 상태]           │   │
│ │                                        │ │ ┌ 즉시 매각 ──────────┐  │   │
│ │                                        │ │ │ 2.4억 NPV           │  │   │
│ │  ┌──────────────────────────────────┐  │ │ │  vs                  │  │   │
│ │  │  평가 실행  ← primary CTA 1개    │  │ │ │ 12M 보유 p50         │  │   │
│ │  └──────────────────────────────────┘  │ │ │ 2.1억               │  │   │
│ │                                        │ │ │─────────────────────│  │   │
│ │  (로딩: "평가 중…")                    │ │ │ ★ 즉시 매각 (gap 14%)│  │   │
│ │                                        │ │ │ 추천 근거 (SHAP)     │  │   │
│ │                                        │ │ │ + 보유비용 잠식      │  │   │
│ │                                        │ │ │ + 시장가 안정        │  │   │
│ │                                        │ │ │ − 회수율 변동성      │  │   │
│ │                                        │ │ │─────────────────────│  │   │
│ │                                        │ │ │ [Decide에서 trace…] │  │   │
│ │                                        │ │ └─────────────────────┘  │   │
│ └────────────────────────────────────────┘ └──────────────────────────┘   │
│                                                                             │
│ ─── Recommendation Trace (UI_RECOMMENDATION_TRACE-001 재활용) ─────────────│
│  SHAP 막대 (driver별 NPV 기여도, 양수=매각 방향=파랑, 음수=유지 방향=빨강) │
│  Decision Tree 분기 경로 (펼치기)                                          │
│                                                                             │
│ ─── 6 / 12 / 24M cone 비교 ────────────────────────────────────────────────│
│  sell_now  ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ (수평 기준선)       │
│         6M [p10══════p50══════p90]                                         │
│        12M [p10══════════p50══════════p90]                                 │
│        24M [p10══════════════p50══════════════p90]                         │
│  안내: "보유 시 회수 NPV 분포 (95% 신뢰구간)"                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**색 의미 특수성 가드 (필수):** 이 화면의 색은 "채권 가치"가 아닌 **"매각 결정의 적합도"**를 나타낸다.
파랑(`#00529B`, `#5BC0EB`) = 매각 추천, 빨강(`#C9485B`) = 유지 추천(매각 비추).
형제 NPL 매수 화면(IRR↑=좋음=파랑)과 의미 구조가 **동일하지만 맥락이 다름** — 상단 가드 라벨로 명시.

---

## B. 컴포넌트 트리

```
<NplSellScreen>
  ├── <Breadcrumb path={['홈', 'NPL', '매도평가']} />
  ├── <ColorMeaningGuardLabel>          ← ⚠ 매각 적합도 라벨 (항상 노출)
  │     "매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)"
  │
  ├── <TwoColumnLayout left={50} right={50}>
  │   ├── [좌] <NplSellForm>
  │   │         ├── <PortfolioOrBondPicker required />   ← autocomplete
  │   │         │     placeholder="포트폴리오 ID 또는 단건 채권 검색"
  │   │         ├── <NumberField label="보유 개월수" required min={0} />
  │   │         ├── <NumberField label="충당금률" required unit="%" min={0} max={100} />
  │   │         └── <PrimaryButton>평가 실행</PrimaryButton>  ← 단일 primary CTA
  │   │               loading label="평가 중…"
  │   │
  │   └── [우] <SellVsHoldCard>
  │             ├── [INITIAL] <EmptyState>
  │             │               "채권을 선택하면 매각 vs 보유 비교가 시작됩니다"
  │             │
  │             └── [SUCCESS] <NpvComparisonResult>
  │                   ├── <NpvHeadline sellNow={2.4} holdP50={2.1} holdHorizon={12} unit="억" />
  │                   │     "즉시 매각 2.4억 vs 12M 보유 2.1억"
  │                   ├── <RecommendationBadge
  │                   │     action="즉시 매각" gap={14} grade="high"
  │                   │     color="#5BC0EB" />
  │                   ├── <DriversList items={3} sourceTag="SHAP"
  │                   │     header="추천 근거 (SHAP 기여도)" />
  │                   └── <SecondaryButton onClick="switchMode('decide')">
  │                           Decide에서 trace 보기
  │                         </SecondaryButton>
  │
  ├── <RecommendationTrace>           ← UI_RECOMMENDATION_TRACE-001 재활용
  │     prop: shap_drivers=[{label, impact_krw, sign, evidence_ref}]
  │     prop: decision_tree={nodes, edges}
  │     prop: click_handler  ← driver 클릭 시 인라인 근거 펼침
  │
  └── <NpvConeComparisonChart
        horizons={[6, 12, 24]}
        sellNow={sell_now_npv}
        footer="보유 시 회수 NPV 분포 (95% 신뢰구간)" />
```

**설계 제약:**
- `<PrimaryButton>` 1개만 존재 (`평가 실행`)
- `<SecondaryButton>` (`Decide에서 trace 보기`)는 결과 도달 후에만 노출
- 하단 Trace + Cone 섹션은 SUCCESS 상태에서만 가시화

---

## C. 인터랙션 명세

| 트리거 | 결과 |
|---|---|
| portfolio 검색창 입력 | autocomplete 드롭다운 + 보유 채권 리스트 노출 |
| 단건 채권 선택 | 폼 자동 채움 (보유 개월수, 충당금률) — 수동 수정 가능 |
| 평가 실행 CTA 클릭 (입력 유효) | 버튼 loading + 결과 카드 skeleton + Trace skeleton + Cone skeleton 동시 노출 |
| 평가 실행 CTA 클릭 (입력 무효) | 인라인 validation 에러 (폼 하단), 결과 영역 변경 없음 |
| `sell_now_npv >= max(hold[*].p50)` AND gap >= 20% | recommendation = "즉시 매각 (확신)", grade = very_high, 배지색 `#00529B` |
| `sell_now_npv >= max(hold[*].p50)` AND gap 0~19% | recommendation = "매각 검토", grade = high, 배지색 `#5BC0EB` |
| `hold[24].p10 >= sell_now_npv × 1.2` | recommendation = "유지 — 매각 보류", grade = low, 배지색 `#C9485B` |
| 위 두 조건 모두 미해당 | recommendation = "관망 — 3개월 후 재평가", grade = medium, 배지색 `#FED766` |
| Recommendation Trace 클릭 (SHAP 막대) | 해당 driver 인라인 근거 펼침 (보유 비용 누적 곡선, 회수율 분위수, 시장 호가 분포) + Decision Tree 분기점 강조 |
| Recommendation Trace 클릭 (Decision Tree 분기) | 해당 분기 조건 + taken_branch 강조 표시 |
| Decide 링크 버튼 클릭 | `switchMode('decide')` 호출 → URL `?mode=decide&ctx=npl.sell&portfolio=<id>&trace=on` → 동 자동 선택 + Trace 활성 + "← NPL 매도평가로 돌아가기" 링크 |
| cone 차트 hover (t별 band) | 해당 horizon + percentile NPV 분포 툴팁 표시 |
| "재평가" 링크 클릭 (관망 상태) | 폼 초기화 없이 보유 개월수 +3 자동 채움 → 재평가 준비 |

---

## D. 상태 매트릭스

| 상태 | 폼 상태 | 결과 카드 (우) | Recommendation Trace | Cone 차트 |
|---|---|---|---|---|
| INITIAL | 빈 폼, CTA disabled | EmptyState 메시지 | 비표시 | 비표시 |
| TYPING | 입력 중, CTA enabled (필수값 채움) | EmptyState 유지 | 비표시 | 비표시 |
| SUBMITTING | 폼 잠금, CTA loading ("평가 중…") | skeleton (3줄) | skeleton | skeleton |
| SUCCESS_SELL | 폼 유지 + "재평가" 안내 | NPV 비교 + "즉시 매각/매각 검토" 배지 (파랑) | SHAP 막대 + Decision Tree | 6/12/24M cone + sell_now 기준선 |
| SUCCESS_HOLD | 폼 유지 + "재평가" 안내 | NPV 비교 + "유지" 배지 (빨강) | SHAP 막대 + Decision Tree | 동일 |
| SUCCESS_WATCH | 폼 유지 + "재평가" 안내 | NPV 비교 + "관망" 배지 (노랑) | 동일 | 동일 |
| ERROR | inline 에러 표시, CTA enabled | 변경 없음 | 비표시 | 비표시 |

총 **7행** 상태 정의 (4개 recommendation grade + INITIAL/TYPING/ERROR 분리).

---

## E. 접근성

**키보드 탭 순서:**
```
PortfolioOrBondPicker → 보유개월수 → 충당금률 → [평가 실행 CTA]
→ (결과 후) [Decide에서 trace 보기] → Trace SHAP 막대 첫 항목
→ Trace SHAP 막대 (Tab 순차) → Decision Tree 분기 노드
→ Cone 차트 sell_now 기준선 → Cone 6M → Cone 12M → Cone 24M (← → 화살표)
```

**ARIA 마크업:**
- `<NplSellForm>` — `role="form"` `aria-label="NPL 매도평가 입력"`
- `<SellVsHoldCard>` — `role="region"` `aria-live="polite"` `aria-label="매각 vs 보유 비교 결과"`
- `<RecommendationTrace>` — `role="region"` `aria-label="추천 근거 — SHAP 기여도와 Decision Tree 분기"`
- `<NpvConeComparisonChart>` — `role="img"` `aria-label="6/12/24개월 보유 NPV cone 분포"`
- `<ColorMeaningGuardLabel>` — `role="note"` `aria-label="색상 의미 안내"`

**색맹 접근성:**
- recommendation 표현: 색 + 텍스트 라벨 병기 필수
  - `#00529B` → "즉시 매각 (확신)" 텍스트
  - `#5BC0EB` → "매각 검토" 텍스트
  - `#FED766` → "관망 — 3개월 후 재평가" 텍스트
  - `#C9485B` → "유지 — 매각 보류" 텍스트
- SHAP 막대: 양수/음수 방향 텍스트 레이블 + `aria-description` 필수

**최소 클릭 영역:** 44×44px (CTA, Trace SHAP 막대, Cone hover 영역).

---

## F. 반응형 레이아웃

| 뷰포트 | 레이아웃 |
|---|---|
| 1440px (기본) | 50/50 좌우 분할 + Trace 하단 전폭 가로 펼침 |
| 1920px | max-width 1440px 중앙 정렬 (패널 비율 유지) |
| 2560px | max-width 1680px, Cone 차트 height 240 → 320 |
| < 1100px | 세로 stack: 폼 → 결과 카드 → Trace → Cone |
| < 768px (모바일) | 세로 stack, 폼 섹션 collapsible |

---

## G. 마이크로 카피 (의사결정 톤 — 절제)

| 위치 | 카피 |
|---|---|
| PortfolioOrBondPicker placeholder | "포트폴리오 ID 또는 단건 채권 검색" |
| EmptyState | "채권을 선택하면 매각 vs 보유 비교가 시작됩니다" |
| CTA 기본 | "평가 실행" |
| CTA 로딩 | "평가 중…" |
| 결과 헤더 | "즉시 매각 {sell_now}억 vs 12M 보유 {hold_p50}억" |
| Drivers 헤더 | "추천 근거 (SHAP 기여도)" |
| Decide 보조 버튼 | "Decide에서 trace 보기" |
| Cone 하단 안내 | "보유 시 회수 NPV 분포 (95% 신뢰구간)" |
| 재평가 안내 | "보유 개월수를 조정하면 재평가를 실행할 수 있습니다" |

**Recommendation 배지 카피:**

| 조건 | 배지 텍스트 |
|---|---|
| gap >= 20% (very_high) | "★ 즉시 매각 (확신)" |
| 0% < gap < 20% (high) | "매각 검토" |
| 관망 조건 | "관망 — 3개월 후 재평가" |
| hold 우세 | "유지 — 매각 보류" |

**금지 카피 (단정적 표현):**
- "반드시 매각하십시오" — 금지
- "즉시 매각 안 하면 손해" — 금지
- "무조건 유리" — 금지
- 출처/확신도 없는 단정 표현 전반 — 금지

---

## H. brand-dna 자가 검증 + 색 의미 가드

### brand-dna 토큰 적용 매핑

| brand-dna 항목 | 이 화면 적용 위치 |
|---|---|
| `hero_color #00529B` | [평가 실행] CTA 배경, sell_now NPV 숫자, very_high 배지 |
| `plddt_high #00529B` (gap >= 20%) | "즉시 매각 (확신)" 배지 배경, 좌측 보더 |
| `plddt_mid_high #5BC0EB` (gap 0-19%) | "매각 검토" 배지 배경, 좌측 보더 |
| `plddt_mid #FED766` (관망) | "관망" 배지 배경 |
| `plddt_low #C9485B` (hold 우세) | "유지 — 매각 보류" 배지 배경 (매각 비추) |
| `primary_action_per_screen: MUST_EXIST` | "평가 실행" 단일 primary CTA |
| `anti_pattern: 단일 점추정만 표시` | cone 6/12/24M × p10/p50/p90 9개 분위 표시로 해소 |
| `anti_pattern: 그라디언트/네온` | 0건 |
| `anti_pattern: 데이터 출처 없는 단정 카피` | SHAP 출처 태그 + 금지 카피 목록 준수 |
| `anti_pattern: CTA 0개 또는 2개+` | primary 1개만 |
| `anti_pattern: pLDDT 색상 임의 변경` | 4단계 팔레트 고정 |

### 색 의미 특수성 가드 (매도 도메인 전용)

**가드 라벨 필수 문구** (화면 상단, 항상 노출):
```
"매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)"
```

**SHAP 부호 컨벤션:**
- **양수 impact = 매각 방향 = 파랑** (`#00529B` 또는 `#5BC0EB`)
  - 예: "보유 비용 잠식 +25M" → 매각이 유리한 근거 → 파랑
- **음수 impact = 유지 방향 = 빨강** (`#C9485B`)
  - 예: "장기 회수율 우위 −30M" → 보유가 유리한 근거 → 빨강

**형제 화면 의미 차이 명시:**
- NPL 매수 (npl-buy): IRR↑ = 좋음 = 파랑 (수익 높을수록 추천)
- NPL 매도 (이 화면): 매각 적합도 높음 = 파랑 (매각 결정 추천)
- 두 화면 모두 파랑이 "긍정"이지만 **"긍정의 주체"가 다름** → 가드 라벨로 명시

---

## I. 자식 GENERATE_CODE 이슈 spec

### GENERATE_CODE_NPL_SELL_UI-001 (기존 이슈에 UX spec 추가)

```json
{
  "payload_update": {
    "ux_spec_doc": "docs/ux/npl-sell-ux.md",
    "guard_label_required": "매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)",
    "shap_sign_convention": "positive=sell_direction=blue, negative=hold_direction=red",
    "recommendation_states": ["즉시 매각 (확신)", "매각 검토", "관망 — 3개월 후 재평가", "유지 — 매각 보류"],
    "primary_cta_count": 1,
    "color_guard_label_always_visible": true
  },
  "files": [
    "components/npl-sell.js (신규)",
    "index.html (surgical: [NPL ▾] 드롭다운에 '매도평가' 항목 추가 — 매수평가 옆)",
    "css/npl.css (공유 — 매도 전용 클래스만 surgical 추가)"
  ]
}
```

### GENERATE_CODE_NPL_SELL_NPV-001 (기존 이슈 계산 로직)

```json
{
  "payload_update": {
    "ux_spec_doc": "docs/ux/npl-sell-ux.md",
    "interface_contract": "compute_npl_sell_npv(input) → { sell_now_npv, hold_npv_cone:{6:{p10,p50,p90},12,24}, drivers[≤5], grade, recommendation:{label}, trace }",
    "deterministic": true
  },
  "files": ["viz/plugins/npl-npv.js (신규)"]
}
```

### INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL-001 (어댑터 연결)

```json
{
  "payload_update": {
    "ux_spec_doc": "docs/ux/npl-sell-ux.md",
    "adapter_contract": "{drivers[≤5], recommendation.label, npv_gap} → {shap_drivers:[{label,impact_krw,sign,evidence_ref}], decision_tree:{nodes,edges}, click_handler}",
    "shap_sign_convention": "양수=매각방향=파랑, 음수=유지방향=빨강"
  }
}
```

---

## J. 자가 검증 체크리스트

- [x] primary CTA 1개 (`평가 실행` — `SecondaryButton`은 결과 후 보조)
- [x] anti_patterns 5종 0건 (cone 9분위, 출처 태그, 그라디언트 0, SHAP 출처, CTA 1개)
- [x] 색 의미 특수성 가드 라벨 ("매각 적합도 — 색상은 매각 추천 강도") 항상 노출
- [x] 4가지 recommendation 매핑 (즉시 매각/매각 검토/관망/유지 — 매각 비추)
- [x] SHAP 부호 컨벤션 명시 (양수=매각=파랑, 음수=유지=빨강)
- [x] cone 6/12/24M horizon × p10/p50/p90 분위 비교
- [x] UI_RECOMMENDATION_TRACE-001 재활용 명시 (코드 재구현 금지)
- [x] Decide deep-link spec (`switchMode('decide')` + URL 파라미터)
- [x] 형제 UX 문서 미수정 (이 파일만 신규 생성)
- [x] 코드 0줄 (UX 스펙 문서만)

---

*이 문서는 `UX_DESIGN_NPL_SELL-001` 산출물. 자식 GENERATE_CODE 이슈 3개 (`GENERATE_CODE_NPL_SELL_UI-001`, `GENERATE_CODE_NPL_SELL_NPV-001`, `INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL-001`)에 `ux_spec_doc: "docs/ux/npl-sell-ux.md"` payload로 연결.*
