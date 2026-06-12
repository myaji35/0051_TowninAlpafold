# NPL 평가모델 개선안 (Townin AlphaFold)

> 작성: 2026-06-12 · harness 분석 기반 · 대상: NPL 매수평가 / 매도평가 2개 모델

## 0. 한 줄 요약

NPL은 **기획·UX 설계가 100% 완료**된 상태에서 **CEO가 의도적으로 DEFER**(호가 라이선스 미해결)했고, 그 위에 **pingpong_guard 오작동**이 겹쳐 코드 생성 6건이 BLOCKED로 좀비화됐다. 개선의 핵심은 **데이터 의존을 끊는 "수동 호가 모드"로 NPL을 부분 활성화**하는 것이다 — 라이선스 협상을 기다리지 않고 약국 scorer 패턴을 재사용해 즉시 출시 가능한 상태로 만든다.

---

## 1. 현황 진단 (registry 24개 이슈 전수 분석)

### 완료된 자산 (재사용 가능)
| 산출물 | 상태 | 내용 |
|---|---|---|
| `USER_STORY_NPL_BUY/SELL` | ✅ DONE | 채권 매수 적정가 / 매도 타이밍 스토리 확정 |
| `UX_DESIGN_NPL_BUY-001` | ✅ DONE | `docs/ux/npl-buy-ux.md` (13.7KB, 10섹션, grade 4단계) |
| `UX_DESIGN_NPL_SELL-001` | ✅ DONE | `docs/ux/npl-sell-ux.md` (19.2KB, 210줄, cone 6/12/24M, 추천 4상태) |
| `FEATURE_DOMAIN_MENU-001` | ✅ DONE | 4개 평가모델 메뉴 카테고리(약국 개발/폐업 + NPL 매수/매도) |
| `pharmacy-scorer.js` | ✅ 실재 | **NPL이 베낄 검증된 scorer 패턴** (가중치 합=1.00, clamp01, cone) |

### 막힌 자산 (BLOCKED 좀비 6건)
| 이슈 | 막힌 원인 |
|---|---|
| `GENERATE_CODE_NPL_BUY_RECOVERY-001` | **pingpong_guard 3건 중복 오판** |
| `GENERATE_CODE_NPL_SELL_NPV-001` | **pingpong_guard 3건 중복 오판** |
| `GENERATE_CODE_NPL_BUY_UI-001` | 위 RECOVERY에 의존 → 연쇄 BLOCKED |
| `GENERATE_CODE_NPL_SELL_UI-001` | 위 NPV에 의존 → 연쇄 BLOCKED |
| `INTEGRATE_SCENARIOS_NPL_BUY-001` | 연쇄 |
| `INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL-001` | 연쇄 |
| `BIZ_VALIDATE_NPL_BUY/SELL` | 검증 대상 코드 없음 → 영구 BLOCKED |
| `RUN_TESTS_NPL_BUY/SELL` | 동일 |

### 근본 차단 결정 (CEO Blocker)
```
ISS-091 [DONE] → decision: OPTION_C_DEFER_NPL
  · wedge_anchor: pharmacy.develop (Wave 1)
  · npl_affected_meta_marked: 12개
  · ETL_NPL_DATA: READY → DEFERRED (호가 데이터 라이선스 미해결)
  · 재활성화 트리거: WAVE1_RETROSPECTIVE-001
```
→ `WAVE1_RETROSPECTIVE-001`은 현재 **BLOCKED** (의존: 약국 RUN_TESTS + BIZ_VALIDATE — 이들도 좀비). **NPL은 영원히 깨어날 수 없는 잠금 상태.**

---

## 2. 인과 사슬 (왜 NPL이 죽어있나)

```
호가 라이선스 미해결
   └→ ISS-091: OPTION_C_DEFER_NPL (NPL 의도적 보류)
        └→ 재활성화 = WAVE1_RETROSPECTIVE-001
             └→ 회고는 약국 BIZ_VALIDATE/RUN_TESTS에 의존
                  └→ 약국 검증도 BLOCKED(디스패처 unblock 누락)
                       └→ NPL 영구 동결 ❌
   └→ (병렬) pingpong_guard 오작동
        └→ NPL 코드 생성 BLOCKED → 검증 대상 자체가 없음 ❌
```

**잠금이 이중이다.** 데이터 잠금(정책)과 가드 잠금(버그)을 둘 다 풀어야 한다.

---

## 3. 개선안 — 3 Wave 로드맵

### Wave A: 잠금 해제 (즉시, T0/T2 혼합)

| # | 액션 | Tier | 산출 이슈 |
|---|---|---|---|
| A1 | **pingpong_guard 임계값 정밀화** — 정상 재시도를 중복으로 오판하는 룰 수정. `META_RULE_REFINE-001`(DEFERRED) 승격 | T0 | `META_RULE_REFINE-001` 활성화 |
| A2 | **약국 검증 좀비 2건 해제** — deps 전부 DONE인데 BLOCKED. 디스패처 강제 unblock → 실제 시나리오 검증 | T0 | 약국 BIZ_VALIDATE 재실행 |
| A3 | **Wave1 회고 실행** → NPL 재활성화 트리거 발화 | T0 | `WAVE1_RETROSPECTIVE-001` |

### Wave B: 데이터 의존 분리 — "수동 호가 모드" (핵심 ⭐)

호가 라이선스는 **외부 협상(T2)**이라 시간이 걸린다. 출시를 막지 말고 **데이터 입력 경로를 이원화**한다.

| # | 액션 | 근거 |
|---|---|---|
| B1 | **NPL 입력 폼에 "호가 수동 입력" 필드 추가** | ISS-091 결정문의 "수동 호가 모드 합의"를 실제 구현. 라이선스 없이도 사용자가 호가를 직접 넣으면 모델 작동 |
| B2 | **`source: "manual"` 태깅** | 자동 ETL 호가와 수동 호가를 데이터 출처로 구분 (rails-automation 크롤링 원칙과 동일 패턴) |
| B3 | **`ETL_NPL_DATA-001`은 DEFERRED 유지** | 라이선스 해결 시 자동 모드로 무중단 전환되도록 어댑터만 미리 분리 |

→ **효과**: NPL이 "데이터 없어서 못 씀"에서 "사용자 입력으로 즉시 평가 가능"으로 전환. wedge 출시 리스크 제거.

### Wave C: 코드 생성 (약국 패턴 재사용)

검증된 `pharmacy-scorer.js` 패턴을 그대로 복제 — 신규 추상화 금지(Karpathy #2).

| # | 모델 | 재사용 자산 | 신규 로직 |
|---|---|---|---|
| C1 | **NPL 매수 (회수예측)** | `pharmacy-scorer.js`의 cone(p10/p50/p90) + clamp01 정규화 | 권리관계 차감 + IRR 계산 |
| C2 | **NPL 매도 (NPV)** | 동일 cone + grade 패턴 | 즉시매각 NPV vs 6/12/24M 보유 + Recommendation 룰(매각/관망/유지) |
| C3 | **UI 2종** | `pharmacy-develop.js` 입력폼/결과카드 구조 | Drivers SHAP 막대 + Decide deep-link |
| C4 | **시나리오/추천 통합** | 기존 cone 시각화 컴포넌트 | 매수가 ±15% 어댑터 / 추천 트레이스 어댑터 |

### Wave D: 검증 (좀비 4건 정상화)
- `BIZ_VALIDATE_NPL_BUY` — grade 4단계 + 엣지 5종(`market_quote_unavailable` 등) **실제 시나리오 실행** (이전 비즈검증의 "0개 규칙 빈 통과" 반복 금지)
- `BIZ_VALIDATE_NPL_SELL` — 추천 3종(매각/관망/유지) 시나리오 + 엣지 5종
- `RUN_TESTS` 2종 — 단위 테스트 + 캐릭터 저니(매수 심사역 / 매도 담당자)

---

## 4. 실행 우선순위 (자율 디스패치 순서)

```
1. A1 (pingpong 가드 수정)  ── 모든 코드 생성의 전제
2. A2 → A3 (약국 좀비 해제 → 회고 → NPL 재활성화)
3. B1~B3 (수동 호가 모드)   ── 데이터 잠금 우회
4. C1 → C2 (scorer 2종, 약국 패턴 복제)
5. C3 → C4 (UI + 통합)
6. D (비즈검증 + 테스트, 실제 시나리오 실행)
```

## 5. 성공 기준 (Goal-Driven)

- [ ] NPL 매수/매도 화면에서 **수동 호가 입력 → grade + cone + 추천** 실제 출력
- [ ] `BIZ_VALIDATE_NPL_*` 가 **`no_rules_to_validate`가 아닌 실제 coverage % + critical_gaps** 산출
- [ ] 캐릭터 저니(매수 심사역/매도 담당자) Playwright 스크린샷 증거 첨부
- [ ] BLOCKED NPL 이슈 0건 (현재 12건+)
- [ ] 라이선스 해결 시 manual→auto 무중단 전환 가능한 어댑터 분리 확인

## 6. T2 컨펌 필요 항목 (대표님 결정)

| 항목 | 카테고리 | 질문 |
|---|---|---|
| 호가 데이터 라이선스 | EXTERNAL | 협상 진행 vs 수동모드로 무기한 운영? |
| NPL Wave 진입 시점 | DIRECTION | 약국 출시 전 병렬 진행 vs 회고 후 순차? |
