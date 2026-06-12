// viz/plugins/npl-buy-scorer.js
// NPL 매수평가 — 채권 매수 적정가 산정 (담보 부동산 회수 시나리오 cone + IRR)
// 부모 이슈: USER_STORY_NPL_BUY-001 / GENERATE_CODE_NPL_BUY_RECOVERY-001
// 명세서: docs/ux/npl-buy-ux.md
//
// 도메인 핵심:
//   - 회수 cone: 담보 부동산 처분 회수액의 p10/p50/p90 분포 (감정가 × 낙찰가율 분포)
//   - 권리관계 차감: 선순위 채권 + 세금/공과금 + 임차 보증금을 회수액에서 우선 차감
//   - IRR: 매수가 대비 (순회수액 / 매수가)^(12/회수기간) - 1
//   - 3시나리오: 후보 매수가 ×0.85(보수) / ×1.00(기본) / ×1.15(공격)
//
// 데이터 의존 분리(NPL 개선안 "수동 호가 모드"):
//   외부 호가 ETL(ETL_NPL_DATA-001) DEFERRED 상태 → 사용자가 감정가/청구액/매수가를
//   직접 입력하면 라이선스 없이 즉시 평가 가능. source: 'manual' 태깅.

(function() {
  'use strict';

  function clamp01(x) {
    if (typeof x !== 'number' || isNaN(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  // ── 낙찰가율 (V1: 지역×담보유형 동적 행렬 — utils/npl-auction-rates.js) ──
  // 미연동 시 fallback 상수. region_code/collateral_type 있으면 행렬 조회.
  const AUCTION_RATE_FALLBACK = Object.freeze({ p10: 0.68, p50: 0.82, p90: 0.95 });
  function getAuctionRate(inp) {
    if (window.NplAuctionRates && (inp.region_code || inp.collateral_type)) {
      return window.NplAuctionRates.auctionRate(inp.region_code, inp.collateral_type);
    }
    return AUCTION_RATE_FALLBACK;
  }

  // 회수기간 (개월) — 경매 평균. 보유비용/할인에 사용.
  const DEFAULT_RECOVERY_MONTHS = 12;
  // 연 할인율 (NPV 환산 — 자본비용 가정)
  const ANNUAL_DISCOUNT = 0.08;

  /**
   * 회수 cone 계산 — 담보 처분 회수액 p10/p50/p90.
   * @param {object} inp - { appraisal(감정가 만원), senior(선순위 만원),
   *                         tax(세금/공과 만원), deposit(임차보증금 만원) }
   * @returns {object} { gross:{p10,p50,p90}, net:{p10,p50,p90}, deduction }
   */
  function recoveryCone(inp) {
    const appraisal = num(inp.appraisal);
    // V1: 지역×담보유형 동적 낙찰가율
    const rate = getAuctionRate(inp);
    // 권리관계 차감 합 (회수액에서 우선 변제되는 금액)
    const deduction = num(inp.senior) + num(inp.tax) + num(inp.deposit);
    const gross = {
      p10: appraisal * rate.p10,
      p50: appraisal * rate.p50,
      p90: appraisal * rate.p90,
    };
    // 순회수액 = 처분액 − 선순위/세금/보증금 (음수 방지)
    const net = {
      p10: Math.max(0, gross.p10 - deduction),
      p50: Math.max(0, gross.p50 - deduction),
      p90: Math.max(0, gross.p90 - deduction),
    };
    return { gross: gross, net: net, deduction: deduction };
  }

  /**
   * IRR 계산 — 단일 현금흐름 (매수 → 회수) 연환산 수익률.
   * @param {number} buyPrice - 매수가 (만원)
   * @param {number} recovered - 순회수액 (만원)
   * @param {number} months - 회수기간
   * @returns {number} IRR (소수, 0.18 = 18%)
   */
  function computeIRR(buyPrice, recovered, months) {
    if (buyPrice <= 0 || recovered <= 0) return -1;  // 전손 -100%
    const periodReturn = recovered / buyPrice;
    const years = months / 12;
    if (years <= 0) return periodReturn - 1;
    return Math.pow(periodReturn, 1 / years) - 1;
  }

  // ── IRR → grade (UX 명세 line 92~93) ──
  function irrToGrade(irr) {
    if (irr >= 0.25) return 'very_high'; // 적극 매수
    if (irr >= 0.15) return 'high';      // 매수 검토
    if (irr >= 0.05) return 'medium';    // 신중 검토
    return 'low';                        // 입찰 비추 (IRR<5% 또는 음수)
  }

  const PLDDT_COLOR = { very_high: '#00529B', high: '#5BC0EB', medium: '#FED766', low: '#C9485B' };
  const ACTION_LABEL = { very_high: '적극 매수', high: '매수 검토', medium: '신중 검토', low: '입찰 비추' };

  /**
   * 단일 매수가 시나리오 평가.
   */
  function evalScenario(buyPrice, cone, months) {
    const irr = computeIRR(buyPrice, cone.net.p50, months);
    const grade = irrToGrade(irr);
    return {
      buy_price: Math.round(buyPrice),
      irr: irr,
      irr_pct: Math.round(irr * 1000) / 10,  // 18.4
      recovery_p50: Math.round(cone.net.p50),
      cone_p10: Math.round(cone.net.p10),
      cone_p90: Math.round(cone.net.p90),
      grade: { label: grade, color: PLDDT_COLOR[grade], actionLabel: ACTION_LABEL[grade] },
    };
  }

  /**
   * Top Risks — 회수 잠식 요인 (권리관계 차감이 큰 순).
   */
  function topRisks(inp, cone) {
    const claim = num(inp.claim) || num(inp.appraisal);
    const risks = [];
    const senior = num(inp.senior);
    if (senior > 0) {
      const pct = claim > 0 ? Math.round(senior / claim * 100) : 0;
      risks.push({ sign: '-', text: '선순위 채권 ' + fmtMan(senior) + ' — 회수액 ' + pct + '% 잠식' });
    }
    if (num(inp.deposit) > 0) {
      risks.push({ sign: '-', text: '임차 보증금 ' + fmtMan(inp.deposit) + ' — 대항력 시 우선 변제' });
    }
    if (num(inp.tax) > 0) {
      risks.push({ sign: '-', text: '세금/공과금 ' + fmtMan(inp.tax) + ' — 최우선 변제' });
    }
    // 낙찰가율 변동성 위험 (cone 폭이 클 때)
    const spread = cone.gross.p90 - cone.gross.p10;
    if (spread > num(inp.appraisal) * 0.25) {
      risks.push({ sign: '-', text: '낙찰가율 변동성 큼 (p10~p90 폭 ' + fmtMan(spread) + ')' });
    }
    return risks.slice(0, 3);
  }

  /**
   * 통합 평가 진입점 — UI에서 호출.
   * @param {object} inp - {
   *     address, claim(청구액), buy_price(후보 매수가), appraisal(감정가),
   *     senior(선순위), tax(세금), deposit(임차보증금), recovery_months? }
   * @returns {object|null}
   */
  function evaluateNplBuy(inp) {
    if (!inp || num(inp.claim) <= 0 || num(inp.buy_price) <= 0) return null;
    // 감정가 미입력 시 청구액의 1.2배로 추정 (보수적 fallback)
    if (num(inp.appraisal) <= 0) inp = Object.assign({}, inp, { appraisal: num(inp.claim) * 1.2 });

    const months = num(inp.recovery_months) || DEFAULT_RECOVERY_MONTHS;
    const cone = recoveryCone(inp);
    const base = num(inp.buy_price);

    // 3시나리오: 보수(×0.85) / 기본(×1.00) / 공격(×1.15) — UX line 89
    const scenarios = {
      conservative: evalScenario(base * 0.85, cone, months),
      base: evalScenario(base, cone, months),
      aggressive: evalScenario(base * 1.15, cone, months),
    };

    // 헤드라인 = 기본 시나리오
    const headline = scenarios.base;
    // 권리관계 경고 (UX line 86): 선순위 합 ≥ 청구액 × 90%
    const seniorTotal = num(inp.senior) + num(inp.tax) + num(inp.deposit);
    const seniorityWarning = seniorTotal >= num(inp.claim) * 0.9;

    return {
      irr: headline.irr,
      irr_pct: headline.irr_pct,
      grade: headline.grade,
      recovery_cone: {
        p10: Math.round(cone.net.p10),
        p50: Math.round(cone.net.p50),
        p90: Math.round(cone.net.p90),
        gross_p50: Math.round(cone.gross.p50),
        deduction: Math.round(cone.deduction),
      },
      top_risks: topRisks(inp, cone),
      scenarios: scenarios,
      seniority_warning: seniorityWarning,
      source: 'npl-buy-scorer.js (manual 입력 모드 — ETL_NPL_DATA-001 DEFERRED fallback)',
      confidence: 0.60,
      _internal: { cone: cone, months: months, inputs: inp },
    };
  }

  // ── helpers ──
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; }
  function fmtMan(v) {
    var n = num(v);
    if (n >= 10000) return (Math.round(n / 1000) / 10) + '억';
    return Math.round(n) + '만';
  }

  // ── 데모 채권 (수동 호가 모드 미입력 시 예시) ──
  // 데모 채권 — UX 명세(line 39~43) 정렬: 적정 매수가는 순회수액보다 충분히 낮아
  // 양(+)의 IRR이 나오는 케이스. 회수 p50 ≈ 매수가 × 1.15~1.4 수준.
  const DEMO_CLAIMS = Object.freeze([
    // 순회수 p50 ≈ 35,000 (감정가 48,000 × 0.82 − 차감 4,360), 매수가 30,000 → IRR ~+17%
    { id: 'NPL-2026-001', address: '의정부시 금오동 123', claim: 38000, buy_price: 30000,
      appraisal: 48000, senior: 3500, tax: 360, deposit: 500 },
    { id: 'NPL-2026-002', address: '강남구 역삼동 456', claim: 90000, buy_price: 72000,
      appraisal: 110000, senior: 8000, tax: 1200, deposit: 2000 },
  ]);

  /**
   * 포트폴리오 객관성 — 같은 모집단 내 IRR 백분위 + 동급 채권 비교.
   * 단일 평가가 "한 점"이 아니라 "분포 속 어디인지" 보여주는 객관성 지표.
   * @param {object} target - evaluate() 결과
   * @param {Array} peers - 다른 채권들의 evaluate() 결과 배열
   * @returns {object} { percentile, rank, total, peers:[{id,irr_pct,grade,delta}] }
   */
  function comparable(target, peers) {
    var all = (peers || []).filter(function(p){ return p && typeof p.irr === 'number'; });
    var below = all.filter(function(p){ return p.irr < target.irr; }).length;
    var total = all.length + 1;
    var percentile = total > 1 ? Math.round(below / (total - 1) * 100) : 50;
    var sorted = all.slice().sort(function(a,b){ return b.irr - a.irr; });
    return {
      percentile: percentile,                 // 0~100, 높을수록 포트폴리오 내 우수
      rank: all.filter(function(p){ return p.irr > target.irr; }).length + 1,
      total: total,
      peers: sorted.slice(0, 5).map(function(p){
        return { irr_pct: p.irr_pct, grade: p.grade.label, delta: Math.round((target.irr - p.irr) * 1000) / 10 };
      }),
    };
  }

  window.NplBuyScorer = {
    evaluate: evaluateNplBuy,
    recoveryCone: recoveryCone,
    computeIRR: computeIRR,
    irrToGrade: irrToGrade,
    comparable: comparable,
    getAuctionRate: getAuctionRate,
    DEMO_CLAIMS: DEMO_CLAIMS,
  };
})();
