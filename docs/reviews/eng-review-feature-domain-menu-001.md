# Eng Review — FEATURE_DOMAIN_MENU-001 (약국 + NPL 4개 평가모델 메뉴화)

> 작성: plan-eng-reviewer (Harness ISS-071)
> 일자: 2026-05-04
> 검토 대상: `docs/domain-menu-ia.md` (420줄), `docs/stories/{4종}.md`, `docs/ux/{4종}-ux.md`, 자식 22개 이슈
> 시선: Engineering Lead — 아키텍처 / 데이터 흐름 / 의존성 / 테스트 / 성능 / 엣지 / 보안
> 형제 검토: `eng-review-feature-domain-menu-001`은 **실행/아키텍처만**, ISS-070(plan-ceo-reviewer)이 전략/시장 담당.

---

## A. 아키텍처 평가 — 점수 7/10

### 평가
기존 `switchMode('gallery'|'explore'|'analyze'|'decide'|'datastudio'|'workflow'|'meongbun')` 단일 디스패처 패턴(`app.js:325-353`)에 카테고리(약국/NPL)를 1급 모드로 추가하는 IA의 결정은 **합리적이지만 절반만 맞다.**

- **합리적인 부분 (7점 가산)**
  - `index.html:158-169` 상단 nav가 `<button data-mode>` 일렬 구조 → 신규 카테고리 드롭다운 1~2개 추가는 surgical하게 가능
  - `view-{mode}` 섹션 컨테이너 토글 패턴(`app.js:330-336`) → 카테고리 평가 화면도 `view-pharmacy-develop`, `view-pharmacy-close`, `view-npl-buy`, `view-npl-sell` 4개 추가로 동일 패턴 유지 가능
  - deep-link URL `?mode=decide&ctx=pharmacy.develop&address=...`는 기존 모드 코드가 이미 `currentMode` 단일 변수로 작동하므로 querystring 파싱 1곳 추가만으로 처리 가능

- **절반만 맞은 부분 (-3점)**
  - **현재 `switchMode`는 querystring을 읽지 않는다.** `app.js:181`에서 `switchMode('gallery')` 하드코딩. URL `?mode=decide&ctx=...` 진입 시 컨텍스트 배지 / 복귀 링크 / 결과 오버레이를 트리거할 진입점이 없음.
  - **카테고리(약국/NPL)와 모드(decide/analyze)는 직교 차원**인데 IA는 둘 다 `data-mode` 단일 슬롯에 박는다. `currentMode='pharmacy.develop'`이 되면 기존 `switchMode` 분기(330줄 7개 모드)가 모두 매칭 실패. 7+4=11모드 분기가 길어진다.
  - **상태 관리 부재**. 평가 폼 입력값(주소/매출/권리관계)은 컴포넌트 로컬 state여야 하는데 IA에 `currentEvaluation` 같은 전역 슬롯 정의 없음 → deep-link 왕복 시 입력값 소실.

### 권고
1. `currentMode`를 `{axis: 'analysis'|'category', view: string}` 객체로 확장하거나, 카테고리 4개를 `mode` 풀에 넣되 **카테고리 모드는 자체 폼 state를 `lastEvalContext` 전역 슬롯에 저장**한다 (TwoColumnLayout 페이지가 deep-link 왕복 시 복원).
2. `parseUrlContext()` 헬퍼 1개 추가 → `init()`에서 1회 호출 → `?mode`/`?ctx`/`?address`/`?store_id`/`?portfolio_id`/`?scenarios` 파싱 후 `switchMode(mode)` + `applyDeepLinkContext(ctx, params)` 디스패치.
3. `switchMode` 라우팅 테이블을 lookup map으로 리팩토링(switch chain 방지) — 11개 모드면 readability 한계. 단 이건 스코프 밖이므로 **별도 REFACTOR 이슈**.

---

## B. 데이터 흐름 평가 — 점수 6/10

### 평가
공유(`simula_data_real.json`) + 약국 전용(`data_raw/pharmacy/`) + NPL 전용(`data_raw/npl/`) 분리 정책은 깔끔하지만 다음 위험이 있다.

- **현재 데이터 로딩 전략(`app.js:80-98`)**: `loadData('real')` 단일 fetch + `simula` 폴백. 신규 4개 모델이 도메인 전용 데이터를 추가로 fetch하면 **로딩 순서 race**가 발생할 수 있다.
  - 사용자가 약국·점포개발 메뉴 진입 시 `pharmacy/dispensary_distribution.json` fetch가 진행 중인데 평가 실행 클릭 → undefined 참조.
- **더미 fallback 정책 일관성 위험**: `docs/domain-menu-ia.md:F절`은 "ETL 미완성 시 도메인 전용 필드는 mock"이라고만 적시. 4개 컴포넌트가 각자 fallback 처리하면 **코드 중복 + 메시지 불일치**. 사용자에게는 어떤 화면은 "외부 데이터 미적용", 다른 화면은 "추정 모드", 또 다른 화면은 워닝 자체 누락이 될 수 있다.
- **캐싱 전략 부재**: KM curve / Monte Carlo cone은 input이 같으면 결과 동일한 순수 함수. 사용자가 동일 주소로 재평가 시 매번 재계산 → wasted CPU.

### 권고
1. **공통 데이터 레이어 1곳**: `utils/domain-data.js` (신규) — `loadDomainData(domain)` 함수가 promise 캐시 후 반환. 4개 컴포넌트 공통 호출.
2. **fallback 정책 통일**: `utils/fallback-policy.js` (신규) — `wrapWithDataAvailability(rawResult, dataStatus)` → 일관된 워닝 배지 + `recommendation.one_line` 추가. 메시지 라이브러리 1곳.
3. **메모이제이션**: KM curve / NPV cone / Monte Carlo는 `Map<inputHash, result>` 캐시. inputHash = JSON 직렬화 후 SHA-1 short(8자). 메모리 한도 50엔트리 LRU.
4. **데이터 fetch 시점**: 카테고리 메뉴 hover 시 prefetch (idle callback) → 클릭 시 즉시 사용 가능.

---

## C. 재활용 자산 통합 리스크 — **🚨 BLOCKER 1 (가장 큰 우려)**

### 의존성 추적 결과 (registry.json 직접 인용)

```
INTEGRATE_KM_CURVE_PHARMACY_CLOSE-001 (BLOCKED, P1)
  └─ depends_on: UI_BENCHMARK_KM_CURVE-001 (BLOCKED, P1)
       └─ depends_on: MODULE_SURVIVAL-001 (BLOCKED, P1)
            └─ depends_on: DATA_UIJEONGBU_PHASE2-001 (BLOCKED, P1) ★ ROOT

INTEGRATE_SCENARIOS_NPL_BUY-001 (BLOCKED, P1)
  └─ depends_on: UI_SCENARIOS_3OPTION-001 (BLOCKED, P1)
       └─ depends_on: MODULE_COUNTERFACTUAL-001 (BLOCKED, P1)
            ├─ depends_on: MODULE_SURVIVAL-001 (BLOCKED, P1)
            └─ depends_on: MODULE_DECISION_TREE_REASONS-001 (BLOCKED, P1)
                 └─ depends_on: DATA_UIJEONGBU_PHASE2-001 (BLOCKED, P1) ★ ROOT

INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL-001 (BLOCKED, P1)
  └─ depends_on: UI_RECOMMENDATION_TRACE-001 (BLOCKED, P1)
       ├─ depends_on: MODULE_SHAP-001 (BLOCKED, P2)
       └─ depends_on: MODULE_DECISION_TREE_REASONS-001 (BLOCKED, P1)
            └─ depends_on: DATA_UIJEONGBU_PHASE2-001 (BLOCKED, P1) ★ ROOT
```

### 결론
**4개 평가모델 중 3개가 동일한 단일 데이터 작업(`DATA_UIJEONGBU_PHASE2-001`)에 critical-path로 묶여 있다.** 약국·점포개발만 이 체인 외부.

- IA 문서가 "재활용 자산 통합"이라고 표현했지만 사실 **재활용할 자산 자체가 미생성** 상태. INTEGRATE 이슈를 시작하려면 6단계 위 DATA → MODULE → UI → INTEGRATE 체인을 먼저 통과해야 한다.
- 부모 미완 상태에서 자식 INTEGRATE를 더미 컴포넌트로 임시 통합하면 → UI_BENCHMARK_KM_CURVE 본 자산이 완성될 때 prop 인터페이스 불일치로 **재작업 risk**.

### 권고 (BLOCKER)
1. **DATA_UIJEONGBU_PHASE2-001을 P0로 격상** — 4개 평가모델 중 3개의 단일 차단점.
2. INTEGRATE 3종(KM, SCENARIOS, RECOMMENDATION_TRACE)은 부모 자산이 DONE될 때까지 **시작하지 말 것**. 현재처럼 BLOCKED 유지.
3. **4개 평가모델 출시 순서 재정의**:
   - **Wave 1 (즉시 가능)**: pharmacy.develop — 의존 자산 없음, GENERATE_CODE 2개 모두 READY
   - **Wave 2 (DATA_UIJEONGBU_PHASE2 완료 후)**: pharmacy.close + npl.buy + npl.sell 동시
4. CEO 리뷰(ISS-070)와 협의 — 마켓 wedge가 약국 도메인이라면 Wave 1만으로 단독 출시 가능 (NPL은 Wave 2 별 릴리스).

---

## D. 의존성 그래프 시각화

### Wave 1 (pharmacy.develop) — 직선 체인
```
GENERATE_CODE_PHARMACY_DEVELOP_UI-001        (READY) ──┐
GENERATE_CODE_PHARMACY_DEVELOP_SCORER-001    (READY) ──┴─→ RUN_TESTS_PHARMACY_DEVELOP-001 (BLOCKED 풀림)
                                                                │
                                                                └─→ BIZ_VALIDATE_PHARMACY_DEVELOP-001
```
- **critical path: 2단계 (병렬화 OK)**. UI + Scorer를 병렬로 작성 → Tests → BizValidate.
- 출시 가능 단계 추정: 즉시 시작 가능 → 약 1~2 사이클 내 Wave 1 완료.

### Wave 2 (pharmacy.close, npl.buy, npl.sell) — 깊이 6 체인
```
DATA_UIJEONGBU_PHASE2-001 (BLOCKED) ★ ROOT
  ↓
MODULE_SURVIVAL / COUNTERFACTUAL / SHAP / DECISION_TREE_REASONS (BLOCKED, 4개)
  ↓
UI_BENCHMARK_KM_CURVE / UI_SCENARIOS_3OPTION / UI_RECOMMENDATION_TRACE (BLOCKED, 3개)
  ↓
INTEGRATE_KM_CURVE_PHARMACY_CLOSE / INTEGRATE_SCENARIOS_NPL_BUY / INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL (BLOCKED)
  ↓ (병렬)
GENERATE_CODE_PHARMACY_CLOSE_HAZARD / NPL_BUY_RECOVERY / NPL_SELL_NPV (READY 또는 BLOCKED)
GENERATE_CODE_PHARMACY_CLOSE_UI / NPL_BUY_UI / NPL_SELL_UI (READY 또는 BLOCKED)
  ↓
RUN_TESTS_* (BLOCKED, 3개)
  ↓
BIZ_VALIDATE_* (BLOCKED, 3개)
```
- **critical path: 6단계 직렬**. 출시 가능 단계 추정: DATA_UIJEONGBU_PHASE2 완료 후 약 4~5 사이클.

### 병렬화 권고
| 병렬 가능 (즉시) | 직렬 강제 |
|---|---|
| `GENERATE_CODE_PHARMACY_DEVELOP_UI` + `_SCORER` | INTEGRATE 3종 → 부모 UI 자산 완료 후 |
| `GENERATE_CODE_PHARMACY_CLOSE_HAZARD` + `_UI` | RUN_TESTS → INTEGRATE + GENERATE 후 |
| `GENERATE_CODE_NPL_BUY_RECOVERY` + `_UI` | BIZ_VALIDATE → RUN_TESTS 후 (BIZ는 시나리오 기반이므로 동작 코드 필요) |
| `GENERATE_CODE_NPL_SELL_NPV` + `_UI` | DATA_UIJEONGBU_PHASE2 → 단일 root, 모든 Wave 2 차단 |
| `ETL_PHARMACY_DATA-001` + `ETL_NPL_DATA-001` | — |

### 우선 처리 큐 권고
1. **P0 즉시 격상**: `DATA_UIJEONGBU_PHASE2-001` (단일 ROOT)
2. **Wave 1 즉시 시작**: `GENERATE_CODE_PHARMACY_DEVELOP_{UI,SCORER}` 병렬 디스패치
3. **ETL 병렬 시작**: `ETL_PHARMACY_DATA-001`, `ETL_NPL_DATA-001` (P2지만 외부 데이터 표준화는 시간이 걸림)
4. **Wave 2 보류**: DATA_UIJEONGBU_PHASE2 완료 시까지 INTEGRATE/RUN_TESTS/BIZ_VALIDATE는 BLOCKED 유지

---

## E. 테스트 인프라 — 점수 7/10

### 평가
- 4개 신규 `verify_*.mjs` 추가 (verify_pharmacy_develop / verify_pharmacy_close / verify_npl_buy / verify_npl_sell)는 기존 `verify_workflow.mjs` 패턴(`step()` 헬퍼 + `journey[]` 누적)과 일관 유지 가능.
- 그러나 **공통 헬퍼 추출이 없으면** 4개 파일에 동일한 부트스트랩(`page.goto` + `waitForFunction(DATA)` + `step()` 정의)이 반복 → 약 60줄 × 4 = 240줄 중복.
- CI 시간: 현재 `verify_*.mjs` 약 9개. Playwright Chromium launch ~3~5초/test. 4개 추가 시 **약 15~25초 추가**, 전체 verify 합계 ≈ 90~120초. 아직 한계 안.

### 권고
1. **공통 헬퍼 추출**: `utils/verify-harness.mjs` (신규) — `bootstrapPage()`, `step()`, `assertNoConsoleErrors()`, `screenshotJourney(label, idx)` 4개 함수. 4개 신규 파일 + 기존 9개도 점진적 마이그레이션 가능 (단, 마이그레이션은 별도 REFACTOR 이슈).
2. **공통 캐릭터 저니 시나리오 5스텝 표준화**: 모든 평가모델이 (1) 카테고리 메뉴 진입 → (2) 입력 폼 채움 → (3) 평가 실행 → (4) 결과 카드 표시 검증 → (5) deep-link 클릭 후 ctx 배지 검증.
3. **BIZ_VALIDATE는 Playwright 없이 단위 함수 테스트로 충분** — Scorer/Hazard/Recovery/NPV 함수에 100~200개 시나리오 표 입력 → 출력 grade 분포 검증.
4. **CI 병렬화**: `package.json`에 `verify:domain` script (4개 동시) 추가 → wallclock 절감.

---

## F. 성능 / 번들 — 점수 6/10

### 평가
- **`app.js`는 이미 4621줄.** (검토 시점 라인 카운트, 명세서의 4147은 과거 측정값). 모든 모드가 단일 파일에 집중 → IIFE도 모듈도 아닌 전역 함수 더미. 신규 4개 컴포넌트 + viz 플러그인 4개 추가 시 **약 1500~2000줄 증가 추정** → 6000~6500줄.
- **bundle 측면**: 빌드 도구 없는 정적 fetch 구조(`<script src="app.js">`). 코드 스플리팅 불가능. 최초 로드 시 4개 평가 컴포넌트 코드 모두 다운로드.
- **Monte Carlo 1000회 반복(NPL 회수 cone)** 클라이언트 처리 시 — JS 단일 스레드. p10/p50/p90 cone만 산출이라면 1000회 × 24개월 simulation ≈ 24K iter. modern CPU에서 50~150ms 예상. 사용자 클릭 → 결과 표시 사이 100~200ms 지연 = **허용 범위**.
- **KM curve**: 12개월 + 5 peer dongs → 60개 데이터 포인트. 부담 없음.

### 권고
1. **app.js 분리는 아직 보류**. 현재 8000줄까지는 단일 파일 유지 가능. 단 **카테고리 4개 컴포넌트는 `components/{name}.js` 별 파일**로 두고 `<script src>` 4개 추가 → 부분적 분리 효과.
2. **Monte Carlo 클라이언트 처리 OK** (50~150ms). 단, 진행 중 UI 차단 방지 위해 `requestIdleCallback` 또는 `setTimeout(() => {...}, 0)`로 microtask 분할.
3. **번들 사이즈 측정 hook**: `package.json`에 `du -sh app.js components/*.js` 출력 step 추가 → 변화 추적.
4. **장기 권고 (별도 REFACTOR 이슈)**: Vite/esbuild 도입으로 ESM 분리. 단 본 프로젝트의 "no build step" 단순함 가치를 깨므로 신중. CEO 리뷰 영역.

---

## G. 엣지 케이스 누락

### 4개 명세서 / UX 스펙에서 발견된 처리
- pharmacy.develop: `area_pyeong` 옵션, `expected_rx_per_day` 미입력 시 추정
- pharmacy.close: `operating_months<6` 시 KM curve 보류, `monthly_revenue_krw` 6개월 미만 시 거부, CSV 파일 누락 시 추정 모드
- npl.buy: `rights.tenant_priority` 3종 분기, `senior_lien_krw > claim_amount_krw` 시 권리 우선
- npl.sell: 단건/포트폴리오 oneOf, `provision_rate` 0~1 범위

### 누락 발견 (보강 필요)
1. **비동기 race**: 평가 실행 중(Monte Carlo 진행 중) 카테고리 전환 → 결과가 새 카테고리 화면에 잘못 표시될 가능성. **AbortController 패턴** 권고.
2. **localStorage 충돌**: 워크플로 모드의 `WF_STORAGE_KEY`(`app.js:2818`)와 신규 평가 폼 저장 키 명명 충돌 가능. **네임스페이스 prefix `townin.eval.{domain}.{form}` 강제**.
3. **권리관계 JSON 입력 보안 (npl.buy)**: 사용자가 raw JSON 붙여넣기 가능한 입력 → `JSON.parse` + 스키마 검증. **Zod / JSON Schema validator 권고** (현재 코드베이스에 없음 → 가벼운 자체 validator).
4. **큰 portfolio (npl.sell)**: `portfolio_id` 진입 시 N개 채권. N>100이면 결과 카드 표시 부담. **페이지네이션 또는 Top N + "전체 보기" 패턴** 명세서에 없음.
5. **해외 주소 / geocoding 실패**: `address` 입력에 한국 외 주소 입력 시 → 명세서 처리 없음. **사전 정규식 + 명확한 거부 메시지** 권고.
6. **실시간 데이터 변경 (ETL 갱신 중)**: 사용자가 평가 진행 중 ETL 잡이 `simula_data_real.json`을 갱신하면 → 결과 일관성 깨짐. **`trace.data_snapshot` 락**으로 평가 시점 스냅샷 명시.

### 권고
**`SCENARIO_GAP-DOMAIN_MENU-001` 이슈 신규 생성** (우선순위 P2): 위 6개 엣지 케이스를 명세서에 추가. biz-validator가 BIZ_VALIDATE 단계에서 검증.

---

## H. 보안 / 데이터 거버넌스 — 점수 5/10

### 평가
- **약국 매출 시계열 + NPL 채권 정보 = 민감 데이터.** 현재 콘솔은 정적 JSON `fetch`로 모든 동 데이터를 클라이언트 다운로드. 평가 입력값(매출 CSV, 권리관계 JSON)은 클라이언트 메모리만 머무르지만 **localStorage 저장 시 평문**.
- **권한 모델 부재**: IA 문서 E절도 명시 — "현 콘솔의 무권한 단일 사용자 모드 유지". 즉 누구나 4개 평가 메뉴 진입 가능.
- **ETL 외부 출처 결정 미완**: HIRA / NPL 시장 매물 호가 데이터의 라이선스/계약 상태 불명. ETL 이슈가 P2로 낮은 이유는 외부 결정 의존.
- **XSS 위험**: 권리관계 JSON 입력 → `recommendation.one_line` 렌더링 시 사용자 입력이 그대로 들어가는 경로가 있으면 XSS. 현재 `app.js`는 `insertAdjacentHTML`을 광범위 사용(`app.js:160` 등) → escape 누락 위험.

### 권고
1. **localStorage 저장은 옵트인**: "최근 평가 5개 저장하기" 체크박스. 기본 OFF. 저장 시 키에 `townin.eval.` prefix.
2. **권한 모델은 본 IA 범위 외이지만 BLOCKER 후보**: 외부 데모/B2B 출시 직전에 RBAC 도입 별도 이슈 필요. 현 단계는 무권한 데모 OK.
3. **ETL 외부 출처 라이선스 점검 이슈** 별도 P1로 생성 권고. `ETL_PHARMACY_DATA-001` payload에 "법무 검토 미완 → 합법적 출처 확정 후 시작" 코멘트 추가.
4. **XSS 가드**: 사용자 입력은 모두 `textContent` 또는 `escapeHtml()` 통과 후 DOM 삽입. 신규 4개 컴포넌트 작성 시 lint rule(`no-innerHTML-with-user-data`)로 강제 — 그러나 본 프로젝트는 lint 인프라 미약 → 코드 리뷰로 보강.
5. **서버 API 도입 시점**: 매출 CSV / 권리관계 JSON 같은 민감 입력은 클라이언트 처리가 적절(서버 전송 없음 = 노출 없음). 그러나 **평가 결과 공유 / 멀티유저** 요구가 생기면 즉시 서버 API 필요. 현 데모 단계는 클라이언트 처리 OK.

---

## I. BLOCKER + 권고

### BLOCKER (출시 전 반드시 해결)
1. **🚨 BLOCKER-1: DATA_UIJEONGBU_PHASE2-001 P0 격상** — 4개 평가모델 중 3개의 단일 차단점. 6단계 의존 체인 전체가 이 1개 데이터 작업에 묶임.
2. **🚨 BLOCKER-2: deep-link URL 파싱 진입점 부재** — IA가 `?mode=decide&ctx=pharmacy.develop&...` 패턴을 정의했지만 `app.js`에 `parseUrlContext()` 진입점이 없음. 신규 GENERATE_CODE 이슈에 이 헬퍼 작성 책임 명시 필요.
3. **🚨 BLOCKER-3: `currentMode` 단일 슬롯 한계** — 11개 모드(7+4)로 확장 시 `switchMode` 분기 readability 한계. lookup table 또는 axis 분리 필요. (단 이건 REFACTOR로 분리 가능)

### 권고 (P1)
4. 공통 데이터 로딩 + fallback + 메모이제이션 유틸 3종 신규 작성 (`utils/domain-data.js`, `utils/fallback-policy.js`, `utils/memoize.js`)
5. 공통 verify 헬퍼 추출 (`utils/verify-harness.mjs`)
6. 6개 누락 엣지 케이스 → `SCENARIO_GAP-DOMAIN_MENU-001` 이슈 생성
7. ETL 외부 출처 라이선스 점검 이슈 별도 분리

---

## J. 최종 결정

### 결정: **REVISE**

이유:
- IA / USER_STORY / UX 스펙 자체는 견고. 4개 도메인 분리 / 공유 데이터 정책 / deep-link 매핑 구조 모두 합리적.
- 그러나 **3개 critical 의존성 갭**이 존재 — 이를 해결하지 않으면 자식 22개 이슈가 BLOCKED 무한 대기.
- Wave 1 (pharmacy.develop) 단독 출시는 즉시 가능 → 마켓 검증을 빠르게 시작할 수 있음. CEO 리뷰(ISS-070)와 합의 권고.

### 다음 사이클 액션 아이템 (5개)

1. **[hook-router]** `DATA_UIJEONGBU_PHASE2-001`을 P0로 priority 갱신 + dispatch-ready 큐 최상위로. (5분)
2. **[product-manager]** `SCENARIO_GAP-DOMAIN_MENU-001` 이슈 생성 — 6개 누락 엣지 케이스 + 4개 명세서에 추가 패치 PR. (1 사이클)
3. **[agent-harness]** `utils/domain-data.js` + `utils/fallback-policy.js` + `utils/memoize.js` 3개 유틸 신규 작성 — 4개 GENERATE_CODE 이슈가 시작되기 전 먼저 land. (1 사이클, REFACTOR 신규 이슈)
4. **[agent-harness]** `utils/verify-harness.mjs` 공통 헬퍼 추출 — 4개 신규 verify 파일이 작성되기 전 먼저 land. (0.5 사이클, REFACTOR 신규 이슈)
5. **[product-manager + plan-ceo-reviewer 합의]** Wave 1 (pharmacy.develop) 단독 선출시 vs Wave 1+2 동시출시 결정. CEO 리뷰 결과 수렴 후 결정.

---

## K. 형제 검토 영역 분리 확인

본 검토는 **실행/아키텍처/데이터/의존성/테스트/성능/엣지/보안**만 다룬다. 다음 영역은 **ISS-070(plan-ceo-reviewer)** 소관이며 본 문서에서 의도적으로 다루지 않음:
- 시장 wedge / TAM / 경쟁 포지셔닝
- 4개 도메인 우선순위의 사업적 정당성
- 페르소나 ICP 정의 / pricing
- 브랜드 정체성 / 메시징

— 끝 —
