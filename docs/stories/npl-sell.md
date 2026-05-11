# NPL 매도평가 — User Story 명세서

> 작성: product-manager (Harness `USER_STORY_NPL_SELL-001`)
> 일자: 2026-05-04
> 부모: `FEATURE_DOMAIN_MENU-001` · IA 문서: [`docs/domain-menu-ia.md`](../domain-menu-ia.md)
> 형제 모델: [`docs/stories/pharmacy-develop.md`](./pharmacy-develop.md), [`docs/stories/pharmacy-close.md`](./pharmacy-close.md), [`docs/stories/npl-buy.md`](./npl-buy.md) (구조 모방, 색 의미는 H절 글로벌 룰 참조)
> 브랜드 토큰: [`.claude/brand-dna.json`](../../.claude/brand-dna.json)
> 비파괴 원칙: 기존 4모드(Gallery/Explore/Analyze/Decide) + 6보조 모드 그대로. 상단 글로벌 네비 `[NPL ▾]` 드롭다운에 "매도평가" 항목 1개 추가하여 단일 화면을 신규로 만든다. **`UI_RECOMMENDATION_TRACE-001` (이미 등록된 명분 사슬 ❻ 섹션 — SHAP + Decision Tree 통합 추천 트레이스 컴포넌트)** 을 결과 카드 하단에 마운트하여 매각/유지 결정의 driver별 NPV 기여도를 SHAP-style 막대로 표시한다.
> 라운드: **4/4** — 4개 USER_STORY 분해 라운드의 **마지막** 명세서 (pharmacy-develop / pharmacy-close / npl-buy / **npl-sell**).

---

## A. 사용자 스토리 (Job-To-Be-Done)

### 메인 스토리
**As-a** NPL 매도 담당자 (기존 보유자 — 부실채권을 이미 보유한 매각 결정권자)
**I-want** 보유 부실채권에 대해 즉시 매각 시 NPV와 6/12/24개월 추가 보유 시 회수 cone NPV(p10/p50/p90)를 즉시 비교하고, 매각/관망/유지 추천 근거를 SHAP-style driver 분해로 받기를
**So-that** 보유 비용(대손충당·관리비)이 추가 회수 기대치를 잠식하기 전에 적정 매각 타이밍을 데이터로 결정하고, 위원회·감사 대응 근거를 마련한다.

### 보조 스토리 (1차 스코프 IN)
- **B1.** As-a 매도 담당자, I-want 결과 카드의 "Decide에서 보기" 버튼으로 Recommendation Trace + cone이 그려진 Decide 모드로 한 번에 점프하기, So-that 추천의 명분 사슬을 시간 축에서 다시 검증한다.
- **B2.** As-a 매도 담당자, I-want 결과 카드의 drivers Top 5 SHAP 막대를 클릭하면 해당 driver의 산출 근거(보유 비용 누적 곡선, 회수율 분포 분위수 등)를 인라인으로 펼쳐 보기, So-that "왜 매각/유지인가"를 한 화면에서 설명할 수 있다.

### 1차 스코프 OUT (다음 분기/별도 이슈)
| 기능 | 사유 | 후속 이슈 후보 |
|---|---|---|
| 포트폴리오 다건 일괄 평가 (`portfolio_id` → 채권 N개 동시 매각/유지 결정) | 단건 평가 흐름 안정 후 phase 2. 1차는 단건 평가 + portfolio_id로 채권 단건 선택만 | `USER_STORY_NPL_SELL_PORTFOLIO-001` (P3) |
| 시장 호가 자동 크롤링 (인근 매물 호가 실시간 수집) | 1차는 수동 입력 또는 ETL 더미. 크롤링 도입은 라이선스 검토 별도 트랙 | `INFRA_NPL_QUOTE_CRAWL-001` (P3, T2 SECURITY) |
| 매각 알림/이메일 발송 (추천 = 즉시 매각 시 담당자 알림) | 1차는 화면 표시만 | `INFRA_NPL_SELL_NOTIFY-001` (P3) |
| 위원회 보고서 PDF 자동 생성 | `report-pdf-builder` skill 별도 트랙 | `REPORT_NPL_SELL_PDF-001` (P2) |
| 부분 매각 시나리오 (전량 매각 외 30/50/70% 등) | 1차는 전량 매각만 (보유 또는 전량 매각 이항 결정) | `MODEL_NPL_SELL_PARTIAL-001` (P2) |
| ML 회수율 학습 모델 (담보·지역·이력 기반 회수율 동적 추정) | D절 1차 안 분포 추정 검증 후 진행 | `MODEL_NPL_SELL_RECOVERY_TUNE-001` (P2) |

> Karpathy #2 (Simplicity): 1차 스코프 = **단건 채권 즉시매각 vs 6/12/24M 보유 NPV 비교 + Recommendation Trace + Decide deep-link**. 그 외는 모두 후순위.

---

## B. Acceptance Criteria (Given-When-Then)

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | `portfolio_id` 검색 또는 단건 채권 선택 + `holding_months_current` (현재까지 보유 개월) + `provision_rate` (충당금률 0~1.0) 입력, 필수 검증 통과 | "평가 실행" CTA 클릭 | 5초 이내 결과 카드에 `sell_now_npv`(원), `hold_npv_cone[6,12,24]` 각 `{p10,p50,p90}`(원), `recommendation.label`(즉시 매각/관망/유지), `drivers[]`(Top 5, SHAP-style NPV 기여도), `cone_link` URL이 렌더된다. |
| AC-2 | `sell_now_npv >= max(hold_npv_cone[6,12,24].p50)` (즉시 매각이 모든 보유 기간 중앙값보다 우월) | 결과 카드 렌더 | 좌측 보더와 등급 배지가 brand-dna 파랑 (`plddt_high` `#00529B` 또는 `plddt_mid` `#5BC0EB`)로 표시되고, `recommendation.label = "즉시 매각"`. NPV gap이 ≥ 20%면 grade `very_high` `#00529B` (확신), gap < 20%면 grade `high` `#5BC0EB` (검토). |
| AC-3 | `hold_npv_cone[24].p10 >= sell_now_npv × 1.2` (24개월 보유의 비관 시나리오조차 즉시 매각 대비 20% 이상 우월) | 결과 카드 렌더 | grade `low` `#C9485B` (매각 비추 = 유지 권장), `recommendation.label = "유지"`. drivers에 "장기 회수율 우위", "시장 호가 일시 침체" 등 보유 정당화 driver 노출. |
| AC-4 | 보유 비용 누적 (`provision_rate × claim_amount × 보유개월`) ≥ 추가 회수 기대치 (`hold_npv_cone[N].p50 - sell_now_npv`) | 결과 카드 렌더 | drivers Top 5에 `{label:"보유 비용 잠식", impact:<강한 양수 = 매각 추천 방향>, severity:"high"}` 반드시 포함, `recommendation.label = "즉시 매각"` 강제. |
| AC-5 | Recommendation Trace 영역 마운트 상태 | drivers SHAP 막대 클릭 (B2 보조 스토리) | 해당 driver의 산출 근거(예: 보유 비용 누적 곡선, 회수율 분위수, 시장 호가 분포)가 인라인으로 펼쳐지고, Decision Tree 분기(매각 vs 유지 분기점) 시각화가 동시에 강조된다. (UI_RECOMMENDATION_TRACE-001 컴포넌트 prop 매핑) |
| AC-6 | 결과 카드 우측 보조 버튼 "Decide에서 보기" 클릭 | 클릭 이벤트 발생 | `switchMode('decide')` 호출되며 URL이 `?mode=decide&ctx=npl.sell&portfolio=<id>&trace=on` 로 갱신된다. Decide 모드 도착 시 해당 채권 동이 자동 선택되고, Recommendation Trace 컴포넌트가 활성, 상단 헤더에 "← NPL 매도평가로 돌아가기" 복귀 링크가 노출된다. |
| AC-7 | `portfolio_id` 미스 (DB에 존재하지 않음) 또는 `holding_months_current` < 0 또는 `provision_rate` 범위 외 (0 미만 또는 1 초과) | "평가 실행" 클릭 | 폼 하단에 inline validation 에러 ("해당 portfolio_id를 찾을 수 없습니다" / "보유 개월수는 0 이상이어야 합니다" / "충당금률은 0~1.0 사이여야 합니다") + 결과 카드 영역은 변경 없음. |

---

## C. 입력/출력 스키마

### 입력
- 인라인 요약: `portfolio_id (필수, 단건 채권 선택용)`, `holding_months_current (필수, 정수, 현재까지 보유한 개월수)`, `provision_rate (필수, 0~1.0, 대손충당금률)`, `carry_cost_monthly_krw (선택, 월 관리비 추정 — 미입력 시 0 가정)`
- 자동 계산 (geo + 외부 데이터 기반):
  - 동 NPL 시장가 (인근 매물 호가 평균) — TBD: `ETL_NPL_DATA-001`
  - 동 회수율 분포 (asset_type별 평균/표준편차) — TBD: `ETL_NPL_DATA-001`
  - 보유 비용 = `provision_rate × claim_amount + carry_cost_monthly_krw × N`
  - 할인율 (가정 8% 연 — 1차 고정, 향후 이슈로 동적화)
- 상세 정의: [`docs/domain-menu-ia.md#b4-nplsell--입력`](../domain-menu-ia.md#b4-nplsell--입력)

### 출력
- 공통 필드: `score(=NPV gap을 0~100 정수로 매핑)`, `grade`, `top_risks[]`, `recommendation`, `trace` — [C.1 공통 출력 컨벤션](../domain-menu-ia.md#c1-공통-출력-컨벤션)
- NPL 매도평가 추가: `sell_now_npv`, `hold_npv_cone[6,12,24]` 각 `{p10,p50,p90}`, `drivers[]` (Top 5, SHAP-style `{label, impact, severity, evidence_ref}`), `recommendation.label` (즉시 매각/관망/유지) — [C.2 모델별 추가 필드](../domain-menu-ia.md#c2-모델별-추가-필드)

---

## D. NPV 계산 룰 (1차 안)

### D.1 즉시 매각 NPV
```
sell_now_npv =
  market_quote_krw × (1 - sell_discount_rate)   // 매도 할인 5% 가정
  - sell_fee_krw                                 // 매각 수수료 1.5% 가정
```
- `market_quote_krw` = 동 NPL 시장 호가 평균 (TBD: ETL_NPL_DATA-001 미완성 시 `claim_amount × 0.45` 더미 가정).
- `sell_discount_rate = 0.05` (1차 고정).
- `sell_fee_krw = market_quote_krw × 0.015` (1차 고정).

### D.2 N개월 보유 NPV (N ∈ {6, 12, 24})
```
expected_recovery(N, percentile) =
  collateral_value × recovery_rate(asset_type, percentile)
  × time_weight(N)                                        // 회수 시점 가중

hold_cost(N) =
  provision_rate × claim_amount_krw × (N / 12)            // 충당금 보유 비용 연환산
  + carry_cost_monthly_krw × N                            // 관리비 누적

hold_npv_cone[N].percentile =
  (expected_recovery(N, percentile) - hold_cost(N)) / (1 + discount_rate) ^ (N / 12)
```
- `discount_rate = 0.08` (1차 고정).
- `time_weight(N)`: 6M=0.4, 12M=0.7, 24M=1.0 (회수 도달률 가정 — 1차 휴리스틱).
- `recovery_rate(asset_type, percentile)`: ETL_NPL_DATA-001 더미 분포 (apt μ=65% σ=15%, commercial μ=50% σ=20% 등) → percentile ∈ {p10, p50, p90}.
- `collateral_value`: 담보 추정가 (asset_type별 `land_price_*` × 시세 보정).

### D.3 Recommendation 룰
| 조건 | recommendation.label |
|---|---|
| `sell_now_npv ≥ max(hold_npv_cone[6,12,24].p50)` | **즉시 매각** |
| `hold_npv_cone[24].p10 ≥ sell_now_npv × 1.2` | **유지** |
| 그 외 (애매한 중간) | **관망** (3개월 후 재평가) |

### D.4 Drivers (SHAP-style, Top 5)
각 driver는 NPV 기여도(원 단위 또는 비율)를 가지며, **양수 = 매각 추천 방향**, **음수 = 유지 추천 방향**으로 일관된 부호 컨벤션을 사용한다.

우선순위 driver 후보 (1차 룰):
1. **보유 비용 잠식** (`provision × claim × N + carry_cost × N`) — 양수일수록 매각 강함
2. **시장 호가 우위** (`market_quote - hold_npv[12].p50`) — 양수면 즉시 매각 우위
3. **장기 회수율 분산** (`hold_npv[24].p90 - hold_npv[24].p10`) — 분산 클수록 유지 리스크 ↑ → 매각 추천 방향
4. **할인율 잠식** (`(1 - 1/(1+r)^(N/12))`) — N 클수록 양수 (시간 가치 감소 → 매각 추천)
5. **회수 중앙값 우위** (`hold_npv[N].p50 - sell_now_npv`) — 양수면 보유 추천 (음수 부호로 반영)

> 1차 안. 실제 SHAP 계산은 `UI_RECOMMENDATION_TRACE-001` 컴포넌트 산출 시점에 정해진 schema(`{label, impact, severity, evidence_ref}`)로 매핑.
> 결정성 보장: 동일 입력 → 동일 NPV/cone/drivers (캐시 또는 deterministic compute).

---

## E. 등급 매핑 (NPV 비교 기반 — 매각 적합도 관점)

| 조건 | grade | brand 토큰 | hex | 의미 라벨 | recommendation.label |
|---|---|---|---|---|---|
| 즉시 매각 추천, NPV gap (`sell_now_npv - max(hold[*].p50)`) ≥ 20% | `very_high` | `plddt_high` | `#00529B` | 즉시 매각 (확신) | 즉시 매각 |
| 즉시 매각 추천, NPV gap < 20% | `high` | `plddt_mid` | `#5BC0EB` | 매각 검토 | 즉시 매각 |
| 관망 (3개월 후 재평가) | `medium` | `plddt_low` | `#FED766` | 관망 (재평가 권장) | 관망 |
| 유지 추천 (`hold[24].p10 ≥ sell × 1.2`) | `low` | `plddt_poor` | `#C9485B` | 매각 보류 (유지 권장) | 유지 |

> brand-dna `anti_patterns`: "AlphaFold pLDDT 색상 체계 임의 변경" — 위 4색 외 다른 색 금지.
> ⚠ **매도 모델 색 의미 특수성 — H절 가드 필수**: 본 모델은 "매각 적합도"를 점수화한다. 채권 자체의 가치 평가가 아니라 **'매각 결정의 적합도'**. 점수 낮음(`grade=low`, 빨강)은 "채권이 나쁘다"가 아니라 "매각하기에 비추 = 유지 추천"이라는 뜻. 결과 카드 상단 라벨로 이 의미를 강제 노출한다.

---

## F. 화면 명세 (와이어프레임 텍스트)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [홈] > [NPL ▾] > 매도평가                              (브레드크럼) │
├──────────────────────────────────────────────────────────────────────┤
│ ⓘ 매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)│
├──────────────────────────────────────────────────────────────────────┤
│  [좌 50% — 입력 폼]                  │ [우 50% — 결과 카드]           │
│                                       │                                │
│  포트폴리오 검색 *                    │  ┌─ NPV 비교 (헤드라인) ───┐  │
│  [_______________________________]    │  │ 즉시매각 vs 12M 보유 p50 │  │
│  (portfolio_id autocomplete)          │  │ ▌ 2.40억 vs 2.10억       │  │
│                                       │  │   즉시 매각 (확신)        │  │
│  채권 선택 (단건)   [채권 #001 ▾]    │  └──────────────────────────┘  │
│                                       │                                │
│  현재까지 보유 개월수 * [__] M        │  [배지] 즉시 매각              │
│  대손충당금률 *     [__] %            │                                │
│  월 관리비 (선택)   [____] 원         │  Top 5 Drivers (SHAP)          │
│                                       │  ▮▮▮▮▮▮▮ 보유 비용 잠식 (+)  │
│  ┌──────────────────────┐             │  ▮▮▮▮▮ 시장 호가 우위 (+)    │
│  │  ▶ 평가 실행 (CTA)   │ ← primary   │  ▮▮▮ 장기 회수율 분산 (+)    │
│  └──────────────────────┘             │  ▮▮ 할인율 잠식 (+)           │
│                                       │  ▮ 회수 중앙값 우위 (-)       │
│  (입력 안내: brand voice 톤)          │                                │
│  "보유 채권 정보를 입력하면 매각/유지  │  ┌──────────────────────┐      │
│   타이밍 분석이 시작됩니다."          │  │ Decide에서 보기 →    │ 보조│
│                                       │  └──────────────────────┘      │
├──────────────────────────────────────────────────────────────────────┤
│  [전폭] Recommendation Trace (UI_RECOMMENDATION_TRACE-001 마운트)    │
│   ┌─ SHAP 막대 (driver별 NPV 기여) ─┐  ┌─ Decision Tree 분기 ─┐    │
│   │ ▮▮▮▮▮▮▮ 보유비용잠식 +0.30억   │  │ NPV gap ≥ 20%? ─Yes─→ │    │
│   │ ▮▮▮▮▮ 시장호가우위 +0.18억     │  │             ─No──→ ... │    │
│   │ ...                              │  │                        │    │
│   └──────────────────────────────────┘  └────────────────────────┘    │
│                                                                        │
│  [전폭] 6/12/24M cone 비교 차트 (p10/p50/p90 + sell_now_npv 기준선)  │
└──────────────────────────────────────────────────────────────────────┘
```

### 명세 요약
- **상단**: 브레드크럼 `홈 > NPL ▾ > 매도평가`. 컨텍스트 배지(`npl.sell`).
- **상단 가드 라벨 (필수)**: 화면 폭 전체에 회색 1줄 "매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)" 고정. (H절 글로벌 색 일관성 룰 + 매도 모델 특수성 가드)
- **좌 50%**: 입력 폼. `portfolio_id` autocomplete + 단건 채권 선택 + `holding_months_current` + `provision_rate` 필수. `carry_cost_monthly_krw` 선택. 화면당 primary CTA 1개 = "평가 실행". (`primary_action_per_screen: MUST_EXIST`)
- **우 50%**: 결과 카드. 헤드라인은 `sell_now_npv vs hold_npv_cone[12].p50` 큰 숫자 2개 비교 + 좌측 보더 색상(grade 기반) + 등급 배지 + recommendation 배지(아웃라인). Top 5 drivers는 SHAP-style 막대 (양수=매각 방향=파랑, 음수=유지 방향=빨강). 보조 버튼 "Decide에서 보기" (secondary, outline).
- **하단 전폭 영역 1**: `UI_RECOMMENDATION_TRACE-001` 컴포넌트 마운트 슬롯 (SHAP 막대 + Decision Tree 분기 시각화).
- **하단 전폭 영역 2**: 6/12/24M cone 비교 차트 — x축 보유개월(0=즉시매각, 6, 12, 24), y축 NPV. cone (p10~p90 음영) + sell_now_npv 수평 기준선.
- **빈 상태(평가 전)**: 우 50% 영역에 "보유 채권 정보를 입력하면 매각/유지 타이밍 분석이 시작됩니다" 1줄 안내 (brand_voice: 분석가의 절제). 일러스트 없음 (anti-pattern).
- **에러 상태**: AC-7. inline validation 에러 + 폼 활성 유지.

### Brand 자가 검증 (UI 자식 이슈에서 적용)
- [ ] hero_color `#00529B`를 "평가 실행" CTA 배경에 사용. (단, NPV 비교 결과 카드의 강조색은 grade에 따라 4단계 plddt 색상으로 결정)
- [ ] Top 5 drivers 막대 색상은 plddt 4색만 사용 (양수=`plddt_high`/`plddt_mid` 파랑 계열, 음수=`plddt_poor` 빨강). 무지개/그라디언트 금지.
- [ ] CTA는 화면당 정확히 1개 (보조 버튼은 outline/ghost로 시각 weight 차별).
- [ ] 0.5초 룰: NPV 비교 헤드라인 → recommendation 배지 → drivers Top 5 → 다음 액션(Decide에서 보기) 좌→우→하 시선 흐름.
- [ ] 일러스트/3D/네온 없음.
- [ ] H절 색 일관성 가드 라벨 노출 확인 + **매도 모델 특수성 라벨 강조** ("매각 적합도 — 색상은 매각 추천 강도").
- [ ] Recommendation Trace 컴포넌트는 `UI_RECOMMENDATION_TRACE-001` 산출물 그대로 사용 (재구현 금지).
- [ ] cone 비교 차트는 `viz/plugins/npl-npv.js` 산출 데이터를 입력으로 받는 단일 책임 컴포넌트.

---

## G. 분해 — 자식 이슈 (5개)

모두 BLOCKED, `depends_on = USER_STORY_NPL_SELL-001`. 본 USER_STORY 완료(이 명세서 작성) 시 일괄 READY. 단, G.3은 `UI_RECOMMENDATION_TRACE-001` 완료에도 의존.

### G.1 `GENERATE_CODE_NPL_SELL_UI-001` (P1, agent-harness, sonnet)
- 범위: 입력 폼 + 결과 카드 (sell vs hold 헤드라인) + drivers Top 5 SHAP 막대 + Recommendation Trace 마운트 슬롯 + Decide deep-link 트리거.
- files:
  - `components/npl-sell.js` (신규) — 컴포넌트
  - `index.html` (surgical: `[NPL ▾]` 드롭다운에 "매도평가" 항목 추가만 — npl-buy 메뉴 항목 옆)
  - `css/npl.css` (매수와 공유 — `GENERATE_CODE_NPL_BUY_UI-001`이 먼저 생성. 매도 전용 클래스만 추가)
- NPV/cone/drivers 계산은 자리만 잡고 `compute_npl_sell_npv()` 함수 import (G.2에서 구현).
- Recommendation Trace 영역은 빈 컨테이너만 마운트 (G.3에서 데이터 어댑터 + 컴포넌트 prop 매핑).

### G.2 `GENERATE_CODE_NPL_SELL_NPV-001` (P1, agent-harness, sonnet)
- 범위: D절 즉시매각 NPV + 6/12/24M 보유 cone + recommendation 룰 + drivers Top 5 산출.
- files:
  - `viz/plugins/npl-npv.js` (신규) — NPV/cone/drivers 계산 로직
- Mock 시장가/회수율 (asset_type별 더미 분포; ETL_NPL_DATA-001 완료 전까지). 외부 시장 호가 더미.
- 1차는 분위수 추정 + 결정성 룰만 충분. Monte Carlo는 후속 이슈로 분리.
- 결정성 보장: 동일 입력 → 동일 NPV/cone/drivers.
- `parallel_with: ETL_NPL_DATA-001` (더미 모드로 우선 동작 → 완료 후 실데이터 교체 follow-up).

### G.3 `INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL-001` (P1, agent-harness, sonnet)
- 범위: `UI_RECOMMENDATION_TRACE-001` 산출 컴포넌트(`viz/plugins/recommendation-trace.js`)를 NPL 매도 결과 카드 하단에 마운트 + drivers Top 5 → SHAP 막대 + Decision Tree 분기 데이터 어댑터.
- files:
  - `viz/plugins/recommendation-trace.js` (재활용 — `UI_RECOMMENDATION_TRACE-001` 산출물 그대로 사용)
  - `components/npl-sell.js` (G.1 산출물에 Recommendation Trace 슬롯 연결만 — surgical)
- 어댑터:
  - drivers Top 5 → SHAP 막대 schema (`{label, impact_krw, sign, evidence_ref}`)
  - recommendation.label + NPV gap → Decision Tree 분기 노드 schema (`{node_id, condition, taken_branch}`)
  - 컴포넌트 prop schema (`{ shap_drivers: [...], decision_tree: {nodes, edges}, click_handler }`)에 흘려보냄.
- depends_on: `UI_RECOMMENDATION_TRACE-001` (해당 이슈 완료 후 진행) + `GENERATE_CODE_NPL_SELL_UI-001` (G.1 마운트 슬롯) + `GENERATE_CODE_NPL_SELL_NPV-001` (G.2 drivers 산출).

### G.4 `RUN_TESTS_NPL_SELL-001` (P1, test-harness, sonnet)
- 범위:
  - **단위 테스트**: D절 즉시매각 NPV 계산 검증, 6/12/24M cone 단조성(p10≤p50≤p90), 보유 비용 누적 (보유개월 ↑ → hold_cost ↑), recommendation 룰 3가지 분기 (즉시 매각 / 관망 / 유지) 모두 발생, drivers Top 5 부호 컨벤션(양수=매각 방향).
  - **캐릭터 저니 (Playwright)** — 페르소나: NPL 매도 담당자
    | 스텝 | 행동 | 기대 결과 | 스크린샷 |
    |---|---|---|---|
    | 1 | 페이지 로드 | 글로벌 네비에 `[NPL ▾]` 노출 | `/tmp/journey-npl-sell-1.png` |
    | 2 | `[NPL ▾]` → "매도평가" 클릭 | URL `?mode=npl.sell`, 입력 폼 + 빈 상태 결과 카드 + 상단 매각 적합도 가드 라벨 표시 | `/tmp/journey-npl-sell-2.png` |
    | 3 | portfolio_id "port-001" 검색 → 채권 선택 + 보유개월수 6 + 충당금률 30% 입력 | 폼 valid 상태, CTA 활성 | `/tmp/journey-npl-sell-3.png` |
    | 4 | "평가 실행" 클릭 | 5초 이내 결과 카드 (sell vs hold 헤드라인 + recommendation 배지 + drivers Top 5 SHAP 막대) + Recommendation Trace 컴포넌트 렌더 | `/tmp/journey-npl-sell-4.png` |
    | 5 | "Decide에서 보기" 클릭 | `?mode=decide&ctx=npl.sell&portfolio=port-001&trace=on` 도달 | `/tmp/journey-npl-sell-5.png` |

### G.5 `BIZ_VALIDATE_NPL_SELL-001` (P2, biz-validator, sonnet)
- 범위: 시나리오 갭 검증.
  - **3가지 추천 발생 시나리오**: 즉시 매각 / 관망 / 유지 각 1건 샘플 (총 3 채권)
  - **엣지 케이스**:
    1. **시장 호가 부재** (ETL 더미도 산출 불가) → 즉시 매각 NPV "N/A" 표시 + recommendation = "관망 (시장 호가 부재 — 외부 평가 필요)" + CTA "수동 호가 입력" 후속 이슈 안내.
    2. **충당금률 100%** (`provision_rate = 1.0` — 잔존가 0) → 보유 비용이 청구액 전액 → drivers "보유 비용 잠식" 압도 → recommendation = "즉시 매각" 강제.
    3. **보유 0개월** (`holding_months_current = 0` — 신규 인수 채권) → 보유 비용 누적 0 → recommendation은 cone 분포에 따라 결정 (보통 "관망" 또는 "유지").
    4. **portfolio_id 미스** → AC-7 폼 validation 에러.
    5. **단일 채권에 다수 담보** (1차는 단일 담보 가정) → friendly fallback "1차 스코프는 단일 담보 채권만 지원합니다" 안내 박스 + CTA 비활성.
- 결과: BIZ_FIX P0 자동 spawn (CRITICAL 갭 발견 시).

---

## H. 색상 의미 글로벌 일관성 룰 (필수)

본 프로젝트의 모든 평가 모델에 적용되는 글로벌 색 일관성 룰을 명시한다. 모델별로 score 의미가 반대일 수 있으므로(예: 약국 폐업평가 hazard ↑ = 나쁨, NPL 매도평가 매각 적합도 = "매각 결정의 좋고 나쁨"), **라벨 텍스트로 방향성을 명시**하고 **색은 일관된 의미("매각 결정에 좋음=파랑, 나쁨=빨강")**로 사용한다.

### H.1 글로벌 색 의미 (절대 규칙)
| 의미 | 색 | brand 토큰 | hex |
|---|---|---|---|
| **좋음** (positive — 매각 결정에 유리/명확) | 파랑 | `plddt_high` / `plddt_mid` | `#00529B` / `#5BC0EB` |
| **중립** (neutral — 관망/추가 정보 필요) | 노랑 | `plddt_low` | `#FED766` |
| **나쁨** (negative — 매각 비추/유지 권장) | 빨강 | `plddt_poor` | `#C9485B` |

### H.2 모델별 점수 방향
| 모델 | score 의미 | 100점 색 | 라벨 (상단 가드) |
|---|---|---|---|
| 점포개발 (`pharmacy.develop`) | 높을수록 **좋음** (입지 적합도) | `#00529B` 파랑 | "적합도 — 높을수록 좋음" |
| 폐업평가 (`pharmacy.close`) | 높을수록 **나쁨** (hazard) | `#C9485B` 빨강 | "위험도 — 높을수록 나쁨" |
| NPL 매수평가 (`npl.buy`) | IRR ↑ = **좋음** (수익성) | `#00529B` 파랑 | "수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)" |
| **NPL 매도평가 (`npl.sell`)** | **매각 적합도** (매각 추천 강도) | `#00529B` 파랑 (즉시 매각 추천 시) / `#C9485B` 빨강 (유지 추천 시) | **"매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)"** |

### H.3 매도 모델 특수성 가드 (NPL 매도평가 전용)
1. **결과 카드 상단 라벨 텍스트 강제 노출 — 매도 특수성 명시 필수**: "매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)" 회색 1줄 배지로 화면 상단 고정. 아이콘(ⓘ) + 텍스트. 사용자가 dismiss 불가 (1차 스코프). **"채권 자체의 가치 평가가 아니라 매각 결정의 적합도"**라는 의미 가드.
2. **drivers SHAP 막대 부호 컨벤션 일관성**: 양수 = 매각 추천 방향 = 파랑 계열. 음수 = 유지 추천 방향 = 빨강. 막대 부호와 색이 항상 일치해야 함.
3. **NPL 매수 모델과의 색 의미 비교 금지**: 매수(npl.buy)는 IRR ↑ = 파랑 (채권 자체 수익성), 매도(npl.sell)는 매각 강추 = 파랑 (매각 결정 적합도). 동일 색이지만 의미 축이 다름. 같은 화면 좌우 비교 UI 1차 스코프 OUT (인지 혼선 방지).
4. **score → grade 변환 함수 분리**: `npl-npv.js`는 자체 grade 매핑 함수를 가지며 매수/약국 모델과 공유하지 않는다. 공통 유틸 추출 금지 (혼동 방지).
5. **anti_patterns**: 같은 카테고리 내 색 의미 혼동 → 결과 카드 상단 라벨 필수. brand-dna `anti_patterns` 항목으로 등록 검토.
6. **테스트 강제**: G.4 RUN_TESTS의 캐릭터 저니 스텝 2에서 "상단 매각 적합도 가드 라벨 표시" 명시적 assert.

---

## I. 의존성 / 병렬

| 이슈 | 의존 | 병렬 |
|---|---|---|
| G.1 UI | USER_STORY (this) | G.2 NPV와 병렬 (interface 계약 = `compute_npl_sell_npv(input) → output schema C.1+C.2`) |
| G.2 NPV | USER_STORY (this) | G.1 UI와 병렬. `parallel_with: ETL_NPL_DATA-001` (더미 모드) |
| G.3 INTEGRATE_RECOMMENDATION_TRACE | G.1 + G.2 + `UI_RECOMMENDATION_TRACE-001` 셋 다 완료 | — |
| G.4 RUN_TESTS | G.1 + G.2 + G.3 모두 완료 | — |
| G.5 BIZ_VALIDATE | G.2 완료 | G.4와 병렬 |
| `ETL_NPL_DATA-001` | (이미 READY) | G.2와 병렬. 완료 시 더미 → 실데이터 교체 follow-up. |
| `UI_RECOMMENDATION_TRACE-001` | (현재 BLOCKED — `MODULE_COUNTERFACTUAL-001` + `UI_REDESIGN_MEONGBUN_LAYOUT-001` 의존 추정) | G.3의 직접 의존성. 해당 이슈 완료 전엔 G.3 BLOCKED 유지. |

---

## J. 마무리 체크리스트 (product-manager 자가 검증)

- [x] `docs/stories/npl-sell.md` 생성 (이 파일).
- [x] 1차 스코프 OUT 표 명시 (Karpathy #2 Simplicity — 포트폴리오/크롤링/PDF/알림/부분매각/ML 모두 OUT).
- [x] AC 7개 Given-When-Then.
- [x] 즉시매각 NPV + 6/12/24M 보유 cone 계산식 + recommendation 룰 + drivers Top 5 산출 명시.
- [x] pLDDT 색상 4단계 brand-dna에서 인용 + 매각 적합도 등급 매핑.
- [x] 자식 이슈 5개 분해 (UI / NPV / Recommendation Trace 통합 / Test / Biz).
- [x] ETL_NPL_DATA-001 의존성 + 더미 fallback 명시 ("TBD" 표기).
- [x] UI_RECOMMENDATION_TRACE-001 재활용 명시 (G.3).
- [x] H절 색 일관성 글로벌 룰 (좋음=파랑, 나쁨=빨강) 명시 + **매도 모델 특수성 가드 라벨** 강조 ("매각 적합도 — 색상은 매각 추천 강도").
- [x] code 파일 직접 수정 없음 (Karpathy #3 Surgical) — 본 이슈에서 만진 파일은 docs/와 registry.json만.
- [x] 형제 문서 `pharmacy-develop.md` / `pharmacy-close.md` / `npl-buy.md` 비수정 (구조만 모방).
- [x] **4개 USER_STORY 분해 라운드 4/4 완료** — 다음 사이클은 4개 모델의 자식 GENERATE_CODE/INTEGRATE/UX_DESIGN 이슈가 ux-harness/agent-harness로 픽업.
