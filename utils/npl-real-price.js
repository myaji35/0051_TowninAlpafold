// utils/npl-real-price.js
// NPL 실거래가 보정 (V3) — backend/npl_real_price.py와 동일 로직 (drift 금지).
// 동일 입력 → 동일 출력 보장. 참조: docs/npl-professional-valuation.md §2.3
//
// ⚠️  T2 주의: 국토부 실거래가 API는 data.go.kr 인증키 필요.
//     키 없으면 confidence_delta=0, status="not_linked" 반환.
//     가짜 실거래 데이터 반환 절대 금지.

(function() {
  'use strict';

  // ── 판정 기준 (backend/npl_real_price.py와 동일 값) ─────────────────────────
  var TRUST_BAND = 0.15;
  var OVERVALUE_THRESHOLD = 0.85;
  var OVERVALUE_FACTOR = 0.92;
  var OVERVALUE_CONFIDENCE_DELTA = -0.10;
  var MIN_TRADES_FOR_BONUS = 3;

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; }

  function median(arr) {
    if (!arr || arr.length === 0) return null;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * 감정가 vs 실거래 中위가 신뢰도 판정.
   * backend/npl_real_price.py의 price_confidence와 동일 로직 (drift 금지).
   *
   * @param {number} appraisal 감정가 (만원)
   * @param {number[]|null} recentTrades 최근 실거래가 목록 (만원). null/빈 배열 = 미연동.
   * @returns {{median_trade, trust_ratio, factor, confidence_delta, verdict, flags, status}}
   */
  function priceConfidence(appraisal, recentTrades) {
    if (!recentTrades || recentTrades.length === 0 || num(appraisal) <= 0) {
      return {
        median_trade: null,
        trust_ratio: null,
        factor: 1.0,
        confidence_delta: 0.0,
        verdict: 'insufficient',
        flags: [],
        status: 'not_linked',
        note: '실거래가 미연동 (DATA_GO_KR_KEY 필요 — T2)',
      };
    }

    var med = median(recentTrades);
    var ratio = med / num(appraisal);
    var flags = [];
    var hasEnough = recentTrades.length >= MIN_TRADES_FOR_BONUS;
    var lower = 1 - TRUST_BAND;
    var upper = 1 + TRUST_BAND;
    var factor, confidenceDelta, verdict;

    if (ratio < OVERVALUE_THRESHOLD) {
      factor = OVERVALUE_FACTOR;
      confidenceDelta = OVERVALUE_CONFIDENCE_DELTA + (hasEnough ? 0.15 : 0.0);
      verdict = 'overvalued';
      flags.push('⚠️ 감정가 과대평가 의심 — 실거래 中위가(' + Math.round(med).toLocaleString() + '만) < 감정가×0.85');
      flags.push('보수 보정 계수 ×' + OVERVALUE_FACTOR + ' 적용');
    } else if (ratio >= lower && ratio <= upper) {
      factor = 1.0;
      confidenceDelta = hasEnough ? 0.15 : 0.05;
      verdict = 'trusted';
      flags.push('감정가 신뢰 — 실거래 中위가/감정가 = ' + (ratio * 100).toFixed(2) + '% (±15% 이내)');
    } else {
      factor = 1.0;
      confidenceDelta = hasEnough ? 0.10 : 0.0;
      verdict = 'trusted';
      flags.push('실거래가 감정가 상회 — 비율 ' + (ratio * 100).toFixed(2) + '%');
    }

    if (hasEnough) {
      flags.push('실거래 ' + recentTrades.length + '건 확인 — confidence +0.15 기준 충족');
    } else {
      flags.push('실거래 ' + recentTrades.length + '건 (3건 미만 — confidence 보너스 불완전)');
    }

    return {
      median_trade: Math.round(med),
      trust_ratio: Math.round(ratio * 10000) / 10000,
      factor: factor,
      confidence_delta: Math.round(confidenceDelta * 10000) / 10000,
      verdict: verdict,
      flags: flags,
      status: 'linked',
      trade_count: recentTrades.length,
    };
  }

  // ── 노출 — 브라우저(window) + Node.js(module.exports) ──
  var api = {
    priceConfidence: priceConfidence,
    TRUST_BAND: TRUST_BAND,
    OVERVALUE_THRESHOLD: OVERVALUE_THRESHOLD,
    OVERVALUE_FACTOR: OVERVALUE_FACTOR,
    OVERVALUE_CONFIDENCE_DELTA: OVERVALUE_CONFIDENCE_DELTA,
    MIN_TRADES_FOR_BONUS: MIN_TRADES_FOR_BONUS,
  };

  if (typeof window !== 'undefined') window.NplRealPrice = api;
  if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    var k; for (k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) module.exports[k] = api[k]; }
  }
})();
