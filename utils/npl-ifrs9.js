// utils/npl-ifrs9.js
// IFRS9 / K-IFRS 1109 NPL POCI 손상모델 — Stage 전이 + 충당금 환입 + 자본 회전율.
// backend/npl_ifrs9.py와 동일 로직 (drift 금지). 동일 입력 → 동일 출력 보장.
//
// ⚠️  T2 주의: 회계정책 확정(Stage 임계값, EIR 산출 방식, 충당금 적용 범위)은
//     외부 회계법인 감사/검토 후 확정 필요. 본 코드는 계산 로직만 제공.

(function() {
  'use strict';

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; }

  // ── Stage 전이 임계값 (회수 진척률 기준) ──────────────────────────────────
  // ⚠️  T2: 아래 상수는 시범값. 회계자문으로 확정 필요.
  var STAGE_THRESHOLD_S2 = 0.33;   // progress ≥ 이 값이면 Stage3 → Stage2 전이
  var STAGE_THRESHOLD_S1 = 0.75;   // progress ≥ 이 값이면 Stage2 → Stage1 전이

  /**
   * 신용조정 유효이자율(credit-adjusted EIR) — 연율.
   * EIR = (expected_recovery / purchase_price)^(12/months) - 1
   * @returns {number} 연율 소수 (예: 0.135 = 13.5%)
   */
  function computeEir(purchasePrice, expectedRecovery, months) {
    var pp = num(purchasePrice), er = num(expectedRecovery), m = num(months);
    if (pp <= 0 || er <= 0 || m <= 0) return 0;
    var years = m / 12;
    return Math.pow(er / pp, 1 / years) - 1;
  }

  /**
   * 기간 이자수익 인식 (IFRS 9 §5.4.1).
   * 이자수익 = 기초 장부가 × EIR × (months/12)
   * @returns {number} 만원 단위 금액
   */
  function interestIncome(carryingAmount, eir, months) {
    var ca = num(carryingAmount), r = num(eir), m = num(months);
    if (ca <= 0 || m <= 0) return 0;
    return ca * r * (m / 12);
  }

  /**
   * Stage 분류 (NPL → 회수 진행 → 정상화).
   * recoveryProgress: 0~1, confidence: 0~1
   * ⚠️  T2: STAGE_THRESHOLD_S2 / STAGE_THRESHOLD_S1 값은 회계자문으로 확정 필요.
   * @returns {"stage1"|"stage2"|"stage3"}
   */
  function classifyStage(recoveryProgress, confidence) {
    var p = Math.max(0, Math.min(1, num(recoveryProgress)));
    var c = Math.max(0, Math.min(1, num(confidence)));
    var effective = p * (0.5 + 0.5 * c);
    if (effective >= STAGE_THRESHOLD_S1) return 'stage1';
    if (effective >= STAGE_THRESHOLD_S2) return 'stage2';
    return 'stage3';
  }

  /**
   * 충당금 환입액 계산 (IFRS 9 §5.5.8 기대신용손실 변동분).
   * current_ecl = max(0, 장부가 - 기대회수 현재가치)
   * 환입액 = max(0, prev_ecl - current_ecl)
   * @returns {number} 만원 단위 환입액 (0 이상)
   */
  function provisionReversal(prevEcl, carryingAmount, expectedRecoveryPv) {
    var pe = num(prevEcl), ca = num(carryingAmount), pv = num(expectedRecoveryPv);
    var currentEcl = Math.max(0, ca - pv);
    return Math.max(0, pe - currentEcl);
  }

  /**
   * 연 자본 회전율 시뮬레이션.
   * effective_holding_months = recovery_months × (1 - early_exit_ratio)
   * turnover = 12 / effective_holding_months
   * earlyExitRatio: 0~1 (토큰화로 앞당겨진 비율)
   * @returns {number} 연 회전율
   */
  function capitalTurnover(recoveryMonths, earlyExitRatio) {
    var m = num(recoveryMonths);
    var r = Math.max(0, Math.min(0.95, num(earlyExitRatio)));
    var effective = m * (1 - r);
    if (effective <= 0) return 0;
    return 12 / effective;
  }

  /**
   * POCI 종합 시뮬레이션 — 위 함수를 묶어 한 번에 반환.
   * @returns {{eir, interest_income_period, stage, current_ecl, provision_reversal,
   *            turnover, effective_holding_months, stage_thresholds}}
   */
  function simulatePoci(purchasePrice, expectedRecovery, months, earlyExitRatio, recoveryProgress, confidence, prevEcl) {
    var pp = num(purchasePrice), er = num(expectedRecovery), m = num(months);
    var exitR = earlyExitRatio === undefined ? 0.4 : num(earlyExitRatio);
    var rp = recoveryProgress === undefined ? 0 : num(recoveryProgress);
    var conf = confidence === undefined ? 0.5 : num(confidence);
    var pe = prevEcl === undefined ? 0 : num(prevEcl);

    var eir = computeEir(pp, er, m);
    var inc = interestIncome(pp, eir, m);
    var stage = classifyStage(rp, conf);

    var years = m / 12;
    var expectedRecoveryPv = (eir > -1) ? er / Math.pow(1 + eir, years) : 0;
    var currentEcl = Math.max(0, pp - expectedRecoveryPv);
    var reversal = provisionReversal(pe, pp, expectedRecoveryPv);

    var ratio = Math.max(0, Math.min(0.95, exitR));
    var effectiveMonths = m * (1 - ratio);
    var turnover = capitalTurnover(m, exitR);

    return {
      eir: Math.round(eir * 1e6) / 1e6,
      interest_income_period: Math.round(inc),
      stage: stage,
      current_ecl: Math.round(currentEcl),
      provision_reversal: Math.round(reversal),
      turnover: Math.round(turnover * 1e4) / 1e4,
      effective_holding_months: Math.round(effectiveMonths * 100) / 100,
      stage_thresholds: {
        s2: STAGE_THRESHOLD_S2,
        s1: STAGE_THRESHOLD_S1,
        note: 'T2: 회계자문으로 확정 필요',
      },
    };
  }

  // ── 노출 — 브라우저(window) + Node.js(module.exports) 양쪽 지원 ──
  // Node.js IIFE 내 module.exports 재할당은 효과 없으므로 프로퍼티 복사 방식 사용.
  var api = {
    computeEir: computeEir,
    interestIncome: interestIncome,
    classifyStage: classifyStage,
    provisionReversal: provisionReversal,
    capitalTurnover: capitalTurnover,
    simulatePoci: simulatePoci,
    STAGE_THRESHOLD_S2: STAGE_THRESHOLD_S2,
    STAGE_THRESHOLD_S1: STAGE_THRESHOLD_S1,
  };

  if (typeof window !== 'undefined') window.NplIfrs9 = api;
  if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    var k; for (k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) module.exports[k] = api[k]; }
  }
})();
