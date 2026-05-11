# NPL 매수평가 — User Story 명세서

> 작성: product-manager (Harness `USER_STORY_NPL_BUY-001`)
> 일자: 2026-05-04
> 부모: `FEATURE_DOMAIN_MENU-001` · IA 문서: [`docs/domain-menu-ia.md`](../domain-menu-ia.md)
> 형제 모델: [`docs/stories/pharmacy-develop.md`](./pharmacy-develop.md), [`docs/stories/pharmacy-close.md`](./pharmacy-close.md) (구조 모방, 색 의미는 H절 글로벌 룰 참조)
> 브랜드 토큰: [`.claude/brand-dna.json`](../../.claude/brand-dna.json)
> 비파괴 원칙: 기존 4모드(Gallery/Explore/Analyze/Decide) + 6보조 모드 그대로. 상단 글로벌 네비 `[NPL ▾]` 드롭다운에 "매수평가" 항목 1개 추가하여 단일 화면을 신규로 만든다. **`UI_SCENARIOS_3OPTION-001` (이미 등록된 명분 사슬 ❺ 섹션 — A/B/C cone 비교 컴포넌트)** 을 결과 카드 하단에 마운트하여 매수가 시나리오 비교 데이터를 흘려보낸다.

---

## A. 사용자 스토리 (Job-To-Be-Done)

### 메인 스토리
**As-a** NPL(부실채권) 매수 심사역
**I-want** 부실채권 매수 검토 시 담보 부동산의 회수 예측 cone(p10/p50/p90) + 권리분석 메타 기반의 실회수금 추정 + 후보 매수가 ±15% 시나리오 A/B/C의 IRR 비교를 즉시 보고
**So-that** 입찰가 결정과 위원회 심사 보고를 데이터로 정당화하고, 선순위/세금/임차 잠식 위험을 실수 없이 반영한다.

### 보조 스토리 (1차 스코프 IN)
- **B1.** As-a 매수 심사역, I-want 결과 카드의 "Decide에서 보기" 버튼으로 cone(p10/p50/p90) + 시나리오 A/B/C가 그려진 Decide 모드로 한 번에 점프하기, So-that 동일 후보 매물을 시간 축에서 다시 검증한다.
- **B2.** As-a 매수 심사역, I-want 결과 카드 하단에 인근 경매 낙찰가율(평균 매각가 / 감정가) 미니 테이블을 함께 보기, So-that 회수가 추정의 근거를 즉시 검증한다.

### 1차 스코프 OUT (다음 분기/별도 이슈)
| 기능 | 사유 | 후속 이슈 후보 |
|---|---|---|
| 권리관계 JSON 자동 파싱(등기부 OCR 등) | 1차는 수동 입력 또는 구조화 폼으로 충분. OCR 도입은 별도 트랙 | `INFRA_NPL_DEED_OCR-001` (P3) |
| 위원회 심사 보고서 PDF 자동 생성 | `report-pdf-builder` skill 별도 트랙 | `REPORT_NPL_BUY_PDF-001` (P2) |
| 매수가 자동 추천 (역산 — 목표 IRR로부터 매수가 도출) | 1차는 사용자 입력 매수가 기준 시나리오만 | `MODEL_NPL_BUY_BID_OPTIMIZE-001` (P2) |
| 포트폴리오 대시보드 (다건 매수 동시 비교) | 단일 채권 평가 흐름 안정 후 phase 2 | `USER_STORY_NPL_BUY_PORTFOLIO-001` (P3) |
| ML 회수율 학습 모델 | D절 1차 안 분위수 추정 검증 후 진행 | `MODEL_NPL_BUY_RECOVERY_TUNE-001` (P2) |
| 부동산 외 채권(상거래/카드/금융) | 1차는 부동산 담보 NPL만 | — (friendly fallback로 안내만) |

> Karpathy #2 (Simplicity): 1차 스코프 = **단일 채권 평가 + 회수 cone + 3시나리오(A/B/C) + Decide deep-link**. 그 외는 모두 후순위.

---

## B. Acceptance Criteria (Given-When-Then)

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | `address` + `claim_amount_krw` + `candidate_bid_krw` + `rights{senior_lien_krw, tax_arrears_krw, tenant_deposit_krw}` 입력, 필수 검증 통과 | "평가 실행" CTA 클릭 | 5초 이내 결과 카드에 `expected_recovery_cone {p10,p50,p90}`(원), `irr_estimate`(연환산 %), `scenarios[A,B,C]`(매수가/IRR/회수금), `top_risks[]`(≤3), `cone_link` URL이 렌더된다. |
| AC-2 | `irr_estimate >= 25%` (`grade = very_high`) | 결과 카드 렌더 | 좌측 보더와 등급 배지가 brand-dna `plddt_high = #00529B`로 표시되고, 등급 라벨은 "적극 매수 (very_high)", `recommendation.label = "적극 매수"`. |
| AC-3 | `irr_estimate < 5%` 또는 음수 (`grade = low`) | 결과 카드 렌더 | 좌측 보더 `#C9485B`, 등급 라벨 "입찰 비추 (low)", 상단 인라인 경고 1줄 "예상 IRR 임계 미달 — 매수 비추천". `recommendation.label = "입찰 비추"`. |
| AC-4 | 권리관계 선순위 합 (`senior_lien_krw + tax_arrears_krw + tenant_priority_amt`) ≥ 청구액 90% | 평가 실행 → 결과 카드 렌더 | `top_risks` 첫 항목에 `{label:"선순위 잠식 위험", severity:"critical", contribution:<강한 음수>}`가 반드시 포함되고, grade는 `low` (빨강)로 강제. |
| AC-5 | 후보 매수가 1개 입력 | 평가 실행 | 자동으로 `scenarios = [A:보수(0.85x, p10), B:기본(1.00x, p50), C:공격(1.15x, p90)]` 3개가 생성되고, 결과 카드 하단 `UI_SCENARIOS_3OPTION-001` 컴포넌트 마운트 슬롯에 prop으로 전달된다. |
| AC-6 | 시나리오 A/B/C cone 비교 노출 상태 | 카드 우측 보조 버튼 "Decide에서 보기" 클릭 | `switchMode('decide')` 호출되며 URL이 `?mode=decide&ctx=npl.buy&address=<encoded>&scenarios=A,B,C` 로 갱신된다. Decide 모드 도착 시 해당 동이 자동 선택되고, 시나리오 컴포넌트가 활성, 상단 헤더에 "← NPL 매수평가로 돌아가기" 복귀 링크가 노출된다. |
| AC-7 | `claim_amount_krw` 미입력 또는 `rights` 구조화 입력 누락 (정수 파싱 실패) | "평가 실행" 클릭 | 폼 하단에 inline validation 에러 ("청구액을 입력해주세요" / "권리관계 금액을 숫자로 입력해주세요") + CTA 비활성 해제(재시도 가능). 결과 카드 영역은 변경 없음. |
| AC-8 | `expected_recovery_cone.p50` < `candidate_bid_krw` (회수 중앙값보다 매수가가 큰 경우) | 결과 카드 렌더 | `irr_estimate`가 음수로 산출되고, grade `low` (빨강), `recommendation.label = "입찰 비추"`, top_risks에 "회수 중앙값 < 매수가" 포함. |

---

## C. 입력/출력 스키마

### 입력
- 인라인 요약: `address (필수)`, `asset_type (선택, default=apt)`, `claim_amount_krw (필수, 정수)`, `candidate_bid_krw (필수, 정수)`, `rights.senior_lien_krw / tax_arrears_krw / tenant_deposit_krw / tenant_priority (선택)`
- 자동 계산 (geo + 외부 데이터 기반):
  - 동 평균 지가 (asset_type별: `land_price_apt`/`land_price_house`/`land_price` 등)
  - 12M 거래량 (`tx_volume`, `tx_apt_count`, `tx_house_count`)
  - 공실률 proxy (vacancy)
  - 동 NPL 회수율 통계 분포 (TBD: `ETL_NPL_DATA-001`)
  - 인근 경매 낙찰가율(평균 매각가 / 감정가) (TBD: `ETL_NPL_DATA-001`)
- 상세 정의: [`docs/domain-menu-ia.md#b3-nplbuy--입력`](../domain-menu-ia.md#b3-nplbuy--입력)

### 출력
- 공통 필드: `score(=irr_estimate를 0~100 정수로 매핑)`, `grade`, `top_risks[]`, `recommendation`, `trace` — [C.1 공통 출력 컨벤션](../domain-menu-ia.md#c1-공통-출력-컨벤션)
- NPL 매수평가 추가: `expected_recovery_cone {p10,p50,p90}`, `irr_estimate`, `scenarios[A,B,C]`(매수가/회수금/irr/회수율가정), `auction_benchmarks[]`(인근 경매 낙찰가율 Top 3) — [C.2 모델별 추가 필드](../domain-menu-ia.md#c2-모델별-추가-필드)

---

## D. 회수 예측 + IRR 계산 룰 (1차 안)

### D.1 회수 cone (p10/p50/p90)
- **데이터 입력**: 동 NPL 회수율 분포(TBD: `ETL_NPL_DATA-001`. 미완성 시 asset_type별 더미 분포 사용 — 예: apt 평균 65% σ=15%, commercial 평균 50% σ=20%) + 담보 부동산 추정가(asset_type별 `land_price_*` × 시세 보정 계수).
- **방법 (1차 안)**: 분위수 추정(Quantile Estimation). Monte Carlo 1000회까지는 1차 스코프 OUT. 회수율 분포에서 직접 p10/p50/p90 추출 → 담보 추정가 곱 → 회수금 cone.
  - `recovery_amount(percentile) = collateral_value × recovery_rate(percentile)`
  - `expected_recovery_cone.p10 = recovery_amount(p10)` (보수)
  - `expected_recovery_cone.p50 = recovery_amount(p50)` (기본)
  - `expected_recovery_cone.p90 = recovery_amount(p90)` (낙관)

### D.2 실회수금 (권리관계 차감)
```
net_recovery(percentile) =
  max(0,
    recovery_amount(percentile)
    - rights.senior_lien_krw
    - rights.tax_arrears_krw
    - tenant_priority_amt(rights.tenant_deposit_krw, rights.tenant_priority)
  )
```
- `tenant_priority_amt`:
  - `tenant_priority = "small"` → 소액임차인 최우선변제액(지역별 상한, 1차는 5천만원 일괄 가정)
  - `tenant_priority = "priority"` → `tenant_deposit_krw` 전액
  - `tenant_priority = "none"` → 0

### D.3 IRR estimate (연환산)
- 보유기간 가정 12개월(1차 스코프 — 평균 회수기간).
- `irr_estimate = ((net_recovery(p50) - candidate_bid_krw - costs) / candidate_bid_krw) × (12 / holding_months)`
- `costs` = 등록세/이자/관리비 proxy = `candidate_bid_krw × 0.05` (1차 단순 가정).
- `holding_months = 12` 고정 (1차).
- 음수 가능. AC-8.

### D.4 시나리오 A/B/C
| 시나리오 | 매수가 | 회수율 가정 | 의도 |
|---|---|---|---|
| **A 보수** | `candidate_bid_krw × 0.85` | p10 (보수 회수율) | 안전판 — 최악 시나리오에서도 +IRR 가능한지 |
| **B 기본** | `candidate_bid_krw × 1.00` | p50 (중앙값) | 입력값 그대로 — 표준 평가 |
| **C 공격** | `candidate_bid_krw × 1.15` | p90 (낙관 회수율) | 경쟁 입찰 시나리오 — 상한 매수가 검토 |

각 시나리오마다 `{bid, net_recovery, irr, grade}` 산출 → `UI_SCENARIOS_3OPTION-001` 컴포넌트 prop으로 전달.

> 1차 안. ML 회수율 모델은 별도 이슈(`MODEL_NPL_BUY_RECOVERY_TUNE-001`).
> top_risks[≤3]는 다음 우선순위로 산출: ❶ 선순위 잠식(AC-4) → ❷ 회수 중앙값 < 매수가(AC-8) → ❸ 인근 경매 낙찰가율 하락 추세 → ❹ asset_type별 회수율 분산 큼.
> 결정성 보장: 동일 입력 → 동일 cone/irr (캐시 또는 deterministic compute).

---

## E. 등급 매핑 (IRR 기준)

| irr_estimate (연환산) | grade | brand 토큰 | hex | 의미 라벨 | recommendation.label |
|---|---|---|---|---|---|
| ≥ 25% | `very_high` | `plddt_high` | `#00529B` | 적극 매수 | 적극 매수 |
| 15 ~ 24% | `high` | `plddt_mid` | `#5BC0EB` | 매수 검토 | 매수 검토 |
| 5 ~ 14% | `medium` | `plddt_low` | `#FED766` | 신중 검토 | 신중 검토 |
| < 5% (음수 포함) | `low` | `plddt_poor` | `#C9485B` | 입찰 비추 | 입찰 비추 |

> brand-dna `anti_patterns`: "AlphaFold pLDDT 색상 체계 임의 변경" — 위 4색 외 다른 색 금지.

---

## F. 화면 명세 (와이어프레임 텍스트)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [홈] > [NPL ▾] > 매수평가                              (브레드크럼) │
├──────────────────────────────────────────────────────────────────────┤
│ ⓘ 수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강) — H절 글로벌 룰  │
├──────────────────────────────────────────────────────────────────────┤
│  [좌 50% — 입력 폼]                  │ [우 50% — 결과 카드]           │
│                                       │                                │
│  담보 주소 *                          │  ┌─ IRR 추정 ──────────────┐  │
│  [_______________________________]    │  │ ▌ 18.4% / 연  매수 검토 │  │
│  (autocomplete 지원)                  │  └──────────────────────────┘  │
│                                       │                                │
│  자산 유형          [APT ▾]           │  [배지] 매수 검토              │
│  청구액 *           [____] 원         │                                │
│  후보 매수가 *      [____] 원         │  Top 위험요인                  │
│                                       │  • 선순위 잠식 위험 (-22)      │
│  ─ 권리관계 ─                         │  • 회수 중앙값 근접 매수가(-9) │
│  선순위 채권        [____] 원         │  • 인근 낙찰가율 하락 추세(-5) │
│  세금 체납          [____] 원         │                                │
│  임차보증금         [____] 원         │  ┌──────────────────────┐      │
│  임차 우선순위      [없음 ▾]          │  │ Decide에서 보기 →    │ 보조│
│  (small/priority/none)                │  └──────────────────────┘      │
│                                       │                                │
│  ┌──────────────────────┐             │  ─ 회수금 cone (p10/p50/p90) ─│
│  │  ▶ 평가 실행 (CTA)   │ ← primary   │  p10: 1.85억 / p50: 2.40억 /   │
│  └──────────────────────┘             │  p90: 3.10억                   │
│                                       │                                │
│  (입력 안내: brand voice 톤)          │                                │
│  "담보 주소와 청구액·매수가·권리관계를 │                                │
│   입력하면 회수 시나리오가 시작됩니다."│                                │
├──────────────────────────────────────────────────────────────────────┤
│  [전폭] 시나리오 A/B/C 비교 — UI_SCENARIOS_3OPTION-001 마운트 슬롯    │
│   ┌─ A 보수 ─┐  ┌─ B 기본 ─┐  ┌─ C 공격 ─┐                           │
│   │ 매수 2.55│  │ 매수 3.00│  │ 매수 3.45│                           │
│   │ IRR +28%│  │ IRR +18%│  │ IRR +9% │                            │
│   └──────────┘  └──────────┘  └──────────┘                           │
│                                                                        │
│  [표] 인근 경매 낙찰가율 Top 3 (단지명 / 평균 매각가율 / 거래수)      │
└──────────────────────────────────────────────────────────────────────┘
```

### 명세 요약
- **상단**: 브레드크럼 `홈 > NPL ▾ > 매수평가`. 컨텍스트 배지(`npl.buy`).
- **상단 가드 라벨**: 화면 폭 전체에 회색 1줄 "수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)" 고정. (H절 글로벌 색 일관성 룰)
- **좌 50%**: 입력 폼. `address` + `claim_amount_krw` + `candidate_bid_krw` 필수. `rights.*` 구조화 4필드(선택, 미입력 시 0 가정). 화면당 primary CTA 1개 = "평가 실행". (`primary_action_per_screen: MUST_EXIST`)
- **우 50%**: 결과 카드. 큰 IRR % 숫자 + 좌측 보더 색상 + 등급 배지 + recommendation 배지(아웃라인). Top 위험요인 ≤ 3개. 회수금 cone(p10/p50/p90) 한 줄 요약. 보조 버튼 "Decide에서 보기" (secondary, outline).
- **하단 전폭**: `UI_SCENARIOS_3OPTION-001` 컴포넌트 마운트 슬롯 (3카드 cone 비교) + 인근 경매 낙찰가율 Top 3 미니 테이블.
- **빈 상태(평가 전)**: 우 50% 영역에 "담보 주소와 청구액·매수가·권리관계를 입력하면 회수 시나리오가 시작됩니다" 1줄 안내 (brand_voice: 분석가의 절제). 일러스트 없음 (anti-pattern).
- **에러 상태**: AC-7. inline validation 에러 + 폼 활성 유지.

### Brand 자가 검증 (UI 자식 이슈에서 적용)
- [ ] hero_color `#00529B`를 "평가 실행" CTA 배경에 사용. (단, IRR 결과 카드의 강조색은 grade에 따라 4단계 plddt 색상으로 결정)
- [ ] Top 위험요인 색상은 plddt 4색 또는 `text_secondary` 톤만 사용. 무지개/그라디언트 금지.
- [ ] CTA는 화면당 정확히 1개 (보조 버튼은 outline/ghost로 시각 weight 차별).
- [ ] 0.5초 룰: IRR 숫자 → 등급 라벨 → recommendation → 다음 액션(Decide에서 보기) 좌→우→하 시선 흐름.
- [ ] 일러스트/3D/네온 없음.
- [ ] H절 색 일관성 가드 라벨 노출 확인.
- [ ] 시나리오 A/B/C 컴포넌트는 `UI_SCENARIOS_3OPTION-001` 산출물 그대로 사용 (재구현 금지).

---

## G. 분해 — 자식 이슈 (5개)

모두 BLOCKED, `depends_on = USER_STORY_NPL_BUY-001`. 본 USER_STORY 완료(이 명세서 작성) 시 일괄 READY.

### G.1 `GENERATE_CODE_NPL_BUY_UI-001` (P1, agent-harness, sonnet)
- 범위: 입력 폼 + 결과 카드 + 시나리오 A/B/C 마운트 슬롯 + Decide deep-link 트리거.
- files:
  - `components/npl-buy.js` (신규) — 컴포넌트
  - `index.html` (surgical: `[NPL ▾]` 드롭다운에 "매수평가" 항목 추가만)
  - `css/npl.css` (신규 — 매수/매도 공유 예정)
- 회수 cone/IRR 계산은 자리만 잡고 `compute_npl_buy_recovery()` 함수 import (G.2에서 구현).
- 시나리오 컴포넌트 영역은 빈 컨테이너만 마운트 (G.3에서 데이터 어댑터 + 컴포넌트 prop 매핑).

### G.2 `GENERATE_CODE_NPL_BUY_RECOVERY-001` (P1, agent-harness, sonnet)
- 범위: D절 회수 cone(p10/p50/p90) + 실회수금(권리관계 차감) + IRR 계산 + top_risks 산출.
- files:
  - `viz/plugins/npl-recovery.js` (신규) — 가중치/계산 로직
- Mock 회수율 데이터 (asset_type별 평균/표준편차 더미; ETL_NPL_DATA-001 완료 전까지). 외부 경매 낙찰가율 더미.
- 1차는 분위수 추정만 충분. Monte Carlo는 후속 이슈로 분리.
- 결정성 보장: 동일 입력 → 동일 cone/irr.
- `parallel_with: ETL_NPL_DATA-001` (더미 모드로 우선 동작 → 완료 후 실데이터 교체 follow-up).

### G.3 `INTEGRATE_SCENARIOS_NPL_BUY-001` (P1, agent-harness, sonnet)
- 범위: `UI_SCENARIOS_3OPTION-001` 산출 컴포넌트(`viz/plugins/scenarios-3option.js`)를 NPL 매수 결과 카드 하단에 마운트 + 매수가 ±15% 시나리오 데이터 어댑터.
- files:
  - `viz/plugins/scenarios-3option.js` (재활용 — `UI_SCENARIOS_3OPTION-001` 산출물 그대로 사용)
  - `components/npl-buy.js` (G.1 산출물에 시나리오 슬롯 연결만 — surgical)
- 어댑터: `candidate_bid_krw → scenarios = [{label:"A 보수", bid: 0.85x, recovery: cone.p10, irr}, {label:"B 기본", bid: 1.00x, recovery: cone.p50, irr}, {label:"C 공격", bid: 1.15x, recovery: cone.p90, irr}]` 매핑 → 컴포넌트 prop schema(`{ scenarios: [{label, bid, recovery, irr, grade}] }`)에 흘려보냄.
- depends_on: `UI_SCENARIOS_3OPTION-001` (해당 이슈 완료 후 진행) + `GENERATE_CODE_NPL_BUY_UI-001` (G.1 마운트 슬롯).

### G.4 `RUN_TESTS_NPL_BUY-001` (P1, test-harness, sonnet)
- 범위:
  - **단위 테스트**: D절 회수 cone(p10≤p50≤p90 단조) 검증, 권리관계 차감 (선순위 합 = 회수액 → net_recovery=0), IRR 부호 (p50 < bid → irr 음수), 4단계 grade 매핑 모두 발생, top_risks 우선순위 정렬.
  - **캐릭터 저니 (Playwright)** — 페르소나: NPL 매수 심사역
    | 스텝 | 행동 | 기대 결과 | 스크린샷 |
    |---|---|---|---|
    | 1 | 페이지 로드 | 글로벌 네비에 `[NPL ▾]` 노출 | `/tmp/journey-npl-buy-1.png` |
    | 2 | `[NPL ▾]` → "매수평가" 클릭 | URL `?mode=npl.buy`, 입력 폼 + 빈 상태 결과 카드 + 상단 색 일관성 가드 라벨 표시 | `/tmp/journey-npl-buy-2.png` |
    | 3 | 주소 "성수1가1동" + 청구액 5억 + 매수가 3억 + 선순위 1억 입력 | 폼 valid 상태, CTA 활성 | `/tmp/journey-npl-buy-3.png` |
    | 4 | "평가 실행" 클릭 | 5초 이내 결과 카드 (IRR/grade/cone) + 시나리오 A/B/C 컴포넌트 렌더 | `/tmp/journey-npl-buy-4.png` |
    | 5 | "Decide에서 보기" 클릭 | `?mode=decide&ctx=npl.buy&address=...&scenarios=A,B,C` 도달 | `/tmp/journey-npl-buy-5.png` |

### G.5 `BIZ_VALIDATE_NPL_BUY-001` (P2, biz-validator, sonnet)
- 범위: 시나리오 갭 검증.
  - **4단계 grade 발생 시나리오**: 4개 채권 샘플 (very_high / high / medium / low 각 1)
  - **엣지 케이스**:
    1. 선순위 합 ≥ 청구액 (사실상 회수 0) → AC-4 grade=low + top_risks 첫 항목 "선순위 잠식 위험"
    2. 권리관계 4필드 모두 미입력 → 0 가정 적용 + 결과 정상 산출
    3. 청구액 = 0 → AC-7 폼 validation 에러
    4. 부동산 외 채권 (asset_type 적용 불가 → friendly fallback): "1차 스코프는 부동산 담보 NPL만 지원합니다" 안내 박스 + CTA 비활성
    5. `expected_recovery.p50 < candidate_bid_krw` (회수 중앙값 < 매수가) → AC-8 IRR 음수 + grade=low + top_risks 포함
- 결과: BIZ_FIX P0 자동 spawn (CRITICAL 갭 발견 시).

---

## H. 색상 의미 글로벌 일관성 룰 (필수)

본 프로젝트의 모든 평가 모델에 적용되는 글로벌 색 일관성 룰을 명시한다. 모델별로 score 의미가 반대일 수 있으므로(예: 약국 폐업평가 hazard ↑ = 나쁨), **라벨 텍스트로 방향성을 명시**하고 **색은 일관된 의미로 사용**한다.

### H.1 글로벌 색 의미 (절대 규칙)
| 의미 | 색 | brand 토큰 | hex |
|---|---|---|---|
| **좋음** (positive) | 파랑 | `plddt_high` / `plddt_mid` | `#00529B` / `#5BC0EB` |
| **중립** (neutral) | 노랑 | `plddt_low` | `#FED766` |
| **나쁨** (negative) | 빨강 | `plddt_poor` | `#C9485B` |

### H.2 모델별 점수 방향
| 모델 | score 의미 | 100점 색 | 라벨 (상단 가드) |
|---|---|---|---|
| 점포개발 (`pharmacy.develop`) | 높을수록 **좋음** | `#00529B` 파랑 | "적합도 — 높을수록 좋음" |
| 폐업평가 (`pharmacy.close`) | 높을수록 **나쁨** (hazard) | `#C9485B` 빨강 | "위험도 — 높을수록 나쁨" |
| **NPL 매수평가 (`npl.buy`)** | **IRR ↑ = 좋음** | `#00529B` 파랑 | "수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)" |
| NPL 매도평가 (`npl.sell`) | TBD | TBD | (별도 USER_STORY) |

### H.3 가드 룰
1. **결과 카드 상단 라벨 텍스트 강제 노출**: 위 표의 라벨 문구를 회색 1줄 배지로 화면 상단 고정. 아이콘(ⓘ) + 텍스트. 사용자가 dismiss 불가 (1차 스코프).
2. **카테고리 내 색 의미 혼동 금지**: 같은 카테고리(예: 약국, NPL) 내에서 두 모델의 색 의미가 반대일 때, 동일 화면 좌우 비교 UI는 1차 스코프 OUT (인지 혼선 방지).
3. **score → grade 변환 함수 분리**: 각 모델 컴포넌트는 자체 grade 매핑 함수를 가지며 공유하지 않는다. 공통 유틸 추출 금지 (혼동 방지). hazard처럼 역방향 모델은 변환 시 색상을 명시적으로 역매핑.
4. **anti_patterns**: 같은 카테고리 내 색 의미 혼동 → 결과 카드 상단 라벨 필수. brand-dna `anti_patterns` 항목으로 등록 검토.
5. **테스트 강제**: G.4 RUN_TESTS의 캐릭터 저니 스텝 2에서 "상단 색 일관성 가드 라벨 표시" 명시적 assert.

---

## I. 의존성 / 병렬

| 이슈 | 의존 | 병렬 |
|---|---|---|
| G.1 UI | USER_STORY (this) | G.2 recovery와 병렬 (interface 계약 = `compute_npl_buy_recovery(input) → output schema C.1+C.2`) |
| G.2 RECOVERY | USER_STORY (this) | G.1 UI와 병렬. `parallel_with: ETL_NPL_DATA-001` (더미 모드) |
| G.3 INTEGRATE_SCENARIOS | G.1 + `UI_SCENARIOS_3OPTION-001` 둘 다 완료 | — |
| G.4 RUN_TESTS | G.1 + G.2 + G.3 모두 완료 | — |
| G.5 BIZ_VALIDATE | G.2 완료 | G.4와 병렬 |
| `ETL_NPL_DATA-001` | (이미 READY) | G.2와 병렬. 완료 시 더미 → 실데이터 교체 follow-up. |
| `UI_SCENARIOS_3OPTION-001` | (현재 BLOCKED — `MODULE_COUNTERFACTUAL-001` + `UI_REDESIGN_MEONGBUN_LAYOUT-001` 의존) | G.3의 직접 의존성. 해당 이슈 완료 전엔 G.3 BLOCKED 유지. |

---

## J. 마무리 체크리스트 (product-manager 자가 검증)

- [x] `docs/stories/npl-buy.md` 생성 (이 파일).
- [x] 1차 스코프 OUT 표 명시 (Karpathy #2 Simplicity).
- [x] AC 8개 Given-When-Then.
- [x] 회수 cone 단조성 + IRR 계산식 명시.
- [x] pLDDT 색상 4단계 brand-dna에서 인용 + IRR 등급 매핑.
- [x] 자식 이슈 5개 분해 (UI / Recovery / Scenarios 통합 / Test / Biz).
- [x] ETL_NPL_DATA-001 의존성 + 더미 fallback 명시 ("TBD" 표기).
- [x] UI_SCENARIOS_3OPTION-001 재활용 명시 (G.3).
- [x] H절 색 일관성 글로벌 룰 (좋음=파랑, 나쁨=빨강) 명시 + 모델별 라벨 가드.
- [x] code 파일 직접 수정 없음 (Karpathy #3 Surgical) — 본 이슈에서 만진 파일은 docs/와 registry.json만.
- [x] 형제 문서 `pharmacy-develop.md` / `pharmacy-close.md` 비수정 (구조만 모방).
