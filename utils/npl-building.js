// utils/npl-building.js
// NPL 건축물대장 보정 (V2) — backend/npl_building_ledger.py와 동일 로직 (drift 금지).
// 동일 입력 → 동일 출력 보장. 참조: docs/npl-professional-valuation.md §2.2
//
// ⚠️  T2 주의: 건축HUB API는 data.go.kr 인증키 필요.
//     키 없으면 factor=1.0, confidence_delta=0, status="not_linked" 반환.
//     가짜 실데이터 반환 절대 금지.

(function() {
  'use strict';

  // ── 보정 상수 (backend/npl_building_ledger.py와 동일 값) ─────────────────────
  var VIOLATION_FACTOR = 0.70;
  var VIOLATION_CONFIDENCE_DELTA = -0.20;
  var AGE_NEW_MAX = 5;
  var AGE_OLD_MIN = 30;
  var AGE_NEW_FACTOR = 1.05;
  var AGE_OLD_FACTOR = 0.85;
  var AGE_NORMAL_FACTOR = 1.00;
  var STRUCT_RC_FACTOR = 1.00;
  var STRUCT_MASONRY_FACTOR = 0.90;

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; }

  function buildingAge(approvedYear) {
    if (!approvedYear) return -1;
    var current = new Date().getFullYear();
    return Math.max(0, current - num(approvedYear));
  }

  function ageFactor(age) {
    if (age < 0) return AGE_NORMAL_FACTOR;
    if (age <= AGE_NEW_MAX) return AGE_NEW_FACTOR;
    if (age >= AGE_OLD_MIN) return AGE_OLD_FACTOR;
    return AGE_NORMAL_FACTOR;
  }

  function structFactor(structCode) {
    if (!structCode) return STRUCT_RC_FACTOR;
    var s = String(structCode).trim().toUpperCase();
    if (s === '11' || s === '21' || s === 'RC' || s === 'SRC' ||
        s === '철근콘크리트' || s === '철골철근콘크리트') {
      return STRUCT_RC_FACTOR;
    }
    return STRUCT_MASONRY_FACTOR;
  }

  /**
   * 건축물 정보 → 낙찰가율 보정 결과.
   * buildingInfo가 null/undefined면 not_linked 반환.
   * @param {Object|null} buildingInfo {approved_year, struct_code, is_violation}
   * @returns {{factor, confidence_delta, flags, status}}
   */
  function buildingAdjustment(buildingInfo) {
    if (!buildingInfo) {
      return {
        factor: 1.0,
        confidence_delta: 0.0,
        flags: [],
        status: 'not_linked',
        note: '건축물대장 미연동 (DATA_GO_KR_KEY 필요 — T2)',
      };
    }

    var flags = [];
    var factor = 1.0;

    // 1) 연식 보정
    var age = buildingAge(buildingInfo.approved_year);
    var af = ageFactor(age);
    factor *= af;
    if (age >= 0) {
      if (af === AGE_NEW_FACTOR) flags.push('신축(준공 후 ' + age + '년) — 연식보정 ×' + AGE_NEW_FACTOR);
      else if (af === AGE_OLD_FACTOR) flags.push('노후(준공 후 ' + age + '년) — 연식보정 ×' + AGE_OLD_FACTOR);
    }

    // 2) 구조 보정
    var sf = structFactor(buildingInfo.struct_code);
    factor *= sf;
    if (sf === STRUCT_MASONRY_FACTOR) {
      flags.push('비RC 구조(' + (buildingInfo.struct_code || '미상') + ') — 구조보정 ×' + STRUCT_MASONRY_FACTOR);
    }

    // 3) 위반건축물 — NPL 핵심 리스크
    var isViolation = !!buildingInfo.is_violation;
    if (isViolation) {
      factor *= VIOLATION_FACTOR;
      flags.push('⚠️ 위반건축물 등재 — ×0.70 (이행강제금·철거 위험)');
    }

    var confidenceDelta = 0.15 + (isViolation ? VIOLATION_CONFIDENCE_DELTA : 0.0);

    return {
      factor: Math.round(factor * 10000) / 10000,
      confidence_delta: Math.round(confidenceDelta * 10000) / 10000,
      flags: flags,
      status: 'linked',
      age_years: age >= 0 ? age : null,
      is_violation: isViolation,
    };
  }

  /**
   * 데이터 충족도 기반 동적 confidence 산출 (docs §4).
   * backend/npl_building_ledger.py의 compute_confidence와 동일 공식 (drift 금지).
   *
   * base=0.60 + building=+0.15 + realprice3=+0.15 + registry=+0.10 − defect=−0.20
   * 예: base0.6 + building + realprice3 = 0.90
   *
   * @param {number} base 기본 신뢰도 (기본 0.60)
   * @param {boolean} hasBuilding 건축물대장 연동
   * @param {boolean} hasRealprice3 실거래 3건 이상
   * @param {boolean} hasRegistry 등기부 확인
   * @param {boolean} hasDefect 위반건축물/권리하자
   * @returns {number} 0.0~1.0
   */
  function computeConfidence(base, hasBuilding, hasRealprice3, hasRegistry, hasDefect) {
    var b = typeof base === 'number' ? base : 0.60;
    var c = b;
    if (hasBuilding) c += 0.15;
    if (hasRealprice3) c += 0.15;
    if (hasRegistry) c += 0.10;
    if (hasDefect) c -= 0.20;
    c = Math.max(0.0, Math.min(1.0, c));
    return Math.round(c * 10000) / 10000;
  }

  // ── 노출 — 브라우저(window) + Node.js(module.exports) ──
  var api = {
    buildingAdjustment: buildingAdjustment,
    computeConfidence: computeConfidence,
    VIOLATION_FACTOR: VIOLATION_FACTOR,
    VIOLATION_CONFIDENCE_DELTA: VIOLATION_CONFIDENCE_DELTA,
    AGE_NEW_FACTOR: AGE_NEW_FACTOR,
    AGE_OLD_FACTOR: AGE_OLD_FACTOR,
    STRUCT_MASONRY_FACTOR: STRUCT_MASONRY_FACTOR,
  };

  if (typeof window !== 'undefined') window.NplBuilding = api;
  if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    var k; for (k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) module.exports[k] = api[k]; }
  }
})();
