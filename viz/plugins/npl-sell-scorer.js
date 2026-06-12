// viz/plugins/npl-sell-scorer.js
// NPL 매도평가 — 채권 매도 적정가/타이밍 (즉시매각 NPV vs 보유 회수 cone)
// 부모 이슈: USER_STORY_NPL_SELL-001 / GENERATE_CODE_NPL_SELL_NPV-001
// 명세서: docs/ux/npl-sell-ux.md
//
// 도메인 핵심:
//   - 즉시매각 NPV: 현재 시장 호가(또는 수동 입력) − 매각 비용
//   - 보유 cone: 6/12/24M 보유 후 회수 NPV의 p10/p50/p90 (회수율 분포 × 할인)
//   - 추천룰 4상태 (UX line 125~128): 즉시매각 확신 / 매각검토 / 관망 / 유지
//   - SHAP 막대: driver별 NPV 기여도 (양수=매각방향=파랑, 음수=유지방향=빨강)
//
// 색 의미 가드 (UX line 60): 색 = "채권 가치"가 아닌 "매각 결정 적합도".
//   파랑=매각 추천, 빨강=유지 추천(매각 비추).

(function() {
  'use strict';

  const ANNUAL_DISCOUNT = 0.08;        // 연 할인율 (자본비용)
  const SELL_COST_RATE = 0.02;         // 매각 거래비용 (호가 대비)
  const HOLD_HORIZONS = [6, 12, 24];   // 보유 시나리오 (개월)

  // 보유 회수율 분포 (장부가 대비, 충당금률로 보정) — 회수까지 가면 더 받지만 변동성↑
  const RECOVERY_RATE = Object.freeze({ p10: 0.55, p50: 0.78, p90: 1.05 });

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; }

  /** 현재가치 환산 */
  function npv(futureValue, months) {
    var years = months / 12;
    return futureValue / Math.pow(1 + ANNUAL_DISCOUNT, years);
  }

  /**
   * 보유 cone — horizon별 회수 NPV의 p10/p50/p90.
   * 보유비용(월 carrying cost)을 차감하고 할인.
   * @param {object} inp - { book_value(장부가), provision_rate(충당금률 %),
   *                         carrying_monthly(월 보유비용), market_quote(시장호가) }
   */
  function holdCone(inp) {
    var bookValue = num(inp.book_value) || num(inp.market_quote) || 0;
    // 충당금 반영 잔존가치 (이미 손상 인식된 부분 제외한 회수 잠재력)
    var provisionRate = clamp01(num(inp.provision_rate) / 100);
    var carrying = num(inp.carrying_monthly);

    var cone = {};
    HOLD_HORIZONS.forEach(function(m) {
      // 회수 잠재 = 장부가 × 회수율 (충당금률 높을수록 이미 보수적 → 상방 여지)
      var upliftFromProvision = 1 + provisionRate * 0.3;  // 충당금 높으면 surprise 상방 소폭
      var gross = {
        p10: bookValue * RECOVERY_RATE.p10,
        p50: bookValue * RECOVERY_RATE.p50 * upliftFromProvision,
        p90: bookValue * RECOVERY_RATE.p90 * upliftFromProvision,
      };
      var holdingCost = carrying * m;
      cone[m] = {
        p10: Math.round(npv(Math.max(0, gross.p10 - holdingCost), m)),
        p50: Math.round(npv(Math.max(0, gross.p50 - holdingCost), m)),
        p90: Math.round(npv(Math.max(0, gross.p90 - holdingCost), m)),
      };
    });
    return cone;
  }

  /** 즉시매각 NPV = 시장호가 − 매각비용 (현재 시점이라 할인 없음) */
  function sellNowNpv(inp) {
    var quote = num(inp.market_quote);
    return Math.round(quote * (1 - SELL_COST_RATE));
  }

  // ── 추천룰 (UX 명세 line 125~128) ──
  const REC_META = {
    very_high: { color: '#00529B', label: '즉시 매각 (확신)' },
    high:      { color: '#5BC0EB', label: '매각 검토' },
    medium:    { color: '#FED766', label: '관망 — 3개월 후 재평가' },
    low:       { color: '#C9485B', label: '유지 — 매각 보류' },
  };

  function recommend(sellNow, cone) {
    var holdP50Max = Math.max(cone[6].p50, cone[12].p50, cone[24].p50);
    var hold24P10 = cone[24].p10;
    var gap = holdP50Max > 0 ? (sellNow - holdP50Max) / holdP50Max : 0;

    var grade;
    if (sellNow >= holdP50Max && gap >= 0.20) grade = 'very_high';        // 즉시매각 확신
    else if (sellNow >= holdP50Max && gap >= 0) grade = 'high';           // 매각 검토
    else if (hold24P10 >= sellNow * 1.2) grade = 'low';                   // 유지
    else grade = 'medium';                                                // 관망

    return {
      grade: grade,
      label: REC_META[grade].label,
      color: REC_META[grade].color,
      gap_pct: Math.round(gap * 1000) / 10,
      hold_p50_max: holdP50Max,
    };
  }

  /**
   * SHAP 막대 — driver별 NPV 기여도 (양수=매각방향=파랑, 음수=유지방향=빨강).
   */
  function shapDrivers(inp, sellNow, cone) {
    var drivers = [];
    var holdP50 = cone[12].p50;
    var carrying = num(inp.carrying_monthly);

    // 보유비용 누적 → 매각 방향 (+)
    if (carrying > 0) {
      drivers.push({ sign: '+', text: '보유비용 잠식 (월 ' + fmtMan(carrying) + ' × 보유기간)',
                     value: Math.round(carrying * 12), direction: 'sell' });
    }
    // 회수율 변동성 → 유지 위험 (−) 또는 상방 기대
    var volatility = cone[12].p90 - cone[12].p10;
    drivers.push({ sign: '-', text: '회수율 변동성 (p10~p90 폭 ' + fmtMan(volatility) + ')',
                   value: -Math.round(volatility * 0.3), direction: 'hold' });
    // 시장호가 프리미엄 → 매각 방향
    if (sellNow >= holdP50) {
      drivers.push({ sign: '+', text: '시장호가 우위 (즉시매각 ≥ 보유 p50)',
                     value: Math.round(sellNow - holdP50), direction: 'sell' });
    } else {
      drivers.push({ sign: '-', text: '보유 상방 여지 (보유 p50 > 즉시매각)',
                     value: Math.round(holdP50 - sellNow), direction: 'hold' });
    }
    // 충당금률 → 손상 반영도
    var provRate = num(inp.provision_rate);
    if (provRate >= 50) {
      drivers.push({ sign: '+', text: '높은 충당금률 ' + provRate + '% — 추가 손실 여지 제한',
                     value: Math.round(num(inp.book_value) * 0.05), direction: 'sell' });
    }
    return drivers
      .sort(function(a, b) { return Math.abs(b.value) - Math.abs(a.value); })
      .slice(0, 5);
  }

  /**
   * 통합 평가 진입점.
   * @param {object} inp - { portfolio_id, book_value, market_quote,
   *                         hold_months, provision_rate, carrying_monthly }
   * @returns {object|null}
   */
  function evaluateNplSell(inp) {
    if (!inp || num(inp.market_quote) <= 0 && num(inp.book_value) <= 0) return null;
    var sellNow = sellNowNpv(inp);
    var cone = holdCone(inp);
    var rec = recommend(sellNow, cone);
    var drivers = shapDrivers(inp, sellNow, cone);

    return {
      sell_now_npv: sellNow,
      hold_cone: cone,                       // { 6:{p10,p50,p90}, 12:{...}, 24:{...} }
      recommendation: {
        grade: rec.grade,
        label: rec.label,
        color: rec.color,
        gap_pct: rec.gap_pct,
        headline: '즉시 매각 ' + fmtMan(sellNow) + ' vs 12M 보유 ' + fmtMan(cone[12].p50),
      },
      shap_drivers: drivers,
      source: 'npl-sell-scorer.js (manual 호가 모드 — ETL_NPL_DATA-001 DEFERRED fallback)',
      confidence: 0.58,
      _internal: { inputs: inp },
    };
  }

  function clamp01(x) { if (typeof x !== 'number' || isNaN(x)) return 0; return Math.max(0, Math.min(1, x)); }
  function fmtMan(v) {
    var n = num(v);
    if (n >= 10000) return (Math.round(n / 1000) / 10) + '억';
    return Math.round(n) + '만';
  }

  const DEMO_PORTFOLIO = Object.freeze([
    { id: 'PF-A-001', book_value: 50000, market_quote: 32000, hold_months: 0,
      provision_rate: 40, carrying_monthly: 300 },
    { id: 'PF-A-002', book_value: 120000, market_quote: 95000, hold_months: 6,
      provision_rate: 25, carrying_monthly: 800 },
  ]);

  window.NplSellScorer = {
    evaluate: evaluateNplSell,
    holdCone: holdCone,
    sellNowNpv: sellNowNpv,
    recommend: recommend,
    RECOVERY_RATE: RECOVERY_RATE,
    DEMO_PORTFOLIO: DEMO_PORTFOLIO,
  };
})();
